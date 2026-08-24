import {
  cellCenter,
  createSphericalRasterGeometry,
  type Vec3,
} from "../spherical/geometry.ts";
import type { GeodesicSphere } from "../tectonics/geodesic.ts";
import { cross3, dot3 } from "../tectonics/vector.ts";
import {
  evaluateSphericalLandMask,
  type EvaluationOptions,
  type SphericalLandmassReport,
} from "./sphericalLandmassMetrics.ts";

export type EvaluatedCrustType = "continental" | "oceanic" | string;
export type EvaluatedBoundaryKind = "divergent" | "convergent" | "transform" | "stable" | string;

/** The deliberately narrow structural contract consumed from the simulator. */
export interface FaceBasedWorldCell {
  readonly faceId: number;
  readonly plateId: number;
  readonly crustType: EvaluatedCrustType;
  readonly provenanceId: number;
  readonly elevationKm: number;
  readonly isLand: boolean;
}

export interface FaceBasedWorldBoundary {
  readonly edgeId: number;
  readonly kind: EvaluatedBoundaryKind;
  readonly normalKmPerMyr: number;
  readonly tangentialKmPerMyr: number;
}

export interface FaceBasedWorldModel {
  readonly sphere: GeodesicSphere;
  readonly cells: readonly FaceBasedWorldCell[];
  readonly boundaries: readonly FaceBasedWorldBoundary[];
  readonly seaLevelKm: number;
  readonly parcelTransport?: {
    readonly diagnostics: {
      readonly nonlocalTransportAreaFraction: number;
    };
  };
  readonly transportHistory?: {
    readonly maximumNonlocalTransportAreaFraction: number;
  };
  readonly recipe: {
    readonly radiusKm: number;
    readonly seed?: string | number;
  };
}

export interface CanonicalWorldAnalysisRaster {
  readonly width: number;
  readonly height: number;
  readonly radiusKm: number;
  /** Canonical simulator classification; this is the only land mask evaluated. */
  readonly land: Uint8Array;
  readonly faceIds: Int32Array;
  readonly plateIds: Int32Array;
  readonly provenanceIds: Int32Array;
  readonly elevationKm: Float32Array;
}

export interface WorldElevationDiagnostics {
  readonly minimumKm: number;
  readonly maximumKm: number;
  readonly meanKm: number;
  readonly meanLandKm: number;
  readonly meanOceanKm: number;
  readonly canonicalLandElevationMismatchFraction: number;
  /** Area share above the threshold that touches a convergent/collision boundary. */
  readonly highElevationCompressionAdjacencyFraction: number;
}

export interface WorldBoundaryDiagnostics {
  readonly count: number;
  readonly totalLengthKm: number;
  readonly lengthByKindKm: Readonly<Record<string, number>>;
  readonly meanNormalSpeedKmPerMyr: number;
  readonly meanTangentialSpeedKmPerMyr: number;
  readonly meanAdjacentElevationByKindKm: Readonly<Record<string, number>>;
}

export interface WorldProvenanceDiagnostics {
  readonly totalCount: number;
  readonly landCount: number;
  readonly effectiveLandProvenanceCount: number;
  /** Land area whose provenance currently occurs on more than one plate. */
  readonly crossPlateLandFraction: number;
  readonly continentalLandFraction: number;
  readonly submergedContinentalFraction: number;
  readonly emergentOceanicFraction: number;
}

export interface WorldGeologyDiagnostics {
  readonly elevation: WorldElevationDiagnostics;
  readonly boundaries: WorldBoundaryDiagnostics;
  readonly provenance: WorldProvenanceDiagnostics;
}

export interface WorldPlacementDiagnostics {
  readonly polarLandFraction: number;
  readonly maximumZonalLandFraction: number;
  readonly largestLandmassShare: number;
}

export interface WorldAcceptanceThresholds {
  readonly minimumLandFraction: number;
  readonly maximumLandFraction: number;
  readonly minimumMajorComponentCount: number;
  readonly maximumMajorComponentCount: number;
  readonly minimumEffectiveComponentCount: number;
  readonly maximumLargestLandmassShare: number;
  readonly maximumPolarLandFraction: number;
  readonly maximumZonalLandFraction: number;
  readonly maximumMajorElongation: number;
  readonly maximumMajorDiameterRatio: number;
  readonly maximumRibbonSeverity: number;
  readonly maximumNeckSplitPersistence: number;
  readonly maximumOpenGulfSeverity: number;
  readonly minimumCoastlineRichness: number;
  readonly maximumCoastlineFineNoiseFraction: number;
  readonly maximumNonlocalTransportAreaFraction: number;
  readonly maximumLandElevationMismatchFraction: number;
  readonly minimumLandProvenanceCount: number;
}

export const DEFAULT_WORLD_ACCEPTANCE_THRESHOLDS: WorldAcceptanceThresholds = {
  minimumLandFraction: 0.18,
  maximumLandFraction: 0.48,
  minimumMajorComponentCount: 3,
  maximumMajorComponentCount: 12,
  minimumEffectiveComponentCount: 2,
  maximumLargestLandmassShare: 0.62,
  maximumPolarLandFraction: 0.24,
  maximumZonalLandFraction: 0.72,
  maximumMajorElongation: 3.25,
  maximumMajorDiameterRatio: 2.4,
  maximumRibbonSeverity: 2.25,
  maximumNeckSplitPersistence: 0.75,
  maximumOpenGulfSeverity: 8,
  minimumCoastlineRichness: 0.25,
  maximumCoastlineFineNoiseFraction: 0.55,
  maximumNonlocalTransportAreaFraction: 0.005,
  maximumLandElevationMismatchFraction: 0,
  minimumLandProvenanceCount: 2,
};

export interface TectonicWorldEvaluationOptions {
  readonly width?: number;
  readonly height?: number;
  readonly morphology?: EvaluationOptions;
  readonly thresholds?: Partial<WorldAcceptanceThresholds>;
  readonly highElevationThresholdKm?: number;
}

export interface WorldAcceptanceReport {
  readonly seed: string;
  readonly accepted: boolean;
  /** Non-compensatory rejection reasons. */
  readonly hardFailures: readonly string[];
  readonly warnings: readonly string[];
  readonly selectionScore: number;
  readonly morphology: SphericalLandmassReport;
  readonly geology: WorldGeologyDiagnostics;
  readonly placement: WorldPlacementDiagnostics;
  readonly raster: CanonicalWorldAnalysisRaster;
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

    // Defensive deterministic fallback for a malformed mesh or roundoff exactly
    // at a vertex. The normal path walks only local adjacent faces.
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

function validateWorld(world: FaceBasedWorldModel): readonly FaceBasedWorldCell[] {
  const { sphere, cells } = world;
  if (!(world.recipe.radiusKm > 0) || !Number.isFinite(world.recipe.radiusKm)) {
    throw new Error("world radiusKm must be finite and positive");
  }
  if (!Number.isFinite(world.seaLevelKm)) throw new Error("world seaLevelKm must be finite");
  if (cells.length !== sphere.faces.length) {
    throw new Error("world must provide exactly one canonical cell per spherical face");
  }
  const byFace: FaceBasedWorldCell[] = new Array(sphere.faces.length);
  for (const cell of cells) {
    if (!Number.isInteger(cell.faceId) || cell.faceId < 0 || cell.faceId >= sphere.faces.length) {
      throw new Error(`invalid world faceId ${cell.faceId}`);
    }
    if (byFace[cell.faceId]) throw new Error(`duplicate world faceId ${cell.faceId}`);
    if (!Number.isFinite(cell.elevationKm)) throw new Error(`face ${cell.faceId} elevation must be finite`);
    byFace[cell.faceId] = cell;
  }
  if (byFace.some((cell) => cell === undefined)) throw new Error("world is missing one or more face cells");
  for (const boundary of world.boundaries) {
    if (!Number.isInteger(boundary.edgeId) || boundary.edgeId < 0 || boundary.edgeId >= sphere.edges.length) {
      throw new Error(`invalid world boundary edgeId ${boundary.edgeId}`);
    }
    if (!Number.isFinite(boundary.normalKmPerMyr) || !Number.isFinite(boundary.tangentialKmPerMyr)) {
      throw new Error(`boundary edge ${boundary.edgeId} velocity must be finite`);
    }
  }
  return byFace;
}

export function rasterizeFaceBasedWorld(
  world: FaceBasedWorldModel,
  options: Pick<TectonicWorldEvaluationOptions, "width" | "height"> = {},
): CanonicalWorldAnalysisRaster {
  const byFace = validateWorld(world);
  const width = options.width ?? 360;
  const height = options.height ?? Math.round(width / 2);
  const geometry = createSphericalRasterGeometry(width, height, world.recipe.radiusKm);
  const locator = createFaceLocator(world.sphere);
  const land = new Uint8Array(width * height);
  const faceIds = new Int32Array(width * height);
  const plateIds = new Int32Array(width * height);
  const provenanceIds = new Int32Array(width * height);
  const elevationKm = new Float32Array(width * height);
  let rowStartFace = 0;

  for (let y = 0; y < height; y += 1) {
    let previousFace = rowStartFace;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const faceId = locator.locate(cellCenter(geometry, index), previousFace);
      const cell = byFace[faceId];
      faceIds[index] = faceId;
      plateIds[index] = cell.plateId;
      provenanceIds[index] = cell.provenanceId;
      elevationKm[index] = cell.elevationKm;
      land[index] = cell.isLand ? 1 : 0;
      previousFace = faceId;
      if (x === 0) rowStartFace = faceId;
    }
  }
  return { width, height, radiusKm: world.recipe.radiusKm, land, faceIds, plateIds, provenanceIds, elevationKm };
}

function addRecordValue(record: Record<string, number>, key: string, value: number): void {
  record[key] = (record[key] ?? 0) + value;
}

function geologyDiagnostics(
  world: FaceBasedWorldModel,
  byFace: readonly FaceBasedWorldCell[],
  highElevationThresholdKm: number,
): WorldGeologyDiagnostics {
  const radiusSquared = world.recipe.radiusKm ** 2;
  let totalArea = 0;
  let landArea = 0;
  let oceanArea = 0;
  let weightedElevation = 0;
  let weightedLandElevation = 0;
  let weightedOceanElevation = 0;
  let minimumKm = Infinity;
  let maximumKm = -Infinity;
  let mismatchArea = 0;
  let highElevationArea = 0;
  let highElevationByCompressionArea = 0;
  let continentalLandArea = 0;
  let submergedContinentalArea = 0;
  let emergentOceanicArea = 0;
  const provenanceArea = new Map<number, number>();
  const provenanceLandArea = new Map<number, number>();
  const provenancePlates = new Map<number, Set<number>>();
  const compressionFaces = new Uint8Array(byFace.length);

  const lengthByKindKm: Record<string, number> = {};
  const adjacentElevationWeighted: Record<string, number> = {};
  const adjacentElevationLength: Record<string, number> = {};
  let totalBoundaryLength = 0;
  let weightedNormal = 0;
  let weightedTangential = 0;
  for (const boundary of world.boundaries) {
    const edge = world.sphere.edges[boundary.edgeId];
    const lengthKm = edge.arcLengthRadians * world.recipe.radiusKm;
    const adjacentElevation = (byFace[edge.faces[0]].elevationKm + byFace[edge.faces[1]].elevationKm) / 2;
    totalBoundaryLength += lengthKm;
    weightedNormal += boundary.normalKmPerMyr * lengthKm;
    weightedTangential += Math.abs(boundary.tangentialKmPerMyr) * lengthKm;
    addRecordValue(lengthByKindKm, boundary.kind, lengthKm);
    addRecordValue(adjacentElevationWeighted, boundary.kind, adjacentElevation * lengthKm);
    addRecordValue(adjacentElevationLength, boundary.kind, lengthKm);
    if (boundary.kind === "convergent" || boundary.kind === "collision") {
      compressionFaces[edge.faces[0]] = 1;
      compressionFaces[edge.faces[1]] = 1;
    }
  }

  for (const face of world.sphere.faces) {
    const cell = byFace[face.id];
    const area = face.areaSteradians * radiusSquared;
    totalArea += area;
    weightedElevation += cell.elevationKm * area;
    minimumKm = Math.min(minimumKm, cell.elevationKm);
    maximumKm = Math.max(maximumKm, cell.elevationKm);
    provenanceArea.set(cell.provenanceId, (provenanceArea.get(cell.provenanceId) ?? 0) + area);
    const plateSet = provenancePlates.get(cell.provenanceId) ?? new Set<number>();
    plateSet.add(cell.plateId);
    provenancePlates.set(cell.provenanceId, plateSet);

    const elevationLand = cell.elevationKm >= world.seaLevelKm;
    if (elevationLand !== cell.isLand) mismatchArea += area;
    if (cell.isLand) {
      landArea += area;
      weightedLandElevation += cell.elevationKm * area;
      provenanceLandArea.set(cell.provenanceId, (provenanceLandArea.get(cell.provenanceId) ?? 0) + area);
      if (cell.crustType === "continental") continentalLandArea += area;
      else emergentOceanicArea += area;
      if (cell.elevationKm >= highElevationThresholdKm) {
        highElevationArea += area;
        if (compressionFaces[face.id] !== 0) highElevationByCompressionArea += area;
      }
    } else {
      oceanArea += area;
      weightedOceanElevation += cell.elevationKm * area;
      if (cell.crustType === "continental") submergedContinentalArea += area;
    }
  }

  const meanAdjacentElevationByKindKm: Record<string, number> = {};
  for (const [kind, weighted] of Object.entries(adjacentElevationWeighted)) {
    meanAdjacentElevationByKindKm[kind] = weighted / adjacentElevationLength[kind];
  }
  let squaredLandProvenanceShares = 0;
  let crossPlateLandArea = 0;
  for (const [provenanceId, area] of provenanceLandArea) {
    squaredLandProvenanceShares += (area / Math.max(landArea, 1e-12)) ** 2;
    if ((provenancePlates.get(provenanceId)?.size ?? 0) > 1) crossPlateLandArea += area;
  }

  return {
    elevation: {
      minimumKm,
      maximumKm,
      meanKm: weightedElevation / totalArea,
      meanLandKm: weightedLandElevation / Math.max(landArea, 1e-12),
      meanOceanKm: weightedOceanElevation / Math.max(oceanArea, 1e-12),
      canonicalLandElevationMismatchFraction: mismatchArea / totalArea,
      highElevationCompressionAdjacencyFraction: highElevationArea > 0
        ? highElevationByCompressionArea / highElevationArea
        : 0,
    },
    boundaries: {
      count: world.boundaries.length,
      totalLengthKm: totalBoundaryLength,
      lengthByKindKm,
      meanNormalSpeedKmPerMyr: totalBoundaryLength > 0 ? weightedNormal / totalBoundaryLength : 0,
      meanTangentialSpeedKmPerMyr: totalBoundaryLength > 0 ? weightedTangential / totalBoundaryLength : 0,
      meanAdjacentElevationByKindKm,
    },
    provenance: {
      totalCount: provenanceArea.size,
      landCount: provenanceLandArea.size,
      effectiveLandProvenanceCount: squaredLandProvenanceShares > 0 ? 1 / squaredLandProvenanceShares : 0,
      crossPlateLandFraction: crossPlateLandArea / Math.max(landArea, 1e-12),
      continentalLandFraction: continentalLandArea / Math.max(landArea, 1e-12),
      submergedContinentalFraction: submergedContinentalArea / Math.max(oceanArea, 1e-12),
      emergentOceanicFraction: emergentOceanicArea / Math.max(landArea, 1e-12),
    },
  };
}

function resolveThresholds(overrides?: Partial<WorldAcceptanceThresholds>): WorldAcceptanceThresholds {
  return { ...DEFAULT_WORLD_ACCEPTANCE_THRESHOLDS, ...overrides };
}

function acceptanceFailures(
  morphology: SphericalLandmassReport,
  geology: WorldGeologyDiagnostics,
  placement: WorldPlacementDiagnostics,
  thresholds: WorldAcceptanceThresholds,
): string[] {
  const failures: string[] = [];
  const check = (condition: boolean, message: string): void => {
    if (condition) failures.push(message);
  };
  check(morphology.landFraction < thresholds.minimumLandFraction,
    `land fraction ${morphology.landFraction.toFixed(3)} is below ${thresholds.minimumLandFraction}`);
  check(morphology.landFraction > thresholds.maximumLandFraction,
    `land fraction ${morphology.landFraction.toFixed(3)} exceeds ${thresholds.maximumLandFraction}`);
  check(morphology.majorComponentCount < thresholds.minimumMajorComponentCount,
    `major component count ${morphology.majorComponentCount} is below ${thresholds.minimumMajorComponentCount}`);
  check(morphology.majorComponentCount > thresholds.maximumMajorComponentCount,
    `major component count ${morphology.majorComponentCount} exceeds ${thresholds.maximumMajorComponentCount}`);
  check(morphology.effectiveComponentCount < thresholds.minimumEffectiveComponentCount,
    `effective component count ${morphology.effectiveComponentCount.toFixed(3)} is below ${thresholds.minimumEffectiveComponentCount}`);
  check(placement.largestLandmassShare > thresholds.maximumLargestLandmassShare,
    `largest landmass share ${placement.largestLandmassShare.toFixed(3)} exceeds ${thresholds.maximumLargestLandmassShare}`);
  check(placement.polarLandFraction > thresholds.maximumPolarLandFraction,
    `polar land fraction ${placement.polarLandFraction.toFixed(3)} exceeds ${thresholds.maximumPolarLandFraction}`);
  check(placement.maximumZonalLandFraction > thresholds.maximumZonalLandFraction,
    `maximum zonal land fraction ${placement.maximumZonalLandFraction.toFixed(3)} exceeds ${thresholds.maximumZonalLandFraction}`);
  check(morphology.maximumMajorElongation > thresholds.maximumMajorElongation,
    `major elongation ${morphology.maximumMajorElongation.toFixed(3)} exceeds ${thresholds.maximumMajorElongation}`);
  check(morphology.maximumMajorDiameterRatio > thresholds.maximumMajorDiameterRatio,
    `major diameter ratio ${morphology.maximumMajorDiameterRatio.toFixed(3)} exceeds ${thresholds.maximumMajorDiameterRatio}`);
  check(morphology.ribbonSeverity > thresholds.maximumRibbonSeverity,
    `ribbon severity ${morphology.ribbonSeverity.toFixed(3)} exceeds ${thresholds.maximumRibbonSeverity}`);
  check(morphology.neckSplitPersistence > thresholds.maximumNeckSplitPersistence,
    `neck persistence ${morphology.neckSplitPersistence.toFixed(3)} exceeds ${thresholds.maximumNeckSplitPersistence}`);
  check(morphology.openGulfSeverity > thresholds.maximumOpenGulfSeverity,
    `open-gulf severity ${morphology.openGulfSeverity.toFixed(3)} exceeds ${thresholds.maximumOpenGulfSeverity}`);
  check(morphology.coastlineRichness < thresholds.minimumCoastlineRichness,
    `coastline richness ${morphology.coastlineRichness.toFixed(3)} is below ${thresholds.minimumCoastlineRichness}`);
  check(morphology.coastlineFineNoiseFraction > thresholds.maximumCoastlineFineNoiseFraction,
    `coastline fine-noise fraction ${morphology.coastlineFineNoiseFraction.toFixed(3)} exceeds ${thresholds.maximumCoastlineFineNoiseFraction}`);
  check(geology.elevation.canonicalLandElevationMismatchFraction > thresholds.maximumLandElevationMismatchFraction,
    `canonical land/elevation mismatch ${geology.elevation.canonicalLandElevationMismatchFraction.toExponential(2)} exceeds ${thresholds.maximumLandElevationMismatchFraction}`);
  check(geology.provenance.landCount < thresholds.minimumLandProvenanceCount,
    `land provenance count ${geology.provenance.landCount} is below ${thresholds.minimumLandProvenanceCount}`);
  return failures;
}

function selectionScore(
  morphology: SphericalLandmassReport,
  geology: WorldGeologyDiagnostics,
  placement: WorldPlacementDiagnostics,
): number {
  // Used only after hard gates. It rewards hierarchy and causal uplift without
  // allowing them to cancel a pathological component.
  return morphology.effectiveComponentCount
    + morphology.areaGini
    + geology.elevation.highElevationCompressionAdjacencyFraction
    + Math.log2(1 + geology.provenance.effectiveLandProvenanceCount)
    + morphology.coastlineRichness * 0.5
    - placement.largestLandmassShare * 1.5
    - placement.polarLandFraction * 2
    - placement.maximumZonalLandFraction
    - morphology.ribbonSeverity
    - morphology.neckSplitPersistence
    - Math.min(2, morphology.openGulfSeverity / 4);
}

export function evaluateTectonicWorld(
  world: FaceBasedWorldModel,
  options: TectonicWorldEvaluationOptions = {},
): WorldAcceptanceReport {
  const byFace = validateWorld(world);
  const raster = rasterizeFaceBasedWorld(world, options);
  const morphology = evaluateSphericalLandMask(raster, options.morphology);
  const geology = geologyDiagnostics(world, byFace, options.highElevationThresholdKm ?? 1.5);
  const geometry = createSphericalRasterGeometry(raster.width, raster.height, raster.radiusKm);
  let polarLandArea = 0;
  let landArea = 0;
  let maximumZonalLandFraction = 0;
  const polarLatitude = 70 * Math.PI / 180;
  for (let y = 0; y < raster.height; y += 1) {
    let rowLand = 0;
    for (let x = 0; x < raster.width; x += 1) {
      const index = y * raster.width + x;
      if (raster.land[index] === 0) continue;
      const area = geometry.cellAreasKm2[index];
      landArea += area;
      rowLand += 1;
      if (Math.abs(geometry.rowLatitudes[y]) >= polarLatitude) polarLandArea += area;
    }
    maximumZonalLandFraction = Math.max(maximumZonalLandFraction, rowLand / raster.width);
  }
  const placement: WorldPlacementDiagnostics = {
    polarLandFraction: polarLandArea / Math.max(landArea, 1e-12),
    maximumZonalLandFraction,
    largestLandmassShare: morphology.components[0]?.areaShareOfLand ?? 0,
  };
  const thresholds = resolveThresholds(options.thresholds);
  const hardFailures = acceptanceFailures(morphology, geology, placement, thresholds);
  const nonlocalTransport = Math.max(
    world.parcelTransport?.diagnostics.nonlocalTransportAreaFraction ?? 0,
    world.transportHistory?.maximumNonlocalTransportAreaFraction ?? 0,
  );
  if (nonlocalTransport > thresholds.maximumNonlocalTransportAreaFraction) {
    hardFailures.push(
      `nonlocal remap area fraction ${nonlocalTransport.toFixed(4)} exceeds ${thresholds.maximumNonlocalTransportAreaFraction}`,
    );
  }
  const warnings: string[] = [];
  if (morphology.multiscale.every((scale) => !scale.resolved)) {
    warnings.push("No requested morphology scale is resolved by the analysis raster");
  }
  if (world.boundaries.length === 0) warnings.push("World contains no plate boundaries");
  if (geology.elevation.highElevationCompressionAdjacencyFraction < 0.25) {
    warnings.push("Less than 25% of high-elevation area touches a compressional boundary");
  }
  if (morphology.coastlineRichness < 0.45) {
    warnings.push("Resolved coastline structure is only marginally richer than compact spherical caps");
  }
  if (morphology.coastlineFineNoiseFraction > 0.45) {
    warnings.push("More than 45% of coastline perimeter disappears at the smallest resolved scale");
  }
  return {
    seed: String(world.recipe.seed ?? "UNSPECIFIED"),
    accepted: hardFailures.length === 0,
    hardFailures,
    warnings,
    selectionScore: selectionScore(morphology, geology, placement),
    morphology,
    geology,
    placement,
    raster,
  };
}

export function rankAcceptedWorlds(reports: readonly WorldAcceptanceReport[]): readonly WorldAcceptanceReport[] {
  return reports
    .filter((report) => report.accepted)
    .slice()
    .sort((a, b) => b.selectionScore - a.selectionScore || a.seed.localeCompare(b.seed));
}
