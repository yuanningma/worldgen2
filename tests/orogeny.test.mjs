import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalOrogeny } from "../lib/tectonics/orogeny.ts";
import { createSurfaceProcessWorld } from "../lib/tectonics/surfaceProcess.ts";
import { simulateTectonicWorld } from "../lib/tectonics/worldSimulation.ts";

const tectonic = simulateTectonicWorld({
  seed: "SURFACE-PROCESS-17",
  subdivisions: 3,
  plateCount: 11,
  historyMyr: 180,
  timestepMyr: 3,
  oceanFraction: 0.68,
});

function isContinental(faceId) {
  const cell = tectonic.cells[faceId];
  return (cell.continentalFraction ?? (cell.crustType === "continental" ? 1 : 0)) >= 0.48;
}

test("orogenic profiles distinguish collision, subduction, island arcs, and inherited sutures", () => {
  const first = createCanonicalOrogeny(tectonic);
  const second = createCanonicalOrogeny(tectonic);
  assert.deepEqual(first, second);
  assert.equal(first.length, tectonic.cells.length);
  assert.ok(first.every((cell) => cell.faceId >= 0
    && cell.strength >= 0 && cell.strength <= 1
    && cell.foothillStrength >= 0 && cell.foothillStrength <= 1));

  let collisionCount = 0;
  let subductionCount = 0;
  let islandArcCount = 0;
  for (const boundary of tectonic.boundaries.filter((candidate) => candidate.kind === "convergent")) {
    const [firstId, secondId] = tectonic.sphere.edges[boundary.edgeId].faces;
    const firstContinental = isContinental(firstId);
    const secondContinental = isContinental(secondId);
    if (firstContinental && secondContinental) {
      collisionCount += 1;
      assert.ok(first[firstId].collisionCore > 0);
      assert.ok(first[secondId].collisionCore > 0);
    } else if (firstContinental !== secondContinental) {
      subductionCount += 1;
      const landwardId = firstContinental ? firstId : secondId;
      assert.ok(first[landwardId].subductionCore > 0);
    } else {
      islandArcCount += 1;
      assert.ok(first[firstId].islandArcCore > 0);
      assert.ok(first[secondId].islandArcCore > 0);
    }
  }
  assert.ok(collisionCount > 0 && subductionCount > 0 && islandArcCount > 0);
  assert.ok(first.some((cell) => cell.sutureCore > 0));
  assert.ok(first.some((cell) => cell.foothillStrength > 0.1));
});

test("boundary-supported relief narrows mountains without changing canonical land", () => {
  const quietWorld = {
    ...tectonic,
    boundaries: [],
    cells: tectonic.cells.map((cell) => ({ ...cell, provenanceId: 1 })),
  };
  const quietOrogeny = createCanonicalOrogeny(quietWorld);
  assert.ok(quietOrogeny.every((cell) => cell.regime === "none" && cell.strength === 0));

  const active = createSurfaceProcessWorld(tectonic, { subdivisions: 3, erosionStrengthKm: 0 });
  const quiet = createSurfaceProcessWorld(quietWorld, { subdivisions: 3, erosionStrengthKm: 0 });
  assert.deepEqual(active.cells.map((cell) => cell.isLand), quiet.cells.map((cell) => cell.isLand));
  assert.equal(active.stats.landFraction, quiet.stats.landFraction);
  assert.ok(active.cells.some((cell) => cell.isLand && cell.orogenStrength > 0.5));
  assert.ok(active.cells.every((cell) => cell.orogenStrength >= 0 && cell.orogenStrength <= 1));

  const maximumRelief = (surface) => Math.max(...surface.cells
    .filter((cell) => cell.isLand)
    .map((cell) => cell.elevationKm - tectonic.seaLevelKm));
  assert.ok(maximumRelief(active) > maximumRelief(quiet) + 1.5);
  assert.equal(quiet.cells.filter((cell) => cell.isLand
    && cell.elevationKm - tectonic.seaLevelKm > 3).length, 0);
});
