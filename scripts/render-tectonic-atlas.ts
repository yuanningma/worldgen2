import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderTectonicAtlasSvg } from "../lib/tectonics/atlasSvg.ts";
import {
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
  simulateTectonicWorld,
} from "../lib/tectonics/index.ts";

type SharpFactory = (input: Buffer) => { png(): { toFile(path: string): Promise<unknown> } };
const renderPng = sharp as unknown as SharpFactory;

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, fallback: number): number {
  const value = option(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`--${name} must be a finite number`);
  return parsed;
}

function booleanOption(name: string, fallback: boolean): boolean {
  const value = option(name);
  if (value === undefined) return fallback;
  if (["true", "1", "on", "yes"].includes(value.toLowerCase())) return true;
  if (["false", "0", "off", "no"].includes(value.toLowerCase())) return false;
  throw new RangeError(`--${name} must be true or false`);
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/world-atlas.svg");
const projectionOption = option("projection") ?? "mollweide";
if (projectionOption !== "mollweide" && projectionOption !== "equal-earth" && projectionOption !== "equirectangular") {
  throw new RangeError("--projection must be mollweide, equal-earth, or equirectangular");
}
const movingMyr = numberOption("moving-myr", 0);
const modelOption = option("model") ?? (movingMyr === 0 ? "fixed" : "snapshot");
if (modelOption !== "fixed" && modelOption !== "snapshot" && modelOption !== "coupled") {
  throw new RangeError("--model must be fixed, snapshot, or coupled");
}
const recipe = {
  seed: option("seed") ?? "ATLAS-TECTONIC-11",
  subdivisions: numberOption("subdivisions", 4),
  radiusKm: numberOption("radius-km", 6371),
  plateCount: numberOption("plates", 14),
  historyMyr: numberOption("history-myr", 360),
  timestepMyr: numberOption("timestep-myr", 2),
  oceanFraction: numberOption("ocean-fraction", 0.68),
};
const model = modelOption === "coupled"
  ? simulateCoupledTectonicWorld(recipe)
  : modelOption === "snapshot"
    ? simulateMovingCrustSnapshot(recipe, movingMyr)
    : simulateTectonicWorld(recipe);
const svg = renderTectonicAtlasSvg(model, {
  width: numberOption("width", 2048),
  rasterWidth: numberOption("raster-width", 1024),
  showBoundaries: booleanOption("boundaries", false),
  showGraticule: booleanOption("graticule", true),
  title: option("title"),
  projection: projectionOption,
  smoothInterior: booleanOption("smooth-interior", extname(output).toLowerCase() === ".png"),
});
await mkdir(dirname(output), { recursive: true });
if (extname(output).toLowerCase() === ".png") {
  await renderPng(Buffer.from(svg)).png().toFile(output);
} else if (extname(output).toLowerCase() === ".svg") {
  await writeFile(output, svg, "utf8");
} else {
  throw new RangeError("--output must end in .svg or .png");
}
process.stdout.write([
  output,
  `${model.cells.length.toLocaleString("en-US")} cells`,
  `${model.plates.length} plates`,
  `${(model.stats.landFraction * 100).toFixed(1)}% land`,
  modelOption === "snapshot" ? `${movingMyr} Myr moving snapshot` : `${modelOption} history`,
].join(" · ") + "\n");
