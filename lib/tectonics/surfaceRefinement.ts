import {
  cross3,
  dot3,
  normalize3,
  scale3,
  subtract3,
  type Vec3,
} from "./vector.ts";
import type { TectonicWorldModel, WorldCellState } from "./worldSimulation.ts";

export interface SurfaceRefinementOptions {
  /** Maximum coast movement as a fraction of its canonical geodesic edge. */
  coastAmplitude?: number;
  /** Width of the presentation-only coastal band, in edge lengths. */
  coastalBand?: number;
  reliefPasses?: number;
}

export interface RefinedSurfaceSample {
  readonly canonicalFaceId: number;
  readonly canonicalIsLand: boolean;
  readonly isLand: boolean;
  readonly elevationKm: number;
  readonly waterDepthKm: number;
  readonly signedCoastDistanceRadians: number | null;
  readonly coastOffsetRadians: number;
  readonly presentationOnly: true;
}

export interface SurfaceRefinementAudit {
  readonly canonicalFaceCount: number;
  readonly canonicalAnchorMismatches: number;
  readonly maximumOffsetRatio: number;
  readonly topologyAnchorsPreserved: boolean;
}

interface CoastEdge {
  readonly edgeId: number;
  readonly vertices: readonly [Vec3, Vec3];
  readonly faces: readonly [number, number];
  readonly length: number;
  readonly phase: readonly [number, number, number];
}

interface KdNode {
  readonly faceId: number;
  readonly axis: 0 | 1 | 2;
  readonly left: KdNode | null;
  readonly right: KdNode | null;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function angle(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot3(a, b), -1, 1));
}

function hashUnit(seed: string | number, edgeId: number, octave: number): number {
  const text = `${String(seed)}:${edgeId}:${octave}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function buildKdTree(faceIds: number[], centers: readonly Vec3[], depth = 0): KdNode | null {
  if (faceIds.length === 0) return null;
  const axis = (depth % 3) as 0 | 1 | 2;
  faceIds.sort((a, b) => centers[a][axis] - centers[b][axis] || a - b);
  const middle = Math.floor(faceIds.length / 2);
  return {
    faceId: faceIds[middle],
    axis,
    left: buildKdTree(faceIds.slice(0, middle), centers, depth + 1),
    right: buildKdTree(faceIds.slice(middle + 1), centers, depth + 1),
  };
}

function nearestFace(root: KdNode, centers: readonly Vec3[], point: Vec3): number {
  let bestFace = root.faceId;
  let bestDistance = Infinity;
  const visit = (node: KdNode | null): void => {
    if (!node) return;
    const center = centers[node.faceId];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance || (distance === bestDistance && node.faceId < bestFace)) {
      bestDistance = distance;
      bestFace = node.faceId;
    }
    const delta = point[node.axis] - center[node.axis];
    visit(delta < 0 ? node.left : node.right);
    if (delta * delta <= bestDistance) visit(delta < 0 ? node.right : node.left);
  };
  visit(root);
  return bestFace;
}

function faceNeighbors(model: TectonicWorldModel): readonly number[][] {
  const result: number[][] = model.sphere.faces.map(() => []);
  for (const edge of model.sphere.edges) {
    result[edge.faces[0]].push(edge.faces[1]);
    result[edge.faces[1]].push(edge.faces[0]);
  }
  return result;
}

function containsPoint(model: TectonicWorldModel, faceId: number, point: Vec3): boolean {
  const vertices = model.sphere.faces[faceId].vertices.map((id) => model.sphere.vertices[id].position);
  for (let index = 0; index < 3; index += 1) {
    if (dot3(cross3(vertices[index], vertices[(index + 1) % 3]), point) < -1e-11) return false;
  }
  return true;
}

function canonicalFaceAtPoint(
  model: TectonicWorldModel,
  root: KdNode,
  centers: readonly Vec3[],
  neighbors: readonly number[][],
  point: Vec3,
): number {
  const nearest = nearestFace(root, centers, point);
  if (containsPoint(model, nearest, point)) return nearest;
  const visited = new Set([nearest]);
  let frontier = [nearest];
  for (let depth = 0; depth < 4; depth += 1) {
    const next: number[] = [];
    for (const faceId of frontier) {
      for (const neighbor of neighbors[faceId]) {
        if (visited.has(neighbor)) continue;
        if (containsPoint(model, neighbor, point)) return neighbor;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return nearest;
}

function smoothRelief(
  model: TectonicWorldModel,
  cells: readonly WorldCellState[],
  neighbors: readonly number[][],
  passes: number,
): Float64Array {
  let current = Float64Array.from(cells.map((cell) => cell.elevationKm));
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Float64Array(current.length);
    for (const face of model.sphere.faces) {
      const canonicalLand = cells[face.id].isLand;
      const sameClass = neighbors[face.id].filter((id) => cells[id].isLand === canonicalLand);
      let sum = current[face.id] * 3;
      for (const id of sameClass) sum += current[id];
      next[face.id] = sum / (3 + sameClass.length);
    }
    current = next;
  }
  return current;
}

function closestOnEdge(point: Vec3, edge: CoastEdge): { distance: number; along: number } {
  const [a, b] = edge.vertices;
  const normal = normalize3(cross3(a, b));
  const projected = subtract3(point, scale3(normal, dot3(point, normal)));
  if (dot3(projected, projected) < 1e-14) return { distance: Math.min(angle(point, a), angle(point, b)), along: 0 };
  const foot = normalize3(projected);
  const along = angle(a, foot) / edge.length;
  if (along >= 0 && along <= 1 && Math.abs(angle(a, foot) + angle(foot, b) - edge.length) < 1e-5) {
    return { distance: Math.abs(Math.asin(clamp(dot3(point, normal), -1, 1))), along };
  }
  const distanceA = angle(point, a);
  const distanceB = angle(point, b);
  return distanceA <= distanceB ? { distance: distanceA, along: 0 } : { distance: distanceB, along: 1 };
}

function edgeOffset(edge: CoastEdge, along: number, amplitude: number): number {
  const endpointFade = Math.sin(Math.PI * clamp(along)) ** 2;
  const waves = (
    Math.sin(Math.PI * 2 * (along + edge.phase[0])) * 0.68
    + Math.sin(Math.PI * 2 * (along * 3 + edge.phase[1])) * 0.22
    + Math.sin(Math.PI * 2 * (along * 7 + edge.phase[2])) * 0.1
  );
  return waves * endpointFade * amplitude * edge.length;
}

/**
 * Build a presentation-only high-resolution sampler over a canonical world.
 *
 * Coast displacement is confined to the two faces incident to each canonical
 * coast edge, is less than one fifth of an edge, and vanishes at vertices.
 * Canonical face centers therefore remain fixed topology anchors, so islands,
 * continents, and connections cannot be added or removed at the world scale.
 */
export function createSurfaceRefinement(
  model: TectonicWorldModel,
  options: SurfaceRefinementOptions = {},
): {
  readonly sample: (direction: Vec3) => RefinedSurfaceSample;
  readonly audit: () => SurfaceRefinementAudit;
} {
  const requestedAmplitude = clamp(options.coastAmplitude ?? 0.21, 0, 0.24);
  const bandRatio = clamp(options.coastalBand ?? 0.34, requestedAmplitude + 0.04, 0.45);
  const cellsByFace = new Map(model.cells.map((cell) => [cell.faceId, cell]));
  const cells = model.sphere.faces.map((face) => {
    const cell = cellsByFace.get(face.id);
    if (!cell) throw new Error(`surface refinement missing canonical face ${face.id}`);
    return cell;
  });
  const centers = model.sphere.faces.map((face) => face.center);
  const neighbors = faceNeighbors(model);
  const root = buildKdTree(model.sphere.faces.map((face) => face.id), centers);
  if (!root) throw new Error("surface refinement requires at least one canonical face");
  const relief = smoothRelief(model, cells, neighbors, Math.max(0, Math.round(options.reliefPasses ?? 3)));
  const reliefCandidates = model.sphere.faces.map((face) => {
    const nearby = new Set<number>([face.id]);
    for (const neighbor of neighbors[face.id]) {
      nearby.add(neighbor);
      for (const second of neighbors[neighbor]) nearby.add(second);
    }
    return [false, true].map((land) => [...nearby].filter((candidate) => cells[candidate].isLand === land));
  });
  const coastByFace: CoastEdge[][] = model.sphere.faces.map(() => []);
  const coastEdges: CoastEdge[] = [];
  for (const edge of model.sphere.edges) {
    if (cells[edge.faces[0]].isLand === cells[edge.faces[1]].isLand) continue;
    const coast: CoastEdge = {
      edgeId: edge.id,
      vertices: edge.vertices.map((id) => model.sphere.vertices[id].position) as unknown as readonly [Vec3, Vec3],
      faces: edge.faces,
      length: edge.arcLengthRadians,
      phase: [0, 1, 2].map((octave) => hashUnit(model.recipe.seed, edge.id, octave)) as unknown as readonly [number, number, number],
    };
    coastEdges.push(coast);
    coastByFace[edge.faces[0]].push(coast);
    coastByFace[edge.faces[1]].push(coast);
  }
  // A requested amplitude is also bounded by this particular mesh. The limit
  // is solved against every canonical face-center anchor, with a small safety
  // margin, so even unusually acute cells cannot be reclassified.
  let safeAmplitude = requestedAmplitude;
  for (const face of model.sphere.faces) {
    let nearest: { edge: CoastEdge; distance: number; along: number } | null = null;
    for (const edge of coastByFace[face.id]) {
      const closest = closestOnEdge(face.center, edge);
      if (!nearest || closest.distance < nearest.distance) nearest = { edge, ...closest };
    }
    if (!nearest) continue;
    const signedDistance = cells[face.id].isLand ? nearest.distance : -nearest.distance;
    const unitOffset = edgeOffset(nearest.edge, nearest.along, 1);
    if ((signedDistance > 0 && unitOffset < 0) || (signedDistance < 0 && unitOffset > 0)) {
      safeAmplitude = Math.min(safeAmplitude, Math.abs(signedDistance / unitOffset) * 0.98);
    }
  }
  const amplitude = Math.max(0, safeAmplitude);

  const sample = (input: Vec3): RefinedSurfaceSample => {
    const point = normalize3(input);
    const faceId = canonicalFaceAtPoint(model, root, centers, neighbors, point);
    const canonical = cells[faceId];
    let refinedLand = canonical.isLand;
    let signedDistance: number | null = null;
    let offset = 0;
    let nearestEdge: CoastEdge | null = null;
    let nearestDistance = Infinity;
    let nearestAlong = 0;
    for (const edge of coastByFace[faceId]) {
      const closest = closestOnEdge(point, edge);
      if (closest.distance < nearestDistance) {
        nearestDistance = closest.distance;
        nearestAlong = closest.along;
        nearestEdge = edge;
      }
    }
    if (nearestEdge && nearestDistance <= nearestEdge.length * bandRatio) {
      offset = edgeOffset(nearestEdge, nearestAlong, amplitude);
      signedDistance = canonical.isLand ? nearestDistance : -nearestDistance;
      refinedLand = signedDistance + offset >= 0;
    }

    const candidates = reliefCandidates[faceId][refinedLand ? 1 : 0];
    let weightedElevation = 0;
    let totalWeight = 0;
    for (const candidate of candidates) {
      const weight = Math.exp((dot3(centers[candidate], point) - 1) * 420);
      weightedElevation += relief[candidate] * weight;
      totalWeight += weight;
    }
    const fallback = refinedLand ? Math.max(model.seaLevelKm, canonical.elevationKm) : Math.min(model.seaLevelKm, canonical.elevationKm);
    const elevationKm = totalWeight > 0 ? weightedElevation / totalWeight : fallback;
    return {
      canonicalFaceId: faceId,
      canonicalIsLand: canonical.isLand,
      isLand: refinedLand,
      elevationKm,
      waterDepthKm: refinedLand ? 0 : Math.max(0.001, model.seaLevelKm - elevationKm),
      signedCoastDistanceRadians: signedDistance,
      coastOffsetRadians: offset,
      presentationOnly: true,
    };
  };

  const audit = (): SurfaceRefinementAudit => {
    let mismatches = 0;
    for (const face of model.sphere.faces) {
      if (sample(face.center).isLand !== cells[face.id].isLand) mismatches += 1;
    }
    const maximumOffsetRatio = coastEdges.reduce((maximum, edge) => {
      for (let step = 0; step <= 64; step += 1) {
        maximum = Math.max(maximum, Math.abs(edgeOffset(edge, step / 64, amplitude)) / edge.length);
      }
      return maximum;
    }, 0);
    return {
      canonicalFaceCount: model.sphere.faces.length,
      canonicalAnchorMismatches: mismatches,
      maximumOffsetRatio,
      topologyAnchorsPreserved: mismatches === 0 && maximumOffsetRatio <= 0.2400001,
    };
  };

  return { sample, audit };
}
