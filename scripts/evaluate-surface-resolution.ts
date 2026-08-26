import { compareSurfaceResolutions } from "../lib/evaluation/index.ts";
import { createSurfaceProcessWorld } from "../lib/tectonics/surfaceProcess.ts";
import {
  simulateCoupledTectonicWorld,
  simulateTectonicWorld,
} from "../lib/tectonics/worldSimulation.ts";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function integerOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) throw new RangeError(`--${name} must be a nonnegative integer`);
  return parsed;
}

const seed = option("seed") ?? "primeval-atlas-7";
const tectonicSubdivisions = integerOption("tectonic-subdivisions", 5);
const referenceSubdivisions = integerOption("reference-subdivisions", 6);
const candidateSubdivisions = integerOption("candidate-subdivisions", 7);
const model = option("model") ?? "fixed";
if (model !== "fixed" && model !== "coupled") throw new RangeError("--model must be fixed or coupled");
const historyMyr = integerOption("history-myr", model === "coupled" ? 120 : 360);
const format = option("format") ?? "console";
if (format !== "console" && format !== "json") throw new RangeError("--format must be console or json");

const recipe = {
  seed,
  subdivisions: tectonicSubdivisions,
  historyMyr,
  timestepMyr: 2,
};
const tectonic = model === "coupled"
  ? simulateCoupledTectonicWorld(recipe)
  : simulateTectonicWorld(recipe);
const reference = createSurfaceProcessWorld(tectonic, { subdivisions: referenceSubdivisions });
const candidate = createSurfaceProcessWorld(tectonic, { subdivisions: candidateSubdivisions });
const comparison = compareSurfaceResolutions(reference, candidate);

if (format === "json") {
  process.stdout.write(JSON.stringify({
    seed,
    model,
    tectonicSubdivisions,
    referenceSubdivisions,
    candidateSubdivisions,
    comparison,
  }, null, 2) + "\n");
} else {
  process.stdout.write(`${seed} (${model}): surface sub${referenceSubdivisions} → sub${candidateSubdivisions} ${comparison.passed ? "PASS" : "FAIL"}\n`);
  process.stdout.write(`cells ${comparison.referenceCellCount.toLocaleString("en-US")} → ${comparison.candidateCellCount.toLocaleString("en-US")}\n`);
  process.stdout.write(`land Δ ${(comparison.landFractionDrift * 100).toFixed(3)} points\n`);
  process.stdout.write(`temperature Δ ${comparison.meanTemperatureDriftC.toFixed(3)} °C\n`);
  process.stdout.write(`precipitation Δ ${(comparison.meanPrecipitationRelativeDrift * 100).toFixed(1)}%\n`);
  process.stdout.write(`runoff Δ ${(comparison.runoffRelativeDrift * 100).toFixed(1)}%\n`);
  process.stdout.write(`biome total variation ${(comparison.biomeAreaTotalVariation * 100).toFixed(1)}%\n`);
  for (const failure of comparison.failures) process.stdout.write(`- ${failure}\n`);
}
