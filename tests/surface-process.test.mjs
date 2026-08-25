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
    assert.ok(Number.isFinite(cell.erosionResistance));
    assert.ok(cell.erosionResistance >= 0 && cell.erosionResistance <= 1);
  }
  for (const face of surface.sphere.faces.filter((_, index) => index % 97 === 0)) {
    assert.equal(surface.sample(face.center).faceId, face.id);
  }
});

test("terrane geology produces distinct rock provinces with closed area accounting", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const landLithologies = new Set(
    surface.cells.filter((cell) => cell.isLand).map((cell) => cell.lithology),
  );
  assert.ok(landLithologies.size >= 3);
  assert.ok(surface.cells.filter((cell) => !cell.isLand).every((cell) => cell.lithology === "oceanic-basalt"));
  assert.ok(surface.stats.meanLandErosionResistance > 0.2);
  assert.ok(surface.stats.meanLandErosionResistance < 0.95);

  const expectedAreaKm2 = surface.sphere.totalAreaSteradians * tectonic.recipe.radiusKm ** 2;
  const lithologyAreaKm2 = Object.values(surface.stats.lithologyAreaKm2)
    .reduce((sum, area) => sum + area, 0);
  assert.ok(Math.abs(lithologyAreaKm2 - expectedAreaKm2) <= expectedAreaKm2 * 1e-12);
  const erosionByLithology = Object.values(surface.stats.erodedVolumeByLithologyKm3)
    .reduce((sum, volume) => sum + volume, 0);
  assert.ok(Math.abs(erosionByLithology - surface.stats.erodedVolumeKm3)
    <= Math.max(1e-9, surface.stats.erodedVolumeKm3 * 1e-12));
});

test("spherical circulation creates longitudinal rainfall structure and orographic enhancement", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const land = surface.cells.filter((cell) => cell.isLand);
  assert.ok(land.every((cell) => Number.isFinite(cell.atmosphericMoisture)
    && cell.atmosphericMoisture >= 0
    && cell.atmosphericMoisture <= 1));
  assert.ok(land.every((cell) => Number.isFinite(cell.orographicLiftKm) && cell.orographicLiftKm >= 0));
  assert.ok(surface.stats.meanLandPrecipitationMPerYear > 0.2);
  assert.ok(surface.stats.meanLandPrecipitationMPerYear < 2.5);
  assert.ok(surface.stats.aridLandFraction > 0 && surface.stats.aridLandFraction < 0.9);
  assert.ok(surface.stats.humidLandFraction > 0 && surface.stats.humidLandFraction < 0.8);
  assert.ok(surface.stats.maximumOrographicLiftKm > 0.1);

  const latitudeBins = new Map();
  for (const cell of land) {
    const z = surface.sphere.faces[cell.faceId].center[2];
    const bin = Math.floor((z + 1) * 8);
    const values = latitudeBins.get(bin) ?? [];
    values.push(cell.precipitationMPerYear);
    latitudeBins.set(bin, values);
  }
  const maximumWithinBeltSpread = Math.max(...[...latitudeBins.values()]
    .filter((values) => values.length >= 20)
    .map((values) => Math.max(...values) - Math.min(...values)));
  assert.ok(maximumWithinBeltSpread > 0.45);

  const lifted = land.filter((cell) => cell.orographicLiftKm > 0.12);
  const unlifted = land.filter((cell) => cell.orographicLiftKm < 0.015);
  assert.ok(lifted.length > 0 && unlifted.length > 0);
  const mean = (cells) => cells.reduce((sum, cell) => sum + cell.precipitationMPerYear, 0) / cells.length;
  assert.ok(mean(lifted) > mean(unlifted));
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

test("continuous presentation sampling preserves anchors and removes cell-edge jumps", () => {
  const surface = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    presentationSampleCount: 10,
  });
  for (const face of surface.sphere.faces.filter((_, index) => index % 71 === 0)) {
    assert.equal(surface.sampleContinuous(face.center).isLand, surface.cells[face.id].isLand);
  }

  const adjacency = surface.sphere.faces.map(() => []);
  for (const edge of surface.sphere.edges) {
    adjacency[edge.faces[0]].push(edge.faces[1]);
    adjacency[edge.faces[1]].push(edge.faces[0]);
  }
  const interior = surface.cells.find((cell) => (
    cell.isLand && adjacency[cell.faceId].every((neighbor) => surface.cells[neighbor].isLand)
  ));
  assert.ok(interior);
  const neighborId = adjacency[interior.faceId][0];
  const a = surface.sphere.faces[interior.faceId].center;
  const b = surface.sphere.faces[neighborId].center;
  const midpoint = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const magnitude = Math.hypot(...midpoint);
  const unit = midpoint.map((value) => value / magnitude);
  const towardA = unit.map((value, index) => value + a[index] * 1e-7);
  const towardB = unit.map((value, index) => value + b[index] * 1e-7);
  const first = surface.sampleContinuous(towardA);
  const second = surface.sampleContinuous(towardB);
  assert.equal(first.isLand, true);
  assert.equal(second.isLand, true);
  assert.ok(Math.abs(first.elevationKm - second.elevationKm) < 1e-4);
  assert.ok(first.terrainGradient.every(Number.isFinite));
  assert.ok(second.terrainGradient.every(Number.isFinite));
  assert.ok(first.prevailingWind.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...first.prevailingWind) - 1) < 1e-10);
  assert.ok(Number.isFinite(first.surfaceTexture));
  assert.ok(Math.abs(first.surfaceTexture) <= 1.0000001);
  assert.ok(Math.abs(first.surfaceTexture - second.surfaceTexture) > 1e-10);

  const repeat = surface.sampleContinuous(towardA);
  assert.deepEqual(repeat, first);
});
