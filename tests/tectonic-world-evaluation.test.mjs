import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTectonicWorld,
  rankAcceptedWorlds,
  rasterizeFaceBasedWorld,
} from "../lib/evaluation/index.ts";
import {
  createGeodesicSphere,
  simulateCoupledTectonicWorld,
  simulateMovingCrustSnapshot,
  simulateTectonicWorld,
} from "../lib/tectonics/index.ts";

const analysisOptions = {
  width: 180,
  height: 90,
  morphology: { scalesKm: [800, 1_200, 1_800] },
};

test("canonical face fields rasterize deterministically without changing land authority", () => {
  const world = simulateTectonicWorld({ seed: "RASTER-AUTHORITY" });
  const first = rasterizeFaceBasedWorld(world, analysisOptions);
  const second = rasterizeFaceBasedWorld(world, analysisOptions);
  assert.deepEqual(first, second);
  assert.equal(first.land.length, analysisOptions.width * analysisOptions.height);
  assert.ok(first.faceIds.every((faceId) => faceId >= 0 && faceId < world.sphere.faces.length));

  const report = evaluateTectonicWorld(world, analysisOptions);
  assert.equal(report.geology.elevation.canonicalLandElevationMismatchFraction, 0);
  assert.ok(Math.abs(report.morphology.landFraction - world.stats.landFraction) < 0.02,
    `raster/sphere land fractions were ${report.morphology.landFraction} and ${world.stats.landFraction}`);
});

test("default prototype exposes an internally consistent acceptance report", () => {
  const world = simulateTectonicWorld();
  const report = evaluateTectonicWorld(world, analysisOptions);
  assert.equal(report.accepted, report.hardFailures.length === 0);
  assert.ok(report.morphology.componentCount >= 1);
  assert.ok(report.morphology.majorComponentCount >= 1);
  assert.ok(report.morphology.maximumMajorElongation >= 1);
  assert.ok(report.morphology.ribbonSeverity >= 0);
  assert.ok(report.morphology.neckSplitPersistence >= 0);
  assert.ok(Number.isFinite(report.morphology.openGulfSeverity));
  assert.equal(report.geology.boundaries.count, world.boundaries.length);
  assert.ok(report.geology.boundaries.totalLengthKm > 0);
  assert.ok(report.geology.provenance.landCount >= 2);
});

test("multi-seed acceptance reports and ranking are deterministic", () => {
  const permissiveThresholds = {
    minimumLandFraction: 0.01,
    maximumLandFraction: 0.99,
    minimumMajorComponentCount: 1,
    maximumMajorComponentCount: 100,
    minimumEffectiveComponentCount: 0,
    maximumLargestLandmassShare: 1,
    maximumPolarLandFraction: 1,
    maximumZonalLandFraction: 1,
    maximumMajorElongation: 100,
    maximumMajorDiameterRatio: 100,
    maximumRibbonSeverity: 100,
    maximumNeckSplitPersistence: 100,
    maximumOpenGulfSeverity: 100,
    minimumCoastlineRichness: 0,
    maximumLandElevationMismatchFraction: 0,
    minimumLandProvenanceCount: 1,
  };
  const evaluateSeeds = () => ["EPOCH-11", "EPOCH-29", "EPOCH-47"].map((seed) =>
    evaluateTectonicWorld(simulateTectonicWorld({ seed }), {
      ...analysisOptions,
      width: 120,
      height: 60,
      morphology: { scalesKm: [1_200, 1_800, 2_400] },
      thresholds: permissiveThresholds,
    }));
  const first = rankAcceptedWorlds(evaluateSeeds());
  const second = rankAcceptedWorlds(evaluateSeeds());
  assert.equal(first.length, 3);
  assert.deepEqual(
    first.map(({ seed, selectionScore }) => [seed, selectionScore]),
    second.map(({ seed, selectionScore }) => [seed, selectionScore]),
  );
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(first[index - 1].selectionScore >= first[index].selectionScore);
  }
});

test("coupled reference ensemble retains multiple compact continental systems", () => {
  const reports = ["primeval-atlas-7", "EPOCH-11", "ATLAS-A"].map((seed) =>
    evaluateTectonicWorld(simulateCoupledTectonicWorld({
      seed,
      subdivisions: 3,
      plateCount: 14,
      historyMyr: 120,
      timestepMyr: 2,
      oceanFraction: 0.68,
    }), {
      width: 240,
      height: 120,
      morphology: { scalesKm: [800, 1_200, 1_800] },
    }));
  assert.ok(reports.every((report) => report.accepted), reports
    .flatMap((report) => report.hardFailures.map((failure) => `${report.seed}: ${failure}`))
    .join("\n"));
  assert.ok(reports.every((report) => report.morphology.majorComponentCount >= 3));
  assert.ok(reports.every((report) => report.morphology.maximumMajorElongation < 3));
});

test("evaluation rejects incomplete or duplicate canonical face data", () => {
  const world = simulateTectonicWorld({ subdivisions: 1, plateCount: 5, historyMyr: 20 });
  assert.throws(
    () => rasterizeFaceBasedWorld({ ...world, cells: world.cells.slice(1) }, { width: 32, height: 16 }),
    /exactly one canonical cell/,
  );
  const duplicate = [world.cells[0], ...world.cells.slice(0, -1)];
  assert.throws(
    () => rasterizeFaceBasedWorld({ ...world, cells: duplicate }, { width: 32, height: 16 }),
    /duplicate world faceId/,
  );
});

test("a near-circular canonical continent fails the resolved coastline-richness gate", () => {
  const sphere = createGeodesicSphere(4);
  const cosineRadius = Math.cos(28 * Math.PI / 180);
  const cells = sphere.faces.map((face) => {
    const isLand = face.center[0] >= cosineRadius;
    return {
      faceId: face.id,
      plateId: face.center[1] >= 0 ? 0 : 1,
      crustType: isLand ? "continental" : "oceanic",
      provenanceId: isLand ? face.id % 3 : 10,
      elevationKm: isLand ? 1 : -4,
      isLand,
    };
  });
  const report = evaluateTectonicWorld({
    sphere,
    cells,
    boundaries: [],
    seaLevelKm: 0,
    recipe: { radiusKm: 6371, seed: "ROUND-DISK" },
  }, {
    width: 360,
    height: 180,
    morphology: { scalesKm: [400, 800, 1_200] },
  });
  assert.ok(report.morphology.minimumMajorGeodesicSolidity > 0.85);
  assert.ok(report.morphology.coastlineRichness < 0.25,
    `round-disk richness was ${report.morphology.coastlineRichness}`);
  assert.ok(report.hardFailures.some((failure) => failure.includes("coastline richness")));
});

test("placement gates reject a visually dominant polar cap", () => {
  const sphere = createGeodesicSphere(4);
  const cells = sphere.faces.map((face) => {
    const isLand = face.center[2] > Math.sin(55 * Math.PI / 180);
    return {
      faceId: face.id,
      plateId: face.id % 4,
      crustType: isLand ? "continental" : "oceanic",
      provenanceId: face.id % 5,
      elevationKm: isLand ? 1 : -4,
      isLand,
    };
  });
  const report = evaluateTectonicWorld({
    sphere,
    cells,
    boundaries: [],
    seaLevelKm: 0,
    recipe: { radiusKm: 6371, seed: "POLAR-CAP" },
  }, {
    width: 240,
    height: 120,
    thresholds: {
      minimumLandFraction: 0,
      minimumMajorComponentCount: 1,
      minimumEffectiveComponentCount: 0,
      maximumLargestLandmassShare: 1,
      minimumCoastlineRichness: 0,
    },
  });
  assert.ok(report.placement.polarLandFraction > 0.3);
  assert.ok(report.hardFailures.some((failure) => failure.includes("polar land fraction")));
});

test("visually fragmented moving snapshots fail the coastline fine-noise gate", () => {
  const world = simulateMovingCrustSnapshot({ seed: "EPOCH-11", subdivisions: 4 }, 25);
  const report = evaluateTectonicWorld(world, {
    width: 240,
    height: 120,
    morphology: { scalesKm: [50, 80, 120, 180, 300, 500, 800, 1_200, 1_800] },
  });
  assert.ok(report.morphology.coastlineFineNoiseFraction > 0.55);
  assert.ok(report.hardFailures.some((failure) => failure.includes("fine-noise")));
  assert.equal(report.accepted, false);
});
