import assert from "node:assert/strict";
import test from "node:test";
import {
  almostEqualVec3,
  boundaryGeometryFromEdge,
  classifyBoundaryKinematics,
  createBoundaryState,
  createGeodesicSphere,
  createOceanConveyor,
  geodesicDistanceKm,
  rotateByEulerPole,
  stepOceanConveyor,
  updateBoundaryState,
} from "../lib/tectonics/index.ts";

const EARTH_RADIUS_KM = 6371;

test("geodesic sphere is a closed deterministic partition with solid-angle area", () => {
  for (const subdivisions of [0, 1, 2]) {
    const mesh = createGeodesicSphere(subdivisions);
    const scale = 4 ** subdivisions;
    assert.equal(mesh.vertices.length, 10 * scale + 2);
    assert.equal(mesh.edges.length, 30 * scale);
    assert.equal(mesh.faces.length, 20 * scale);
    assert.ok(Math.abs(mesh.totalAreaSteradians - 4 * Math.PI) < 1e-11);
    assert.ok(mesh.edges.every((edge) => edge.faces.length === 2));
    assert.ok(mesh.faces.every((face) => face.areaSteradians > 0));
  }
  assert.deepEqual(createGeodesicSphere(2), createGeodesicSphere(2));
});

test("geodesic distance uses a great-circle arc rather than a planar projection", () => {
  const quarterCircumference = geodesicDistanceKm([1, 0, 0], [0, 1, 0], EARTH_RADIUS_KM);
  assert.ok(Math.abs(quarterCircumference - Math.PI * EARTH_RADIUS_KM / 2) < 1e-9);
});

test("finite Euler rotations stay on the sphere and compose exactly", () => {
  const pole = { axis: [0, 0, 1], angularSpeedRadPerMyr: Math.PI / 4 };
  const quarterTurn = rotateByEulerPole([1, 0, 0], pole, 2);
  assert.ok(almostEqualVec3(quarterTurn, [0, 1, 0], 1e-12));
  const twoSteps = rotateByEulerPole(rotateByEulerPole([1, 0, 0], pole, 0.5), pole, 1.5);
  assert.ok(almostEqualVec3(twoSteps, quarterTurn, 1e-12));
});

const boundary = {
  point: [1, 0, 0],
  tangent: [0, 0, 1],
  plateASidePoint: [1, 0.1, 0],
  plateBSidePoint: [1, -0.1, 0],
};

test("relative Euler motion classifies divergent, convergent, and transform boundaries", () => {
  const fixed = { axis: [0, 0, 1], angularSpeedRadPerMyr: 0 };
  const movingAway = { axis: [0, 0, 1], angularSpeedRadPerMyr: -0.01 };
  const movingToward = { axis: [0, 0, 1], angularSpeedRadPerMyr: 0.01 };
  const alongBoundary = { axis: [0, 1, 0], angularSpeedRadPerMyr: 0.01 };
  const thresholds = {
    normalEnterKmPerMyr: 10,
    normalExitKmPerMyr: 5,
    transformEnterKmPerMyr: 10,
    transformExitKmPerMyr: 5,
  };
  assert.equal(classifyBoundaryKinematics(boundary, fixed, movingAway, EARTH_RADIUS_KM, thresholds).kind, "divergent");
  assert.equal(classifyBoundaryKinematics(boundary, fixed, movingToward, EARTH_RADIUS_KM, thresholds).kind, "convergent");
  assert.equal(classifyBoundaryKinematics(boundary, fixed, alongBoundary, EARTH_RADIUS_KM, thresholds).kind, "transform");
});

test("a geodesic edge produces an oriented tangent-plane boundary frame", () => {
  const sphere = createGeodesicSphere(1);
  const edge = sphere.edges[7];
  const geometry = boundaryGeometryFromEdge(sphere, edge.id, edge.faces[1]);
  const pointLength = Math.hypot(...geometry.point);
  const tangentDotPoint = geometry.tangent.reduce(
    (sum, value, index) => sum + value * geometry.point[index],
    0,
  );
  assert.ok(Math.abs(pointLength - 1) < 1e-12);
  assert.ok(Math.abs(tangentDotPoint) < 1e-12);
});

test("boundary state requires persistence and retains inherited types inside exit thresholds", () => {
  const fixed = { axis: [0, 0, 1], angularSpeedRadPerMyr: 0 };
  const strongDivergence = { axis: [0, 0, 1], angularSpeedRadPerMyr: -0.01 };
  const weakDivergence = { axis: [0, 0, 1], angularSpeedRadPerMyr: -0.0012 };
  const thresholds = {
    normalEnterKmPerMyr: 10,
    normalExitKmPerMyr: 5,
    transformEnterKmPerMyr: 10,
    transformExitKmPerMyr: 5,
  };
  let state = createBoundaryState();
  let update = updateBoundaryState(state, boundary, fixed, strongDivergence, EARTH_RADIUS_KM, {
    thresholds,
    confirmationSteps: 2,
  });
  assert.equal(update.state.kind, "stable");
  assert.equal(update.state.pendingKind, "divergent");
  update = updateBoundaryState(update.state, boundary, fixed, strongDivergence, EARTH_RADIUS_KM, {
    thresholds,
    confirmationSteps: 2,
  });
  assert.equal(update.state.kind, "divergent");
  update = updateBoundaryState(update.state, boundary, fixed, weakDivergence, EARTH_RADIUS_KM, {
    thresholds,
    confirmationSteps: 2,
  });
  assert.equal(update.kinematics.kind, "divergent");
  assert.equal(update.state.kind, "divergent");
});

test("ocean conveyor creates age-zero ridge crust and orders age toward subduction", () => {
  const config = {
    ridgePoint: [1, 0, 0],
    spreadingDirection: [0, 1, 0],
    basinHalfWidthRadians: 0.05,
    alongRidgeHalfSpanRadians: 0.4,
    halfSpreadingRateRadPerMyr: 0.005,
    timestepMyr: 1,
  };
  const state = stepOceanConveyor(createOceanConveyor(config), 6);
  for (const side of [-1, 1]) {
    const parcels = state.parcels.filter((parcel) => parcel.side === side);
    assert.equal(parcels[0].ageMyr, 0);
    for (let index = 1; index < parcels.length; index += 1) {
      assert.ok(parcels[index].ageMyr > parcels[index - 1].ageMyr);
      assert.ok(parcels[index].innerDistanceRadians >= parcels[index - 1].outerDistanceRadians - 1e-14);
    }
  }
  assert.ok(Math.abs(state.budget.residualAreaSteradians) < 1e-12);
});

test("ocean conveyor reaches steady area while subduction balances creation", () => {
  const config = {
    ridgePoint: [1, 0, 0],
    spreadingDirection: [0, 1, 0],
    basinHalfWidthRadians: 0.04,
    alongRidgeHalfSpanRadians: 0.5,
    halfSpreadingRateRadPerMyr: 0.004,
    timestepMyr: 1,
  };
  const filled = stepOceanConveyor(createOceanConveyor(config), 10);
  const steady = stepOceanConveyor(filled, 5);
  const expectedArea = 4 * Math.sin(config.alongRidgeHalfSpanRadians) * config.basinHalfWidthRadians;
  assert.ok(Math.abs(filled.budget.activeAreaSteradians - expectedArea) < 1e-12);
  assert.ok(Math.abs(steady.budget.activeAreaSteradians - expectedArea) < 1e-12);
  assert.ok(Math.abs(steady.budget.createdAreaSteradians - steady.budget.subductedAreaSteradians) < 1e-12);
  assert.ok(Math.abs(steady.budget.residualAreaSteradians) < 1e-12);
  assert.ok(steady.cumulativeSubductedAreaSteradians > 0);
});
