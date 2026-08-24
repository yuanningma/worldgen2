import {
  add3,
  angleBetweenUnitVectors,
  cross3,
  dot3,
  normalize3,
  type Vec3,
} from "./vector.ts";

export interface GeodesicVertex {
  readonly id: number;
  readonly position: Vec3;
}

export interface GeodesicFace {
  readonly id: number;
  readonly vertices: readonly [number, number, number];
  readonly center: Vec3;
  readonly areaSteradians: number;
}

export interface GeodesicEdge {
  readonly id: number;
  readonly vertices: readonly [number, number];
  readonly faces: readonly [number, number];
  readonly midpoint: Vec3;
  readonly arcLengthRadians: number;
}

export interface GeodesicSphere {
  readonly subdivisions: number;
  readonly vertices: readonly GeodesicVertex[];
  readonly faces: readonly GeodesicFace[];
  readonly edges: readonly GeodesicEdge[];
  readonly totalAreaSteradians: number;
}

type Triangle = readonly [number, number, number];

const PHI = (1 + Math.sqrt(5)) / 2;

const ICOSAHEDRON_POINTS: readonly Vec3[] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];

const ICOSAHEDRON_FACES: readonly Triangle[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

function sphericalTriangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  const determinant = Math.abs(dot3(a, cross3(b, c)));
  const denominator = 1 + dot3(a, b) + dot3(b, c) + dot3(c, a);
  return 2 * Math.atan2(determinant, denominator);
}

function outwardTriangle(triangle: Triangle, points: readonly Vec3[]): Triangle {
  const [a, b, c] = triangle.map((index) => points[index]) as [Vec3, Vec3, Vec3];
  return dot3(cross3(b, c), a) >= 0 ? triangle : [triangle[0], triangle[2], triangle[1]];
}

export function createGeodesicSphere(subdivisions = 0): GeodesicSphere {
  if (!Number.isInteger(subdivisions) || subdivisions < 0 || subdivisions > 7) {
    throw new RangeError("subdivisions must be an integer between 0 and 7");
  }

  const points: Vec3[] = ICOSAHEDRON_POINTS.map(normalize3);
  let triangles: Triangle[] = ICOSAHEDRON_FACES.map((face) => outwardTriangle(face, points));

  for (let level = 0; level < subdivisions; level += 1) {
    const midpointIds = new Map<string, number>();
    const midpoint = (a: number, b: number): number => {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;
      const existing = midpointIds.get(key);
      if (existing !== undefined) return existing;
      const id = points.length;
      points.push(normalize3(add3(points[a], points[b])));
      midpointIds.set(key, id);
      return id;
    };

    const next: Triangle[] = [];
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }

  const vertices: GeodesicVertex[] = points.map((position, id) => ({ id, position }));
  const faces: GeodesicFace[] = triangles.map((triangle, id) => {
    const [a, b, c] = triangle.map((index) => points[index]) as [Vec3, Vec3, Vec3];
    return {
      id,
      vertices: triangle,
      center: normalize3(add3(add3(a, b), c)),
      areaSteradians: sphericalTriangleArea(a, b, c),
    };
  });

  const edgeFaces = new Map<string, { vertices: [number, number]; faces: number[] }>();
  for (const face of faces) {
    const [a, b, c] = face.vertices;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const low = Math.min(u, v);
      const high = Math.max(u, v);
      const key = `${low}:${high}`;
      const entry = edgeFaces.get(key);
      if (entry) entry.faces.push(face.id);
      else edgeFaces.set(key, { vertices: [low, high], faces: [face.id] });
    }
  }

  const edges: GeodesicEdge[] = [];
  for (const entry of edgeFaces.values()) {
    if (entry.faces.length !== 2) {
      throw new Error(`Closed geodesic sphere edge has ${entry.faces.length} adjacent faces`);
    }
    const [a, b] = entry.vertices.map((index) => points[index]) as [Vec3, Vec3];
    edges.push({
      id: edges.length,
      vertices: entry.vertices,
      faces: [entry.faces[0], entry.faces[1]],
      midpoint: normalize3(add3(a, b)),
      arcLengthRadians: angleBetweenUnitVectors(a, b),
    });
  }

  return {
    subdivisions,
    vertices,
    faces,
    edges,
    totalAreaSteradians: faces.reduce((sum, face) => sum + face.areaSteradians, 0),
  };
}

export function geodesicDistanceKm(a: Vec3, b: Vec3, radiusKm: number): number {
  if (!(radiusKm > 0) || !Number.isFinite(radiusKm)) {
    throw new RangeError("radiusKm must be finite and positive");
  }
  return angleBetweenUnitVectors(normalize3(a), normalize3(b)) * radiusKm;
}
