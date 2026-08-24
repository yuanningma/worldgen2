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
