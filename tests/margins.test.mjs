import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalMargins } from "../lib/tectonics/margins.ts";
import { createSurfaceProcessWorld } from "../lib/tectonics/surfaceProcess.ts";
import { simulateTectonicWorld } from "../lib/tectonics/worldSimulation.ts";

const world = simulateTectonicWorld({
  seed: "MARGIN-DISTANCE-17",
  subdivisions: 3,
  plateCount: 11,
  historyMyr: 180,
  timestepMyr: 3,
  oceanFraction: 0.68,
});

test("canonical margin influence is deterministic, bounded, and physically distanced", () => {
  const first = createCanonicalMargins(world);
  const second = createCanonicalMargins(world);
  assert.deepEqual(first, second);
  assert.equal(first.length, world.cells.length);
  const continental = first.filter((_, faceId) => {
    const cell = world.cells[faceId];
    return (cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0)) >= 0.5;
  });
  assert.ok(continental.length > 0);
  assert.ok(continental.every((margin) => margin.activeBoundaryStrength >= 0
    && margin.activeBoundaryStrength <= 1
    && margin.convergentStrength >= 0
    && margin.convergentStrength <= 1
    && margin.divergentStrength >= 0
    && margin.divergentStrength <= 1
    && margin.transformStrength >= 0
    && margin.transformStrength <= 1));
  assert.ok(continental.some((margin) => margin.activeBoundaryDistanceKm === 0));
  assert.ok(continental.some((margin) => margin.activeBoundaryDistanceKm > 500));
  assert.ok(Math.max(...continental.map((margin) => margin.activeBoundaryStrength)) > 0.7);
});

test("a world without current plate boundaries has no active-margin signal", () => {
  const quiet = createCanonicalMargins({ ...world, boundaries: [] });
  assert.ok(quiet.every((margin) => margin.activeBoundaryStrength === 0
    && margin.convergentStrength === 0
    && margin.divergentStrength === 0
    && margin.transformStrength === 0));
});

test("active margins, quiet coastal plains, and closed budgets survive a multi-seed gate", () => {
  for (const seed of ["MARGIN-CAL-A", "MARGIN-CAL-B", "MARGIN-CAL-C"]) {
    const tectonic = simulateTectonicWorld({
      seed,
      subdivisions: 2,
      plateCount: 8,
      historyMyr: 120,
      timestepMyr: 3,
      oceanFraction: 0.68,
    });
    const surface = createSurfaceProcessWorld(tectonic, {
      subdivisions: 3,
      minimumRiverAreaKm2: 50_000,
    });
    assert.ok(surface.stats.activeMarginCellCount > 0, seed);
    assert.ok(surface.stats.passiveMarginCellCount > 0, seed);
    assert.ok(surface.stats.coastalPlainCellCount > 0, seed);
    assert.ok(surface.stats.maximumCoastalPlainLoweringKm > 0, seed);
    assert.ok(surface.stats.coastalLandformCounts.delta > 0, seed);
    assert.equal(surface.stats.canonicalAnchorMismatches, 0, seed);
    assert.ok(Math.abs(surface.stats.runoffResidualKm3PerYear)
      <= Math.max(1e-8, surface.stats.totalLocalRunoffKm3PerYear * 1e-12), seed);
    assert.ok(Math.abs(surface.stats.sedimentResidualKm3)
      <= Math.max(1e-8, surface.stats.erodedVolumeKm3 * 1e-12), seed);
  }
});
