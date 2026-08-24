import assert from "node:assert/strict";
import test from "node:test";
import {
  auditParcelRemap,
  createCanonicalLandSampler,
  remappedFacesToCanonicalCells,
} from "../lib/evaluation/parcelRemapConformance.ts";
import { latLonToUnit } from "../lib/spherical/geometry.ts";
import {
  advectCrustParcels,
  angleBetweenUnitVectors,
  createCrustParcels,
  remapCrustParcels,
  simulateTectonicWorld,
} from "../lib/tectonics/index.ts";

function fixture(seed = "PARCEL-CONFORMANCE") {
  const world = simulateTectonicWorld({
    seed,
    subdivisions: 2,
    plateCount: 8,
    historyMyr: 80,
    timestepMyr: 2,
  });
  return { world, parcels: createCrustParcels(world.sphere, world.cells) };
}

test("moving parcels remap deterministically regardless of input order", () => {
  const { world, parcels } = fixture();
  const advected = advectCrustParcels(parcels, world.plates, 18);
  const first = remapCrustParcels(world.sphere, advected);
  const second = remapCrustParcels(world.sphere, [...advected].reverse());
  assert.deepEqual(first, second);
  assert.ok(first.diagnostics.rawGapFaceCount > 0);
  assert.ok(first.diagnostics.rawOverlapFaceCount > 0);
  assert.equal(first.diagnostics.resolvedGapFaceCount, 0);
  assert.equal(first.diagnostics.resolvedOverlapFaceCount, 0);
  assert.equal(first.diagnostics.nonlocalTransportAreaFraction, 0);
  assert.ok(first.diagnostics.p99TransportDistanceRadians
    < first.diagnostics.nonlocalThresholdRadians);
});

test("conservative remap closes area, material moments, coverage, and provenance", () => {
  const { world, parcels } = fixture("CONSERVE-MATERIAL");
  const advected = advectCrustParcels(parcels, world.plates, 24);
  const remap = remapCrustParcels(world.sphere, advected);
  const audit = auditParcelRemap(world.sphere, advected, remap, 1e-10);
  assert.equal(audit.passed, true, audit.failures.join("; "));
  assert.ok(Math.abs(remap.diagnostics.areaResidualSteradians) < 1e-10);
  assert.ok(Math.abs(remap.diagnostics.continentalResidualSteradians) < 1e-10);
  assert.ok(Math.abs(remap.diagnostics.oceanicResidualSteradians) < 1e-10);
  assert.ok(Math.abs(remap.diagnostics.thicknessMomentResidual) < 1e-8);
  assert.ok(Math.abs(remap.diagnostics.densityThicknessMomentResidual) < 1e-4);
  assert.ok(remap.faces.every((face) => face.contributions.length > 0));
});

test("forward/backward Euler transport has no round-trip topology or provenance diffusion", () => {
  const { world, parcels } = fixture("ROUND-TRIP");
  const forward = advectCrustParcels(parcels, world.plates, 30);
  const backward = advectCrustParcels(forward, world.plates, -30);
  for (let index = 0; index < parcels.length; index += 1) {
    assert.equal(backward[index].id, parcels[index].id);
    assert.equal(backward[index].provenanceId, parcels[index].provenanceId);
    assert.ok(angleBetweenUnitVectors(backward[index].position, parcels[index].position) < 1e-12);
  }
  const original = remapCrustParcels(world.sphere, parcels);
  const roundTrip = remapCrustParcels(world.sphere, backward);
  assert.deepEqual(roundTrip.faces, original.faces);
  assert.ok(roundTrip.diagnostics.maximumProvenanceAreaResidualSteradians < 1e-12);
});

test("canonical remapped land is invariant across seam and projection parameterizations", () => {
  const { world, parcels } = fixture("LAND-AUTHORITY");
  const remap = remapCrustParcels(
    world.sphere,
    advectCrustParcels(parcels, world.plates, 12),
  );
  const cells = remappedFacesToCanonicalCells(remap.faces, world.seaLevelKm);
  const sampler = createCanonicalLandSampler(world.sphere, cells);
  for (const [latitude, longitude] of [
    [0.37, Math.PI - 0.19],
    [-0.62, -Math.PI + 0.23],
    [0.81, 0.47],
    [-1.02, -1.37],
  ]) {
    const atlas = latLonToUnit(latitude, longitude);
    const wrappedAtlas = latLonToUnit(latitude, longitude + Math.PI * 2);
    // Equivalent globe reconstruction from latitude and its local XY radius.
    const radial = Math.sqrt(Math.max(0, 1 - Math.sin(latitude) ** 2));
    const globe = [radial * Math.cos(longitude), radial * Math.sin(longitude), Math.sin(latitude)];
    assert.deepEqual(sampler.sample(atlas), sampler.sample(wrappedAtlas));
    assert.deepEqual(sampler.sample(atlas), sampler.sample(globe));
  }
  const eastOfSeam = sampler.sample(latLonToUnit(0.41, Math.PI - 0.08));
  const samePointWrapped = sampler.sample(latLonToUnit(0.41, -Math.PI - 0.08));
  assert.deepEqual(eastOfSeam, samePointWrapped);
});
