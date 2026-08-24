import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  compareMorphologyRefinement,
  evaluateSphericalLandMask,
} from "../lib/evaluation/index.ts";
import { createSurfaceRefinement } from "../lib/tectonics/surfaceRefinement.ts";
import {
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
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

function color(isLand: boolean, elevationKm: number, waterDepthKm: number): readonly [number, number, number] {
  if (!isLand) {
    const depth = clamp(waterDepthKm / 7);
    return depth < 0.25
      ? mix([56, 135, 158], [18, 73, 111], depth / 0.25)
      : mix([18, 73, 111], [4, 24, 51], (depth - 0.25) / 0.75);
  }
  const raised = Math.max(0, elevationKm);
  if (raised < 0.25) return mix([193, 181, 111], [104, 151, 82], raised / 0.25);
  if (raised < 2.5) return mix([104, 151, 82], [126, 113, 82], (raised - 0.25) / 2.25);
  if (raised < 5.5) return mix([126, 113, 82], [185, 177, 163], (raised - 2.5) / 3);
  return mix([185, 177, 163], [246, 246, 239], (raised - 5.5) / 4);
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

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/refined-surface-preview-2k.png");
const width = Math.max(512, Math.round(numberOption("width", 2048)));
const height = Math.max(256, Math.round(numberOption("height", width / 2)));
const seed = option("seed") ?? "primeval-atlas-7";
const subdivisions = Math.round(numberOption("subdivisions", 5));
const movingMyr = numberOption("moving-myr", 0);
const modelOption = option("model") ?? (movingMyr === 0 ? "fixed" : "snapshot");
if (modelOption !== "fixed" && modelOption !== "snapshot" && modelOption !== "coupled") {
  throw new RangeError("--model must be fixed, snapshot, or coupled");
}
const recipe = {
  seed,
  subdivisions,
  radiusKm: numberOption("radius-km", 6371),
  plateCount: Math.round(numberOption("plates", 14)),
  historyMyr: numberOption("history-myr", 360),
  timestepMyr: numberOption("timestep-myr", 2),
  oceanFraction: numberOption("ocean-fraction", 0.68),
};
const model = modelOption === "coupled"
  ? simulateCoupledTectonicWorld(recipe)
  : modelOption === "snapshot"
    ? simulateMovingCrustSnapshot(recipe, movingMyr)
    : simulateTectonicWorld(recipe);
const modelLabel = modelOption === "coupled"
  ? `${model.recipe.historyMyr} MYR COUPLED HISTORY`
  : modelOption === "snapshot"
    ? `${movingMyr} MYR MOVING SNAPSHOT`
    : "FIXED REFERENCE";
const refinement = createSurfaceRefinement(model, {
  coastAmplitude: numberOption("coast-amplitude", 0.21),
  coastalBand: numberOption("coastal-band", 0.34),
  reliefPasses: numberOption("relief-passes", 3),
});
const audit = refinement.audit();
if (!audit.topologyAnchorsPreserved) throw new Error(`surface topology audit failed: ${JSON.stringify(audit)}`);

const pixels = Buffer.allocUnsafe(width * height * 4);
const canonicalLand = new Uint8Array(width * height);
const refinedLand = new Uint8Array(width * height);
for (let y = 0; y < height; y += 1) {
  const latitude = Math.PI / 2 - (y + 0.5) / height * Math.PI;
  const radial = Math.cos(latitude);
  for (let x = 0; x < width; x += 1) {
    const longitude = (x + 0.5) / width * Math.PI * 2 - Math.PI;
    const sample = refinement.sample([
      radial * Math.cos(longitude),
      radial * Math.sin(longitude),
      Math.sin(latitude),
    ]);
    const rgb = color(sample.isLand, sample.elevationKm - model.seaLevelKm, sample.waterDepthKm);
    const maskIndex = y * width + x;
    canonicalLand[maskIndex] = sample.canonicalIsLand ? 1 : 0;
    refinedLand[maskIndex] = sample.isLand ? 1 : 0;
    const index = (y * width + x) * 4;
    pixels[index] = rgb[0];
    pixels[index + 1] = rgb[1];
    pixels[index + 2] = rgb[2];
    pixels[index + 3] = 255;
  }
  if (y > 0 && y % 128 === 0) process.stdout.write(`sampled ${y}/${height} rows\n`);
}

const morphologyOptions = { scalesKm: [50, 80, 120, 180, 300] };
const coarseMorphology = evaluateSphericalLandMask({
  width,
  height,
  radiusKm: model.recipe.radiusKm,
  land: canonicalLand,
}, morphologyOptions);
const refinedMorphology = evaluateSphericalLandMask({
  width,
  height,
  radiusKm: model.recipe.radiusKm,
  land: refinedLand,
}, morphologyOptions);
const comparison = compareMorphologyRefinement(coarseMorphology, refinedMorphology);
if (!comparison.passed) {
  throw new Error(`morphology refinement gate failed: ${JSON.stringify(comparison)}`);
}

const headerHeight = 88;
const map = await image(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
const header = Buffer.from([
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${headerHeight}">`,
  `<rect width="100%" height="100%" fill="#06141d"/>`,
  `<text x="24" y="31" fill="#e3ebe8" font-family="monospace" font-size="18" font-weight="700" letter-spacing="1.5">TOPOLOGY-SAFE REFINED SURFACE · ${escapeXml(seed)}</text>`,
  `<text x="24" y="58" fill="#93a8ad" font-family="monospace" font-size="11">${width}×${height} · SUB${subdivisions} · ${modelLabel} · ${model.cells.length.toLocaleString("en-US")} CANONICAL CELLS · ${(model.stats.landFraction * 100).toFixed(1)}% LAND · RICHNESS +${comparison.coastlineRichnessGain.toFixed(3)} · 0 ANCHOR CHANGES</text>`,
  `</svg>`,
].join(""));

await mkdir(dirname(output), { recursive: true });
await image({
  create: { width, height: height + headerHeight, channels: 4, background: "#06141d" },
}).composite([
  { input: header, left: 0, top: 0 },
  { input: map, left: 0, top: headerHeight },
]).png().toFile(output);

process.stdout.write(`${output}\n${JSON.stringify({ audit, comparison })}\n`);
