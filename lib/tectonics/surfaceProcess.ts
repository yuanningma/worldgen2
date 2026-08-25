import { createGeodesicSphere, type GeodesicSphere } from "./geodesic.ts";
import { createSurfaceRefinement } from "./surfaceRefinement.ts";
import { cross3, dot3, normalize3, type Vec3 } from "./vector.ts";
import type { TectonicWorldModel } from "./worldSimulation.ts";

export interface SurfaceProcessOptions {
  /** Nested icosphere level. Defaults to one level finer than tectonics. */
  readonly subdivisions?: number;
  readonly coastAmplitude?: number;
  readonly coastalBand?: number;
  readonly coastOctaves?: number;
  /** Geology-conditioned sub-cell relief amplitude. */
  readonly reliefAmplitudeKm?: number;
  /** Minimum contributing drainage area used to classify a river. */
  readonly minimumRiverAreaKm2?: number;
  /** Maximum characteristic incision applied by the reduced geomorphic pass. */
  readonly erosionStrengthKm?: number;
  /** Drainage area below which channels do not resolve at this surface tier. */
  readonly minimumErosionAreaKm2?: number;
  /** Nearby same-class cells blended by the resolution-independent sampler. */
  readonly presentationSampleCount?: number;
}

export type SurfaceLithology =
  | "oceanic-basalt"
  | "crystalline"
  | "metamorphic"
  | "volcanic"
  | "carbonate"
  | "sedimentary";

const SURFACE_LITHOLOGIES: readonly SurfaceLithology[] = [
  "oceanic-basalt",
  "crystalline",
  "metamorphic",
  "volcanic",
  "carbonate",
  "sedimentary",
];

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
  /** Advected atmospheric moisture after local precipitation loss, in [0, 1]. */
  readonly atmosphericMoisture: number;
  /** Positive upwind terrain rise used by the reduced orographic model. */
  readonly orographicLiftKm: number;
  readonly lithology: SurfaceLithology;
  /** Dimensionless resistance to fluvial and diffusive erosion, in [0, 1]. */
  readonly erosionResistance: number;
  readonly localRunoffKm3PerYear: number;
  readonly erodedThicknessKm: number;
  readonly depositedThicknessKm: number;
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

export interface SurfacePresentationSample {
  /** Nearest process cell; retained for diagnostics and river lookup only. */
  readonly faceId: number;
  readonly canonicalFaceId: number;
  readonly isLand: boolean;
  readonly elevationKm: number;
  readonly coastDistanceKm: number;
  readonly temperatureC: number;
  readonly precipitationMPerYear: number;
  readonly atmosphericMoisture: number;
  readonly orographicLiftKm: number;
  /** Unit tangent vector of the reduced annual prevailing wind field. */
  readonly prevailingWind: Vec3;
  readonly lithology: SurfaceLithology;
  readonly erosionResistance: number;
  /** Stable world-space detail used for albedo modulation, in [-1, 1]. */
  readonly surfaceTexture: number;
  /** Tangential rise/run vector used for continuous hill shading. */
  readonly terrainGradient: Vec3;
  readonly presentationOnly: true;
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
  readonly erodedVolumeKm3: number;
  readonly depositedVolumeKm3: number;
  readonly exportedSedimentVolumeKm3: number;
  readonly sedimentResidualKm3: number;
  readonly incisedCellCount: number;
  readonly depositionalCellCount: number;
  readonly meanLandErosionResistance: number;
  readonly lithologyAreaKm2: Readonly<Record<SurfaceLithology, number>>;
  readonly erodedVolumeByLithologyKm3: Readonly<Record<SurfaceLithology, number>>;
  readonly meanLandTemperatureC: number;
  readonly meanLandPrecipitationMPerYear: number;
  readonly aridLandFraction: number;
  readonly humidLandFraction: number;
  readonly maximumOrographicLiftKm: number;
}

export interface SurfaceProcessWorld {
  readonly version: 1;
  readonly tectonicWorld: TectonicWorldModel;
  readonly sphere: GeodesicSphere;
  readonly cells: readonly SurfaceProcessCell[];
  readonly rivers: readonly SurfaceRiverSegment[];
  readonly stats: SurfaceProcessStats;
  readonly sample: (direction: Vec3) => SurfaceProcessCell;
  /** Continuous render sample whose output does not depend on raster size. */
  readonly sampleContinuous: (direction: Vec3) => SurfacePresentationSample;
}

interface MutableSurfaceCell extends SurfaceProcessCell {
  elevationKm: number;
  coastDistanceKm: number;
  filledElevationKm: number;
  fillDepthKm: number;
  receiverFaceId: number | null;
  drainageAreaKm2: number;
  dischargeKm3PerYear: number;
  erodedThicknessKm: number;
  depositedThicknessKm: number;
  temperatureC: number;
  precipitationMPerYear: number;
  atmosphericMoisture: number;
  orographicLiftKm: number;
  localRunoffKm3PerYear: number;
  floodOrder: number;
}

interface SurfaceClimateStats {
  readonly meanLandTemperatureC: number;
  readonly meanLandPrecipitationMPerYear: number;
  readonly aridLandFraction: number;
  readonly humidLandFraction: number;
  readonly maximumOrographicLiftKm: number;
}

interface DrainageResult {
  readonly downstreamOrder: readonly MutableSurfaceCell[];
  readonly outletRunoffKm3PerYear: number;
}

interface SedimentBudget {
  readonly erodedVolumeKm3: number;
  readonly depositedVolumeKm3: number;
  readonly exportedSedimentVolumeKm3: number;
  readonly sedimentResidualKm3: number;
  readonly incisedCellCount: number;
  readonly depositionalCellCount: number;
  readonly erodedVolumeByLithologyKm3: Readonly<Record<SurfaceLithology, number>>;
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

interface PresentationDetailBand {
  readonly directionA: Vec3;
  readonly directionB: Vec3;
  readonly frequency: number;
  readonly phaseA: number;
  readonly phaseB: number;
  readonly weight: number;
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

function createPresentationDetailBands(seed: number): readonly PresentationDetailBand[] {
  const frequencies = [173, 347, 691, 1_381, 2_767];
  const weights = [0.34, 0.25, 0.19, 0.13, 0.09];
  return frequencies.map((frequency, octave) => {
    const direction = (index: number): Vec3 => normalize3([0, 1, 2].map((axis) => (
      seedHash(`${seed}:presentation:${octave}:${index}:${axis}`) / 0x1_0000_0000 * 2 - 1
    )) as unknown as Vec3);
    const phase = (index: number): number => (
      seedHash(`${seed}:presentation:${octave}:phase:${index}`) / 0x1_0000_0000 * Math.PI * 2
    );
    return {
      directionA: direction(0),
      directionB: direction(1),
      frequency,
      phaseA: phase(0),
      phaseB: phase(1),
      weight: weights[octave],
    };
  });
}

function samplePresentationDetail(
  point: Vec3,
  bands: readonly PresentationDetailBand[],
): number {
  let value = 0;
  for (const band of bands) {
    const argumentA = dot3(point, band.directionA) * band.frequency + band.phaseA;
    const argumentB = dot3(point, band.directionB) * band.frequency * 0.79 + band.phaseB;
    const sineA = Math.sin(argumentA);
    const sineB = Math.sin(argumentB);
    value += sineA * sineB * band.weight;
  }
  return value;
}

function buildAdjacency(sphere: GeodesicSphere): readonly number[][] {
  const result: number[][] = sphere.faces.map(() => []);
  for (const edge of sphere.edges) {
    result[edge.faces[0]].push(edge.faces[1]);
    result[edge.faces[1]].push(edge.faces[0]);
  }
  return result;
}

function emptyLithologyRecord(): Record<SurfaceLithology, number> {
  return Object.fromEntries(
    SURFACE_LITHOLOGIES.map((lithology) => [lithology, 0]),
  ) as Record<SurfaceLithology, number>;
}

function diffuseCanonicalField(
  source: Float64Array,
  adjacency: readonly number[][],
  passes: number,
  decay: number,
  allowed: (faceId: number) => boolean,
): Float64Array {
  let field = source;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(field);
    for (let faceId = 0; faceId < field.length; faceId += 1) {
      if (!allowed(faceId)) continue;
      for (const neighbor of adjacency[faceId]) {
        if (!allowed(neighbor)) continue;
        next[faceId] = Math.max(next[faceId], field[neighbor] * decay);
      }
    }
    field = next;
  }
  return field;
}

function canonicalGeologyContext(world: TectonicWorldModel): {
  readonly sutureStrength: Float64Array;
  readonly activeMarginStrength: Float64Array;
} {
  const adjacency = buildAdjacency(world.sphere);
  const continental = (faceId: number): boolean => {
    const cell = world.cells[faceId];
    return (cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0)) >= 0.5;
  };
  const sutureSeeds = new Float64Array(world.cells.length);
  for (const edge of world.sphere.edges) {
    const [firstId, secondId] = edge.faces;
    const first = world.cells[firstId];
    const second = world.cells[secondId];
    if (!continental(firstId) || !continental(secondId) || first.provenanceId === second.provenanceId) continue;
    sutureSeeds[firstId] = 1;
    sutureSeeds[secondId] = 1;
  }
  const sutureStrength = diffuseCanonicalField(sutureSeeds, adjacency, 4, 0.58, continental);

  const activeSeeds = new Float64Array(world.cells.length);
  for (const boundary of world.boundaries) {
    const edge = world.sphere.edges[boundary.edgeId];
    const strength = boundary.kind === "convergent"
      ? 1
      : boundary.kind === "divergent"
        ? 0.72
        : boundary.kind === "transform"
          ? 0.42
          : 0;
    activeSeeds[edge.faces[0]] = Math.max(activeSeeds[edge.faces[0]], strength);
    activeSeeds[edge.faces[1]] = Math.max(activeSeeds[edge.faces[1]], strength);
  }
  const activeMarginStrength = diffuseCanonicalField(
    activeSeeds,
    adjacency,
    5,
    0.64,
    () => true,
  );
  return { sutureStrength, activeMarginStrength };
}

function surfaceGeology(
  isLand: boolean,
  point: Vec3,
  elevationAboveSeaKm: number,
  canonicalFaceId: number,
  world: TectonicWorldModel,
  sutureStrength: number,
  activeMarginStrength: number,
  seed: number,
): { readonly lithology: SurfaceLithology; readonly erosionResistance: number } {
  if (!isLand) return { lithology: "oceanic-basalt", erosionResistance: 0.78 };
  const canonical = world.cells[canonicalFaceId];
  const continentalFraction = clamp(canonical.continentalFraction
    ?? (canonical.crustType === "continental" ? 1 : 0));
  const province = seedHash(`${seed}:lithology:${canonical.provenanceId}`) / 0x1_0000_0000;
  const local = sphericalNoise(point, seed + canonical.provenanceId * 31 + 4_099);
  const carbonateSignal = province * 0.38 + (local * 0.5 + 0.5) * 0.62;
  const warmLatitude = Math.abs(point[2]) < 0.72;
  let lithology: SurfaceLithology;
  let baseResistance: number;
  if (sutureStrength > 0.34 || (elevationAboveSeaKm > 2.4 && continentalFraction > 0.55)) {
    lithology = "metamorphic";
    baseResistance = 0.86;
  } else if (canonical.crustAgeMyr < 320
    || (activeMarginStrength > 0.68 && elevationAboveSeaKm > 0.35)) {
    lithology = "volcanic";
    baseResistance = 0.66;
  } else if (elevationAboveSeaKm < 0.38
    && warmLatitude
    && carbonateSignal > 0.68
    && activeMarginStrength < 0.42) {
    lithology = "carbonate";
    baseResistance = 0.46;
  } else if (elevationAboveSeaKm < 0.62
    && (elevationAboveSeaKm < 0.24 || local < 0.28)
    && sutureStrength < 0.24
    && activeMarginStrength < 0.48) {
    lithology = "sedimentary";
    baseResistance = 0.31;
  } else {
    lithology = "crystalline";
    baseResistance = 0.77;
  }
  return {
    lithology,
    erosionResistance: clamp(baseResistance + local * 0.055, 0.18, 0.94),
  };
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

function nearestFaces(
  root: KdNode,
  centers: readonly Vec3[],
  point: Vec3,
  count: number,
): readonly number[] {
  const best: { faceId: number; distance: number }[] = [];
  let worstDistance = Infinity;
  const updateWorst = (): void => {
    worstDistance = best.length < count
      ? Infinity
      : best.reduce((worst, candidate) => Math.max(worst, candidate.distance), 0);
  };
  const visit = (node: KdNode | null): void => {
    if (!node) return;
    const center = centers[node.faceId];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (best.length < count) {
      best.push({ faceId: node.faceId, distance });
      updateWorst();
    } else if (distance < worstDistance) {
      let worstIndex = 0;
      for (let index = 1; index < best.length; index += 1) {
        if (best[index].distance > best[worstIndex].distance) worstIndex = index;
      }
      best[worstIndex] = { faceId: node.faceId, distance };
      updateWorst();
    }
    const delta = point[node.axis] - center[node.axis];
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta <= worstDistance) visit(delta < 0 ? node.right : node.left);
  };
  visit(root);
  return best
    .sort((a, b) => a.distance - b.distance || a.faceId - b.faceId)
    .map((candidate) => candidate.faceId);
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

function prevailingWindAt(point: Vec3): Vec3 {
  const latitude = Math.asin(clamp(point[2], -1, 1));
  const absoluteLatitude = Math.abs(latitude);
  const horizontal = Math.hypot(point[0], point[1]);
  const east: Vec3 = horizontal > 1e-8
    ? [-point[1] / horizontal, point[0] / horizontal, 0]
    : [0, 1, 0];
  const north: Vec3 = horizontal > 1e-8
    ? normalize3([
      -point[0] * point[2],
      -point[1] * point[2],
      horizontal * horizontal,
    ])
    : [1, 0, 0];
  const trades = Math.exp(-((absoluteLatitude / 0.43) ** 4));
  const westerlies = Math.exp(-(((absoluteLatitude - 0.82) / 0.28) ** 2));
  const polarEasterlies = Math.exp(-(((absoluteLatitude - 1.37) / 0.22) ** 2));
  const hemisphere = latitude >= 0 ? 1 : -1;
  const zonal = -trades + westerlies * 1.12 - polarEasterlies * 0.72;
  const meridional = hemisphere * (-trades * 0.3 + westerlies * 0.16 - polarEasterlies * 0.1);
  return normalize3([
    east[0] * zonal + north[0] * meridional,
    east[1] * zonal + north[1] * meridional,
    east[2] * zonal + north[2] * meridional,
  ]);
}

function createUpwindTransport(
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
): readonly (readonly { readonly faceId: number; readonly weight: number }[])[] {
  return sphere.faces.map((face) => {
    const wind = prevailingWindAt(face.center);
    const candidates = adjacency[face.id].map((neighborId) => {
      const neighbor = sphere.faces[neighborId].center;
      const cosine = clamp(dot3(face.center, neighbor), -1, 1);
      const incoming: Vec3 = normalize3([
        face.center[0] * cosine - neighbor[0],
        face.center[1] * cosine - neighbor[1],
        face.center[2] * cosine - neighbor[2],
      ]);
      const alignment = Math.max(0, dot3(incoming, wind));
      return { faceId: neighborId, weight: alignment ** 3.5 };
    });
    let total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (total < 1e-9) {
      total = candidates.length;
      return candidates.map((candidate) => ({ faceId: candidate.faceId, weight: 1 / total }));
    }
    const retained = candidates.filter((candidate) => candidate.weight > total * 0.015);
    const retainedTotal = retained.reduce((sum, candidate) => sum + candidate.weight, 0);
    return retained.map((candidate) => ({
      faceId: candidate.faceId,
      weight: candidate.weight / retainedTotal,
    }));
  });
}

function simulateSurfaceClimate(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  seaLevelKm: number,
  radiusKm: number,
  seed: number,
): SurfaceClimateStats {
  const upwind = createUpwindTransport(sphere, adjacency);
  const elevationAboveSea = Float64Array.from(cells.map((cell) => (
    cell.isLand ? Math.max(0, cell.elevationKm - seaLevelKm) : 0
  )));
  const humidity = new Float64Array(cells.length);
  const saturation = new Float64Array(cells.length);
  const equatorialConvection = new Float64Array(cells.length);
  const stormTrack = new Float64Array(cells.length);
  const subtropicalSubsidence = new Float64Array(cells.length);
  const orographicLift = new Float64Array(cells.length);
  for (const cell of cells) {
    const latitude = Math.asin(clamp(sphere.faces[cell.faceId].center[2], -1, 1));
    const absoluteLatitude = Math.abs(latitude);
    const temperatureNoise = sphericalNoise(sphere.faces[cell.faceId].center, seed + 12_421) * 1.45;
    cell.temperatureC = 29.5
      - Math.abs(latitude) / (Math.PI / 2) * 51.5
      - elevationAboveSea[cell.faceId] * 6.05
      + temperatureNoise;
    saturation[cell.faceId] = clamp(0.62 + cell.temperatureC * 0.011, 0.34, 0.96);
    humidity[cell.faceId] = cell.isLand ? saturation[cell.faceId] * 0.18 : saturation[cell.faceId];
    equatorialConvection[cell.faceId] = Math.exp(-((absoluteLatitude / 0.3) ** 2));
    stormTrack[cell.faceId] = Math.exp(-(((absoluteLatitude - 0.92) / 0.24) ** 2));
    subtropicalSubsidence[cell.faceId] = Math.exp(-(((absoluteLatitude - 0.5) / 0.16) ** 2));
  }
  for (const cell of cells) {
    let incomingElevation = 0;
    for (const input of upwind[cell.faceId]) {
      incomingElevation += elevationAboveSea[input.faceId] * input.weight;
    }
    orographicLift[cell.faceId] = cell.isLand
      ? Math.max(0, elevationAboveSea[cell.faceId] - incomingElevation)
      : 0;
  }

  const transportPasses = 36;
  for (let pass = 0; pass < transportPasses; pass += 1) {
    const next = new Float64Array(cells.length);
    for (const cell of cells) {
      const inputs = upwind[cell.faceId];
      let incomingMoisture = 0;
      for (const input of inputs) {
        incomingMoisture += humidity[input.faceId] * input.weight;
      }
      const lift = orographicLift[cell.faceId];
      const precipitationLoss = clamp(
        0.01
          + equatorialConvection[cell.faceId] * 0.055
          + stormTrack[cell.faceId] * 0.04
          + lift * 0.12,
        0.008,
        0.46,
      );
      if (!cell.isLand) {
        next[cell.faceId] = incomingMoisture * 0.22 + saturation[cell.faceId] * 0.78;
      } else {
        const warmRecycle = clamp((cell.temperatureC + 8) / 38, 0, 1) * 0.022;
        next[cell.faceId] = clamp(incomingMoisture * (1 - precipitationLoss) + warmRecycle, 0.008, 0.98);
      }
    }
    humidity.set(next);
  }

  let landArea = 0;
  let temperatureAreaSum = 0;
  let precipitationAreaSum = 0;
  let aridArea = 0;
  let humidArea = 0;
  let maximumOrographicLiftKm = 0;
  const radiusSquared = radiusKm ** 2;
  for (const cell of cells) {
    const inputs = upwind[cell.faceId];
    let incomingMoisture = 0;
    for (const input of inputs) {
      incomingMoisture += humidity[input.faceId] * input.weight;
    }
    const point = sphere.faces[cell.faceId].center;
    const lift = orographicLift[cell.faceId];
    const texture = clamp(0.9 + sphericalNoise(point, seed + 911) * 0.12, 0.72, 1.18);
    const precipitation = clamp(
      (0.1 + incomingMoisture * (
        0.92
        + equatorialConvection[cell.faceId] * 1.8
        + stormTrack[cell.faceId]
        + lift * 2
        - subtropicalSubsidence[cell.faceId] * 0.22
      )) * texture,
      0.045,
      4.8,
    );
    cell.atmosphericMoisture = humidity[cell.faceId];
    cell.orographicLiftKm = lift;
    cell.precipitationMPerYear = precipitation;
    maximumOrographicLiftKm = Math.max(maximumOrographicLiftKm, lift);
    const areaKm2 = sphere.faces[cell.faceId].areaSteradians * radiusSquared;
    const frozenFraction = clamp((-cell.temperatureC + 2) / 22, 0, 0.72);
    const mountainEnvelope = clamp((elevationAboveSea[cell.faceId] - 0.25) / 4.5);
    const runoffCoefficient = clamp(
      0.34 + precipitation * 0.14 + mountainEnvelope * 0.18 - frozenFraction * 0.12,
      0.2,
      0.84,
    );
    cell.localRunoffKm3PerYear = cell.isLand
      ? precipitation * areaKm2 / 1000 * runoffCoefficient
      : 0;
    if (!cell.isLand) continue;
    const area = sphere.faces[cell.faceId].areaSteradians;
    landArea += area;
    temperatureAreaSum += cell.temperatureC * area;
    precipitationAreaSum += precipitation * area;
    if (precipitation < 0.42) aridArea += area;
    if (precipitation > 1.55) humidArea += area;
  }
  return {
    meanLandTemperatureC: temperatureAreaSum / Math.max(landArea, Number.EPSILON),
    meanLandPrecipitationMPerYear: precipitationAreaSum / Math.max(landArea, Number.EPSILON),
    aridLandFraction: aridArea / Math.max(landArea, Number.EPSILON),
    humidLandFraction: humidArea / Math.max(landArea, Number.EPSILON),
    maximumOrographicLiftKm,
  };
}

function routeSurfaceHydrology(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  radiusKm: number,
): DrainageResult {
  const radiusSquared = radiusKm ** 2;
  const heap = new ElevationHeap();
  const visited = new Uint8Array(cells.length);
  let floodOrder = 0;
  for (const cell of cells) {
    cell.filledElevationKm = cell.elevationKm;
    cell.fillDepthKm = 0;
    cell.receiverFaceId = null;
    cell.drainageAreaKm2 = cell.isLand ? sphere.faces[cell.faceId].areaSteradians * radiusSquared : 0;
    cell.dischargeKm3PerYear = cell.localRunoffKm3PerYear;
    cell.floodOrder = -1;
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

  const downstreamOrder = cells
    .filter((cell) => cell.isLand)
    .sort((a, b) => b.floodOrder - a.floodOrder || b.faceId - a.faceId);
  let outletRunoffKm3PerYear = 0;
  for (const cell of downstreamOrder) {
    if (cell.receiverFaceId === null) throw new Error(`land face ${cell.faceId} has no hydrologic receiver`);
    const receiver = cells[cell.receiverFaceId];
    if (receiver.isLand) {
      receiver.drainageAreaKm2 += cell.drainageAreaKm2;
      receiver.dischargeKm3PerYear += cell.dischargeKm3PerYear;
    } else {
      outletRunoffKm3PerYear += cell.dischargeKm3PerYear;
    }
  }
  return { downstreamOrder, outletRunoffKm3PerYear };
}

function erodeAndRouteSediment(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  drainage: DrainageResult,
  seaLevelKm: number,
  radiusKm: number,
  erosionStrengthKm: number,
  minimumErosionAreaKm2: number,
): SedimentBudget {
  const sedimentFluxKm3 = new Float64Array(cells.length);
  const erodedThicknessKm = new Float64Array(cells.length);
  const depositedThicknessKm = new Float64Array(cells.length);
  const maximumDischarge = cells.reduce((maximum, cell) => Math.max(maximum, cell.dischargeKm3PerYear), 0);
  let erodedVolumeKm3 = 0;
  let depositedVolumeKm3 = 0;
  let exportedSedimentVolumeKm3 = 0;
  const erodedVolumeByLithologyKm3 = emptyLithologyRecord();

  for (const cell of drainage.downstreamOrder) {
    if (cell.receiverFaceId === null) continue;
    const receiver = cells[cell.receiverFaceId];
    const center = sphere.faces[cell.faceId].center;
    const receiverCenter = sphere.faces[receiver.faceId].center;
    const distanceKm = Math.max(1, Math.acos(clamp(dot3(center, receiverCenter), -1, 1)) * radiusKm);
    const dropKm = Math.max(0, cell.filledElevationKm - receiver.filledElevationKm);
    const slope = dropKm / distanceKm;
    const areaKm2 = sphere.faces[cell.faceId].areaSteradians * radiusKm ** 2;
    const resolvedChannel = cell.drainageAreaKm2 >= minimumErosionAreaKm2;
    const flowFactor = clamp(
      Math.log1p(cell.drainageAreaKm2 / minimumErosionAreaKm2) / Math.log(48),
      0,
      1,
    );
    const dischargeFactor = maximumDischarge > 0
      ? clamp((cell.dischargeKm3PerYear / maximumDischarge) ** 0.32, 0, 1)
      : 0;
    const slopeFactor = Math.sqrt(clamp(slope / 0.0075, 0, 1));
    const availableRelief = Math.max(0, cell.elevationKm - seaLevelKm - 0.004);
    const erodibility = 0.48 + (1 - cell.erosionResistance) * 1.18;
    const incisionKm = resolvedChannel
      ? Math.min(
        availableRelief,
        erosionStrengthKm
          * (0.22 + flowFactor * 0.5 + dischargeFactor * 0.28)
          * slopeFactor
          * erodibility,
      )
      : 0;
    const erodedKm3 = incisionKm * areaKm2;
    erodedThicknessKm[cell.faceId] = incisionKm;
    erodedVolumeKm3 += erodedKm3;
    erodedVolumeByLithologyKm3[cell.lithology] += erodedKm3;
    let availableSedimentKm3 = sedimentFluxKm3[cell.faceId] + erodedKm3;

    const lowGradient = 1 - clamp(slope / 0.0022, 0, 1);
    const terminalFraction = receiver.isLand ? 0 : 0.24;
    const depositionFraction = clamp(0.018 + lowGradient * 0.11 + terminalFraction, 0, 0.36);
    const maximumDepositKm3 = areaKm2 * 0.055;
    const depositedKm3 = Math.min(availableSedimentKm3 * depositionFraction, maximumDepositKm3);
    availableSedimentKm3 -= depositedKm3;
    depositedThicknessKm[cell.faceId] = depositedKm3 / areaKm2;
    depositedVolumeKm3 += depositedKm3;
    if (receiver.isLand) sedimentFluxKm3[receiver.faceId] += availableSedimentKm3;
    else exportedSedimentVolumeKm3 += availableSedimentKm3;
  }

  let incisedCellCount = 0;
  let depositionalCellCount = 0;
  for (const cell of cells) {
    const erosion = erodedThicknessKm[cell.faceId];
    const deposition = depositedThicknessKm[cell.faceId];
    if (erosion > 0) incisedCellCount += 1;
    if (deposition > 0) depositionalCellCount += 1;
    cell.erodedThicknessKm += erosion;
    cell.depositedThicknessKm += deposition;
    if (!cell.isLand) continue;
    cell.elevationKm = Math.max(seaLevelKm + 0.002, cell.elevationKm - erosion + deposition);
  }
  return {
    erodedVolumeKm3,
    depositedVolumeKm3,
    exportedSedimentVolumeKm3,
    sedimentResidualKm3: erodedVolumeKm3 - depositedVolumeKm3 - exportedSedimentVolumeKm3,
    incisedCellCount,
    depositionalCellCount,
    erodedVolumeByLithologyKm3,
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
    coastOctaves: options.coastOctaves ?? 5,
    reliefPasses: 2,
  });
  const refinementAudit = refinement.audit();
  if (!refinementAudit.topologyAnchorsPreserved) {
    throw new Error("surface process refinement changed a canonical topology anchor");
  }
  const reliefAmplitudeKm = clamp(options.reliefAmplitudeKm ?? 0.34, 0, 1.25);
  const hashedSeed = seedHash(tectonicWorld.recipe.seed);
  const geologyContext = canonicalGeologyContext(tectonicWorld);
  const presentationDetailBands = createPresentationDetailBands(hashedSeed);
  const radiusSquared = tectonicWorld.recipe.radiusKm ** 2;
  const cells: MutableSurfaceCell[] = sphere.faces.map((face) => {
    const refined = refinement.sample(face.center);
    const canonicalFaceId = Math.floor(face.id / 4 ** detailLevels);
    const canonical = tectonicWorld.cells[canonicalFaceId];
    const aboveSea = refined.elevationKm - tectonicWorld.seaLevelKm;
    const mountainEnvelope = clamp((aboveSea - 0.25) / 4.5);
    const continentalEnvelope = clamp(canonical.continentalFraction
      ?? (canonical.crustType === "continental" ? 1 : 0));
    const geology = surfaceGeology(
      refined.isLand,
      face.center,
      aboveSea,
      canonicalFaceId,
      tectonicWorld,
      geologyContext.sutureStrength[canonicalFaceId],
      geologyContext.activeMarginStrength[canonicalFaceId],
      hashedSeed,
    );
    const noise = sphericalNoise(face.center, hashedSeed);
    const ridge = 1 - Math.abs(sphericalNoise(face.center, hashedSeed + 337));
    const detail = refined.isLand
      ? (noise * 0.48 + (ridge - 0.5) * (0.28 + mountainEnvelope * 0.72))
        * reliefAmplitudeKm
        * (0.35 + continentalEnvelope * 0.25 + mountainEnvelope * 0.9)
        * (0.72 + geology.erosionResistance * 0.42)
      : noise * reliefAmplitudeKm * 0.16;
    const elevationKm = refined.isLand
      ? Math.max(tectonicWorld.seaLevelKm + 0.002, refined.elevationKm + detail)
      : Math.min(tectonicWorld.seaLevelKm - 0.002, refined.elevationKm + detail);
    const areaKm2 = face.areaSteradians * radiusSquared;
    return {
      faceId: face.id,
      canonicalFaceId,
      isLand: refined.isLand,
      elevationKm,
      coastDistanceKm: refined.isLand ? 0 : Infinity,
      filledElevationKm: elevationKm,
      fillDepthKm: 0,
      temperatureC: 0,
      precipitationMPerYear: 0,
      atmosphericMoisture: 0,
      orographicLiftKm: 0,
      lithology: geology.lithology,
      erosionResistance: geology.erosionResistance,
      localRunoffKm3PerYear: 0,
      erodedThicknessKm: 0,
      depositedThicknessKm: 0,
      receiverFaceId: null,
      drainageAreaKm2: refined.isLand ? areaKm2 : 0,
      dischargeKm3PerYear: 0,
      floodOrder: -1,
    };
  });

  const climateStats = simulateSurfaceClimate(
    cells,
    sphere,
    adjacency,
    tectonicWorld.seaLevelKm,
    tectonicWorld.recipe.radiusKm,
    hashedSeed,
  );

  const initialDrainage = routeSurfaceHydrology(
    cells,
    sphere,
    adjacency,
    tectonicWorld.recipe.radiusKm,
  );
  const totalSurfaceAreaKm2 = sphere.totalAreaSteradians * radiusSquared;
  const erosionStrengthKm = clamp(options.erosionStrengthKm ?? 0.2, 0, 0.6);
  const minimumErosionAreaKm2 = options.minimumErosionAreaKm2
    ?? Math.max(180_000, totalSurfaceAreaKm2 / 2_500);
  const sedimentBudget = erodeAndRouteSediment(
    cells,
    sphere,
    initialDrainage,
    tectonicWorld.seaLevelKm,
    tectonicWorld.recipe.radiusKm,
    erosionStrengthKm,
    minimumErosionAreaKm2,
  );
  const finalDrainage = routeSurfaceHydrology(
    cells,
    sphere,
    adjacency,
    tectonicWorld.recipe.radiusKm,
  );

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
    atmosphericMoisture: cell.atmosphericMoisture,
    orographicLiftKm: cell.orographicLiftKm,
    lithology: cell.lithology,
    erosionResistance: cell.erosionResistance,
    localRunoffKm3PerYear: cell.localRunoffKm3PerYear,
    erodedThicknessKm: cell.erodedThicknessKm,
    depositedThicknessKm: cell.depositedThicknessKm,
    receiverFaceId: cell.receiverFaceId,
    drainageAreaKm2: cell.drainageAreaKm2,
    dischargeKm3PerYear: cell.dischargeKm3PerYear,
  }));
  const centers = sphere.faces.map((face) => face.center);
  const root = buildKdTree(sphere.faces.map((face) => face.id), centers);
  if (!root) throw new Error("surface process grid must contain faces");
  const presentationSampleCount = Math.round(clamp(options.presentationSampleCount ?? 12, 6, 24));
  const presentationCandidateCount = presentationSampleCount * 4;
  const characteristicRadians = Math.sqrt(sphere.totalAreaSteradians / sphere.faces.length);
  const kernelSharpness = 1.7 / characteristicRadians ** 2;
  const sampleContinuous = (direction: Vec3): SurfacePresentationSample => {
    const point = normalize3(direction);
    const refined = refinement.sample(point);
    const candidateIds = nearestFaces(root, centers, point, presentationCandidateCount);
    const candidates = candidateIds
      .filter((faceId) => immutableCells[faceId].isLand === refined.isLand)
      .slice(0, presentationSampleCount);
    const fallbackId = exactFaceAtPoint(sphere, root, centers, adjacency, point);
    if (candidates.length === 0) candidates.push(fallbackId);
    let totalWeight = 0;
    let elevationKm = 0;
    let coastDistanceKm = 0;
    let temperatureC = 0;
    let precipitationMPerYear = 0;
    let atmosphericMoisture = 0;
    let orographicLiftKm = 0;
    let erosionResistance = 0;
    for (const faceId of candidates) {
      const weight = Math.exp((dot3(centers[faceId], point) - 1) * kernelSharpness);
      const cell = immutableCells[faceId];
      totalWeight += weight;
      elevationKm += cell.elevationKm * weight;
      coastDistanceKm += (Number.isFinite(cell.coastDistanceKm) ? cell.coastDistanceKm : 0) * weight;
      temperatureC += cell.temperatureC * weight;
      precipitationMPerYear += cell.precipitationMPerYear * weight;
      atmosphericMoisture += cell.atmosphericMoisture * weight;
      orographicLiftKm += cell.orographicLiftKm * weight;
      erosionResistance += cell.erosionResistance * weight;
    }
    elevationKm /= totalWeight;
    coastDistanceKm /= totalWeight;
    temperatureC /= totalWeight;
    precipitationMPerYear /= totalWeight;
    atmosphericMoisture /= totalWeight;
    orographicLiftKm /= totalWeight;
    erosionResistance /= totalWeight;
    const gradient: [number, number, number] = [0, 0, 0];
    for (const faceId of candidates) {
      const center = centers[faceId];
      const cosine = clamp(dot3(center, point), -1, 1);
      const distanceRadians = Math.acos(cosine);
      if (distanceRadians < 1e-8) continue;
      const tangentVector: Vec3 = [
        center[0] - point[0] * cosine,
        center[1] - point[1] * cosine,
        center[2] - point[2] * cosine,
      ];
      if (dot3(tangentVector, tangentVector) < 1e-18) continue;
      const tangent = normalize3(tangentVector);
      const weight = Math.exp((cosine - 1) * kernelSharpness);
      const riseOverRun = (immutableCells[faceId].elevationKm - elevationKm)
        / (distanceRadians * tectonicWorld.recipe.radiusKm);
      gradient[0] += tangent[0] * riseOverRun * weight;
      gradient[1] += tangent[1] * riseOverRun * weight;
      gradient[2] += tangent[2] * riseOverRun * weight;
    }
    gradient[0] /= totalWeight;
    gradient[1] /= totalWeight;
    gradient[2] /= totalWeight;
    const surfaceTexture = samplePresentationDetail(point, presentationDetailBands);
    const elevationAboveSeaKm = elevationKm - tectonicWorld.seaLevelKm;
    const detailAmplitudeKm = reliefAmplitudeKm * (refined.isLand
      ? (0.055 + clamp(elevationAboveSeaKm / 5, 0, 1) * 0.075)
        * (0.72 + erosionResistance * 0.42)
      : 0.018);
    const fineRelief = surfaceTexture * detailAmplitudeKm;
    // Keep analytical lighting on the resolved process relief. The finer
    // bands remain in elevation/albedo, but shading them directly at world
    // scale creates directional aliasing before a tiled normal map exists.
    elevationKm = refined.isLand
      ? Math.max(tectonicWorld.seaLevelKm + 0.001, elevationKm + fineRelief)
      : Math.min(tectonicWorld.seaLevelKm - 0.001, elevationKm + fineRelief);
    const nearestMatchingId = candidates[0];
    return {
      faceId: nearestMatchingId,
      canonicalFaceId: immutableCells[nearestMatchingId].canonicalFaceId,
      isLand: refined.isLand,
      elevationKm,
      coastDistanceKm: refined.isLand ? 0 : coastDistanceKm,
      temperatureC,
      precipitationMPerYear,
      atmosphericMoisture,
      orographicLiftKm,
      prevailingWind: prevailingWindAt(point),
      lithology: immutableCells[nearestMatchingId].lithology,
      erosionResistance,
      surfaceTexture,
      terrainGradient: gradient,
      presentationOnly: true,
    };
  };
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
      totalOutletRunoffKm3PerYear: finalDrainage.outletRunoffKm3PerYear,
      runoffResidualKm3PerYear: totalRunoff - finalDrainage.outletRunoffKm3PerYear,
      maximumFillDepthKm: cells.reduce((maximum, cell) => Math.max(maximum, cell.fillDepthKm), 0),
      canonicalAnchorMismatches: refinementAudit.canonicalAnchorMismatches,
      meanLandErosionResistance: cells.reduce(
        (sum, cell) => sum + (cell.isLand
          ? cell.erosionResistance * sphere.faces[cell.faceId].areaSteradians
          : 0),
        0,
      ) / Math.max(landArea, Number.EPSILON),
      lithologyAreaKm2: cells.reduce((areas, cell) => {
        areas[cell.lithology] += sphere.faces[cell.faceId].areaSteradians * radiusSquared;
        return areas;
      }, emptyLithologyRecord()),
      ...climateStats,
      ...sedimentBudget,
    },
    sample: (direction) => immutableCells[exactFaceAtPoint(sphere, root, centers, adjacency, direction)],
    sampleContinuous,
  };
}
