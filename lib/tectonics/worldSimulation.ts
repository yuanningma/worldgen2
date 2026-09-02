import {
  boundaryGeometryFromEdge,
  classifyBoundaryKinematics,
  type BoundaryKind,
} from "./boundaries.ts";
import { createGeodesicSphere, type GeodesicSphere } from "./geodesic.ts";
import { surfaceVelocityKmPerMyr, type EulerPole } from "./kinematics.ts";
import {
  createCrustParcels,
  transportCrustParcels,
  type ParcelTransportResult,
} from "./parcelTransport.ts";
import { createRandom, type RandomSource } from "./random.ts";
import {
  angleBetweenUnitVectors,
  cross3,
  dot3,
  length3,
  normalize3,
  scale3,
  subtract3,
  type Vec3,
} from "./vector.ts";

export type CrustType = "continental" | "oceanic";

export interface TectonicWorldRecipe {
  readonly seed: string | number;
  /** Icosahedral refinement. 3 = 1,280 cells; 5 = 20,480 cells. */
  readonly subdivisions: number;
  readonly radiusKm: number;
  /** Initial kinematic plates. Splits and merges are a future transport upgrade. */
  readonly plateCount: number;
  readonly historyMyr: number;
  readonly timestepMyr: number;
  /** Area-weighted ocean coverage requested by the water-inventory inverse solver. */
  readonly oceanFraction: number;
}

export interface TectonicPlateState {
  readonly id: number;
  readonly name: string;
  readonly initialSeed: Vec3;
  readonly seed: Vec3;
  readonly pole: EulerPole;
  readonly buoyancyBias: number;
}

export interface WorldCellState {
  readonly faceId: number;
  readonly plateId: number;
  readonly crustType: CrustType;
  /** Conserved continental material share inside this control volume. */
  readonly continentalFraction?: number;
  readonly crustAgeMyr: number;
  readonly thermalAgeMyr: number;
  /** Accumulated extensional exposure retained from the tectonic history. */
  readonly riftExposureMyr?: number;
  /** Accumulated compressional exposure retained from the tectonic history. */
  readonly convergenceExposureMyr?: number;
  readonly crustThicknessKm: number;
  readonly densityKgM3: number;
  readonly provenanceId: number;
  readonly elevationKm: number;
  readonly waterDepthKm: number;
  readonly isLand: boolean;
}

export interface WorldBoundaryState {
  readonly edgeId: number;
  readonly plateAId: number;
  readonly plateBId: number;
  readonly kind: BoundaryKind;
  readonly normalKmPerMyr: number;
  readonly tangentialKmPerMyr: number;
  readonly ageMyr: number;
}

export interface TectonicAreaBudget {
  readonly sphereSteradians: number;
  readonly coveredSteradians: number;
  readonly continentalSteradians: number;
  readonly oceanicSteradians: number;
  readonly landSteradians: number;
  readonly oceanSteradians: number;
  readonly coverageResidualSteradians: number;
  readonly crustResidualSteradians: number;
}

export interface TectonicWorldStats {
  readonly landFraction: number;
  readonly continentalCrustFraction: number;
  /** Materially resolved continental provenance provinces. */
  readonly continentalTerraneCount: number;
  readonly minElevationKm: number;
  readonly maxElevationKm: number;
  readonly meanElevationKm: number;
  readonly boundaryCounts: Readonly<Record<BoundaryKind, number>>;
}

export interface TectonicWorldModel {
  readonly version: 1;
  readonly transportModel:
    | "fixed-geodesic-control-volume-v1"
    | "lagrangian-parcel-snapshot-v1"
    | "coupled-conservative-cell-history-v1";
  readonly recipe: TectonicWorldRecipe;
  readonly sphere: GeodesicSphere;
  readonly plates: readonly TectonicPlateState[];
  readonly cells: readonly WorldCellState[];
  readonly boundaries: readonly WorldBoundaryState[];
  readonly seaLevelKm: number;
  readonly elapsedMyr: number;
  readonly areaBudget: TectonicAreaBudget;
  readonly stats: TectonicWorldStats;
  /** Present only for an explicit moving-crust snapshot. */
  readonly parcelTransport?: ParcelTransportResult;
  /** Present only when conservative transport participates in every history step. */
  readonly transportHistory?: CoupledTransportHistory;
}

export interface CoupledTransportHistory {
  readonly stepCount: number;
  readonly maximumAreaResidualSteradians: number;
  readonly maximumMaterialResidualSteradians: number;
  readonly maximumFaceAreaResidualSteradians: number;
  readonly maximumNonlocalTransportAreaFraction: number;
  readonly meanStepTransportDistanceRadians: number;
  readonly maximumTransportDistanceRadians: number;
  readonly createdAreaSteradians: number;
  readonly destroyedAreaSteradians: number;
  readonly maximumCourantNumber: number;
}

interface MutableCell {
  plateId: number;
  plateFractions: number[];
  crustType: CrustType;
  continentalFraction: number;
  crustAgeMyr: number;
  crustThicknessKm: number;
  densityKgM3: number;
  provenanceId: number;
  tectonicReliefKm: number;
  roughnessKm: number;
  /** Dimensionless inherited lithospheric weakness; not elapsed rift time. */
  riftWeakness: number;
  riftExposureMyr: number;
  convergenceExposureMyr: number;
}

interface MutableBoundaryAge {
  kind: BoundaryKind;
  ageMyr: number;
}

const DEFAULT_RECIPE: TectonicWorldRecipe = {
  seed: "ATLAS-TECTONIC-11",
  subdivisions: 3,
  radiusKm: 6371,
  plateCount: 14,
  historyMyr: 360,
  timestepMyr: 2,
  oceanFraction: 0.68,
};

function validateRecipe(recipe: TectonicWorldRecipe): void {
  if (!Number.isInteger(recipe.subdivisions) || recipe.subdivisions < 1 || recipe.subdivisions > 5) {
    throw new RangeError("subdivisions must be an integer between 1 and 5");
  }
  if (!(recipe.radiusKm >= 500 && recipe.radiusKm <= 50_000)) {
    throw new RangeError("radiusKm must be between 500 and 50,000");
  }
  if (!Number.isInteger(recipe.plateCount) || recipe.plateCount < 4 || recipe.plateCount > 64) {
    throw new RangeError("plateCount must be an integer between 4 and 64");
  }
  if (!(recipe.historyMyr > 0 && recipe.historyMyr <= 2_000)) {
    throw new RangeError("historyMyr must be positive and at most 2,000");
  }
  if (!(recipe.timestepMyr > 0 && recipe.timestepMyr <= 10)) {
    throw new RangeError("timestepMyr must be positive and at most 10");
  }
  if (recipe.historyMyr / recipe.timestepMyr > 2_000) {
    throw new RangeError("history may contain at most 2,000 timesteps");
  }
  if (!(recipe.oceanFraction > 0.35 && recipe.oceanFraction < 0.9)) {
    throw new RangeError("oceanFraction must be between 0.35 and 0.9");
  }
}

function randomUnitVector(random: RandomSource): Vec3 {
  const z = random.range(-1, 1);
  const longitude = random.range(-Math.PI, Math.PI);
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return [radial * Math.cos(longitude), radial * Math.sin(longitude), z];
}

function mixedNoise(point: Vec3, seed: number): number {
  // Continuous, deterministic low-cost spherical signal. Incommensurate planes
  // avoid projection seams and grid-aligned continental outlines.
  const [x, y, z] = point;
  return (
    Math.sin(x * 5.31 + y * 2.17 - z * 3.73 + seed * 0.011) * 0.52
    + Math.sin(x * 11.7 - y * 7.13 + z * 4.91 + seed * 0.027) * 0.29
    + Math.cos(x * 23.1 + y * 17.3 - z * 13.1 + seed * 0.043) * 0.13
    + Math.sin(x * 41.3 - y * 31.7 + z * 29.9 + seed * 0.071) * 0.06
  );
}

function tangentUnitVector(direction: Vec3, point: Vec3): Vec3 {
  const projected = subtract3(direction, scale3(point, dot3(direction, point)));
  if (length3(projected) > 1e-10) return normalize3(projected);
  const reference: Vec3 = Math.abs(point[2]) < 0.88 ? [0, 0, 1] : [0, 1, 0];
  return normalize3(cross3(reference, point));
}

function createPlateSeeds(random: RandomSource, plateCount: number): Vec3[] {
  const seeds: Vec3[] = [];
  const minimumSeparation = Math.min(0.72, 2.25 / Math.sqrt(plateCount));
  for (let id = 0; id < plateCount; id += 1) {
    let best = randomUnitVector(random);
    let bestDistance = -1;
    const candidates = id === 0 ? 1 : 96;
    for (let attempt = 0; attempt < candidates; attempt += 1) {
      const candidate = randomUnitVector(random);
      const separation = seeds.length === 0
        ? Math.PI
        : Math.min(...seeds.map((seed) => angleBetweenUnitVectors(seed, candidate)));
      if (separation > bestDistance) {
        best = candidate;
        bestDistance = separation;
      }
      if (separation >= minimumSeparation && attempt > 12) break;
    }
    seeds.push(best);
  }
  return seeds;
}

function nearestPlate(point: Vec3, plates: readonly TectonicPlateState[]): number {
  let selected = 0;
  let best = -Infinity;
  for (const plate of plates) {
    // Bias creates a broad plate-size distribution without ellipsoidal land stamps.
    const score = dot3(point, plate.seed) + plate.buoyancyBias * 0.025;
    if (score > best) {
      best = score;
      selected = plate.id;
    }
  }
  return selected;
}

function buildAdjacency(sphere: GeodesicSphere): readonly number[][] {
  const neighbors = sphere.faces.map(() => [] as number[]);
  for (const edge of sphere.edges) {
    neighbors[edge.faces[0]].push(edge.faces[1]);
    neighbors[edge.faces[1]].push(edge.faces[0]);
  }
  return neighbors;
}

function seedHashNumber(seed: string | number): number {
  const text = String(seed);
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

interface GrowthEntry {
  faceId: number;
  regionId: number;
  cost: number;
}

class GrowthHeap {
  private readonly entries: GrowthEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  push(entry: GrowthEntry): void {
    let index = this.entries.length;
    this.entries.push(entry);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.entries[parent].cost <= entry.cost) break;
      this.entries[index] = this.entries[parent];
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): GrowthEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (!first || !last || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.entries.length) break;
      const right = left + 1;
      const child = right < this.entries.length && this.entries[right].cost < this.entries[left].cost ? right : left;
      if (this.entries[child].cost >= last.cost) break;
      this.entries[index] = this.entries[child];
      index = child;
    }
    this.entries[index] = last;
    return first;
  }
}

interface ContinentalGrowthResult {
  readonly regions: Int32Array;
  /** Subordinate accretion fronts retained as persistent crust provenance. */
  readonly terranes: Int32Array;
  /** Inherited weak belts that later divergence can reactivate. */
  readonly riftInheritance: Float64Array;
  /** Sutures and active-margin terranes inherited from primordial assembly. */
  readonly accretionInheritance: Float64Array;
}

interface TerraneDeformationGuide {
  readonly origin: Vec3;
  /** Locally projected material grain inherited from primordial plate motion. */
  readonly axis: Vec3;
  readonly transverseAxis: Vec3;
  readonly phase: number;
  readonly fieldSeed: number;
  readonly aspectStrength: number;
  readonly equivalentRadiusRadians: number;
}

function continentalGraphRegions(
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  plateByFace: readonly number[],
  adjacency: readonly number[][],
  random: RandomSource,
  seedHash: number,
  radiusKm: number,
  deformationGuided = false,
): ContinentalGrowthResult {
  const plateNeighbors = plates.map(() => new Set<number>());
  const boundaryRegimes = new Map<number, BoundaryKind>();
  // Subdivision 3 cannot resolve a deformation belt and ocean on both sides;
  // applying the field there aliases folds into one-cell bridges. Production
  // subdivision 4+ has enough control volumes for this geometry.
  const resolvedDeformation = deformationGuided && sphere.subdivisions >= 4;
  for (const edge of sphere.edges) {
    const first = plateByFace[edge.faces[0]];
    const second = plateByFace[edge.faces[1]];
    if (first !== second) {
      plateNeighbors[first].add(second);
      plateNeighbors[second].add(first);
      const motion = classifyBoundaryKinematics(
        boundaryGeometryFromEdge(sphere, edge.id, edge.faces[0]),
        plates[first].pole,
        plates[second].pole,
        radiusKm,
        {
          normalEnterKmPerMyr: 4,
          normalExitKmPerMyr: 2,
          transformEnterKmPerMyr: 4,
          transformExitKmPerMyr: 2,
        },
      );
      const low = Math.min(...edge.faces);
      const high = Math.max(...edge.faces);
      boundaryRegimes.set(low * sphere.faces.length + high, motion.kind);
    }
  }

  // Seed several crustal communities around a deliberately uneven primordial
  // assembly. A weak open-ocean pole leaves one broad hemisphere underseeded,
  // while a sampled preferred separation avoids both regular spherical packing
  // and a single supercontinent. These are material provinces rather than
  // requested final continents.
  // Keep a roughly physical, rather than angular, density of primordial
  // continental systems. A larger mobile-lid planet has room for more
  // independently evolving cratons instead of merely stretching the same
  // handful of sources across a larger globe. The count is still only an
  // initialization capacity: later transport can join, split, drown, or expose
  // these communities, so it is not a requested final continent count.
  const relativeSurfaceArea = (radiusKm / 6_371) ** 2;
  const regionalPlacementEnabled = resolvedDeformation && relativeSurfaceArea >= 1.35;
  const additionalCommunities = Math.max(0, Math.round((relativeSurfaceArea - 1) * 2.5));
  const communityCount = Math.min(
    plates.length,
    5 + random.integer(0, 3) + additionalCommunities,
  );
  const openOceanPole = randomUnitVector(random);
  const roots: number[] = [];
  while (roots.length < communityCount) {
    const preferredSeparation = random.range(0.27, 0.54);
    const candidates = plates
      .filter((plate) => !roots.includes(plate.id))
      .map((plate) => {
        const separation = roots.length === 0 ? 1 : Math.min(...roots.map((root) => (
          angleBetweenUnitVectors(plate.initialSeed, plates[root].initialSeed)
        ))) / Math.PI;
        const spacingFitness = roots.length === 0
          ? 1
          : Math.exp(-1 * ((separation - preferredSeparation) / 0.14) ** 2);
        const openOceanClearance = (1 - dot3(plate.initialSeed, openOceanPole)) * 0.5;
        const crowdingPenalty = separation < 0.2 ? (0.2 - separation) * 10 : 0;
        return {
          id: plate.id,
          score: plate.buoyancyBias * 0.26
            + spacingFitness * 0.62
            + openOceanClearance * 0.2
            + separation * 0.3
            + random.next() * 0.18
            - crowdingPenalty
            - Math.abs(plate.initialSeed[2]) * 0.42,
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);
    roots.push(candidates[0].id);
  }

  const additionalTerranes = Math.max(0, Math.round((relativeSurfaceArea - 1) * 4));
  const baseNucleusCount = Math.min(
    13,
    Math.max(9, Math.round(Math.sqrt(plates.length)) + random.integer(5, 9)),
  );
  const nucleusCount = Math.min(sphere.faces.length, baseNucleusCount + additionalTerranes);
  const nucleusPlates = [...roots];
  while (nucleusPlates.length < Math.min(plates.length, nucleusCount)) {
    const candidates = plates
      .filter((plate) => !nucleusPlates.includes(plate.id))
      .map((plate) => {
        const communityAffinity = roots.some((root) => plateNeighbors[root].has(plate.id)) ? 1 : 0;
        const memberAffinity = nucleusPlates.some((member) => plateNeighbors[member].has(plate.id)) ? 0.55 : 0;
        return {
          id: plate.id,
          score: communityAffinity + memberAffinity + plate.buoyancyBias * 0.38 + random.next() * 0.22,
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);
    nucleusPlates.push(candidates[0].id);
  }
  const nucleusFaces = nucleusPlates.map((plateId) => {
    let selected = 0;
    let best = -Infinity;
    for (const face of sphere.faces) {
      if (plateByFace[face.id] !== plateId) continue;
      const score = dot3(face.center, plates[plateId].initialSeed);
      if (score > best) {
        best = score;
        selected = face.id;
      }
    }
    return selected;
  });
  const distinctPlateNucleusCount = nucleusFaces.length;
  while (nucleusFaces.length < nucleusCount) {
    let selectedFaceId = -1;
    let selectedPlateId = -1;
    let best = -Infinity;
    for (const face of sphere.faces) {
      if (nucleusFaces.includes(face.id)) continue;
      const plateId = plateByFace[face.id];
      const samePlateNuclei = nucleusFaces.filter((nucleusFaceId) => (
        plateByFace[nucleusFaceId] === plateId
      ));
      if (samePlateNuclei.length === 0) continue;
      const separation = Math.min(...samePlateNuclei.map((nucleusFaceId) => (
        angleBetweenUnitVectors(face.center, sphere.faces[nucleusFaceId].center)
      )));
      const score = separation
        + mixedNoise(face.center, seedHash + nucleusFaces.length * 2_003) * 0.08
        - Math.abs(face.center[2]) * 0.025;
      if (score > best) {
        best = score;
        selectedFaceId = face.id;
        selectedPlateId = plateId;
      }
    }
    if (selectedFaceId < 0) break;
    nucleusFaces.push(selectedFaceId);
    nucleusPlates.push(selectedPlateId);
  }
  const nucleusCommunities = nucleusPlates.map((plateId, index) => {
    const center = index < distinctPlateNucleusCount
      ? plates[plateId].initialSeed
      : sphere.faces[nucleusFaces[index]].center;
    return roots
      .map((rootId, communityId) => ({
        communityId,
        distance: angleBetweenUnitVectors(center, plates[rootId].initialSeed),
      }))
      .sort((a, b) => a.distance - b.distance || a.communityId - b.communityId)[0].communityId;
  });
  const rawWeights = nucleusFaces.map((_, index) => Math.exp(random.range(-0.72, 0.72)) * (
    index === 0
      ? 1.45
      : index >= distinctPlateNucleusCount
        ? 0.58
        : 1
  ));
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const targetArea = sphere.totalAreaSteradians * 0.38;
  const meanControlCellRadians = Math.sqrt(sphere.totalAreaSteradians / sphere.faces.length);
  const frontFaces: number[] = [];
  const frontRegions: number[] = [];
  const frontRawWeights: number[] = [];
  for (let regionId = 0; regionId < nucleusFaces.length; regionId += 1) {
    const groupBudgetShare = rawWeights[regionId] / totalWeight;
    const subordinateCount = 3 + random.integer(0, 4);
    const lobeFaces = [nucleusFaces[regionId]];
    for (let lobe = 0; lobe < subordinateCount; lobe += 1) {
      let faceId = nucleusFaces[regionId];
      // Each geodesic refinement approximately halves cell width. Preserve the
      // physical terrane/lobe wavelength at production subdivision 5 instead
      // of squeezing the same three-to-fifteen-cell walk into half the angular
      // footprint and making higher-resolution continents rounder and simpler.
      const refinementWalkScale = sphere.subdivisions <= 4
        ? 1
        : Math.max(
          1,
          2 ** (sphere.subdivisions - 4) * 6_371 / radiusKm,
        );
      const walkSteps = Math.round(
        (3 + random.integer(0, 5 + sphere.subdivisions * 2)) * refinementWalkScale,
      );
      for (let step = 0; step < walkSteps; step += 1) {
        const candidates = adjacency[faceId]
          .slice()
          .sort((a, b) => {
            const aScore = mixedNoise(sphere.faces[a].center, seedHash + regionId * 1_009 + lobe * 97);
            const bScore = mixedNoise(sphere.faces[b].center, seedHash + regionId * 1_009 + lobe * 97);
            return aScore - bScore || a - b;
          });
        faceId = candidates[random.integer(0, Math.min(2, candidates.length))];
      }
      if (!lobeFaces.includes(faceId)) lobeFaces.push(faceId);
    }
    const lobeWeights = lobeFaces.map((_, index) => index === 0 ? 1.7 : random.range(0.34, 1.08));
    if (regionalPlacementEnabled && regionId >= distinctPlateNucleusCount) {
      // The legacy walks above still consume the historical random stream so
      // budgets and later dynamics remain directly comparable. Large-world
      // supplemental placement itself is selected from a bounded regional
      // annulus using a private stream. Primary plate nuclei retain their
      // proven assembly; weight-aware reach keeps new accreted blocks attached
      // while allowing the larger ones to shape a broad cape or embayment.
      const nucleus = sphere.faces[nucleusFaces[regionId]].center;
      const regionalRadius = Math.max(
        meanControlCellRadians * 4,
        Math.sqrt(targetArea * groupBudgetShare / Math.PI),
      );
      const placedFaces = [nucleusFaces[regionId]];
      for (let index = 1; index < lobeFaces.length; index += 1) {
        const lobe = index - 1;
        const placementRandom = createRandom(`${seedHash}:regional-lobe:${regionId}:${lobe}`);
        const guide = tangentUnitVector(randomUnitVector(placementRandom), nucleus);
        const weightScale = Math.sqrt(Math.max(0, Math.min(1, lobeWeights[index] / 1.08)));
        const desiredDistance = regionalRadius * (
          0.12 + weightScale * placementRandom.range(0.12, 0.24)
        );
        const maximumDistance = regionalRadius * (0.24 + weightScale * 0.2);
        let regionalFaceId = lobeFaces[index];
        let regionalScore = -Infinity;
        for (const candidate of sphere.faces) {
          if (placedFaces.includes(candidate.id)) continue;
          const distance = angleBetweenUnitVectors(nucleus, candidate.center);
          if (distance < meanControlCellRadians * 1.65 || distance > maximumDistance) continue;
          const candidatePlateId = plateByFace[candidate.id];
          const nucleusPlateId = nucleusPlates[regionId];
          const samePlate = candidatePlateId === nucleusPlateId;
          const neighboringPlate = plateNeighbors[nucleusPlateId].has(candidatePlateId);
          if (!samePlate && !neighboringPlate) continue;
          const candidateDirection = tangentUnitVector(subtract3(candidate.center, nucleus), nucleus);
          const directionFit = dot3(candidateDirection, guide);
          const radialError = Math.abs(distance - desiredDistance)
            / Math.max(meanControlCellRadians, regionalRadius * 0.16);
          const separation = Math.min(...placedFaces.map((existingId) => (
            angleBetweenUnitVectors(candidate.center, sphere.faces[existingId].center)
          )));
          const normalizedSeparation = separation / regionalRadius;
          const crowdingPenalty = Math.max(0, 0.16 - normalizedSeparation) * 3.2;
          const plateAffinity = samePlate ? 0.08 : 0.025;
          const texture = mixedNoise(
            candidate.center,
            seedHash + regionId * 1_009 + lobe * 97 + 29_003,
          );
          const score = directionFit * 0.28
            - radialError * 0.62
            + Math.min(0.5, normalizedSeparation) * 0.18
            + plateAffinity
            + texture * 0.06
            - crowdingPenalty;
          if (score > regionalScore || (score === regionalScore && candidate.id < regionalFaceId)) {
            regionalScore = score;
            regionalFaceId = candidate.id;
          }
        }
        lobeFaces[index] = regionalFaceId;
        placedFaces.push(regionalFaceId);
      }
    }
    const lobeWeightTotal = lobeWeights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < lobeFaces.length; index += 1) {
      frontFaces.push(lobeFaces[index]);
      frontRegions.push(nucleusCommunities[regionId]);
      frontRawWeights.push(groupBudgetShare * lobeWeights[index] / lobeWeightTotal);
    }
  }
  const directions = frontFaces.map(() => randomUnitVector(random));
  // Individual lobes compete for the same cells. Giving their private budgets
  // exactly the target total guarantees an area deficit wherever fronts meet,
  // and the old union-front fallback then inflated a smooth outer hull. A
  // bounded reserve lets surviving terranes continue around one another until
  // the global inventory closes, preserving bays, reentrants, and subordinate
  // peninsulas without prescribing a final continent count.
  const frontBudgetReserve = 1.2;
  const budgets = frontRawWeights.map((weight) => targetArea * weight * frontBudgetReserve);
  const deformationGuides: readonly TerraneDeformationGuide[] = resolvedDeformation
    ? frontFaces.map((faceId, frontId) => {
      const origin = sphere.faces[faceId].center;
      const plateVelocity = surfaceVelocityKmPerMyr(
        plates[plateByFace[faceId]].pole,
        origin,
        radiusKm,
      );
      const motionAxis = length3(plateVelocity) > 1e-9
        ? normalize3(plateVelocity)
        : tangentUnitVector(directions[frontId], origin);
      const perturbation = tangentUnitVector(directions[frontId], origin);
      // Neighboring terranes share only part of the plate-wide velocity grain;
      // local inherited fabric supplies the rest. Strongly aligning every
      // front to present motion makes whole communities bridge in parallel.
      const motionWeight = random.range(0.24, 0.46);
      const axis = tangentUnitVector([
        motionAxis[0] * motionWeight + perturbation[0] * (1 - motionWeight),
        motionAxis[1] * motionWeight + perturbation[1] * (1 - motionWeight),
        motionAxis[2] * motionWeight + perturbation[2] * (1 - motionWeight),
      ], origin);
      return {
        origin,
        axis,
        transverseAxis: normalize3(cross3(origin, axis)),
        phase: random.range(-Math.PI, Math.PI),
        fieldSeed: seedHash + frontId * 7_919 + 61_003,
        // A modest aspect ratio reads as deformed crust without recreating the
        // long ribbon continents rejected by the morphology gate.
        aspectStrength: random.range(0.1, 0.2),
        equivalentRadiusRadians: Math.sqrt(Math.max(1e-12, budgets[frontId]) / Math.PI),
      };
    })
    : [];
  const guidedResistance = (
    frontId: number,
    currentId: number,
    neighborId: number,
  ): number => {
    const guide = deformationGuides[frontId];
    if (!guide) return 0;
    const current = sphere.faces[currentId].center;
    const neighbor = sphere.faces[neighborId].center;
    const edgeAxis = tangentUnitVector(subtract3(neighbor, current), current);
    const localGrain = tangentUnitVector(guide.axis, current);
    const alignment = Math.abs(dot3(edgeAxis, localGrain));
    const anisotropy = 1 + guide.aspectStrength * (0.55 - alignment);

    // Coherent resistant belts survive path integration, unlike white noise.
    // They leave broad reentrants between accreted blocks; the lower-amplitude
    // negative half of the field permits capes without drawing thin tendrils.
    const physicalScale = Math.max(0.55, Math.min(2.25, radiusKm / 6_371));
    const foldedPhase = (
      dot3(neighbor, guide.axis) * 8.3
      + dot3(neighbor, guide.transverseAxis) * 3.7
    ) * physicalScale + guide.phase;
    const folded = Math.sin(foldedPhase) * 0.58
      + physicalShorelineNoise(neighbor, guide.fieldSeed, radiusKm) * 0.42;
    const resistantBelt = Math.max(0, folded - 0.42) ** 1.65 * 0.55;
    const promontoryCorridor = Math.max(0, -folded - 0.62) * 0.07;

    // A soft physical reach limit keeps difficult belts from diverting a front
    // into a continent-scale filament. It does not prescribe the outline: the
    // budget and competition still decide where the shoreline closes.
    const reach = angleBetweenUnitVectors(guide.origin, neighbor)
      / Math.max(1e-6, guide.equivalentRadiusRadians);
    const reachPenalty = Math.max(0, reach - 1.34) ** 2 * 0.84;
    return Math.max(0.42, anisotropy + resistantBelt - promontoryCorridor + reachPenalty);
  };
  const frontAreas = new Float64Array(frontFaces.length);
  const regions = new Int32Array(sphere.faces.length).fill(-1);
  const terranes = new Int32Array(sphere.faces.length).fill(-1);
  const protectedOcean = new Uint8Array(sphere.faces.length);
  const costs = frontFaces.map(() => new Float64Array(sphere.faces.length).fill(Infinity));
  const heap = new GrowthHeap();
  for (let frontId = 0; frontId < frontFaces.length; frontId += 1) {
    const faceId = frontFaces[frontId];
    costs[frontId][faceId] = 0;
    heap.push({ faceId, regionId: frontId, cost: 0 });
  }
  let claimedArea = 0;
  while (heap.length > 0 && claimedArea < targetArea) {
    const entry = heap.pop() as GrowthEntry;
    if (entry.cost !== costs[entry.regionId][entry.faceId]
      || regions[entry.faceId] !== -1
      || protectedOcean[entry.faceId] !== 0) continue;
    if (frontAreas[entry.regionId] >= budgets[entry.regionId]) continue;
    const communityId = frontRegions[entry.regionId];
    if (adjacency[entry.faceId].some((neighborId) => (
      regions[neighborId] >= 0 && regions[neighborId] !== communityId
    ))) {
      // Competing terranes in one community may suture. Competing primordial
      // communities retain a resolved oceanic separator, preventing the global
      // area budget from welding every source province into one continent.
      protectedOcean[entry.faceId] = 1;
      continue;
    }
    regions[entry.faceId] = communityId;
    terranes[entry.faceId] = entry.regionId;
    const faceArea = sphere.faces[entry.faceId].areaSteradians;
    frontAreas[entry.regionId] += faceArea;
    claimedArea += faceArea;
    const current = sphere.faces[entry.faceId];
    for (const neighborId of adjacency[entry.faceId]) {
      if (regions[neighborId] !== -1) continue;
      const neighbor = sphere.faces[neighborId];
      const distance = angleBetweenUnitVectors(current.center, neighbor.center);
      const directionGain = (
        dot3(neighbor.center, directions[entry.regionId])
        - dot3(current.center, directions[entry.regionId])
      ) / Math.max(distance, 1e-9);
      const noise = mixedNoise(neighbor.center, seedHash + entry.regionId * 7_919);
      const crossesPlate = plateByFace[neighborId] !== plateByFace[entry.faceId];
      const neighborBuoyancy = plates[plateByFace[neighborId]].buoyancyBias;
      const low = Math.min(entry.faceId, neighborId);
      const high = Math.max(entry.faceId, neighborId);
      const crossingKind = boundaryRegimes.get(low * sphere.faces.length + high);
      const tectonicCrossingCost = crossingKind === "divergent"
        ? 1.35
        : crossingKind === "transform"
          ? 0.35
          : crossingKind === "convergent"
            ? -0.08
            : 0.2;
      const polarResistance = Math.max(0, Math.abs(neighbor.center[2]) - 0.76) * 2.2;
      const structuralResistance = resolvedDeformation
        ? Math.exp(noise * 0.82 - directionGain * 0.32)
          * guidedResistance(entry.regionId, entry.faceId, neighborId)
        : Math.exp(noise * 0.82 - directionGain * 0.32);
      const resistance = Math.max(0.18,
        structuralResistance + polarResistance
        + (crossesPlate ? tectonicCrossingCost - neighborBuoyancy * 0.06 : -0.05));
      const cost = entry.cost + distance * resistance;
      if (cost < costs[entry.regionId][neighborId]) {
        costs[entry.regionId][neighborId] = cost;
        heap.push({ faceId: neighborId, regionId: entry.regionId, cost });
      }
    }
  }
  if (claimedArea < targetArea) {
    // Fronts can shadow one another when subordinate lobes merge. Complete the
    // crust inventory from the union shoreline instead of inflating a surviving
    // lobe's private budget, preserving the multi-lobed topology.
    const fallback = new GrowthHeap();
    const fallbackCosts = new Float64Array(sphere.faces.length).fill(Infinity);
    const fallbackRegions = new Int32Array(sphere.faces.length).fill(-1);
    const fallbackTerranes = new Int32Array(sphere.faces.length).fill(-1);
    const enqueue = (fromId: number, neighborId: number, baseCost: number): void => {
      if (regions[neighborId] !== -1 || protectedOcean[neighborId] !== 0) return;
      const regionId = regions[fromId];
      if (adjacency[neighborId].some((candidateId) => (
        regions[candidateId] >= 0 && regions[candidateId] !== regionId
      ))) {
        protectedOcean[neighborId] = 1;
        return;
      }
      const noise = mixedNoise(sphere.faces[neighborId].center, seedHash + regionId * 7_919 + 313);
      const low = Math.min(fromId, neighborId);
      const high = Math.max(fromId, neighborId);
      const crossingKind = boundaryRegimes.get(low * sphere.faces.length + high);
      const crossing = crossingKind === "divergent" ? 1.2 : crossingKind === "transform" ? 0.3 : 0;
      const frontId = terranes[fromId];
      const structuralResistance = resolvedDeformation && frontId >= 0
        ? Math.exp(noise * 0.9) * guidedResistance(frontId, fromId, neighborId)
        : Math.exp(noise * 0.9);
      const cost = baseCost + Math.max(0.12, structuralResistance + crossing);
      if (cost < fallbackCosts[neighborId]) {
        fallbackCosts[neighborId] = cost;
        fallbackRegions[neighborId] = regionId;
        fallbackTerranes[neighborId] = terranes[fromId];
        fallback.push({ faceId: neighborId, regionId, cost });
      }
    };
    for (const face of sphere.faces) {
      if (regions[face.id] < 0) continue;
      for (const neighborId of adjacency[face.id]) enqueue(face.id, neighborId, 0);
    }
    while (fallback.length > 0 && claimedArea < targetArea) {
      const entry = fallback.pop() as GrowthEntry;
      if (regions[entry.faceId] !== -1 || entry.cost !== fallbackCosts[entry.faceId]) continue;
      regions[entry.faceId] = fallbackRegions[entry.faceId];
      terranes[entry.faceId] = fallbackTerranes[entry.faceId];
      claimedArea += sphere.faces[entry.faceId].areaSteradians;
      for (const neighborId of adjacency[entry.faceId]) enqueue(entry.faceId, neighborId, entry.cost);
    }
  }

  const riftSeeds = new Float64Array(sphere.faces.length);
  const accretionSeeds = new Float64Array(sphere.faces.length);
  for (const edge of sphere.edges) {
    const [firstId, secondId] = edge.faces;
    const firstRegion = regions[firstId];
    const secondRegion = regions[secondId];
    const firstContinental = firstRegion >= 0;
    const secondContinental = secondRegion >= 0;
    if (!firstContinental && !secondContinental) continue;
    const low = Math.min(firstId, secondId);
    const high = Math.max(firstId, secondId);
    const regime = boundaryRegimes.get(low * sphere.faces.length + high);
    if (regime === "divergent") {
      if (firstContinental) riftSeeds[firstId] = Math.max(riftSeeds[firstId], secondContinental ? 1 : 0.72);
      if (secondContinental) riftSeeds[secondId] = Math.max(riftSeeds[secondId], firstContinental ? 1 : 0.72);
    }
    const inheritedSuture = firstContinental && secondContinental
      && (firstRegion !== secondRegion || terranes[firstId] !== terranes[secondId]);
    if (inheritedSuture || regime === "convergent") {
      if (firstContinental) accretionSeeds[firstId] = Math.max(
        accretionSeeds[firstId],
        inheritedSuture ? 1 : 0.68,
      );
      if (secondContinental) accretionSeeds[secondId] = Math.max(
        accretionSeeds[secondId],
        inheritedSuture ? 1 : 0.68,
      );
    }
  }
  const spreadInheritance = (source: Float64Array, decay: number): Float64Array => {
    let current = source;
    for (let pass = 0; pass < 3; pass += 1) {
      const next = new Float64Array(current);
      for (const face of sphere.faces) {
        if (regions[face.id] < 0) continue;
        for (const neighborId of adjacency[face.id]) {
          if (regions[neighborId] < 0) continue;
          next[face.id] = Math.max(next[face.id], current[neighborId] * decay);
        }
      }
      current = next;
    }
    return current;
  };
  const riftInheritance = spreadInheritance(riftSeeds, 0.57);
  const accretionInheritance = spreadInheritance(accretionSeeds, 0.6);
  return { regions, terranes, riftInheritance, accretionInheritance };
}

function continentalProvinceFields(
  sphere: GeodesicSphere,
  growth: ContinentalGrowthResult,
  adjacency: readonly number[][],
): {
  readonly coastDistanceRings: Int16Array;
  readonly sutureStrength: Float64Array;
  readonly primaryTerranes: ReadonlySet<number>;
} {
  const coastDistanceRings = new Int16Array(sphere.faces.length).fill(-1);
  const queue: number[] = [];
  for (const face of sphere.faces) {
    if (growth.regions[face.id] < 0) continue;
    if (adjacency[face.id].some((neighbor) => growth.regions[neighbor] < 0)) {
      coastDistanceRings[face.id] = 0;
      queue.push(face.id);
    }
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const faceId = queue[cursor];
    const nextDistance = coastDistanceRings[faceId] + 1;
    for (const neighbor of adjacency[faceId]) {
      if (growth.regions[neighbor] < 0 || coastDistanceRings[neighbor] >= 0) continue;
      coastDistanceRings[neighbor] = nextDistance;
      queue.push(neighbor);
    }
  }

  let sutureStrength = Float64Array.from(sphere.faces.map((face) => {
    const terrane = growth.terranes[face.id];
    if (terrane < 0) return 0;
    return adjacency[face.id].some((neighbor) => (
      growth.regions[neighbor] === growth.regions[face.id]
      && growth.terranes[neighbor] >= 0
      && growth.terranes[neighbor] !== terrane
    )) ? 1 : 0;
  }));
  for (let pass = 0; pass < 3; pass += 1) {
    const next = new Float64Array(sutureStrength);
    for (const face of sphere.faces) {
      if (growth.regions[face.id] < 0) continue;
      for (const neighbor of adjacency[face.id]) {
        if (growth.regions[neighbor] !== growth.regions[face.id]) continue;
        next[face.id] = Math.max(next[face.id], sutureStrength[neighbor] * 0.54);
      }
    }
    sutureStrength = next;
  }

  const terraneAreas = new Map<number, number>();
  const regionTerranes = new Map<number, Set<number>>();
  for (const face of sphere.faces) {
    const terrane = growth.terranes[face.id];
    const region = growth.regions[face.id];
    if (terrane < 0 || region < 0) continue;
    terraneAreas.set(terrane, (terraneAreas.get(terrane) ?? 0) + face.areaSteradians);
    if (!regionTerranes.has(region)) regionTerranes.set(region, new Set());
    regionTerranes.get(region)?.add(terrane);
  }
  const primaryTerranes = new Set<number>();
  for (const terraneIds of regionTerranes.values()) {
    const primary = [...terraneIds].sort((a, b) => (
      (terraneAreas.get(b) ?? 0) - (terraneAreas.get(a) ?? 0) || a - b
    ))[0];
    if (primary !== undefined) primaryTerranes.add(primary);
  }
  return { coastDistanceRings, sutureStrength, primaryTerranes };
}

function createInitialCells(
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  random: RandomSource,
  seed: string | number,
  radiusKm: number,
  inheritanceEnabled = false,
): MutableCell[] {
  const hash = seedHashNumber(seed);
  const adjacency = buildAdjacency(sphere);
  const plateByFace = sphere.faces.map((face) => nearestPlate(face.center, plates));
  const continentalGrowth = continentalGraphRegions(
    sphere,
    plates,
    plateByFace,
    adjacency,
    random,
    hash,
    radiusKm,
    inheritanceEnabled,
  );
  const provinces = continentalProvinceFields(sphere, continentalGrowth, adjacency);
  return sphere.faces.map((face) => {
    const plateId = plateByFace[face.id];
    const texture = mixedNoise(face.center, hash);
    const regionId = continentalGrowth.regions[face.id];
    const terraneId = continentalGrowth.terranes[face.id];
    const continental = regionId >= 0;
    const terraneHash = seedHashNumber(`${seed}:terrane:${terraneId}`);
    const terraneBias = continental
      ? (terraneHash / 0xffff_ffff - 0.5) * (provinces.primaryTerranes.has(terraneId) ? 0.2 : 0.6)
      : 0;
    const coastRing = provinces.coastDistanceRings[face.id];
    const marginTexture = continental
      ? mixedNoise(face.center, hash + regionId * 1_237 + terraneId * 61 + 4_099)
      : 0;
    const shelfTaper = !continental
      ? 0
      : coastRing <= 0
        ? -2.15 + marginTexture * 1.05
        : coastRing === 1
          ? -0.72 + marginTexture * 0.42
          : coastRing === 2
            ? -0.18 + marginTexture * 0.14
            : coastRing === 3
              ? -0.04
              : 0;
    const suture = provinces.sutureStrength[face.id];
    const inheritedRift = inheritanceEnabled
      ? continentalGrowth.riftInheritance[face.id]
      : 0;
    const inheritedAccretion = inheritanceEnabled
      ? continentalGrowth.accretionInheritance[face.id]
      : 0;
    const provinceTexture = continental
      ? mixedNoise(face.center, hash + terraneId * 503 + 17)
      : 0;
    const age = continental
      ? 1_250 + texture * 620 + (face.center[2] + 1) * 170
      : 75 + texture * 55;
    return {
      plateId,
      plateFractions: plates.map((plate) => plate.id === plateId ? 1 : 0),
      crustType: continental ? "continental" : "oceanic",
      continentalFraction: continental ? 1 : 0,
      crustAgeMyr: age,
      crustThicknessKm: continental
        ? 36.5 + texture * 4.2 + provinceTexture * 0.3 + terraneBias + shelfTaper
          + suture * 0.6 + inheritedAccretion * 0.85 - inheritedRift * 0.55
        : 7 + texture * 0.75,
      densityKgM3: continental ? 2_745 - texture * 28 : 2_985 + texture * 38,
      provenanceId: continental ? 10_000 + terraneId : plateId,
      tectonicReliefKm: continental
        ? suture * 0.04 + inheritedAccretion * 0.18 - inheritedRift * 0.12
        : 0,
      roughnessKm: continental
        ? texture * 0.12 + provinceTexture * 0.01 + inheritedAccretion * 0.025
        : texture * 0.07,
      riftWeakness: continental ? inheritedRift : 0,
      riftExposureMyr: 0,
      convergenceExposureMyr: continental ? inheritedAccretion * 32 : 0,
    };
  });
}

function relaxInterior(cells: MutableCell[], timestepMyr: number): void {
  const reliefDecay = Math.exp(-timestepMyr / 95);
  for (const cell of cells) {
    cell.crustAgeMyr += timestepMyr;
    cell.tectonicReliefKm *= reliefDecay;
    if (cell.crustType === "oceanic") {
      cell.crustThicknessKm += (7 - cell.crustThicknessKm) * Math.min(1, timestepMyr / 25);
      cell.densityKgM3 += (3_060 - cell.densityKgM3) * Math.min(1, timestepMyr / 180);
    } else {
      cell.crustThicknessKm += (36 - cell.crustThicknessKm) * Math.min(1, timestepMyr / 450);
      cell.densityKgM3 += (2_750 - cell.densityKgM3) * Math.min(1, timestepMyr / 900);
    }
  }
}

function applyDivergence(
  cell: MutableCell,
  pairId: number,
  timestepMyr: number,
  speed: number,
  fractionalRifting = false,
  breakupSupport = 1,
): void {
  const intensity = Math.min(1, Math.abs(speed) / 70);
  const ageWeakness = cell.crustType === "oceanic"
    ? 1
    : cell.crustAgeMyr > 1_650 ? 0.22 : cell.crustAgeMyr > 1_050 ? 0.46 : 0.76;
  const lithosphereWeakness = Math.max(
    ageWeakness,
    cell.crustType === "continental" ? 0.18 + cell.riftWeakness * 0.58 : 1,
  );
  const boundedBreakupSupport = Math.max(0, Math.min(1, breakupSupport));
  cell.riftExposureMyr += timestepMyr * intensity * lithosphereWeakness
    * (0.55 + boundedBreakupSupport * 0.45);
  const unmodifiedBreakupExposureMyr = cell.crustAgeMyr > 1_650
    ? 96
    : cell.crustAgeMyr > 1_050
      ? 72
      : 56;
  const breakupExposureMyr = unmodifiedBreakupExposureMyr * (1 - cell.riftWeakness * 0.24);
  const canBreakUp = boundedBreakupSupport >= 0.38
    && cell.riftExposureMyr >= breakupExposureMyr;
  if (fractionalRifting && cell.continentalFraction > 0) {
    if (!canBreakUp) {
      // Immature or landlocked extension remains a failed rift: it may thin
      // crust and form basins, but cannot draw a cell-scale inland ocean merely
      // because a plate boundary happens to cross a continent.
      cell.crustThicknessKm = Math.max(24, cell.crustThicknessKm - intensity * 0.38 * timestepMyr);
      cell.tectonicReliefKm = Math.max(-0.82, cell.tectonicReliefKm - intensity * 0.038 * timestepMyr);
      return;
    }
    cell.continentalFraction = Math.max(
      0,
      cell.continentalFraction - timestepMyr * intensity * boundedBreakupSupport / 85,
    );
    if (cell.continentalFraction > 0) {
      cell.crustType = cell.continentalFraction >= 0.5 ? "continental" : "oceanic";
      cell.crustThicknessKm = Math.max(
        cell.crustType === "continental" ? 20 : 7,
        cell.crustThicknessKm - intensity * 0.32 * timestepMyr,
      );
      cell.tectonicReliefKm = Math.max(-1.25, cell.tectonicReliefKm - intensity * 0.04 * timestepMyr);
      if (cell.crustType === "oceanic") {
        cell.crustAgeMyr = Math.min(cell.crustAgeMyr, 8);
        cell.densityKgM3 += (2_930 - cell.densityKgM3) * 0.2;
        cell.provenanceId = pairId;
      }
      return;
    }
  }
  if (cell.crustType === "continental" && !canBreakUp) {
    cell.crustThicknessKm = Math.max(24, cell.crustThicknessKm - intensity * 0.38 * timestepMyr);
    cell.tectonicReliefKm = Math.max(-0.82, cell.tectonicReliefKm - intensity * 0.038 * timestepMyr);
    return;
  }
  cell.crustType = "oceanic";
  cell.continentalFraction = 0;
  cell.crustAgeMyr = 0;
  cell.crustThicknessKm = 6.2 + intensity * 1.1;
  cell.densityKgM3 = 2_930;
  cell.provenanceId = pairId;
  cell.tectonicReliefKm = 0.5 + intensity * 0.8;
}

function applyConvergenceToCell(
  cell: MutableCell,
  neighbor: MutableCell,
  timestepMyr: number,
  speed: number,
): void {
  const intensity = Math.min(1.4, Math.abs(speed) / 55);
  const factor = Math.min(1, timestepMyr / 2);
  cell.convergenceExposureMyr += timestepMyr * intensity;
  if (cell.crustType === "continental") {
    const collision = neighbor.crustType === "continental";
    cell.crustThicknessKm = Math.min(collision ? 72 : 61, cell.crustThicknessKm + intensity * (collision ? 0.32 : 0.24) * factor);
    cell.tectonicReliefKm = Math.min(collision ? 7.5 : 6.5, cell.tectonicReliefKm + intensity * (collision ? 0.16 : 0.2) * factor);
    cell.densityKgM3 = Math.max(2_690, cell.densityKgM3 - intensity * 0.6);
  } else if (neighbor.crustType === "continental") {
    cell.tectonicReliefKm -= intensity * 0.13 * factor;
    cell.crustAgeMyr = Math.max(cell.crustAgeMyr, 25);
  } else if (cell.crustAgeMyr <= neighbor.crustAgeMyr) {
    cell.crustThicknessKm = Math.min(20, cell.crustThicknessKm + intensity * 0.22 * factor);
    cell.tectonicReliefKm = Math.min(4, cell.tectonicReliefKm + intensity * 0.14 * factor);
    if (cell.convergenceExposureMyr > 42 && cell.crustThicknessKm > 13.5) {
      cell.crustType = "continental";
      cell.continentalFraction = 1;
      cell.crustThicknessKm = Math.max(24, cell.crustThicknessKm);
      cell.densityKgM3 = 2_820;
      cell.provenanceId += 1_000_000;
    }
  } else {
    cell.tectonicReliefKm -= intensity * 0.15 * factor;
  }
}

function applyTransform(cell: MutableCell, timestepMyr: number, speed: number): void {
  const relief = Math.min(0.035, Math.abs(speed) / 2_500) * Math.min(1, timestepMyr / 2);
  cell.roughnessKm = Math.max(-0.7, Math.min(0.7, cell.roughnessKm + Math.sign(speed) * relief));
}

function applyFiniteWidthDeformation(
  cells: MutableCell[],
  adjacency: readonly number[][],
  divergentFaces: ReadonlySet<number>,
  convergentFaces: ReadonlySet<number>,
  timestepMyr: number,
): void {
  const spread = (
    sources: ReadonlySet<number>,
    visit: (cell: MutableCell, strength: number) => void,
  ): void => {
    let frontier = new Set(sources);
    const visited = new Set(sources);
    for (let ring = 1; ring <= 2; ring += 1) {
      const next = new Set<number>();
      for (const faceId of frontier) {
        for (const neighbor of adjacency[faceId]) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.add(neighbor);
          visit(cells[neighbor], ring === 1 ? 0.42 : 0.16);
        }
      }
      frontier = next;
    }
  };
  spread(divergentFaces, (cell, strength) => {
    if (cell.crustType === "continental") {
      cell.crustThicknessKm = Math.max(27, cell.crustThicknessKm - strength * 0.018 * timestepMyr);
      cell.tectonicReliefKm = Math.max(-0.7, cell.tectonicReliefKm - strength * 0.008 * timestepMyr);
    }
  });
  spread(convergentFaces, (cell, strength) => {
    if (cell.crustType === "continental") {
      cell.crustThicknessKm = Math.min(56, cell.crustThicknessKm + strength * 0.012 * timestepMyr);
      cell.tectonicReliefKm = Math.min(4.2, cell.tectonicReliefKm + strength * 0.009 * timestepMyr);
    } else {
      cell.tectonicReliefKm = Math.min(1.8, cell.tectonicReliefKm + strength * 0.004 * timestepMyr);
    }
  });
}

/**
 * Estimates whether a divergent boundary is a coherent breakup corridor or a
 * failed intracontinental rift. Persistence and opening speed are necessary,
 * but mature breakup is much easier where a connected segment reaches
 * existing oceanic crust. Long landlocked systems can still succeed after
 * inheriting substantial extensional damage; short isolated grooves cannot.
 */
function riftBreakupSupport(
  cells: readonly MutableCell[],
  adjacency: readonly number[][],
  divergentSpeed: Float64Array,
  divergentAgeMyr: Float64Array,
): Float64Array {
  const support = new Float64Array(cells.length);
  const visited = new Uint8Array(cells.length);
  for (let start = 0; start < cells.length; start += 1) {
    if (visited[start] !== 0 || divergentSpeed[start] <= 0) continue;
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    let touchesOceanicCrust = false;
    let meanSpeed = 0;
    let meanAgeMyr = 0;
    let meanInheritedExposureMyr = 0;
    let meanInheritedWeakness = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const faceId = queue[cursor];
      component.push(faceId);
      meanSpeed += divergentSpeed[faceId];
      meanAgeMyr += divergentAgeMyr[faceId];
      meanInheritedExposureMyr += cells[faceId].riftExposureMyr;
      meanInheritedWeakness += cells[faceId].riftWeakness;
      if (cells[faceId].continentalFraction < 0.35
        || adjacency[faceId].some((neighbor) => cells[neighbor].continentalFraction < 0.2)) {
        touchesOceanicCrust = true;
      }
      for (const neighbor of adjacency[faceId]) {
        if (visited[neighbor] !== 0 || divergentSpeed[neighbor] <= 0) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    meanSpeed /= component.length;
    meanAgeMyr /= component.length;
    meanInheritedExposureMyr /= component.length;
    meanInheritedWeakness /= component.length;
    const persistence = Math.max(0, Math.min(1, (meanAgeMyr - 16) / 54));
    const velocity = Math.max(0, Math.min(1, (meanSpeed - 5) / 34));
    const continuity = Math.max(0, Math.min(1, (component.length - 2) / 10));
    const inheritedDamage = Math.max(0, Math.min(
      1,
      meanInheritedExposureMyr / 90 + meanInheritedWeakness * 0.72,
    ));
    const oceanConnection = touchesOceanicCrust
      ? 0.72 + continuity * 0.28
      : continuity * inheritedDamage * 0.56;
    const componentSupport = Math.max(0, Math.min(
      1,
      persistence * velocity * oceanConnection,
    ));
    for (const faceId of component) support[faceId] = componentSupport;
  }
  return support;
}

function baseElevation(cell: MutableCell): number {
  if (cell.crustType === "continental") {
    const root = (cell.crustThicknessKm - 35) * 0.105;
    const buoyancy = (2_780 - cell.densityKgM3) * 0.003;
    return 0.42 + root + buoyancy + cell.tectonicReliefKm + cell.roughnessKm;
  }
  const age = Math.min(180, cell.crustAgeMyr);
  const cooling = 0.34 * Math.sqrt(age);
  const plateau = Math.max(0, cell.crustThicknessKm - 7) * 0.22;
  return -2.45 - cooling + plateau + cell.tectonicReliefKm + cell.roughnessKm;
}

function physicalShorelineNoise(point: Vec3, seed: number, radiusKm: number): number {
  const [x, y, z] = point;
  const physicalScale = Math.max(0.2, Math.min(7.85, radiusKm / 6_371));
  return (
    Math.sin((x * 5.31 + y * 2.17 - z * 3.73) * physicalScale + seed * 0.011) * 0.42
    + Math.sin((x * 11.7 - y * 7.13 + z * 4.91) * physicalScale + seed * 0.027) * 0.29
    + Math.cos((x * 23.1 + y * 17.3 - z * 13.1) * physicalScale + seed * 0.043) * 0.19
    + Math.sin((x * 41.3 - y * 31.7 + z * 29.9) * physicalScale + seed * 0.071) * 0.1
  );
}

/**
 * Adds tectonically inherited, intermediate-scale shoreline structure before
 * the target ocean quantile is solved. Only the first few cells beside the
 * preliminary coast participate, so this can form broad bays, capes, and rift
 * reentrants without punching arbitrary inland seas through a continent.
 */
function shapeCanonicalShoreline(
  structuralElevations: readonly number[],
  cells: readonly MutableCell[],
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
  recipe: TectonicWorldRecipe,
): number[] {
  const preliminarySeaLevelKm = areaWeightedQuantile(
    structuralElevations,
    sphere,
    recipe.oceanFraction,
  );
  const preliminaryLand = Uint8Array.from(
    structuralElevations,
    (elevationKm) => elevationKm >= preliminarySeaLevelKm ? 1 : 0,
  );
  const coastRings = new Int8Array(cells.length).fill(-1);
  const queue: number[] = [];
  for (const face of sphere.faces) {
    if (!adjacency[face.id].some((neighborId) => (
      preliminaryLand[neighborId] !== preliminaryLand[face.id]
    ))) continue;
    coastRings[face.id] = 0;
    queue.push(face.id);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const faceId = queue[cursor];
    const nextRing = coastRings[faceId] + 1;
    if (nextRing > 4) continue;
    for (const neighborId of adjacency[faceId]) {
      if (coastRings[neighborId] >= 0
        || preliminaryLand[neighborId] !== preliminaryLand[faceId]) continue;
      coastRings[neighborId] = nextRing;
      queue.push(neighborId);
    }
  }

  const seed = seedHashNumber(`${recipe.seed}:canonical-shoreline`);
  // At subdivision 3 an 800 km cape is only a couple of control cells wide;
  // applying the full spectrum there creates one-cell necks rather than
  // resolved morphology. Ramp to full strength at subdivision 4, the current
  // production tectonic tier.
  const resolutionSupport = Math.max(0, Math.min(1, sphere.subdivisions - 3));
  return structuralElevations.map((elevationKm, faceId) => {
    const ring = coastRings[faceId];
    if (ring < 0 || ring > 4) return elevationKm;
    const cell = cells[faceId];
    const continentalSupport = Math.max(0, Math.min(1, cell.continentalFraction));
    if (continentalSupport < 0.08) return elevationKm;
    const distanceFade = (1 - ring / 5) ** 1.35;
    const seaLevelDistanceKm = Math.abs(elevationKm - preliminarySeaLevelKm);
    const verticalSupport = Math.exp(-((seaLevelDistanceKm / 1.15) ** 2));
    const point = sphere.faces[faceId].center;
    const broad = physicalShorelineNoise(point, seed, recipe.radiusKm);
    const detail = physicalShorelineNoise(point, seed + 91_127, recipe.radiusKm);
    const rift = Math.max(0, Math.min(
      1,
      cell.riftExposureMyr / 115 + cell.riftWeakness * 0.32,
    ));
    const collision = Math.max(0, Math.min(1, cell.convergenceExposureMyr / 190));
    const riftEmbayment = rift * (0.08 + Math.max(0, -detail) * 0.13);
    const collisionalPromontory = collision * Math.max(0, broad) * 0.08;
    const morphologyKm = (
      broad * 0.34
      + detail * 0.13
      - riftEmbayment
      + collisionalPromontory
    ) * distanceFade * verticalSupport * (0.55 + continentalSupport * 0.45);
    return elevationKm + morphologyKm * resolutionSupport;
  });
}

function areaWeightedQuantile(
  values: readonly number[],
  sphere: GeodesicSphere,
  fractionBelow: number,
): number {
  const entries = sphere.faces.map((face) => ({ value: values[face.id], area: face.areaSteradians }));
  entries.sort((a, b) => a.value - b.value);
  const target = sphere.totalAreaSteradians * fractionBelow;
  let accumulated = 0;
  for (const entry of entries) {
    accumulated += entry.area;
    if (accumulated >= target) return entry.value;
  }
  return entries.at(-1)?.value ?? 0;
}

function resolveSubgridBasins(
  rawElevations: readonly number[],
  seaLevelKm: number,
  sphere: GeodesicSphere,
  adjacency: readonly number[][],
): number[] {
  const elevations = [...rawElevations];
  // A tectonic control cell spans tens to hundreds of kilometres. Shallow
  // one-cell channels and pits are below this model's resolved scale and would
  // otherwise become triangular inland holes. Treat their closure as canonical
  // sediment infill, before any renderer sees the model.
  const maximumTotalInfill = sphere.totalAreaSteradians * 0.012;
  let infilledArea = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    const fill: { faceId: number; depthKm: number }[] = [];
    for (const face of sphere.faces) {
      const elevation = elevations[face.id];
      if (elevation >= seaLevelKm || seaLevelKm - elevation > 0.55) continue;
      const landNeighbors = adjacency[face.id].filter((neighbor) => elevations[neighbor] >= seaLevelKm).length;
      if (landNeighbors >= 2) fill.push({ faceId: face.id, depthKm: seaLevelKm - elevation });
    }
    fill.sort((a, b) => a.depthKm - b.depthKm || a.faceId - b.faceId);
    for (const { faceId } of fill) {
      const area = sphere.faces[faceId].areaSteradians;
      if (infilledArea + area > maximumTotalInfill) break;
      elevations[faceId] = seaLevelKm + 0.008;
      infilledArea += area;
    }
  }

  const seen = new Set<number>();
  const waterComponents: { ids: number[]; area: number; deepestKm: number }[] = [];
  for (const face of sphere.faces) {
    if (seen.has(face.id) || elevations[face.id] >= seaLevelKm) continue;
    const ids: number[] = [];
    const queue = [face.id];
    let area = 0;
    let deepestKm = 0;
    seen.add(face.id);
    while (queue.length > 0) {
      const faceId = queue.pop() as number;
      ids.push(faceId);
      area += sphere.faces[faceId].areaSteradians;
      deepestKm = Math.max(deepestKm, seaLevelKm - elevations[faceId]);
      for (const neighbor of adjacency[faceId]) {
        if (!seen.has(neighbor) && elevations[neighbor] < seaLevelKm) {
          seen.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    waterComponents.push({ ids, area, deepestKm });
  }
  const primaryOcean = waterComponents.reduce(
    (largest, component) => component.area > largest.area ? component : largest,
    { ids: [] as number[], area: -1, deepestKm: 0 },
  );
  const maximumInfillArea = sphere.totalAreaSteradians * 0.00075;
  for (const component of waterComponents) {
    if (component === primaryOcean || component.area > maximumInfillArea || component.deepestKm > 0.9) continue;
    if (infilledArea + component.area > maximumTotalInfill) break;
    for (const faceId of component.ids) elevations[faceId] = seaLevelKm + 0.008;
    infilledArea += component.area;
  }
  return elevations;
}

function calculateAreaBudget(
  sphere: GeodesicSphere,
  cells: readonly WorldCellState[],
): TectonicAreaBudget {
  let continental = 0;
  let oceanic = 0;
  let land = 0;
  for (const face of sphere.faces) {
    const cell = cells[face.id];
    const continentalFraction = cell.continentalFraction
      ?? (cell.crustType === "continental" ? 1 : 0);
    continental += face.areaSteradians * continentalFraction;
    oceanic += face.areaSteradians * (1 - continentalFraction);
    if (cell.isLand) land += face.areaSteradians;
  }
  const covered = continental + oceanic;
  const ocean = sphere.totalAreaSteradians - land;
  return {
    sphereSteradians: sphere.totalAreaSteradians,
    coveredSteradians: covered,
    continentalSteradians: continental,
    oceanicSteradians: oceanic,
    landSteradians: land,
    oceanSteradians: ocean,
    coverageResidualSteradians: sphere.totalAreaSteradians - covered,
    crustResidualSteradians: covered - continental - oceanic,
  };
}

function countContinentalTerranes(
  sphere: GeodesicSphere,
  cells: readonly WorldCellState[],
): number {
  const areas = new Map<number, number>();
  for (const face of sphere.faces) {
    const cell = cells[face.id];
    const continentalFraction = cell.continentalFraction
      ?? (cell.crustType === "continental" ? 1 : 0);
    if (continentalFraction < 0.5) continue;
    areas.set(
      cell.provenanceId,
      (areas.get(cell.provenanceId) ?? 0) + face.areaSteradians * continentalFraction,
    );
  }
  const minimumArea = sphere.totalAreaSteradians * 0.0005;
  return [...areas.values()].filter((area) => area >= minimumArea).length;
}

function applyTectonicStep(
  cells: MutableCell[],
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  recipe: TectonicWorldRecipe,
  adjacency: readonly number[][],
  boundaryAges: Map<number, MutableBoundaryAge>,
  timestepMyr: number,
  fractionalRifting = false,
): { divergentFaces: ReadonlySet<number>; convergentFaces: ReadonlySet<number> } {
  relaxInterior(cells, timestepMyr);
  const divergentFaces = new Set<number>();
  const convergentFaces = new Set<number>();
  const divergentSpeed = new Float64Array(cells.length);
  const divergentAgeMyr = new Float64Array(cells.length);
  const divergentPair = new Int32Array(cells.length);
  const convergentSpeed = new Float64Array(cells.length);
  const convergentNeighbor = new Int32Array(cells.length).fill(-1);
  const transformSpeed = new Float64Array(cells.length);
  for (const edge of sphere.edges) {
    const first = cells[edge.faces[0]];
    const second = cells[edge.faces[1]];
    if (first.plateId === second.plateId) {
      boundaryAges.delete(edge.id);
      continue;
    }
    const geometry = boundaryGeometryFromEdge(sphere, edge.id, edge.faces[0]);
    const motion = classifyBoundaryKinematics(
      geometry,
      plates[first.plateId].pole,
      plates[second.plateId].pole,
      recipe.radiusKm,
      {
        normalEnterKmPerMyr: 4,
        normalExitKmPerMyr: 2,
        transformEnterKmPerMyr: 4,
        transformExitKmPerMyr: 2,
      },
    );
    const previous = boundaryAges.get(edge.id);
    const boundaryAgeMyr = previous?.kind === motion.kind ? previous.ageMyr + timestepMyr : timestepMyr;
    boundaryAges.set(edge.id, {
      kind: motion.kind,
      ageMyr: boundaryAgeMyr,
    });
    const pairId = 100_000
      + Math.min(first.plateId, second.plateId) * recipe.plateCount
      + Math.max(first.plateId, second.plateId);
    if (motion.kind === "divergent") {
      for (const faceId of edge.faces) {
        const speed = Math.abs(motion.normalKmPerMyr);
        if (speed > divergentSpeed[faceId]) {
          divergentSpeed[faceId] = speed;
          divergentPair[faceId] = pairId;
        }
        divergentAgeMyr[faceId] = Math.max(divergentAgeMyr[faceId], boundaryAgeMyr);
      }
    } else if (motion.kind === "convergent") {
      for (const [faceId, neighborId] of [
        [edge.faces[0], edge.faces[1]],
        [edge.faces[1], edge.faces[0]],
      ] as const) {
        const speed = Math.abs(motion.normalKmPerMyr);
        if (speed > convergentSpeed[faceId]) {
          convergentSpeed[faceId] = speed;
          convergentNeighbor[faceId] = neighborId;
        }
      }
    } else if (motion.kind === "transform") {
      for (const faceId of edge.faces) {
        if (Math.abs(motion.tangentialKmPerMyr) > Math.abs(transformSpeed[faceId])) {
          transformSpeed[faceId] = motion.tangentialKmPerMyr;
        }
      }
    }
  }
  const breakupSupport = riftBreakupSupport(cells, adjacency, divergentSpeed, divergentAgeMyr);
  for (const face of sphere.faces) {
    const faceId = face.id;
    if (divergentSpeed[faceId] >= convergentSpeed[faceId] && divergentSpeed[faceId] > 0) {
      applyDivergence(
        cells[faceId],
        divergentPair[faceId],
        timestepMyr,
        divergentSpeed[faceId],
        fractionalRifting,
        breakupSupport[faceId],
      );
      divergentFaces.add(faceId);
    } else if (convergentSpeed[faceId] > 0) {
      const neighborId = convergentNeighbor[faceId];
      applyConvergenceToCell(cells[faceId], cells[neighborId], timestepMyr, convergentSpeed[faceId]);
      convergentFaces.add(faceId);
    } else if (transformSpeed[faceId] !== 0) {
      applyTransform(cells[faceId], timestepMyr, transformSpeed[faceId]);
    }
  }
  applyFiniteWidthDeformation(cells, adjacency, divergentFaces, convergentFaces, timestepMyr);
  return { divergentFaces, convergentFaces };
}

interface FiniteVolumeStepDiagnostics {
  readonly createdAreaSteradians: number;
  readonly destroyedAreaSteradians: number;
  readonly maximumCourantNumber: number;
  readonly meanTransportDistanceRadians: number;
  readonly maximumTransportDistanceRadians: number;
}

/**
 * First-order conservative finite-volume advection on the spherical mesh.
 * Every transfer crosses one real geodesic edge. Local underfill is accreted
 * from the already-evolved source material (young oceanic crust at ridges),
 * while local overfill is proportionally subducted. The paired creation and
 * destruction budgets expose this tectonic source/sink instead of hiding it in
 * a global residual assignment.
 */
function transportCellsFiniteVolume(
  cells: readonly MutableCell[],
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  radiusKm: number,
  timestepMyr: number,
  newOceanicFaces: ReadonlySet<number>,
): { cells: MutableCell[]; diagnostics: FiniteVolumeStepDiagnostics } {
  const transfers = sphere.faces.map(() => [] as { sourceId: number; area: number }[]);
  const outgoing = new Float64Array(cells.length);
  const proposed: { sourceId: number; targetId: number; area: number; distance: number }[] = [];
  for (const edge of sphere.edges) {
    const [firstId, secondId] = edge.faces;
    const firstVelocity = surfaceVelocityKmPerMyr(
      plates[cells[firstId].plateId].pole,
      edge.midpoint,
      radiusKm,
    );
    const secondVelocity = surfaceVelocityKmPerMyr(
      plates[cells[secondId].plateId].pole,
      edge.midpoint,
      radiusKm,
    );
    const direction = normalize3(subtract3(sphere.faces[secondId].center, sphere.faces[firstId].center));
    const interfaceNormalSpeed = (
      dot3(firstVelocity, direction) + dot3(secondVelocity, direction)
    ) * 0.5;
    const signedArea = interfaceNormalSpeed / radiusKm * edge.arcLengthRadians * timestepMyr;
    if (Math.abs(signedArea) < 1e-15) continue;
    const sourceId = signedArea > 0 ? firstId : secondId;
    const targetId = signedArea > 0 ? secondId : firstId;
    const area = Math.abs(signedArea);
    proposed.push({
      sourceId,
      targetId,
      area,
      distance: angleBetweenUnitVectors(sphere.faces[sourceId].center, sphere.faces[targetId].center),
    });
    outgoing[sourceId] += area;
  }

  const sourceScale = Float64Array.from(sphere.faces, (face) => {
    const maximumOutflow = face.areaSteradians * 0.45;
    return outgoing[face.id] > maximumOutflow ? maximumOutflow / outgoing[face.id] : 1;
  });
  const actualOutgoing = new Float64Array(cells.length);
  let transportedArea = 0;
  let weightedDistance = 0;
  let maximumTransportDistanceRadians = 0;
  let maximumCourantNumber = 0;
  for (const transfer of proposed) {
    const area = transfer.area * sourceScale[transfer.sourceId];
    if (!(area > 0)) continue;
    transfers[transfer.targetId].push({ sourceId: transfer.sourceId, area });
    actualOutgoing[transfer.sourceId] += area;
    transportedArea += area;
    weightedDistance += area * transfer.distance;
    maximumTransportDistanceRadians = Math.max(maximumTransportDistanceRadians, transfer.distance);
  }
  for (const face of sphere.faces) {
    maximumCourantNumber = Math.max(
      maximumCourantNumber,
      actualOutgoing[face.id] / face.areaSteradians,
    );
  }

  let createdAreaSteradians = 0;
  let destroyedAreaSteradians = 0;
  const next = sphere.faces.map((face): MutableCell => {
    const ownRetained = Math.max(0, face.areaSteradians - actualOutgoing[face.id]);
    const contributions = [{ sourceId: face.id, area: ownRetained }, ...transfers[face.id]]
      .filter((entry) => entry.area > 0);
    let occupied = contributions.reduce((sum, entry) => sum + entry.area, 0);
    const originalOccupied = occupied;
    let createdHere = 0;
    if (occupied < face.areaSteradians) {
      const deficit = face.areaSteradians - occupied;
      contributions.push({ sourceId: face.id, area: deficit });
      createdAreaSteradians += deficit;
      createdHere = deficit;
      occupied = face.areaSteradians;
    } else if (occupied > face.areaSteradians) {
      destroyedAreaSteradians += occupied - face.areaSteradians;
    }
    const normalization = face.areaSteradians / occupied;
    let continentalFraction = 0;
    let crustAgeMyr = 0;
    let crustThicknessKm = 0;
    let densityKgM3 = 0;
    let tectonicReliefKm = 0;
    let roughnessKm = 0;
    let riftWeakness = 0;
    let riftExposureMyr = 0;
    let convergenceExposureMyr = 0;
    const plateFractions = plates.map(() => 0);
    const provenanceArea = new Map<number, number>();
    for (const contribution of contributions) {
      const source = cells[contribution.sourceId];
      const weight = contribution.area * normalization / face.areaSteradians;
      continentalFraction += source.continentalFraction * weight;
      crustAgeMyr += source.crustAgeMyr * weight;
      crustThicknessKm += source.crustThicknessKm * weight;
      densityKgM3 += source.densityKgM3 * weight;
      tectonicReliefKm += source.tectonicReliefKm * weight;
      roughnessKm += source.roughnessKm * weight;
      riftWeakness += source.riftWeakness * weight;
      riftExposureMyr += source.riftExposureMyr * weight;
      convergenceExposureMyr += source.convergenceExposureMyr * weight;
      const materialArea = contribution.area * normalization;
      for (let plateId = 0; plateId < plateFractions.length; plateId += 1) {
        plateFractions[plateId] += source.plateFractions[plateId] * materialArea / face.areaSteradians;
      }
      provenanceArea.set(
        source.provenanceId,
        (provenanceArea.get(source.provenanceId) ?? 0) + materialArea,
      );
    }
    if (createdHere > 0
      && newOceanicFaces.has(face.id)
      && cells[face.id].riftExposureMyr >= 150
      && cells[face.id].continentalFraction < 0.5) {
      const source = cells[face.id];
      const weight = createdHere / face.areaSteradians;
      continentalFraction = Math.max(0, continentalFraction - source.continentalFraction * weight);
      crustAgeMyr = Math.max(0, crustAgeMyr - source.crustAgeMyr * weight);
      crustThicknessKm += (7 - source.crustThicknessKm) * weight;
      densityKgM3 += (2_930 - source.densityKgM3) * weight;
      tectonicReliefKm += (0.65 - source.tectonicReliefKm) * weight;
    }
    if (originalOccupied > face.areaSteradians) {
      const rawContinentalArea = contributions.reduce(
        (sum, contribution) => sum
          + contribution.area * cells[contribution.sourceId].continentalFraction,
        0,
      );
      const rawOceanicArea = originalOccupied - rawContinentalArea;
      const excess = originalOccupied - face.areaSteradians;
      // Dense oceanic lithosphere subducts before buoyant continental crust.
      // Continental loss begins only when an overlap contains insufficient
      // oceanic material to close the local control-volume budget.
      const subductedOceanicArea = Math.min(excess, rawOceanicArea);
      const retainedContinentalArea = rawContinentalArea;
      continentalFraction = Math.min(1, retainedContinentalArea / face.areaSteradians);
      // Any convergence left after oceanic subduction represents shortening
      // and thickening of buoyant continental crust, not its disappearance.
      if (excess > subductedOceanicArea) {
        crustThicknessKm += (excess - subductedOceanicArea) / face.areaSteradians * 3.5;
      }
    }
    const dominant = (areas: ReadonlyMap<number, number>): number => [...areas.entries()]
      .sort((first, second) => second[1] - first[1] || first[0] - second[0])[0][0];
    const boundedContinentalFraction = Math.max(0, Math.min(1, continentalFraction));
    return {
      plateId: plateFractions.reduce(
        (best, fraction, plateId) => fraction > plateFractions[best] ? plateId : best,
        0,
      ),
      plateFractions,
      crustType: boundedContinentalFraction >= 0.5 ? "continental" : "oceanic",
      continentalFraction: boundedContinentalFraction,
      crustAgeMyr,
      crustThicknessKm,
      densityKgM3,
      provenanceId: dominant(provenanceArea),
      tectonicReliefKm,
      roughnessKm,
      riftWeakness,
      riftExposureMyr,
      convergenceExposureMyr,
    };
  });

  // A first-order upwind scheme is deliberately robust but diffuses material
  // interfaces over long histories. Apply a bounded VOF-style compression and
  // solve one scalar offset so the exact area-weighted continental inventory
  // is unchanged by sharpening.
  const targetContinentalArea = sphere.faces.reduce(
    (sum, face) => sum + next[face.id].continentalFraction * face.areaSteradians,
    0,
  );
  const exponent = 1 + 0.04 * timestepMyr / 2;
  const sharpened = next.map((cell) => {
    const continental = cell.continentalFraction;
    const continentalPower = continental ** exponent;
    const oceanicPower = (1 - continental) ** exponent;
    return continentalPower + oceanicPower > 0
      ? continentalPower / (continentalPower + oceanicPower)
      : continental;
  });
  let lowerOffset = -1;
  let upperOffset = 1;
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const offset = (lowerOffset + upperOffset) * 0.5;
    const area = sphere.faces.reduce(
      (sum, face) => sum
        + Math.max(0, Math.min(1, sharpened[face.id] + offset)) * face.areaSteradians,
      0,
    );
    if (area < targetContinentalArea) lowerOffset = offset;
    else upperOffset = offset;
  }
  const continentalOffset = (lowerOffset + upperOffset) * 0.5;
  for (const face of sphere.faces) {
    const cell = next[face.id];
    cell.continentalFraction = Math.max(
      0,
      Math.min(1, sharpened[face.id] + continentalOffset),
    );
    cell.crustType = cell.continentalFraction >= 0.5 ? "continental" : "oceanic";
    const compressedPlateFractions = cell.plateFractions.map((fraction) => fraction ** exponent);
    const plateTotal = compressedPlateFractions.reduce((sum, fraction) => sum + fraction, 0);
    cell.plateFractions = compressedPlateFractions.map((fraction) => fraction / plateTotal);
    cell.plateId = cell.plateFractions.reduce(
      (best, fraction, plateId) => fraction > cell.plateFractions[best] ? plateId : best,
      0,
    );
  }
  return {
    cells: next,
    diagnostics: {
      createdAreaSteradians,
      destroyedAreaSteradians,
      maximumCourantNumber,
      meanTransportDistanceRadians: transportedArea > 0 ? weightedDistance / transportedArea : 0,
      maximumTransportDistanceRadians,
    },
  };
}

/**
 * Evolves a deterministic, whole-sphere reduced tectonic history.
 *
 * This first production milestone deliberately uses fixed geodesic control
 * volumes. Plate topology stays fixed while exact Euler velocities drive
 * finite-width boundary processes on persistent crust state. A later Lagrangian
 * parcel layer can replace this transport approximation without changing the
 * returned canonical model.
 */
export function simulateTectonicWorld(
  overrides: Partial<TectonicWorldRecipe> = {},
): TectonicWorldModel {
  const recipe: TectonicWorldRecipe = { ...DEFAULT_RECIPE, ...overrides };
  validateRecipe(recipe);
  const random = createRandom(recipe.seed);
  const sphere = createGeodesicSphere(recipe.subdivisions);
  const plateSeeds = createPlateSeeds(random, recipe.plateCount);
  const angularSpeedScale = 6_371 / recipe.radiusKm;
  const plates: TectonicPlateState[] = plateSeeds.map((initialSeed, id) => ({
    id,
    name: `Plate ${id + 1}`,
    initialSeed,
    seed: initialSeed,
    pole: {
      axis: randomUnitVector(random),
      angularSpeedRadPerMyr: random.range(0.0028, 0.0085) * angularSpeedScale
        * (random.next() < 0.5 ? -1 : 1),
    },
    buoyancyBias: random.range(-1, 1),
  }));
  const cells = createInitialCells(
    sphere,
    plates,
    random,
    recipe.seed,
    recipe.radiusKm,
  );
  const adjacency = buildAdjacency(sphere);
  const boundaryAges = new Map<number, MutableBoundaryAge>();
  const steps = Math.ceil(recipe.historyMyr / recipe.timestepMyr);
  let elapsedMyr = 0;

  for (let step = 0; step < steps; step += 1) {
    const timestepMyr = Math.min(recipe.timestepMyr, recipe.historyMyr - elapsedMyr);
    if (timestepMyr <= 0) break;
    relaxInterior(cells, timestepMyr);
    const divergentFaces = new Set<number>();
    const convergentFaces = new Set<number>();
    const divergentSpeed = new Float64Array(cells.length);
    const divergentAgeMyr = new Float64Array(cells.length);
    const divergentPair = new Int32Array(cells.length);
    const convergentSpeed = new Float64Array(cells.length);
    const convergentNeighbor = new Int32Array(cells.length).fill(-1);
    const transformSpeed = new Float64Array(cells.length);
    for (const edge of sphere.edges) {
      const first = cells[edge.faces[0]];
      const second = cells[edge.faces[1]];
      if (first.plateId === second.plateId) {
        boundaryAges.delete(edge.id);
        continue;
      }
      const geometry = boundaryGeometryFromEdge(sphere, edge.id, edge.faces[0]);
      const motion = classifyBoundaryKinematics(
        geometry,
        plates[first.plateId].pole,
        plates[second.plateId].pole,
        recipe.radiusKm,
        {
          normalEnterKmPerMyr: 4,
          normalExitKmPerMyr: 2,
          transformEnterKmPerMyr: 4,
          transformExitKmPerMyr: 2,
        },
      );
      const previous = boundaryAges.get(edge.id);
      const boundaryAgeMyr = previous?.kind === motion.kind ? previous.ageMyr + timestepMyr : timestepMyr;
      boundaryAges.set(edge.id, {
        kind: motion.kind,
        ageMyr: boundaryAgeMyr,
      });
      const pairId = 100_000 + Math.min(first.plateId, second.plateId) * recipe.plateCount + Math.max(first.plateId, second.plateId);
      if (motion.kind === "divergent") {
        for (const faceId of edge.faces) {
          const speed = Math.abs(motion.normalKmPerMyr);
          if (speed > divergentSpeed[faceId]) {
            divergentSpeed[faceId] = speed;
            divergentPair[faceId] = pairId;
          }
          divergentAgeMyr[faceId] = Math.max(divergentAgeMyr[faceId], boundaryAgeMyr);
        }
      } else if (motion.kind === "convergent") {
        for (const [faceId, neighborId] of [[edge.faces[0], edge.faces[1]], [edge.faces[1], edge.faces[0]]] as const) {
          const speed = Math.abs(motion.normalKmPerMyr);
          if (speed > convergentSpeed[faceId]) {
            convergentSpeed[faceId] = speed;
            convergentNeighbor[faceId] = neighborId;
          }
        }
      } else if (motion.kind === "transform") {
        for (const faceId of edge.faces) {
          if (Math.abs(motion.tangentialKmPerMyr) > Math.abs(transformSpeed[faceId])) {
            transformSpeed[faceId] = motion.tangentialKmPerMyr;
          }
        }
      }
    }
    const breakupSupport = riftBreakupSupport(cells, adjacency, divergentSpeed, divergentAgeMyr);
    for (const face of sphere.faces) {
      const faceId = face.id;
      // One canonical forcing per face and regime per timestep prevents a
      // three-edge triangle from accumulating three million years of strain in
      // one million years. The strongest normal regime wins locally.
      if (divergentSpeed[faceId] >= convergentSpeed[faceId] && divergentSpeed[faceId] > 0) {
        applyDivergence(
          cells[faceId],
          divergentPair[faceId],
          timestepMyr,
          divergentSpeed[faceId],
          false,
          breakupSupport[faceId],
        );
        divergentFaces.add(faceId);
      } else if (convergentSpeed[faceId] > 0) {
        const neighborId = convergentNeighbor[faceId];
        applyConvergenceToCell(cells[faceId], cells[neighborId], timestepMyr, convergentSpeed[faceId]);
        convergentFaces.add(faceId);
      } else if (transformSpeed[faceId] !== 0) {
        applyTransform(cells[faceId], timestepMyr, transformSpeed[faceId]);
      }
    }
    applyFiniteWidthDeformation(cells, adjacency, divergentFaces, convergentFaces, timestepMyr);
    elapsedMyr += timestepMyr;
  }

  const rawElevations = shapeCanonicalShoreline(
    cells.map(baseElevation),
    cells,
    sphere,
    adjacency,
    recipe,
  );
  const seaLevelKm = areaWeightedQuantile(rawElevations, sphere, recipe.oceanFraction);
  const elevations = resolveSubgridBasins(rawElevations, seaLevelKm, sphere, adjacency);
  const finalCells: WorldCellState[] = cells.map((cell, faceId) => {
    const elevationKm = elevations[faceId];
    return {
      faceId,
      plateId: cell.plateId,
      crustType: cell.crustType,
      continentalFraction: cell.continentalFraction,
      crustAgeMyr: cell.crustAgeMyr,
      thermalAgeMyr: cell.crustType === "oceanic" ? cell.crustAgeMyr : Math.max(0, cell.crustAgeMyr - 250),
      riftExposureMyr: cell.riftExposureMyr,
      convergenceExposureMyr: cell.convergenceExposureMyr,
      crustThicknessKm: cell.crustThicknessKm,
      densityKgM3: cell.densityKgM3,
      provenanceId: cell.provenanceId,
      elevationKm,
      waterDepthKm: Math.max(0, seaLevelKm - elevationKm),
      isLand: elevationKm >= seaLevelKm,
    };
  });
  const boundaries: WorldBoundaryState[] = [];
  const counts: Record<BoundaryKind, number> = { divergent: 0, convergent: 0, transform: 0, stable: 0 };
  for (const edge of sphere.edges) {
    const first = finalCells[edge.faces[0]];
    const second = finalCells[edge.faces[1]];
    if (first.plateId === second.plateId) continue;
    const motion = classifyBoundaryKinematics(
      boundaryGeometryFromEdge(sphere, edge.id, edge.faces[0]),
      plates[first.plateId].pole,
      plates[second.plateId].pole,
      recipe.radiusKm,
      {
        normalEnterKmPerMyr: 4,
        normalExitKmPerMyr: 2,
        transformEnterKmPerMyr: 4,
        transformExitKmPerMyr: 2,
      },
    );
    counts[motion.kind] += 1;
    boundaries.push({
      edgeId: edge.id,
      plateAId: first.plateId,
      plateBId: second.plateId,
      kind: motion.kind,
      normalKmPerMyr: motion.normalKmPerMyr,
      tangentialKmPerMyr: motion.tangentialKmPerMyr,
      ageMyr: boundaryAges.get(edge.id)?.ageMyr ?? 0,
    });
  }
  const areaBudget = calculateAreaBudget(sphere, finalCells);
  const weightedElevation = sphere.faces.reduce(
    (sum, face) => sum + finalCells[face.id].elevationKm * face.areaSteradians,
    0,
  ) / sphere.totalAreaSteradians;
  return {
    version: 1,
    transportModel: "fixed-geodesic-control-volume-v1",
    recipe,
    sphere,
    plates,
    cells: finalCells,
    boundaries,
    seaLevelKm,
    elapsedMyr,
    areaBudget,
    stats: {
      landFraction: areaBudget.landSteradians / sphere.totalAreaSteradians,
      continentalCrustFraction: areaBudget.continentalSteradians / sphere.totalAreaSteradians,
      continentalTerraneCount: countContinentalTerranes(sphere, finalCells),
      minElevationKm: Math.min(...elevations),
      maxElevationKm: Math.max(...elevations),
      meanElevationKm: weightedElevation,
      boundaryCounts: counts,
    },
  };
}

/**
 * Produces one moving-crust snapshot from a completed fixed-control-volume
 * history. This is deliberately not a fully coupled tectonic history: boundary
 * processes are evolved by the reference simulation first, then persistent
 * parcels are advected exactly for `advectionMyr` and conservatively remapped.
 * Boundary ages reset because boundary-segment lineage is not transported yet.
 */
export function simulateMovingCrustSnapshot(
  overrides: Partial<TectonicWorldRecipe> = {},
  advectionMyr = overrides.timestepMyr ?? DEFAULT_RECIPE.timestepMyr,
): TectonicWorldModel {
  if (!Number.isFinite(advectionMyr) || Math.abs(advectionMyr) > 500) {
    throw new RangeError("advectionMyr must be finite and no greater than 500 Myr in magnitude");
  }
  const reference = simulateTectonicWorld(overrides);
  const parcels = createCrustParcels(reference.sphere, reference.cells);
  const parcelTransport = transportCrustParcels(
    reference.sphere,
    parcels,
    reference.plates,
    advectionMyr,
  );
  const adjacency = buildAdjacency(reference.sphere);
  const remappedElevations = parcelTransport.faces.map((face) => face.elevationKm);
  const seaLevelKm = areaWeightedQuantile(remappedElevations, reference.sphere, reference.recipe.oceanFraction);
  const elevations = resolveSubgridBasins(remappedElevations, seaLevelKm, reference.sphere, adjacency);
  const cells: WorldCellState[] = parcelTransport.faces.map((face) => {
    const elevationKm = elevations[face.faceId];
    return {
      faceId: face.faceId,
      plateId: face.dominantPlateId,
      crustType: face.crustType,
      continentalFraction: face.continentalFraction,
      crustAgeMyr: face.crustAgeMyr,
      thermalAgeMyr: face.thermalAgeMyr,
      riftExposureMyr: face.riftExposureMyr,
      convergenceExposureMyr: face.convergenceExposureMyr,
      crustThicknessKm: face.crustThicknessKm,
      densityKgM3: face.densityKgM3,
      provenanceId: face.dominantProvenanceId,
      elevationKm,
      waterDepthKm: Math.max(0, seaLevelKm - elevationKm),
      isLand: elevationKm >= seaLevelKm,
    };
  });
  const boundaries: WorldBoundaryState[] = [];
  const counts: Record<BoundaryKind, number> = { divergent: 0, convergent: 0, transform: 0, stable: 0 };
  for (const edge of reference.sphere.edges) {
    const first = cells[edge.faces[0]];
    const second = cells[edge.faces[1]];
    if (first.plateId === second.plateId) continue;
    const motion = classifyBoundaryKinematics(
      boundaryGeometryFromEdge(reference.sphere, edge.id, edge.faces[0]),
      reference.plates[first.plateId].pole,
      reference.plates[second.plateId].pole,
      reference.recipe.radiusKm,
      {
        normalEnterKmPerMyr: 4,
        normalExitKmPerMyr: 2,
        transformEnterKmPerMyr: 4,
        transformExitKmPerMyr: 2,
      },
    );
    counts[motion.kind] += 1;
    boundaries.push({
      edgeId: edge.id,
      plateAId: first.plateId,
      plateBId: second.plateId,
      kind: motion.kind,
      normalKmPerMyr: motion.normalKmPerMyr,
      tangentialKmPerMyr: motion.tangentialKmPerMyr,
      ageMyr: 0,
    });
  }
  const areaBudget = calculateAreaBudget(reference.sphere, cells);
  const weightedElevation = reference.sphere.faces.reduce(
    (sum, face) => sum + cells[face.id].elevationKm * face.areaSteradians,
    0,
  ) / reference.sphere.totalAreaSteradians;
  return {
    ...reference,
    transportModel: "lagrangian-parcel-snapshot-v1",
    cells,
    boundaries,
    seaLevelKm,
    areaBudget,
    stats: {
      landFraction: areaBudget.landSteradians / reference.sphere.totalAreaSteradians,
      continentalCrustFraction: areaBudget.continentalSteradians / reference.sphere.totalAreaSteradians,
      continentalTerraneCount: countContinentalTerranes(reference.sphere, cells),
      minElevationKm: Math.min(...elevations),
      maxElevationKm: Math.max(...elevations),
      meanElevationKm: weightedElevation,
      boundaryCounts: counts,
    },
    parcelTransport,
  };
}

/**
 * Evolves a coupled conservative history. Geological processes operate on the
 * current material distribution, then that material is advected through local
 * geodesic-edge fluxes before the next step. Provenance, fractional continental
 * material, relief, plate mixture, and deformation memory all travel with crust.
 *
 * This is intentionally named a conservative-cell history rather than a fully
 * Lagrangian history: control-volume mixtures persist but parcel identity does
 * not yet survive tectonic creation and destruction. Paired ridge-creation and
 * subduction budgets are reported explicitly.
 */
export function simulateCoupledTectonicWorld(
  overrides: Partial<TectonicWorldRecipe> = {},
): TectonicWorldModel {
  const recipe: TectonicWorldRecipe = { ...DEFAULT_RECIPE, ...overrides };
  validateRecipe(recipe);
  if (recipe.timestepMyr > 4) {
    throw new RangeError("coupled histories require timestepMyr no greater than 4 Myr");
  }

  const random = createRandom(recipe.seed);
  const sphere = createGeodesicSphere(recipe.subdivisions);
  const plateSeeds = createPlateSeeds(random, recipe.plateCount);
  const angularSpeedScale = 6_371 / recipe.radiusKm;
  const plates: TectonicPlateState[] = plateSeeds.map((initialSeed, id) => ({
    id,
    name: `Plate ${id + 1}`,
    initialSeed,
    seed: initialSeed,
    pole: {
      axis: randomUnitVector(random),
      angularSpeedRadPerMyr: random.range(0.0028, 0.0085) * angularSpeedScale
        * (random.next() < 0.5 ? -1 : 1),
    },
    buoyancyBias: random.range(-1, 1),
  }));
  let cells = createInitialCells(
    sphere,
    plates,
    random,
    recipe.seed,
    recipe.radiusKm,
    true,
  );
  const adjacency = buildAdjacency(sphere);
  const boundaryAges = new Map<number, MutableBoundaryAge>();
  const steps = Math.ceil(recipe.historyMyr / recipe.timestepMyr);
  let elapsedMyr = 0;
  let maximumAreaResidualSteradians = 0;
  let maximumMaterialResidualSteradians = 0;
  let maximumFaceAreaResidualSteradians = 0;
  let maximumNonlocalTransportAreaFraction = 0;
  let summedMeanTransportDistanceRadians = 0;
  let maximumTransportDistanceRadians = 0;
  let createdAreaSteradians = 0;
  let destroyedAreaSteradians = 0;
  let maximumCourantNumber = 0;
  let completedSteps = 0;

  for (let step = 0; step < steps; step += 1) {
    const timestepMyr = Math.min(recipe.timestepMyr, recipe.historyMyr - elapsedMyr);
    if (timestepMyr <= 0) break;
    const forcing = applyTectonicStep(
      cells,
      sphere,
      plates,
      recipe,
      adjacency,
      boundaryAges,
      timestepMyr,
      true,
    );

    const transported = transportCellsFiniteVolume(
      cells,
      sphere,
      plates,
      recipe.radiusKm,
      timestepMyr,
      forcing.divergentFaces,
    );
    cells = transported.cells;
    const diagnostics = transported.diagnostics;
    const sourceSinkMismatch = Math.abs(
      diagnostics.createdAreaSteradians - diagnostics.destroyedAreaSteradians,
    );
    maximumAreaResidualSteradians = Math.max(maximumAreaResidualSteradians, sourceSinkMismatch);
    maximumMaterialResidualSteradians = Math.max(maximumMaterialResidualSteradians, sourceSinkMismatch);
    maximumFaceAreaResidualSteradians = 0;
    maximumNonlocalTransportAreaFraction = 0;
    summedMeanTransportDistanceRadians += diagnostics.meanTransportDistanceRadians;
    maximumTransportDistanceRadians = Math.max(
      maximumTransportDistanceRadians,
      diagnostics.maximumTransportDistanceRadians,
    );
    createdAreaSteradians += diagnostics.createdAreaSteradians;
    destroyedAreaSteradians += diagnostics.destroyedAreaSteradians;
    maximumCourantNumber = Math.max(maximumCourantNumber, diagnostics.maximumCourantNumber);
    elapsedMyr += timestepMyr;
    completedSteps += 1;
  }

  const rawElevations = shapeCanonicalShoreline(
    cells.map(baseElevation),
    cells,
    sphere,
    adjacency,
    recipe,
  );
  const seaLevelKm = areaWeightedQuantile(rawElevations, sphere, recipe.oceanFraction);
  const elevations = resolveSubgridBasins(rawElevations, seaLevelKm, sphere, adjacency);
  const finalCells: WorldCellState[] = cells.map((cell, faceId) => {
    const elevationKm = elevations[faceId];
    return {
      faceId,
      plateId: cell.plateId,
      crustType: cell.crustType,
      continentalFraction: cell.continentalFraction,
      crustAgeMyr: cell.crustAgeMyr,
      thermalAgeMyr: cell.crustType === "oceanic"
        ? cell.crustAgeMyr
        : Math.max(0, cell.crustAgeMyr - 250),
      riftExposureMyr: cell.riftExposureMyr,
      convergenceExposureMyr: cell.convergenceExposureMyr,
      crustThicknessKm: cell.crustThicknessKm,
      densityKgM3: cell.densityKgM3,
      provenanceId: cell.provenanceId,
      elevationKm,
      waterDepthKm: Math.max(0, seaLevelKm - elevationKm),
      isLand: elevationKm >= seaLevelKm,
    };
  });
  const boundaries: WorldBoundaryState[] = [];
  const counts: Record<BoundaryKind, number> = {
    divergent: 0,
    convergent: 0,
    transform: 0,
    stable: 0,
  };
  for (const edge of sphere.edges) {
    const first = finalCells[edge.faces[0]];
    const second = finalCells[edge.faces[1]];
    if (first.plateId === second.plateId) continue;
    const motion = classifyBoundaryKinematics(
      boundaryGeometryFromEdge(sphere, edge.id, edge.faces[0]),
      plates[first.plateId].pole,
      plates[second.plateId].pole,
      recipe.radiusKm,
      {
        normalEnterKmPerMyr: 4,
        normalExitKmPerMyr: 2,
        transformEnterKmPerMyr: 4,
        transformExitKmPerMyr: 2,
      },
    );
    counts[motion.kind] += 1;
    boundaries.push({
      edgeId: edge.id,
      plateAId: first.plateId,
      plateBId: second.plateId,
      kind: motion.kind,
      normalKmPerMyr: motion.normalKmPerMyr,
      tangentialKmPerMyr: motion.tangentialKmPerMyr,
      ageMyr: boundaryAges.get(edge.id)?.ageMyr ?? 0,
    });
  }
  const areaBudget = calculateAreaBudget(sphere, finalCells);
  const weightedElevation = sphere.faces.reduce(
    (sum, face) => sum + finalCells[face.id].elevationKm * face.areaSteradians,
    0,
  ) / sphere.totalAreaSteradians;
  return {
    version: 1,
    transportModel: "coupled-conservative-cell-history-v1",
    recipe,
    sphere,
    plates,
    cells: finalCells,
    boundaries,
    seaLevelKm,
    elapsedMyr,
    areaBudget,
    stats: {
      landFraction: areaBudget.landSteradians / sphere.totalAreaSteradians,
      continentalCrustFraction: areaBudget.continentalSteradians / sphere.totalAreaSteradians,
      continentalTerraneCount: countContinentalTerranes(sphere, finalCells),
      minElevationKm: Math.min(...elevations),
      maxElevationKm: Math.max(...elevations),
      meanElevationKm: weightedElevation,
      boundaryCounts: counts,
    },
    transportHistory: {
      stepCount: completedSteps,
      maximumAreaResidualSteradians,
      maximumMaterialResidualSteradians,
      maximumFaceAreaResidualSteradians,
      maximumNonlocalTransportAreaFraction,
      meanStepTransportDistanceRadians: completedSteps > 0
        ? summedMeanTransportDistanceRadians / completedSteps
        : 0,
      maximumTransportDistanceRadians,
      createdAreaSteradians,
      destroyedAreaSteradians,
      maximumCourantNumber,
    },
  };
}
