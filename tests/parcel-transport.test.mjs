import assert from "node:assert/strict";
import test from "node:test";
import {
  advectCrustParcels,
  almostEqualVec3,
  createCrustParcels,
  createGeodesicSphere,
  remapCrustParcels,
  transportCrustParcels,
} from "../lib/tectonics/index.ts";

function fixture(subdivisions = 2) {
  const sphere = createGeodesicSphere(subdivisions);
  const cells = sphere.faces.map((face) => {
    const continental = face.center[2] > 0.15 || (face.center[0] > 0.7 && face.center[1] < 0);
    return {
      faceId: face.id,
      plateId: face.center[0] >= 0 ? 0 : 1,
      crustType: continental ? "continental" : "oceanic",
      crustAgeMyr: continental ? 900 + face.id % 70 : 20 + face.id % 120,
      thermalAgeMyr: continental ? 650 : 20 + face.id % 120,
      crustThicknessKm: continental ? 34 + (face.id % 5) : 6.5 + (face.id % 3) * 0.2,
      densityKgM3: continental ? 2780 : 2970,
      provenanceId: continental ? 10 + face.id % 3 : 100 + face.id % 5,
      elevationKm: continental ? 0.8 : -4.5,
    };
  });
  const plates = [
    { id: 0, pole: { axis: [0.2, 0.7, 0.4], angularSpeedRadPerMyr: 0.008 } },
    { id: 1, pole: { axis: [-0.6, 0.1, 0.7], angularSpeedRadPerMyr: -0.006 } },
  ];
  return { sphere, cells, plates, parcels: createCrustParcels(sphere, cells) };
}

test("identity parcel remap is exact and preserves persistent material ids", () => {
  const { sphere, parcels } = fixture(2);
  const result = remapCrustParcels(sphere, parcels);
  assert.equal(result.faces.length, sphere.faces.length);
  assert.equal(result.diagnostics.rawGapFaceCount, 0);
  assert.equal(result.diagnostics.rawOverlapFaceCount, 0);
  assert.equal(result.diagnostics.resolvedGapFaceCount, 0);
  assert.equal(result.diagnostics.resolvedOverlapFaceCount, 0);
  for (const face of result.faces) {
    assert.deepEqual(face.contributions, [{ parcelId: face.faceId, areaSteradians: sphere.faces[face.faceId].areaSteradians }]);
    assert.equal(face.dominantParcelId, face.faceId);
  }
});

test("Euler advection is exact, composable, and does not mutate parcel material", () => {
  const { parcels, plates } = fixture(1);
  const whole = advectCrustParcels(parcels, plates, 40);
  const halves = advectCrustParcels(advectCrustParcels(parcels, plates, 15), plates, 25);
  for (let index = 0; index < parcels.length; index += 1) {
    assert.ok(almostEqualVec3(whole[index].position, halves[index].position, 2e-12));
    assert.equal(whole[index].id, parcels[index].id);
    assert.equal(whole[index].sourceFaceId, parcels[index].sourceFaceId);
    assert.equal(whole[index].crustType, parcels[index].crustType);
    assert.equal(whole[index].crustThicknessKm, parcels[index].crustThicknessKm);
    assert.equal(whole[index].provenanceId, parcels[index].provenanceId);
  }
});

test("conservative remap explicitly resolves raw gaps and overlaps with closed budgets", () => {
  const { sphere, parcels, plates } = fixture(2);
  const result = transportCrustParcels(sphere, parcels, plates, 55);
  const diagnostics = result.diagnostics;
  assert.ok(diagnostics.rawGapFaceCount > 0);
  assert.ok(diagnostics.rawOverlapFaceCount > 0);
  assert.equal(diagnostics.resolvedGapFaceCount, 0);
  assert.equal(diagnostics.resolvedOverlapFaceCount, 0);
  assert.ok(Math.abs(diagnostics.areaResidualSteradians) < 1e-12);
  assert.ok(Math.abs(diagnostics.continentalResidualSteradians) < 1e-12);
  assert.ok(Math.abs(diagnostics.oceanicResidualSteradians) < 1e-12);
  assert.ok(Math.abs(diagnostics.thicknessMomentResidual) < 1e-10);
  assert.ok(Math.abs(diagnostics.densityThicknessMomentResidual)
    < Math.abs(diagnostics.source.densityThicknessMoment) * 1e-12);
  assert.ok(diagnostics.maximumParcelAreaResidualSteradians < 1e-12);
  assert.ok(diagnostics.maximumFaceAreaResidualSteradians < 1e-12);
  assert.ok(diagnostics.maximumProvenanceAreaResidualSteradians < 1e-12);
  assert.equal(diagnostics.nonlocalTransportAreaFraction, 0);
  assert.ok(diagnostics.p99TransportDistanceRadians < diagnostics.nonlocalThresholdRadians);
  for (const face of result.faces) {
    const assigned = face.contributions.reduce((sum, contribution) => sum + contribution.areaSteradians, 0);
    assert.ok(Math.abs(assigned - sphere.faces[face.faceId].areaSteradians) < 1e-12);
  }
});

test("conservative remap is deterministic under parcel input permutation", () => {
  const { sphere, parcels, plates } = fixture(2);
  const advected = advectCrustParcels(parcels, plates, 37);
  const first = remapCrustParcels(sphere, advected);
  const second = remapCrustParcels(sphere, [...advected].reverse());
  assert.deepEqual(second, first);
});
