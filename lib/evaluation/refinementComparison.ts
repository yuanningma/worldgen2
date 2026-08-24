import type { SphericalLandmassReport } from "./sphericalLandmassMetrics.ts";

export interface MorphologyRefinementGateOptions {
  readonly minimumCoastlineRichnessGain?: number;
  readonly sufficientCoastlineRichness?: number;
  readonly maximumRichnessLossAboveTarget?: number;
  readonly maximumLandFractionDrift?: number;
  readonly maximumEffectiveComponentCountDrift?: number;
  readonly maximumMajorAreaShareL1Drift?: number;
  readonly maximumElongationIncrease?: number;
  readonly maximumRibbonSeverityIncrease?: number;
  readonly maximumNeckPersistenceIncrease?: number;
  readonly maximumOpenGulfSeverityIncrease?: number;
}

export interface MorphologyRefinementComparison {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly coastlineRichnessGain: number;
  readonly landFractionDrift: number;
  readonly effectiveComponentCountDrift: number;
  readonly majorAreaShareL1Drift: number;
  readonly newlyResolvedScaleCount: number;
}

const DEFAULTS: Required<MorphologyRefinementGateOptions> = {
  minimumCoastlineRichnessGain: 0.05,
  sufficientCoastlineRichness: 0.55,
  maximumRichnessLossAboveTarget: 0.02,
  maximumLandFractionDrift: 0.025,
  maximumEffectiveComponentCountDrift: 0.4,
  maximumMajorAreaShareL1Drift: 0.12,
  maximumElongationIncrease: 0.35,
  maximumRibbonSeverityIncrease: 0.3,
  maximumNeckPersistenceIncrease: 0.15,
  maximumOpenGulfSeverityIncrease: 1,
};

/**
 * A non-compensatory comparison for two representations of one world history.
 * Refinement must reveal persistent coastline structure without changing the
 * number or relative hierarchy of major landmasses or introducing pathologies.
 */
export function compareMorphologyRefinement(
  coarse: SphericalLandmassReport,
  refined: SphericalLandmassReport,
  options: MorphologyRefinementGateOptions = {},
): MorphologyRefinementComparison {
  const limits = { ...DEFAULTS, ...options };
  const failures: string[] = [];
  const coastlineRichnessGain = refined.coastlineRichness - coarse.coastlineRichness;
  const minimumRichnessGain = coarse.coastlineRichness >= limits.sufficientCoastlineRichness
    ? -limits.maximumRichnessLossAboveTarget
    : limits.minimumCoastlineRichnessGain;
  const landFractionDrift = Math.abs(refined.landFraction - coarse.landFraction);
  const effectiveComponentCountDrift = Math.abs(
    refined.effectiveComponentCount - coarse.effectiveComponentCount,
  );
  const shareCount = Math.max(coarse.majorComponents.length, refined.majorComponents.length);
  let majorAreaShareL1Drift = 0;
  for (let index = 0; index < shareCount; index += 1) {
    majorAreaShareL1Drift += Math.abs(
      (coarse.majorComponents[index]?.areaShareOfLand ?? 0)
      - (refined.majorComponents[index]?.areaShareOfLand ?? 0),
    );
  }
  const coarseResolved = new Set(coarse.multiscale
    .filter((scale) => scale.resolved)
    .map((scale) => scale.scaleKm));
  const newlyResolvedScaleCount = refined.multiscale.filter((scale) =>
    scale.resolved && !coarseResolved.has(scale.scaleKm)).length;

  const reject = (condition: boolean, message: string): void => {
    if (condition) failures.push(message);
  };
  reject(coarse.majorComponentCount !== refined.majorComponentCount,
    `major component count changed from ${coarse.majorComponentCount} to ${refined.majorComponentCount}`);
  reject(landFractionDrift > limits.maximumLandFractionDrift,
    `land fraction drift ${landFractionDrift.toFixed(4)} exceeds ${limits.maximumLandFractionDrift}`);
  reject(effectiveComponentCountDrift > limits.maximumEffectiveComponentCountDrift,
    `effective component drift ${effectiveComponentCountDrift.toFixed(3)} exceeds ${limits.maximumEffectiveComponentCountDrift}`);
  reject(majorAreaShareL1Drift > limits.maximumMajorAreaShareL1Drift,
    `major area-share L1 drift ${majorAreaShareL1Drift.toFixed(3)} exceeds ${limits.maximumMajorAreaShareL1Drift}`);
  reject(coastlineRichnessGain < minimumRichnessGain,
    `coastline richness gain ${coastlineRichnessGain.toFixed(3)} is below ${minimumRichnessGain}`);
  reject(refined.maximumMajorElongation - coarse.maximumMajorElongation
    > limits.maximumElongationIncrease,
  `major elongation increased by ${(refined.maximumMajorElongation - coarse.maximumMajorElongation).toFixed(3)}`);
  reject(refined.ribbonSeverity - coarse.ribbonSeverity > limits.maximumRibbonSeverityIncrease,
    `ribbon severity increased by ${(refined.ribbonSeverity - coarse.ribbonSeverity).toFixed(3)}`);
  reject(refined.neckSplitPersistence - coarse.neckSplitPersistence
    > limits.maximumNeckPersistenceIncrease,
  `neck persistence increased by ${(refined.neckSplitPersistence - coarse.neckSplitPersistence).toFixed(3)}`);
  reject(refined.openGulfSeverity - coarse.openGulfSeverity
    > limits.maximumOpenGulfSeverityIncrease,
  `open-gulf severity increased by ${(refined.openGulfSeverity - coarse.openGulfSeverity).toFixed(3)}`);

  return {
    passed: failures.length === 0,
    failures,
    coastlineRichnessGain,
    landFractionDrift,
    effectiveComponentCountDrift,
    majorAreaShareL1Drift,
    newlyResolvedScaleCount,
  };
}
