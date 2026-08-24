import {
  classifyBoundaryKinematics,
  createGeodesicSphere,
  dot3,
  normalize3,
  subtract3,
  type EulerPole,
  type Vec3,
} from "./index.ts";
import type {
  BoundaryKind as DebugBoundaryKind,
  CrustKind,
  TectonicDebugBoundary,
  TectonicDebugCell,
  TectonicDebugSnapshot,
} from "./debugSvg.ts";

export interface DebugFixtureOptions {
  seed?: string;
  subdivisions?: number;
  plateCount?: number;
  simulationTimeMyr?: number;
  radiusKm?: number;
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random01(seed: number, stream: number): number {
  let value = seed + Math.imul(stream + 1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}

function farthestFaceSeeds(centers: readonly Vec3[], count: number, seed: number): number[] {
  const selected = [((seed % centers.length) + centers.length) % centers.length];
  while (selected.length < count) {
    let bestFace = 0;
    let bestDistance = -Infinity;
    for (let candidate = 0; candidate < centers.length; candidate += 1) {
      if (selected.includes(candidate)) continue;
      const similarity = Math.max(...selected.map((face) => dot3(centers[candidate], centers[face])));
      const jitter = random01(seed, candidate + selected.length * centers.length) * 0.08;
      const distance = -similarity + jitter;
      if (distance > bestDistance) {
        bestDistance = distance;
        bestFace = candidate;
      }
    }
    selected.push(bestFace);
  }
  return selected;
}

function platePoles(count: number, seed: number): EulerPole[] {
  return Array.from({ length: count }, (_, index) => {
    const longitude = TAU * random01(seed, 1000 + index * 3);
    const z = random01(seed, 1001 + index * 3) * 2 - 1;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    const speed = (0.0015 + random01(seed, 1002 + index * 3) * 0.006) * (index % 3 === 0 ? -1 : 1);
    return {
      axis: [Math.cos(longitude) * radius, Math.sin(longitude) * radius, z],
      angularSpeedRadPerMyr: speed,
    };
  });
}

const TAU = Math.PI * 2;

/**
 * Produces a deterministic scientific fixture over the real spherical mesh and
 * kinematics primitives. Its synthetic crust fields exist to exercise every
 * diagnostic layer; it is deliberately not exposed as a world generator.
 */
export function createTectonicDebugFixture(options: DebugFixtureOptions = {}): TectonicDebugSnapshot {
  const seedText = options.seed ?? "RIFT-FIXTURE-001";
  const seed = hashText(seedText);
  const subdivisions = options.subdivisions ?? 3;
  const sphere = createGeodesicSphere(subdivisions);
  const requestedPlateCount = options.plateCount ?? 8;
  if (!Number.isInteger(requestedPlateCount) || requestedPlateCount < 2 || requestedPlateCount > sphere.faces.length) {
    throw new RangeError("plateCount must be an integer from 2 through the number of mesh faces");
  }
  const faceCenters = sphere.faces.map((face) => face.center);
  const seedFaceIds = farthestFaceSeeds(faceCenters, requestedPlateCount, seed);
  const plateSeeds = seedFaceIds.map((faceId) => faceCenters[faceId]);
  const plateIds = faceCenters.map((center) => {
    let bestPlate = 0;
    let bestScore = -Infinity;
    for (let plateId = 0; plateId < plateSeeds.length; plateId += 1) {
      // A small deterministic weight avoids a suspiciously uniform tessellation.
      const score = dot3(center, plateSeeds[plateId]) + (random01(seed, 2000 + plateId) - 0.5) * 0.16;
      if (score > bestScore) {
        bestScore = score;
        bestPlate = plateId;
      }
    }
    return bestPlate;
  });

  const provenanceSeedIds = farthestFaceSeeds(faceCenters, Math.min(13, sphere.faces.length), seed ^ 0x51ed270b);
  const provenanceSeeds = provenanceSeedIds.map((faceId) => faceCenters[faceId]);
  const provenanceIds = faceCenters.map((center) => {
    let best = 0;
    for (let index = 1; index < provenanceSeeds.length; index += 1) {
      if (dot3(center, provenanceSeeds[index]) > dot3(center, provenanceSeeds[best])) best = index;
    }
    return best;
  });

  const continentSeeds = [
    plateSeeds[seed % plateSeeds.length],
    faceCenters[(seed * 7 + 31) % faceCenters.length],
    faceCenters[(seed * 13 + 97) % faceCenters.length],
  ];
  const crustKinds: CrustKind[] = faceCenters.map((center, faceId) => {
    const continentalSignal = Math.max(...continentSeeds.map((point, index) => (
      dot3(center, point) - (index === 0 ? 0.18 : 0.48)
    ))) + 0.06 * Math.sin(faceId * 1.618 + seed * 1e-5);
    if (continentalSignal > 0.08) return "continental";
    if (continentalSignal > -0.04) return "transitional";
    return "oceanic";
  });

  const poles = platePoles(requestedPlateCount, seed);
  const radiusKm = options.radiusKm ?? 6371;
  const boundaries: TectonicDebugBoundary[] = [];
  const boundaryFaces = new Map<number, DebugBoundaryKind[]>();
  for (const edge of sphere.edges) {
    const [faceA, faceB] = edge.faces;
    const plateA = plateIds[faceA];
    const plateB = plateIds[faceB];
    if (plateA === plateB) continue;
    const [vertexA, vertexB] = edge.vertices.map((id) => sphere.vertices[id].position) as [Vec3, Vec3];
    const kinematics = classifyBoundaryKinematics({
      point: edge.midpoint,
      tangent: normalize3(subtract3(vertexB, vertexA)),
      plateASidePoint: faceCenters[faceA],
      plateBSidePoint: faceCenters[faceB],
    }, poles[plateA], poles[plateB], radiusKm, {
      normalEnterKmPerMyr: 8,
      normalExitKmPerMyr: 4,
      transformEnterKmPerMyr: 8,
      transformExitKmPerMyr: 4,
    });
    let kind: DebugBoundaryKind = kinematics.kind === "stable" ? "diffuse" : kinematics.kind;
    if (kind === "convergent"
      && crustKinds[faceA] === "continental"
      && crustKinds[faceB] === "continental") kind = "collision";
    boundaries.push({ kind, points: [vertexA, vertexB] });
    boundaryFaces.set(faceA, [...(boundaryFaces.get(faceA) ?? []), kind]);
    boundaryFaces.set(faceB, [...(boundaryFaces.get(faceB) ?? []), kind]);
  }

  const simulationTimeMyr = options.simulationTimeMyr ?? 180;
  const cells: TectonicDebugCell[] = sphere.faces.map((face) => {
    let crustKind = crustKinds[face.id];
    const localBoundaries = boundaryFaces.get(face.id) ?? [];
    if (crustKind === "oceanic" && localBoundaries.includes("convergent")) crustKind = "arc";
    const oceanic = crustKind === "oceanic" || crustKind === "arc" || crustKind === "volcanic";
    const ageSignal = random01(seed, 4000 + provenanceIds[face.id]) * 0.35
      + random01(seed, 5000 + face.id) * 0.12
      + (1 - Math.abs(face.center[2])) * 0.53;
    const crustAgeMyr = oceanic
      ? Math.min(simulationTimeMyr, ageSignal * 190)
      : 550 + ageSignal * 2200;
    const collision = localBoundaries.includes("collision");
    const crustThicknessKm = crustKind === "continental"
      ? 31 + 10 * ageSignal + (collision ? 18 : 0)
      : crustKind === "transitional"
        ? 18 + 8 * ageSignal
        : crustKind === "arc"
          ? 17 + 5 * ageSignal
          : 6.5 + 1.5 * ageSignal;
    const elevationKm = oceanic
      ? -2.4 - 3.4 * Math.sqrt(clamp01(crustAgeMyr / 190)) + (crustKind === "arc" ? 4.2 : 0)
      : -0.35 + (crustThicknessKm - 28) * 0.105;
    return {
      id: face.id,
      vertexIndices: face.vertices,
      plateId: plateIds[face.id],
      crustKind,
      crustAgeMyr,
      crustThicknessKm,
      provenanceId: provenanceIds[face.id],
      elevationKm,
    };
  });

  return {
    seed: seedText,
    simulationTimeMyr,
    vertices: sphere.vertices.map((vertex) => vertex.position),
    cells,
    boundaries,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
