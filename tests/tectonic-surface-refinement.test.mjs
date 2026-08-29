import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRefinement } from "../lib/tectonics/surfaceRefinement.ts";
import { normalize3 } from "../lib/tectonics/vector.ts";
import { simulateTectonicWorld } from "../lib/tectonics/worldSimulation.ts";

const world = simulateTectonicWorld({
  seed: "surface-refinement-test",
  subdivisions: 2,
  plateCount: 8,
  historyMyr: 60,
  timestepMyr: 3,
});

test("surface refinement is deterministic and retains canonical authority metadata", () => {
  const refinement = createSurfaceRefinement(world);
  const direction = normalize3([0.31, -0.72, 0.44]);
  const first = refinement.sample(direction);
  const second = refinement.sample(direction);
  assert.deepEqual(first, second);
  assert.equal(first.presentationOnly, true);
  assert.equal(first.canonicalIsLand, world.cells[first.canonicalFaceId].isLand);
  assert.ok(Number.isFinite(first.elevationKm));
});

test("canonical face centers remain topology anchors", () => {
  const audit = createSurfaceRefinement(world, { coastAmplitude: 0.24 }).audit();
  assert.equal(audit.canonicalAnchorMismatches, 0);
  assert.equal(audit.topologyAnchorsPreserved, true);
  assert.ok(audit.maximumOffsetRatio <= 0.2400001);
});

test("coast displacement vanishes at canonical edge vertices", () => {
  const refinement = createSurfaceRefinement(world);
  const cells = new Map(world.cells.map((cell) => [cell.faceId, cell]));
  const coast = world.sphere.edges.find((edge) => cells.get(edge.faces[0]).isLand !== cells.get(edge.faces[1]).isLand);
  assert.ok(coast);
  for (const vertexId of coast.vertices) {
    const sample = refinement.sample(world.sphere.vertices[vertexId].position);
    assert.ok(Math.abs(sample.coastOffsetRadians) < 1e-10);
  }
});

test("non-coastal canonical faces are never reclassified", () => {
  const refinement = createSurfaceRefinement(world);
  const cells = new Map(world.cells.map((cell) => [cell.faceId, cell]));
  const coastalFaces = new Set();
  for (const edge of world.sphere.edges) {
    if (cells.get(edge.faces[0]).isLand !== cells.get(edge.faces[1]).isLand) {
      coastalFaces.add(edge.faces[0]);
      coastalFaces.add(edge.faces[1]);
    }
  }
  for (const face of world.sphere.faces) {
    if (coastalFaces.has(face.id)) continue;
    const sample = refinement.sample(face.center);
    assert.equal(sample.isLand, cells.get(face.id).isLand);
    assert.equal(sample.signedCoastDistanceRadians, null);
  }
});

test("additional coast bands add bounded deterministic detail without moving anchors", () => {
  const cells = new Map(world.cells.map((cell) => [cell.faceId, cell]));
  const coast = world.sphere.edges.find((edge) => cells.get(edge.faces[0]).isLand !== cells.get(edge.faces[1]).isLand);
  assert.ok(coast);
  const threeBand = createSurfaceRefinement(world, { coastOctaves: 3 });
  const fiveBand = createSurfaceRefinement(world, { coastOctaves: 5 });
  const [a, b] = coast.vertices.map((vertexId) => world.sphere.vertices[vertexId].position);
  let difference = 0;
  for (let step = 0; step <= 128; step += 1) {
    const progress = step / 128;
    const direction = normalize3([
      a[0] * (1 - progress) + b[0] * progress,
      a[1] * (1 - progress) + b[1] * progress,
      a[2] * (1 - progress) + b[2] * progress,
    ]);
    difference += Math.abs(
      fiveBand.sample(direction).coastOffsetRadians
      - threeBand.sample(direction).coastOffsetRadians,
    );
  }
  assert.ok(difference > 1e-7);
  assert.equal(threeBand.audit().topologyAnchorsPreserved, true);
  assert.equal(fiveBand.audit().topologyAnchorsPreserved, true);
  assert.ok(fiveBand.audit().maximumOffsetRatio <= 0.2400001);
});

test("coastal geomorphology changes edge spectra without changing topology anchors", () => {
  const baseline = createSurfaceRefinement(world, {
    coastOctaves: 5,
    coastalGeomorphologyScale: 0,
  });
  const geomorphic = createSurfaceRefinement(world, {
    coastOctaves: 5,
    coastalGeomorphologyScale: 1,
  });
  const cells = new Map(world.cells.map((cell) => [cell.faceId, cell]));
  let difference = 0;
  let samples = 0;
  for (const edge of world.sphere.edges) {
    if (cells.get(edge.faces[0]).isLand === cells.get(edge.faces[1]).isLand) continue;
    const [a, b] = edge.vertices.map((vertexId) => world.sphere.vertices[vertexId].position);
    for (let step = 1; step < 16; step += 1) {
      const progress = step / 16;
      const direction = normalize3([
        a[0] * (1 - progress) + b[0] * progress,
        a[1] * (1 - progress) + b[1] * progress,
        a[2] * (1 - progress) + b[2] * progress,
      ]);
      const plain = baseline.sample(direction);
      const shaped = geomorphic.sample(direction);
      difference += Math.abs(shaped.coastOffsetRadians - plain.coastOffsetRadians);
      assert.ok(shaped.coastalRuggedness >= 0 && shaped.coastalRuggedness <= 1);
      assert.ok(shaped.coastalSedimentAffinity >= 0 && shaped.coastalSedimentAffinity <= 1);
      assert.ok(shaped.activeMarginStrength >= 0 && shaped.activeMarginStrength <= 1);
      assert.ok(shaped.passiveMarginStrength >= 0 && shaped.passiveMarginStrength <= 1);
      samples += 1;
    }
  }
  assert.ok(samples > 0);
  assert.ok(difference > 1e-7);
  assert.equal(geomorphic.audit().canonicalAnchorMismatches, 0);
  assert.ok(geomorphic.audit().maximumOffsetRatio <= 0.2400001);
});
