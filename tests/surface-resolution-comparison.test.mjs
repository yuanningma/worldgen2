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

test("surface resolution comparison rejects unrelated canonical seeds", () => {
  const other = simulateTectonicWorld({ seed: "OTHER-SURFACE", subdivisions: 2, historyMyr: 90 });
  const candidate = createSurfaceProcessWorld(other, { subdivisions: 3 });
  assert.throws(() => compareSurfaceResolutions(reference, candidate), /same canonical world seed/);
});
