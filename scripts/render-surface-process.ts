import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  createSurfaceProcessWorld,
  type SurfaceBiome,
  type SurfaceLithology,
} from "../lib/tectonics/surfaceProcess.ts";
import type { OrogenRegime } from "../lib/tectonics/orogeny.ts";
import {
  naturalSurfaceColor,
  type SurfacePresentationStyle,
} from "../lib/tectonics/surfaceStyle.ts";
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

const MAP_MODES = [
  "natural",
  "heightmap",
  "climate",
  "biomes",
  "precipitation",
  "aridity",
  "temperature",
  "continentality",
  "drainage",
  "depressions",
  "geomorphology",
  "coasts",
  "wind",
  "lithology",
  "orogeny",
] as const;

type SurfaceMapMode = typeof MAP_MODES[number];

const LITHOLOGY_TINTS: Readonly<Record<SurfaceLithology, readonly [number, number, number]>> = {
  "oceanic-basalt": [78, 103, 111],
  crystalline: [124, 142, 112],
  metamorphic: [154, 130, 112],
  volcanic: [103, 116, 99],
  carbonate: [188, 181, 137],
  sedimentary: [169, 153, 112],
};

const BIOME_COLORS: Readonly<Record<SurfaceBiome, readonly [number, number, number]>> = {
  "open-ocean": [29, 67, 111],
  "shelf-sea": [65, 127, 170],
  "sea-ice": [217, 232, 232],
  "freshwater-lake": [73, 145, 184],
  "ice-cap": [241, 242, 235],
  alpine: [183, 181, 169],
  tundra: [170, 179, 151],
  "boreal-forest": [74, 112, 89],
  "cold-steppe": [166, 160, 108],
  desert: [218, 190, 118],
  "temperate-grassland": [157, 177, 93],
  "temperate-forest": [91, 142, 80],
  "temperate-rainforest": [51, 113, 76],
  savanna: [185, 166, 77],
  "tropical-seasonal-forest": [71, 137, 67],
  "tropical-rainforest": [35, 101, 58],
};

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arguments_ = process.argv.slice(2);
  const inline = arguments_.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = arguments_.indexOf(`--${name}`);
  return index >= 0 ? arguments_[index + 1] : undefined;
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

function hsvToRgb(hue: number, saturation: number, value: number): readonly [number, number, number] {
  const h = ((hue % 1) + 1) % 1 * 6;
  const sector = Math.floor(h);
  const chroma = value * saturation;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  const offset = value - chroma;
  const rgb = sector === 0 ? [chroma, x, 0]
    : sector === 1 ? [x, chroma, 0]
      : sector === 2 ? [0, chroma, x]
        : sector === 3 ? [0, x, chroma]
          : sector === 4 ? [x, 0, chroma]
            : [chroma, 0, x];
  return rgb.map((channel) => Math.round((channel + offset) * 255)) as unknown as readonly [number, number, number];
}

function climateBucketColor(
  isLand: boolean,
  temperatureC: number,
  precipitationMPerYear: number,
): readonly [number, number, number] {
  if (!isLand) return [42, 93, 126];
  if (temperatureC < -12) return [235, 239, 232];
  if (temperatureC < 1) return precipitationMPerYear < 0.42 ? [189, 190, 166] : [140, 164, 143];
  if (precipitationMPerYear < 0.3) return [222, 190, 115];
  if (precipitationMPerYear < 0.58) return temperatureC > 18 ? [196, 166, 91] : [174, 168, 104];
  if (temperatureC > 20 && precipitationMPerYear > 1.5) return [44, 112, 65];
  if (temperatureC > 14 && precipitationMPerYear > 0.95) return [75, 135, 78];
  if (temperatureC < 7) return [111, 143, 115];
  return [126, 158, 88];
}

function color(
  mapMode: SurfaceMapMode,
  presentationStyle: SurfacePresentationStyle,
  isLand: boolean,
  isLake: boolean,
  elevationAboveSeaKm: number,
  coastDistanceKm: number,
  temperatureC: number,
  seasonalTemperatureRangeC: number,
  precipitationMPerYear: number,
  aridityIndex: number,
  drainageAreaKm2: number,
  fillDepthKm: number,
  spillwayIncisionKm: number,
  hillslopeChangeKm: number,
  valleyIncisionKm: number,
  coastalRuggedness: number,
  coastalSedimentAffinity: number,
  biome: SurfaceBiome,
  lithology: SurfaceLithology,
  erosionResistance: number,
  orogeny: OrogenRegime,
  orogenStrength: number,
  forelandBasinStrength: number,
  flexuralBulgeStrength: number,
  atmosphericMoisture: number,
  windEast: number,
  windNorth: number,
  shade: number,
  surfaceTexture: number,
): readonly [number, number, number] {
  if (mapMode === "heightmap") {
    const value = elevationAboveSeaKm < 0
      ? clamp(0.5 + elevationAboveSeaKm / 16, 0, 0.5)
      : clamp(0.5 + elevationAboveSeaKm / 12, 0.5, 1);
    const channel = Math.round(value * 255);
    return [channel, channel, channel];
  }
  if (mapMode === "temperature") {
    const normalized = clamp((temperatureC + 30) / 65);
    return normalized < 0.5
      ? mix([35, 75, 145], [229, 235, 218], normalized * 2)
      : mix([229, 235, 218], [183, 55, 39], (normalized - 0.5) * 2);
  }
  if (mapMode === "continentality") {
    const normalized = clamp((seasonalTemperatureRangeC - 3) / 52);
    return normalized < 0.5
      ? mix([20, 14, 53], [158, 54, 128], normalized * 2)
      : mix([158, 54, 128], [248, 230, 152], (normalized - 0.5) * 2);
  }
  if (mapMode === "precipitation") {
    const normalized = clamp(Math.log1p(precipitationMPerYear * 2.2) / Math.log1p(4.8 * 2.2));
    return normalized < 0.45
      ? mix([191, 154, 91], [102, 165, 153], normalized / 0.45)
      : mix([102, 165, 153], [25, 62, 128], (normalized - 0.45) / 0.55);
  }
  if (mapMode === "aridity") {
    if (!isLand || isLake) return [247, 248, 244];
    const normalized = clamp(aridityIndex / 2.25);
    return normalized < 0.45
      ? mix([142, 91, 34], [239, 226, 186], normalized / 0.45)
      : mix([239, 226, 186], [17, 105, 88], (normalized - 0.45) / 0.55);
  }
  if (mapMode === "drainage") {
    if (!isLand) return [246, 248, 246];
    if (isLake) return BIOME_COLORS["freshwater-lake"];
    const normalized = clamp((Math.log10(Math.max(100, drainageAreaKm2)) - 2) / 5.4);
    return normalized < 0.48
      ? mix([241, 247, 248], [151, 210, 232], normalized / 0.48)
      : mix([151, 210, 232], [18, 72, 138], (normalized - 0.48) / 0.52);
  }
  if (mapMode === "depressions") {
    if (!isLand) return [238, 243, 242];
    if (spillwayIncisionKm > 0.001) {
      return mix(
        [236, 183, 94],
        [178, 48, 35],
        clamp(Math.sqrt(spillwayIncisionKm / 0.55)),
      );
    }
    if (isLake) return [50, 119, 177];
    if (fillDepthKm > 0.005) {
      return mix([218, 213, 223], [95, 61, 126], clamp(Math.sqrt(fillDepthKm / 0.8)));
    }
    return [226, 228, 213];
  }
  if (mapMode === "geomorphology") {
    if (!isLand) return [44, 65, 74];
    if (valleyIncisionKm > 0.002) {
      return mix(
        [143, 183, 190],
        [31, 83, 133],
        clamp(Math.sqrt(valleyIncisionKm / 0.22)),
      );
    }
    if (hillslopeChangeKm < -0.00005) {
      return mix(
        [211, 207, 190],
        [176, 91, 63],
        clamp(Math.sqrt(-hillslopeChangeKm / 0.08)),
      );
    }
    if (hillslopeChangeKm > 0.00005) {
      return mix(
        [211, 207, 190],
        [92, 142, 92],
        clamp(Math.sqrt(hillslopeChangeKm / 0.08)),
      );
    }
    return [211, 207, 190];
  }
  if (mapMode === "coasts") {
    if (coastDistanceKm > 180) return isLand ? [220, 218, 202] : [43, 65, 77];
    const coastFade = 1 - clamp(coastDistanceKm / 180);
    if (isLand) {
      const character = coastalRuggedness >= coastalSedimentAffinity
        ? mix([214, 210, 193], [123, 80, 68], coastalRuggedness)
        : mix([214, 210, 193], [194, 164, 91], coastalSedimentAffinity);
      return mix([220, 218, 202], character, coastFade);
    }
    return mix([43, 65, 77], [91, 139, 149], coastFade * coastalSedimentAffinity);
  }
  if (mapMode === "wind") {
    const angle = Math.atan2(windNorth, windEast);
    return hsvToRgb(angle / (Math.PI * 2) + 0.5, 0.68, 0.52 + atmosphericMoisture * 0.34);
  }
  if (mapMode === "climate") {
    if (isLake) return BIOME_COLORS["freshwater-lake"];
    return climateBucketColor(isLand, temperatureC, precipitationMPerYear);
  }
  if (mapMode === "biomes") {
    return BIOME_COLORS[biome];
  }
  if (mapMode === "lithology") {
    const base = LITHOLOGY_TINTS[lithology];
    const thematicShade = isLand ? clamp(shade, 0.82, 1.12) : 0.72;
    return base.map((channel) => Math.round(clamp(channel * thematicShade, 0, 255))) as unknown as readonly [number, number, number];
  }
  if (mapMode === "orogeny") {
    if (!isLand) return [28, 53, 71];
    const regimeColors: Readonly<Record<OrogenRegime, readonly [number, number, number]>> = {
      none: [202, 210, 189],
      collision: [168, 52, 42],
      subduction: [221, 121, 47],
      "island-arc": [123, 85, 166],
      suture: [135, 103, 70],
    };
    const basin = mix(
      [202, 210, 189],
      [64, 127, 157],
      clamp(forelandBasinStrength * 1.18),
    );
    const flexure = mix(basin, [205, 171, 77], clamp(flexuralBulgeStrength * 0.82));
    return mix(flexure, regimeColors[orogeny], clamp(orogenStrength * 1.1));
  }
  return naturalSurfaceColor(presentationStyle, {
    isLand,
    isLake,
    elevationAboveSeaKm,
    coastDistanceKm,
    temperatureC,
    precipitationMPerYear,
    lithology,
    erosionResistance,
    shade,
    surfaceTexture,
  });
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

function blendPixel(
  pixels: Buffer,
  width: number,
  height: number,
  x: number,
  y: number,
  alpha: number,
  ink: readonly [number, number, number] = [32, 103, 151],
): void {
  const wrappedX = ((x % width) + width) % width;
  if (y < 0 || y >= height || alpha <= 0) return;
  const index = (y * width + wrappedX) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round(pixels[index + channel] * (1 - alpha) + ink[channel] * alpha);
  }
}

function drawMarker(
  pixels: Buffer,
  width: number,
  height: number,
  center: readonly [number, number],
  radius: number,
  ink: readonly [number, number, number],
): void {
  const minimumX = Math.floor(center[0] - radius);
  const maximumX = Math.ceil(center[0] + radius);
  const minimumY = Math.floor(center[1] - radius);
  const maximumY = Math.ceil(center[1] + radius);
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const distance = Math.hypot(x + 0.5 - center[0], y + 0.5 - center[1]);
      if (distance > radius + 0.75) continue;
      blendPixel(pixels, width, height, x, y, clamp(radius + 0.75 - distance), ink);
    }
  }
}

function drawAntiAliasedSegment(
  pixels: Buffer,
  width: number,
  height: number,
  from: readonly [number, number],
  to: readonly [number, number],
  strength: number,
  ink?: readonly [number, number, number],
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
    blendPixel(pixels, width, height, ix, iy, (1 - fx) * (1 - fy) * strength, ink);
    blendPixel(pixels, width, height, ix + 1, iy, fx * (1 - fy) * strength, ink);
    blendPixel(pixels, width, height, ix, iy + 1, (1 - fx) * fy * strength, ink);
    blendPixel(pixels, width, height, ix + 1, iy + 1, fx * fy * strength, ink);
  }
}

function unwrapX(x: number, reference: number, width: number): number {
  let result = x;
  while (result - reference > width / 2) result -= width;
  while (result - reference < -width / 2) result += width;
  return result;
}

function drawRiverCurve(
  pixels: Buffer,
  width: number,
  height: number,
  previous: readonly [number, number] | null,
  from: readonly [number, number],
  to: readonly [number, number],
  next: readonly [number, number] | null,
  strength: number,
  ink: readonly [number, number, number],
): void {
  const p1: readonly [number, number] = from;
  const p2: readonly [number, number] = [unwrapX(to[0], p1[0], width), to[1]];
  const p0: readonly [number, number] = previous
    ? [unwrapX(previous[0], p1[0], width), previous[1]]
    : [p1[0] * 2 - p2[0], p1[1] * 2 - p2[1]];
  const p3: readonly [number, number] = next
    ? [unwrapX(next[0], p2[0], width), next[1]]
    : [p2[0] * 2 - p1[0], p2[1] * 2 - p1[1]];
  const tangentScale = 0.34;
  const m1: readonly [number, number] = [
    (p2[0] - p0[0]) * tangentScale,
    (p2[1] - p0[1]) * tangentScale,
  ];
  const m2: readonly [number, number] = [
    (p3[0] - p1[0]) * tangentScale,
    (p3[1] - p1[1]) * tangentScale,
  ];
  const steps = Math.max(3, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 1.5));
  let last = p1;
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const point: readonly [number, number] = [
      h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
      h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
    ];
    drawAntiAliasedSegment(pixels, width, height, last, point, strength, ink);
    last = point;
  }
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/surface-process-world.png");
const quality = option("quality") ?? "high";
if (!(quality in QUALITY_WIDTHS)) throw new RangeError("--quality must be preview, high, or ultra");
const mapModeOption = option("map-mode") ?? "natural";
if (!MAP_MODES.includes(mapModeOption as SurfaceMapMode)) {
  throw new RangeError(`--map-mode must be ${MAP_MODES.join(", ")}`);
}
const mapMode = mapModeOption as SurfaceMapMode;
const presentationStyleOption = option("style") ?? "atlas";
if (presentationStyleOption !== "atlas" && presentationStyleOption !== "relief") {
  throw new RangeError("--style must be atlas or relief");
}
const presentationStyle = presentationStyleOption as SurfacePresentationStyle;
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
const minimumRiverAreaKm2 = numberOption("minimum-river-area-km2", 220_000);
const depressionEvolutionOption = option("depression-evolution") ?? "hybrid";
if (depressionEvolutionOption !== "hybrid" && depressionEvolutionOption !== "fill-only") {
  throw new RangeError("--depression-evolution must be hybrid or fill-only");
}
const surface = createSurfaceProcessWorld(world, {
  subdivisions: surfaceSubdivisions,
  reliefAmplitudeKm: numberOption("relief-amplitude-km", 0.34),
  coastOctaves: numberOption("coast-octaves", 5),
  minimumRiverAreaKm2,
  erosionStrengthKm: numberOption("erosion-strength-km", 0.2),
  minimumErosionAreaKm2: numberOption("minimum-erosion-area-km2", 200_000),
  presentationSampleCount: numberOption("presentation-samples", 12),
  depressionEvolution: depressionEvolutionOption,
  spillwayErosionScale: numberOption("spillway-erosion-scale", 1),
  openWaterEvaporationScale: numberOption("open-water-evaporation-scale", 1.05),
  hillslopeDiffusionLengthKm: numberOption("hillslope-diffusion-length-km", 42),
  hillslopeDiffusionPasses: numberOption("hillslope-diffusion-passes", 4),
  valleyReliefScale: numberOption("valley-relief-scale", 1),
  channelRefinementScale: numberOption("channel-refinement-scale", 1),
  continentalReliefScale: numberOption("continental-relief-scale", 1),
  flexuralReliefScale: numberOption("flexural-relief-scale", 1),
  coastalGeomorphologyScale: numberOption("coastal-geomorphology-scale", 1),
});
const landRockTypeCount = Object.entries(surface.stats.lithologyAreaKm2)
  .filter(([lithology, area]) => lithology !== "oceanic-basalt" && area > 0)
  .length;
const coastSamples = Math.round(clamp(
  numberOption("coast-samples", width <= QUALITY_WIDTHS.high ? 2 : 1),
  1,
  4,
));

function renderColorAt(longitude: number, latitude: number): {
  readonly rgb: readonly [number, number, number];
  readonly coastDistanceKm: number;
  readonly isLand: boolean;
  readonly lakeCoverage: number;
} {
  const radial = Math.cos(latitude);
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
  const terrainShade = presentationStyle === "atlas"
    ? 1
    : cell.isLand
      ? clamp(0.99 - lightSlope * 10, 0.79, 1.15)
      : clamp(1 - lightSlope * 1.2, 0.96, 1.025);
  const windEast = cell.prevailingWind[0] * east[0]
    + cell.prevailingWind[1] * east[1]
    + cell.prevailingWind[2] * east[2];
  const windNorth = cell.prevailingWind[0] * north[0]
    + cell.prevailingWind[1] * north[1]
    + cell.prevailingWind[2] * north[2];
  return {
    rgb: color(
      mapMode,
      presentationStyle,
      cell.isLand,
      cell.isLake,
      cell.elevationKm - world.seaLevelKm,
      cell.coastDistanceKm,
      cell.temperatureC,
      cell.seasonalTemperatureRangeC,
      cell.precipitationMPerYear,
      cell.aridityIndex,
      cell.drainageAreaKm2,
      cell.fillDepthKm,
      cell.spillwayIncisionKm,
      cell.hillslopeChangeKm,
      cell.valleyIncisionKm,
      cell.coastalRuggedness,
      cell.coastalSedimentAffinity,
      cell.biome,
      cell.lithology,
      cell.erosionResistance,
      cell.orogeny,
      cell.orogenStrength,
      cell.forelandBasinStrength,
      cell.flexuralBulgeStrength,
      cell.atmosphericMoisture,
      windEast,
      windNorth,
      terrainShade,
      cell.surfaceTexture,
    ),
    coastDistanceKm: cell.coastDistanceKm,
    isLand: cell.isLand,
    lakeCoverage: cell.lakeCoverage,
  };
}

const pixels = Buffer.allocUnsafe(width * height * 4);
const landMask = new Uint8Array(width * height);
for (let y = 0; y < height; y += 1) {
  const latitude = Math.PI / 2 - (y + 0.5) / height * Math.PI;
  for (let x = 0; x < width; x += 1) {
    const longitude = (x + 0.5) / width * Math.PI * 2 - Math.PI;
    const center = renderColorAt(longitude, latitude);
    let rgb = center.rgb;
    const latitudeStep = Math.PI / height;
    const longitudeStep = Math.PI * 2 / width;
    const pixelRadiusKm = world.recipe.radiusKm * 0.5 * Math.hypot(
      latitudeStep,
      longitudeStep * Math.cos(latitude),
    );
    const nearLakeShore = center.lakeCoverage > 0.08 && center.lakeCoverage < 0.92;
    if (coastSamples > 1
      && (center.coastDistanceKm <= pixelRadiusKm * 1.45 || nearLakeShore)) {
      const sum = [0, 0, 0];
      for (let sampleY = 0; sampleY < coastSamples; sampleY += 1) {
        for (let sampleX = 0; sampleX < coastSamples; sampleX += 1) {
          const offsetX = (sampleX + 0.5) / coastSamples - 0.5;
          const offsetY = (sampleY + 0.5) / coastSamples - 0.5;
          const sample = renderColorAt(
            longitude + offsetX * longitudeStep,
            latitude - offsetY * latitudeStep,
          ).rgb;
          sum[0] += sample[0];
          sum[1] += sample[1];
          sum[2] += sample[2];
        }
      }
      const sampleCount = coastSamples ** 2;
      rgb = [
        Math.round(sum[0] / sampleCount),
        Math.round(sum[1] / sampleCount),
        Math.round(sum[2] / sampleCount),
      ];
    }
    const index = (y * width + x) * 4;
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
    pixels[index + 3] = 255;
    landMask[y * width + x] = center.isLand ? 1 : 0;
  }
  if (y > 0 && y % 128 === 0) process.stdout.write(`sampled ${y}/${height} rows\n`);
}

if (mapMode === "natural") {
  const coastInk: readonly [number, number, number] = presentationStyle === "atlas"
    ? [79, 91, 84]
    : [22, 43, 54];
  const coastStrength = presentationStyle === "atlas" ? 0.7 : 0.46;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (landMask[y * width + x] === 0) continue;
      const west = landMask[y * width + ((x - 1 + width) % width)] === 0;
      const east = landMask[y * width + ((x + 1) % width)] === 0;
      const north = y > 0 && landMask[(y - 1) * width + x] === 0;
      const south = y + 1 < height && landMask[(y + 1) * width + x] === 0;
      if (west || east || north || south) {
        blendPixel(pixels, width, height, x, y, coastStrength, coastInk);
      }
    }
  }
}

if (mapMode === "natural" || mapMode === "climate" || mapMode === "biomes" || mapMode === "lithology" || mapMode === "drainage" || mapMode === "depressions" || mapMode === "geomorphology" || mapMode === "coasts") {
  const outgoing = new Map<number, (typeof surface.rivers)[number]>();
  const dominantIncoming = new Map<number, (typeof surface.rivers)[number]>();
  for (const river of surface.rivers) {
    outgoing.set(river.fromFaceId, river);
    const incumbent = dominantIncoming.get(river.toFaceId);
    if (!incumbent || river.drainageAreaKm2 > incumbent.drainageAreaKm2) {
      dominantIncoming.set(river.toFaceId, river);
    }
  }
  for (const river of surface.rivers) {
    const previousRiver = dominantIncoming.get(river.fromFaceId);
    const nextRiver = outgoing.get(river.toFaceId);
    const previous = previousRiver
      ? longitudeLatitude(previousRiver.fromPoint, width, height)
      : null;
    const next = nextRiver
      ? longitudeLatitude(nextRiver.toPoint, width, height)
      : null;
    const strength = clamp(
      (presentationStyle === "atlas" ? 0.26 : 0.31)
        + Math.log2(Math.max(1, river.drainageAreaKm2 / minimumRiverAreaKm2))
        * (presentationStyle === "atlas" ? 0.065 : 0.078),
      presentationStyle === "atlas" ? 0.26 : 0.31,
      presentationStyle === "atlas" ? 0.68 : 0.78,
    );
    const riverInk: readonly [number, number, number] = presentationStyle === "atlas"
      ? [75, 121, 171]
      : [31, 92, 139];
    const projectedPath = river.path.map((point) => longitudeLatitude(point, width, height));
    for (let index = 0; index + 1 < projectedPath.length; index += 1) {
      drawRiverCurve(
        pixels,
        width,
        height,
        index > 0 ? projectedPath[index - 1] : previous,
        projectedPath[index],
        projectedPath[index + 1],
        index + 2 < projectedPath.length ? projectedPath[index + 2] : next,
        strength,
        riverInk,
      );
    }
  }
  for (const mouth of surface.riverMouths) {
    if (mouth.distributaries.length === 0) continue;
    const branchStrength = mouth.landform === "delta" ? 0.5 : 0.36;
    const branchInk: readonly [number, number, number] = presentationStyle === "atlas"
      ? [75, 121, 171]
      : [31, 92, 139];
    for (const branch of mouth.distributaries) {
      const projected = branch.map((point) => longitudeLatitude(point, width, height));
      for (let index = 0; index + 1 < projected.length; index += 1) {
        drawAntiAliasedSegment(
          pixels,
          width,
          height,
          projected[index],
          projected[index + 1],
          branchStrength,
          branchInk,
        );
      }
    }
  }
  if (mapMode === "coasts") {
    const landformColors = {
      delta: [45, 138, 91],
      estuary: [91, 91, 172],
      "alluvial-fan": [194, 104, 54],
      "simple-mouth": [70, 112, 133],
      "lake-inflow": [67, 135, 188],
    } as const;
    for (const mouth of surface.riverMouths) {
      drawMarker(
        pixels,
        width,
        height,
        longitudeLatitude(mouth.point, width, height),
        mouth.receivingWater === "ocean" ? 2.2 : 1.5,
        landformColors[mouth.landform],
      );
    }
  }
}

if (mapMode === "wind") {
  const spacing = Math.max(36, Math.round(width / 18));
  const arrowInk: readonly [number, number, number] = [245, 244, 228];
  for (let y = Math.round(spacing * 0.75); y < height - spacing * 0.5; y += spacing) {
    const latitude = Math.PI / 2 - (y + 0.5) / height * Math.PI;
    const radial = Math.cos(latitude);
    if (radial < 0.18) continue;
    for (let x = Math.round(spacing * 0.5); x < width; x += spacing) {
      const longitude = (x + 0.5) / width * Math.PI * 2 - Math.PI;
      const point: readonly [number, number, number] = [
        radial * Math.cos(longitude),
        radial * Math.sin(longitude),
        Math.sin(latitude),
      ];
      const sample = surface.sampleContinuous(point);
      const east: readonly [number, number, number] = [-Math.sin(longitude), Math.cos(longitude), 0];
      const north: readonly [number, number, number] = [
        -Math.sin(latitude) * Math.cos(longitude),
        -Math.sin(latitude) * Math.sin(longitude),
        Math.cos(latitude),
      ];
      const windEast = sample.prevailingWind[0] * east[0]
        + sample.prevailingWind[1] * east[1]
        + sample.prevailingWind[2] * east[2];
      const windNorth = sample.prevailingWind[0] * north[0]
        + sample.prevailingWind[1] * north[1]
        + sample.prevailingWind[2] * north[2];
      const magnitude = Math.max(1e-12, Math.hypot(windEast, windNorth));
      const dx = windEast / magnitude;
      const dy = -windNorth / magnitude;
      const length = spacing * (0.42 + sample.atmosphericMoisture * 0.14);
      const start: readonly [number, number] = [x - dx * length * 0.48, y - dy * length * 0.48];
      const end: readonly [number, number] = [x + dx * length * 0.48, y + dy * length * 0.48];
      drawAntiAliasedSegment(pixels, width, height, start, end, 0.78, arrowInk);
      const headLength = length * 0.25;
      const headWidth = headLength * 0.58;
      const headBaseX = end[0] - dx * headLength;
      const headBaseY = end[1] - dy * headLength;
      drawAntiAliasedSegment(pixels, width, height, end, [headBaseX - dy * headWidth, headBaseY + dx * headWidth], 0.78, arrowInk);
      drawAntiAliasedSegment(pixels, width, height, end, [headBaseX + dy * headWidth, headBaseY - dx * headWidth], 0.78, arrowInk);
    }
  }
}

const headerHeight = 94;
const map = await image(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const header = Buffer.from([
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${headerHeight}">`,
  `<rect width="100%" height="100%" fill="#071721"/>`,
  `<text x="24" y="32" fill="#e8ece4" font-family="monospace" font-size="18" font-weight="700" letter-spacing="1.4">${mapMode.toUpperCase()} MODE · ${escapeXml(seed)}</text>`,
  `<text x="24" y="61" fill="#9aadb0" font-family="monospace" font-size="11">${quality.toUpperCase()} ${width}×${height} · ${presentationStyle.toUpperCase()} STYLE · ${coupled ? "COUPLED" : "FIXED"} TECTONICS · SUB${subdivisions} → SURFACE SUB${surfaceSubdivisions} · ${world.stats.continentalTerraneCount} TERRANES · ${landRockTypeCount} ROCK TYPES · ${(surface.stats.landFraction * 100).toFixed(1)}% LAND</text>`,
  `<text x="24" y="80" fill="#688b94" font-family="monospace" font-size="10">SPHERICAL MOISTURE + LITHOLOGY-AWARE INCISION · ${surface.rivers.length.toLocaleString("en-US")} RIVERS · ${surface.stats.continentalReliefCenterCount} INTERIOR CENTERS · ${surface.stats.forelandBasinCellCount.toLocaleString("en-US")} FORELAND CELLS · ${surface.stats.lakeCellCount.toLocaleString("en-US")} LAKE CELLS · ${surface.stats.breachedBasinCount} BREACHED / ${surface.stats.preservedBasinCount} RETAINED BASINS · ${(surface.stats.aridLandFraction * 100).toFixed(0)}% ARID · ${(surface.stats.humidLandFraction * 100).toFixed(0)}% HUMID · ANCHOR CHANGES ${surface.stats.canonicalAnchorMismatches}</text>`,
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
