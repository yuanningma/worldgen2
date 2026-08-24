import { createGeodesicSphere, type GeodesicSphere } from "./geodesic.ts";
import { createSurfaceRefinement } from "./surfaceRefinement.ts";
import { cross3, dot3, normalize3, type Vec3 } from "./vector.ts";
import type { TectonicWorldModel } from "./worldSimulation.ts";

export interface SurfaceProcessOptions {
  /** Nested icosphere level. Defaults to one level finer than tectonics. */
  readonly subdivisions?: number;
  readonly coastAmplitude?: number;
  readonly coastalBand?: number;
  /** Geology-conditioned sub-cell relief amplitude. */
  readonly reliefAmplitudeKm?: number;
  /** Minimum contributing drainage area used to classify a river. */
  readonly minimumRiverAreaKm2?: number;
}

export interface SurfaceProcessCell {
  readonly faceId: number;
  readonly canonicalFaceId: number;
  readonly isLand: boolean;
  readonly elevationKm: number;
  readonly coastDistanceKm: number;
  readonly filledElevationKm: number;
  readonly fillDepthKm: number;
  readonly temperatureC: number;
  readonly precipitationMPerYear: number;
  readonly localRunoffKm3PerYear: number;
  readonly receiverFaceId: number | null;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export interface SurfaceRiverSegment {
  readonly fromFaceId: number;
  readonly toFaceId: number;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export interface SurfaceProcessStats {
  readonly landFraction: number;
  readonly landCellCount: number;
  readonly oceanCellCount: number;
  readonly riverSegmentCount: number;
  readonly maximumDrainageAreaKm2: number;
  readonly maximumDischargeKm3PerYear: number;
  readonly totalLocalRunoffKm3PerYear: number;
  readonly totalOutletRunoffKm3PerYear: number;
  readonly runoffResidualKm3PerYear: number;
  readonly maximumFillDepthKm: number;
  readonly canonicalAnchorMismatches: number;
}

export interface SurfaceProcessWorld {
  readonly version: 1;
  readonly tectonicWorld: TectonicWorldModel;
  readonly sphere: GeodesicSphere;
  readonly cells: readonly SurfaceProcessCell[];
  readonly rivers: readonly SurfaceRiverSegment[];
  readonly stats: SurfaceProcessStats;
  readonly sample: (direction: Vec3) => SurfaceProcessCell;
}

interface MutableSurfaceCell extends SurfaceProcessCell {
  coastDistanceKm: number;
  filledElevationKm: number;
  fillDepthKm: number;
  receiverFaceId: number | null;
  drainageAreaKm2: number;
  dischargeKm3PerYear: number;
  floodOrder: number;
}

interface HeapEntry {
  readonly faceId: number;
  readonly priority: number;
}

interface KdNode {
  readonly faceId: number;
  readonly axis: 0 | 1 | 2;
  readonly left: KdNode | null;
  readonly right: KdNode | null;
}

class ElevationHeap {
  private readonly values: HeapEntry[] = [];

  push(entry: HeapEntry): void {
    this.values.push(entry);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(entry, this.values[parent])) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.less(this.values[right], this.values[left]) ? right : left;
      if (!this.less(this.values[child], last)) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }

  private less(a: HeapEntry, b: HeapEntry): boolean {
    return a.priority < b.priority || (a.priority === b.priority && a.faceId < b.faceId);
  }
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function seedHash(seed: string | number): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sphericalNoise(point: Vec3, seed: number): number {
  const phase = seed * 0.000_013_7;
  const first = Math.sin((point[0] * 0.73 + point[1] * -0.51 + point[2] * 0.44) * 37 + phase);
  const second = Math.sin((point[0] * -0.29 + point[1] * 0.81 + point[2] * 0.39) * 79 + phase * 1.91);
  const third = Math.cos((point[0] * 0.61 + point[1] * 0.22 + point[2] * -0.76) * 151 + phase * 3.17);
  return first * 0.52 + second * 0.31 + third * 0.17;
}

function buildAdjacency(sphere: GeodesicSphere): readonly number[][] {
  const result: number[][] = sphere.faces.map(() => []);
  for (const edge of sphere.edges) {
    result[edge.faces[0]].push(edge.faces[1]);
    result[edge.faces[1]].push(edge.faces[0]);
  }
  return result;
}

function buildKdTree(faceIds: number[], centers: readonly Vec3[], depth = 0): KdNode | null {
  if (faceIds.length === 0) return null;
  const axis = (depth % 3) as 0 | 1 | 2;
  faceIds.sort((a, b) => centers[a][axis] - centers[b][axis] || a - b);
  const middle = Math.floor(faceIds.length / 2);
  return {
    faceId: faceIds[middle],
    axis,
    left: buildKdTree(faceIds.slice(0, middle), centers, depth + 1),
    right: buildKdTree(faceIds.slice(middle + 1), centers, depth + 1),
  };
}

function nearestFace(root: KdNode, centers: readonly Vec3[], point: Vec3): number {
  let bestFace = root.faceId;
  let bestDistance = Infinity;
  const visit = (node: KdNode | null): void => {
    if (!node) return;
    const center = centers[node.faceId];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance || (distance === bestDistance && node.faceId < bestFace)) {
      bestFace = node.faceId;
      bestDistance = distance;
    }
    const delta = point[node.axis] - center[node.axis];
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta <= bestDistance) visit(delta < 0 ? node.right : node.left);
  };
  visit(root);
  return bestFace;
}

function containsPoint(sphere: GeodesicSphere, faceId: number, point: Vec3): boolean {
  const vertices = sphere.faces[faceId].vertices.map((id) => sphere.vertices[id].position);
  for (let index = 0; index < 3; index += 1) {
    if (dot3(cross3(vertices[index], vertices[(index + 1) % 3]), point) < -1e-11) return false;
  }
  return true;
}

function exactFaceAtPoint(
  sphere: GeodesicSphere,
  root: KdNode,
  centers: readonly Vec3[],
  adjacency: readonly number[][],
  input: Vec3,
): number {
  const point = normalize3(input);
  const nearest = nearestFace(root, centers, point);
  if (containsPoint(sphere, nearest, point)) return nearest;
  const visited = new Set([nearest]);
  let frontier = [nearest];
  for (let depth = 0; depth < 4; depth += 1) {
    const next: number[] = [];
    for (const faceId of frontier) {
      for (const neighbor of adjacency[faceId]) {
        if (visited.has(neighbor)) continue;
        if (containsPoint(sphere, neighbor, point)) return neighbor;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return nearest;
}

function climateAt(point: Vec3, elevationAboveSeaKm: number, seed: number): {
  temperatureC: number;
  precipitationMPerYear: number;
} {
  const latitude = Math.asin(clamp(point[2], -1, 1));
  const absoluteLatitude = Math.abs(latitude);
  const temperatureC = 29 - absoluteLatitude / (Math.PI / 2) * 51 - Math.max(0, elevationAboveSeaKm) * 6.1;
  const equatorial = Math.exp(-((absoluteLatitude / 0.29) ** 2));
  const subtropical = Math.exp(-(((absoluteLatitude - 0.48) / 0.17) ** 2));
  const stormTrack = Math.exp(-(((absoluteLatitude - 0.93) / 0.25) ** 2));
  const texture = clamp(0.82 + sphericalNoise(point, seed + 911) * 0.28, 0.45, 1.35);
  const orographic = 1 + clamp(elevationAboveSeaKm / 5, 0, 1) * 0.32;
  return {
    temperatureC,
    precipitationMPerYear: clamp((0.42 + equatorial * 1.85 + stormTrack * 0.9 - subtropical * 0.48) * texture * orographic, 0.08, 4.2),
  };
}

/**
 * Creates a persistent high-resolution surface-process model.
 *
 * Tectonics remains authoritative at canonical face centers. The nested
 * icosphere resolves coast and relief one or two levels more finely, while
 * Priority-Flood supplies an acyclic receiver graph and exact runoff closure.
 */
export function createSurfaceProcessWorld(
  tectonicWorld: TectonicWorldModel,
  options: SurfaceProcessOptions = {},
): SurfaceProcessWorld {
  const subdivisions = options.subdivisions ?? Math.min(7, tectonicWorld.sphere.subdivisions + 1);
  if (!Number.isInteger(subdivisions)
    || subdivisions < tectonicWorld.sphere.subdivisions
    || subdivisions > 7) {
    throw new RangeError("surface subdivisions must be an integer from the tectonic level through 7");
  }
  const detailLevels = subdivisions - tectonicWorld.sphere.subdivisions;
  const sphere = createGeodesicSphere(subdivisions);
  const adjacency = buildAdjacency(sphere);
  const refinement = createSurfaceRefinement(tectonicWorld, {
    coastAmplitude: options.coastAmplitude,
    coastalBand: options.coastalBand,
    reliefPasses: 2,
  });
  const refinementAudit = refinement.audit();
  if (!refinementAudit.topologyAnchorsPreserved) {
    throw new Error("surface process refinement changed a canonical topology anchor");
  }
  const reliefAmplitudeKm = clamp(options.reliefAmplitudeKm ?? 0.34, 0, 1.25);
  const hashedSeed = seedHash(tectonicWorld.recipe.seed);
  const radiusSquared = tectonicWorld.recipe.radiusKm ** 2;
  const cells: MutableSurfaceCell[] = sphere.faces.map((face) => {
    const refined = refinement.sample(face.center);
    const canonicalFaceId = Math.floor(face.id / 4 ** detailLevels);
    const canonical = tectonicWorld.cells[canonicalFaceId];
    const aboveSea = refined.elevationKm - tectonicWorld.seaLevelKm;
    const mountainEnvelope = clamp((aboveSea - 0.25) / 4.5);
    const continentalEnvelope = clamp(canonical.continentalFraction
      ?? (canonical.crustType === "continental" ? 1 : 0));
    const noise = sphericalNoise(face.center, hashedSeed);
    const ridge = 1 - Math.abs(sphericalNoise(face.center, hashedSeed + 337));
    const detail = refined.isLand
      ? (noise * 0.48 + (ridge - 0.5) * (0.28 + mountainEnvelope * 0.72))
        * reliefAmplitudeKm * (0.35 + continentalEnvelope * 0.25 + mountainEnvelope * 0.9)
      : noise * reliefAmplitudeKm * 0.16;
    const elevationKm = refined.isLand
      ? Math.max(tectonicWorld.seaLevelKm + 0.002, refined.elevationKm + detail)
      : Math.min(tectonicWorld.seaLevelKm - 0.002, refined.elevationKm + detail);
    const climate = climateAt(face.center, elevationKm - tectonicWorld.seaLevelKm, hashedSeed);
    const areaKm2 = face.areaSteradians * radiusSquared;
    const frozenFraction = clamp((-climate.temperatureC + 2) / 22, 0, 0.72);
    const runoffCoefficient = clamp(0.36 + climate.precipitationMPerYear * 0.13 + mountainEnvelope * 0.18 - frozenFraction * 0.12, 0.22, 0.82);
    const localRunoffKm3PerYear = refined.isLand
      ? climate.precipitationMPerYear * areaKm2 / 1000 * runoffCoefficient
      : 0;
    return {
      faceId: face.id,
      canonicalFaceId,
      isLand: refined.isLand,
      elevationKm,
      coastDistanceKm: refined.isLand ? 0 : Infinity,
      filledElevationKm: elevationKm,
      fillDepthKm: 0,
      temperatureC: climate.temperatureC,
      precipitationMPerYear: climate.precipitationMPerYear,
      localRunoffKm3PerYear,
      receiverFaceId: null,
      drainageAreaKm2: refined.isLand ? areaKm2 : 0,
      dischargeKm3PerYear: localRunoffKm3PerYear,
      floodOrder: -1,
    };
  });

  const heap = new ElevationHeap();
  const visited = new Uint8Array(cells.length);
  let floodOrder = 0;
  for (const cell of cells) {
    if (cell.isLand) continue;
    visited[cell.faceId] = 1;
    cell.floodOrder = floodOrder;
    floodOrder += 1;
    heap.push({ faceId: cell.faceId, priority: cell.elevationKm });
  }
  if (floodOrder === 0) throw new Error("surface hydrology requires at least one ocean outlet");
  const epsilonKm = 1e-7;
  for (let entry = heap.pop(); entry; entry = heap.pop()) {
    for (const neighborId of adjacency[entry.faceId]) {
      if (visited[neighborId] !== 0) continue;
      const neighbor = cells[neighborId];
      visited[neighborId] = 1;
      neighbor.floodOrder = floodOrder;
      floodOrder += 1;
      neighbor.receiverFaceId = entry.faceId;
      neighbor.filledElevationKm = Math.max(neighbor.elevationKm, entry.priority + epsilonKm);
      neighbor.fillDepthKm = Math.max(0, neighbor.filledElevationKm - neighbor.elevationKm);
      heap.push({ faceId: neighborId, priority: neighbor.filledElevationKm });
    }
  }
  if (floodOrder !== cells.length) throw new Error("surface hydrology did not cover the closed sphere");

  const coastHeap = new ElevationHeap();
  for (const cell of cells) {
    if (cell.isLand || !adjacency[cell.faceId].some((neighbor) => cells[neighbor].isLand)) continue;
    cell.coastDistanceKm = 0;
    coastHeap.push({ faceId: cell.faceId, priority: 0 });
  }
  for (let entry = coastHeap.pop(); entry; entry = coastHeap.pop()) {
    if (entry.priority > cells[entry.faceId].coastDistanceKm + 1e-9) continue;
    const center = sphere.faces[entry.faceId].center;
    for (const neighborId of adjacency[entry.faceId]) {
      const neighbor = cells[neighborId];
      if (neighbor.isLand) continue;
      const neighborCenter = sphere.faces[neighborId].center;
      const edgeKm = Math.acos(clamp(dot3(center, neighborCenter), -1, 1)) * tectonicWorld.recipe.radiusKm;
      const distance = entry.priority + edgeKm;
      if (distance >= neighbor.coastDistanceKm) continue;
      neighbor.coastDistanceKm = distance;
      coastHeap.push({ faceId: neighborId, priority: distance });
    }
  }

  const downstreamOrder = cells
    .filter((cell) => cell.isLand)
    .sort((a, b) => b.floodOrder - a.floodOrder || b.faceId - a.faceId);
  let outletRunoff = 0;
  for (const cell of downstreamOrder) {
    if (cell.receiverFaceId === null) throw new Error(`land face ${cell.faceId} has no hydrologic receiver`);
    const receiver = cells[cell.receiverFaceId];
    if (receiver.isLand) {
      receiver.drainageAreaKm2 += cell.drainageAreaKm2;
      receiver.dischargeKm3PerYear += cell.dischargeKm3PerYear;
    } else {
      outletRunoff += cell.dischargeKm3PerYear;
    }
  }

  const totalSurfaceAreaKm2 = sphere.totalAreaSteradians * radiusSquared;
  const minimumRiverAreaKm2 = options.minimumRiverAreaKm2
    ?? Math.max(90_000, totalSurfaceAreaKm2 / 3_500);
  const rivers: SurfaceRiverSegment[] = [];
  for (const cell of cells) {
    if (!cell.isLand || cell.receiverFaceId === null || cell.drainageAreaKm2 < minimumRiverAreaKm2) continue;
    rivers.push({
      fromFaceId: cell.faceId,
      toFaceId: cell.receiverFaceId,
      drainageAreaKm2: cell.drainageAreaKm2,
      dischargeKm3PerYear: cell.dischargeKm3PerYear,
    });
  }

  const totalRunoff = cells.reduce((sum, cell) => sum + cell.localRunoffKm3PerYear, 0);
  const landArea = cells.reduce(
    (sum, cell) => sum + (cell.isLand ? sphere.faces[cell.faceId].areaSteradians : 0),
    0,
  );
  const immutableCells: SurfaceProcessCell[] = cells.map((cell) => ({
    faceId: cell.faceId,
    canonicalFaceId: cell.canonicalFaceId,
    isLand: cell.isLand,
    elevationKm: cell.elevationKm,
    coastDistanceKm: cell.coastDistanceKm,
    filledElevationKm: cell.filledElevationKm,
    fillDepthKm: cell.fillDepthKm,
    temperatureC: cell.temperatureC,
    precipitationMPerYear: cell.precipitationMPerYear,
    localRunoffKm3PerYear: cell.localRunoffKm3PerYear,
    receiverFaceId: cell.receiverFaceId,
    drainageAreaKm2: cell.drainageAreaKm2,
    dischargeKm3PerYear: cell.dischargeKm3PerYear,
  }));
  const centers = sphere.faces.map((face) => face.center);
  const root = buildKdTree(sphere.faces.map((face) => face.id), centers);
  if (!root) throw new Error("surface process grid must contain faces");
  return {
    version: 1,
    tectonicWorld,
    sphere,
    cells: immutableCells,
    rivers,
    stats: {
      landFraction: landArea / sphere.totalAreaSteradians,
      landCellCount: cells.filter((cell) => cell.isLand).length,
      oceanCellCount: cells.filter((cell) => !cell.isLand).length,
      riverSegmentCount: rivers.length,
      maximumDrainageAreaKm2: cells.reduce((maximum, cell) => Math.max(maximum, cell.drainageAreaKm2), 0),
      maximumDischargeKm3PerYear: cells.reduce((maximum, cell) => Math.max(maximum, cell.dischargeKm3PerYear), 0),
      totalLocalRunoffKm3PerYear: totalRunoff,
      totalOutletRunoffKm3PerYear: outletRunoff,
      runoffResidualKm3PerYear: totalRunoff - outletRunoff,
      maximumFillDepthKm: cells.reduce((maximum, cell) => Math.max(maximum, cell.fillDepthKm), 0),
      canonicalAnchorMismatches: refinementAudit.canonicalAnchorMismatches,
    },
    sample: (direction) => immutableCells[exactFaceAtPoint(sphere, root, centers, adjacency, direction)],
  };
}
