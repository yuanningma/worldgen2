import type { GeodesicSphere } from "../tectonics/geodesic.ts";
import type {
  CrustParcel,
  ParcelRemapResult,
  RemappedParcelFace,
} from "../tectonics/parcelTransport.ts";
import { cross3, dot3, normalize3, type Vec3 } from "../tectonics/vector.ts";
import type { FaceBasedWorldCell } from "./tectonicWorldEvaluation.ts";

export interface ParcelRemapAudit {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly faceCoverageResidualSteradians: number;
  readonly maximumFaceContributionResidualSteradians: number;
  readonly maximumParcelContributionResidualSteradians: number;
  readonly maximumProvenanceResidualSteradians: number;
  readonly unknownProvenanceFaceCount: number;
}

export interface CanonicalLandSample {
  readonly faceId: number;
  readonly isLand: boolean;
}

export interface CanonicalLandSampler {
  sample(point: Vec3): CanonicalLandSample;
}

export function remappedFacesToCanonicalCells(
  faces: readonly RemappedParcelFace[],
  seaLevelKm: number,
): readonly FaceBasedWorldCell[] {
  if (!Number.isFinite(seaLevelKm)) throw new RangeError("seaLevelKm must be finite");
  return faces.map((face) => ({
    faceId: face.faceId,
    plateId: face.dominantPlateId,
    crustType: face.crustType,
    provenanceId: face.dominantProvenanceId,
    elevationKm: face.elevationKm,
    isLand: face.elevationKm >= seaLevelKm,
  }));
}

export function auditParcelRemap(
  sphere: GeodesicSphere,
  sourceParcels: readonly CrustParcel[],
  remap: ParcelRemapResult,
  toleranceSteradians = 1e-10,
): ParcelRemapAudit {
  if (!(toleranceSteradians > 0) || !Number.isFinite(toleranceSteradians)) {
    throw new RangeError("toleranceSteradians must be finite and positive");
  }
  const failures: string[] = [];
  const sourceById = new Map(sourceParcels.map((parcel) => [parcel.id, parcel] as const));
  const sourceProvenances = new Set(sourceParcels.map((parcel) => parcel.provenanceId));
  const contributedByParcel = new Map<number, number>();
  let covered = 0;
  let maximumFaceContributionResidualSteradians = 0;
  let unknownProvenanceFaceCount = 0;

  if (remap.faces.length !== sphere.faces.length) {
    failures.push(`remap has ${remap.faces.length} faces; expected ${sphere.faces.length}`);
  }
  for (const target of remap.faces) {
    const canonicalFace = sphere.faces[target.faceId];
    if (!canonicalFace) {
      failures.push(`remap contains invalid target face ${target.faceId}`);
      continue;
    }
    const contributionArea = target.contributions.reduce((sum, contribution) => {
      contributedByParcel.set(
        contribution.parcelId,
        (contributedByParcel.get(contribution.parcelId) ?? 0) + contribution.areaSteradians,
      );
      return sum + contribution.areaSteradians;
    }, 0);
    covered += contributionArea;
    maximumFaceContributionResidualSteradians = Math.max(
      maximumFaceContributionResidualSteradians,
      Math.abs(contributionArea - canonicalFace.areaSteradians),
      Math.abs(target.areaSteradians - canonicalFace.areaSteradians),
    );
    if (!sourceProvenances.has(target.dominantProvenanceId)) unknownProvenanceFaceCount += 1;
  }

  let maximumParcelContributionResidualSteradians = 0;
  for (const parcel of sourceParcels) {
    maximumParcelContributionResidualSteradians = Math.max(
      maximumParcelContributionResidualSteradians,
      Math.abs((contributedByParcel.get(parcel.id) ?? 0) - parcel.areaSteradians),
    );
  }
  for (const parcelId of contributedByParcel.keys()) {
    if (!sourceById.has(parcelId)) failures.push(`contribution references unknown parcel ${parcelId}`);
  }
  const faceCoverageResidualSteradians = covered - sphere.totalAreaSteradians;
  const maximumProvenanceResidualSteradians = remap.diagnostics.maximumProvenanceAreaResidualSteradians;
  if (Math.abs(faceCoverageResidualSteradians) > toleranceSteradians) {
    failures.push(`coverage residual ${faceCoverageResidualSteradians} exceeds tolerance`);
  }
  if (maximumFaceContributionResidualSteradians > toleranceSteradians) {
    failures.push(`face contribution residual ${maximumFaceContributionResidualSteradians} exceeds tolerance`);
  }
  if (maximumParcelContributionResidualSteradians > toleranceSteradians) {
    failures.push(`parcel contribution residual ${maximumParcelContributionResidualSteradians} exceeds tolerance`);
  }
  if (maximumProvenanceResidualSteradians > toleranceSteradians) {
    failures.push(`provenance residual ${maximumProvenanceResidualSteradians} exceeds tolerance`);
  }
  if (unknownProvenanceFaceCount > 0) {
    failures.push(`${unknownProvenanceFaceCount} faces have unknown dominant provenance`);
  }
  if (remap.diagnostics.resolvedGapFaceCount !== 0 || remap.diagnostics.resolvedOverlapFaceCount !== 0) {
    failures.push("conservative remap retained resolved gaps or overlaps");
  }
  return {
    passed: failures.length === 0,
    failures,
    faceCoverageResidualSteradians,
    maximumFaceContributionResidualSteradians,
    maximumParcelContributionResidualSteradians,
    maximumProvenanceResidualSteradians,
    unknownProvenanceFaceCount,
  };
}

/** Independent brute-force oracle used to audit renderer/projection sampling. */
export function createCanonicalLandSampler(
  sphere: GeodesicSphere,
  cells: readonly Pick<FaceBasedWorldCell, "faceId" | "isLand">[],
): CanonicalLandSampler {
  if (cells.length !== sphere.faces.length) throw new RangeError("sampler requires one cell per face");
  const byFace = new Array<Pick<FaceBasedWorldCell, "faceId" | "isLand">>(sphere.faces.length);
  for (const cell of cells) {
    if (!Number.isInteger(cell.faceId) || cell.faceId < 0 || cell.faceId >= sphere.faces.length) {
      throw new RangeError(`invalid sampler face ${cell.faceId}`);
    }
    if (byFace[cell.faceId]) throw new RangeError(`duplicate sampler face ${cell.faceId}`);
    byFace[cell.faceId] = cell;
  }
  const sample = (rawPoint: Vec3): CanonicalLandSample => {
    const point = normalize3(rawPoint);
    let fallbackFaceId = 0;
    let fallbackSimilarity = -Infinity;
    for (const face of sphere.faces) {
      const [a, b, c] = face.vertices.map((id) => sphere.vertices[id].position) as [Vec3, Vec3, Vec3];
      if (dot3(cross3(a, b), point) >= -1e-12
        && dot3(cross3(b, c), point) >= -1e-12
        && dot3(cross3(c, a), point) >= -1e-12) {
        return { faceId: face.id, isLand: byFace[face.id].isLand };
      }
      const similarity = dot3(face.center, point);
      if (similarity > fallbackSimilarity) {
        fallbackSimilarity = similarity;
        fallbackFaceId = face.id;
      }
    }
    return { faceId: fallbackFaceId, isLand: byFace[fallbackFaceId].isLand };
  };
  return { sample };
}
