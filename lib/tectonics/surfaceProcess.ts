import { createGeodesicSphere, type GeodesicSphere } from "./geodesic.ts";
import {
  createCanonicalOrogeny,
  type CanonicalOrogenyCell,
  type OrogenRegime,
} from "./orogeny.ts";
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
  /** Multiplier on the reduced open-water potential-evaporation estimate. */
  readonly openWaterEvaporationScale?: number;
  /** Depression evolution applied before the final erosion and lake passes. */
  readonly depressionEvolution?: "hybrid" | "fill-only";
  /** Multiplier on discharge-driven spillway incision. */
  readonly spillwayErosionScale?: number;
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

export type SurfaceBiome =
  | "open-ocean"
  | "shelf-sea"
  | "sea-ice"
  | "freshwater-lake"
  | "ice-cap"
  | "alpine"
  | "tundra"
  | "boreal-forest"
  | "cold-steppe"
  | "desert"
  | "temperate-grassland"
  | "temperate-forest"
  | "temperate-rainforest"
  | "savanna"
  | "tropical-seasonal-forest"
  | "tropical-rainforest";

const SURFACE_BIOMES: readonly SurfaceBiome[] = [
  "open-ocean",
  "shelf-sea",
  "sea-ice",
  "freshwater-lake",
  "ice-cap",
  "alpine",
  "tundra",
  "boreal-forest",
  "cold-steppe",
  "desert",
  "temperate-grassland",
  "temperate-forest",
  "temperate-rainforest",
  "savanna",
  "tropical-seasonal-forest",
  "tropical-rainforest",
];

export interface SurfaceProcessCell {
  readonly faceId: number;
  readonly canonicalFaceId: number;
  readonly isLand: boolean;
  readonly elevationKm: number;
  /** Shortest same-medium surface distance to the canonical coast. */
  readonly coastDistanceKm: number;
  readonly filledElevationKm: number;
  readonly fillDepthKm: number;
  readonly temperatureC: number;
  /** Difference between the reduced warmest- and coldest-month temperatures. */
  readonly seasonalTemperatureRangeC: number;
  /** Maritime-to-continental interior index in [0, 1]. */
  readonly continentality: number;
  readonly precipitationMPerYear: number;
  /** Annual precipitation divided by a reduced potential-evapotranspiration threshold. */
  readonly aridityIndex: number;
  readonly biome: SurfaceBiome;
  /** A derived inland-water cover; canonical crust remains land. */
  readonly isLake: boolean;
  readonly lakeDepthKm: number;
  /** Solved annual-equilibrium depression depth at the lake shoreline. */
  readonly lakeSurfaceDepthThresholdKm: number;
  /** Advected atmospheric moisture after local precipitation loss, in [0, 1]. */
  readonly atmosphericMoisture: number;
  /** Positive upwind terrain rise used by the reduced orographic model. */
  readonly orographicLiftKm: number;
  readonly lithology: SurfaceLithology;
  /** Dimensionless resistance to fluvial and diffusive erosion, in [0, 1]. */
  readonly erosionResistance: number;
  /** Dominant tectonic origin of resolved mountain relief. */
  readonly orogeny: OrogenRegime;
  /** Combined narrow-core and broad-foothill support in [0, 1]. */
  readonly orogenStrength: number;
  readonly localRunoffKm3PerYear: number;
  readonly erodedThicknessKm: number;
  readonly depositedThicknessKm: number;
  /** Terrain removed by the bounded geomorphic spillway pass. */
  readonly spillwayIncisionKm: number;
  readonly receiverFaceId: number | null;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export interface SurfaceRiverSegment {
  readonly fromFaceId: number;
  readonly toFaceId: number;
  /** Renderer-only shared node inside the source process cell. */
  readonly fromPoint: Vec3;
  /** Renderer-only shared node inside the receiver process cell. */
  readonly toPoint: Vec3;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export interface SurfaceRiverMouth {
  readonly fromFaceId: number;
  readonly toFaceId: number;
  readonly point: Vec3;
  readonly receivingWater: "ocean" | "lake";
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export interface SurfacePresentationSample {
  /** Nearest process cell; retained for diagnostics and river lookup only. */
  readonly faceId: number;
  readonly canonicalFaceId: number;
  readonly isLand: boolean;
  readonly elevationKm: number;
  readonly fillDepthKm: number;
  readonly spillwayIncisionKm: number;
  readonly coastDistanceKm: number;
  readonly temperatureC: number;
  readonly seasonalTemperatureRangeC: number;
  readonly continentality: number;
  readonly precipitationMPerYear: number;
  readonly aridityIndex: number;
  readonly biome: SurfaceBiome;
  readonly isLake: boolean;
  /** Smooth presentation coverage derived from canonical lake cells. */
  readonly lakeCoverage: number;
  readonly lakeDepthKm: number;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
  readonly atmosphericMoisture: number;
  readonly orographicLiftKm: number;
  /** Unit tangent vector of the reduced annual prevailing wind field. */
  readonly prevailingWind: Vec3;
  readonly lithology: SurfaceLithology;
  readonly erosionResistance: number;
  readonly orogeny: OrogenRegime;
  readonly orogenStrength: number;
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
  readonly lakeCellCount: number;
  readonly lakeAreaKm2: number;
  readonly lakeBodyCount: number;
  readonly closedLakeBodyCount: number;
  readonly overflowingLakeBodyCount: number;
  readonly lakeEvaporationKm3PerYear: number;
  readonly riverSegmentCount: number;
  readonly riverMouthCount: number;
  readonly oceanRiverMouthCount: number;
  readonly lakeInflowCount: number;
  readonly maximumDrainageAreaKm2: number;
  readonly maximumDischargeKm3PerYear: number;
  readonly totalLocalRunoffKm3PerYear: number;
  readonly totalOutletRunoffKm3PerYear: number;
  readonly runoffResidualKm3PerYear: number;
  readonly maximumFillDepthKm: number;
  readonly breachedBasinCount: number;
  readonly preservedBasinCount: number;
  readonly spillwayCellCount: number;
  readonly spillwayExcavatedVolumeKm3: number;
  readonly maximumSpillwayIncisionKm: number;
  readonly canonicalAnchorMismatches: number;
  /** Stable process-grid level that owns continental drainage divides. */
  readonly drainageAnchorSubdivisions: number;
  /** Fine cross-parent receivers that disagree with the anchor basin graph. */
  readonly drainageAnchorMismatches: number;
  readonly erodedVolumeKm3: number;
  readonly depositedVolumeKm3: number;
  readonly exportedSedimentVolumeKm3: number;
  readonly sedimentResidualKm3: number;
  readonly incisedCellCount: number;
  readonly depositionalCellCount: number;
  readonly meanLandErosionResistance: number;
  readonly lithologyAreaKm2: Readonly<Record<SurfaceLithology, number>>;
  readonly biomeAreaKm2: Readonly<Record<SurfaceBiome, number>>;
  readonly erodedVolumeByLithologyKm3: Readonly<Record<SurfaceLithology, number>>;
  readonly meanLandTemperatureC: number;
  readonly meanLandSeasonalTemperatureRangeC: number;
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
  readonly riverMouths: readonly SurfaceRiverMouth[];
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
  spillwayIncisionKm: number;
  temperatureC: number;
  seasonalTemperatureRangeC: number;
  continentality: number;
  precipitationMPerYear: number;
  aridityIndex: number;
  biome: SurfaceBiome;
  isLake: boolean;
  lakeDepthKm: number;
  lakeSurfaceDepthThresholdKm: number;
  atmosphericMoisture: number;
  orographicLiftKm: number;
  localRunoffKm3PerYear: number;
  floodOrder: number;
}

interface SurfaceClimateStats {
  readonly meanLandTemperatureC: number;
  readonly meanLandSeasonalTemperatureRangeC: number;
  readonly meanLandPrecipitationMPerYear: number;
  readonly aridLandFraction: number;
  readonly humidLandFraction: number;
  readonly maximumOrographicLiftKm: number;
}

interface DrainageResult {
  readonly downstreamOrder: readonly MutableSurfaceCell[];
  readonly outletRunoffKm3PerYear: number;
  readonly anchorMismatches: number;
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

interface LakeBalanceResult {
  readonly presentationDepthThresholdKm: Float64Array;
  readonly evaporationSinkKm3PerYear: Float64Array;
  readonly lakeBodyCount: number;
  readonly closedLakeBodyCount: number;
  readonly overflowingLakeBodyCount: number;
  readonly overflowOutletFaceIds: ReadonlySet<number>;
}

interface BalancedRunoffResult {
  readonly outletRunoffKm3PerYear: number;
  readonly lakeEvaporationKm3PerYear: number;
}

interface DepressionEvolutionResult {
  readonly breachedBasinCount: number;
  readonly preservedBasinCount: number;
  readonly spillwayCellCount: number;
  readonly spillwayExcavatedVolumeKm3: number;
  readonly maximumSpillwayIncisionKm: number;
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

function emptyBiomeRecord(): Record<SurfaceBiome, number> {
  return Object.fromEntries(
    SURFACE_BIOMES.map((biome) => [biome, 0]),
  ) as Record<SurfaceBiome, number>;
}

function classifySurfaceBiome(cell: MutableSurfaceCell, seaLevelKm: number): SurfaceBiome {
  if (!cell.isLand) {
    if (cell.temperatureC < -4) return "sea-ice";
    if (cell.coastDistanceKm < 320) return "shelf-sea";
    return "open-ocean";
  }
  if (cell.isLake) return "freshwater-lake";
  const elevationAboveSeaKm = Math.max(0, cell.elevationKm - seaLevelKm);
  if (cell.temperatureC < -12) return "ice-cap";
  if (elevationAboveSeaKm > 3.6 || (elevationAboveSeaKm > 2.5 && cell.temperatureC < 3)) return "alpine";
  if (cell.temperatureC < 0) return "tundra";
  if (cell.temperatureC < 6) return cell.aridityIndex > 0.82 ? "boreal-forest" : "cold-steppe";
  if (cell.aridityIndex < 0.5) return "desert";
  if (cell.temperatureC > 21) {
    if (cell.aridityIndex > 1.75) return "tropical-rainforest";
    if (cell.aridityIndex > 1.05) return "tropical-seasonal-forest";
    return "savanna";
  }
  if (cell.aridityIndex < 0.88) return "temperate-grassland";
  if (cell.precipitationMPerYear > 1.55 && cell.temperatureC < 15) return "temperate-rainforest";
  return "temperate-forest";
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
  readonly orogeny: readonly CanonicalOrogenyCell[];
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
  return { sutureStrength, activeMarginStrength, orogeny: createCanonicalOrogeny(world) };
}

function shapedOrogenicHeight(
  elevationAboveSeaKm: number,
  orogeny: CanonicalOrogenyCell,
  point: Vec3,
  seed: number,
): number {
  if (elevationAboveSeaKm <= 0) return elevationAboveSeaKm;
  const modulation = 0.88 + (sphericalNoise(point, seed + 8_903) * 0.5 + 0.5) * 0.18;
  const core = Math.max(
    orogeny.collisionCore,
    orogeny.subductionCore,
    orogeny.islandArcCore,
    orogeny.sutureCore * 0.72,
  );
  const support = clamp(core * 0.88 + orogeny.foothillStrength * 0.58);
  const broadExcess = Math.max(0, elevationAboveSeaKm - 1.15);
  let shaped = elevationAboveSeaKm - broadExcess * (1 - support) * 0.62;
  const collisionTarget = (0.72
    + orogeny.collisionCore ** 0.82 * 4.65
    + orogeny.foothillStrength * 0.9) * modulation;
  const subductionTarget = (0.68
    + orogeny.subductionCore ** 0.86 * 3.8
    + orogeny.foothillStrength * 0.76) * modulation;
  const islandArcTarget = (0.5
    + orogeny.islandArcCore ** 0.9 * 3.15
    + orogeny.foothillStrength * 0.42) * modulation;
  const sutureTarget = (0.62
    + orogeny.sutureCore ** 0.92 * 2.35
    + orogeny.foothillStrength * 0.62) * modulation;
  shaped = Math.max(
    shaped,
    collisionTarget * orogeny.collisionCore,
    subductionTarget * orogeny.subductionCore,
    islandArcTarget * orogeny.islandArcCore,
    sutureTarget * orogeny.sutureCore,
  );
  const supportedMaximum = 1.72
    + core * 4.35
    + orogeny.foothillStrength * 1.05
    + orogeny.sutureCore * 0.72;
  if (shaped > supportedMaximum) {
    shaped = supportedMaximum + (shaped - supportedMaximum) * 0.14;
  }
  return Math.max(0.002, shaped);
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
  radiusKm: number,
): readonly (readonly {
  readonly faceId: number;
  readonly weight: number;
  readonly distanceKm: number;
}[])[] {
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
      return {
        faceId: neighborId,
        weight: alignment ** 3.5,
        distanceKm: Math.acos(cosine) * radiusKm,
      };
    });
    let total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (total < 1e-9) {
      total = candidates.length;
      return candidates.map((candidate) => ({ ...candidate, weight: 1 / total }));
    }
    const retained = candidates.filter((candidate) => candidate.weight > total * 0.015);
    const retainedTotal = retained.reduce((sum, candidate) => sum + candidate.weight, 0);
    return retained.map((candidate) => ({
      ...candidate,
      weight: candidate.weight / retainedTotal,
    }));
  });
}

function computeCoastDistances(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  radiusKm: number,
): void {
  const coastHeap = new ElevationHeap();
  for (const cell of cells) {
    cell.coastDistanceKm = Infinity;
    if (!adjacency[cell.faceId].some((neighbor) => cells[neighbor].isLand !== cell.isLand)) continue;
    cell.coastDistanceKm = 0;
    coastHeap.push({ faceId: cell.faceId, priority: 0 });
  }
  for (let entry = coastHeap.pop(); entry; entry = coastHeap.pop()) {
    if (entry.priority > cells[entry.faceId].coastDistanceKm + 1e-9) continue;
    const cell = cells[entry.faceId];
    const center = sphere.faces[entry.faceId].center;
    for (const neighborId of adjacency[entry.faceId]) {
      const neighbor = cells[neighborId];
      if (neighbor.isLand !== cell.isLand) continue;
      const neighborCenter = sphere.faces[neighborId].center;
      const edgeKm = Math.acos(clamp(dot3(center, neighborCenter), -1, 1)) * radiusKm;
      const distance = entry.priority + edgeKm;
      if (distance >= neighbor.coastDistanceKm) continue;
      neighbor.coastDistanceKm = distance;
      coastHeap.push({ faceId: neighborId, priority: distance });
    }
  }
}

function simulateSurfaceClimate(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  seaLevelKm: number,
  radiusKm: number,
  seed: number,
): SurfaceClimateStats {
  const upwind = createUpwindTransport(sphere, adjacency, radiusKm);
  // One atmospheric iteration advances moisture by approximately one mesh
  // edge. Express loss, recharge, and iteration count in physical distance so
  // refining the icosphere does not shorten the effective fetch or dry out
  // continental interiors. Subdivision 6 on an Earth-radius sphere is close to
  // the 120 km reference step used to calibrate the reduced annual model.
  const referenceTransportStepKm = 120;
  const characteristicStepKm = sphere.edges.reduce(
    (sum, edge) => sum + edge.arcLengthRadians * radiusKm,
    0,
  ) / Math.max(1, sphere.edges.length);
  const distanceScale = characteristicStepKm / referenceTransportStepKm;
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
    const latitudeFraction = absoluteLatitude / (Math.PI / 2);
    const distanceToOceanKm = cell.isLand ? cell.coastDistanceKm : 0;
    cell.continentality = cell.isLand
      ? clamp(1 - Math.exp(-distanceToOceanKm / 850), 0, 1)
      : 0;
    cell.seasonalTemperatureRangeC = cell.isLand
      ? clamp(
        5
          + latitudeFraction ** 1.25 * 25
          + cell.continentality * (9 + latitudeFraction * 23),
        4,
        60,
      )
      : clamp(2.5 + latitudeFraction * 7, 2.5, 10);
    const temperatureNoise = sphericalNoise(sphere.faces[cell.faceId].center, seed + 12_421) * 1.45;
    cell.temperatureC = 29.5
      - latitudeFraction * 51.5
      - elevationAboveSea[cell.faceId] * 6.05
      - cell.continentality * latitudeFraction * 2.2
      + temperatureNoise;
    saturation[cell.faceId] = clamp(0.62 + cell.temperatureC * 0.011, 0.34, 0.96);
    humidity[cell.faceId] = cell.isLand ? saturation[cell.faceId] * 0.18 : saturation[cell.faceId];
    equatorialConvection[cell.faceId] = Math.exp(-((absoluteLatitude / 0.3) ** 2));
    stormTrack[cell.faceId] = Math.exp(-(((absoluteLatitude - 0.92) / 0.24) ** 2));
    subtropicalSubsidence[cell.faceId] = Math.exp(-(((absoluteLatitude - 0.5) / 0.16) ** 2));
  }
  for (const cell of cells) {
    let incomingElevation = 0;
    let incomingDistanceKm = 0;
    for (const input of upwind[cell.faceId]) {
      incomingElevation += elevationAboveSea[input.faceId] * input.weight;
      incomingDistanceKm += input.distanceKm * input.weight;
    }
    const rawLift = Math.max(0, elevationAboveSea[cell.faceId] - incomingElevation);
    orographicLift[cell.faceId] = cell.isLand
      ? Math.min(
        elevationAboveSea[cell.faceId],
        rawLift * referenceTransportStepKm / Math.max(1, incomingDistanceKm),
      )
      : 0;
  }

  const transportPasses = Math.max(12, Math.round(36 / Math.max(0.1, distanceScale)));
  for (let pass = 0; pass < transportPasses; pass += 1) {
    const next = new Float64Array(cells.length);
    for (const cell of cells) {
      const inputs = upwind[cell.faceId];
      let incomingMoisture = 0;
      for (const input of inputs) {
        incomingMoisture += humidity[input.faceId] * input.weight;
      }
      const lift = orographicLift[cell.faceId];
      const referencePrecipitationLoss = clamp(
        0.01
          + equatorialConvection[cell.faceId] * 0.055
          + stormTrack[cell.faceId] * 0.04
          + lift * 0.12,
        0.008,
        0.46,
      );
      const precipitationLoss = 1 - (1 - referencePrecipitationLoss) ** distanceScale;
      if (!cell.isLand) {
        const rechargeFraction = 1 - (1 - 0.78) ** distanceScale;
        next[cell.faceId] = incomingMoisture * (1 - rechargeFraction)
          + saturation[cell.faceId] * rechargeFraction;
      } else {
        const warmRecycle = clamp((cell.temperatureC + 8) / 38, 0, 1) * 0.022 * distanceScale;
        next[cell.faceId] = clamp(incomingMoisture * (1 - precipitationLoss) + warmRecycle, 0.008, 0.98);
      }
    }
    humidity.set(next);
  }

  let landArea = 0;
  let temperatureAreaSum = 0;
  let seasonalRangeAreaSum = 0;
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
    const potentialEvapotranspirationMPerYear = clamp(
      0.22 + Math.max(0, cell.temperatureC + 5) * 0.04,
      0.14,
      2.1,
    );
    cell.aridityIndex = clamp(precipitation / potentialEvapotranspirationMPerYear, 0, 3);
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
    seasonalRangeAreaSum += cell.seasonalTemperatureRangeC * area;
    precipitationAreaSum += precipitation * area;
    if (cell.aridityIndex < 0.75) aridArea += area;
    if (cell.aridityIndex > 1.4) humidArea += area;
  }
  return {
    meanLandTemperatureC: temperatureAreaSum / Math.max(landArea, Number.EPSILON),
    meanLandSeasonalTemperatureRangeC: seasonalRangeAreaSum / Math.max(landArea, Number.EPSILON),
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
  hierarchyAnchor?: SurfaceProcessWorld,
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
  let anchorMismatches = 0;
  const visitFrom = (neighborId: number, receiverId: number, receiverPriority: number): void => {
    const neighbor = cells[neighborId];
    visited[neighborId] = 1;
    neighbor.floodOrder = floodOrder;
    floodOrder += 1;
    neighbor.receiverFaceId = receiverId;
    neighbor.filledElevationKm = Math.max(neighbor.elevationKm, receiverPriority + epsilonKm);
    neighbor.fillDepthKm = Math.max(0, neighbor.filledElevationKm - neighbor.elevationKm);
  };

  if (!hierarchyAnchor || hierarchyAnchor.sphere.subdivisions >= sphere.subdivisions) {
    for (let entry = heap.pop(); entry; entry = heap.pop()) {
      for (const neighborId of adjacency[entry.faceId]) {
        if (visited[neighborId] !== 0) continue;
        visitFrom(neighborId, entry.faceId, entry.priority);
        heap.push({ faceId: neighborId, priority: cells[neighborId].filledElevationKm });
      }
    }
  } else {
    const detailLevels = sphere.subdivisions - hierarchyAnchor.sphere.subdivisions;
    const descendantsPerAnchor = 4 ** detailLevels;
    if (hierarchyAnchor.cells.length * descendantsPerAnchor !== cells.length) {
      throw new Error("hierarchical drainage requires exact nested icosphere ancestry");
    }
    const anchorIdOf = (faceId: number): number => Math.floor(faceId / descendantsPerAnchor);
    const membersByAnchor = hierarchyAnchor.cells.map(() => [] as number[]);
    const freeAnchor = new Uint8Array(hierarchyAnchor.cells.length);
    for (const cell of cells) {
      const anchorId = anchorIdOf(cell.faceId);
      membersByAnchor[anchorId].push(cell.faceId);
      if (!cell.isLand) freeAnchor[anchorId] = 1;
    }
    for (const anchorCell of hierarchyAnchor.cells) {
      if (!anchorCell.isLand) freeAnchor[anchorCell.faceId] = 1;
    }

    // Coastal and ocean-parent detail is allowed to find the nearest resolved
    // ocean freely. Inland parent faces are handled below against the stable
    // anchor receiver graph.
    for (let entry = heap.pop(); entry; entry = heap.pop()) {
      for (const neighborId of adjacency[entry.faceId]) {
        if (visited[neighborId] !== 0 || freeAnchor[anchorIdOf(neighborId)] === 0) continue;
        visitFrom(neighborId, entry.faceId, entry.priority);
        heap.push({ faceId: neighborId, priority: cells[neighborId].filledElevationKm });
      }
    }

    const anchorDepth = new Int32Array(hierarchyAnchor.cells.length);
    anchorDepth.fill(-1);
    for (const anchorCell of hierarchyAnchor.cells) {
      if (!anchorCell.isLand) anchorDepth[anchorCell.faceId] = 0;
    }
    for (const start of hierarchyAnchor.cells) {
      if (!start.isLand || anchorDepth[start.faceId] >= 0) continue;
      const path: number[] = [];
      let cursor = start.faceId;
      while (anchorDepth[cursor] < 0) {
        path.push(cursor);
        if (path.length > hierarchyAnchor.cells.length) {
          throw new Error("hierarchical drainage anchor contains a receiver cycle");
        }
        const receiverId = hierarchyAnchor.cells[cursor].receiverFaceId;
        if (receiverId === null) {
          throw new Error(`anchor land face ${cursor} has no hydrologic receiver`);
        }
        cursor = receiverId;
      }
      let depth = anchorDepth[cursor];
      for (let index = path.length - 1; index >= 0; index -= 1) {
        depth += 1;
        anchorDepth[path[index]] = depth;
      }
    }

    const inlandAnchors = hierarchyAnchor.cells
      .filter((anchorCell) => anchorCell.isLand && freeAnchor[anchorCell.faceId] === 0)
      .sort((a, b) => anchorDepth[a.faceId] - anchorDepth[b.faceId] || a.faceId - b.faceId);
    for (const anchorCell of inlandAnchors) {
      const receiverAnchorId = anchorCell.receiverFaceId;
      if (receiverAnchorId === null) {
        throw new Error(`inland anchor face ${anchorCell.faceId} has no hydrologic receiver`);
      }
      let exitFaceId = -1;
      let exitReceiverId = -1;
      let exitPriority = Infinity;
      for (const faceId of membersByAnchor[anchorCell.faceId]) {
        const source = cells[faceId];
        for (const neighborId of adjacency[faceId]) {
          if (anchorIdOf(neighborId) !== receiverAnchorId || visited[neighborId] === 0) continue;
          const priority = Math.max(source.elevationKm, cells[neighborId].filledElevationKm + epsilonKm);
          if (priority < exitPriority
            || (priority === exitPriority && (faceId < exitFaceId
              || (faceId === exitFaceId && neighborId < exitReceiverId)))) {
            exitFaceId = faceId;
            exitReceiverId = neighborId;
            exitPriority = priority;
          }
        }
      }
      if (exitFaceId < 0 || exitReceiverId < 0) {
        throw new Error(`anchor receiver edge ${anchorCell.faceId} -> ${receiverAnchorId} has no fine descendant`);
      }
      visitFrom(exitFaceId, exitReceiverId, cells[exitReceiverId].filledElevationKm);
      const localHeap = new ElevationHeap();
      localHeap.push({ faceId: exitFaceId, priority: cells[exitFaceId].filledElevationKm });
      for (let entry = localHeap.pop(); entry; entry = localHeap.pop()) {
        for (const neighborId of adjacency[entry.faceId]) {
          if (visited[neighborId] !== 0 || anchorIdOf(neighborId) !== anchorCell.faceId) continue;
          visitFrom(neighborId, entry.faceId, entry.priority);
          localHeap.push({ faceId: neighborId, priority: cells[neighborId].filledElevationKm });
        }
      }
    }

    for (const cell of cells) {
      if (visited[cell.faceId] === 0) {
        throw new Error(`hierarchical drainage did not visit fine face ${cell.faceId}`);
      }
      if (!cell.isLand || cell.receiverFaceId === null) continue;
      const sourceAnchorId = anchorIdOf(cell.faceId);
      const receiverAnchorId = anchorIdOf(cell.receiverFaceId);
      if (sourceAnchorId === receiverAnchorId || freeAnchor[sourceAnchorId] !== 0) continue;
      if (hierarchyAnchor.cells[sourceAnchorId].receiverFaceId !== receiverAnchorId) {
        anchorMismatches += 1;
      }
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
  return { downstreamOrder, outletRunoffKm3PerYear, anchorMismatches };
}

/**
 * Incises a bounded outlet through weak, well-watered spill basins while
 * retaining dry or structurally supported depressions. Priority-Flood still
 * owns the receiver graph; this pass changes the terrain that the next flood
 * sees instead of replacing drainage with a second, incompatible topology.
 */
function evolveSurfaceDepressions(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  seaLevelKm: number,
  radiusKm: number,
  minimumCatchmentKm2: number,
  spillwayErosionScale: number,
): DepressionEvolutionResult {
  const visited = new Uint8Array(cells.length);
  const spillwayFaceIds = new Set<number>();
  const connectedDepressionDepthKm = 0.005;
  const resolvedDepressionDepthKm = 0.13;
  const radiusSquared = radiusKm ** 2;
  let breachedBasinCount = 0;
  let preservedBasinCount = 0;
  let spillwayExcavatedVolumeKm3 = 0;
  let maximumSpillwayIncisionKm = 0;

  for (const start of cells) {
    if (!start.isLand
      || start.fillDepthKm < connectedDepressionDepthKm
      || visited[start.faceId] !== 0) continue;
    const members: number[] = [];
    const queue = [start.faceId];
    visited[start.faceId] = 1;
    let maximumDepthKm = 0;
    let maximumCatchmentKm2 = 0;
    let maximumDischargeKm3PerYear = 0;
    let maximumFilledElevationKm = -Infinity;
    let ariditySum = 0;
    let resistanceSum = 0;
    let orogenySum = 0;
    let coldSupportSum = 0;
    let volcanicCount = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const faceId = queue[cursor];
      const cell = cells[faceId];
      members.push(faceId);
      maximumDepthKm = Math.max(maximumDepthKm, cell.fillDepthKm);
      maximumCatchmentKm2 = Math.max(maximumCatchmentKm2, cell.drainageAreaKm2);
      maximumDischargeKm3PerYear = Math.max(
        maximumDischargeKm3PerYear,
        cell.dischargeKm3PerYear,
      );
      maximumFilledElevationKm = Math.max(maximumFilledElevationKm, cell.filledElevationKm);
      ariditySum += cell.aridityIndex;
      resistanceSum += cell.erosionResistance;
      orogenySum += cell.orogenStrength;
      coldSupportSum += clamp((-cell.temperatureC - 2) / 16, 0, 1);
      if (cell.lithology === "volcanic") volcanicCount += 1;
      for (const neighborId of adjacency[faceId]) {
        const neighbor = cells[neighborId];
        if (visited[neighborId] !== 0
          || !neighbor.isLand
          || neighbor.fillDepthKm < connectedDepressionDepthKm) continue;
        visited[neighborId] = 1;
        queue.push(neighborId);
      }
    }
    if (maximumDepthKm < resolvedDepressionDepthKm
      || maximumCatchmentKm2 < minimumCatchmentKm2) continue;

    const memberSet = new Set(members);
    const outletFaceId = members
      .filter((faceId) => {
        const receiverFaceId = cells[faceId].receiverFaceId;
        return receiverFaceId !== null && !memberSet.has(receiverFaceId);
      })
      .sort((a, b) => cells[b].dischargeKm3PerYear - cells[a].dischargeKm3PerYear
        || cells[a].filledElevationKm - cells[b].filledElevationKm
        || a - b)[0];
    if (outletFaceId === undefined) {
      preservedBasinCount += 1;
      continue;
    }

    const memberCount = members.length;
    const meanAridity = ariditySum / memberCount;
    const meanResistance = resistanceSum / memberCount;
    const meanOrogeny = orogenySum / memberCount;
    const meanColdSupport = coldSupportSum / memberCount;
    const volcanicFraction = volcanicCount / memberCount;
    const flowDrive = clamp(
      Math.log1p(maximumDischargeKm3PerYear / 8) / Math.log(36),
      0,
      1,
    );
    const catchmentDrive = clamp(
      Math.log1p(maximumCatchmentKm2 / minimumCatchmentKm2) / Math.log(12),
      0,
      1,
    );
    const wetnessDrive = clamp((meanAridity - 0.45) / 1.25, 0, 1);
    const aridPersistence = clamp((0.9 - meanAridity) / 0.65, 0, 1);
    const persistence = clamp(
      aridPersistence * 0.4
        + meanResistance * 0.25
        + meanOrogeny * 0.2
        + volcanicFraction * 0.15
        + meanColdSupport * 0.2,
      0,
      1,
    );
    const drive = flowDrive * 0.5 + catchmentDrive * 0.3 + wetnessDrive * 0.2;
    const activation = drive * spillwayErosionScale - persistence * 0.42;
    if (activation < 0.28) {
      preservedBasinCount += 1;
      continue;
    }

    const requestedIncisionKm = Math.min(
      maximumDepthKm * clamp(0.18 + activation * 0.75, 0.12, 0.78),
      0.16 + drive * 0.7,
    );
    const targetSpillElevationKm = Math.max(
      seaLevelKm + 0.004,
      maximumFilledElevationKm - requestedIncisionKm,
    );
    const allowedCutKm = Math.max(
      0.08,
      (0.16 + drive * 0.72)
        * spillwayErosionScale
        * (1 - persistence * 0.35),
    );
    const allowedLengthKm = 450 + drive * 1_500;
    const minimumChannelGradient = 0.00012;
    const path: Array<{ faceId: number; incisionKm: number }> = [];
    const pathVisited = new Set<number>();
    let cursorFaceId = outletFaceId;
    let previousFaceId = outletFaceId;
    let cumulativeDistanceKm = 0;
    let maximumRequiredCutKm = 0;
    let weightedResistance = 0;
    let pathWeight = 0;
    let reachedLowerTerrain = false;
    for (let step = 0; step < 64; step += 1) {
      if (pathVisited.has(cursorFaceId)) break;
      pathVisited.add(cursorFaceId);
      const cell = cells[cursorFaceId];
      if (!cell.isLand) {
        reachedLowerTerrain = true;
        break;
      }
      if (step > 0) {
        const previous = sphere.faces[previousFaceId].center;
        const current = sphere.faces[cursorFaceId].center;
        cumulativeDistanceKm += Math.acos(clamp(dot3(previous, current), -1, 1)) * radiusKm;
      }
      const targetElevationKm = Math.max(
        seaLevelKm + 0.002,
        targetSpillElevationKm - cumulativeDistanceKm * minimumChannelGradient,
      );
      if (!memberSet.has(cursorFaceId)
        && cell.fillDepthKm < connectedDepressionDepthKm
        && cell.elevationKm <= targetElevationKm) {
        reachedLowerTerrain = true;
        break;
      }
      const incisionKm = Math.max(0, cell.elevationKm - targetElevationKm);
      if (incisionKm > 0) {
        path.push({ faceId: cursorFaceId, incisionKm });
        maximumRequiredCutKm = Math.max(maximumRequiredCutKm, incisionKm);
        weightedResistance += cell.erosionResistance * incisionKm;
        pathWeight += incisionKm;
      }
      if (cumulativeDistanceKm > allowedLengthKm || cell.receiverFaceId === null) break;
      previousFaceId = cursorFaceId;
      cursorFaceId = cell.receiverFaceId;
    }
    const meanPathResistance = pathWeight > 0
      ? weightedResistance / pathWeight
      : meanResistance;
    const breachScore = drive * 1.4
      + (1 - persistence) * 0.45
      - maximumRequiredCutKm / allowedCutKm * 0.55
      - cumulativeDistanceKm / allowedLengthKm * 0.25
      - meanPathResistance * 0.08;
    const canBreach = reachedLowerTerrain
      && path.length > 0
      && maximumRequiredCutKm <= allowedCutKm
      && cumulativeDistanceKm <= allowedLengthKm
      && breachScore >= 0.65;
    if (!canBreach) {
      preservedBasinCount += 1;
      continue;
    }

    breachedBasinCount += 1;
    for (const segment of path) {
      const cell = cells[segment.faceId];
      const incisionKm = Math.min(
        segment.incisionKm,
        Math.max(0, cell.elevationKm - seaLevelKm - 0.002),
      );
      if (incisionKm <= 0) continue;
      const areaKm2 = sphere.faces[segment.faceId].areaSteradians * radiusSquared;
      cell.elevationKm -= incisionKm;
      cell.spillwayIncisionKm += incisionKm;
      spillwayFaceIds.add(segment.faceId);
      spillwayExcavatedVolumeKm3 += incisionKm * areaKm2;
      maximumSpillwayIncisionKm = Math.max(maximumSpillwayIncisionKm, incisionKm);
    }
  }
  return {
    breachedBasinCount,
    preservedBasinCount,
    spillwayCellCount: spillwayFaceIds.size,
    spillwayExcavatedVolumeKm3,
    maximumSpillwayIncisionKm,
  };
}

function classifyResolvedLakes(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  seaLevelKm: number,
  radiusKm: number,
  minimumCatchmentKm2: number,
  openWaterEvaporationScale: number,
): LakeBalanceResult {
  const visited = new Uint8Array(cells.length);
  const presentationDepthThresholdKm = new Float64Array(cells.length);
  const evaporationSinkKm3PerYear = new Float64Array(cells.length);
  const connectedDepressionDepthKm = 0.005;
  const resolvedLakeDepthKm = 0.13;
  const radiusSquared = radiusKm ** 2;
  let lakeBodyCount = 0;
  let closedLakeBodyCount = 0;
  let overflowingLakeBodyCount = 0;
  const overflowOutletFaceIds = new Set<number>();
  for (const start of cells) {
    if (!start.isLand
      || start.fillDepthKm < connectedDepressionDepthKm
      || visited[start.faceId] !== 0) continue;
    const members: number[] = [];
    const queue = [start.faceId];
    visited[start.faceId] = 1;
    let maximumDepthKm = 0;
    let maximumCatchmentKm2 = 0;
    let maximumDischargeKm3PerYear = 0;
    let outletFaceId = start.faceId;
    let maximumSurfaceElevationKm = -Infinity;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const faceId = queue[cursor];
      const cell = cells[faceId];
      members.push(faceId);
      maximumDepthKm = Math.max(maximumDepthKm, cell.fillDepthKm);
      maximumCatchmentKm2 = Math.max(maximumCatchmentKm2, cell.drainageAreaKm2);
      if (cell.dischargeKm3PerYear > maximumDischargeKm3PerYear
        || (cell.dischargeKm3PerYear === maximumDischargeKm3PerYear && faceId < outletFaceId)) {
        maximumDischargeKm3PerYear = cell.dischargeKm3PerYear;
        outletFaceId = faceId;
      }
      maximumSurfaceElevationKm = Math.max(maximumSurfaceElevationKm, cell.filledElevationKm);
      for (const neighborId of adjacency[faceId]) {
        const neighbor = cells[neighborId];
        if (visited[neighborId] !== 0
          || !neighbor.isLand
          || neighbor.fillDepthKm < connectedDepressionDepthKm) continue;
        visited[neighborId] = 1;
        queue.push(neighborId);
      }
    }
    const resolved = maximumDepthKm >= resolvedLakeDepthKm
      && maximumCatchmentKm2 >= minimumCatchmentKm2
      && maximumSurfaceElevationKm >= seaLevelKm + 0.01;
    if (!resolved) continue;
    // At annual equilibrium a closed lake expands down its depression contour
    // until potential open-water evaporation can consume the routed inflow.
    // If the entire spill basin cannot evaporate that inflow, the remaining
    // water overflows through the Priority-Flood outlet.
    const deepMembers = members
      .filter((faceId) => cells[faceId].fillDepthKm >= resolvedLakeDepthKm)
      .sort((a, b) => cells[b].fillDepthKm - cells[a].fillDepthKm || a - b);
    if (deepMembers.length === 0) continue;
    const eligible = new Set(deepMembers);
    const queued = new Set<number>();
    const selected: number[] = [];
    const lakeHeap = new ElevationHeap();
    lakeHeap.push({ faceId: deepMembers[0], priority: -cells[deepMembers[0]].fillDepthKm });
    queued.add(deepMembers[0]);
    let evaporationCapacityKm3PerYear = 0;
    for (let entry = lakeHeap.pop(); entry; entry = lakeHeap.pop()) {
      const faceId = entry.faceId;
      const cell = cells[faceId];
      const areaKm2 = sphere.faces[faceId].areaSteradians * radiusSquared;
      cell.isLake = true;
      cell.lakeDepthKm = cell.fillDepthKm;
      selected.push(faceId);
      const potentialEvaporationMPerYear = clamp(
        (0.22 + Math.max(0, cell.temperatureC + 5) * 0.04) * openWaterEvaporationScale,
        0.12,
        2.2,
      );
      evaporationCapacityKm3PerYear += potentialEvaporationMPerYear * areaKm2 / 1000;
      if (evaporationCapacityKm3PerYear >= maximumDischargeKm3PerYear) break;
      for (const neighborId of adjacency[faceId]) {
        if (!eligible.has(neighborId) || queued.has(neighborId)) continue;
        queued.add(neighborId);
        lakeHeap.push({ faceId: neighborId, priority: -cells[neighborId].fillDepthKm });
      }
    }
    if (selected.length > 0) {
      lakeBodyCount += 1;
      const actualEvaporationKm3PerYear = Math.min(
        maximumDischargeKm3PerYear,
        evaporationCapacityKm3PerYear,
      );
      evaporationSinkKm3PerYear[outletFaceId] += actualEvaporationKm3PerYear;
      if (evaporationCapacityKm3PerYear + 1e-12 >= maximumDischargeKm3PerYear) {
        closedLakeBodyCount += 1;
      } else {
        overflowingLakeBodyCount += 1;
        overflowOutletFaceIds.add(outletFaceId);
      }
      const shorelineDepthKm = selected.reduce(
        (minimum, faceId) => Math.min(minimum, cells[faceId].fillDepthKm),
        Infinity,
      );
      for (const faceId of members) {
        presentationDepthThresholdKm[faceId] = shorelineDepthKm;
        cells[faceId].lakeSurfaceDepthThresholdKm = shorelineDepthKm;
      }
    }
  }
  return {
    presentationDepthThresholdKm,
    evaporationSinkKm3PerYear,
    lakeBodyCount,
    closedLakeBodyCount,
    overflowingLakeBodyCount,
    overflowOutletFaceIds,
  };
}

function balanceRunoffAcrossLakes(
  cells: MutableSurfaceCell[],
  downstreamOrder: readonly MutableSurfaceCell[],
  evaporationSinkKm3PerYear: Float64Array,
): BalancedRunoffResult {
  for (const cell of cells) cell.dischargeKm3PerYear = cell.localRunoffKm3PerYear;
  let outletRunoffKm3PerYear = 0;
  let lakeEvaporationKm3PerYear = 0;
  for (const cell of downstreamOrder) {
    const evaporation = Math.min(
      cell.dischargeKm3PerYear,
      evaporationSinkKm3PerYear[cell.faceId],
    );
    cell.dischargeKm3PerYear -= evaporation;
    lakeEvaporationKm3PerYear += evaporation;
    if (cell.receiverFaceId === null) throw new Error(`land face ${cell.faceId} has no hydrologic receiver`);
    const receiver = cells[cell.receiverFaceId];
    if (receiver.isLand) receiver.dischargeKm3PerYear += cell.dischargeKm3PerYear;
    else outletRunoffKm3PerYear += cell.dischargeKm3PerYear;
  }
  return { outletRunoffKm3PerYear, lakeEvaporationKm3PerYear };
}

function inheritResolvedLakeBalance(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  radiusKm: number,
  hierarchyAnchor: SurfaceProcessWorld,
  openWaterEvaporationScale: number,
): LakeBalanceResult {
  const detailLevels = sphere.subdivisions - hierarchyAnchor.sphere.subdivisions;
  const descendantsPerAnchor = 4 ** detailLevels;
  const presentationDepthThresholdKm = new Float64Array(cells.length);
  const evaporationSinkKm3PerYear = new Float64Array(cells.length);
  const visited = new Uint8Array(cells.length);
  const radiusSquared = radiusKm ** 2;
  let lakeBodyCount = 0;
  let closedLakeBodyCount = 0;
  let overflowingLakeBodyCount = 0;
  const overflowOutletFaceIds = new Set<number>();
  for (const cell of cells) {
    const anchorId = Math.floor(cell.faceId / descendantsPerAnchor);
    const anchorCell = hierarchyAnchor.cells[anchorId];
    cell.isLake = cell.isLand && anchorCell.isLake;
    cell.lakeDepthKm = cell.isLake ? Math.max(0.001, cell.fillDepthKm) : 0;
    cell.lakeSurfaceDepthThresholdKm = anchorCell.lakeSurfaceDepthThresholdKm;
    presentationDepthThresholdKm[cell.faceId] = anchorCell.lakeSurfaceDepthThresholdKm;
  }
  for (const start of cells) {
    if (!start.isLake || visited[start.faceId] !== 0) continue;
    const members: number[] = [];
    const queue = [start.faceId];
    visited[start.faceId] = 1;
    let outletFaceId = start.faceId;
    let inflowKm3PerYear = start.dischargeKm3PerYear;
    let evaporationCapacityKm3PerYear = 0;
    let shorelineDepthKm = Infinity;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const faceId = queue[cursor];
      const cell = cells[faceId];
      members.push(faceId);
      if (cell.dischargeKm3PerYear > inflowKm3PerYear
        || (cell.dischargeKm3PerYear === inflowKm3PerYear && faceId < outletFaceId)) {
        outletFaceId = faceId;
        inflowKm3PerYear = cell.dischargeKm3PerYear;
      }
      shorelineDepthKm = Math.min(shorelineDepthKm, cell.fillDepthKm);
      const areaKm2 = sphere.faces[faceId].areaSteradians * radiusSquared;
      const potentialEvaporationMPerYear = clamp(
        (0.22 + Math.max(0, cell.temperatureC + 5) * 0.04) * openWaterEvaporationScale,
        0.12,
        2.2,
      );
      evaporationCapacityKm3PerYear += potentialEvaporationMPerYear * areaKm2 / 1000;
      for (const neighborId of adjacency[faceId]) {
        if (visited[neighborId] !== 0 || !cells[neighborId].isLake) continue;
        visited[neighborId] = 1;
        queue.push(neighborId);
      }
    }
    const memberSet = new Set(members);
    const exitFace = members
      .filter((faceId) => {
        const receiverFaceId = cells[faceId].receiverFaceId;
        return receiverFaceId !== null && !memberSet.has(receiverFaceId);
      })
      .sort((a, b) => cells[b].dischargeKm3PerYear - cells[a].dischargeKm3PerYear || a - b)[0];
    if (exitFace !== undefined) {
      outletFaceId = exitFace;
      inflowKm3PerYear = cells[exitFace].dischargeKm3PerYear;
    }
    lakeBodyCount += 1;
    const actualEvaporationKm3PerYear = Math.min(
      inflowKm3PerYear,
      evaporationCapacityKm3PerYear,
    );
    evaporationSinkKm3PerYear[outletFaceId] += actualEvaporationKm3PerYear;
    if (evaporationCapacityKm3PerYear + 1e-12 >= inflowKm3PerYear) closedLakeBodyCount += 1;
    else {
      overflowingLakeBodyCount += 1;
      overflowOutletFaceIds.add(outletFaceId);
    }
    const stableThresholdKm = members.reduce((thresholdKm, faceId) => Math.max(
      thresholdKm,
      cells[faceId].lakeSurfaceDepthThresholdKm,
    ), 0);
    if (stableThresholdKm <= 0 && Number.isFinite(shorelineDepthKm)) {
      for (const faceId of members) {
        const fallbackThresholdKm = Math.max(0.001, shorelineDepthKm);
        presentationDepthThresholdKm[faceId] = fallbackThresholdKm;
        cells[faceId].lakeSurfaceDepthThresholdKm = fallbackThresholdKm;
      }
    }
  }
  return {
    presentationDepthThresholdKm,
    evaporationSinkKm3PerYear,
    lakeBodyCount,
    closedLakeBodyCount,
    overflowingLakeBodyCount,
    overflowOutletFaceIds,
  };
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

function createRiverPresentationPoints(
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  riverFaceIds: ReadonlySet<number>,
  seed: number,
): ReadonlyMap<number, Vec3> {
  const nodeIds = new Set<number>();
  const dominantIncoming = new Map<number, number>();
  for (const faceId of riverFaceIds) {
    const cell = cells[faceId];
    if (cell.receiverFaceId === null) continue;
    nodeIds.add(faceId);
    nodeIds.add(cell.receiverFaceId);
    const incumbentId = dominantIncoming.get(cell.receiverFaceId);
    if (incumbentId === undefined
      || cells[faceId].drainageAreaKm2 > cells[incumbentId].drainageAreaKm2
      || (cells[faceId].drainageAreaKm2 === cells[incumbentId].drainageAreaKm2
        && faceId < incumbentId)) {
      dominantIncoming.set(cell.receiverFaceId, faceId);
    }
  }
  let points = new Map<number, Vec3>();
  for (const faceId of nodeIds) points.set(faceId, sphere.faces[faceId].center);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Map<number, Vec3>();
    for (const faceId of nodeIds) {
      const center = sphere.faces[faceId].center;
      const upstreamId = dominantIncoming.get(faceId);
      const downstreamId = cells[faceId].isLand ? cells[faceId].receiverFaceId : null;
      const upstream = upstreamId === undefined ? null : points.get(upstreamId) ?? sphere.faces[upstreamId].center;
      const downstream = downstreamId === null ? null : points.get(downstreamId) ?? sphere.faces[downstreamId].center;
      let centerWeight = 0.58;
      let neighborWeight = 0.21;
      if (!upstream || !downstream) {
        centerWeight = 0.72;
        neighborWeight = 0.28;
      }
      const candidate: [number, number, number] = [
        center[0] * centerWeight,
        center[1] * centerWeight,
        center[2] * centerWeight,
      ];
      if (upstream) {
        candidate[0] += upstream[0] * neighborWeight;
        candidate[1] += upstream[1] * neighborWeight;
        candidate[2] += upstream[2] * neighborWeight;
      }
      if (downstream) {
        candidate[0] += downstream[0] * neighborWeight;
        candidate[1] += downstream[1] * neighborWeight;
        candidate[2] += downstream[2] * neighborWeight;
      }
      let smoothed = normalize3(candidate);
      if (upstream && downstream) {
        const flow: Vec3 = [
          downstream[0] - upstream[0],
          downstream[1] - upstream[1],
          downstream[2] - upstream[2],
        ];
        const lateral = cross3(center, flow);
        const lateralLength = Math.sqrt(dot3(lateral, lateral));
        if (lateralLength > 1e-12) {
          const localStep = adjacency[faceId].reduce((minimum, neighborId) => Math.min(
            minimum,
            Math.acos(clamp(dot3(center, sphere.faces[neighborId].center), -1, 1)),
          ), Infinity);
          const meander = sphericalNoise(center, seed + 18_821)
            * localStep * 0.11
            * (1 - cells[faceId].orogenStrength * 0.45);
          smoothed = normalize3([
            smoothed[0] + lateral[0] / lateralLength * meander,
            smoothed[1] + lateral[1] / lateralLength * meander,
            smoothed[2] + lateral[2] / lateralLength * meander,
          ]);
        }
      }
      const localStep = adjacency[faceId].reduce((minimum, neighborId) => Math.min(
        minimum,
        Math.acos(clamp(dot3(center, sphere.faces[neighborId].center), -1, 1)),
      ), Infinity);
      const displacement = Math.acos(clamp(dot3(center, smoothed), -1, 1));
      const limit = localStep * 0.38;
      if (displacement > limit) {
        const amount = limit / displacement;
        smoothed = normalize3([
          center[0] * (1 - amount) + smoothed[0] * amount,
          center[1] * (1 - amount) + smoothed[1] * amount,
          center[2] * (1 - amount) + smoothed[2] * amount,
        ]);
      }
      next.set(faceId, smoothed);
    }
    points = next;
  }
  return points;
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
  const drainageAnchorSubdivisions = Math.min(
    subdivisions,
    tectonicWorld.sphere.subdivisions + 1,
  );
  const hierarchyAnchor = subdivisions > drainageAnchorSubdivisions
    ? createSurfaceProcessWorld(tectonicWorld, {
      ...options,
      subdivisions: drainageAnchorSubdivisions,
    })
    : undefined;
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
  const inheritedDetailLevels = hierarchyAnchor
    ? subdivisions - hierarchyAnchor.sphere.subdivisions
    : 0;
  const inheritedDescendantsPerAnchor = 4 ** inheritedDetailLevels;
  const cells: MutableSurfaceCell[] = sphere.faces.map((face) => {
    const refined = refinement.sample(face.center);
    const canonicalFaceId = Math.floor(face.id / 4 ** detailLevels);
    const canonical = tectonicWorld.cells[canonicalFaceId];
    const rawAboveSea = refined.elevationKm - tectonicWorld.seaLevelKm;
    const orogeny = geologyContext.orogeny[canonicalFaceId];
    const aboveSea = refined.isLand
      ? shapedOrogenicHeight(rawAboveSea, orogeny, face.center, hashedSeed)
      : rawAboveSea;
    const structuralElevationKm = tectonicWorld.seaLevelKm + aboveSea;
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
    const preSpillwayElevationKm = refined.isLand
      ? Math.max(tectonicWorld.seaLevelKm + 0.002, structuralElevationKm + detail)
      : Math.min(tectonicWorld.seaLevelKm - 0.002, structuralElevationKm + detail);
    const inheritedSpillwayIncisionKm = hierarchyAnchor && refined.isLand
      ? hierarchyAnchor.cells[Math.floor(face.id / inheritedDescendantsPerAnchor)].spillwayIncisionKm
      : 0;
    const elevationKm = refined.isLand
      ? Math.max(
        tectonicWorld.seaLevelKm + 0.002,
        preSpillwayElevationKm - inheritedSpillwayIncisionKm,
      )
      : preSpillwayElevationKm;
    const areaKm2 = face.areaSteradians * radiusSquared;
    return {
      faceId: face.id,
      canonicalFaceId,
      isLand: refined.isLand,
      elevationKm,
      coastDistanceKm: Infinity,
      filledElevationKm: elevationKm,
      fillDepthKm: 0,
      temperatureC: 0,
      seasonalTemperatureRangeC: 0,
      continentality: 0,
      precipitationMPerYear: 0,
      aridityIndex: 0,
      biome: refined.isLand ? "temperate-grassland" : "open-ocean",
      isLake: false,
      lakeDepthKm: 0,
      lakeSurfaceDepthThresholdKm: 0,
      atmosphericMoisture: 0,
      orographicLiftKm: 0,
      lithology: geology.lithology,
      erosionResistance: geology.erosionResistance,
      orogeny: orogeny.regime,
      orogenStrength: orogeny.strength,
      localRunoffKm3PerYear: 0,
      erodedThicknessKm: 0,
      depositedThicknessKm: 0,
      spillwayIncisionKm: Math.max(0, preSpillwayElevationKm - elevationKm),
      receiverFaceId: null,
      drainageAreaKm2: refined.isLand ? areaKm2 : 0,
      dischargeKm3PerYear: 0,
      floodOrder: -1,
    };
  });

  computeCoastDistances(
    cells,
    sphere,
    adjacency,
    tectonicWorld.recipe.radiusKm,
  );
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
    hierarchyAnchor,
  );
  const totalSurfaceAreaKm2 = sphere.totalAreaSteradians * radiusSquared;
  const minimumLakeCatchmentKm2 = Math.max(500_000, totalSurfaceAreaKm2 / 1_200);
  const depressionEvolutionMode = options.depressionEvolution ?? "hybrid";
  if (depressionEvolutionMode !== "hybrid" && depressionEvolutionMode !== "fill-only") {
    throw new RangeError("depression evolution must be hybrid or fill-only");
  }
  const spillwayErosionScale = clamp(options.spillwayErosionScale ?? 1, 0.25, 2.5);
  const depressionEvolution: DepressionEvolutionResult = hierarchyAnchor
    ? {
      breachedBasinCount: hierarchyAnchor.stats.breachedBasinCount,
      preservedBasinCount: hierarchyAnchor.stats.preservedBasinCount,
      spillwayCellCount: cells.filter((cell) => cell.spillwayIncisionKm > 0).length,
      spillwayExcavatedVolumeKm3: cells.reduce(
        (sum, cell) => sum + cell.spillwayIncisionKm
          * sphere.faces[cell.faceId].areaSteradians * radiusSquared,
        0,
      ),
      maximumSpillwayIncisionKm: cells.reduce(
        (maximum, cell) => Math.max(maximum, cell.spillwayIncisionKm),
        0,
      ),
    }
    : evolveSurfaceDepressions(
      cells,
      sphere,
      adjacency,
      tectonicWorld.seaLevelKm,
      tectonicWorld.recipe.radiusKm,
      minimumLakeCatchmentKm2,
      depressionEvolutionMode === "hybrid" ? spillwayErosionScale : 0,
    );
  const evolvedDrainage = depressionEvolution.spillwayCellCount > 0 && !hierarchyAnchor
    ? routeSurfaceHydrology(
      cells,
      sphere,
      adjacency,
      tectonicWorld.recipe.radiusKm,
    )
    : initialDrainage;
  const erosionStrengthKm = clamp(options.erosionStrengthKm ?? 0.2, 0, 0.6);
  const minimumErosionAreaKm2 = options.minimumErosionAreaKm2
    ?? Math.max(180_000, totalSurfaceAreaKm2 / 2_500);
  const sedimentBudget = erodeAndRouteSediment(
    cells,
    sphere,
    evolvedDrainage,
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
    hierarchyAnchor,
  );

  for (const cell of cells) {
    cell.lakeDepthKm = cell.isLand ? Math.max(0, cell.fillDepthKm) : 0;
    cell.isLake = false;
  }
  const openWaterEvaporationScale = clamp(options.openWaterEvaporationScale ?? 1.05, 0.4, 2.5);
  const lakeBalance = hierarchyAnchor
    ? inheritResolvedLakeBalance(
      cells,
      sphere,
      adjacency,
      tectonicWorld.recipe.radiusKm,
      hierarchyAnchor,
      openWaterEvaporationScale,
    )
    : classifyResolvedLakes(
      cells,
      sphere,
      adjacency,
      tectonicWorld.seaLevelKm,
      tectonicWorld.recipe.radiusKm,
      minimumLakeCatchmentKm2,
      openWaterEvaporationScale,
    );
  const balancedRunoff = balanceRunoffAcrossLakes(
    cells,
    finalDrainage.downstreamOrder,
    lakeBalance.evaporationSinkKm3PerYear,
  );
  const presentationLakeDepthThresholdKm = lakeBalance.presentationDepthThresholdKm;
  for (const cell of cells) {
    if (!cell.isLake) cell.lakeDepthKm = 0;
    cell.biome = classifySurfaceBiome(cell, tectonicWorld.seaLevelKm);
  }

  const minimumRiverAreaKm2 = options.minimumRiverAreaKm2
    ?? Math.max(90_000, totalSurfaceAreaKm2 / 3_500);
  const riverCells = cells.filter((cell) => cell.isLand
    && cell.receiverFaceId !== null
    && cell.drainageAreaKm2 >= minimumRiverAreaKm2
    && cell.dischargeKm3PerYear > 1e-12
    && (!cell.isLake || lakeBalance.overflowOutletFaceIds.has(cell.faceId)));
  const riverFaceIds = new Set(riverCells.map((cell) => cell.faceId));
  const riverPresentationPoints = createRiverPresentationPoints(
    cells,
    sphere,
    adjacency,
    riverFaceIds,
    hashedSeed,
  );
  const rivers: SurfaceRiverSegment[] = riverCells.map((cell) => {
    const receiverFaceId = cell.receiverFaceId as number;
    return {
      fromFaceId: cell.faceId,
      toFaceId: receiverFaceId,
      fromPoint: riverPresentationPoints.get(cell.faceId) ?? sphere.faces[cell.faceId].center,
      toPoint: riverPresentationPoints.get(receiverFaceId) ?? sphere.faces[receiverFaceId].center,
      drainageAreaKm2: cell.drainageAreaKm2,
      dischargeKm3PerYear: cell.dischargeKm3PerYear,
    };
  });
  const riverMouths: SurfaceRiverMouth[] = rivers.flatMap((river) => {
    const source = cells[river.fromFaceId];
    const receiver = cells[river.toFaceId];
    const receivingWater = !receiver.isLand
      ? "ocean"
      : receiver.isLake && !source.isLake
        ? "lake"
        : null;
    return receivingWater === null ? [] : [{
      fromFaceId: river.fromFaceId,
      toFaceId: river.toFaceId,
      point: river.toPoint,
      receivingWater,
      drainageAreaKm2: river.drainageAreaKm2,
      dischargeKm3PerYear: river.dischargeKm3PerYear,
    }];
  });

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
    seasonalTemperatureRangeC: cell.seasonalTemperatureRangeC,
    continentality: cell.continentality,
    precipitationMPerYear: cell.precipitationMPerYear,
    aridityIndex: cell.aridityIndex,
    biome: cell.biome,
    isLake: cell.isLake,
    lakeDepthKm: cell.lakeDepthKm,
    lakeSurfaceDepthThresholdKm: cell.lakeSurfaceDepthThresholdKm,
    atmosphericMoisture: cell.atmosphericMoisture,
    orographicLiftKm: cell.orographicLiftKm,
    lithology: cell.lithology,
    erosionResistance: cell.erosionResistance,
    orogeny: cell.orogeny,
    orogenStrength: cell.orogenStrength,
    localRunoffKm3PerYear: cell.localRunoffKm3PerYear,
    erodedThicknessKm: cell.erodedThicknessKm,
    depositedThicknessKm: cell.depositedThicknessKm,
    spillwayIncisionKm: cell.spillwayIncisionKm,
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
  // Reconstruct each resolved lake from a smooth Priority-Flood depression
  // contour. Canonical lake cells still own area and water accounting; the
  // scalar contour only replaces their triangular process-cell silhouettes.
  const lakeKernelSharpness = 1.35 / characteristicRadians ** 2;
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
    let fillDepthKm = 0;
    let spillwayIncisionKm = 0;
    let coastDistanceKm = 0;
    let temperatureC = 0;
    let seasonalTemperatureRangeC = 0;
    let continentality = 0;
    let precipitationMPerYear = 0;
    let aridityIndex = 0;
    let lakeCoverage = 0;
    let lakeDepthKm = 0;
    let drainageAreaKm2 = 0;
    let dischargeKm3PerYear = 0;
    let atmosphericMoisture = 0;
    let orographicLiftKm = 0;
    let erosionResistance = 0;
    let orogenStrength = 0;
    for (const faceId of candidates) {
      const weight = Math.exp((dot3(centers[faceId], point) - 1) * kernelSharpness);
      const cell = immutableCells[faceId];
      totalWeight += weight;
      elevationKm += cell.elevationKm * weight;
      fillDepthKm += cell.fillDepthKm * weight;
      spillwayIncisionKm += cell.spillwayIncisionKm * weight;
      coastDistanceKm += (Number.isFinite(cell.coastDistanceKm) ? cell.coastDistanceKm : 0) * weight;
      temperatureC += cell.temperatureC * weight;
      seasonalTemperatureRangeC += cell.seasonalTemperatureRangeC * weight;
      continentality += cell.continentality * weight;
      precipitationMPerYear += cell.precipitationMPerYear * weight;
      aridityIndex += cell.aridityIndex * weight;
      lakeDepthKm += cell.lakeDepthKm * weight;
      drainageAreaKm2 += cell.drainageAreaKm2 * weight;
      dischargeKm3PerYear += cell.dischargeKm3PerYear * weight;
      atmosphericMoisture += cell.atmosphericMoisture * weight;
      orographicLiftKm += cell.orographicLiftKm * weight;
      erosionResistance += cell.erosionResistance * weight;
      orogenStrength += cell.orogenStrength * weight;
    }
    elevationKm /= totalWeight;
    fillDepthKm /= totalWeight;
    spillwayIncisionKm /= totalWeight;
    coastDistanceKm /= totalWeight;
    temperatureC /= totalWeight;
    seasonalTemperatureRangeC /= totalWeight;
    continentality /= totalWeight;
    precipitationMPerYear /= totalWeight;
    aridityIndex /= totalWeight;
    lakeDepthKm /= totalWeight;
    drainageAreaKm2 /= totalWeight;
    dischargeKm3PerYear /= totalWeight;
    atmosphericMoisture /= totalWeight;
    orographicLiftKm /= totalWeight;
    erosionResistance /= totalWeight;
    orogenStrength /= totalWeight;
    if (refined.isLand) {
      let lakePotential = 0;
      let basinWeight = 0;
      let basinFillDepthKm = 0;
      const relevantThresholdKm = candidateIds
        .map((faceId) => presentationLakeDepthThresholdKm[faceId])
        .find((thresholdKm) => thresholdKm > 0) ?? 0;
      for (const faceId of candidateIds) {
        const cell = immutableCells[faceId];
        if (!cell.isLand) continue;
        const weight = Math.exp((dot3(centers[faceId], point) - 1) * lakeKernelSharpness);
        if (cell.isLake) lakePotential += weight;
        if (relevantThresholdKm > 0
          && Math.abs(presentationLakeDepthThresholdKm[faceId] - relevantThresholdKm) < 1e-9) {
          basinWeight += weight;
          basinFillDepthKm += cell.fillDepthKm * weight;
        }
      }
      if (basinWeight > 0 && relevantThresholdKm > 0) {
        const smoothedFillDepthKm = basinFillDepthKm / basinWeight;
        const depthT = clamp((smoothedFillDepthKm - relevantThresholdKm + 0.025) / 0.05, 0, 1);
        const depthCoverage = depthT * depthT * (3 - 2 * depthT);
        const supportT = clamp((lakePotential - 0.035) / 0.1, 0, 1);
        const supportCoverage = supportT * supportT * (3 - 2 * supportT);
        lakeCoverage = depthCoverage * supportCoverage;
      }
    }
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
    const nearestMatchingCell = immutableCells[nearestMatchingId];
    const presentationIsLake = refined.isLand && lakeCoverage >= 0.5;
    const nearestDryCell = nearestMatchingCell.isLake
      ? candidates.map((faceId) => immutableCells[faceId]).find((cell) => !cell.isLake)
      : nearestMatchingCell;
    return {
      faceId: nearestMatchingId,
      canonicalFaceId: immutableCells[nearestMatchingId].canonicalFaceId,
      isLand: refined.isLand,
      elevationKm,
      fillDepthKm,
      spillwayIncisionKm,
      coastDistanceKm,
      temperatureC,
      seasonalTemperatureRangeC,
      continentality,
      precipitationMPerYear,
      aridityIndex,
      biome: presentationIsLake
        ? "freshwater-lake"
        : nearestDryCell?.biome ?? "temperate-grassland",
      isLake: presentationIsLake,
      lakeCoverage,
      lakeDepthKm,
      drainageAreaKm2,
      dischargeKm3PerYear,
      atmosphericMoisture,
      orographicLiftKm,
      prevailingWind: prevailingWindAt(point),
      lithology: nearestMatchingCell.lithology,
      erosionResistance,
      orogeny: nearestMatchingCell.orogeny,
      orogenStrength,
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
    riverMouths,
    stats: {
      landFraction: landArea / sphere.totalAreaSteradians,
      landCellCount: cells.filter((cell) => cell.isLand).length,
      oceanCellCount: cells.filter((cell) => !cell.isLand).length,
      lakeCellCount: cells.filter((cell) => cell.isLake).length,
      lakeAreaKm2: cells.reduce(
        (sum, cell) => sum + (cell.isLake ? sphere.faces[cell.faceId].areaSteradians * radiusSquared : 0),
        0,
      ),
      lakeBodyCount: lakeBalance.lakeBodyCount,
      closedLakeBodyCount: lakeBalance.closedLakeBodyCount,
      overflowingLakeBodyCount: lakeBalance.overflowingLakeBodyCount,
      lakeEvaporationKm3PerYear: balancedRunoff.lakeEvaporationKm3PerYear,
      riverSegmentCount: rivers.length,
      riverMouthCount: riverMouths.length,
      oceanRiverMouthCount: riverMouths.filter((mouth) => mouth.receivingWater === "ocean").length,
      lakeInflowCount: riverMouths.filter((mouth) => mouth.receivingWater === "lake").length,
      maximumDrainageAreaKm2: cells.reduce((maximum, cell) => Math.max(maximum, cell.drainageAreaKm2), 0),
      maximumDischargeKm3PerYear: cells.reduce((maximum, cell) => Math.max(maximum, cell.dischargeKm3PerYear), 0),
      totalLocalRunoffKm3PerYear: totalRunoff,
      totalOutletRunoffKm3PerYear: balancedRunoff.outletRunoffKm3PerYear,
      runoffResidualKm3PerYear: totalRunoff
        - balancedRunoff.outletRunoffKm3PerYear
        - balancedRunoff.lakeEvaporationKm3PerYear,
      maximumFillDepthKm: cells.reduce((maximum, cell) => Math.max(maximum, cell.fillDepthKm), 0),
      ...depressionEvolution,
      canonicalAnchorMismatches: refinementAudit.canonicalAnchorMismatches,
      drainageAnchorSubdivisions,
      drainageAnchorMismatches: finalDrainage.anchorMismatches,
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
      biomeAreaKm2: cells.reduce((areas, cell) => {
        areas[cell.biome] += sphere.faces[cell.faceId].areaSteradians * radiusSquared;
        return areas;
      }, emptyBiomeRecord()),
      ...climateStats,
      ...sedimentBudget,
    },
    sample: (direction) => immutableCells[exactFaceAtPoint(sphere, root, centers, adjacency, direction)],
    sampleContinuous,
  };
}
