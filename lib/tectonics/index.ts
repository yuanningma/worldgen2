export {
  VECTOR_EPSILON,
  add3,
  almostEqualVec3,
  angleBetweenUnitVectors,
  clampUnit,
  cross3,
  dot3,
  length3,
  normalize3,
  scale3,
  subtract3,
  type Vec3,
} from "./vector.ts";

export {
  createGeodesicSphere,
  geodesicDistanceKm,
  type GeodesicEdge,
  type GeodesicFace,
  type GeodesicSphere,
  type GeodesicVertex,
} from "./geodesic.ts";

export {
  eulerAngularVelocity,
  rotateByEulerPole,
  surfaceAngularVelocity,
  surfaceVelocityKmPerMyr,
  type EulerPole,
} from "./kinematics.ts";

export {
  DEFAULT_BOUNDARY_THRESHOLDS,
  boundaryGeometryFromEdge,
  classifyBoundaryKinematics,
  createBoundaryState,
  updateBoundaryState,
  type BoundaryGeometry,
  type BoundaryKind,
  type BoundaryKinematics,
  type BoundarySegmentState,
  type BoundaryStateUpdate,
  type BoundaryThresholds,
} from "./boundaries.ts";

export {
  createOceanConveyor,
  stepOceanConveyor,
  type ConveyorSide,
  type OceanConveyorBudget,
  type OceanConveyorConfig,
  type OceanConveyorState,
  type OceanCrustParcel,
} from "./conveyor.ts";

export {
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
  simulateTectonicWorld,
  type CrustType,
  type CoupledTransportHistory,
  type TectonicAreaBudget,
  type TectonicPlateState,
  type TectonicWorldModel,
  type TectonicWorldRecipe,
  type TectonicWorldStats,
  type WorldBoundaryState,
  type WorldCellState,
} from "./worldSimulation.ts";

export {
  advectCrustParcels,
  createCrustParcels,
  remapCrustParcels,
  transportCrustParcels,
  type CrustParcel,
  type ParcelContribution,
  type ParcelCrustType,
  type ParcelMaterialBudget,
  type ParcelMaterialSource,
  type ParcelPlateKinematics,
  type ParcelRemapDiagnostics,
  type ParcelRemapResult,
  type ParcelTransportResult,
  type RemappedParcelFace,
} from "./parcelTransport.ts";

export {
  createSurfaceRefinement,
  type RefinedSurfaceSample,
  type SurfaceRefinementAudit,
  type SurfaceRefinementOptions,
} from "./surfaceRefinement.ts";

export {
  createSurfaceProcessWorld,
  type SurfaceLithology,
  type SurfaceLakeBody,
  type SurfaceLakeRegime,
  type SurfaceMarginRegime,
  type SurfaceProcessCell,
  type SurfaceProcessOptions,
  type SurfacePresentationSample,
  type SurfaceProcessStats,
  type SurfaceProcessWorld,
  type SurfaceRiverSegment,
  type SurfaceRiverMouth,
} from "./surfaceProcess.ts";

export {
  naturalSurfaceColor,
  type NaturalSurfaceColorInput,
  type SurfacePresentationStyle,
} from "./surfaceStyle.ts";

export {
  createCanonicalOrogeny,
  type CanonicalOrogenyCell,
  type OrogenRegime,
} from "./orogeny.ts";

export {
  createCanonicalMargins,
  type CanonicalMarginCell,
} from "./margins.ts";
