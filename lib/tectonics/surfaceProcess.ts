import { createGeodesicSphere, type GeodesicSphere } from "./geodesic.ts";
import {
  createCanonicalOrogeny,
  type CanonicalOrogenyCell,
  type OrogenRegime,
} from "./orogeny.ts";
import { createCanonicalMargins, type CanonicalMarginCell } from "./margins.ts";
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
  /** Strength of deterministic monthly runoff and lake-temperature seasonality. */
  readonly lakeSeasonalityScale?: number;
  /** Depression evolution applied before the final erosion and lake passes. */
  readonly depressionEvolution?: "hybrid" | "fill-only";
  /** Multiplier on discharge-driven spillway incision. */
  readonly spillwayErosionScale?: number;
  /** Additional long-timescale outlet pressure exerted by very large wet basins. */
  readonly largeBasinOutletScale?: number;
  /** Physical smoothing length used by conservative hillslope diffusion. */
  readonly hillslopeDiffusionLengthKm?: number;
  /** Bounded explicit diffusion iterations. */
  readonly hillslopeDiffusionPasses?: number;
  /** Multiplier on renderer-scale drainage-conditioned valley relief. */
  readonly valleyReliefScale?: number;
  /** Strength of world-space, relief-conditioned sub-cell channel bends. */
  readonly channelRefinementScale?: number;
  /** Strength of broad, tectonically inherited continental-interior relief. */
  readonly continentalReliefScale?: number;
  /** Strength of convergent-margin foreland subsidence and outer flexural rise. */
  readonly flexuralReliefScale?: number;
  /** Strength of relief-conditioned rocky/passive coastline spectra. */
  readonly coastalGeomorphologyScale?: number;
  /** Strength of tectonically quiet coastal-plain relief adjustment. */
  readonly coastalPlainScale?: number;
}

export type SurfaceLithology =
  | "oceanic-basalt"
  | "crystalline"
  | "metamorphic"
  | "volcanic"
  | "carbonate"
  | "sedimentary";

export type SurfaceMarginRegime = "interior" | "active" | "passive" | "transitional";

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
  /** Continental flexural depression outside a convergent mountain belt. */
  readonly forelandBasinStrength: number;
  /** Low outer rise beyond a foreland basin. */
  readonly flexuralBulgeStrength: number;
  /** Signed tectonic flexure applied before geomorphic evolution. */
  readonly flexuralReliefKm: number;
  /** Present-day plate-boundary influence, physically decayed across continental crust. */
  readonly activeMarginStrength: number;
  /** Tectonically quiet, low-relief continental-margin support. */
  readonly passiveMarginStrength: number;
  readonly marginRegime: SurfaceMarginRegime;
  /** Broad low-relief coastal surface support in [0, 1]. */
  readonly coastalPlainStrength: number;
  /** Signed pre-climate coastal-plain relief adjustment; non-positive on land. */
  readonly coastalPlainReliefKm: number;
  readonly localRunoffKm3PerYear: number;
  readonly erodedThicknessKm: number;
  readonly depositedThicknessKm: number;
  /** Terrain removed by the bounded geomorphic spillway pass. */
  readonly spillwayIncisionKm: number;
  readonly hillslopeErosionKm: number;
  readonly hillslopeDepositionKm: number;
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
  /** Stable world-space sub-cell channel path, including both shared nodes. */
  readonly path: readonly Vec3[];
  /** Relief confinement in [0, 1]; high-gradient mountain channels are straighter. */
  readonly confinement: number;
  readonly meanderAmplitudeKm: number;
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export type SurfaceCoastalLandform =
  | "delta"
  | "estuary"
  | "alluvial-fan"
  | "simple-mouth"
  | "lake-inflow";

const SURFACE_COASTAL_LANDFORMS: readonly SurfaceCoastalLandform[] = [
  "delta",
  "estuary",
  "alluvial-fan",
  "simple-mouth",
  "lake-inflow",
];

export interface SurfaceRiverMouth {
  readonly fromFaceId: number;
  readonly toFaceId: number;
  readonly point: Vec3;
  readonly receivingWater: "ocean" | "lake";
  readonly landform: SurfaceCoastalLandform;
  readonly sedimentSupplyIndex: number;
  /** Sediment volume delivered across this terminal edge during the reduced geomorphic pass. */
  readonly sedimentFluxKm3: number;
  /** Presentation-scale delta/plain radius derived from actual terminal sediment flux. */
  readonly deltaPlainRadiusKm: number;
  /** Bounded presentation-only shoreline extension; canonical coast is unchanged. */
  readonly deltaProgradationKm: number;
  /** Presentation-only distributaries/fan channels; canonical coast is unchanged. */
  readonly distributaries: readonly (readonly Vec3[])[];
  readonly drainageAreaKm2: number;
  readonly dischargeKm3PerYear: number;
}

export type SurfaceLakeRegime = "closed" | "overflowing";
export type SurfaceLakeBasinOrigin = "rift" | "foreland" | "volcanic" | "glacial" | "cratonic" | "mixed";

export interface SurfaceLakeMonth {
  /** Zero-based month index. Month 0 is January. */
  readonly monthIndex: number;
  readonly meanTemperatureC: number;
  /** Water volume entering during this month. */
  readonly inflowKm3: number;
  /** Actual open-water evaporation during this month. */
  readonly evaporationKm3: number;
  /** Spillway discharge leaving during this month. */
  readonly outflowKm3: number;
  /** End-of-month stored water volume. */
  readonly storageKm3: number;
  /** Approximate lake level relative to the annual mean storage. */
  readonly levelAnomalyM: number;
  readonly iceFraction: number;
}

export interface SurfaceLakeBody {
  readonly id: number;
  readonly faceIds: readonly number[];
  readonly outletFaceId: number;
  readonly regime: SurfaceLakeRegime;
  readonly areaKm2: number;
  readonly volumeKm3: number;
  readonly maximumDepthKm: number;
  readonly inflowKm3PerYear: number;
  readonly evaporationKm3PerYear: number;
  readonly outflowKm3PerYear: number;
  /** Resistance, orogenic confinement, volcanism, and cold-basin support in [0, 1]. */
  readonly structuralSupport: number;
  readonly basinOrigin: SurfaceLakeBasinOrigin;
  readonly meanCrustAgeMyr: number;
  readonly meanRiftExposureMyr: number;
  readonly meanConvergenceExposureMyr: number;
  readonly tectonicSupport: number;
  readonly seasonalStorageRangeKm3: number;
  readonly seasonalLevelRangeM: number;
  readonly minimumStorageFraction: number;
  readonly overflowMonthCount: number;
  readonly dryMonthCount: number;
  readonly perennial: boolean;
  /** Combined hydroclimate and tectonic longevity evidence in [0, 1]. */
  readonly persistenceScore: number;
  readonly longLived: boolean;
  readonly monthlyWaterBalance: readonly SurfaceLakeMonth[];
}

export interface SurfacePresentationSample {
  /** Nearest process cell; retained for diagnostics and river lookup only. */
  readonly faceId: number;
  readonly canonicalFaceId: number;
  readonly isLand: boolean;
  readonly elevationKm: number;
  readonly fillDepthKm: number;
  readonly spillwayIncisionKm: number;
  readonly hillslopeChangeKm: number;
  readonly valleyIncisionKm: number;
  readonly coastDistanceKm: number;
  readonly coastalRuggedness: number;
  readonly coastalSedimentAffinity: number;
  readonly activeMarginStrength: number;
  readonly passiveMarginStrength: number;
  readonly marginRegime: SurfaceMarginRegime;
  readonly coastalPlainStrength: number;
  readonly coastalPlainReliefKm: number;
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
  readonly forelandBasinStrength: number;
  readonly flexuralBulgeStrength: number;
  readonly flexuralReliefKm: number;
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
  readonly totalLakeVolumeKm3: number;
  readonly largestLakeAreaKm2: number;
  readonly largestLakeVolumeKm3: number;
  readonly dominantLakeAreaFraction: number;
  readonly perennialLakeBodyCount: number;
  readonly ephemeralLakeBodyCount: number;
  readonly longLivedLakeBodyCount: number;
  readonly seasonallyOverflowingLakeBodyCount: number;
  readonly meanLakeSeasonalLevelRangeM: number;
  readonly maximumLakeSeasonalLevelRangeM: number;
  readonly seasonalLakeWaterResidualKm3PerYear: number;
  readonly riverSegmentCount: number;
  readonly meanRiverSinuosity: number;
  readonly meanRiverMeanderAmplitudeKm: number;
  /** Local parallel-flow signal in [0, 1], measured across adjacent channels. */
  readonly meanNeighboringChannelAlignment: number;
  readonly riverMouthCount: number;
  readonly oceanRiverMouthCount: number;
  readonly lakeInflowCount: number;
  readonly coastalLandformCounts: Readonly<Record<SurfaceCoastalLandform, number>>;
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
  readonly hillslopeErodedVolumeKm3: number;
  readonly hillslopeDepositedVolumeKm3: number;
  readonly hillslopeResidualKm3: number;
  readonly hillslopeAdjustedCellCount: number;
  readonly maximumHillslopeChangeKm: number;
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
  /** Naturally selected broad continental-interior uplift centers. */
  readonly continentalReliefCenterCount: number;
  readonly maximumContinentalReliefKm: number;
  readonly forelandBasinCellCount: number;
  readonly flexuralBulgeCellCount: number;
  readonly maximumForelandSubsidenceKm: number;
  readonly maximumFlexuralBulgeKm: number;
  readonly activeMarginCellCount: number;
  readonly passiveMarginCellCount: number;
  readonly coastalPlainCellCount: number;
  readonly coastalPlainAreaKm2: number;
  readonly maximumCoastalPlainLoweringKm: number;
}

export interface SurfaceProcessWorld {
  readonly version: 1;
  readonly tectonicWorld: TectonicWorldModel;
  readonly sphere: GeodesicSphere;
  readonly cells: readonly SurfaceProcessCell[];
  readonly rivers: readonly SurfaceRiverSegment[];
  readonly riverMouths: readonly SurfaceRiverMouth[];
  readonly lakes: readonly SurfaceLakeBody[];
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
  hillslopeErosionKm: number;
  hillslopeDepositionKm: number;
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
  lithology: SurfaceLithology;
  erosionResistance: number;
  marginRegime: SurfaceMarginRegime;
  coastalPlainStrength: number;
  coastalPlainReliefKm: number;
  localRunoffKm3PerYear: number;
  sedimentExportKm3: number;
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

interface CoastalMarginStats {
  readonly activeMarginCellCount: number;
  readonly passiveMarginCellCount: number;
  readonly coastalPlainCellCount: number;
  readonly coastalPlainAreaKm2: number;
  readonly maximumCoastalPlainLoweringKm: number;
}

interface LakeBalanceResult {
  readonly presentationDepthThresholdKm: Float64Array;
  readonly evaporationSinkKm3PerYear: Float64Array;
  readonly lakeBodyCount: number;
  readonly closedLakeBodyCount: number;
  readonly overflowingLakeBodyCount: number;
  readonly overflowOutletFaceIds: ReadonlySet<number>;
  readonly bodies: readonly SurfaceLakeBody[];
}

interface SeasonalLakeBalanceResult {
  readonly evaporationSinkKm3PerYear: Float64Array;
  readonly closedLakeBodyCount: number;
  readonly overflowingLakeBodyCount: number;
  readonly overflowOutletFaceIds: ReadonlySet<number>;
  readonly bodies: readonly SurfaceLakeBody[];
  readonly perennialLakeBodyCount: number;
  readonly ephemeralLakeBodyCount: number;
  readonly longLivedLakeBodyCount: number;
  readonly seasonallyOverflowingLakeBodyCount: number;
  readonly meanLakeSeasonalLevelRangeM: number;
  readonly maximumLakeSeasonalLevelRangeM: number;
  readonly seasonalLakeWaterResidualKm3PerYear: number;
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

interface HillslopeDiffusionResult {
  readonly hillslopeErodedVolumeKm3: number;
  readonly hillslopeDepositedVolumeKm3: number;
  readonly hillslopeResidualKm3: number;
  readonly hillslopeAdjustedCellCount: number;
  readonly maximumHillslopeChangeKm: number;
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

interface PhysicalReliefBand {
  readonly directionA: Vec3;
  readonly directionB: Vec3;
  readonly directionC: Vec3;
  readonly frequency: number;
  readonly phaseA: number;
  readonly phaseB: number;
  readonly phaseC: number;
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

function randomDirection(seed: number, label: string): Vec3 {
  return normalize3([0, 1, 2].map((axis) => (
    seedHash(`${seed}:${label}:${axis}`) / 0x1_0000_0000 * 2 - 1
  )) as unknown as Vec3);
}

/**
 * A planet-size-aware signal for continent-scale structure. Frequencies are
 * expressed relative to an Earth-radius world so a larger planet acquires
 * more physical-scale relief provinces instead of merely stretching them.
 */
function continentalStructureNoise(point: Vec3, seed: number, radiusKm: number): number {
  const physicalScale = clamp(radiusKm / 6_371, 0.35, 7.85);
  const directionA = randomDirection(seed, "continental-a");
  const directionB = randomDirection(seed, "continental-b");
  const directionC = randomDirection(seed, "continental-c");
  const phaseA = seedHash(`${seed}:continental-phase-a`) / 0x1_0000_0000 * Math.PI * 2;
  const phaseB = seedHash(`${seed}:continental-phase-b`) / 0x1_0000_0000 * Math.PI * 2;
  const phaseC = seedHash(`${seed}:continental-phase-c`) / 0x1_0000_0000 * Math.PI * 2;
  return Math.sin(dot3(point, directionA) * 5.2 * physicalScale + phaseA) * 0.5
    + Math.sin(dot3(point, directionB) * 8.7 * physicalScale + phaseB) * 0.31
    + Math.cos(dot3(point, directionC) * 13.3 * physicalScale + phaseC) * 0.19;
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

/**
 * Builds isotropic, fixed-physical-scale terrain bands for drainage-scale
 * relief. The previous three plane waves left a visible preferred direction
 * in broad lowlands. Several warped orientations per octave create secondary
 * divides and valleys without moving the authoritative land/sea boundary.
 */
function createPhysicalReliefBands(seed: number, radiusKm: number): readonly PhysicalReliefBand[] {
  // These bands span broad secondary divides down to tributary-scale relief.
  // Climate aggregates them to a fixed orographic support on fine meshes;
  // hydrology and erosion retain the full physical spectrum.
  const wavelengthsKm = [1_500, 850, 480, 270, 150];
  const weights = [0.31, 0.25, 0.2, 0.15, 0.09];
  return wavelengthsKm.map((wavelengthKm, octave) => {
    const direction = (label: string): Vec3 => randomDirection(
      seed + octave * 17_171,
      `drainage-relief-${label}`,
    );
    const phase = (label: string): number => (
      seedHash(`${seed}:drainage-relief:${octave}:${label}`)
        / 0x1_0000_0000 * Math.PI * 2
    );
    return {
      directionA: direction("a"),
      directionB: direction("b"),
      directionC: direction("c"),
      frequency: Math.PI * 2 * radiusKm / wavelengthKm,
      phaseA: phase("a"),
      phaseB: phase("b"),
      phaseC: phase("c"),
      weight: weights[octave],
    };
  });
}

function samplePhysicalRelief(
  point: Vec3,
  bands: readonly PhysicalReliefBand[],
): { readonly noise: number; readonly ridge: number } {
  let noise = 0;
  let ridge = 0;
  for (const band of bands) {
    const argumentB = dot3(point, band.directionB) * band.frequency * 0.83 + band.phaseB;
    const argumentC = dot3(point, band.directionC) * band.frequency * 0.61 + band.phaseC;
    const waveB = Math.sin(argumentB);
    const waveC = Math.sin(argumentC);
    // Domain-warp the dominant orientation with two unrelated directions.
    // This retains coherent valleys at each physical wavelength but avoids
    // the sheet-like stripes produced by an unwarped sum of plane waves.
    const argumentA = dot3(point, band.directionA) * band.frequency
      + band.phaseA
      + waveB * 0.92
      + waveC * 0.43;
    const waveA = Math.sin(argumentA);
    const cellularCross = Math.sin(argumentB + waveC * 0.67) * Math.cos(argumentC - waveA * 0.38);
    noise += (waveA * 0.54 + waveB * 0.24 + waveC * 0.12 + cellularCross * 0.1)
      * band.weight;
    ridge += (1 - Math.abs(Math.sin(argumentA + waveB * 0.31 - waveC * 0.22)))
      * band.weight;
  }
  return { noise, ridge };
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

function emptyCoastalLandformRecord(): Record<SurfaceCoastalLandform, number> {
  return Object.fromEntries(
    SURFACE_COASTAL_LANDFORMS.map((landform) => [landform, 0]),
  ) as Record<SurfaceCoastalLandform, number>;
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

interface ContinentalReliefStructure {
  readonly supportKm: Float64Array;
  readonly centers: readonly {
    readonly point: Vec3;
    readonly strength: number;
  }[];
  readonly centerCount: number;
  readonly maximumSupportKm: number;
}

function continentalReliefAt(
  point: Vec3,
  centers: readonly { readonly point: Vec3; readonly strength: number }[],
  radiusKm: number,
): number {
  let supportKm = 0;
  for (const center of centers) {
    const distanceKm = Math.acos(clamp(dot3(point, center.point), -1, 1)) * radiusKm;
    const influenceRadiusKm = 720 + center.strength * 980;
    if (distanceKm > influenceRadiusKm * 2.2) continue;
    const normalizedDistance = distanceKm / influenceRadiusKm;
    const upliftKm = (0.16 + center.strength * 0.48)
      * Math.exp(-normalizedDistance * normalizedDistance * 1.8);
    supportKm = Math.max(supportKm, upliftKm);
  }
  return supportKm;
}

function canonicalContinentalInteriorDistance(
  world: TectonicWorldModel,
  adjacency: readonly number[][],
): Float64Array {
  const distances = new Float64Array(world.cells.length).fill(Infinity);
  const heap = new ElevationHeap();
  const continental = (faceId: number): boolean => {
    const cell = world.cells[faceId];
    return (cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0)) >= 0.5
      && cell.isLand;
  };
  for (const face of world.sphere.faces) {
    if (!continental(face.id)) continue;
    const cell = world.cells[face.id];
    if (adjacency[face.id].some((neighborId) => !continental(neighborId)
      || world.cells[neighborId].provenanceId !== cell.provenanceId)) {
      distances[face.id] = 0;
      heap.push({ faceId: face.id, priority: 0 });
    }
  }
  while (true) {
    const entry = heap.pop();
    if (!entry) break;
    if (entry.priority > distances[entry.faceId] + 1e-9) continue;
    const center = world.sphere.faces[entry.faceId].center;
    for (const neighborId of adjacency[entry.faceId]) {
      if (!continental(neighborId)) continue;
      const neighbor = world.sphere.faces[neighborId].center;
      const stepKm = Math.acos(clamp(dot3(center, neighbor), -1, 1)) * world.recipe.radiusKm;
      const distance = entry.priority + stepKm;
      if (distance >= distances[neighborId]) continue;
      distances[neighborId] = distance;
      heap.push({ faceId: neighborId, priority: distance });
    }
  }
  return distances;
}

function createContinentalReliefStructure(
  world: TectonicWorldModel,
  adjacency: readonly number[][],
  orogeny: readonly CanonicalOrogenyCell[],
): ContinentalReliefStructure {
  const hashedSeed = seedHash(world.recipe.seed);
  const interiorDistanceKm = canonicalContinentalInteriorDistance(world, adjacency);
  const scores = new Float64Array(world.cells.length);
  for (const face of world.sphere.faces) {
    const cell = world.cells[face.id];
    if (!cell.isLand || !Number.isFinite(interiorDistanceKm[face.id])) continue;
    const interior = clamp((interiorDistanceKm[face.id] - 120) / 760);
    const stableCraton = clamp((cell.crustAgeMyr - 280) / 1_650);
    const quietInterior = 1 - orogeny[face.id].strength * 0.62;
    const worldSignal = continentalStructureNoise(face.center, hashedSeed + 27_311, world.recipe.radiusKm);
    const terraneSignal = continentalStructureNoise(
      face.center,
      hashedSeed + cell.provenanceId * 17 + 91_107,
      world.recipe.radiusKm,
    );
    const signal = clamp((worldSignal * 0.72 + terraneSignal * 0.28) * 0.5 + 0.5);
    scores[face.id] = interior
      * (0.38 + signal * 0.62)
      * (0.72 + stableCraton * 0.28)
      * quietInterior;
  }

  const candidates = world.sphere.faces
    .filter((face) => scores[face.id] >= 0.32
      && adjacency[face.id].every((neighborId) => scores[face.id] >= scores[neighborId]))
    .sort((first, second) => scores[second.id] - scores[first.id] || first.id - second.id);
  const minimumSpacingKm = 1_050;
  const selectedCenters: { readonly faceId: number; readonly strength: number }[] = [];
  for (const candidate of candidates) {
    const tooClose = selectedCenters.some((center) => (
      Math.acos(clamp(dot3(candidate.center, world.sphere.faces[center.faceId].center), -1, 1))
        * world.recipe.radiusKm < minimumSpacingKm
    ));
    if (!tooClose) selectedCenters.push({ faceId: candidate.id, strength: scores[candidate.id] });
  }
  const centers = selectedCenters.map((center) => ({
    point: world.sphere.faces[center.faceId].center,
    strength: center.strength,
  }));

  const supportKm = new Float64Array(world.cells.length);
  let maximumSupportKm = 0;
  for (const face of world.sphere.faces) {
    if (!world.cells[face.id].isLand) continue;
    supportKm[face.id] = continentalReliefAt(face.center, centers, world.recipe.radiusKm);
    maximumSupportKm = Math.max(maximumSupportKm, supportKm[face.id]);
  }
  return { supportKm, centers, centerCount: centers.length, maximumSupportKm };
}

function canonicalGeologyContext(world: TectonicWorldModel): {
  readonly sutureStrength: Float64Array;
  readonly margins: readonly CanonicalMarginCell[];
  readonly orogeny: readonly CanonicalOrogenyCell[];
  readonly continentalRelief: ContinentalReliefStructure;
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

  const margins = createCanonicalMargins(world);
  const orogeny = createCanonicalOrogeny(world);
  return {
    sutureStrength,
    margins,
    orogeny,
    continentalRelief: createContinentalReliefStructure(world, adjacency, orogeny),
  };
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

function flexuralRelief(
  elevationAboveSeaKm: number,
  orogeny: CanonicalOrogenyCell,
  scale: number,
): number {
  if (elevationAboveSeaKm <= 0 || scale <= 0) return 0;
  const availableReliefKm = Math.max(0, elevationAboveSeaKm - 0.035);
  const desiredSubsidenceKm = orogeny.forelandBasinStrength * 0.62;
  const basinFraction = 0.2 + orogeny.forelandBasinStrength * 0.54;
  const subsidenceKm = Math.min(desiredSubsidenceKm, availableReliefKm * basinFraction);
  const bulgeKm = orogeny.flexuralBulgeStrength * 0.16;
  return (bulgeKm - subsidenceKm) * scale;
}

function surfaceGeology(
  isLand: boolean,
  point: Vec3,
  elevationAboveSeaKm: number,
  canonicalFaceId: number,
  world: TectonicWorldModel,
  sutureStrength: number,
  activeMarginStrength: number,
  forelandBasinStrength: number,
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
  if (forelandBasinStrength > 0.28 && elevationAboveSeaKm < 1.35) {
    lithology = "sedimentary";
    baseResistance = 0.26 + (1 - forelandBasinStrength) * 0.12;
  } else if (sutureStrength > 0.34 || (elevationAboveSeaKm > 2.4 && continentalFraction > 0.55)) {
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

function applyCoastalMargins(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  seaLevelKm: number,
  radiusKm: number,
  scale: number,
): CoastalMarginStats {
  let activeMarginCellCount = 0;
  let passiveMarginCellCount = 0;
  let coastalPlainCellCount = 0;
  let coastalPlainAreaKm2 = 0;
  let maximumCoastalPlainLoweringKm = 0;
  for (const cell of cells) {
    if (!cell.isLand) {
      cell.marginRegime = "interior";
      continue;
    }
    const active = cell.activeMarginStrength;
    const passive = cell.passiveMarginStrength;
    const coastDistanceKm = cell.coastDistanceKm;
    if (coastDistanceKm <= 420 && active >= 0.5) {
      cell.marginRegime = "active";
      activeMarginCellCount += 1;
    } else if (coastDistanceKm <= 780 && passive >= 0.42) {
      cell.marginRegime = "passive";
      passiveMarginCellCount += 1;
    } else if (coastDistanceKm <= 900 || active >= 0.25) {
      cell.marginRegime = "transitional";
    } else {
      cell.marginRegime = "interior";
    }
    if (cell.marginRegime !== "passive") continue;

    const widthKm = 260 + passive * 520;
    const normalizedDistance = clamp(coastDistanceKm / widthKm);
    const distanceFade = (1 - normalizedDistance) ** 1.45;
    const aboveSeaKm = Math.max(0, cell.elevationKm - seaLevelKm);
    const lowReliefSupport = 1 - clamp((aboveSeaKm - 0.12) / 1.7);
    const plainStrength = clamp(
      passive * distanceFade * (0.58 + lowReliefSupport * 0.42),
    );
    cell.coastalPlainStrength = plainStrength;
    const targetAboveSeaKm = 0.035
      + 0.3 * normalizedDistance ** 1.35
      + (1 - passive) * 0.1;
    const availableReliefKm = Math.max(0, aboveSeaKm - 0.002);
    const desiredLoweringKm = Math.max(0, aboveSeaKm - targetAboveSeaKm);
    const loweringKm = Math.min(
      desiredLoweringKm,
      availableReliefKm * 0.68,
      plainStrength * 0.62,
    ) * scale;
    cell.coastalPlainReliefKm = -loweringKm;
    if (loweringKm > 0) {
      cell.elevationKm = Math.max(seaLevelKm + 0.002, cell.elevationKm - loweringKm);
      cell.filledElevationKm = cell.elevationKm;
      maximumCoastalPlainLoweringKm = Math.max(maximumCoastalPlainLoweringKm, loweringKm);
    }
    if (plainStrength < 0.26) continue;
    coastalPlainCellCount += 1;
    coastalPlainAreaKm2 += sphere.faces[cell.faceId].areaSteradians * radiusKm ** 2;
    if (cell.elevationKm - seaLevelKm < 1.1) {
      cell.lithology = "sedimentary";
      cell.erosionResistance = Math.min(
        cell.erosionResistance,
        clamp(0.5 - plainStrength * 0.19, 0.24, 0.5),
      );
    }
  }
  return {
    activeMarginCellCount,
    passiveMarginCellCount,
    coastalPlainCellCount,
    coastalPlainAreaKm2,
    maximumCoastalPlainLoweringKm,
  };
}

function climateScaleElevation(
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  seaLevelKm: number,
  radiusKm: number,
): Float64Array {
  const rawElevation = Float64Array.from(cells.map((cell) => (
    cell.isLand ? Math.max(0, cell.elevationKm - seaLevelKm) : 0
  )));
  if (sphere.subdivisions <= 4) return rawElevation;
  let elevation = new Float64Array(rawElevation);
  const characteristicStepKm = sphere.edges.reduce(
    (sum, edge) => sum + edge.arcLengthRadians * radiusKm,
    0,
  ) / Math.max(1, sphere.edges.length);
  // Climate sees a fixed physical orographic footprint rather than every
  // newly resolved drainage wrinkle. This is a compact subgrid-orography
  // model: hydrology retains the full terrain, while lapse rate and moisture
  // transport sample approximately 220 km support at every mesh density.
  const diffusionAmount = (220 / Math.max(1, characteristicStepKm)) ** 2;
  const passes = Math.max(1, Math.ceil(diffusionAmount / 0.45));
  const blend = Math.min(0.45, diffusionAmount / passes);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(elevation.length);
    for (const cell of cells) {
      const neighbors = adjacency[cell.faceId];
      const neighborMean = neighbors.reduce(
        (sum, neighborId) => sum + elevation[neighborId],
        0,
      ) / Math.max(1, neighbors.length);
      next[cell.faceId] = elevation[cell.faceId] * (1 - blend) + neighborMean * blend;
    }
    elevation = next;
  }
  // Preserve resolved windward barriers while suppressing only the portion
  // of their climate response that is not stable at the coarser process mesh.
  return Float64Array.from(
    rawElevation,
    (value, faceId) => value * 0.68 + elevation[faceId] * 0.32,
  );
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
  const elevationAboveSea = climateScaleElevation(
    cells,
    sphere,
    adjacency,
    seaLevelKm,
    radiusKm,
  );
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
    // Report threshold cover with a narrow fractional transition. The physical
    // aridity field and biome thresholds remain unchanged, but a cell moving
    // from 0.749 to 0.751 under refinement no longer flips its entire area in
    // this resolution-convergence diagnostic.
    const aridMembershipLinear = clamp((0.82 - cell.aridityIndex) / 0.14);
    const aridMembership = aridMembershipLinear ** 2 * (3 - 2 * aridMembershipLinear);
    aridArea += area * aridMembership;
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
    }
    for (const anchorCell of hierarchyAnchor.cells) {
      if (!anchorCell.isLand) freeAnchor[anchorCell.faceId] = 1;
    }

    // Only canonical ocean parents route freely. A refined ocean child inside
    // a canonical land parent must not release the parent's remaining land
    // children from the inherited basin: doing so lets coastline detail capture
    // an entire major watershed and makes basin area resolution-dependent.
    // Canonical land parents, including coastal ones, are handled below against
    // the stable anchor receiver graph.
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
        if (!source.isLand || visited[faceId] !== 0) continue;
        for (const neighborId of adjacency[faceId]) {
          if (anchorIdOf(neighborId) !== receiverAnchorId
            || visited[neighborId] === 0
            || (hierarchyAnchor.cells[receiverAnchorId].isLand && !cells[neighborId].isLand)) continue;
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
      if (exitFaceId < 0 && hierarchyAnchor.cells[receiverAnchorId].isLand) {
        // A refined strait can remove every land-to-land descendant crossing
        // along an edge that was land-connected on the coarser anchor. Only in
        // that geometric case may the inherited reach terminate on the newly
        // resolved water instead of making the hierarchy unsatisfiable.
        for (const faceId of membersByAnchor[anchorCell.faceId]) {
          const source = cells[faceId];
          if (!source.isLand || visited[faceId] !== 0) continue;
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
      }
      if (exitFaceId < 0) {
        // The source coarse cell itself can be split by a finer strait, leaving
        // no land descendant on its inherited receiver edge. Route the stranded
        // fine land component to adjacent resolved water inside that source
        // parent; this is the fine-grid expression of the severed coarse reach.
        for (const faceId of membersByAnchor[anchorCell.faceId]) {
          const source = cells[faceId];
          if (!source.isLand || visited[faceId] !== 0) continue;
          for (const neighborId of adjacency[faceId]) {
            if (anchorIdOf(neighborId) !== anchorCell.faceId
              || visited[neighborId] === 0
              || cells[neighborId].isLand) continue;
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
  largeBasinOutletScale: number,
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
    let depressionAreaKm2 = 0;
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
      depressionAreaKm2 += sphere.faces[faceId].areaSteradians * radiusSquared;
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
    // A large, well-fed lake cannot remain at its Priority-Flood spill surface
    // indefinitely merely because the first outlet route is long. Repeated
    // overtopping concentrates erosion at the lowest sill over geological time.
    // Dry, resistant, volcanic, cold, and actively confined basins retain their
    // structural support because hydraulic pressure is coupled to routed flow.
    const basinScaleDrive = clamp(
      Math.log1p(depressionAreaKm2 / 150_000) / Math.log(10),
      0,
      1,
    );
    const hydraulicPersistencePressure = basinScaleDrive
      * (0.35 + flowDrive * 0.65)
      * largeBasinOutletScale;
    const effectivePersistence = persistence * (1 - clamp(
      hydraulicPersistencePressure * 0.38,
      0,
      0.55,
    ));
    const drive = flowDrive * 0.42
      + catchmentDrive * 0.24
      + wetnessDrive * 0.16
      + hydraulicPersistencePressure * 0.18;
    const activation = drive * spillwayErosionScale - effectivePersistence * 0.42;
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
      (0.16 + drive * 0.72 + hydraulicPersistencePressure * 0.28)
        * spillwayErosionScale
        * (1 - effectivePersistence * 0.35),
    );
    const allowedLengthKm = 450
      + drive * 1_800
      + hydraulicPersistencePressure * 1_400;
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
    for (let step = 0; step < 96; step += 1) {
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
      + (1 - effectivePersistence) * 0.45
      + hydraulicPersistencePressure * 0.35
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

function summarizeLakeBody(
  id: number,
  faceIds: readonly number[],
  outletFaceId: number,
  regime: SurfaceLakeRegime,
  inflowKm3PerYear: number,
  evaporationKm3PerYear: number,
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  radiusKm: number,
): SurfaceLakeBody {
  const radiusSquared = radiusKm ** 2;
  let areaKm2 = 0;
  let volumeKm3 = 0;
  let maximumDepthKm = 0;
  let weightedStructuralSupport = 0;
  for (const faceId of faceIds) {
    const cell = cells[faceId];
    const cellAreaKm2 = sphere.faces[faceId].areaSteradians * radiusSquared;
    const coldSupport = clamp((-cell.temperatureC - 2) / 16, 0, 1);
    const structuralSupport = clamp(
      cell.erosionResistance * 0.5
        + cell.orogenStrength * 0.3
        + (cell.lithology === "volcanic" ? 0.12 : 0)
        + coldSupport * 0.12,
      0,
      1,
    );
    areaKm2 += cellAreaKm2;
    volumeKm3 += cellAreaKm2 * cell.lakeDepthKm;
    maximumDepthKm = Math.max(maximumDepthKm, cell.lakeDepthKm);
    weightedStructuralSupport += structuralSupport * cellAreaKm2;
  }
  return {
    id,
    faceIds: [...faceIds],
    outletFaceId,
    regime,
    areaKm2,
    volumeKm3,
    maximumDepthKm,
    inflowKm3PerYear,
    evaporationKm3PerYear,
    outflowKm3PerYear: Math.max(0, inflowKm3PerYear - evaporationKm3PerYear),
    structuralSupport: weightedStructuralSupport / Math.max(areaKm2, Number.EPSILON),
    basinOrigin: "mixed",
    meanCrustAgeMyr: 0,
    meanRiftExposureMyr: 0,
    meanConvergenceExposureMyr: 0,
    tectonicSupport: 0,
    seasonalStorageRangeKm3: 0,
    seasonalLevelRangeM: 0,
    minimumStorageFraction: 1,
    overflowMonthCount: regime === "overflowing" ? 12 : 0,
    dryMonthCount: 0,
    perennial: true,
    persistenceScore: 0,
    longLived: false,
    monthlyWaterBalance: [],
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
  const bodies: SurfaceLakeBody[] = [];
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
      const regime: SurfaceLakeRegime = evaporationCapacityKm3PerYear + 1e-12
        >= maximumDischargeKm3PerYear
        ? "closed"
        : "overflowing";
      if (regime === "closed") {
        closedLakeBodyCount += 1;
      } else {
        overflowingLakeBodyCount += 1;
        overflowOutletFaceIds.add(outletFaceId);
      }
      bodies.push(summarizeLakeBody(
        bodies.length,
        selected,
        outletFaceId,
        regime,
        maximumDischargeKm3PerYear,
        actualEvaporationKm3PerYear,
        cells,
        sphere,
        radiusKm,
      ));
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
    bodies,
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
  const bodies: SurfaceLakeBody[] = [];
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
    const regime: SurfaceLakeRegime = evaporationCapacityKm3PerYear + 1e-12 >= inflowKm3PerYear
      ? "closed"
      : "overflowing";
    if (regime === "closed") closedLakeBodyCount += 1;
    else {
      overflowingLakeBodyCount += 1;
      overflowOutletFaceIds.add(outletFaceId);
    }
    bodies.push(summarizeLakeBody(
      bodies.length,
      members,
      outletFaceId,
      regime,
      inflowKm3PerYear,
      actualEvaporationKm3PerYear,
      cells,
      sphere,
      radiusKm,
    ));
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
    bodies,
  };
}

function monthlyRunoffFractions(
  cell: MutableSurfaceCell,
  point: Vec3,
  seasonalityScale: number,
): readonly number[] {
  const latitude = Math.asin(clamp(point[2], -1, 1));
  const absoluteLatitudeFraction = Math.abs(latitude) / (Math.PI / 2);
  const summerPeakMonth = latitude >= 0 ? 6 : 0;
  const temperatures = Array.from({ length: 12 }, (_, monthIndex) => (
    cell.temperatureC
      + cell.seasonalTemperatureRangeC * 0.5 * seasonalityScale
        * Math.cos((monthIndex - summerPeakMonth) * Math.PI * 2 / 12)
  ));
  const equatorialEnvelope = Math.exp(-((Math.abs(latitude) / 0.25) ** 2));
  const monsoonEnvelope = Math.exp(-(((Math.abs(latitude) - 0.3) / 0.3) ** 2));
  const stormTrackEnvelope = Math.exp(-(((Math.abs(latitude) - 0.92) / 0.3) ** 2));
  const moistureResponse = clamp(cell.precipitationMPerYear / 1.4, 0, 1);
  const coldSeasonPotential = clamp(
    (cell.seasonalTemperatureRangeC - 8) / 38,
    0,
    1,
  ) * absoluteLatitudeFraction;
  const raw = temperatures.map((temperatureC, monthIndex) => {
    const phase = (monthIndex - summerPeakMonth) * Math.PI * 2 / 12;
    const localSummer = Math.cos(phase);
    const localWinter = -localSummer;
    const equinoctialPulse = -Math.cos(phase * 2);
    const precipitationWeight = Math.max(
      0.08,
      1
        + monsoonEnvelope * (0.28 + moistureResponse * 0.32) * localSummer * seasonalityScale
        + stormTrackEnvelope * 0.34 * localWinter * seasonalityScale
        + equatorialEnvelope * 0.22 * equinoctialPulse * seasonalityScale,
    );
    const previousTemperatureC = temperatures[(monthIndex + 11) % 12];
    const thawFraction = clamp((temperatureC + 6) / 14, 0.08, 1);
    const warmingPulse = clamp((temperatureC - previousTemperatureC) / 8, 0, 1);
    const snowmeltPulse = warmingPulse * coldSeasonPotential * 1.25 * seasonalityScale;
    return precipitationWeight * (0.2 + thawFraction * 0.8) + snowmeltPulse;
  });
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / Math.max(total, Number.EPSILON));
}

function simulateSeasonalLakeBalance(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  downstreamOrder: readonly MutableSurfaceCell[],
  bodies: readonly SurfaceLakeBody[],
  tectonicWorld: TectonicWorldModel,
  seasonalityScale: number,
): SeasonalLakeBalanceResult {
  if (bodies.length === 0) {
    return {
      evaporationSinkKm3PerYear: new Float64Array(cells.length),
      closedLakeBodyCount: 0,
      overflowingLakeBodyCount: 0,
      overflowOutletFaceIds: new Set<number>(),
      bodies: [],
      perennialLakeBodyCount: 0,
      ephemeralLakeBodyCount: 0,
      longLivedLakeBodyCount: 0,
      seasonallyOverflowingLakeBodyCount: 0,
      meanLakeSeasonalLevelRangeM: 0,
      maximumLakeSeasonalLevelRangeM: 0,
      seasonalLakeWaterResidualKm3PerYear: 0,
    };
  }

  const lakeIdByFace = new Int32Array(cells.length);
  lakeIdByFace.fill(-1);
  for (const body of bodies) {
    for (const faceId of body.faceIds) lakeIdByFace[faceId] = body.id;
  }
  const targetLakeByFace = new Int32Array(cells.length);
  targetLakeByFace.fill(-2);
  for (let orderIndex = downstreamOrder.length - 1; orderIndex >= 0; orderIndex -= 1) {
    const cell = downstreamOrder[orderIndex];
    const lakeId = lakeIdByFace[cell.faceId];
    if (lakeId >= 0) {
      targetLakeByFace[cell.faceId] = lakeId;
      continue;
    }
    const receiverFaceId = cell.receiverFaceId;
    targetLakeByFace[cell.faceId] = receiverFaceId !== null && cells[receiverFaceId].isLand
      ? Math.max(-1, targetLakeByFace[receiverFaceId])
      : -1;
  }

  const inflowProfiles = bodies.map(() => new Float64Array(12));
  for (const cell of cells) {
    if (!cell.isLand || cell.localRunoffKm3PerYear <= 0) continue;
    const targetLakeId = targetLakeByFace[cell.faceId];
    if (targetLakeId < 0) continue;
    const fractions = monthlyRunoffFractions(
      cell,
      sphere.faces[cell.faceId].center,
      seasonalityScale,
    );
    const profile = inflowProfiles[targetLakeId];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      profile[monthIndex] += cell.localRunoffKm3PerYear * fractions[monthIndex];
    }
  }

  const downstreamLakeIds = new Int32Array(bodies.length);
  downstreamLakeIds.fill(-1);
  for (const body of bodies) {
    let cursorFaceId = cells[body.outletFaceId].receiverFaceId;
    const visited = new Set<number>();
    while (cursorFaceId !== null
      && cells[cursorFaceId].isLand
      && lakeIdByFace[cursorFaceId] === body.id
      && !visited.has(cursorFaceId)) {
      visited.add(cursorFaceId);
      cursorFaceId = cells[cursorFaceId].receiverFaceId;
    }
    if (cursorFaceId !== null && cells[cursorFaceId].isLand) {
      const downstreamLakeId = targetLakeByFace[cursorFaceId];
      if (downstreamLakeId >= 0 && downstreamLakeId !== body.id) {
        downstreamLakeIds[body.id] = downstreamLakeId;
      }
    }
  }

  const indegrees = new Int32Array(bodies.length);
  for (const downstreamLakeId of downstreamLakeIds) {
    if (downstreamLakeId >= 0) indegrees[downstreamLakeId] += 1;
  }
  const ready = bodies.map((body) => body.id).filter((id) => indegrees[id] === 0);
  ready.sort((a, b) => a - b);
  const lakeOrder: number[] = [];
  while (ready.length > 0) {
    const lakeId = ready.shift() as number;
    lakeOrder.push(lakeId);
    const downstreamLakeId = downstreamLakeIds[lakeId];
    if (downstreamLakeId < 0) continue;
    indegrees[downstreamLakeId] -= 1;
    if (indegrees[downstreamLakeId] === 0) {
      ready.push(downstreamLakeId);
      ready.sort((a, b) => a - b);
    }
  }
  for (const body of bodies) {
    if (!lakeOrder.includes(body.id)) lakeOrder.push(body.id);
  }

  const radiusSquared = tectonicWorld.recipe.radiusKm ** 2;
  const updatedBodies = new Array<SurfaceLakeBody>(bodies.length);
  const evaporationSinkKm3PerYear = new Float64Array(cells.length);
  const overflowOutletFaceIds = new Set<number>();
  let seasonalLakeWaterResidualKm3PerYear = 0;
  for (const lakeId of lakeOrder) {
    const body = bodies[lakeId];
    const inflow = inflowProfiles[lakeId];
    let areaWeight = 0;
    let crustAgeSum = 0;
    let riftExposureSum = 0;
    let convergenceExposureSum = 0;
    let volcanicArea = 0;
    let coldArea = 0;
    let forelandSum = 0;
    const monthlyTemperatures = new Float64Array(12);
    for (const faceId of body.faceIds) {
      const cell = cells[faceId];
      const areaKm2 = sphere.faces[faceId].areaSteradians * radiusSquared;
      const canonical = tectonicWorld.cells[cell.canonicalFaceId];
      const latitude = Math.asin(clamp(sphere.faces[faceId].center[2], -1, 1));
      const summerPeakMonth = latitude >= 0 ? 6 : 0;
      areaWeight += areaKm2;
      crustAgeSum += canonical.crustAgeMyr * areaKm2;
      riftExposureSum += (canonical.riftExposureMyr ?? 0) * areaKm2;
      convergenceExposureSum += (canonical.convergenceExposureMyr ?? 0) * areaKm2;
      if (cell.lithology === "volcanic") volcanicArea += areaKm2;
      coldArea += clamp((-cell.temperatureC + 1) / 18, 0, 1) * areaKm2;
      forelandSum += cell.forelandBasinStrength * areaKm2;
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        monthlyTemperatures[monthIndex] += (
          cell.temperatureC
            + cell.seasonalTemperatureRangeC * 0.5 * seasonalityScale
              * Math.cos((monthIndex - summerPeakMonth) * Math.PI * 2 / 12)
        ) * areaKm2;
      }
    }
    const meanCrustAgeMyr = crustAgeSum / Math.max(areaWeight, Number.EPSILON);
    const meanRiftExposureMyr = riftExposureSum / Math.max(areaWeight, Number.EPSILON);
    const meanConvergenceExposureMyr = convergenceExposureSum
      / Math.max(areaWeight, Number.EPSILON);
    const volcanicFraction = volcanicArea / Math.max(areaWeight, Number.EPSILON);
    const coldFraction = coldArea / Math.max(areaWeight, Number.EPSILON);
    const meanForelandStrength = forelandSum / Math.max(areaWeight, Number.EPSILON);
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      monthlyTemperatures[monthIndex] /= Math.max(areaWeight, Number.EPSILON);
    }

    const routedAnnualInflowKm3 = inflow.reduce((sum, value) => sum + value, 0);
    const annualEvaporationTargetKm3 = Math.min(
      body.evaporationKm3PerYear,
      routedAnnualInflowKm3,
    );
    const evaporationWeights = Array.from(monthlyTemperatures, (temperatureC) => {
      const iceFraction = clamp((-temperatureC + 1) / 11, 0, 1);
      const openWaterPotential = 0.22 + Math.max(0, temperatureC + 5) * 0.04;
      return Math.max(0.02, openWaterPotential * (1 - iceFraction * 0.84));
    });
    const evaporationWeightTotal = evaporationWeights.reduce((sum, value) => sum + value, 0);
    const evaporationCapacity = evaporationWeights.map((weight) => (
      annualEvaporationTargetKm3 * weight / Math.max(evaporationWeightTotal, Number.EPSILON)
    ));
    const storageCapacityKm3 = Math.max(body.volumeKm3, Number.EPSILON);

    const runYear = (initialStorageKm3: number, capture: boolean) => {
      let storageKm3 = initialStorageKm3;
      const months: Array<Omit<SurfaceLakeMonth, "levelAnomalyM">> = [];
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        const availableKm3 = storageKm3 + inflow[monthIndex];
        const evaporationKm3 = Math.min(evaporationCapacity[monthIndex], availableKm3);
        const afterEvaporationKm3 = availableKm3 - evaporationKm3;
        const outflowKm3 = Math.max(0, afterEvaporationKm3 - storageCapacityKm3);
        storageKm3 = Math.min(storageCapacityKm3, afterEvaporationKm3);
        if (capture) {
          months.push({
            monthIndex,
            meanTemperatureC: monthlyTemperatures[monthIndex],
            inflowKm3: inflow[monthIndex],
            evaporationKm3,
            outflowKm3,
            storageKm3,
            iceFraction: clamp((-monthlyTemperatures[monthIndex] + 1) / 11, 0, 1),
          });
        }
      }
      return { storageKm3, months };
    };

    let storageKm3 = body.regime === "overflowing"
      ? storageCapacityKm3
      : storageCapacityKm3 * 0.72;
    for (let spinupYear = 0; spinupYear < 64; spinupYear += 1) {
      const nextStorageKm3 = runYear(storageKm3, false).storageKm3;
      const converged = Math.abs(nextStorageKm3 - storageKm3)
        <= Math.max(1e-8, storageCapacityKm3 * 1e-10);
      storageKm3 = nextStorageKm3;
      if (converged && spinupYear >= 3) break;
    }
    const cycleStartStorageKm3 = storageKm3;
    const cycle = runYear(cycleStartStorageKm3, true);
    const meanStorageKm3 = cycle.months.reduce((sum, month) => sum + month.storageKm3, 0) / 12;
    const monthlyWaterBalance: SurfaceLakeMonth[] = cycle.months.map((month) => ({
      ...month,
      levelAnomalyM: (month.storageKm3 - meanStorageKm3)
        / Math.max(body.areaKm2, Number.EPSILON) * 1000,
    }));
    const annualInflowKm3 = monthlyWaterBalance.reduce((sum, month) => sum + month.inflowKm3, 0);
    const annualEvaporationKm3 = monthlyWaterBalance.reduce(
      (sum, month) => sum + month.evaporationKm3,
      0,
    );
    const annualOutflowKm3 = monthlyWaterBalance.reduce((sum, month) => sum + month.outflowKm3, 0);
    const minimumStorageKm3 = monthlyWaterBalance.reduce(
      (minimum, month) => Math.min(minimum, month.storageKm3),
      Infinity,
    );
    const maximumStorageKm3 = monthlyWaterBalance.reduce(
      (maximum, month) => Math.max(maximum, month.storageKm3),
      0,
    );
    const seasonalStorageRangeKm3 = maximumStorageKm3 - minimumStorageKm3;
    const seasonalLevelRangeM = seasonalStorageRangeKm3
      / Math.max(body.areaKm2, Number.EPSILON) * 1000;
    const minimumStorageFraction = minimumStorageKm3 / storageCapacityKm3;
    const overflowMonthCount = monthlyWaterBalance.filter((month) => month.outflowKm3 > 1e-9).length;
    const dryMonthCount = monthlyWaterBalance.filter((month) => (
      month.storageKm3 <= storageCapacityKm3 * 0.005
    )).length;
    const perennial = dryMonthCount === 0 && minimumStorageFraction > 0.01;
    const regime: SurfaceLakeRegime = annualOutflowKm3 > Math.max(1e-9, annualInflowKm3 * 1e-8)
      ? "overflowing"
      : "closed";
    if (regime === "overflowing") overflowOutletFaceIds.add(body.outletFaceId);
    evaporationSinkKm3PerYear[body.outletFaceId] = annualEvaporationKm3;

    const stableCratonSupport = clamp((meanCrustAgeMyr - 350) / 1_400, 0, 1);
    const riftSupport = clamp(meanRiftExposureMyr / 90, 0, 1);
    const convergenceSupport = clamp(meanConvergenceExposureMyr / 110, 0, 1);
    const tectonicSupport = clamp(
      body.structuralSupport * 0.42
        + riftSupport * 0.2
        + convergenceSupport * 0.14
        + stableCratonSupport * 0.14
        + volcanicFraction * 0.1,
      0,
      1,
    );
    let basinOrigin: SurfaceLakeBasinOrigin = "mixed";
    if (coldFraction >= 0.58) basinOrigin = "glacial";
    else if (volcanicFraction >= 0.28) basinOrigin = "volcanic";
    else if (meanRiftExposureMyr >= 24
      && meanRiftExposureMyr >= meanConvergenceExposureMyr * 1.05) basinOrigin = "rift";
    else if (meanForelandStrength >= 0.16 || meanConvergenceExposureMyr >= 28) {
      basinOrigin = "foreland";
    } else if (meanCrustAgeMyr >= 850 && body.structuralSupport >= 0.52) {
      basinOrigin = "cratonic";
    }
    const hydroclimatePersistence = clamp(
      clamp(minimumStorageFraction / 0.45, 0, 1) * 0.45
        + (1 - dryMonthCount / 12) * 0.25
        + (1 - clamp(seasonalStorageRangeKm3 / storageCapacityKm3, 0, 1)) * 0.2
        + (regime === "closed" ? 1 : overflowMonthCount / 12) * 0.1,
      0,
      1,
    );
    const persistenceScore = clamp(
      hydroclimatePersistence * 0.45 + tectonicSupport * 0.55,
      0,
      1,
    );
    const hasNamedGeologicSupport = basinOrigin !== "mixed";
    const longLived = perennial
      && persistenceScore >= 0.56
      && (hasNamedGeologicSupport || tectonicSupport >= 0.42);
    // The monthly reduction can exceed routed inflow by a last-bit rounding
    // difference when a closed lake evaporates its entire annual supply.
    // Preserve the physical inequality exposed by the public annual record.
    const boundedAnnualEvaporationKm3 = Math.min(annualEvaporationKm3, annualInflowKm3);
    updatedBodies[lakeId] = {
      ...body,
      regime,
      inflowKm3PerYear: annualInflowKm3,
      evaporationKm3PerYear: boundedAnnualEvaporationKm3,
      outflowKm3PerYear: annualOutflowKm3,
      basinOrigin,
      meanCrustAgeMyr,
      meanRiftExposureMyr,
      meanConvergenceExposureMyr,
      tectonicSupport,
      seasonalStorageRangeKm3,
      seasonalLevelRangeM,
      minimumStorageFraction,
      overflowMonthCount,
      dryMonthCount,
      perennial,
      persistenceScore,
      longLived,
      monthlyWaterBalance,
    };
    seasonalLakeWaterResidualKm3PerYear += cycleStartStorageKm3
      + annualInflowKm3
      - annualEvaporationKm3
      - annualOutflowKm3
      - cycle.storageKm3;
    const downstreamLakeId = downstreamLakeIds[lakeId];
    if (downstreamLakeId >= 0) {
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        inflowProfiles[downstreamLakeId][monthIndex] += monthlyWaterBalance[monthIndex].outflowKm3;
      }
    }
  }

  const perennialLakeBodyCount = updatedBodies.filter((body) => body.perennial).length;
  const longLivedLakeBodyCount = updatedBodies.filter((body) => body.longLived).length;
  const seasonallyOverflowingLakeBodyCount = updatedBodies.filter(
    (body) => body.overflowMonthCount > 0,
  ).length;
  const lakeAreaKm2 = updatedBodies.reduce((sum, body) => sum + body.areaKm2, 0);
  return {
    evaporationSinkKm3PerYear,
    closedLakeBodyCount: updatedBodies.filter((body) => body.regime === "closed").length,
    overflowingLakeBodyCount: updatedBodies.filter((body) => body.regime === "overflowing").length,
    overflowOutletFaceIds,
    bodies: updatedBodies,
    perennialLakeBodyCount,
    ephemeralLakeBodyCount: updatedBodies.length - perennialLakeBodyCount,
    longLivedLakeBodyCount,
    seasonallyOverflowingLakeBodyCount,
    meanLakeSeasonalLevelRangeM: updatedBodies.reduce(
      (sum, body) => sum + body.seasonalLevelRangeM * body.areaKm2,
      0,
    ) / Math.max(lakeAreaKm2, Number.EPSILON),
    maximumLakeSeasonalLevelRangeM: updatedBodies.reduce(
      (maximum, body) => Math.max(maximum, body.seasonalLevelRangeM),
      0,
    ),
    seasonalLakeWaterResidualKm3PerYear,
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
    else {
      cell.sedimentExportKm3 += availableSedimentKm3;
      exportedSedimentVolumeKm3 += availableSedimentKm3;
    }
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
 * Redistributes land elevation along land-land edges with an explicit,
 * resolution-aware diffusion length. Every transfer removes and deposits the
 * same volume; no material crosses the canonical coast in this pass.
 */
function diffuseHillslopes(
  cells: MutableSurfaceCell[],
  sphere: GeodesicSphere,
  seaLevelKm: number,
  radiusKm: number,
  diffusionLengthKm: number,
  passes: number,
): HillslopeDiffusionResult {
  if (diffusionLengthKm <= 0 || passes <= 0) {
    return {
      hillslopeErodedVolumeKm3: 0,
      hillslopeDepositedVolumeKm3: 0,
      hillslopeResidualKm3: 0,
      hillslopeAdjustedCellCount: 0,
      maximumHillslopeChangeKm: 0,
    };
  }
  const radiusSquared = radiusKm ** 2;
  const areasKm2 = Float64Array.from(
    sphere.faces,
    (face) => face.areaSteradians * radiusSquared,
  );
  const initialElevationKm = Float64Array.from(cells, (cell) => cell.elevationKm);
  let hillslopeErodedVolumeKm3 = 0;
  let hillslopeDepositedVolumeKm3 = 0;

  for (let pass = 0; pass < passes; pass += 1) {
    const elevationsKm = Float64Array.from(cells, (cell) => cell.elevationKm);
    const outgoingVolumeKm3 = new Float64Array(cells.length);
    const transfers: Array<{ highFaceId: number; lowFaceId: number; volumeKm3: number }> = [];
    for (const edge of sphere.edges) {
      const firstFaceId = edge.faces[0];
      const secondFaceId = edge.faces[1];
      const first = cells[firstFaceId];
      const second = cells[secondFaceId];
      if (!first.isLand || !second.isLand) continue;
      const firstElevationKm = elevationsKm[firstFaceId];
      const secondElevationKm = elevationsKm[secondFaceId];
      const elevationDifferenceKm = Math.abs(firstElevationKm - secondElevationKm);
      if (elevationDifferenceKm <= 1e-8) continue;
      const highFaceId = firstElevationKm > secondElevationKm ? firstFaceId : secondFaceId;
      const lowFaceId = highFaceId === firstFaceId ? secondFaceId : firstFaceId;
      const centerA = sphere.faces[firstFaceId].center;
      const centerB = sphere.faces[secondFaceId].center;
      const distanceKm = Math.max(
        1,
        Math.acos(clamp(dot3(centerA, centerB), -1, 1)) * radiusKm,
      );
      const slope = elevationDifferenceKm / distanceKm;
      const slopeActivation = clamp((slope - 0.00035) / 0.012, 0, 1);
      if (slopeActivation <= 0) continue;
      const high = cells[highFaceId];
      const low = cells[lowFaceId];
      const mobility = (0.28 + (1 - (high.erosionResistance + low.erosionResistance) * 0.5) * 0.58)
        * (1 - (high.orogenStrength + low.orogenStrength) * 0.21);
      const diffusionCoefficient = clamp(
        (diffusionLengthKm / distanceKm) ** 2 * 0.075,
        0,
        0.12,
      );
      const volumeKm3 = elevationDifferenceKm
        * Math.min(areasKm2[highFaceId], areasKm2[lowFaceId])
        * diffusionCoefficient
        * mobility
        * slopeActivation;
      if (volumeKm3 <= 1e-12) continue;
      transfers.push({ highFaceId, lowFaceId, volumeKm3 });
      outgoingVolumeKm3[highFaceId] += volumeKm3;
    }

    const outgoingScale = new Float64Array(cells.length);
    outgoingScale.fill(1);
    for (const cell of cells) {
      if (!cell.isLand || outgoingVolumeKm3[cell.faceId] <= 0) continue;
      const availableVolumeKm3 = Math.max(
        0,
        elevationsKm[cell.faceId] - seaLevelKm - 0.002,
      ) * areasKm2[cell.faceId] * 0.16;
      outgoingScale[cell.faceId] = Math.min(
        1,
        availableVolumeKm3 / outgoingVolumeKm3[cell.faceId],
      );
    }

    const elevationVolumeDeltaKm3 = new Float64Array(cells.length);
    for (const transfer of transfers) {
      const volumeKm3 = transfer.volumeKm3 * outgoingScale[transfer.highFaceId];
      if (volumeKm3 <= 1e-12) continue;
      elevationVolumeDeltaKm3[transfer.highFaceId] -= volumeKm3;
      elevationVolumeDeltaKm3[transfer.lowFaceId] += volumeKm3;
      cells[transfer.highFaceId].hillslopeErosionKm += volumeKm3 / areasKm2[transfer.highFaceId];
      cells[transfer.lowFaceId].hillslopeDepositionKm += volumeKm3 / areasKm2[transfer.lowFaceId];
      hillslopeErodedVolumeKm3 += volumeKm3;
      hillslopeDepositedVolumeKm3 += volumeKm3;
    }
    for (const cell of cells) {
      if (!cell.isLand || elevationVolumeDeltaKm3[cell.faceId] === 0) continue;
      cell.elevationKm += elevationVolumeDeltaKm3[cell.faceId] / areasKm2[cell.faceId];
    }
  }

  let hillslopeAdjustedCellCount = 0;
  let maximumHillslopeChangeKm = 0;
  for (const cell of cells) {
    if (cell.hillslopeErosionKm > 0 || cell.hillslopeDepositionKm > 0) {
      hillslopeAdjustedCellCount += 1;
    }
    maximumHillslopeChangeKm = Math.max(
      maximumHillslopeChangeKm,
      Math.abs(cell.elevationKm - initialElevationKm[cell.faceId]),
    );
  }
  return {
    hillslopeErodedVolumeKm3,
    hillslopeDepositedVolumeKm3,
    hillslopeResidualKm3: hillslopeErodedVolumeKm3 - hillslopeDepositedVolumeKm3,
    hillslopeAdjustedCellCount,
    maximumHillslopeChangeKm,
  };
}

interface RiverBendWave {
  /** Coherent phase measured from this node downstream through its basin. */
  readonly phaseRadians: number;
  /** Local downstream phase change per kilometre. */
  readonly radiansPerKm: number;
  /** Basin-specific offsets keep bends from repeating as a regular sine. */
  readonly secondaryPhaseRadians: number;
  readonly tertiaryPhaseRadians: number;
}

function riverBendValue(wave: RiverBendWave, phaseRadians: number): number {
  return (
    Math.sin(phaseRadians)
      + Math.sin(phaseRadians * 0.57 + wave.secondaryPhaseRadians) * 0.34
      + Math.sin(phaseRadians * 0.23 + wave.tertiaryPhaseRadians) * 0.16
  ) / 1.5;
}

function createRiverPresentationPoints(
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  riverFaceIds: ReadonlySet<number>,
  seed: number,
  bendWaves: ReadonlyMap<number, RiverBendWave>,
  minimumRiverAreaKm2: number,
  maximumRiverAreaKm2: number,
  isLandAt: (point: Vec3) => boolean,
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
  // Relax the dominant drainage spine substantially farther than the process
  // cell radius. The receiver graph remains authoritative, but this removes
  // the visual memory of successive icosphere edge directions from the shared
  // centerline used by every tributary and downstream segment.
  for (let pass = 0; pass < 5; pass += 1) {
    const next = new Map<number, Vec3>();
    for (const faceId of nodeIds) {
      const center = sphere.faces[faceId].center;
      const upstreamId = dominantIncoming.get(faceId);
      const downstreamId = cells[faceId].isLand ? cells[faceId].receiverFaceId : null;
      const upstream = upstreamId === undefined ? null : points.get(upstreamId) ?? sphere.faces[upstreamId].center;
      const downstream = downstreamId === null ? null : points.get(downstreamId) ?? sphere.faces[downstreamId].center;
      let centerWeight = 0.34;
      let neighborWeight = 0.33;
      if (!upstream || !downstream) {
        centerWeight = 0.64;
        neighborWeight = 0.36;
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
          const hierarchy = Math.max(0, Math.min(1,
            Math.log(Math.max(1, cells[faceId].drainageAreaKm2 / minimumRiverAreaKm2))
              / Math.log(Math.max(2, maximumRiverAreaKm2 / minimumRiverAreaKm2)),
          ));
          const bendWave = bendWaves.get(faceId);
          const coherentBend = bendWave
            ? riverBendValue(bendWave, bendWave.phaseRadians)
            : sphericalNoise(center, seed + 18_821);
          const meander = coherentBend
            * localStep * (0.08 + hierarchy * 0.17)
            * (1 - cells[faceId].orogenStrength * 0.62);
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
      const limit = localStep * 0.68;
      if (displacement > limit) {
        const amount = limit / displacement;
        smoothed = normalize3([
          center[0] * (1 - amount) + smoothed[0] * amount,
          center[1] * (1 - amount) + smoothed[1] * amount,
          center[2] * (1 - amount) + smoothed[2] * amount,
        ]);
      }
      if (cells[faceId].isLand && !cells[faceId].isLake && !isLandAt(smoothed)) {
        // A strongly displaced shared junction can cross a refined coastline
        // even while its canonical face remains land. Back it toward the face
        // center so every adjoining reach inherits the same valid land node.
        let amount = 0.5;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const candidate = normalize3([
            center[0] * (1 - amount) + smoothed[0] * amount,
            center[1] * (1 - amount) + smoothed[1] * amount,
            center[2] * (1 - amount) + smoothed[2] * amount,
          ]);
          if (isLandAt(candidate)) {
            smoothed = candidate;
            break;
          }
          amount *= 0.5;
        }
        if (!isLandAt(smoothed)) smoothed = center;
      }
      next.set(faceId, smoothed);
    }
    points = next;
  }
  return points;
}

function createRiverPresentationTangents(
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  riverFaceIds: ReadonlySet<number>,
  points: ReadonlyMap<number, Vec3>,
): ReadonlyMap<number, Vec3> {
  const dominantIncoming = new Map<number, number>();
  for (const faceId of riverFaceIds) {
    const receiverId = cells[faceId].receiverFaceId;
    if (receiverId === null) continue;
    const incumbent = dominantIncoming.get(receiverId);
    if (incumbent === undefined
      || cells[faceId].drainageAreaKm2 > cells[incumbent].drainageAreaKm2
      || (cells[faceId].drainageAreaKm2 === cells[incumbent].drainageAreaKm2
        && faceId < incumbent)) {
      dominantIncoming.set(receiverId, faceId);
    }
  }
  const tangents = new Map<number, Vec3>();
  for (const [faceId, point] of points) {
    const upstreamId = dominantIncoming.get(faceId);
    const downstreamId = cells[faceId].isLand ? cells[faceId].receiverFaceId : null;
    const upstream = upstreamId === undefined
      ? null
      : points.get(upstreamId) ?? sphere.faces[upstreamId].center;
    const downstream = downstreamId === null
      ? null
      : points.get(downstreamId) ?? sphere.faces[downstreamId].center;
    if (!upstream && !downstream) continue;
    const secondUpstreamId = upstreamId === undefined ? undefined : dominantIncoming.get(upstreamId);
    const secondDownstreamId = downstreamId !== null && cells[downstreamId].isLand
      ? cells[downstreamId].receiverFaceId
      : null;
    const secondUpstream = secondUpstreamId === undefined
      ? upstream
      : points.get(secondUpstreamId) ?? sphere.faces[secondUpstreamId].center;
    const secondDownstream = secondDownstreamId === null
      ? downstream
      : points.get(secondDownstreamId) ?? sphere.faces[secondDownstreamId].center;
    const raw: Vec3 = upstream && downstream
      ? [
        downstream[0] - upstream[0] + ((secondDownstream?.[0] ?? downstream[0]) - (secondUpstream?.[0] ?? upstream[0])) * 0.32,
        downstream[1] - upstream[1] + ((secondDownstream?.[1] ?? downstream[1]) - (secondUpstream?.[1] ?? upstream[1])) * 0.32,
        downstream[2] - upstream[2] + ((secondDownstream?.[2] ?? downstream[2]) - (secondUpstream?.[2] ?? upstream[2])) * 0.32,
      ]
      : downstream
        ? [downstream[0] - point[0], downstream[1] - point[1], downstream[2] - point[2]]
        : [point[0] - upstream![0], point[1] - upstream![1], point[2] - upstream![2]];
    const radial = dot3(raw, point);
    const tangent: Vec3 = [
      raw[0] - point[0] * radial,
      raw[1] - point[1] * radial,
      raw[2] - point[2] * radial,
    ];
    if (dot3(tangent, tangent) > 1e-18) tangents.set(faceId, normalize3(tangent));
  }
  return tangents;
}

function createRiverPresentationPath(
  fromPoint: Vec3,
  toPoint: Vec3,
  fromTangent: Vec3 | undefined,
  toTangent: Vec3 | undefined,
  source: MutableSurfaceCell,
  receiver: MutableSurfaceCell,
  radiusKm: number,
  minimumRiverAreaKm2: number,
  maximumRiverAreaKm2: number,
  bendWave: RiverBendWave,
  refinementScale: number,
  isLandAt: (point: Vec3) => boolean,
): { readonly path: readonly Vec3[]; readonly confinement: number; readonly meanderAmplitudeKm: number } {
  const cosine = clamp(dot3(fromPoint, toPoint), -1, 1);
  const segmentRadians = Math.acos(cosine);
  const segmentKm = Math.max(1, segmentRadians * radiusKm);
  const elevationDropKm = Math.max(0, source.elevationKm - receiver.elevationKm);
  const slope = elevationDropKm / segmentKm;
  const hierarchy = clamp(
    Math.log(Math.max(1, source.drainageAreaKm2 / minimumRiverAreaKm2))
      / Math.log(Math.max(2, maximumRiverAreaKm2 / minimumRiverAreaKm2)),
  );
  const confinement = clamp(
    source.orogenStrength * 0.55
      + clamp(slope / 0.012) * 0.34
      + source.erosionResistance * 0.11,
  );
  const coastClearance = clamp((Math.min(source.coastDistanceKm, receiver.coastDistanceKm) - 12) / 180);
  const meshRelativeAmplitudeRadians = segmentRadians
    * clamp(0.025 + (1 - confinement) * (0.07 + hierarchy * 0.145), 0, 0.24)
    * (0.38 + coastClearance * 0.62)
    * refinementScale;
  // A bend envelope tied only to the current process edge shrinks toward zero
  // as surface resolution increases. Preserve a modest physical cartographic
  // scale, still bounded by this reach and backed down by the land predicate.
  const physicalAmplitudeKm = (10 + hierarchy * 44)
    * (0.28 + (1 - confinement) * 0.72)
    * (0.42 + coastClearance * 0.58)
    * refinementScale;
  let meanderAmplitudeRadians = Math.min(
    segmentRadians * 0.42,
    Math.max(meshRelativeAmplitudeRadians, physicalAmplitudeKm / radiusKm),
  );
  if (meanderAmplitudeRadians <= 1e-12 || segmentRadians <= 1e-10) {
    return { path: [fromPoint, toPoint], confinement, meanderAmplitudeKm: 0 };
  }
  const lateralRaw = cross3(fromPoint, toPoint);
  if (dot3(lateralRaw, lateralRaw) <= 1e-18) {
    return { path: [fromPoint, toPoint], confinement, meanderAmplitudeKm: 0 };
  }
  const lateral = normalize3(lateralRaw);
  const phaseAdvance = Math.min(Math.PI * 2.5, segmentKm * bendWave.radiansPerKm);
  const pointCount = Math.min(17, Math.max(
    7,
    7 + Math.ceil(phaseAdvance / Math.PI) * 2 + (hierarchy > 0.62 ? 2 : 0),
  ));
  const waveAt = (phase: number): number => riverBendValue(bendWave, phase);
  const startWave = waveAt(bendWave.phaseRadians);
  const endWave = waveAt(bendWave.phaseRadians - phaseAdvance);
  const buildPath = (amplitudeRadians: number, tangentScale: number): Vec3[] => {
    const path: Vec3[] = [];
    for (let index = 0; index < pointCount; index += 1) {
      const progress = index / (pointCount - 1);
      if (index === 0) {
        path.push(fromPoint);
        continue;
      }
      if (index === pointCount - 1) {
        path.push(toPoint);
        continue;
      }
      const progress2 = progress * progress;
      const progress3 = progress2 * progress;
      const h00 = 2 * progress3 - 3 * progress2 + 1;
      const h10 = progress3 - 2 * progress2 + progress;
      const h01 = -2 * progress3 + 3 * progress2;
      const h11 = progress3 - progress2;
      const tangentLength = 2 * Math.sin(segmentRadians * 0.5) * tangentScale;
      const base = normalize3([
        fromPoint[0] * h00 + (fromTangent?.[0] ?? 0) * tangentLength * h10
          + toPoint[0] * h01 + (toTangent?.[0] ?? 0) * tangentLength * h11,
        fromPoint[1] * h00 + (fromTangent?.[1] ?? 0) * tangentLength * h10
          + toPoint[1] * h01 + (toTangent?.[1] ?? 0) * tangentLength * h11,
        fromPoint[2] * h00 + (fromTangent?.[2] ?? 0) * tangentLength * h10
          + toPoint[2] * h01 + (toTangent?.[2] ?? 0) * tangentLength * h11,
      ]);
      // Evaluate a physical-distance wavelength shared by the whole drainage
      // chain. Removing the linear endpoint chord keeps adjacent segments
      // joined at exactly the same node without forcing one oscillation into
      // every triangular process edge.
      const wave = waveAt(bendWave.phaseRadians - phaseAdvance * progress);
      const endpointChord = startWave * (1 - progress) + endWave * progress;
      const bend = wave - endpointChord;
      const envelope = Math.sin(Math.PI * progress) ** 0.55;
      const offset = amplitudeRadians * envelope * bend * 1.45;
      path.push(normalize3([
        base[0] + lateral[0] * offset,
        base[1] + lateral[1] * offset,
        base[2] + lateral[2] * offset,
      ]));
    }
    return path;
  };
  let tangentScale = 0.46;
  let path = buildPath(meanderAmplitudeRadians, tangentScale);
  for (let attempt = 0; attempt < 8 && path.slice(1, -1).some((point) => !isLandAt(point)); attempt += 1) {
    meanderAmplitudeRadians *= 0.5;
    tangentScale *= 0.7;
    path = buildPath(meanderAmplitudeRadians, tangentScale);
  }
  return {
    path,
    confinement,
    meanderAmplitudeKm: meanderAmplitudeRadians * radiusKm,
  };
}

function createRiverBendWaves(
  cells: readonly MutableSurfaceCell[],
  sphere: GeodesicSphere,
  riverCells: readonly MutableSurfaceCell[],
  minimumRiverAreaKm2: number,
  maximumRiverAreaKm2: number,
  radiusKm: number,
  seed: number,
): ReadonlyMap<number, RiverBendWave> {
  const terminalByFaceId = new Map<number, number>();
  const phaseToOutletByFaceId = new Map<number, number>();
  const wavenumberFor = (faceId: number): number => {
    const cell = cells[faceId];
    const hierarchy = Math.max(0, Math.min(1,
      Math.log(Math.max(1, cell.drainageAreaKm2 / minimumRiverAreaKm2))
        / Math.log(Math.max(2, maximumRiverAreaKm2 / minimumRiverAreaKm2)),
    ));
    // Wavelength grows continuously from tributaries to trunk rivers instead
    // of inheriting the icosphere edge length. The values are cartographic
    // centerline scales; canonical discharge and receivers remain unchanged.
    const wavelengthKm = 110 + hierarchy * 540;
    return Math.PI * 2 / wavelengthKm;
  };
  const resolve = (startFaceId: number): { terminalId: number; phaseToOutlet: number } => {
    const path: Array<{ faceId: number; phaseAdvance: number }> = [];
    let faceId = startFaceId;
    const seen = new Set<number>();
    let terminalId = faceId;
    let phaseToOutlet = 0;
    while (true) {
      const memoizedTerminal = terminalByFaceId.get(faceId);
      const memoizedPhase = phaseToOutletByFaceId.get(faceId);
      if (memoizedTerminal !== undefined && memoizedPhase !== undefined) {
        terminalId = memoizedTerminal;
        phaseToOutlet = memoizedPhase;
        break;
      }
      if (seen.has(faceId)) {
        terminalId = faceId;
        phaseToOutlet = 0;
        break;
      }
      seen.add(faceId);
      const receiverId = cells[faceId].receiverFaceId;
      if (receiverId !== null) {
        const segmentKm = Math.acos(Math.max(-1, Math.min(1,
          dot3(sphere.faces[faceId].center, sphere.faces[receiverId].center),
        ))) * radiusKm;
        path.push({ faceId, phaseAdvance: segmentKm * wavenumberFor(faceId) });
      }
      if (receiverId === null || !cells[receiverId].isLand || cells[receiverId].isLake) {
        terminalId = receiverId ?? faceId;
        phaseToOutlet = 0;
        break;
      }
      faceId = receiverId;
    }
    for (let index = path.length - 1; index >= 0; index -= 1) {
      phaseToOutlet += path[index].phaseAdvance;
      terminalByFaceId.set(path[index].faceId, terminalId);
      phaseToOutletByFaceId.set(path[index].faceId, phaseToOutlet);
    }
    return {
      terminalId: terminalByFaceId.get(startFaceId) ?? terminalId,
      phaseToOutlet: phaseToOutletByFaceId.get(startFaceId) ?? phaseToOutlet,
    };
  };
  return new Map(riverCells.map((cell) => {
    const resolved = resolve(cell.faceId);
    const basinPhase = seedHash(`${seed}:channel-basin:${resolved.terminalId}`)
      / 0x1_0000_0000 * Math.PI * 2;
    const secondaryPhaseRadians = seedHash(`${seed}:channel-secondary:${resolved.terminalId}`)
      / 0x1_0000_0000 * Math.PI * 2;
    const tertiaryPhaseRadians = seedHash(`${seed}:channel-tertiary:${resolved.terminalId}`)
      / 0x1_0000_0000 * Math.PI * 2;
    return [cell.faceId, {
      phaseRadians: basinPhase + resolved.phaseToOutlet,
      radiansPerKm: wavenumberFor(cell.faceId),
      secondaryPhaseRadians,
      tertiaryPhaseRadians,
    }] as const;
  }));
}

function riverPresentationDiagnostics(
  rivers: readonly SurfaceRiverSegment[],
  sphere: GeodesicSphere,
): {
  readonly meanRiverSinuosity: number;
  readonly meanRiverMeanderAmplitudeKm: number;
  readonly meanNeighboringChannelAlignment: number;
} {
  if (rivers.length === 0) {
    return {
      meanRiverSinuosity: 1,
      meanRiverMeanderAmplitudeKm: 0,
      meanNeighboringChannelAlignment: 0,
    };
  }
  let sinuosity = 0;
  let amplitudeKm = 0;
  const byFaceId = new Map(rivers.map((river) => [river.fromFaceId, river] as const));
  const tangentAtSource = (river: SurfaceRiverSegment): Vec3 | null => {
    const point = river.fromPoint;
    const target = river.path[1] ?? river.toPoint;
    const raw: Vec3 = [target[0] - point[0], target[1] - point[1], target[2] - point[2]];
    const radial = dot3(raw, point);
    const tangent: Vec3 = [
      raw[0] - point[0] * radial,
      raw[1] - point[1] * radial,
      raw[2] - point[2] * radial,
    ];
    return dot3(tangent, tangent) > 1e-18 ? normalize3(tangent) : null;
  };
  for (const river of rivers) {
    let pathLength = 0;
    for (let index = 0; index < river.path.length - 1; index += 1) {
      pathLength += Math.acos(clamp(dot3(river.path[index], river.path[index + 1]), -1, 1));
    }
    const direct = Math.acos(clamp(dot3(river.fromPoint, river.toPoint), -1, 1));
    sinuosity += direct > 1e-12 ? pathLength / direct : 1;
    amplitudeKm += river.meanderAmplitudeKm;
  }
  let alignment = 0;
  let alignmentPairs = 0;
  for (const edge of sphere.edges) {
    const first = byFaceId.get(edge.faces[0]);
    const second = byFaceId.get(edge.faces[1]);
    if (!first || !second) continue;
    const firstTangent = tangentAtSource(first);
    const secondTangent = tangentAtSource(second);
    if (!firstTangent || !secondTangent) continue;
    const anchor = first.fromPoint;
    const radial = dot3(secondTangent, anchor);
    const transported: Vec3 = [
      secondTangent[0] - anchor[0] * radial,
      secondTangent[1] - anchor[1] * radial,
      secondTangent[2] - anchor[2] * radial,
    ];
    if (dot3(transported, transported) <= 1e-18) continue;
    alignment += Math.max(0, dot3(firstTangent, normalize3(transported)));
    alignmentPairs += 1;
  }
  return {
    meanRiverSinuosity: sinuosity / rivers.length,
    meanRiverMeanderAmplitudeKm: amplitudeKm / rivers.length,
    meanNeighboringChannelAlignment: alignmentPairs > 0 ? alignment / alignmentPairs : 0,
  };
}

function createMouthDistributaries(
  landform: SurfaceCoastalLandform,
  mainPath: readonly Vec3[],
  coastVertices: readonly [Vec3, Vec3] | undefined,
  sedimentSupplyIndex: number,
): readonly (readonly Vec3[])[] {
  if (!coastVertices || (landform !== "delta" && landform !== "alluvial-fan")) return [];
  const branchCount = landform === "delta" && sedimentSupplyIndex > 0.72 ? 3 : 2;
  const branchSource = mainPath[Math.max(0, mainPath.length - 2)];
  const [coastA, coastB] = coastVertices;
  const span = landform === "delta" ? 0.44 : 0.24;
  return Array.from({ length: branchCount }, (_, index) => {
    const normalizedIndex = index / (branchCount - 1);
    const along = 0.5 - span * 0.5 + span * normalizedIndex;
    const endpoint = normalize3([
      coastA[0] * (1 - along) + coastB[0] * along,
      coastA[1] * (1 - along) + coastB[1] * along,
      coastA[2] * (1 - along) + coastB[2] * along,
    ]);
    const middle = normalize3([
      branchSource[0] * 0.55 + endpoint[0] * 0.45,
      branchSource[1] * 0.55 + endpoint[1] * 0.45,
      branchSource[2] * 0.55 + endpoint[2] * 0.45,
    ]);
    return [branchSource, middle, endpoint];
  });
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
    coastalGeomorphologyScale: options.coastalGeomorphologyScale ?? 1,
    reliefPasses: 2,
  });
  const refinementAudit = refinement.audit();
  if (!refinementAudit.topologyAnchorsPreserved) {
    throw new Error("surface process refinement changed a canonical topology anchor");
  }
  const reliefAmplitudeKm = clamp(options.reliefAmplitudeKm ?? 0.34, 0, 1.25);
  const valleyReliefScale = clamp(options.valleyReliefScale ?? 1, 0, 2.5);
  const channelRefinementScale = clamp(options.channelRefinementScale ?? 1, 0, 2);
  const continentalReliefScale = clamp(options.continentalReliefScale ?? 1, 0, 2);
  const flexuralReliefScale = clamp(options.flexuralReliefScale ?? 1, 0, 2);
  const coastalPlainScale = clamp(options.coastalPlainScale ?? 1, 0, 2);
  const hashedSeed = seedHash(tectonicWorld.recipe.seed);
  const geologyContext = canonicalGeologyContext(tectonicWorld);
  const presentationDetailBands = createPresentationDetailBands(hashedSeed);
  const physicalReliefBands = createPhysicalReliefBands(
    hashedSeed + 23_911,
    tectonicWorld.recipe.radiusKm,
  );
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
    const canonicalMargin = geologyContext.margins[canonicalFaceId];
    const orogenicAboveSea = refined.isLand
      ? shapedOrogenicHeight(rawAboveSea, orogeny, face.center, hashedSeed)
      : rawAboveSea;
    const continentalReliefKm = refined.isLand
      ? continentalReliefAt(
        face.center,
        geologyContext.continentalRelief.centers,
        tectonicWorld.recipe.radiusKm,
      ) * continentalReliefScale
      : 0;
    const flexuralReliefKm = refined.isLand
      ? flexuralRelief(orogenicAboveSea + continentalReliefKm, orogeny, flexuralReliefScale)
      : 0;
    const aboveSea = orogenicAboveSea + continentalReliefKm + flexuralReliefKm;
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
      canonicalMargin.activeBoundaryStrength,
      orogeny.forelandBasinStrength,
      hashedSeed,
    );
    const physicalRelief = samplePhysicalRelief(face.center, physicalReliefBands);
    const noise = physicalRelief.noise;
    const ridge = physicalRelief.ridge;
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
    const activeMarginStrength = refined.isLand
      ? clamp(canonicalMargin.activeBoundaryStrength
        * (0.72 + refined.coastalRuggedness * 0.28))
      : 0;
    const passiveMarginStrength = refined.isLand
      ? clamp(
        (1 - activeMarginStrength) ** 1.35
          * (1 - orogeny.strength * 0.62)
          * (0.78 + refined.coastalSedimentAffinity * 0.22),
      )
      : 0;
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
      forelandBasinStrength: orogeny.forelandBasinStrength,
      flexuralBulgeStrength: orogeny.flexuralBulgeStrength,
      flexuralReliefKm,
      activeMarginStrength,
      passiveMarginStrength,
      marginRegime: "interior",
      coastalPlainStrength: 0,
      coastalPlainReliefKm: 0,
      localRunoffKm3PerYear: 0,
      sedimentExportKm3: 0,
      erodedThicknessKm: 0,
      depositedThicknessKm: 0,
      spillwayIncisionKm: Math.max(0, preSpillwayElevationKm - elevationKm),
      hillslopeErosionKm: 0,
      hillslopeDepositionKm: 0,
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
  const coastalMarginStats = applyCoastalMargins(
    cells,
    sphere,
    tectonicWorld.seaLevelKm,
    tectonicWorld.recipe.radiusKm,
    coastalPlainScale,
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
  const largeBasinOutletScale = clamp(options.largeBasinOutletScale ?? 1, 0, 2.5);
  const initialDepressionEvolution: DepressionEvolutionResult = hierarchyAnchor
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
      largeBasinOutletScale,
    );
  const evolvedDrainage = initialDepressionEvolution.spillwayCellCount > 0 && !hierarchyAnchor
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
  const hillslopeDiffusion = diffuseHillslopes(
    cells,
    sphere,
    tectonicWorld.seaLevelKm,
    tectonicWorld.recipe.radiusKm,
    clamp(options.hillslopeDiffusionLengthKm ?? 42, 0, 180),
    Math.round(clamp(options.hillslopeDiffusionPasses ?? 4, 0, 8)),
  );
  const postDiffusionDrainage = routeSurfaceHydrology(
    cells,
    sphere,
    adjacency,
    tectonicWorld.recipe.radiusKm,
    hierarchyAnchor,
  );
  // Erosion and hillslope transport can expose a lower sill or create a new
  // connected fill basin. Give those final process elevations one more
  // geological outlet-evolution pass before solving the annual lake surface.
  // This is especially important for large overflowing basins: classifying a
  // lake after the only incision pass made their retained geometry depend on
  // operation order rather than long-timescale hydraulics.
  const finalDepressionEvolution = !hierarchyAnchor && depressionEvolutionMode === "hybrid"
    ? evolveSurfaceDepressions(
      cells,
      sphere,
      adjacency,
      tectonicWorld.seaLevelKm,
      tectonicWorld.recipe.radiusKm,
      minimumLakeCatchmentKm2,
      spillwayErosionScale,
      largeBasinOutletScale,
    )
    : null;
  const finalDrainage = finalDepressionEvolution?.spillwayCellCount
    ? routeSurfaceHydrology(
      cells,
      sphere,
      adjacency,
      tectonicWorld.recipe.radiusKm,
    )
    : postDiffusionDrainage;
  const depressionEvolution: DepressionEvolutionResult = finalDepressionEvolution
    ? {
      breachedBasinCount: initialDepressionEvolution.breachedBasinCount
        + finalDepressionEvolution.breachedBasinCount,
      preservedBasinCount: finalDepressionEvolution.preservedBasinCount,
      spillwayCellCount: cells.filter((cell) => cell.spillwayIncisionKm > 0).length,
      spillwayExcavatedVolumeKm3: initialDepressionEvolution.spillwayExcavatedVolumeKm3
        + finalDepressionEvolution.spillwayExcavatedVolumeKm3,
      maximumSpillwayIncisionKm: Math.max(
        initialDepressionEvolution.maximumSpillwayIncisionKm,
        finalDepressionEvolution.maximumSpillwayIncisionKm,
      ),
    }
    : initialDepressionEvolution;

  for (const cell of cells) {
    cell.lakeDepthKm = cell.isLand ? Math.max(0, cell.fillDepthKm) : 0;
    cell.isLake = false;
  }
  const openWaterEvaporationScale = clamp(options.openWaterEvaporationScale ?? 1.05, 0.4, 2.5);
  const lakeSeasonalityScale = clamp(options.lakeSeasonalityScale ?? 1, 0, 2);
  const resolvedLakeBalance = hierarchyAnchor
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
  const seasonalLakeBalance = simulateSeasonalLakeBalance(
    cells,
    sphere,
    finalDrainage.downstreamOrder,
    resolvedLakeBalance.bodies,
    tectonicWorld,
    lakeSeasonalityScale,
  );
  const lakeBalance: LakeBalanceResult = {
    ...resolvedLakeBalance,
    evaporationSinkKm3PerYear: seasonalLakeBalance.evaporationSinkKm3PerYear,
    closedLakeBodyCount: seasonalLakeBalance.closedLakeBodyCount,
    overflowingLakeBodyCount: seasonalLakeBalance.overflowingLakeBodyCount,
    overflowOutletFaceIds: seasonalLakeBalance.overflowOutletFaceIds,
    bodies: seasonalLakeBalance.bodies,
  };
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
  const maximumResolvedRiverAreaKm2 = riverCells.reduce(
    (maximum, cell) => Math.max(maximum, cell.drainageAreaKm2),
    minimumRiverAreaKm2,
  );
  const riverBendWaves = createRiverBendWaves(
    cells,
    sphere,
    riverCells,
    minimumRiverAreaKm2,
    maximumResolvedRiverAreaKm2,
    tectonicWorld.recipe.radiusKm,
    hashedSeed,
  );
  const riverPresentationPoints = createRiverPresentationPoints(
    cells,
    sphere,
    adjacency,
    riverFaceIds,
    hashedSeed,
    riverBendWaves,
    minimumRiverAreaKm2,
    maximumResolvedRiverAreaKm2,
    (point) => refinement.sample(point).isLand,
  );
  const riverPresentationTangents = createRiverPresentationTangents(
    cells,
    sphere,
    riverFaceIds,
    riverPresentationPoints,
  );
  const boundaryVerticesByPair = new Map<string, readonly [Vec3, Vec3]>();
  for (const edge of sphere.edges) {
    const low = Math.min(edge.faces[0], edge.faces[1]);
    const high = Math.max(edge.faces[0], edge.faces[1]);
    boundaryVerticesByPair.set(
      `${low}:${high}`,
      edge.vertices.map((vertexId) => sphere.vertices[vertexId].position) as unknown as readonly [Vec3, Vec3],
    );
  }
  const rivers: SurfaceRiverSegment[] = riverCells.map((cell) => {
    const receiverFaceId = cell.receiverFaceId as number;
    const receiver = cells[receiverFaceId];
    const low = Math.min(cell.faceId, receiverFaceId);
    const high = Math.max(cell.faceId, receiverFaceId);
    const coastVertices = boundaryVerticesByPair.get(`${low}:${high}`);
    const terminalWater = !receiver.isLand || (receiver.isLake && !cell.isLake);
    const fromPoint = riverPresentationPoints.get(cell.faceId) ?? sphere.faces[cell.faceId].center;
    const toPoint = terminalWater && coastVertices
      ? normalize3([
        coastVertices[0][0] + coastVertices[1][0],
        coastVertices[0][1] + coastVertices[1][1],
        coastVertices[0][2] + coastVertices[1][2],
      ])
      : riverPresentationPoints.get(receiverFaceId) ?? sphere.faces[receiverFaceId].center;
    const channel = createRiverPresentationPath(
      fromPoint,
      toPoint,
      riverPresentationTangents.get(cell.faceId),
      riverPresentationTangents.get(receiverFaceId),
      cell,
      receiver,
      tectonicWorld.recipe.radiusKm,
      minimumRiverAreaKm2,
      maximumResolvedRiverAreaKm2,
      riverBendWaves.get(cell.faceId) ?? {
        phaseRadians: 0,
        radiansPerKm: 0,
        secondaryPhaseRadians: 0,
        tertiaryPhaseRadians: 0,
      },
      channelRefinementScale,
      (point) => refinement.sample(point).isLand,
    );
    return {
      fromFaceId: cell.faceId,
      toFaceId: receiverFaceId,
      fromPoint,
      toPoint,
      path: channel.path,
      confinement: channel.confinement,
      meanderAmplitudeKm: channel.meanderAmplitudeKm,
      drainageAreaKm2: cell.drainageAreaKm2,
      dischargeKm3PerYear: cell.dischargeKm3PerYear,
    };
  });
  const maximumTerminalSedimentFluxKm3 = cells.reduce(
    (maximum, cell) => Math.max(maximum, cell.sedimentExportKm3),
    0,
  );
  const riverMouths: SurfaceRiverMouth[] = rivers.flatMap((river) => {
    const source = cells[river.fromFaceId];
    const receiver = cells[river.toFaceId];
    const receivingWater = !receiver.isLand
      ? "ocean"
      : receiver.isLake && !source.isLake
        ? "lake"
        : null;
    if (receivingWater === null) return [];
    const distanceKm = Math.max(
      1,
      Math.acos(clamp(dot3(river.fromPoint, river.toPoint), -1, 1)) * tectonicWorld.recipe.radiusKm,
    );
    const slope = Math.max(0, source.elevationKm - receiver.elevationKm) / distanceKm;
    const hierarchy = clamp(
      Math.log(Math.max(1, river.drainageAreaKm2 / minimumRiverAreaKm2))
        / Math.log(Math.max(2, maximumResolvedRiverAreaKm2 / minimumRiverAreaKm2)),
    );
    const sedimentFluxKm3 = receivingWater === "ocean" ? source.sedimentExportKm3 : 0;
    const fluxHierarchy = maximumTerminalSedimentFluxKm3 > 0
      ? clamp(Math.log1p(sedimentFluxKm3) / Math.log1p(maximumTerminalSedimentFluxKm3))
      : 0;
    const sedimentSupplyIndex = clamp(
      fluxHierarchy * 0.42
        + hierarchy * 0.25
        + clamp((source.depositedThicknessKm + source.hillslopeDepositionKm) / 0.08) * 0.18
        + (1 - source.erosionResistance) * 0.15,
    );
    const coastalRuggedness = refinement.sample(river.toPoint).coastalRuggedness;
    const landform: SurfaceCoastalLandform = receivingWater === "lake"
      ? "lake-inflow"
      : source.orogenStrength > 0.48
          && coastalRuggedness > 0.15
          && slope > 0.015
        ? "alluvial-fan"
        : sedimentSupplyIndex > 0.32
            && source.passiveMarginStrength > 0.32
            && coastalRuggedness < 0.62
            && slope < 0.03
          ? "delta"
          : coastalRuggedness > 0.55 || sedimentSupplyIndex < 0.28
            ? "estuary"
            : "simple-mouth";
    const low = Math.min(river.fromFaceId, river.toFaceId);
    const high = Math.max(river.fromFaceId, river.toFaceId);
    const distributaries = createMouthDistributaries(
      landform,
      river.path,
      boundaryVerticesByPair.get(`${low}:${high}`),
      sedimentSupplyIndex,
    );
    const deltaPlainRadiusKm = landform === "delta"
      ? 16 + sedimentSupplyIndex * 58 + hierarchy * 30
      : landform === "alluvial-fan"
        ? 9 + sedimentSupplyIndex * 30 + hierarchy * 12
        : 0;
    const deltaProgradationKm = landform === "delta"
      ? clamp(1.5 + fluxHierarchy * 11 + hierarchy * 5.5, 0, 18)
      : landform === "alluvial-fan"
        ? clamp(1 + fluxHierarchy * 4, 0, 6)
        : 0;
    return [{
      fromFaceId: river.fromFaceId,
      toFaceId: river.toFaceId,
      point: river.toPoint,
      receivingWater,
      landform,
      sedimentSupplyIndex,
      sedimentFluxKm3,
      deltaPlainRadiusKm,
      deltaProgradationKm,
      distributaries,
      drainageAreaKm2: river.drainageAreaKm2,
      dischargeKm3PerYear: river.dischargeKm3PerYear,
    }];
  });
  const coastalLandformCounts = emptyCoastalLandformRecord();
  for (const mouth of riverMouths) coastalLandformCounts[mouth.landform] += 1;
  const riverDiagnostics = riverPresentationDiagnostics(rivers, sphere);

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
    forelandBasinStrength: cell.forelandBasinStrength,
    flexuralBulgeStrength: cell.flexuralBulgeStrength,
    flexuralReliefKm: cell.flexuralReliefKm,
    activeMarginStrength: cell.activeMarginStrength,
    passiveMarginStrength: cell.passiveMarginStrength,
    marginRegime: cell.marginRegime,
    coastalPlainStrength: cell.coastalPlainStrength,
    coastalPlainReliefKm: cell.coastalPlainReliefKm,
    localRunoffKm3PerYear: cell.localRunoffKm3PerYear,
    erodedThicknessKm: cell.erodedThicknessKm,
    depositedThicknessKm: cell.depositedThicknessKm,
    spillwayIncisionKm: cell.spillwayIncisionKm,
    hillslopeErosionKm: cell.hillslopeErosionKm,
    hillslopeDepositionKm: cell.hillslopeDepositionKm,
    receiverFaceId: cell.receiverFaceId,
    drainageAreaKm2: cell.drainageAreaKm2,
    dischargeKm3PerYear: cell.dischargeKm3PerYear,
  }));
  const riverByFaceId = new Map(rivers.map((river) => [river.fromFaceId, river] as const));
  const maximumRiverDrainageAreaKm2 = rivers.reduce(
    (maximum, river) => Math.max(maximum, river.drainageAreaKm2),
    minimumRiverAreaKm2,
  );
  const centers = sphere.faces.map((face) => face.center);
  const root = buildKdTree(sphere.faces.map((face) => face.id), centers);
  if (!root) throw new Error("surface process grid must contain faces");
  const requestedPresentationSampleCount = Math.round(clamp(
    options.presentationSampleCount ?? 12,
    6,
    24,
  ));
  // K-nearest Gaussian neighborhoods can change membership exactly on a
  // Voronoi edge. Restrict the public setting to calibrated support tiers
  // whose omitted tail is negligible on this mesh, avoiding rare terrain
  // seams while keeping whole-atlas sampling bounded.
  const presentationSampleCount = requestedPresentationSampleCount <= 14
    ? 12
    : requestedPresentationSampleCount <= 20
      ? 16
      : 24;
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
    let hillslopeChangeKm = 0;
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
    let forelandBasinStrength = 0;
    let flexuralBulgeStrength = 0;
    let flexuralReliefKm = 0;
    let activeMarginStrength = 0;
    let passiveMarginStrength = 0;
    let coastalPlainStrength = 0;
    let coastalPlainReliefKm = 0;
    for (const faceId of candidates) {
      const weight = Math.exp((dot3(centers[faceId], point) - 1) * kernelSharpness);
      const cell = immutableCells[faceId];
      totalWeight += weight;
      elevationKm += cell.elevationKm * weight;
      fillDepthKm += cell.fillDepthKm * weight;
      spillwayIncisionKm += cell.spillwayIncisionKm * weight;
      hillslopeChangeKm += (cell.hillslopeDepositionKm - cell.hillslopeErosionKm) * weight;
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
      forelandBasinStrength += cell.forelandBasinStrength * weight;
      flexuralBulgeStrength += cell.flexuralBulgeStrength * weight;
      flexuralReliefKm += cell.flexuralReliefKm * weight;
      activeMarginStrength += cell.activeMarginStrength * weight;
      passiveMarginStrength += cell.passiveMarginStrength * weight;
      coastalPlainStrength += cell.coastalPlainStrength * weight;
      coastalPlainReliefKm += cell.coastalPlainReliefKm * weight;
    }
    elevationKm /= totalWeight;
    fillDepthKm /= totalWeight;
    spillwayIncisionKm /= totalWeight;
    hillslopeChangeKm /= totalWeight;
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
    forelandBasinStrength /= totalWeight;
    flexuralBulgeStrength /= totalWeight;
    flexuralReliefKm /= totalWeight;
    activeMarginStrength /= totalWeight;
    passiveMarginStrength /= totalWeight;
    coastalPlainStrength /= totalWeight;
    coastalPlainReliefKm /= totalWeight;
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
    let valleyIncisionKm = 0;
    let valleyGradient: Vec3 = [0, 0, 0];
    if (refined.isLand && valleyReliefScale > 0) {
      for (const faceId of candidateIds) {
        const river = riverByFaceId.get(faceId);
        if (!river) continue;
        let nearest: Vec3 | null = null;
        let cosine = -1;
        let distanceKm = Infinity;
        for (let pathIndex = 0; pathIndex + 1 < river.path.length; pathIndex += 1) {
          const from = river.path[pathIndex];
          const to = river.path[pathIndex + 1];
          const chord: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
          const chordLengthSquared = dot3(chord, chord);
          if (chordLengthSquared <= 1e-16) continue;
          const fromToPoint: Vec3 = [point[0] - from[0], point[1] - from[1], point[2] - from[2]];
          const segmentT = clamp(dot3(fromToPoint, chord) / chordLengthSquared, 0, 1);
          const candidate = normalize3([
            from[0] + chord[0] * segmentT,
            from[1] + chord[1] * segmentT,
            from[2] + chord[2] * segmentT,
          ]);
          const candidateCosine = clamp(dot3(candidate, point), -1, 1);
          const candidateDistanceKm = Math.acos(candidateCosine) * tectonicWorld.recipe.radiusKm;
          if (candidateDistanceKm < distanceKm) {
            nearest = candidate;
            cosine = candidateCosine;
            distanceKm = candidateDistanceKm;
          }
        }
        if (!nearest) continue;
        const hierarchy = clamp(
          Math.log(Math.max(1, river.drainageAreaKm2 / minimumRiverAreaKm2))
            / Math.log(Math.max(2, maximumRiverDrainageAreaKm2 / minimumRiverAreaKm2)),
          0,
          1,
        );
        const widthKm = 6 + hierarchy * 24;
        if (distanceKm > widthKm * 3.2) continue;
        const source = immutableCells[river.fromFaceId];
        const depthKm = Math.min(
          0.28,
          0.018
            + source.erodedThicknessKm * 0.42
            + hierarchy * 0.13
            + source.orogenStrength * hierarchy * 0.035,
        ) * (0.82 + (1 - source.erosionResistance) * 0.28) * valleyReliefScale;
        const kernel = Math.exp(-0.5 * (distanceKm / widthKm) ** 2);
        const incisionKm = depthKm * kernel;
        if (incisionKm <= valleyIncisionKm) continue;
        valleyIncisionKm = incisionKm;
        if (distanceKm > 1e-6) {
          const outward: Vec3 = [
            point[0] - nearest[0] * cosine,
            point[1] - nearest[1] * cosine,
            point[2] - nearest[2] * cosine,
          ];
          if (dot3(outward, outward) > 1e-18) {
            const tangent = normalize3(outward);
            const slope = depthKm * kernel * distanceKm / widthKm ** 2;
            valleyGradient = [tangent[0] * slope, tangent[1] * slope, tangent[2] * slope];
          }
        }
      }
    }
    gradient[0] += valleyGradient[0];
    gradient[1] += valleyGradient[1];
    gradient[2] += valleyGradient[2];
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
      ? Math.max(
        tectonicWorld.seaLevelKm + 0.001,
        elevationKm + fineRelief - valleyIncisionKm,
      )
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
      hillslopeChangeKm,
      valleyIncisionKm,
      coastDistanceKm,
      coastalRuggedness: refined.coastalRuggedness,
      coastalSedimentAffinity: refined.coastalSedimentAffinity,
      activeMarginStrength,
      passiveMarginStrength,
      marginRegime: nearestMatchingCell.marginRegime,
      coastalPlainStrength,
      coastalPlainReliefKm,
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
      forelandBasinStrength,
      flexuralBulgeStrength,
      flexuralReliefKm,
      surfaceTexture,
      terrainGradient: gradient,
      presentationOnly: true,
    };
  };
  const lakeAreaKm2 = lakeBalance.bodies.reduce((sum, lake) => sum + lake.areaKm2, 0);
  const totalLakeVolumeKm3 = lakeBalance.bodies.reduce(
    (sum, lake) => sum + lake.volumeKm3,
    0,
  );
  const largestLakeAreaKm2 = lakeBalance.bodies.reduce(
    (maximum, lake) => Math.max(maximum, lake.areaKm2),
    0,
  );
  const largestLakeVolumeKm3 = lakeBalance.bodies.reduce(
    (maximum, lake) => Math.max(maximum, lake.volumeKm3),
    0,
  );
  return {
    version: 1,
    tectonicWorld,
    sphere,
    cells: immutableCells,
    rivers,
    riverMouths,
    lakes: lakeBalance.bodies,
    stats: {
      landFraction: landArea / sphere.totalAreaSteradians,
      landCellCount: cells.filter((cell) => cell.isLand).length,
      oceanCellCount: cells.filter((cell) => !cell.isLand).length,
      lakeCellCount: cells.filter((cell) => cell.isLake).length,
      lakeAreaKm2,
      lakeBodyCount: lakeBalance.lakeBodyCount,
      closedLakeBodyCount: lakeBalance.closedLakeBodyCount,
      overflowingLakeBodyCount: lakeBalance.overflowingLakeBodyCount,
      lakeEvaporationKm3PerYear: balancedRunoff.lakeEvaporationKm3PerYear,
      totalLakeVolumeKm3,
      largestLakeAreaKm2,
      largestLakeVolumeKm3,
      dominantLakeAreaFraction: lakeAreaKm2 > 0 ? largestLakeAreaKm2 / lakeAreaKm2 : 0,
      perennialLakeBodyCount: seasonalLakeBalance.perennialLakeBodyCount,
      ephemeralLakeBodyCount: seasonalLakeBalance.ephemeralLakeBodyCount,
      longLivedLakeBodyCount: seasonalLakeBalance.longLivedLakeBodyCount,
      seasonallyOverflowingLakeBodyCount: seasonalLakeBalance.seasonallyOverflowingLakeBodyCount,
      meanLakeSeasonalLevelRangeM: seasonalLakeBalance.meanLakeSeasonalLevelRangeM,
      maximumLakeSeasonalLevelRangeM: seasonalLakeBalance.maximumLakeSeasonalLevelRangeM,
      seasonalLakeWaterResidualKm3PerYear: seasonalLakeBalance.seasonalLakeWaterResidualKm3PerYear,
      riverSegmentCount: rivers.length,
      ...riverDiagnostics,
      riverMouthCount: riverMouths.length,
      oceanRiverMouthCount: riverMouths.filter((mouth) => mouth.receivingWater === "ocean").length,
      lakeInflowCount: riverMouths.filter((mouth) => mouth.receivingWater === "lake").length,
      coastalLandformCounts,
      maximumDrainageAreaKm2: cells.reduce((maximum, cell) => Math.max(maximum, cell.drainageAreaKm2), 0),
      maximumDischargeKm3PerYear: cells.reduce((maximum, cell) => Math.max(maximum, cell.dischargeKm3PerYear), 0),
      totalLocalRunoffKm3PerYear: totalRunoff,
      totalOutletRunoffKm3PerYear: balancedRunoff.outletRunoffKm3PerYear,
      runoffResidualKm3PerYear: totalRunoff
        - balancedRunoff.outletRunoffKm3PerYear
        - balancedRunoff.lakeEvaporationKm3PerYear,
      maximumFillDepthKm: cells.reduce((maximum, cell) => Math.max(maximum, cell.fillDepthKm), 0),
      ...depressionEvolution,
      ...hillslopeDiffusion,
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
      continentalReliefCenterCount: geologyContext.continentalRelief.centerCount,
      maximumContinentalReliefKm: geologyContext.continentalRelief.maximumSupportKm
        * continentalReliefScale,
      forelandBasinCellCount: cells.filter((cell) => (
        cell.isLand && cell.forelandBasinStrength >= 0.25
      )).length,
      flexuralBulgeCellCount: cells.filter((cell) => (
        cell.isLand && cell.flexuralBulgeStrength >= 0.2
      )).length,
      maximumForelandSubsidenceKm: cells.reduce(
        (maximum, cell) => Math.max(maximum, -Math.min(0, cell.flexuralReliefKm)),
        0,
      ),
      maximumFlexuralBulgeKm: cells.reduce(
        (maximum, cell) => Math.max(maximum, Math.max(0, cell.flexuralReliefKm)),
        0,
      ),
      ...coastalMarginStats,
      ...sedimentBudget,
    },
    sample: (direction) => immutableCells[exactFaceAtPoint(sphere, root, centers, adjacency, direction)],
    sampleContinuous,
  };
}
