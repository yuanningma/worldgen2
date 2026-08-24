import { createSphericalRasterGeometry, wrappedLongitudeDeltaRadians } from "../spherical/geometry.ts";
import type { SphericalLandMask } from "./sphericalLandmassMetrics.ts";

export interface FixtureResolution {
  readonly width?: number;
  readonly height?: number;
  readonly radiusKm?: number;
}

export type FixturePredicate = (latitudeRadians: number, longitudeRadians: number) => boolean;

const DEGREES = Math.PI / 180;

function fixtureSettings(options: FixtureResolution): Required<FixtureResolution> {
  return {
    width: options.width ?? 360,
    height: options.height ?? 180,
    radiusKm: options.radiusKm ?? 6_371,
  };
}

export function rasterizeSphericalFixture(
  predicate: FixturePredicate,
  options: FixtureResolution = {},
): SphericalLandMask {
  const { width, height, radiusKm } = fixtureSettings(options);
  const geometry = createSphericalRasterGeometry(width, height, radiusKm);
  const land = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const latitude = geometry.rowLatitudes[y];
    for (let x = 0; x < width; x += 1) {
      const longitude = -Math.PI + (x + 0.5) * Math.PI * 2 / width;
      if (predicate(latitude, longitude)) land[y * width + x] = 1;
    }
  }
  return { width, height, radiusKm, land };
}

function localDegrees(latitude: number, longitude: number): readonly [number, number] {
  return [wrappedLongitudeDeltaRadians(longitude, 0) / DEGREES, latitude / DEGREES];
}

export function createCompactContinentFixture(options: FixtureResolution = {}): SphericalLandMask {
  const radiusDegrees = 28;
  return rasterizeSphericalFixture((latitude, longitude) => {
    const centralAngle = Math.acos(Math.max(-1, Math.min(1,
      Math.cos(latitude) * Math.cos(longitude))));
    return centralAngle <= radiusDegrees * DEGREES;
  }, options);
}

/**
 * Compact at the world scale, but with persistent capes, peninsulas, and open
 * bays at several hundred-kilometer scales. It is a morphology fixture, not a
 * reconstruction or redistributed reference-map outline.
 */
export function createLobedContinentFixture(options: FixtureResolution = {}): SphericalLandMask {
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    const core = (x / 31) ** 2 + (y / 25) ** 2 <= 1;
    const lobes = [
      Math.hypot(x - 28, y - 7) <= 13,
      Math.hypot(x - 20, y + 22) <= 11,
      Math.hypot(x + 25, y + 18) <= 12,
      Math.hypot(x + 29, y - 9) <= 10,
      Math.hypot(x - 4, y - 29) <= 9,
    ].some(Boolean);
    if (!core && !lobes) return false;
    // Every cut intersects the exterior, so these remain bays rather than lakes.
    const openBays = [
      Math.hypot(x - 34, y + 7) <= 10,
      Math.hypot(x + 31, y - 2) <= 8,
      Math.hypot(x - 9, y - 31) <= 7,
    ].some(Boolean);
    return !openBays;
  }, options);
}

export function createNoisyRibbonFixture(options: FixtureResolution = {}): SphericalLandMask {
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    const halfLength = 74;
    const distancePastEnd = Math.max(0, Math.abs(x) - halfLength);
    const longitudinal = Math.min(halfLength, Math.max(-halfLength, x));
    const fineBoundary = 7.2
      + 2.1 * Math.sin(longitudinal * 0.72)
      + 1.15 * Math.sin(longitudinal * 1.91 + 0.6);
    return Math.hypot(distancePastEnd, Math.abs(y)) <= Math.max(2.5, fineBoundary);
  }, options);
}

function createRibbonWithHalfWidth(
  halfWidthDegrees: number,
  options: FixtureResolution,
  centralHalfLength = 72,
): SphericalLandMask {
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    if (Math.abs(x) <= centralHalfLength) return Math.abs(y) <= halfWidthDegrees;
    const endDistance = Math.hypot(Math.abs(x) - centralHalfLength, y);
    return endDistance <= halfWidthDegrees;
  }, options);
}

function maskAreaKm2(mask: SphericalLandMask): number {
  const geometry = createSphericalRasterGeometry(mask.width, mask.height, mask.radiusKm);
  let area = 0;
  for (let index = 0; index < mask.land.length; index += 1) {
    if (mask.land[index] !== 0) area += geometry.cellAreasKm2[index];
  }
  return area;
}

/** Returns a compact spherical cap and a ribbon calibrated to the same raster-weighted area. */
export function createEqualAreaCompactAndRibbonFixtures(
  options: FixtureResolution = {},
): readonly [SphericalLandMask, SphericalLandMask] {
  const settings = fixtureSettings(options);
  const compact = createCompactContinentFixture(settings);
  const targetArea = maskAreaKm2(compact);
  let lower = 1;
  let upper = 20;
  let ribbon = createRibbonWithHalfWidth((lower + upper) / 2, settings);
  let closestRibbon = ribbon;
  let closestHalfWidth = (lower + upper) / 2;
  let closestError = Math.abs(maskAreaKm2(ribbon) - targetArea);
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    ribbon = createRibbonWithHalfWidth(midpoint, settings);
    const area = maskAreaKm2(ribbon);
    const error = Math.abs(area - targetArea);
    if (error < closestError) {
      closestRibbon = ribbon;
      closestHalfWidth = midpoint;
      closestError = error;
    }
    if (area < targetArea) lower = midpoint;
    else upper = midpoint;
  }
  lower = 48;
  upper = 96;
  for (let iteration = 0; iteration < 16; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    ribbon = createRibbonWithHalfWidth(closestHalfWidth, settings, midpoint);
    const area = maskAreaKm2(ribbon);
    const error = Math.abs(area - targetArea);
    if (error < closestError) {
      closestRibbon = ribbon;
      closestError = error;
    }
    if (area < targetArea) lower = midpoint;
    else upper = midpoint;
  }
  return [compact, closestRibbon];
}

export function createDumbbellFixture(
  bridgeHalfWidthDegrees: number,
  options: FixtureResolution = {},
): SphericalLandMask {
  if (!(bridgeHalfWidthDegrees > 0 && bridgeHalfWidthDegrees < 20)) {
    throw new Error("bridgeHalfWidthDegrees must be between 0 and 20");
  }
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    const left = Math.hypot(x + 31, y) <= 24;
    const right = Math.hypot(x - 31, y) <= 24;
    const bridge = Math.abs(x) <= 31 && Math.abs(y) <= bridgeHalfWidthDegrees;
    return left || right || bridge;
  }, options);
}

export function createCShapedGulfFixture(
  mouthHalfWidthDegrees: number,
  options: FixtureResolution = {},
): SphericalLandMask {
  if (!(mouthHalfWidthDegrees > 0 && mouthHalfWidthDegrees < 18)) {
    throw new Error("mouthHalfWidthDegrees must be between 0 and 18");
  }
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    const radialDistance = Math.hypot(x, y);
    if (radialDistance > 42) return false;
    if (radialDistance < 21) return false;
    const openMouth = x >= 0 && Math.abs(y) < mouthHalfWidthDegrees;
    return !openMouth;
  }, options);
}

export function createEnclosedLakeFixture(options: FixtureResolution = {}): SphericalLandMask {
  return rasterizeSphericalFixture((latitude, longitude) => {
    const [x, y] = localDegrees(latitude, longitude);
    const radialDistance = Math.hypot(x, y);
    return radialDistance <= 42 && radialDistance >= 21;
  }, options);
}
