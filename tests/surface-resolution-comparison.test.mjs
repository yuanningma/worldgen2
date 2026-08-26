import assert from "node:assert/strict";
import test from "node:test";
import { compareSurfaceResolutions } from "../lib/evaluation/surfaceResolutionComparison.ts";
import { createSurfaceProcessWorld } from "../lib/tectonics/surfaceProcess.ts";
import { simulateTectonicWorld } from "../lib/tectonics/worldSimulation.ts";

const tectonic = simulateTectonicWorld({
  seed: "SURFACE-RESOLUTION-3",
  subdivisions: 2,
  historyMyr: 90,
});
const reference = createSurfaceProcessWorld(tectonic, { subdivisions: 3 });

test("identical surface worlds have zero resolution drift", () => {
  const comparison = compareSurfaceResolutions(reference, reference);
  assert.equal(comparison.passed, true);
  assert.deepEqual(comparison.failures, []);
  for (const [name, value] of Object.entries(comparison)) {
    if (name.endsWith("Drift") || name === "biomeAreaTotalVariation") assert.equal(value, 0);
  }
});

test("surface resolution comparison is deterministic and reports bounded metrics", () => {
  const candidate = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const first = compareSurfaceResolutions(reference, candidate);
  const second = compareSurfaceResolutions(reference, candidate);
  assert.deepEqual(first, second);
  assert.ok(first.candidateCellCount > first.referenceCellCount);
  assert.ok(first.landFractionDrift < 0.01);
  assert.ok(first.biomeAreaTotalVariation >= 0 && first.biomeAreaTotalVariation <= 1);
  assert.ok(Object.values(first).filter((value) => typeof value === "number").every(Number.isFinite));
});

test("physical-distance climate transport converges as the process mesh is refined", () => {
  for (const seed of ["SURFACE-RESOLUTION-3", "ATLAS-TECTONIC-11", "EPOCH-29"]) {
    const world = simulateTectonicWorld({ seed, subdivisions: 3, historyMyr: 120 });
    const coarse = createSurfaceProcessWorld(world, { subdivisions: 4 });
    const fine = createSurfaceProcessWorld(world, { subdivisions: 5 });
    const comparison = compareSurfaceResolutions(coarse, fine);
    assert.ok(comparison.meanPrecipitationRelativeDrift < 0.06, seed);
    assert.ok(comparison.runoffRelativeDrift < 0.06, seed);
    assert.ok(comparison.maximumDrainageRelativeDrift < 0.03, seed);
    assert.ok(comparison.aridFractionDrift < 0.06, seed);
    assert.ok(comparison.humidFractionDrift < 0.03, seed);
    assert.ok(comparison.lakeAreaRelativeDrift < 0.22, seed);
    assert.ok(comparison.biomeAreaTotalVariation < 0.05, seed);
    assert.equal(fine.stats.drainageAnchorMismatches, 0, seed);
  }
});

test("surface resolution comparison rejects unrelated canonical seeds", () => {
  const other = simulateTectonicWorld({ seed: "OTHER-SURFACE", subdivisions: 2, historyMyr: 90 });
  const candidate = createSurfaceProcessWorld(other, { subdivisions: 3 });
  assert.throws(() => compareSurfaceResolutions(reference, candidate), /same canonical world seed/);
});
