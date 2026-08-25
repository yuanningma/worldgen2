import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  createSurfaceProcessWorld,
  type SurfaceLithology,
} from "../lib/tectonics/surfaceProcess.ts";
import {
  simulateCoupledTectonicWorld,
  simulateTectonicWorld,
} from "../lib/tectonics/worldSimulation.ts";

interface SharpPipeline {
  png(): SharpPipeline;
  composite(layers: readonly { input: Buffer; left?: number; top?: number }[]): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  toFile(path: string): Promise<unknown>;
}

type SharpFactory = {
  (input: Buffer, options: { raw: { width: number; height: number; channels: 4 } }): SharpPipeline;
  (input: { create: { width: number; height: number; channels: 4; background: string } }): SharpPipeline;
};

const image = sharp as unknown as SharpFactory;

const QUALITY_WIDTHS = {
  preview: 2048,
  high: 4096,
  ultra: 8192,
} as const;

const LITHOLOGY_TINTS: Readonly<Record<SurfaceLithology, readonly [number, number, number]>> = {
  "oceanic-basalt": [78, 103, 111],
  crystalline: [124, 142, 112],
  metamorphic: [154, 130, 112],
  volcanic: [103, 116, 99],
  carbonate: [188, 181, 137],
  sedimentary: [169, 153, 112],
};

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new RangeError(`--${name} must be a finite number`);
  return parsed;
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(a: readonly number[], b: readonly number[], amount: number): readonly [number, number, number] {
  return a.map((value, index) => Math.round(value + (b[index] - value) * clamp(amount))) as unknown as readonly [number, number, number];
}

function color(
  isLand: boolean,
  elevationAboveSeaKm: number,
  coastDistanceKm: number,
  temperatureC: number,
  precipitationMPerYear: number,
  lithology: SurfaceLithology,
  erosionResistance: number,
  shade: number,
  surfaceTexture: number,
): readonly [number, number, number] {
  let base: readonly [number, number, number];
  if (!isLand) {
    const shelf = clamp(coastDistanceKm / 520);
    base = shelf < 0.42
      ? mix([128, 185, 207], [42, 108, 151], shelf / 0.42)
      : mix([42, 108, 151], [8, 32, 66], (shelf - 0.42) / 0.58);
  } else if (elevationAboveSeaKm > 4.8 || temperatureC < -13) {
    base = [238, 236, 220];
  } else if (elevationAboveSeaKm > 2.2) {
    base = mix([177, 139, 91], [216, 200, 169], (elevationAboveSeaKm - 2.2) / 2.6);
  } else if (precipitationMPerYear < 0.42 && temperatureC > 4) {
    base = [210, 181, 111];
  } else if (precipitationMPerYear > 1.55 && temperatureC > 2) {
    base = [74, 128, 76];
  } else if (temperatureC < 1) {
    base = [164, 177, 145];
  } else {
    base = [137, 166, 105];
  }
  if (isLand) {
    const snowOrIce = elevationAboveSeaKm > 4.8 || temperatureC < -13;
    base = mix(base, LITHOLOGY_TINTS[lithology], snowOrIce ? 0.045 : 0.14);
  }
  const textureShade = 1 + surfaceTexture
    * (isLand ? 0.021 + erosionResistance * 0.014 : 0.008);
  return base.map((channel) => Math.round(clamp(channel * shade * textureShade, 0, 255))) as unknown as readonly [number, number, number];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] as string);
}

function longitudeLatitude(point: readonly [number, number, number], width: number, height: number): readonly [number, number] {
  const longitude = Math.atan2(point[1], point[0]);
  const latitude = Math.asin(clamp(point[2], -1, 1));
  return [(longitude + Math.PI) / (Math.PI * 2) * width, (Math.PI / 2 - latitude) / Math.PI * height];
}

function blendPixel(pixels: Buffer, width: number, height: number, x: number, y: number, alpha: number): void {
  const wrappedX = ((x % width) + width) % width;
  if (y < 0 || y >= height || alpha <= 0) return;
  const index = (y * width + wrappedX) * 4;
  const river = [32, 103, 151];
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round(pixels[index + channel] * (1 - alpha) + river[channel] * alpha);
  }
}

function drawRiver(
  pixels: Buffer,
  width: number,
  height: number,
  from: readonly [number, number],
  to: readonly [number, number],
  strength: number,
): void {
  let x0 = from[0];
  const y0 = from[1];
  let x1 = to[0];
  const y1 = to[1];
  if (Math.abs(x1 - x0) > width / 2) {
    if (x0 < x1) x0 += width;
    else x1 += width;
  }
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.4));
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const x = x0 + (x1 - x0) * progress;
    const y = y0 + (y1 - y0) * progress;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    blendPixel(pixels, width, height, ix, iy, (1 - fx) * (1 - fy) * strength);
    blendPixel(pixels, width, height, ix + 1, iy, fx * (1 - fy) * strength);
    blendPixel(pixels, width, height, ix, iy + 1, (1 - fx) * fy * strength);
    blendPixel(pixels, width, height, ix + 1, iy + 1, fx * fy * strength);
  }
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/surface-process-world.png");
const quality = option("quality") ?? "high";
if (!(quality in QUALITY_WIDTHS)) throw new RangeError("--quality must be preview, high, or ultra");
const qualityWidth = QUALITY_WIDTHS[quality as keyof typeof QUALITY_WIDTHS];
const width = Math.max(512, Math.round(numberOption("width", qualityWidth)));
const height = Math.max(256, Math.round(numberOption("height", width / 2)));
const seed = option("seed") ?? "ATLAS-TECTONIC-35";
const subdivisions = Math.round(numberOption("subdivisions", 5));
const surfaceSubdivisions = Math.round(numberOption("surface-subdivisions", Math.min(7, subdivisions + 1)));
const coupled = (option("model") ?? "coupled") === "coupled";
const recipe = {
  seed,
  subdivisions,
  radiusKm: numberOption("radius-km", 6371),
  plateCount: Math.round(numberOption("plates", 14)),
  historyMyr: numberOption("history-myr", coupled ? 120 : 360),
  timestepMyr: numberOption("timestep-myr", 2),
  oceanFraction: numberOption("ocean-fraction", 0.68),
};
const world = coupled ? simulateCoupledTectonicWorld(recipe) : simulateTectonicWorld(recipe);
const surface = createSurfaceProcessWorld(world, {
  subdivisions: surfaceSubdivisions,
  reliefAmplitudeKm: numberOption("relief-amplitude-km", 0.34),
  coastOctaves: numberOption("coast-octaves", 5),
  minimumRiverAreaKm2: numberOption("minimum-river-area-km2", 650_000),
  erosionStrengthKm: numberOption("erosion-strength-km", 0.2),
  minimumErosionAreaKm2: numberOption("minimum-erosion-area-km2", 200_000),
  presentationSampleCount: numberOption("presentation-samples", 12),
});
const landRockTypeCount = Object.entries(surface.stats.lithologyAreaKm2)
  .filter(([lithology, area]) => lithology !== "oceanic-basalt" && area > 0)
  .length;

const pixels = Buffer.allocUnsafe(width * height * 4);
for (let y = 0; y < height; y += 1) {
  const latitude = Math.PI / 2 - (y + 0.5) / height * Math.PI;
  const radial = Math.cos(latitude);
  for (let x = 0; x < width; x += 1) {
    const longitude = (x + 0.5) / width * Math.PI * 2 - Math.PI;
    const point: readonly [number, number, number] = [
      radial * Math.cos(longitude),
      radial * Math.sin(longitude),
      Math.sin(latitude),
    ];
    const cell = surface.sampleContinuous(point);
    const east: readonly [number, number, number] = [-Math.sin(longitude), Math.cos(longitude), 0];
    const north: readonly [number, number, number] = [
      -Math.sin(latitude) * Math.cos(longitude),
      -Math.sin(latitude) * Math.sin(longitude),
      Math.cos(latitude),
    ];
    const lightSlope = cell.terrainGradient[0] * (east[0] * -0.58 + north[0] * 0.82)
      + cell.terrainGradient[1] * (east[1] * -0.58 + north[1] * 0.82)
      + cell.terrainGradient[2] * (east[2] * -0.58 + north[2] * 0.82);
    const terrainShade = cell.isLand
      ? clamp(0.98 - lightSlope * 13, 0.7, 1.2)
      : clamp(0.99 - lightSlope * 2.2, 0.92, 1.05);
    const rgb = color(
      cell.isLand,
      cell.elevationKm - world.seaLevelKm,
      cell.coastDistanceKm,
      cell.temperatureC,
      cell.precipitationMPerYear,
      cell.lithology,
      cell.erosionResistance,
      terrainShade,
      cell.surfaceTexture,
    );
    const index = (y * width + x) * 4;
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
    pixels[index + 3] = 255;
  }
  if (y > 0 && y % 128 === 0) process.stdout.write(`sampled ${y}/${height} rows\n`);
}

for (const river of surface.rivers) {
  const from = surface.sphere.faces[river.fromFaceId].center;
  const to = surface.sphere.faces[river.toFaceId].center;
  const strength = clamp(0.42 + Math.log2(Math.max(1, river.drainageAreaKm2 / 650_000)) * 0.1, 0.42, 0.88);
  drawRiver(pixels, width, height, longitudeLatitude(from, width, height), longitudeLatitude(to, width, height), strength);
}

const headerHeight = 94;
const map = await image(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const header = Buffer.from([
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${headerHeight}">`,
  `<rect width="100%" height="100%" fill="#071721"/>`,
  `<text x="24" y="32" fill="#e8ece4" font-family="monospace" font-size="18" font-weight="700" letter-spacing="1.4">SPHERICAL SURFACE PROCESSES · ${escapeXml(seed)}</text>`,
  `<text x="24" y="61" fill="#9aadb0" font-family="monospace" font-size="11">${quality.toUpperCase()} ${width}×${height} · ${coupled ? "COUPLED" : "FIXED"} TECTONICS · SUB${subdivisions} → SURFACE SUB${surfaceSubdivisions} · ${world.stats.continentalTerraneCount} TERRANES · ${landRockTypeCount} ROCK TYPES · ${(surface.stats.landFraction * 100).toFixed(1)}% LAND</text>`,
  `<text x="24" y="80" fill="#688b94" font-family="monospace" font-size="10">SPHERICAL MOISTURE TRANSPORT + LITHOLOGY-AWARE INCISION · ${surface.rivers.length.toLocaleString("en-US")} RIVERS · ${(surface.stats.aridLandFraction * 100).toFixed(0)}% ARID · ${(surface.stats.humidLandFraction * 100).toFixed(0)}% HUMID · SEDIMENT RESIDUAL ${surface.stats.sedimentResidualKm3.toExponential(2)} KM³ · ANCHOR CHANGES ${surface.stats.canonicalAnchorMismatches}</text>`,
  `</svg>`,
].join(""));

await mkdir(dirname(output), { recursive: true });
await image({
  create: { width, height: height + headerHeight, channels: 4, background: "#071721" },
}).composite([
  { input: header, left: 0, top: 0 },
  { input: map, left: 0, top: headerHeight },
]).png().toFile(output);
process.stdout.write(`${output}\n${JSON.stringify(surface.stats)}\n`);
