import assert from "node:assert/strict";
import test from "node:test";
import { compareMorphologyRefinement } from "../lib/evaluation/refinementComparison.ts";
import {
  createCompactContinentFixture,
  createLobedContinentFixture,
  createNoisyRibbonFixture,
} from "../lib/evaluation/pathologyFixtures.ts";
import { evaluateSphericalLandMask } from "../lib/evaluation/sphericalLandmassMetrics.ts";

const geometry = { width: 240, height: 120, radiusKm: 6371 };
const evaluation = { scalesKm: [450, 700, 1_000, 1_400] };

test("refinement gate accepts persistent lobes without changing component hierarchy", () => {
  const coarse = evaluateSphericalLandMask(createCompactContinentFixture(geometry), evaluation);
  const refined = evaluateSphericalLandMask(createLobedContinentFixture(geometry), evaluation);
  const comparison = compareMorphologyRefinement(coarse, refined);
  assert.equal(coarse.majorComponentCount, refined.majorComponentCount);
  assert.ok(comparison.coastlineRichnessGain > 0.25);
  assert.ok(comparison.landFractionDrift < 0.025);
  assert.equal(comparison.passed, true, comparison.failures.join("; "));
});

test("refinement gate rejects unchanged disks and noisy ribbons", () => {
  const disk = evaluateSphericalLandMask(createCompactContinentFixture(geometry), evaluation);
  const unchanged = compareMorphologyRefinement(disk, disk);
  assert.equal(unchanged.passed, false);
  assert.ok(unchanged.failures.some((failure) => failure.includes("richness gain")));

  const noisy = evaluateSphericalLandMask(createNoisyRibbonFixture(geometry), evaluation);
  const noisyComparison = compareMorphologyRefinement(disk, noisy);
  assert.equal(noisyComparison.passed, false);
  assert.ok(noisyComparison.failures.some((failure) => failure.includes("elongation")));
  assert.ok(noisyComparison.failures.some((failure) => failure.includes("ribbon")));
});

test("already-rich coastlines may be smoothed without chasing unbounded richness", () => {
  const lobed = evaluateSphericalLandMask(createLobedContinentFixture(geometry), evaluation);
  const coarse = { ...lobed, coastlineRichness: 0.6 };
  const refined = { ...lobed, coastlineRichness: 0.59 };
  const comparison = compareMorphologyRefinement(coarse, refined);
  assert.equal(comparison.passed, true, comparison.failures.join("; "));
  assert.ok(comparison.coastlineRichnessGain < 0);
});
