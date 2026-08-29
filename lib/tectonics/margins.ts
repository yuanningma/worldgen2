import { dot3 } from "./vector.ts";
import type { TectonicWorldModel } from "./worldSimulation.ts";

export interface CanonicalMarginCell {
  /** Distance to the nearest presently active plate boundary through continental crust. */
  readonly activeBoundaryDistanceKm: number;
  /** Combined, physically decaying present-day plate-boundary influence. */
  readonly activeBoundaryStrength: number;
  readonly convergentStrength: number;
  readonly divergentStrength: number;
  readonly transformStrength: number;
}

interface HeapEntry {
  readonly faceId: number;
  readonly distanceKm: number;
  readonly sourceStrength: number;
}

class DistanceHeap {
  private readonly entries: HeapEntry[] = [];

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].distanceKm <= entry.distanceKm) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const root = this.entries[0];
    const tail = this.entries.pop();
    if (!root || !tail || this.entries.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child = right < this.entries.length
        && this.entries[right].distanceKm < this.entries[left].distanceKm
        ? right
        : left;
      if (this.entries[child].distanceKm >= tail.distanceKm) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = tail;
    return root;
  }
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isContinental(model: TectonicWorldModel, faceId: number): boolean {
  const cell = model.cells[faceId];
  return (cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0)) >= 0.5;
}

function boundarySourceStrength(kind: string): number {
  if (kind === "convergent") return 1;
  if (kind === "divergent") return 0.72;
  if (kind === "transform") return 0.46;
  return 0;
}

function distanceField(
  model: TectonicWorldModel,
  acceptedKind: string,
): { readonly distanceKm: Float64Array; readonly sourceStrength: Float64Array } {
  const adjacency: number[][] = model.sphere.faces.map(() => []);
  for (const edge of model.sphere.edges) {
    adjacency[edge.faces[0]].push(edge.faces[1]);
    adjacency[edge.faces[1]].push(edge.faces[0]);
  }
  const distanceKm = new Float64Array(model.cells.length);
  distanceKm.fill(Infinity);
  const sourceStrength = new Float64Array(model.cells.length);
  const heap = new DistanceHeap();
  for (const boundary of model.boundaries) {
    if (boundary.kind !== acceptedKind) continue;
    const strength = boundarySourceStrength(boundary.kind);
    const edge = model.sphere.edges[boundary.edgeId];
    for (const faceId of edge.faces) {
      if (!isContinental(model, faceId)) continue;
      if (distanceKm[faceId] === 0 && sourceStrength[faceId] >= strength) continue;
      distanceKm[faceId] = 0;
      sourceStrength[faceId] = Math.max(sourceStrength[faceId], strength);
      heap.push({ faceId, distanceKm: 0, sourceStrength: strength });
    }
  }

  for (let entry = heap.pop(); entry; entry = heap.pop()) {
    if (entry.distanceKm > distanceKm[entry.faceId] + 1e-9) continue;
    if (entry.sourceStrength + 1e-9 < sourceStrength[entry.faceId]) continue;
    const center = model.sphere.faces[entry.faceId].center;
    for (const neighborId of adjacency[entry.faceId]) {
      if (!isContinental(model, neighborId)) continue;
      const neighborCenter = model.sphere.faces[neighborId].center;
      const edgeKm = Math.acos(clamp(dot3(center, neighborCenter), -1, 1))
        * model.recipe.radiusKm;
      const candidateDistance = entry.distanceKm + edgeKm;
      const improvesDistance = candidateDistance + 1e-9 < distanceKm[neighborId];
      const tiesWithStrongerSource = Math.abs(candidateDistance - distanceKm[neighborId]) <= 1e-9
        && entry.sourceStrength > sourceStrength[neighborId];
      if (!improvesDistance && !tiesWithStrongerSource) continue;
      distanceKm[neighborId] = candidateDistance;
      sourceStrength[neighborId] = entry.sourceStrength;
      heap.push({
        faceId: neighborId,
        distanceKm: candidateDistance,
        sourceStrength: entry.sourceStrength,
      });
    }
  }
  return { distanceKm, sourceStrength };
}

function influenceAt(
  distanceKm: number,
  sourceStrength: number,
  decayLengthKm: number,
): number {
  if (!Number.isFinite(distanceKm) || sourceStrength <= 0) return 0;
  return clamp(sourceStrength * Math.exp(-distanceKm / decayLengthKm));
}

/**
 * Classify present-day continental margins from plate boundaries using
 * physical distances, not mesh-ring counts. This is deliberately a reduced
 * snapshot classifier: passive strength means tectonically quiet today, not a
 * reconstructed rift age. The same canonical field is shared by coastline and
 * surface-process tiers so their diagnoses cannot drift apart.
 */
export function createCanonicalMargins(
  model: TectonicWorldModel,
  decayLengthKm = 520,
): readonly CanonicalMarginCell[] {
  const convergent = distanceField(model, "convergent");
  const divergent = distanceField(model, "divergent");
  const transform = distanceField(model, "transform");
  return model.cells.map((cell) => {
    if (!isContinental(model, cell.faceId)) {
      return {
        activeBoundaryDistanceKm: Infinity,
        activeBoundaryStrength: 0,
        convergentStrength: 0,
        divergentStrength: 0,
        transformStrength: 0,
      };
    }
    const convergentStrength = influenceAt(
      convergent.distanceKm[cell.faceId],
      convergent.sourceStrength[cell.faceId],
      decayLengthKm,
    );
    const divergentStrength = influenceAt(
      divergent.distanceKm[cell.faceId],
      divergent.sourceStrength[cell.faceId],
      decayLengthKm * 0.86,
    );
    const transformStrength = influenceAt(
      transform.distanceKm[cell.faceId],
      transform.sourceStrength[cell.faceId],
      decayLengthKm * 0.72,
    );
    return {
      activeBoundaryDistanceKm: Math.min(
        convergent.distanceKm[cell.faceId],
        divergent.distanceKm[cell.faceId],
        transform.distanceKm[cell.faceId],
      ),
      activeBoundaryStrength: Math.max(
        convergentStrength,
        divergentStrength,
        transformStrength,
      ),
      convergentStrength,
      divergentStrength,
      transformStrength,
    };
  });
}
