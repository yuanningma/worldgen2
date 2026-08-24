import type { GeodesicSphere } from "./geodesic.ts";
import { rotateByEulerPole, type EulerPole } from "./kinematics.ts";
import {
  angleBetweenUnitVectors,
  cross3,
  dot3,
  normalize3,
  type Vec3,
} from "./vector.ts";

export type ParcelCrustType = "continental" | "oceanic";

export interface ParcelPlateKinematics {
  readonly id: number;
  readonly pole: EulerPole;
}

export interface ParcelMaterialSource {
  readonly faceId: number;
  /** Sub-cell material centroid retained across repeated conservative remaps. */
  readonly position?: Vec3;
  readonly plateId: number;
  readonly crustType: ParcelCrustType;
  /** Exact material share; defaults to the categorical crust type for legacy callers. */
  readonly continentalFraction?: number;
  readonly crustAgeMyr: number;
  readonly thermalAgeMyr: number;
  readonly crustThicknessKm: number;
  readonly densityKgM3: number;
  readonly provenanceId: number;
  readonly elevationKm: number;
  readonly tectonicReliefKm?: number;
  readonly roughnessKm?: number;
  readonly riftExposureMyr?: number;
  readonly convergenceExposureMyr?: number;
}

/** A persistent Lagrangian control parcel. Its material is never duplicated. */
export interface CrustParcel {
  readonly id: number;
  readonly sourceFaceId: number;
  readonly plateId: number;
  readonly position: Vec3;
  readonly areaSteradians: number;
  readonly crustType: ParcelCrustType;
  readonly continentalFraction?: number;
  readonly crustAgeMyr: number;
  readonly thermalAgeMyr: number;
  readonly crustThicknessKm: number;
  readonly densityKgM3: number;
  readonly provenanceId: number;
  readonly elevationKm: number;
  readonly tectonicReliefKm: number;
  readonly roughnessKm: number;
  readonly riftExposureMyr: number;
  readonly convergenceExposureMyr: number;
}

export interface ParcelContribution {
  readonly parcelId: number;
  readonly areaSteradians: number;
}

/** Conservative material mixture occupying one canonical geodesic face. */
export interface RemappedParcelFace {
  readonly faceId: number;
  readonly areaSteradians: number;
  readonly contributions: readonly ParcelContribution[];
  readonly dominantParcelId: number;
  readonly dominantPlateId: number;
  readonly dominantProvenanceId: number;
  readonly crustType: ParcelCrustType;
  readonly continentalFraction: number;
  readonly crustAgeMyr: number;
  readonly thermalAgeMyr: number;
  readonly crustThicknessKm: number;
  readonly densityKgM3: number;
  readonly elevationKm: number;
  readonly tectonicReliefKm: number;
  readonly roughnessKm: number;
  readonly riftExposureMyr: number;
  readonly convergenceExposureMyr: number;
}

export interface ParcelMaterialBudget {
  readonly areaSteradians: number;
  readonly continentalSteradians: number;
  readonly oceanicSteradians: number;
  readonly thicknessMomentSteradianKm: number;
  readonly densityThicknessMoment: number;
}

export interface ParcelRemapDiagnostics {
  readonly source: ParcelMaterialBudget;
  readonly remapped: ParcelMaterialBudget;
  readonly targetAreaSteradians: number;
  readonly areaResidualSteradians: number;
  readonly continentalResidualSteradians: number;
  readonly oceanicResidualSteradians: number;
  readonly thicknessMomentResidual: number;
  readonly densityThicknessMomentResidual: number;
  readonly maximumParcelAreaResidualSteradians: number;
  readonly maximumFaceAreaResidualSteradians: number;
  readonly maximumProvenanceAreaResidualSteradians: number;
  /** Empty cells before conservative deficit resolution. */
  readonly rawGapFaceCount: number;
  /** Cells whose landed parcel supply exceeded their capacity. */
  readonly rawOverlapFaceCount: number;
  readonly rawGapAreaSteradians: number;
  readonly rawOverlapAreaSteradians: number;
  readonly resolvedGapFaceCount: number;
  readonly resolvedOverlapFaceCount: number;
  readonly meanTransportDistanceRadians: number;
  readonly p95TransportDistanceRadians: number;
  readonly p99TransportDistanceRadians: number;
  readonly p999TransportDistanceRadians: number;
  readonly nonlocalThresholdRadians: number;
  readonly nonlocalTransportAreaFraction: number;
  readonly maximumTransportDistanceRadians: number;
}

export interface ParcelRemapResult {
  readonly faces: readonly RemappedParcelFace[];
  readonly diagnostics: ParcelRemapDiagnostics;
}

export interface ParcelTransportResult extends ParcelRemapResult {
  readonly parcels: readonly CrustParcel[];
  readonly elapsedMyr: number;
}

interface FaceLocator {
  locate(point: Vec3, startFaceId?: number): number;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function createFaceLocator(sphere: GeodesicSphere): FaceLocator {
  const neighbors = sphere.faces.map(() => new Map<string, number>());
  for (const edge of sphere.edges) {
    neighbors[edge.faces[0]].set(edgeKey(...edge.vertices), edge.faces[1]);
    neighbors[edge.faces[1]].set(edgeKey(...edge.vertices), edge.faces[0]);
  }

  const locate = (point: Vec3, startFaceId = 0): number => {
    let faceId = Number.isInteger(startFaceId) && startFaceId >= 0 && startFaceId < sphere.faces.length
      ? startFaceId
      : 0;
    for (let step = 0; step <= sphere.faces.length; step += 1) {
      const face = sphere.faces[faceId];
      let mostOutside = -1e-12;
      let exitEdge: readonly [number, number] | null = null;
      const [a, b, c] = face.vertices;
      for (const edge of [[a, b], [b, c], [c, a]] as const) {
        const first = sphere.vertices[edge[0]].position;
        const second = sphere.vertices[edge[1]].position;
        const side = dot3(cross3(first, second), point);
        if (side < mostOutside) {
          mostOutside = side;
          exitEdge = edge;
        }
      }
      if (exitEdge === null) return faceId;
      const next = neighbors[faceId].get(edgeKey(...exitEdge));
      if (next === undefined) break;
      faceId = next;
    }

    let closest = 0;
    let bestDot = -Infinity;
    for (const face of sphere.faces) {
      const similarity = dot3(face.center, point);
      if (similarity > bestDot) {
        bestDot = similarity;
        closest = face.id;
      }
    }
    return closest;
  };
  return { locate };
}

function validateFiniteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
}

function validateParcel(parcel: CrustParcel): void {
  if (!Number.isInteger(parcel.id) || parcel.id < 0) throw new RangeError("parcel id must be a nonnegative integer");
  if (!Number.isInteger(parcel.plateId) || parcel.plateId < 0) throw new RangeError("parcel plateId must be a nonnegative integer");
  if (!(parcel.areaSteradians > 0) || !Number.isFinite(parcel.areaSteradians)) {
    throw new RangeError("parcel areaSteradians must be finite and positive");
  }
  validateFiniteNonnegative(parcel.crustAgeMyr, "parcel crustAgeMyr");
  validateFiniteNonnegative(parcel.thermalAgeMyr, "parcel thermalAgeMyr");
  if (!(parcel.crustThicknessKm > 0) || !Number.isFinite(parcel.crustThicknessKm)) {
    throw new RangeError("parcel crustThicknessKm must be finite and positive");
  }
  if (!(parcel.densityKgM3 > 0) || !Number.isFinite(parcel.densityKgM3)) {
    throw new RangeError("parcel densityKgM3 must be finite and positive");
  }
  if (!Number.isFinite(parcel.elevationKm) || !Number.isFinite(parcel.tectonicReliefKm)
    || !Number.isFinite(parcel.roughnessKm)) {
    throw new RangeError("parcel relief fields must be finite");
  }
  validateFiniteNonnegative(parcel.riftExposureMyr, "parcel riftExposureMyr");
  validateFiniteNonnegative(parcel.convergenceExposureMyr, "parcel convergenceExposureMyr");
  if (parcel.continentalFraction !== undefined
    && (!(parcel.continentalFraction >= 0) || parcel.continentalFraction > 1)) {
    throw new RangeError("parcel continentalFraction must be between zero and one");
  }
  normalize3(parcel.position);
}

export function createCrustParcels(
  sphere: GeodesicSphere,
  cells: readonly ParcelMaterialSource[],
): readonly CrustParcel[] {
  if (cells.length !== sphere.faces.length) {
    throw new RangeError("cells must contain exactly one material source per geodesic face");
  }
  const byFace = new Array<ParcelMaterialSource>(sphere.faces.length);
  for (const cell of cells) {
    if (!Number.isInteger(cell.faceId) || cell.faceId < 0 || cell.faceId >= sphere.faces.length) {
      throw new RangeError("cell faceId is outside the geodesic sphere");
    }
    if (byFace[cell.faceId]) throw new RangeError(`duplicate material source for face ${cell.faceId}`);
    byFace[cell.faceId] = cell;
  }
  return sphere.faces.map((face) => {
    const cell = byFace[face.id];
    if (!cell) throw new RangeError(`missing material source for face ${face.id}`);
    const parcel: CrustParcel = {
      id: face.id,
      sourceFaceId: face.id,
      plateId: cell.plateId,
      position: cell.position ? normalize3(cell.position) : face.center,
      areaSteradians: face.areaSteradians,
      crustType: cell.crustType,
      continentalFraction: cell.continentalFraction
        ?? (cell.crustType === "continental" ? 1 : 0),
      crustAgeMyr: cell.crustAgeMyr,
      thermalAgeMyr: cell.thermalAgeMyr,
      crustThicknessKm: cell.crustThicknessKm,
      densityKgM3: cell.densityKgM3,
      provenanceId: cell.provenanceId,
      elevationKm: cell.elevationKm,
      tectonicReliefKm: cell.tectonicReliefKm ?? 0,
      roughnessKm: cell.roughnessKm ?? 0,
      riftExposureMyr: cell.riftExposureMyr ?? 0,
      convergenceExposureMyr: cell.convergenceExposureMyr ?? 0,
    };
    validateParcel(parcel);
    return parcel;
  });
}

/** Exact rigid Euler advection in the mantle frame. Material fields and IDs persist. */
export function advectCrustParcels(
  parcels: readonly CrustParcel[],
  plates: readonly ParcelPlateKinematics[],
  deltaMyr: number,
): readonly CrustParcel[] {
  if (!Number.isFinite(deltaMyr)) throw new RangeError("deltaMyr must be finite");
  const poles = new Map(plates.map((plate) => [plate.id, plate.pole] as const));
  if (poles.size !== plates.length) throw new RangeError("plate ids must be unique");
  return parcels.map((parcel) => {
    validateParcel(parcel);
    const pole = poles.get(parcel.plateId);
    if (!pole) throw new RangeError(`missing Euler pole for parcel plate ${parcel.plateId}`);
    return {
      ...parcel,
      position: rotateByEulerPole(parcel.position, pole, deltaMyr),
    };
  });
}

interface FlowEdge {
  readonly to: number;
  readonly reverse: number;
  capacity: number;
}

interface FlowAssignment {
  readonly parcelId: number;
  readonly faceId: number;
  readonly edge: FlowEdge;
  readonly initialCapacity: number;
}

class DinicFlow {
  readonly graph: FlowEdge[][];
  private readonly levels: Int32Array;
  private readonly cursors: Int32Array;

  constructor(nodeCount: number) {
    this.graph = Array.from({ length: nodeCount }, () => [] as FlowEdge[]);
    this.levels = new Int32Array(nodeCount);
    this.cursors = new Int32Array(nodeCount);
  }

  addEdge(from: number, to: number, capacity: number): FlowEdge {
    const forward: FlowEdge = { to, reverse: this.graph[to].length, capacity };
    const reverse: FlowEdge = { to: from, reverse: this.graph[from].length, capacity: 0 };
    this.graph[from].push(forward);
    this.graph[to].push(reverse);
    return forward;
  }

  private buildLevels(source: number, sink: number, epsilon: number): boolean {
    this.levels.fill(-1);
    const queue = new Int32Array(this.graph.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = source;
    this.levels[source] = 0;
    while (head < tail) {
      const node = queue[head++];
      for (const edge of this.graph[node]) {
        if (edge.capacity <= epsilon || this.levels[edge.to] >= 0) continue;
        this.levels[edge.to] = this.levels[node] + 1;
        queue[tail++] = edge.to;
      }
    }
    return this.levels[sink] >= 0;
  }

  private send(node: number, sink: number, amount: number, epsilon: number): number {
    if (node === sink) return amount;
    for (let index = this.cursors[node]; index < this.graph[node].length; index += 1) {
      this.cursors[node] = index;
      const edge = this.graph[node][index];
      if (edge.capacity <= epsilon || this.levels[edge.to] !== this.levels[node] + 1) continue;
      const sent = this.send(edge.to, sink, Math.min(amount, edge.capacity), epsilon);
      if (sent <= epsilon) continue;
      edge.capacity -= sent;
      this.graph[edge.to][edge.reverse].capacity += sent;
      return sent;
    }
    this.cursors[node] = this.graph[node].length;
    return 0;
  }

  maximumFlow(source: number, sink: number, epsilon: number): number {
    let total = 0;
    while (this.buildLevels(source, sink, epsilon)) {
      this.cursors.fill(0);
      while (true) {
        const sent = this.send(source, sink, Number.POSITIVE_INFINITY, epsilon);
        if (sent <= epsilon) break;
        total += sent;
      }
    }
    return total;
  }
}

function materialBudget(
  parcels: readonly CrustParcel[],
  contributionArea?: readonly number[],
): ParcelMaterialBudget {
  let areaSteradians = 0;
  let continentalSteradians = 0;
  let oceanicSteradians = 0;
  let thicknessMomentSteradianKm = 0;
  let densityThicknessMoment = 0;
  for (let id = 0; id < parcels.length; id += 1) {
    const parcel = parcels[id];
    const area = contributionArea?.[id] ?? parcel.areaSteradians;
    areaSteradians += area;
    const continentalFraction = parcel.continentalFraction
      ?? (parcel.crustType === "continental" ? 1 : 0);
    continentalSteradians += area * continentalFraction;
    oceanicSteradians += area * (1 - continentalFraction);
    thicknessMomentSteradianKm += area * parcel.crustThicknessKm;
    densityThicknessMoment += area * parcel.crustThicknessKm * parcel.densityKgM3;
  }
  return {
    areaSteradians,
    continentalSteradians,
    oceanicSteradians,
    thicknessMomentSteradianKm,
    densityThicknessMoment,
  };
}

function maximumMapResidual(first: ReadonlyMap<number, number>, second: ReadonlyMap<number, number>): number {
  const keys = new Set([...first.keys(), ...second.keys()]);
  let maximum = 0;
  for (const key of keys) maximum = Math.max(maximum, Math.abs((first.get(key) ?? 0) - (second.get(key) ?? 0)));
  return maximum;
}

/**
 * Conservatively remaps advected parcels onto fixed geodesic faces.
 *
 * Raw point landings can leave empty faces or put several parcels in one face.
 * We first fill each landing face up to its exact capacity. Remaining supply
 * then expands over the connected face graph in one shared distance-priority
 * queue. This makes every residual transfer local and deterministic without an
 * all-pairs search or a longitude-dependent global ordering. The contribution
 * matrix closes both row (parcel) and column (face) budgets without creating or
 * deleting material.
 */
export function remapCrustParcels(
  sphere: GeodesicSphere,
  parcels: readonly CrustParcel[],
): ParcelRemapResult {
  if (parcels.length === 0) throw new RangeError("at least one parcel is required");
  const parcelById = new Map<number, CrustParcel>();
  for (const parcel of parcels) {
    validateParcel(parcel);
    if (parcelById.has(parcel.id)) throw new RangeError(`duplicate parcel id ${parcel.id}`);
    parcelById.set(parcel.id, parcel);
  }
  const orderedParcels = [...parcels].sort((a, b) => a.id - b.id);
  const sourceArea = orderedParcels.reduce((sum, parcel) => sum + parcel.areaSteradians, 0);
  const areaTolerance = Math.max(1e-13, sphere.totalAreaSteradians * 1e-11);
  const closureTolerance = 1e-15;
  if (Math.abs(sourceArea - sphere.totalAreaSteradians) > areaTolerance) {
    throw new RangeError("parcel supply area must equal the geodesic sphere area");
  }

  const locator = createFaceLocator(sphere);
  const rawLandings = sphere.faces.map(() => [] as number[]);
  const landingFaceByParcel = new Map<number, number>();
  const rawOccupancy = new Float64Array(sphere.faces.length);
  for (const parcel of orderedParcels) {
    const faceId = locator.locate(parcel.position, parcel.sourceFaceId);
    landingFaceByParcel.set(parcel.id, faceId);
    rawLandings[faceId].push(parcel.id);
    rawOccupancy[faceId] += parcel.areaSteradians;
  }

  let rawGapFaceCount = 0;
  let rawOverlapFaceCount = 0;
  let rawGapAreaSteradians = 0;
  let rawOverlapAreaSteradians = 0;
  for (const face of sphere.faces) {
    const occupancy = rawOccupancy[face.id];
    if (occupancy <= areaTolerance) rawGapFaceCount += 1;
    if (occupancy < face.areaSteradians) rawGapAreaSteradians += face.areaSteradians - occupancy;
    if (occupancy > face.areaSteradians + areaTolerance) {
      rawOverlapFaceCount += 1;
      rawOverlapAreaSteradians += occupancy - face.areaSteradians;
    }
  }

  const remainingSupply = new Map(orderedParcels.map((parcel) => [parcel.id, parcel.areaSteradians] as const));
  const remainingDemand = Float64Array.from(sphere.faces, (face) => face.areaSteradians);
  const faceContributions = sphere.faces.map(() => [] as ParcelContribution[]);
  const parcelAssigned = new Map<number, number>(orderedParcels.map((parcel) => [parcel.id, 0]));
  let weightedDistance = 0;
  let maximumTransportDistanceRadians = 0;
  const distanceContributions: { distance: number; area: number }[] = [];

  const addContribution = (faceId: number, parcelId: number, requestedArea: number): number => {
    const supply = remainingSupply.get(parcelId) ?? 0;
    const demand = remainingDemand[faceId];
    const area = Math.min(requestedArea, supply, demand);
    if (!(area > 0)) return 0;
    faceContributions[faceId].push({ parcelId, areaSteradians: area });
    remainingSupply.set(parcelId, supply - area);
    remainingDemand[faceId] = demand - area;
    parcelAssigned.set(parcelId, (parcelAssigned.get(parcelId) ?? 0) + area);
    const distance = angleBetweenUnitVectors(parcelById.get(parcelId)!.position, sphere.faces[faceId].center);
    weightedDistance += distance * area;
    distanceContributions.push({ distance, area });
    maximumTransportDistanceRadians = Math.max(maximumTransportDistanceRadians, distance);
    return area;
  };

  const faceNeighbors = sphere.faces.map(() => [] as number[]);
  for (const edge of sphere.edges) {
    faceNeighbors[edge.faces[0]].push(edge.faces[1]);
    faceNeighbors[edge.faces[1]].push(edge.faces[0]);
  }
  for (const neighbors of faceNeighbors) neighbors.sort((a, b) => a - b);

  // Solve all parcel and face capacities together. Greedily locking raw landing
  // faces first is tempting, but it can strand a thin residual that must travel
  // far away even when an entirely local global assignment exists.
  const surplus = orderedParcels;
  const deficits = sphere.faces;
  const totalResidualSupply = surplus.reduce(
    (sum, parcel) => sum + (remainingSupply.get(parcel.id) ?? 0),
    0,
  );
  const cellScaleRadians = Math.sqrt(sphere.totalAreaSteradians / sphere.faces.length);
  const maximumAdvectionRadians = orderedParcels.reduce(
    (maximum, parcel) => Math.max(
      maximum,
      angleBetweenUnitVectors(parcel.position, sphere.faces[parcel.sourceFaceId].center),
    ),
    0,
  );
  const deficitNodeByFace = new Int32Array(sphere.faces.length);
  deficitNodeByFace.fill(-1);
  deficits.forEach((face, index) => { deficitNodeByFace[face.id] = index; });

  let selectedAssignments: readonly FlowAssignment[] | null = null;
  // Exact max flow prevents early greedy choices from stranding a few parcels
  // on the opposite side of the planet. The graph begins at a physically local
  // radius and expands only if that neighborhood cannot close all capacities.
  for (const cellRadii of [1.5, 2.5, 4, 6, 10]) {
    const radius = Math.min(Math.PI, maximumAdvectionRadians + cellRadii * cellScaleRadians);
    const source = 0;
    const firstParcelNode = 1;
    const firstDeficitNode = firstParcelNode + surplus.length;
    const sink = firstDeficitNode + deficits.length;
    const flow = new DinicFlow(sink + 1);
    const assignments: FlowAssignment[] = [];
    deficits.forEach((face, index) => {
      flow.addEdge(firstDeficitNode + index, sink, remainingDemand[face.id]);
    });
    const visited = new Uint32Array(sphere.faces.length);
    let visitEpoch = 0;
    const ringLimit = Math.max(2, Math.ceil(radius / cellScaleRadians * 1.7));
    surplus.forEach((parcel, parcelIndex) => {
      const parcelNode = firstParcelNode + parcelIndex;
      const supply = remainingSupply.get(parcel.id) ?? 0;
      flow.addEdge(source, parcelNode, supply);
      visitEpoch += 1;
      const start = landingFaceByParcel.get(parcel.id) as number;
      let frontier = [start];
      visited[start] = visitEpoch;
      const candidates: { faceId: number; distance: number }[] = [];
      for (let ring = 0; ring <= ringLimit && frontier.length > 0; ring += 1) {
        const next: number[] = [];
        for (const faceId of frontier) {
          const deficitIndex = deficitNodeByFace[faceId];
          if (deficitIndex >= 0) {
            const distance = angleBetweenUnitVectors(parcel.position, sphere.faces[faceId].center);
            if (distance <= radius + cellScaleRadians) candidates.push({ faceId, distance });
          }
          for (const neighbor of faceNeighbors[faceId]) {
            if (visited[neighbor] === visitEpoch) continue;
            visited[neighbor] = visitEpoch;
            next.push(neighbor);
          }
        }
        frontier = next;
      }
      candidates.sort((a, b) => a.distance - b.distance || a.faceId - b.faceId);
      for (const candidate of candidates) {
        const initialCapacity = supply;
        const edge = flow.addEdge(
          parcelNode,
          firstDeficitNode + deficitNodeByFace[candidate.faceId],
          initialCapacity,
        );
        assignments.push({ parcelId: parcel.id, faceId: candidate.faceId, edge, initialCapacity });
      }
    });
    const transported = flow.maximumFlow(source, sink, closureTolerance);
    if (totalResidualSupply - transported <= areaTolerance) {
      selectedAssignments = assignments;
      break;
    }
  }
  if (!selectedAssignments) {
    throw new Error("local conservative remap could not close within 10 cell radii beyond advection");
  }
  for (const assignment of selectedAssignments) {
    const area = assignment.initialCapacity - assignment.edge.capacity;
    if (area > closureTolerance) addContribution(
      assignment.faceId,
      assignment.parcelId,
      area,
    );
  }

  const unresolvedSupply = orderedParcels.reduce(
    (sum, parcel) => sum + Math.max(0, remainingSupply.get(parcel.id) ?? 0),
    0,
  );
  const unresolvedDemand = sphere.faces.reduce(
    (sum, face) => sum + Math.max(0, remainingDemand[face.id]),
    0,
  );
  if (unresolvedSupply > areaTolerance || unresolvedDemand > areaTolerance) {
    throw new Error(`local conservative remap did not close: supply ${unresolvedSupply}, demand ${unresolvedDemand}`);
  }

  const remappedContributionArea = orderedParcels.map((parcel) => parcelAssigned.get(parcel.id) ?? 0);
  const source = materialBudget(orderedParcels);
  const remapped = materialBudget(orderedParcels, remappedContributionArea);
  const sourceProvenance = new Map<number, number>();
  const remappedProvenance = new Map<number, number>();
  for (let index = 0; index < orderedParcels.length; index += 1) {
    const parcel = orderedParcels[index];
    sourceProvenance.set(parcel.provenanceId, (sourceProvenance.get(parcel.provenanceId) ?? 0) + parcel.areaSteradians);
    remappedProvenance.set(parcel.provenanceId, (remappedProvenance.get(parcel.provenanceId) ?? 0) + remappedContributionArea[index]);
  }

  let maximumParcelAreaResidualSteradians = 0;
  for (let index = 0; index < orderedParcels.length; index += 1) {
    maximumParcelAreaResidualSteradians = Math.max(
      maximumParcelAreaResidualSteradians,
      Math.abs(orderedParcels[index].areaSteradians - remappedContributionArea[index]),
    );
  }
  let maximumFaceAreaResidualSteradians = 0;
  let resolvedGapFaceCount = 0;
  let resolvedOverlapFaceCount = 0;
  for (const face of sphere.faces) {
    const assigned = faceContributions[face.id].reduce((sum, contribution) => sum + contribution.areaSteradians, 0);
    const residual = face.areaSteradians - assigned;
    maximumFaceAreaResidualSteradians = Math.max(maximumFaceAreaResidualSteradians, Math.abs(residual));
    if (residual > areaTolerance) resolvedGapFaceCount += 1;
    if (residual < -areaTolerance) resolvedOverlapFaceCount += 1;
  }

  const faces: RemappedParcelFace[] = sphere.faces.map((face) => {
    const contributions = faceContributions[face.id]
      .slice()
      .sort((a, b) => b.areaSteradians - a.areaSteradians || a.parcelId - b.parcelId);
    if (contributions.length === 0) throw new Error(`conservative remap left face ${face.id} empty`);
    const area = contributions.reduce((sum, contribution) => sum + contribution.areaSteradians, 0);
    const dominantParcel = parcelById.get(contributions[0].parcelId)!;
    let continentalArea = 0;
    let crustAgeMyr = 0;
    let thermalAgeMyr = 0;
    let crustThicknessKm = 0;
    let densityKgM3 = 0;
    let elevationKm = 0;
    let tectonicReliefKm = 0;
    let roughnessKm = 0;
    let riftExposureMyr = 0;
    let convergenceExposureMyr = 0;
    const plateAreas = new Map<number, number>();
    const provenanceAreas = new Map<number, number>();
    for (const contribution of contributions) {
      const parcel = parcelById.get(contribution.parcelId)!;
      const weight = contribution.areaSteradians / area;
      const parcelContinentalFraction = parcel.continentalFraction
        ?? (parcel.crustType === "continental" ? 1 : 0);
      continentalArea += contribution.areaSteradians * parcelContinentalFraction;
      crustAgeMyr += parcel.crustAgeMyr * weight;
      thermalAgeMyr += parcel.thermalAgeMyr * weight;
      crustThicknessKm += parcel.crustThicknessKm * weight;
      densityKgM3 += parcel.densityKgM3 * weight;
      elevationKm += parcel.elevationKm * weight;
      tectonicReliefKm += parcel.tectonicReliefKm * weight;
      roughnessKm += parcel.roughnessKm * weight;
      riftExposureMyr += parcel.riftExposureMyr * weight;
      convergenceExposureMyr += parcel.convergenceExposureMyr * weight;
      plateAreas.set(parcel.plateId, (plateAreas.get(parcel.plateId) ?? 0) + contribution.areaSteradians);
      provenanceAreas.set(parcel.provenanceId, (provenanceAreas.get(parcel.provenanceId) ?? 0) + contribution.areaSteradians);
    }
    const dominantKey = (areas: ReadonlyMap<number, number>): number => [...areas.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const continentalFraction = continentalArea / area;
    return {
      faceId: face.id,
      areaSteradians: face.areaSteradians,
      contributions,
      dominantParcelId: dominantParcel.id,
      dominantPlateId: dominantKey(plateAreas),
      dominantProvenanceId: dominantKey(provenanceAreas),
      crustType: continentalFraction >= 0.5 ? "continental" : "oceanic",
      continentalFraction,
      crustAgeMyr,
      thermalAgeMyr,
      crustThicknessKm,
      densityKgM3,
      elevationKm,
      tectonicReliefKm,
      roughnessKm,
      riftExposureMyr,
      convergenceExposureMyr,
    };
  });

  distanceContributions.sort((a, b) => a.distance - b.distance || a.area - b.area);
  const distanceQuantile = (quantile: number): number => {
    const target = remapped.areaSteradians * quantile;
    let cumulative = 0;
    for (const contribution of distanceContributions) {
      cumulative += contribution.area;
      if (cumulative >= target) return contribution.distance;
    }
    return distanceContributions.at(-1)?.distance ?? 0;
  };
  const nonlocalThresholdRadians = 6 * Math.sqrt(
    sphere.totalAreaSteradians / sphere.faces.length,
  );
  const nonlocalTransportArea = distanceContributions.reduce(
    (sum, contribution) => sum + (contribution.distance > nonlocalThresholdRadians ? contribution.area : 0),
    0,
  );

  return {
    faces,
    diagnostics: {
      source,
      remapped,
      targetAreaSteradians: sphere.totalAreaSteradians,
      areaResidualSteradians: remapped.areaSteradians - source.areaSteradians,
      continentalResidualSteradians: remapped.continentalSteradians - source.continentalSteradians,
      oceanicResidualSteradians: remapped.oceanicSteradians - source.oceanicSteradians,
      thicknessMomentResidual: remapped.thicknessMomentSteradianKm - source.thicknessMomentSteradianKm,
      densityThicknessMomentResidual: remapped.densityThicknessMoment - source.densityThicknessMoment,
      maximumParcelAreaResidualSteradians,
      maximumFaceAreaResidualSteradians,
      maximumProvenanceAreaResidualSteradians: maximumMapResidual(sourceProvenance, remappedProvenance),
      rawGapFaceCount,
      rawOverlapFaceCount,
      rawGapAreaSteradians,
      rawOverlapAreaSteradians,
      resolvedGapFaceCount,
      resolvedOverlapFaceCount,
      meanTransportDistanceRadians: weightedDistance / remapped.areaSteradians,
      p95TransportDistanceRadians: distanceQuantile(0.95),
      p99TransportDistanceRadians: distanceQuantile(0.99),
      p999TransportDistanceRadians: distanceQuantile(0.999),
      nonlocalThresholdRadians,
      nonlocalTransportAreaFraction: nonlocalTransportArea / remapped.areaSteradians,
      maximumTransportDistanceRadians,
    },
  };
}

export function transportCrustParcels(
  sphere: GeodesicSphere,
  parcels: readonly CrustParcel[],
  plates: readonly ParcelPlateKinematics[],
  deltaMyr: number,
): ParcelTransportResult {
  const advected = advectCrustParcels(parcels, plates, deltaMyr);
  const remapped = remapCrustParcels(sphere, advected);
  return { parcels: advected, elapsedMyr: deltaMyr, ...remapped };
}
