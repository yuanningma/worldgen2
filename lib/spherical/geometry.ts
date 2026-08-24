export type Vec3 = readonly [number, number, number];

export interface SphericalRasterGeometry {
  readonly width: number;
  readonly height: number;
  readonly radiusKm: number;
  /** Interleaved xyz unit vectors, three values per cell. */
  readonly centers: Float64Array;
  /** Exact area of each longitude/latitude cell on the sphere, in km^2. */
  readonly cellAreasKm2: Float64Array;
  /** Latitude of each raster row's cell centers, in radians. */
  readonly rowLatitudes: Float64Array;
  readonly totalAreaKm2: number;
}

const TAU = Math.PI * 2;

export function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitude(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector);
  if (length === 0) throw new Error("Cannot normalize a zero-length vector");
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function latLonToUnit(latitudeRadians: number, longitudeRadians: number): Vec3 {
  const cosLatitude = Math.cos(latitudeRadians);
  return [
    cosLatitude * Math.cos(longitudeRadians),
    cosLatitude * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians),
  ];
}

export function unitToLatLon(unit: Vec3): readonly [number, number] {
  const normalized = normalize(unit);
  return [Math.asin(clamp(normalized[2], -1, 1)), Math.atan2(normalized[1], normalized[0])];
}

export function angularDistanceRadians(a: Vec3, b: Vec3): number {
  // atan2 is better conditioned than acos for both very close and antipodal points.
  return Math.atan2(magnitude(cross(a, b)), clamp(dot(a, b), -1, 1));
}

export function greatCircleDistanceKm(a: Vec3, b: Vec3, radiusKm: number): number {
  return angularDistanceRadians(a, b) * radiusKm;
}

export function rotateAroundAxis(point: Vec3, axis: Vec3, angleRadians: number): Vec3 {
  const unitAxis = normalize(axis);
  const cosine = Math.cos(angleRadians);
  const sine = Math.sin(angleRadians);
  const axisCrossPoint = cross(unitAxis, point);
  const axisProjection = dot(unitAxis, point) * (1 - cosine);
  return normalize([
    point[0] * cosine + axisCrossPoint[0] * sine + unitAxis[0] * axisProjection,
    point[1] * cosine + axisCrossPoint[1] * sine + unitAxis[1] * axisProjection,
    point[2] * cosine + axisCrossPoint[2] * sine + unitAxis[2] * axisProjection,
  ]);
}

export function sphericalCellAreaKm2(
  longitudeWidthRadians: number,
  southLatitudeRadians: number,
  northLatitudeRadians: number,
  radiusKm: number,
): number {
  return radiusKm * radiusKm
    * longitudeWidthRadians
    * (Math.sin(northLatitudeRadians) - Math.sin(southLatitudeRadians));
}

export function sphereAreaKm2(radiusKm: number): number {
  return 4 * Math.PI * radiusKm * radiusKm;
}

export function createSphericalRasterGeometry(
  width: number,
  height: number,
  radiusKm = 6_371,
): SphericalRasterGeometry {
  if (!Number.isInteger(width) || width < 4) throw new Error("width must be an integer of at least 4");
  if (!Number.isInteger(height) || height < 2) throw new Error("height must be an integer of at least 2");
  if (!(radiusKm > 0) || !Number.isFinite(radiusKm)) throw new Error("radiusKm must be finite and positive");

  const centers = new Float64Array(width * height * 3);
  const cellAreasKm2 = new Float64Array(width * height);
  const rowLatitudes = new Float64Array(height);
  const longitudeWidth = TAU / width;
  const latitudeHeight = Math.PI / height;
  let totalAreaKm2 = 0;

  for (let y = 0; y < height; y += 1) {
    const north = Math.PI / 2 - y * latitudeHeight;
    const south = north - latitudeHeight;
    const latitude = (north + south) / 2;
    const rowArea = sphericalCellAreaKm2(longitudeWidth, south, north, radiusKm);
    rowLatitudes[y] = latitude;

    for (let x = 0; x < width; x += 1) {
      const longitude = -Math.PI + (x + 0.5) * longitudeWidth;
      const center = latLonToUnit(latitude, longitude);
      const index = y * width + x;
      const offset = index * 3;
      centers[offset] = center[0];
      centers[offset + 1] = center[1];
      centers[offset + 2] = center[2];
      cellAreasKm2[index] = rowArea;
      totalAreaKm2 += rowArea;
    }
  }

  return { width, height, radiusKm, centers, cellAreasKm2, rowLatitudes, totalAreaKm2 };
}

export function cellCenter(geometry: SphericalRasterGeometry, index: number): Vec3 {
  if (!Number.isInteger(index) || index < 0 || index >= geometry.width * geometry.height) {
    throw new Error("cell index is outside the raster");
  }
  const offset = index * 3;
  return [geometry.centers[offset], geometry.centers[offset + 1], geometry.centers[offset + 2]];
}

export function wrappedLongitudeDeltaRadians(a: number, b: number): number {
  let delta = a - b;
  while (delta > Math.PI) delta -= TAU;
  while (delta < -Math.PI) delta += TAU;
  return delta;
}
