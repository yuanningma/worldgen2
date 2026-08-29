import type { TectonicWorldModel } from "./worldSimulation.ts";

export type OrogenRegime = "none" | "collision" | "subduction" | "island-arc" | "suture";

export interface CanonicalOrogenyCell {
  readonly faceId: number;
  readonly regime: OrogenRegime;
  readonly collisionCore: number;
  readonly subductionCore: number;
  readonly islandArcCore: number;
  readonly sutureCore: number;
  readonly foothillStrength: number;
  /** Flexurally subsiding continental belt outside an active orogenic core. */
  readonly forelandBasinStrength: number;
  /** Low-amplitude outer rise beyond the flexural basin. */
  readonly flexuralBulgeStrength: number;
  readonly strength: number;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function adjacencyFor(world: TectonicWorldModel): readonly number[][] {
  const adjacency: number[][] = world.sphere.faces.map(() => []);
  for (const edge of world.sphere.edges) {
    adjacency[edge.faces[0]].push(edge.faces[1]);
    adjacency[edge.faces[1]].push(edge.faces[0]);
  }
  return adjacency;
}

function diffuseMaximum(
  source: Float64Array,
  adjacency: readonly number[][],
  passes: number,
  decay: number,
): Float64Array {
  let field = source;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(field);
    for (let faceId = 0; faceId < field.length; faceId += 1) {
      for (const neighbor of adjacency[faceId]) {
        next[faceId] = Math.max(next[faceId], field[neighbor] * decay);
      }
    }
    field = next;
  }
  return field;
}

interface DistanceEntry {
  readonly faceId: number;
  readonly distanceKm: number;
}

class DistanceHeap {
  readonly #entries: DistanceEntry[] = [];

  push(entry: DistanceEntry): void {
    this.#entries.push(entry);
    let index = this.#entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.#entries[parent].distanceKm <= entry.distanceKm) break;
      this.#entries[index] = this.#entries[parent];
      index = parent;
    }
    this.#entries[index] = entry;
  }

  pop(): DistanceEntry | undefined {
    const root = this.#entries[0];
    const last = this.#entries.pop();
    if (!root || !last || this.#entries.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#entries.length) break;
      const right = left + 1;
      const child = right < this.#entries.length
        && this.#entries[right].distanceKm < this.#entries[left].distanceKm
        ? right
        : left;
      if (this.#entries[child].distanceKm >= last.distanceKm) break;
      this.#entries[index] = this.#entries[child];
      index = child;
    }
    this.#entries[index] = last;
    return root;
  }
}

function angularDistance(first: readonly number[], second: readonly number[]): number {
  return Math.acos(clamp(
    first[0] * second[0] + first[1] * second[1] + first[2] * second[2],
    -1,
    1,
  ));
}

/**
 * Computes distance through continental crust from the nearest active source.
 * Carrying the source amplitude separately preserves boundary maturity while
 * keeping the profile width in kilometres rather than mesh rings.
 */
function continentalSourceDistance(
  world: TectonicWorldModel,
  adjacency: readonly number[][],
  sources: Float64Array,
): { readonly distanceKm: Float64Array; readonly sourceStrength: Float64Array } {
  const distanceKm = new Float64Array(sources.length).fill(Infinity);
  const sourceStrength = new Float64Array(sources.length);
  const heap = new DistanceHeap();
  for (let faceId = 0; faceId < sources.length; faceId += 1) {
    if (sources[faceId] <= 0 || continentalFraction(world, faceId) < 0.48) continue;
    distanceKm[faceId] = 0;
    sourceStrength[faceId] = sources[faceId];
    heap.push({ faceId, distanceKm: 0 });
  }
  while (true) {
    const entry = heap.pop();
    if (!entry) break;
    if (entry.distanceKm > distanceKm[entry.faceId] + 1e-9) continue;
    const center = world.sphere.faces[entry.faceId].center;
    for (const neighborId of adjacency[entry.faceId]) {
      if (continentalFraction(world, neighborId) < 0.48) continue;
      const stepKm = angularDistance(center, world.sphere.faces[neighborId].center)
        * world.recipe.radiusKm;
      const candidate = entry.distanceKm + stepKm;
      if (candidate >= distanceKm[neighborId]) continue;
      distanceKm[neighborId] = candidate;
      sourceStrength[neighborId] = sourceStrength[entry.faceId];
      heap.push({ faceId: neighborId, distanceKm: candidate });
    }
  }
  return { distanceKm, sourceStrength };
}

function gaussianProfile(distanceKm: number, peakKm: number, widthKm: number): number {
  if (!Number.isFinite(distanceKm)) return 0;
  return Math.exp(-0.5 * ((distanceKm - peakKm) / widthKm) ** 2);
}

function continentalFraction(world: TectonicWorldModel, faceId: number): number {
  const cell = world.cells[faceId];
  return clamp(cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0));
}

/**
 * Builds finite-width mountain controls from present tectonic regimes and
 * inherited continental sutures. It is deliberately independent of rendering
 * resolution: every nested surface cell inherits one canonical geological
 * context, and the continuous sampler blends the resulting relief.
 */
export function createCanonicalOrogeny(
  world: TectonicWorldModel,
): readonly CanonicalOrogenyCell[] {
  const count = world.sphere.faces.length;
  if (world.cells.length !== count) {
    throw new RangeError("orogeny requires exactly one canonical cell per spherical face");
  }
  const adjacency = adjacencyFor(world);
  const collisionSeeds = new Float64Array(count);
  const subductionSeeds = new Float64Array(count);
  const islandArcSeeds = new Float64Array(count);
  const sutureSeeds = new Float64Array(count);

  for (const boundary of world.boundaries) {
    if (boundary.kind !== "convergent") continue;
    const edge = world.sphere.edges[boundary.edgeId];
    if (!edge) throw new RangeError(`orogeny boundary ${boundary.edgeId} has no canonical edge`);
    const [firstId, secondId] = edge.faces;
    const firstContinental = continentalFraction(world, firstId) >= 0.48;
    const secondContinental = continentalFraction(world, secondId) >= 0.48;
    const speed = clamp((Math.abs(boundary.normalKmPerMyr) - 2) / 58);
    const maturity = 0.35 + clamp(boundary.ageMyr / 120) * 0.65;
    const strength = (0.22 + speed * 0.78) * maturity;
    if (firstContinental && secondContinental) {
      collisionSeeds[firstId] = Math.max(collisionSeeds[firstId], strength);
      collisionSeeds[secondId] = Math.max(collisionSeeds[secondId], strength);
    } else if (firstContinental !== secondContinental) {
      const landwardId = firstContinental ? firstId : secondId;
      subductionSeeds[landwardId] = Math.max(subductionSeeds[landwardId], strength);
      const oceanwardId = firstContinental ? secondId : firstId;
      islandArcSeeds[oceanwardId] = Math.max(islandArcSeeds[oceanwardId], strength * 0.34);
    } else {
      islandArcSeeds[firstId] = Math.max(islandArcSeeds[firstId], strength * 0.78);
      islandArcSeeds[secondId] = Math.max(islandArcSeeds[secondId], strength * 0.78);
    }
  }

  for (const edge of world.sphere.edges) {
    const [firstId, secondId] = edge.faces;
    const first = world.cells[firstId];
    const second = world.cells[secondId];
    if (continentalFraction(world, firstId) < 0.48
      || continentalFraction(world, secondId) < 0.48
      || first.provenanceId === second.provenanceId) continue;
    const ageRetention = 0.48 + clamp((1_100 - Math.min(first.crustAgeMyr, second.crustAgeMyr)) / 1_100) * 0.32;
    sutureSeeds[firstId] = Math.max(sutureSeeds[firstId], ageRetention);
    sutureSeeds[secondId] = Math.max(sutureSeeds[secondId], ageRetention);
  }

  const collisionCore = diffuseMaximum(collisionSeeds, adjacency, 1, 0.48);
  const subductionCore = diffuseMaximum(subductionSeeds, adjacency, 1, 0.42);
  const islandArcCore = diffuseMaximum(islandArcSeeds, adjacency, 1, 0.38);
  const sutureCore = diffuseMaximum(sutureSeeds, adjacency, 2, 0.54);
  const activeSeeds = Float64Array.from({ length: count }, (_, faceId) => Math.max(
    collisionSeeds[faceId],
    subductionSeeds[faceId],
    islandArcSeeds[faceId],
    sutureSeeds[faceId] * 0.55,
  ));
  const broadEnvelope = diffuseMaximum(activeSeeds, adjacency, 5, 0.7);
  const collisionDistance = continentalSourceDistance(world, adjacency, collisionSeeds);
  const subductionDistance = continentalSourceDistance(world, adjacency, subductionSeeds);
  const characteristicKm = world.recipe.radiusKm
    * Math.sqrt(4 * Math.PI / Math.max(1, world.sphere.faces.length));
  const collisionBasinPeakKm = Math.max(620, characteristicKm * 1.12);
  const subductionBasinPeakKm = Math.max(760, characteristicKm * 1.28);
  const basinWidthKm = Math.max(360, characteristicKm * 0.78);
  const bulgeOffsetKm = Math.max(680, characteristicKm * 1.18);
  const bulgeWidthKm = Math.max(420, characteristicKm * 0.82);

  return world.sphere.faces.map((face) => {
    const faceId = face.id;
    const strengths: readonly [OrogenRegime, number][] = [
      ["collision", collisionCore[faceId]],
      ["subduction", subductionCore[faceId]],
      ["island-arc", islandArcCore[faceId]],
      ["suture", sutureCore[faceId] * 0.72],
    ];
    const [regime, dominant] = strengths.reduce(
      (best, candidate) => candidate[1] > best[1] ? candidate : best,
      ["none", 0] as readonly [OrogenRegime, number],
    );
    const core = Math.max(
      collisionCore[faceId],
      subductionCore[faceId],
      islandArcCore[faceId],
      sutureCore[faceId] * 0.72,
    );
    const collisionForeland = gaussianProfile(
      collisionDistance.distanceKm[faceId],
      collisionBasinPeakKm,
      basinWidthKm,
    ) * collisionDistance.sourceStrength[faceId];
    const subductionForeland = gaussianProfile(
      subductionDistance.distanceKm[faceId],
      subductionBasinPeakKm,
      basinWidthKm,
    ) * subductionDistance.sourceStrength[faceId];
    const forelandBasinStrength = clamp(
      Math.max(collisionForeland, subductionForeland) * (1 - core * 0.78),
    );
    const collisionBulge = gaussianProfile(
      collisionDistance.distanceKm[faceId],
      collisionBasinPeakKm + bulgeOffsetKm,
      bulgeWidthKm,
    ) * collisionDistance.sourceStrength[faceId];
    const subductionBulge = gaussianProfile(
      subductionDistance.distanceKm[faceId],
      subductionBasinPeakKm + bulgeOffsetKm,
      bulgeWidthKm,
    ) * subductionDistance.sourceStrength[faceId];
    const flexuralBulgeStrength = clamp(
      Math.max(collisionBulge, subductionBulge)
        * (1 - forelandBasinStrength * 0.62)
        * (1 - core * 0.88),
    );
    return {
      faceId,
      regime: dominant >= 0.08 ? regime : "none",
      collisionCore: collisionCore[faceId],
      subductionCore: subductionCore[faceId],
      islandArcCore: islandArcCore[faceId],
      sutureCore: sutureCore[faceId],
      foothillStrength: clamp(broadEnvelope[faceId] - core * 0.52),
      forelandBasinStrength,
      flexuralBulgeStrength,
      strength: clamp(core + broadEnvelope[faceId] * 0.34),
    };
  });
}
