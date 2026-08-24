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
  dot3,
  normalize3,
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

function continentalGraphRegions(
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  plateByFace: readonly number[],
  adjacency: readonly number[][],
  random: RandomSource,
  seedHash: number,
  radiusKm: number,
): Int32Array {
  const plateNeighbors = plates.map(() => new Set<number>());
  const boundaryRegimes = new Map<number, BoundaryKind>();
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

  const communityCount = 2 + random.integer(0, 2);
  const roots: number[] = [];
  while (roots.length < communityCount) {
    const candidates = plates
      .filter((plate) => !roots.includes(plate.id))
      .map((plate) => {
        const separation = roots.length === 0 ? 1 : Math.min(...roots.map((root) => (
          angleBetweenUnitVectors(plate.initialSeed, plates[root].initialSeed)
        ))) / Math.PI;
        return {
          id: plate.id,
          score: plate.buoyancyBias * 0.34 + separation * 0.9 + random.next() * 0.16
            - Math.abs(plate.initialSeed[2]) * 0.65,
        };
      })
      .sort((a, b) => b.score - a.score || a.id - b.id);
    roots.push(candidates[0].id);
  }

  const nucleusCount = Math.min(7, Math.max(4, Math.round(Math.sqrt(plates.length)) + random.integer(0, 3)));
  const nucleusPlates = [...roots];
  while (nucleusPlates.length < nucleusCount) {
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
  const rawWeights = nucleusFaces.map((_, index) => Math.exp(random.range(-0.72, 0.72)) * (index === 0 ? 1.45 : 1));
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const targetArea = sphere.totalAreaSteradians * 0.38;
  const frontFaces: number[] = [];
  const frontRegions: number[] = [];
  const frontRawWeights: number[] = [];
  for (let regionId = 0; regionId < nucleusFaces.length; regionId += 1) {
    const groupBudgetShare = rawWeights[regionId] / totalWeight;
    const subordinateCount = 2 + random.integer(0, 3);
    const lobeFaces = [nucleusFaces[regionId]];
    for (let lobe = 0; lobe < subordinateCount; lobe += 1) {
      let faceId = nucleusFaces[regionId];
      const walkSteps = 3 + random.integer(0, 3 + sphere.subdivisions * 2);
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
    const lobeWeights = lobeFaces.map((_, index) => index === 0 ? 1.8 : random.range(0.42, 0.95));
    const lobeWeightTotal = lobeWeights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < lobeFaces.length; index += 1) {
      frontFaces.push(lobeFaces[index]);
      frontRegions.push(regionId);
      frontRawWeights.push(groupBudgetShare * lobeWeights[index] / lobeWeightTotal);
    }
  }
  const directions = frontFaces.map(() => randomUnitVector(random));
  const budgets = frontRawWeights.map((weight) => targetArea * weight);
  const frontAreas = new Float64Array(frontFaces.length);
  const regions = new Int32Array(sphere.faces.length).fill(-1);
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
    if (entry.cost !== costs[entry.regionId][entry.faceId] || regions[entry.faceId] !== -1) continue;
    if (frontAreas[entry.regionId] >= budgets[entry.regionId]) continue;
    regions[entry.faceId] = frontRegions[entry.regionId];
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
      const resistance = Math.max(0.18,
        Math.exp(noise * 0.82 - directionGain * 0.32) + polarResistance
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
    const enqueue = (fromId: number, neighborId: number, baseCost: number): void => {
      if (regions[neighborId] !== -1) return;
      const regionId = regions[fromId];
      const noise = mixedNoise(sphere.faces[neighborId].center, seedHash + regionId * 7_919 + 313);
      const low = Math.min(fromId, neighborId);
      const high = Math.max(fromId, neighborId);
      const crossingKind = boundaryRegimes.get(low * sphere.faces.length + high);
      const crossing = crossingKind === "divergent" ? 1.2 : crossingKind === "transform" ? 0.3 : 0;
      const cost = baseCost + Math.max(0.12, Math.exp(noise * 0.9) + crossing);
      if (cost < fallbackCosts[neighborId]) {
        fallbackCosts[neighborId] = cost;
        fallbackRegions[neighborId] = regionId;
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
      claimedArea += sphere.faces[entry.faceId].areaSteradians;
      for (const neighborId of adjacency[entry.faceId]) enqueue(entry.faceId, neighborId, entry.cost);
    }
  }
  return regions;
}

function createInitialCells(
  sphere: GeodesicSphere,
  plates: readonly TectonicPlateState[],
  random: RandomSource,
  seed: string | number,
  radiusKm: number,
): MutableCell[] {
  const hash = seedHashNumber(seed);
  const adjacency = buildAdjacency(sphere);
  const plateByFace = sphere.faces.map((face) => nearestPlate(face.center, plates));
  const continentalRegions = continentalGraphRegions(sphere, plates, plateByFace, adjacency, random, hash, radiusKm);
  return sphere.faces.map((face) => {
    const plateId = plateByFace[face.id];
    const texture = mixedNoise(face.center, hash);
    const continental = continentalRegions[face.id] >= 0;
    const age = continental
      ? 1_250 + texture * 620 + (face.center[2] + 1) * 170
      : 75 + texture * 55;
    return {
      plateId,
      plateFractions: plates.map((plate) => plate.id === plateId ? 1 : 0),
      crustType: continental ? "continental" : "oceanic",
      continentalFraction: continental ? 1 : 0,
      crustAgeMyr: age,
      crustThicknessKm: continental ? 36.5 + texture * 4.2 : 7 + texture * 0.75,
      densityKgM3: continental ? 2_745 - texture * 28 : 2_985 + texture * 38,
      provenanceId: continental ? 10_000 + continentalRegions[face.id] : plateId,
      tectonicReliefKm: 0,
      roughnessKm: texture * (continental ? 0.12 : 0.07),
      riftExposureMyr: 0,
      convergenceExposureMyr: 0,
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
): void {
  const intensity = Math.min(1, Math.abs(speed) / 70);
  const lithosphereWeakness = cell.crustType === "oceanic"
    ? 1
    : cell.crustAgeMyr > 1_650 ? 0.22 : cell.crustAgeMyr > 1_050 ? 0.46 : 0.76;
  cell.riftExposureMyr += timestepMyr * intensity * lithosphereWeakness;
  if (fractionalRifting && cell.continentalFraction > 0) {
    if (cell.riftExposureMyr < 150) {
      cell.crustThicknessKm = Math.max(22, cell.crustThicknessKm - intensity * 0.45 * timestepMyr);
      cell.tectonicReliefKm = Math.max(-1.1, cell.tectonicReliefKm - intensity * 0.055 * timestepMyr);
      return;
    }
    cell.continentalFraction = Math.max(
      0,
      cell.continentalFraction - timestepMyr * intensity / 240,
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
  if (cell.crustType === "continental" && cell.riftExposureMyr < 150) {
    cell.crustThicknessKm = Math.max(22, cell.crustThicknessKm - intensity * 0.45 * timestepMyr);
    cell.tectonicReliefKm = Math.max(-1.1, cell.tectonicReliefKm - intensity * 0.055 * timestepMyr);
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
    boundaryAges.set(edge.id, {
      kind: motion.kind,
      ageMyr: previous?.kind === motion.kind ? previous.ageMyr + timestepMyr : timestepMyr,
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
  for (const face of sphere.faces) {
    const faceId = face.id;
    if (divergentSpeed[faceId] >= convergentSpeed[faceId] && divergentSpeed[faceId] > 0) {
      applyDivergence(
        cells[faceId],
        divergentPair[faceId],
        timestepMyr,
        divergentSpeed[faceId],
        fractionalRifting,
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
  const plates: TectonicPlateState[] = plateSeeds.map((initialSeed, id) => ({
    id,
    name: `Plate ${id + 1}`,
    initialSeed,
    seed: initialSeed,
    pole: {
      axis: randomUnitVector(random),
      angularSpeedRadPerMyr: random.range(0.0028, 0.0085) * (random.next() < 0.5 ? -1 : 1),
    },
    buoyancyBias: random.range(-1, 1),
  }));
  const cells = createInitialCells(sphere, plates, random, recipe.seed, recipe.radiusKm);
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
      boundaryAges.set(edge.id, {
        kind: motion.kind,
        ageMyr: previous?.kind === motion.kind ? previous.ageMyr + timestepMyr : timestepMyr,
      });
      const pairId = 100_000 + Math.min(first.plateId, second.plateId) * recipe.plateCount + Math.max(first.plateId, second.plateId);
      if (motion.kind === "divergent") {
        for (const faceId of edge.faces) {
          const speed = Math.abs(motion.normalKmPerMyr);
          if (speed > divergentSpeed[faceId]) {
            divergentSpeed[faceId] = speed;
            divergentPair[faceId] = pairId;
          }
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
    for (const face of sphere.faces) {
      const faceId = face.id;
      // One canonical forcing per face and regime per timestep prevents a
      // three-edge triangle from accumulating three million years of strain in
      // one million years. The strongest normal regime wins locally.
      if (divergentSpeed[faceId] >= convergentSpeed[faceId] && divergentSpeed[faceId] > 0) {
        applyDivergence(cells[faceId], divergentPair[faceId], timestepMyr, divergentSpeed[faceId]);
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

  const rawElevations = cells.map(baseElevation);
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
  const plates: TectonicPlateState[] = plateSeeds.map((initialSeed, id) => ({
    id,
    name: `Plate ${id + 1}`,
    initialSeed,
    seed: initialSeed,
    pole: {
      axis: randomUnitVector(random),
      angularSpeedRadPerMyr: random.range(0.0028, 0.0085) * (random.next() < 0.5 ? -1 : 1),
    },
    buoyancyBias: random.range(-1, 1),
  }));
  let cells = createInitialCells(sphere, plates, random, recipe.seed, recipe.radiusKm);
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

  const rawElevations = cells.map(baseElevation);
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
