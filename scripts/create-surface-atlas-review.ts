import { mkdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

interface SharpPipeline {
  metadata(): Promise<{ width?: number; height?: number }>;
  extract(region: { left: number; top: number; width: number; height: number }): SharpPipeline;
  clone(): SharpPipeline;
  resize(options: { width: number; height: number; fit: "fill" }): SharpPipeline;
  composite(layers: readonly { input: Buffer; left: number; top: number }[]): SharpPipeline;
  png(): SharpPipeline;
  toBuffer(): Promise<Buffer>;
  toFile(path: string): Promise<unknown>;
}

type SharpFactory = {
  (input: string): SharpPipeline;
  (input: { create: { width: number; height: number; channels: 4; background: string } }): SharpPipeline;
};

const image = sharp as unknown as SharpFactory;

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
  if (!Number.isFinite(parsed) || parsed <= 0) throw new RangeError(`--${name} must be positive`);
  return Math.round(parsed);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(projectRoot, option("input") ?? "outputs/tectonics/surface-process-world.png");
const inputName = basename(input, extname(input));
const outputDirectory = resolve(
  projectRoot,
  option("output-directory") ?? `outputs/tectonics/review-${inputName}`,
);
const metadata = await image(input).metadata();
if (!metadata.width || !metadata.height) throw new Error("Input atlas has no readable dimensions");

const headerHeight = clamp(numberOption("header-height", 94), 0, metadata.height - 1);
const mapHeight = metadata.height - headerHeight;
const cropWidth = Math.min(numberOption("crop-width", 1600), metadata.width);
const cropHeight = Math.min(numberOption("crop-height", 1000), mapHeight);
const reviewWidth = numberOption("review-width", 800);
const reviewHeight = Math.max(1, Math.round(cropHeight / cropWidth * reviewWidth));

const regions = [
  { name: "northwest", centerX: 0.2, centerY: 0.34 },
  { name: "central", centerX: 0.42, centerY: 0.53 },
  { name: "northeast", centerX: 0.78, centerY: 0.36 },
  { name: "southern", centerX: 0.34, centerY: 0.76 },
] as const;

await mkdir(outputDirectory, { recursive: true });
const reviewTiles: Buffer[] = [];
for (const region of regions) {
  const left = clamp(
    Math.round(region.centerX * metadata.width - cropWidth / 2),
    0,
    metadata.width - cropWidth,
  );
  const top = headerHeight + clamp(
    Math.round(region.centerY * mapHeight - cropHeight / 2),
    0,
    mapHeight - cropHeight,
  );
  const cropPath = resolve(outputDirectory, `${region.name}-${cropWidth}x${cropHeight}.png`);
  const crop = image(input).extract({ left, top, width: cropWidth, height: cropHeight });
  await crop.clone().png().toFile(cropPath);
  reviewTiles.push(await crop
    .resize({ width: reviewWidth, height: reviewHeight, fit: "fill" })
    .png()
    .toBuffer());
  process.stdout.write(`${cropPath}\n`);
}

const gutter = 12;
const sheetWidth = reviewWidth * 2 + gutter * 3;
const sheetHeight = reviewHeight * 2 + gutter * 3;
const contactSheet = resolve(outputDirectory, "regional-review-contact-sheet.png");
await image({
  create: { width: sheetWidth, height: sheetHeight, channels: 4, background: "#071721" },
}).composite(reviewTiles.map((tile, index) => ({
  input: tile,
  left: gutter + index % 2 * (reviewWidth + gutter),
  top: gutter + Math.floor(index / 2) * (reviewHeight + gutter),
}))).png().toFile(contactSheet);

process.stdout.write(`${contactSheet}\n`);
process.stdout.write(JSON.stringify({
  input,
  inputWidth: metadata.width,
  inputHeight: metadata.height,
  mapHeight,
  cropWidth,
  cropHeight,
  reviewWidth,
  reviewHeight,
}) + "\n");
