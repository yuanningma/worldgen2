import { surfaceVelocityKmPerMyr, type EulerPole } from "./kinematics.ts";
import type { GeodesicSphere } from "./geodesic.ts";
import {
  cross3,
  dot3,
  normalize3,
  scale3,
  subtract3,
  type Vec3,
} from "./vector.ts";

export type BoundaryKind = "divergent" | "convergent" | "transform" | "stable";

export interface BoundaryGeometry {
  readonly point: Vec3;
  /** Unit tangent along the boundary. Direction is arbitrary but stable. */
  readonly tangent: Vec3;
  /** A point strictly on the plate-A side of the segment. */
  readonly plateASidePoint: Vec3;
  /** A point strictly on the plate-B side of the segment. */
  readonly plateBSidePoint: Vec3;
}

export interface BoundaryKinematics {
  readonly kind: BoundaryKind;
  readonly normalKmPerMyr: number;
  readonly tangentialKmPerMyr: number;
  readonly relativeVelocityKmPerMyr: Vec3;
  readonly normalTowardPlateB: Vec3;
}

export interface BoundaryThresholds {
  /** Speed needed to propose convergence or divergence. */
  readonly normalEnterKmPerMyr: number;
  /** Speed needed to retain the current convergence/divergence state. */
  readonly normalExitKmPerMyr: number;
  readonly transformEnterKmPerMyr: number;
  readonly transformExitKmPerMyr: number;
}

export const DEFAULT_BOUNDARY_THRESHOLDS: BoundaryThresholds = {
  normalEnterKmPerMyr: 12,
  normalExitKmPerMyr: 6,
  transformEnterKmPerMyr: 12,
  transformExitKmPerMyr: 6,
};

export interface BoundarySegmentState {
  readonly kind: BoundaryKind;
  readonly ageSteps: number;
  readonly pendingKind: BoundaryKind | null;
  readonly pendingSteps: number;
}

export interface BoundaryStateUpdate {
  readonly state: BoundarySegmentState;
  readonly kinematics: BoundaryKinematics;
  readonly changed: boolean;
}

/** Builds an oriented boundary frame directly from a closed geodesic edge. */
export function boundaryGeometryFromEdge(
  sphere: GeodesicSphere,
  edgeId: number,
  plateAFaceId: number = sphere.edges[edgeId]?.faces[0],
): BoundaryGeometry {
  const edge = sphere.edges[edgeId];
  if (!edge) throw new RangeError("edgeId is outside the geodesic sphere");
  if (!edge.faces.includes(plateAFaceId)) {
    throw new RangeError("plateAFaceId must be one of the edge's adjacent faces");
  }
  const plateBFaceId = edge.faces[0] === plateAFaceId ? edge.faces[1] : edge.faces[0];
  const vertexA = sphere.vertices[edge.vertices[0]].position;
  const vertexB = sphere.vertices[edge.vertices[1]].position;
  return {
    point: edge.midpoint,
    tangent: subtract3(vertexB, vertexA),
    plateASidePoint: sphere.faces[plateAFaceId].center,
    plateBSidePoint: sphere.faces[plateBFaceId].center,
  };
}

function validateThresholds(thresholds: BoundaryThresholds): void {
  const values = Object.values(thresholds);
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Boundary thresholds must be finite and non-negative");
  }
  if (thresholds.normalExitKmPerMyr > thresholds.normalEnterKmPerMyr
      || thresholds.transformExitKmPerMyr > thresholds.transformEnterKmPerMyr) {
    throw new RangeError("Boundary exit thresholds cannot exceed enter thresholds");
  }
}

function orientNormal(geometry: BoundaryGeometry): { point: Vec3; tangent: Vec3; normal: Vec3 } {
  const point = normalize3(geometry.point);
  const projectedTangent = subtract3(
    geometry.tangent,
    scale3(point, dot3(point, geometry.tangent)),
  );
  const tangent = normalize3(projectedTangent);
  let normal = normalize3(cross3(point, tangent));
  const sideDirection = subtract3(geometry.plateBSidePoint, geometry.plateASidePoint);
  if (dot3(normal, sideDirection) < 0) normal = scale3(normal, -1);
  return { point, tangent, normal };
}

export function classifyBoundaryKinematics(
  geometry: BoundaryGeometry,
  plateAPole: EulerPole,
  plateBPole: EulerPole,
  radiusKm: number,
  thresholds: BoundaryThresholds = DEFAULT_BOUNDARY_THRESHOLDS,
  retainedKind: BoundaryKind | null = null,
): BoundaryKinematics {
  validateThresholds(thresholds);
  const { point, tangent, normal } = orientNormal(geometry);
  const relativeVelocity = subtract3(
    surfaceVelocityKmPerMyr(plateBPole, point, radiusKm),
    surfaceVelocityKmPerMyr(plateAPole, point, radiusKm),
  );
  const normalSpeed = dot3(relativeVelocity, normal);
  const tangentialSpeed = dot3(relativeVelocity, tangent);

  const normalThreshold = retainedKind === "divergent" || retainedKind === "convergent"
    ? thresholds.normalExitKmPerMyr
    : thresholds.normalEnterKmPerMyr;
  const transformThreshold = retainedKind === "transform"
    ? thresholds.transformExitKmPerMyr
    : thresholds.transformEnterKmPerMyr;

  let kind: BoundaryKind = "stable";
  if (normalSpeed >= normalThreshold) kind = "divergent";
  else if (normalSpeed <= -normalThreshold) kind = "convergent";
  else if (Math.abs(tangentialSpeed) >= transformThreshold) kind = "transform";

  return {
    kind,
    normalKmPerMyr: normalSpeed,
    tangentialKmPerMyr: tangentialSpeed,
    relativeVelocityKmPerMyr: relativeVelocity,
    normalTowardPlateB: normal,
  };
}

export function createBoundaryState(kind: BoundaryKind = "stable"): BoundarySegmentState {
  return { kind, ageSteps: 0, pendingKind: null, pendingSteps: 0 };
}

/**
 * Applies segment-level temporal hysteresis. A proposed transition must persist
 * for `confirmationSteps`; retention thresholds keep an inherited boundary from
 * flickering when a velocity lies close to a classification threshold.
 */
export function updateBoundaryState(
  previous: BoundarySegmentState,
  geometry: BoundaryGeometry,
  plateAPole: EulerPole,
  plateBPole: EulerPole,
  radiusKm: number,
  options: {
    readonly thresholds?: BoundaryThresholds;
    readonly confirmationSteps?: number;
  } = {},
): BoundaryStateUpdate {
  const confirmationSteps = options.confirmationSteps ?? 2;
  if (!Number.isInteger(confirmationSteps) || confirmationSteps < 1) {
    throw new RangeError("confirmationSteps must be a positive integer");
  }
  const kinematics = classifyBoundaryKinematics(
    geometry,
    plateAPole,
    plateBPole,
    radiusKm,
    options.thresholds,
    previous.kind,
  );

  if (kinematics.kind === previous.kind) {
    return {
      state: {
        kind: previous.kind,
        ageSteps: previous.ageSteps + 1,
        pendingKind: null,
        pendingSteps: 0,
      },
      kinematics,
      changed: false,
    };
  }

  const pendingSteps = previous.pendingKind === kinematics.kind ? previous.pendingSteps + 1 : 1;
  if (pendingSteps < confirmationSteps) {
    return {
      state: {
        kind: previous.kind,
        ageSteps: previous.ageSteps + 1,
        pendingKind: kinematics.kind,
        pendingSteps,
      },
      kinematics,
      changed: false,
    };
  }

  return {
    state: {
      kind: kinematics.kind,
      ageSteps: 0,
      pendingKind: null,
      pendingSteps: 0,
    },
    kinematics,
    changed: true,
  };
}
