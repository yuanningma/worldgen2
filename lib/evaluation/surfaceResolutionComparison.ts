import type { SurfaceProcessWorld } from "../tectonics/surfaceProcess.ts";

export interface SurfaceResolutionThresholds {
  readonly landFraction: number;
  readonly meanTemperatureC: number;
  readonly meanSeasonalRangeC: number;
  readonly meanPrecipitationRelative: number;
  readonly runoffRelative: number;
  readonly maximumDrainageRelative: number;
  readonly aridFraction: number;
  readonly humidFraction: number;
  readonly lakeAreaRelative: number;
  readonly biomeAreaTotalVariation: number;
}

export interface SurfaceResolutionComparison {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly referenceCellCount: number;
  readonly candidateCellCount: number;
  readonly landFractionDrift: number;
  readonly meanTemperatureDriftC: number;
  readonly meanSeasonalRangeDriftC: number;
  readonly meanPrecipitationRelativeDrift: number;
  readonly runoffRelativeDrift: number;
  readonly maximumDrainageRelativeDrift: number;
  readonly aridFractionDrift: number;
  readonly humidFractionDrift: number;
  readonly lakeAreaRelativeDrift: number;
  readonly biomeAreaTotalVariation: number;
}

export const DEFAULT_SURFACE_RESOLUTION_THRESHOLDS: SurfaceResolutionThresholds = {
  landFraction: 0.001,
  meanTemperatureC: 1,
  meanSeasonalRangeC: 2,
  meanPrecipitationRelative: 0.15,
  runoffRelative: 0.15,
  maximumDrainageRelative: 0.08,
  aridFraction: 0.08,
  humidFraction: 0.08,
  lakeAreaRelative: 0.25,
  biomeAreaTotalVariation: 0.08,
};

function relativeDrift(reference: number, candidate: number, floor = Number.EPSILON): number {
  return Math.abs(candidate - reference) / Math.max(Math.abs(reference), floor);
}

export function compareSurfaceResolutions(
  reference: SurfaceProcessWorld,
  candidate: SurfaceProcessWorld,
  thresholds: Partial<SurfaceResolutionThresholds> = {},
): SurfaceResolutionComparison {
  if (reference.tectonicWorld.recipe.seed !== candidate.tectonicWorld.recipe.seed) {
    throw new RangeError("Surface resolution comparison requires the same canonical world seed");
  }
  const limits = { ...DEFAULT_SURFACE_RESOLUTION_THRESHOLDS, ...thresholds };
  const totalAreaKm2 = reference.sphere.totalAreaSteradians
    * reference.tectonicWorld.recipe.radiusKm ** 2;
  const landFractionDrift = Math.abs(candidate.stats.landFraction - reference.stats.landFraction);
  const meanTemperatureDriftC = Math.abs(
    candidate.stats.meanLandTemperatureC - reference.stats.meanLandTemperatureC,
  );
  const meanSeasonalRangeDriftC = Math.abs(
    candidate.stats.meanLandSeasonalTemperatureRangeC
      - reference.stats.meanLandSeasonalTemperatureRangeC,
  );
  const meanPrecipitationRelativeDrift = relativeDrift(
    reference.stats.meanLandPrecipitationMPerYear,
    candidate.stats.meanLandPrecipitationMPerYear,
  );
  const runoffRelativeDrift = relativeDrift(
    reference.stats.totalLocalRunoffKm3PerYear,
    candidate.stats.totalLocalRunoffKm3PerYear,
  );
  const maximumDrainageRelativeDrift = relativeDrift(
    reference.stats.maximumDrainageAreaKm2,
    candidate.stats.maximumDrainageAreaKm2,
  );
  const aridFractionDrift = Math.abs(
    candidate.stats.aridLandFraction - reference.stats.aridLandFraction,
  );
  const humidFractionDrift = Math.abs(
    candidate.stats.humidLandFraction - reference.stats.humidLandFraction,
  );
  const lakeAreaRelativeDrift = relativeDrift(
    reference.stats.lakeAreaKm2,
    candidate.stats.lakeAreaKm2,
    totalAreaKm2 * 1e-4,
  );
  const biomeNames = Object.keys(reference.stats.biomeAreaKm2) as Array<keyof typeof reference.stats.biomeAreaKm2>;
  const biomeAreaTotalVariation = biomeNames.reduce(
    (sum, biome) => sum + Math.abs(
      candidate.stats.biomeAreaKm2[biome] - reference.stats.biomeAreaKm2[biome],
    ) / totalAreaKm2,
    0,
  ) / 2;

  const checks: ReadonlyArray<readonly [string, number, number]> = [
    ["land fraction", landFractionDrift, limits.landFraction],
    ["mean temperature", meanTemperatureDriftC, limits.meanTemperatureC],
    ["seasonal temperature range", meanSeasonalRangeDriftC, limits.meanSeasonalRangeC],
    ["mean precipitation", meanPrecipitationRelativeDrift, limits.meanPrecipitationRelative],
    ["total runoff", runoffRelativeDrift, limits.runoffRelative],
    ["maximum drainage area", maximumDrainageRelativeDrift, limits.maximumDrainageRelative],
    ["arid land fraction", aridFractionDrift, limits.aridFraction],
    ["humid land fraction", humidFractionDrift, limits.humidFraction],
    ["lake area", lakeAreaRelativeDrift, limits.lakeAreaRelative],
    ["biome area distribution", biomeAreaTotalVariation, limits.biomeAreaTotalVariation],
  ];
  const failures = checks
    .filter(([, value, limit]) => value > limit)
    .map(([name, value, limit]) => `${name} drift ${value.toFixed(4)} exceeds ${limit.toFixed(4)}`);

  return {
    passed: failures.length === 0,
    failures,
    referenceCellCount: reference.cells.length,
    candidateCellCount: candidate.cells.length,
    landFractionDrift,
    meanTemperatureDriftC,
    meanSeasonalRangeDriftC,
    meanPrecipitationRelativeDrift,
    runoffRelativeDrift,
    maximumDrainageRelativeDrift,
    aridFractionDrift,
    humidFractionDrift,
    lakeAreaRelativeDrift,
    biomeAreaTotalVariation,
  };
}
