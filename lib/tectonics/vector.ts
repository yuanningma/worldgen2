export type Vec3 = readonly [number, number, number];

export const VECTOR_EPSILON = 1e-12;

export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale3(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length3(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize3(vector: Vec3): Vec3 {
  const length = length3(vector);
  if (!Number.isFinite(length) || length <= VECTOR_EPSILON) {
    throw new RangeError("Cannot normalize a zero-length or non-finite vector");
  }
  return scale3(vector, 1 / length);
}

export function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

export function angleBetweenUnitVectors(a: Vec3, b: Vec3): number {
  // atan2 remains well-conditioned for both very short and near-antipodal arcs.
  return Math.atan2(length3(cross3(a, b)), clampUnit(dot3(a, b)));
}

export function almostEqualVec3(a: Vec3, b: Vec3, tolerance = 1e-10): boolean {
  return length3(subtract3(a, b)) <= tolerance;
}
