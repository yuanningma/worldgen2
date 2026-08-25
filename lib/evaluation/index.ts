export {
  compareCanonicalMasks,
  evaluateSphericalLandMask,
  type CanonicalMaskComparison,
  type EvaluationOptions,
  type LandmassShapeMetrics,
  type MorphologyScaleMetrics,
  type SphericalLandMask,
  type SphericalLandmassReport,
} from "./sphericalLandmassMetrics.ts";

export {
  DEFAULT_WORLD_ACCEPTANCE_THRESHOLDS,
  evaluateTectonicWorld,
  rankAcceptedWorlds,
  rasterizeFaceBasedWorld,
  type CanonicalWorldAnalysisRaster,
  type EvaluatedBoundaryKind,
  type EvaluatedCrustType,
  type FaceBasedWorldBoundary,
  type FaceBasedWorldCell,
  type FaceBasedWorldModel,
  type TectonicWorldEvaluationOptions,
  type WorldAcceptanceReport,
  type WorldAcceptanceThresholds,
  type WorldBoundaryDiagnostics,
  type WorldElevationDiagnostics,
  type WorldGeologyDiagnostics,
  type WorldPlacementDiagnostics,
  type WorldProvenanceDiagnostics,
} from "./tectonicWorldEvaluation.ts";

export {
  compareMorphologyRefinement,
  type MorphologyRefinementComparison,
  type MorphologyRefinementGateOptions,
} from "./refinementComparison.ts";

export {
  auditParcelRemap,
  createCanonicalLandSampler,
  remappedFacesToCanonicalCells,
  type CanonicalLandSample,
  type CanonicalLandSampler,
  type ParcelRemapAudit,
} from "./parcelRemapConformance.ts";

export {
  compareSurfaceResolutions,
  DEFAULT_SURFACE_RESOLUTION_THRESHOLDS,
  type SurfaceResolutionComparison,
  type SurfaceResolutionThresholds,
} from "./surfaceResolutionComparison.ts";
