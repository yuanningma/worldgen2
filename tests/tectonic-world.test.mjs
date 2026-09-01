import assert from "node:assert/strict";
import test from "node:test";
import {
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
  simulateTectonicWorld,
} from "../lib/tectonics/index.ts";

const RECIPE = {
  seed: "whole-world-regression",
  subdivisions: 2,
  plateCount: 11,
  historyMyr: 180,
  timestepMyr: 3,
  oceanFraction: 0.67,
};

test("whole-world simulation is deterministic", () => {
  const first = simulateTectonicWorld(RECIPE);
  const second = simulateTectonicWorld(RECIPE);
  assert.deepEqual(second, first);
  assert.notDeepEqual(simulateTectonicWorld({ ...RECIPE, seed: "another-world" }).cells, first.cells);
});

test("canonical cells cover the closed sphere exactly once", () => {
  const world = simulateTectonicWorld(RECIPE);
  assert.equal(world.cells.length, world.sphere.faces.length);
  assert.deepEqual(world.cells.map((cell) => cell.faceId), world.sphere.faces.map((face) => face.id));
  assert.ok(Math.abs(world.areaBudget.coverageResidualSteradians) < 1e-12);
  assert.ok(Math.abs(world.areaBudget.crustResidualSteradians) < 1e-12);
  assert.ok(Math.abs(world.areaBudget.coveredSteradians - 4 * Math.PI) < 1e-10);
  assert.ok(world.sphere.edges.every((edge) => edge.faces.length === 2));
});

test("evolved world contains meaningful plate boundary regimes", () => {
  const world = simulateTectonicWorld(RECIPE);
  assert.ok(world.boundaries.length > 20);
  assert.ok(world.stats.boundaryCounts.divergent > 0);
  assert.ok(world.stats.boundaryCounts.convergent > 0);
  assert.ok(world.stats.boundaryCounts.transform > 0);
  assert.ok(world.boundaries.some((boundary) => boundary.ageMyr > 0));
});

test("fixed-topology history evolves persistent crust without sweeping plate ownership", () => {
  const young = simulateTectonicWorld({ ...RECIPE, historyMyr: 3 });
  const evolved = simulateTectonicWorld(RECIPE);
  assert.deepEqual(evolved.cells.map((cell) => cell.plateId), young.cells.map((cell) => cell.plateId));
  assert.notDeepEqual(
    evolved.cells.map((cell) => [cell.crustType, cell.crustAgeMyr, cell.crustThicknessKm, cell.elevationKm]),
    young.cells.map((cell) => [cell.crustType, cell.crustAgeMyr, cell.crustThicknessKm, cell.elevationKm]),
  );
  assert.equal(evolved.transportModel, "fixed-geodesic-control-volume-v1");
});

test("world exposes physically distinct land and ocean potential", () => {
  const world = simulateTectonicWorld(RECIPE);
  const land = world.cells.filter((cell) => cell.isLand);
  const ocean = world.cells.filter((cell) => !cell.isLand);
  const continental = world.cells.filter((cell) => cell.crustType === "continental");
  const oceanic = world.cells.filter((cell) => cell.crustType === "oceanic");
  assert.ok(land.length > 0 && ocean.length > 0);
  assert.ok(continental.length > 0 && oceanic.length > 0);
  assert.ok(land.every((cell) => cell.waterDepthKm === 0));
  assert.ok(ocean.every((cell) => cell.waterDepthKm > 0));
  assert.ok(world.stats.maxElevationKm > world.seaLevelKm);
  assert.ok(world.stats.minElevationKm < world.seaLevelKm);
  assert.ok(Math.abs(world.stats.landFraction - (1 - RECIPE.oceanFraction)) < 0.025);
});

test("crust state remains finite, positive, and carries provenance", () => {
  const world = simulateTectonicWorld(RECIPE);
  for (const cell of world.cells) {
    assert.ok(Number.isFinite(cell.elevationKm));
    assert.ok(Number.isFinite(cell.waterDepthKm));
    assert.ok(cell.crustAgeMyr >= 0);
    assert.ok(cell.thermalAgeMyr >= 0);
    assert.ok(Number.isFinite(cell.riftExposureMyr) && cell.riftExposureMyr >= 0);
    assert.ok(Number.isFinite(cell.convergenceExposureMyr) && cell.convergenceExposureMyr >= 0);
    assert.ok(cell.crustThicknessKm > 0);
    assert.ok(cell.densityKgM3 > 0);
    assert.ok(Number.isInteger(cell.provenanceId));
    assert.ok(cell.plateId >= 0 && cell.plateId < world.plates.length);
  }
  assert.ok(world.cells.some((cell) => cell.riftExposureMyr > 0));
  assert.ok(world.cells.some((cell) => cell.convergenceExposureMyr > 0));
});

test("continental growth preserves a hierarchy of adjacent accreted terranes", () => {
  const world = simulateTectonicWorld({ ...RECIPE, subdivisions: 3, historyMyr: 3 });
  const terraneAreas = new Map();
  for (const cell of world.cells) {
    if (cell.crustType !== "continental") continue;
    terraneAreas.set(
      cell.provenanceId,
      (terraneAreas.get(cell.provenanceId) ?? 0) + world.sphere.faces[cell.faceId].areaSteradians,
    );
  }
  assert.ok(terraneAreas.size >= 8);
  assert.ok(world.stats.continentalTerraneCount >= 8);
  assert.ok(world.stats.continentalTerraneCount <= terraneAreas.size);
  const sortedAreas = [...terraneAreas.values()].sort((a, b) => b - a);
  const totalArea = sortedAreas.reduce((sum, area) => sum + area, 0);
  assert.ok(sortedAreas.filter((area) => area >= totalArea * 0.02).length >= 4);
  assert.ok(sortedAreas[0] > sortedAreas[Math.floor(sortedAreas.length / 2)] * 2);
  const sutureEdges = world.sphere.edges.filter((edge) => {
    const first = world.cells[edge.faces[0]];
    const second = world.cells[edge.faces[1]];
    return first.crustType === "continental"
      && second.crustType === "continental"
      && first.provenanceId !== second.provenanceId;
  });
  assert.ok(sutureEdges.length >= 20);
});

test("moving-crust snapshot is conservative and remains the canonical land authority", () => {
  const fixed = simulateTectonicWorld(RECIPE);
  const first = simulateMovingCrustSnapshot(RECIPE, 30);
  const second = simulateMovingCrustSnapshot(RECIPE, 30);
  assert.deepEqual(second, first);
  assert.equal(first.transportModel, "lagrangian-parcel-snapshot-v1");
  assert.ok(first.parcelTransport);
  assert.equal(first.cells.length, first.sphere.faces.length);
  assert.ok(first.parcelTransport.diagnostics.rawGapFaceCount > 0);
  assert.ok(first.parcelTransport.diagnostics.rawOverlapFaceCount > 0);
  assert.equal(first.parcelTransport.diagnostics.resolvedGapFaceCount, 0);
  assert.equal(first.parcelTransport.diagnostics.resolvedOverlapFaceCount, 0);
  assert.ok(first.parcelTransport.diagnostics.maximumParcelAreaResidualSteradians < 1e-12);
  assert.ok(first.parcelTransport.diagnostics.maximumFaceAreaResidualSteradians < 1e-12);
  assert.ok(first.cells.some((cell, faceId) => cell.plateId !== fixed.cells[faceId].plateId));
  assert.ok(first.boundaries.every((boundary) => boundary.ageMyr === 0));
  for (const cell of first.cells) {
    assert.equal(cell.isLand, cell.elevationKm >= first.seaLevelKm);
    assert.equal(cell.waterDepthKm, Math.max(0, first.seaLevelKm - cell.elevationKm));
  }
});

test("coupled history moves plate material and feeds it back into later boundary evolution", () => {
  const recipe = { ...RECIPE, historyMyr: 80, timestepMyr: 2 };
  const fixed = simulateTectonicWorld(recipe);
  const first = simulateCoupledTectonicWorld(recipe);
  const second = simulateCoupledTectonicWorld(recipe);
  assert.deepEqual(second, first);
  assert.equal(first.transportModel, "coupled-conservative-cell-history-v1");
  assert.equal(first.transportHistory.stepCount, 40);
  assert.ok(first.cells.some((cell, faceId) => cell.plateId !== fixed.cells[faceId].plateId));
  assert.ok(first.boundaries.some((boundary) => boundary.ageMyr > 0));
  assert.notDeepEqual(first.boundaries, fixed.boundaries);
});

test("coupled finite-volume transport is local, closed, and preserves fractional material state", () => {
  const world = simulateCoupledTectonicWorld({ ...RECIPE, historyMyr: 80, timestepMyr: 2 });
  const history = world.transportHistory;
  assert.ok(history);
  assert.ok(history.maximumAreaResidualSteradians < 1e-12);
  assert.ok(history.maximumMaterialResidualSteradians < 1e-12);
  assert.equal(history.maximumFaceAreaResidualSteradians, 0);
  assert.equal(history.maximumNonlocalTransportAreaFraction, 0);
  assert.ok(history.maximumCourantNumber > 0 && history.maximumCourantNumber <= 0.45 + 1e-12);
  assert.ok(Math.abs(history.createdAreaSteradians - history.destroyedAreaSteradians) < 1e-10);
  assert.ok(history.maximumTransportDistanceRadians <= Math.max(
    ...world.sphere.edges.map((edge) => edge.arcLengthRadians),
  ) * 1.1);
  for (const cell of world.cells) {
    assert.ok(cell.continentalFraction >= 0 && cell.continentalFraction <= 1);
    assert.equal(cell.crustType, cell.continentalFraction >= 0.5 ? "continental" : "oceanic");
  }
});

test("persistent connected extension produces failed rifts before mature breakup", () => {
  const recipe = { ...RECIPE, timestepMyr: 2 };
  const young = simulateCoupledTectonicWorld({ ...recipe, historyMyr: 18 });
  const mature = simulateCoupledTectonicWorld({ ...recipe, historyMyr: 180 });
  const youngMaximumExposure = Math.max(...young.cells.map((cell) => cell.riftExposureMyr));
  const matureMaximumExposure = Math.max(...mature.cells.map((cell) => cell.riftExposureMyr));
  const matureRiftCells = mature.cells.filter((cell) => cell.riftExposureMyr >= 56);
  const brokenRiftCells = matureRiftCells.filter((cell) => cell.continentalFraction < 0.5);
  const failedRiftCells = mature.cells.filter((cell) =>
    cell.riftExposureMyr >= 18 && cell.continentalFraction >= 0.5);
  assert.ok(youngMaximumExposure < 18);
  assert.ok(matureMaximumExposure > youngMaximumExposure * 5);
  assert.ok(matureRiftCells.length > 0);
  assert.ok(brokenRiftCells.length > 0);
  assert.ok(failedRiftCells.length > 0);
});

test("coupled history rejects timesteps too long for its explicit transport scheme", () => {
  assert.throws(
    () => simulateCoupledTectonicWorld({ ...RECIPE, timestepMyr: 5 }),
    /no greater than 4 Myr/,
  );
});
