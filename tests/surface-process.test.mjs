import assert from "node:assert/strict";
import test from "node:test";
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

test("nested surface grid retains canonical ancestry and topology anchors", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  assert.equal(surface.sphere.faces.length, tectonic.sphere.faces.length * 4);
  assert.equal(surface.stats.canonicalAnchorMismatches, 0);
  for (const cell of surface.cells) {
    assert.equal(cell.canonicalFaceId, Math.floor(cell.faceId / 4));
    assert.ok(Number.isFinite(cell.coastDistanceKm));
    assert.ok(cell.coastDistanceKm >= 0);
  }
  for (const face of surface.sphere.faces.filter((_, index) => index % 97 === 0)) {
    assert.equal(surface.sample(face.center).faceId, face.id);
  }
});

test("Priority-Flood drainage is local, acyclic, and reaches the ocean", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const neighbors = surface.sphere.faces.map(() => new Set());
  for (const edge of surface.sphere.edges) {
    neighbors[edge.faces[0]].add(edge.faces[1]);
    neighbors[edge.faces[1]].add(edge.faces[0]);
  }
  for (const cell of surface.cells) {
    if (!cell.isLand) {
      assert.equal(cell.receiverFaceId, null);
      continue;
    }
    assert.notEqual(cell.receiverFaceId, null);
    assert.equal(neighbors[cell.faceId].has(cell.receiverFaceId), true);
    const visited = new Set([cell.faceId]);
    let cursor = cell;
    while (cursor.isLand) {
      assert.notEqual(cursor.receiverFaceId, null);
      assert.equal(visited.has(cursor.receiverFaceId), false, `cycle from face ${cell.faceId}`);
      visited.add(cursor.receiverFaceId);
      cursor = surface.cells[cursor.receiverFaceId];
      assert.ok(visited.size <= surface.cells.length);
    }
  }
});

test("surface runoff closes at ocean outlets and produces resolved rivers", () => {
  const surface = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
  });
  const tolerance = Math.max(1e-9, surface.stats.totalLocalRunoffKm3PerYear * 1e-12);
  assert.ok(Math.abs(surface.stats.runoffResidualKm3PerYear) <= tolerance);
  assert.ok(surface.stats.totalOutletRunoffKm3PerYear > 0);
  assert.ok(surface.stats.riverSegmentCount > 0);
  assert.ok(surface.stats.maximumDrainageAreaKm2 > 20_000);
  for (const river of surface.rivers) {
    assert.ok(river.drainageAreaKm2 >= 20_000);
    assert.equal(surface.cells[river.fromFaceId].isLand, true);
  }
});

test("surface processes are deterministic for a world recipe", () => {
  const first = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const second = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  assert.deepEqual(first.stats, second.stats);
  assert.deepEqual(first.rivers, second.rivers);
  assert.deepEqual(first.cells, second.cells);
});

test("fluvial incision conserves sediment and preserves the canonical coast", () => {
  const uneroded = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    erosionStrengthKm: 0,
  });
  const eroded = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    erosionStrengthKm: 0.2,
  });
  assert.deepEqual(
    eroded.cells.map((cell) => cell.isLand),
    uneroded.cells.map((cell) => cell.isLand),
  );
  assert.ok(eroded.stats.erodedVolumeKm3 > 0);
  assert.ok(eroded.stats.depositedVolumeKm3 > 0);
  assert.ok(eroded.stats.exportedSedimentVolumeKm3 > 0);
  assert.ok(eroded.stats.incisedCellCount > 0);
  assert.ok(eroded.stats.incisedCellCount < eroded.stats.landCellCount);
  const tolerance = Math.max(1e-7, eroded.stats.erodedVolumeKm3 * 1e-12);
  assert.ok(Math.abs(eroded.stats.sedimentResidualKm3) <= tolerance);
  assert.ok(eroded.cells.some((cell, index) => cell.elevationKm < uneroded.cells[index].elevationKm - 1e-5));
});
