import { add3, cross3, dot3, normalize3, scale3, type Vec3 } from "./vector.ts";

export interface EulerPole {
  /** Unit vector in the fixed mantle frame. */
  readonly axis: Vec3;
  /** Signed angular speed in radians per million years. */
  readonly angularSpeedRadPerMyr: number;
}

export function eulerAngularVelocity(pole: EulerPole): Vec3 {
  return scale3(normalize3(pole.axis), pole.angularSpeedRadPerMyr);
}

/** Tangential velocity in planet-radii per million years. */
export function surfaceAngularVelocity(pole: EulerPole, position: Vec3): Vec3 {
  return cross3(eulerAngularVelocity(pole), normalize3(position));
}

/** Tangential velocity in kilometers per million years. */
export function surfaceVelocityKmPerMyr(
  pole: EulerPole,
  position: Vec3,
  radiusKm: number,
): Vec3 {
  if (!(radiusKm > 0) || !Number.isFinite(radiusKm)) {
    throw new RangeError("radiusKm must be finite and positive");
  }
  return scale3(surfaceAngularVelocity(pole, position), radiusKm);
}

/** Exact finite Euler rotation using Rodrigues' formula. */
export function rotateByEulerPole(position: Vec3, pole: EulerPole, deltaMyr: number): Vec3 {
  if (!Number.isFinite(deltaMyr)) throw new RangeError("deltaMyr must be finite");
  const point = normalize3(position);
  const axis = normalize3(pole.axis);
  const angle = pole.angularSpeedRadPerMyr * deltaMyr;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return normalize3(add3(
    add3(scale3(point, cosine), scale3(cross3(axis, point), sine)),
    scale3(axis, dot3(axis, point) * (1 - cosine)),
  ));
}
