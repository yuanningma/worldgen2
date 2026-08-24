import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { evaluateTectonicWorld } from "../lib/evaluation/index.ts";
import { renderTectonicAtlasSvg, type TectonicAtlasOptions } from "../lib/tectonics/atlasSvg.ts";
import { simulateTectonicWorld } from "../lib/tectonics/index.ts";

interface SharpPipeline {
  png(): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  composite(layers: readonly { input: Buffer; left: number; top: number }[]): SharpPipeline;
  toFile(path: string): Promise<unknown>;
}

type SharpFactory = ((input: Buffer | { create: {
  width: number;
  height: number;
  channels: 4;
  background: string;
} }) => SharpPipeline);

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

const projection = option("projection") ?? "mollweide";
if (projection !== "mollweide" && projection !== "equal-earth" && projection !== "equirectangular") {
  throw new RangeError("--projection must be mollweide, equal-earth, or equirectangular");
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/atlas-growth-a-h-contact-sheet.png");
const subdivisions = Math.round(numberOption("subdivisions", 4));
const cardWidth = Math.round(numberOption("card-width", 1024));
const cardMapHeight = Math.round(cardWidth / 2);
const rasterWidth = Math.round(numberOption("raster-width", Math.min(768, cardWidth)));
const gap = 12;
const columns = 2;
const rows = 4;
const cardHeight = cardMapHeight + 160;
const seeds = Array.from({ length: 8 }, (_, index) => `ATLAS-GROWTH-${String.fromCharCode(65 + index)}`);

const cards: Buffer[] = [];
const summaries: string[] = [];
for (const seed of seeds) {
  const model = simulateTectonicWorld({ seed, subdivisions });
  const report = evaluateTectonicWorld(model, {
    width: 240,
    height: 120,
    morphology: { scalesKm: [800, 1200, 1800] },
  });
  const status = report.accepted ? "PASS" : "REJECT";
  const title = `${seed} · ${status} · SCORE ${report.selectionScore.toFixed(2)} · MAJOR ${report.morphology.majorComponentCount}`;
  const options: TectonicAtlasOptions = {
    width: cardWidth,
    height: cardMapHeight,
    rasterWidth,
    projection,
    showBoundaries: false,
    showGraticule: true,
    smoothInterior: true,
    title,
  };
  const svg = renderTectonicAtlasSvg(model, options);
  cards.push(await image(Buffer.from(svg)).png().toBuffer());
  summaries.push([
    seed,
    status,
    `score ${report.selectionScore.toFixed(3)}`,
    `major ${report.morphology.majorComponentCount}`,
    `elong ${report.morphology.maximumMajorElongation.toFixed(2)}`,
    `coast ${report.morphology.coastlineRichness.toFixed(2)}`,
  ].join(" · "));
}

const sheetWidth = columns * cardWidth + (columns + 1) * gap;
const sheetHeight = rows * cardHeight + (rows + 1) * gap;
const layers = cards.map((input, index) => ({
  input,
  left: gap + (index % columns) * (cardWidth + gap),
  top: gap + Math.floor(index / columns) * (cardHeight + gap),
}));

await mkdir(dirname(output), { recursive: true });
await image({
  create: {
    width: sheetWidth,
    height: sheetHeight,
    channels: 4,
    background: "#020b11",
  },
}).composite(layers).png().toFile(output);

process.stdout.write(`${output}\n${summaries.join("\n")}\n`);
