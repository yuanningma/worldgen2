import {
  evaluateTectonicWorld,
  rankAcceptedWorlds,
  type WorldAcceptanceReport,
} from "../lib/evaluation/index.ts";
import {
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
  simulateTectonicWorld,
} from "../lib/tectonics/index.ts";

type OutputFormat = "console" | "json";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, fallback: number, integer = false): number {
  const value = option(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new RangeError(`--${name} must be a ${integer ? "finite integer" : "finite number"}`);
  }
  return parsed;
}

function listOption(name: string, fallback: readonly string[]): string[] {
  const value = option(name);
  if (value === undefined) return [...fallback];
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new RangeError(`--${name} must contain at least one comma-separated value`);
  return entries;
}

function formatNumber(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function conciseReport(report: WorldAcceptanceReport) {
  return {
    seed: report.seed,
    accepted: report.accepted,
    score: formatNumber(report.selectionScore),
    landFraction: formatNumber(report.morphology.landFraction, 4),
    components: report.morphology.componentCount,
    majorComponents: report.morphology.majorComponentCount,
    maximumMajorElongation: formatNumber(report.morphology.maximumMajorElongation),
    ribbonSeverity: formatNumber(report.morphology.ribbonSeverity),
    neckSplitPersistence: formatNumber(report.morphology.neckSplitPersistence),
    openGulfSeverity: formatNumber(report.morphology.openGulfSeverity),
    normalizedPerimeter: formatNumber(report.morphology.normalizedMajorCoastlinePerimeter),
    geodesicSolidity: formatNumber(report.morphology.minimumMajorGeodesicSolidity),
    coastlineRichness: formatNumber(report.morphology.coastlineRichness),
    coastlineFineNoise: formatNumber(report.morphology.coastlineFineNoiseFraction),
    peninsulaBaySignal: formatNumber(report.morphology.peninsulaBayBranchSignal),
    polarLandFraction: formatNumber(report.placement.polarLandFraction),
    maximumZonalLandFraction: formatNumber(report.placement.maximumZonalLandFraction),
    largestLandmassShare: formatNumber(report.placement.largestLandmassShare),
    enclosedLakeCount: report.morphology.enclosedLakeCount,
    boundaryCount: report.geology.boundaries.count,
    landProvenanceCount: report.geology.provenance.landCount,
    highElevationCompressionAdjacency: formatNumber(
      report.geology.elevation.highElevationCompressionAdjacencyFraction,
    ),
    failures: report.hardFailures,
    warnings: report.warnings,
  };
}

const seeds = listOption("seeds", [
  "atlas-forge-primeval-1",
  "EPOCH-11",
  "EPOCH-29",
  "EPOCH-47",
]);
const subdivisions = numberOption("subdivisions", 3, true);
const width = numberOption("width", 180, true);
const height = numberOption("height", Math.round(width / 2), true);
const scalesKm = listOption("scales-km", ["800", "1200", "1800"]).map((entry) => {
  const value = Number(entry);
  if (!(value > 0) || !Number.isFinite(value)) throw new RangeError("--scales-km values must be positive numbers");
  return value;
});
const formatOption = option("format") ?? "console";
if (formatOption !== "console" && formatOption !== "json") {
  throw new RangeError("--format must be console or json");
}
const format: OutputFormat = formatOption;
const movingMyr = numberOption("moving-myr", 0);
const modelOption = option("model") ?? (movingMyr === 0 ? "fixed" : "snapshot");
if (modelOption !== "fixed" && modelOption !== "snapshot" && modelOption !== "coupled") {
  throw new RangeError("--model must be fixed, snapshot, or coupled");
}

const reports = seeds.map((seed) => {
  const recipe = {
    seed,
    subdivisions,
    radiusKm: numberOption("radius-km", 6371),
    plateCount: numberOption("plates", 14, true),
    historyMyr: numberOption("history-myr", 360),
    timestepMyr: numberOption("timestep-myr", 2),
    oceanFraction: numberOption("ocean-fraction", 0.68),
  };
  const model = modelOption === "coupled"
    ? simulateCoupledTectonicWorld(recipe)
    : modelOption === "snapshot"
      ? simulateMovingCrustSnapshot(recipe, movingMyr)
      : simulateTectonicWorld(recipe);
  return evaluateTectonicWorld(model, {
  width,
  height,
  morphology: { scalesKm },
  });
});
const ranking = rankAcceptedWorlds(reports);

if (format === "json") {
  process.stdout.write(`${JSON.stringify({
    configuration: { seeds, subdivisions, width, height, scalesKm, movingMyr, model: modelOption },
    candidates: reports.map(conciseReport),
    acceptedRanking: ranking.map((report, index) => ({
      rank: index + 1,
      seed: report.seed,
      score: formatNumber(report.selectionScore),
    })),
  }, null, 2)}\n`);
} else {
  process.stdout.write(`TECTONIC WORLD EVALUATION · sub${subdivisions} · ${width}×${height} · ${modelOption}${modelOption === "snapshot" ? ` ${movingMyr} Myr` : ""}\n`);
  for (const report of reports) {
    const result = conciseReport(report);
    process.stdout.write([
      result.accepted ? "PASS  " : "REJECT",
      result.seed.padEnd(26),
      `land ${(result.landFraction * 100).toFixed(1)}%`,
      `major ${result.majorComponents}`,
      `elong ${result.maximumMajorElongation.toFixed(2)}`,
      `ribbon ${result.ribbonSeverity.toFixed(2)}`,
      `neck ${result.neckSplitPersistence.toFixed(2)}`,
      `gulf ${result.openGulfSeverity.toFixed(2)}`,
      `coast ${result.coastlineRichness.toFixed(2)}`,
      `score ${result.score.toFixed(2)}`,
    ].join(" · ") + "\n");
    for (const failure of result.failures) process.stdout.write(`       FAIL: ${failure}\n`);
  }
  process.stdout.write("ACCEPTED RANKING\n");
  if (ranking.length === 0) process.stdout.write("  none\n");
  else ranking.forEach((report, index) => {
    process.stdout.write(`  ${index + 1}. ${report.seed} · ${report.selectionScore.toFixed(3)}\n`);
  });
}
