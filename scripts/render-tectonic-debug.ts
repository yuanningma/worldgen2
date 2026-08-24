import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTectonicDebugFixture } from "../lib/tectonics/debugFixture.ts";
import { renderTectonicContactSheet } from "../lib/tectonics/debugSvg.ts";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function integerOption(name: string, fallback: number): number {
  const value = option(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new RangeError(`--${name} must be an integer`);
  return parsed;
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(projectRoot, option("output") ?? "outputs/tectonics/prototype-contact-sheet.svg");
const seed = option("seed") ?? "RIFT-FIXTURE-001";
const subdivisions = integerOption("subdivisions", 3);
const plateCount = integerOption("plates", 8);
const snapshot = createTectonicDebugFixture({ seed, subdivisions, plateCount });
const svg = renderTectonicContactSheet(snapshot, {
  title: "TECTONIC PROTOTYPE · DEBUG FIXTURE (NOT A GENERATED WORLD)",
});
await mkdir(dirname(output), { recursive: true });
await writeFile(output, svg, "utf8");
process.stdout.write(`${output}\n`);
