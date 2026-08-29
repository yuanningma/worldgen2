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

test("quiet continental margins form bounded coastal plains without changing coast topology", () => {
  const baseline = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    coastalPlainScale: 0,
  });
  const shaped = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    coastalPlainScale: 1,
  });
  assert.deepEqual(
    shaped.cells.map((cell) => cell.isLand),
    baseline.cells.map((cell) => cell.isLand),
  );
  assert.equal(shaped.stats.canonicalAnchorMismatches, 0);
  assert.ok(shaped.stats.activeMarginCellCount > 0);
  assert.ok(shaped.stats.passiveMarginCellCount > 0);
  assert.ok(shaped.stats.coastalPlainCellCount > 0);
  assert.ok(shaped.stats.coastalPlainAreaKm2 > 0);
  assert.ok(shaped.stats.maximumCoastalPlainLoweringKm > 0);
  assert.equal(baseline.stats.maximumCoastalPlainLoweringKm, 0);
  assert.ok(shaped.cells.every((cell) => cell.activeMarginStrength >= 0
    && cell.activeMarginStrength <= 1
    && cell.passiveMarginStrength >= 0
    && cell.passiveMarginStrength <= 1
    && cell.coastalPlainStrength >= 0
    && cell.coastalPlainStrength <= 1
    && cell.coastalPlainReliefKm <= 1e-12));
  assert.ok(shaped.cells.filter((cell) => cell.marginRegime === "active")
    .every((cell) => cell.coastalPlainReliefKm === 0));
  assert.ok(shaped.cells.some((cell, faceId) => (
    cell.coastalPlainReliefKm < -0.01
      && cell.elevationKm < baseline.cells[faceId].elevationKm
  )));
});

test("annual physical atlas derives closed biome areas and inland lakes", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const expectedAreaKm2 = surface.sphere.totalAreaSteradians * tectonic.recipe.radiusKm ** 2;
  const biomeAreaKm2 = Object.values(surface.stats.biomeAreaKm2)
    .reduce((sum, area) => sum + area, 0);
  assert.ok(Math.abs(biomeAreaKm2 - expectedAreaKm2) <= expectedAreaKm2 * 1e-12);
  assert.ok(Object.values(surface.stats.biomeAreaKm2).filter((area) => area > 0).length >= 9);
  assert.ok(surface.cells.every((cell) => Number.isFinite(cell.aridityIndex)
    && cell.aridityIndex >= 0
    && cell.aridityIndex <= 3));
  const lakes = surface.cells.filter((cell) => cell.isLake);
  assert.equal(lakes.length, surface.stats.lakeCellCount);
  assert.ok(lakes.every((cell) => cell.isLand
    && cell.biome === "freshwater-lake"
    && cell.lakeDepthKm > 0));
  assert.ok(surface.cells.filter((cell) => !cell.isLake)
    .every((cell) => cell.biome !== "freshwater-lake"));
  const expectedLakeAreaKm2 = lakes.reduce(
    (sum, cell) => sum + surface.sphere.faces[cell.faceId].areaSteradians * tectonic.recipe.radiusKm ** 2,
    0,
  );
  assert.ok(Math.abs(expectedLakeAreaKm2 - surface.stats.lakeAreaKm2)
    <= Math.max(1e-9, expectedLakeAreaKm2 * 1e-12));
  assert.ok(Math.abs(surface.stats.biomeAreaKm2["freshwater-lake"] - surface.stats.lakeAreaKm2)
    <= Math.max(1e-9, surface.stats.lakeAreaKm2 * 1e-12));
  assert.equal(
    surface.stats.closedLakeBodyCount + surface.stats.overflowingLakeBodyCount,
    surface.stats.lakeBodyCount,
  );
  assert.ok(surface.stats.lakeBodyCount > 0);
  assert.ok(surface.stats.lakeEvaporationKm3PerYear > 0);
  assert.equal(surface.lakes.length, surface.stats.lakeBodyCount);
  const bodyFaceIds = surface.lakes.flatMap((lake) => lake.faceIds).sort((a, b) => a - b);
  assert.equal(new Set(bodyFaceIds).size, bodyFaceIds.length);
  assert.deepEqual(bodyFaceIds, lakes.map((cell) => cell.faceId).sort((a, b) => a - b));
  assert.equal(
    surface.lakes.filter((lake) => lake.regime === "closed").length,
    surface.stats.closedLakeBodyCount,
  );
  assert.equal(
    surface.lakes.filter((lake) => lake.regime === "overflowing").length,
    surface.stats.overflowingLakeBodyCount,
  );
  assert.ok(surface.lakes.every((lake) => lake.areaKm2 > 0
    && lake.volumeKm3 > 0
    && lake.maximumDepthKm > 0
    && lake.inflowKm3PerYear >= lake.evaporationKm3PerYear
    && lake.structuralSupport >= 0
    && lake.structuralSupport <= 1));
  const totalLakeVolumeKm3 = surface.lakes.reduce((sum, lake) => sum + lake.volumeKm3, 0);
  const largestLakeAreaKm2 = Math.max(...surface.lakes.map((lake) => lake.areaKm2));
  const largestLakeVolumeKm3 = Math.max(...surface.lakes.map((lake) => lake.volumeKm3));
  assert.ok(Math.abs(totalLakeVolumeKm3 - surface.stats.totalLakeVolumeKm3)
    <= Math.max(1e-9, totalLakeVolumeKm3 * 1e-12));
  assert.equal(largestLakeAreaKm2, surface.stats.largestLakeAreaKm2);
  assert.equal(largestLakeVolumeKm3, surface.stats.largestLakeVolumeKm3);
  assert.ok(Math.abs(surface.stats.dominantLakeAreaFraction
    - largestLakeAreaKm2 / surface.stats.lakeAreaKm2) <= 1e-12);
});

test("annual lake equilibrium responds causally to open-water evaporation", () => {
  const lowEvaporation = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    openWaterEvaporationScale: 0.6,
  });
  const highEvaporation = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    openWaterEvaporationScale: 1.8,
  });
  assert.ok(highEvaporation.stats.lakeAreaKm2 <= lowEvaporation.stats.lakeAreaKm2);
  assert.ok(highEvaporation.stats.lakeCellCount <= lowEvaporation.stats.lakeCellCount);
  assert.ok(lowEvaporation.stats.lakeBodyCount > 0);
  assert.ok(highEvaporation.stats.lakeBodyCount > 0);
});

test("hybrid depression evolution breaches weak wet basins and retains supported lakes", () => {
  const hybrid = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    depressionEvolution: "hybrid",
  });
  const noLargeBasinPressure = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    depressionEvolution: "hybrid",
    largeBasinOutletScale: 0,
  });
  const fillOnly = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    depressionEvolution: "fill-only",
  });
  assert.deepEqual(
    hybrid.cells.map((cell) => cell.isLand),
    fillOnly.cells.map((cell) => cell.isLand),
  );
  assert.ok(hybrid.stats.breachedBasinCount > 0);
  assert.ok(hybrid.stats.preservedBasinCount > 0);
  assert.equal(fillOnly.stats.breachedBasinCount, 0);
  assert.equal(
    hybrid.stats.breachedBasinCount + hybrid.stats.preservedBasinCount,
    fillOnly.stats.preservedBasinCount,
  );
  assert.ok(hybrid.stats.lakeAreaKm2 < fillOnly.stats.lakeAreaKm2);
  assert.ok(hybrid.stats.lakeBodyCount < fillOnly.stats.lakeBodyCount);
  assert.ok(hybrid.stats.breachedBasinCount >= noLargeBasinPressure.stats.breachedBasinCount);
  assert.ok(hybrid.stats.preservedBasinCount <= noLargeBasinPressure.stats.preservedBasinCount);
  assert.ok(hybrid.stats.lakeAreaKm2 < noLargeBasinPressure.stats.lakeAreaKm2);
  assert.ok(hybrid.stats.largestLakeAreaKm2 <= noLargeBasinPressure.stats.largestLakeAreaKm2);
  assert.deepEqual(
    hybrid.cells.map((cell) => cell.isLand),
    noLargeBasinPressure.cells.map((cell) => cell.isLand),
  );
  assert.ok(hybrid.stats.spillwayCellCount > 0);
  assert.ok(hybrid.stats.spillwayExcavatedVolumeKm3 > 0);
  assert.ok(hybrid.stats.maximumSpillwayIncisionKm > 0);
  assert.equal(fillOnly.stats.spillwayCellCount, 0);
  assert.equal(fillOnly.stats.spillwayExcavatedVolumeKm3, 0);
  const spillways = hybrid.cells.filter((cell) => cell.spillwayIncisionKm > 0);
  assert.equal(spillways.length, hybrid.stats.spillwayCellCount);
  assert.ok(spillways.every((cell) => cell.isLand && cell.spillwayIncisionKm < 1));
  const excavatedVolumeKm3 = spillways.reduce(
    (sum, cell) => sum + cell.spillwayIncisionKm
      * hybrid.sphere.faces[cell.faceId].areaSteradians * tectonic.recipe.radiusKm ** 2,
    0,
  );
  assert.ok(Math.abs(excavatedVolumeKm3 - hybrid.stats.spillwayExcavatedVolumeKm3)
    <= hybrid.stats.spillwayExcavatedVolumeKm3 * 1e-12);
});

test("large wet basin outlets evolve causally across deterministic worlds", () => {
  for (const seed of ["LAKE-EPOCH-A", "LAKE-EPOCH-B", "LAKE-EPOCH-C"]) {
    const world = simulateTectonicWorld({
      seed,
      subdivisions: 3,
      plateCount: 11,
      historyMyr: 180,
      timestepMyr: 3,
      oceanFraction: 0.68,
    });
    const control = createSurfaceProcessWorld(world, {
      subdivisions: 4,
      largeBasinOutletScale: 0,
    });
    const evolved = createSurfaceProcessWorld(world, { subdivisions: 4 });
    assert.deepEqual(
      evolved.cells.map((cell) => cell.isLand),
      control.cells.map((cell) => cell.isLand),
    );
    assert.ok(evolved.stats.breachedBasinCount >= control.stats.breachedBasinCount);
    assert.ok(evolved.stats.preservedBasinCount <= control.stats.preservedBasinCount);
    assert.ok(evolved.stats.lakeAreaKm2 < control.stats.lakeAreaKm2);
    assert.ok(evolved.stats.largestLakeAreaKm2 <= control.stats.largestLakeAreaKm2);
    assert.ok(evolved.stats.lakeBodyCount > 0);
    assert.ok(Math.abs(evolved.stats.runoffResidualKm3PerYear) <= 1e-8);
  }
});

test("spherical circulation creates longitudinal rainfall structure and orographic enhancement", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const land = surface.cells.filter((cell) => cell.isLand);
  assert.ok(land.every((cell) => Number.isFinite(cell.atmosphericMoisture)
    && cell.atmosphericMoisture >= 0
    && cell.atmosphericMoisture <= 1));
  assert.ok(land.every((cell) => Number.isFinite(cell.orographicLiftKm) && cell.orographicLiftKm >= 0));
  assert.ok(land.every((cell) => Number.isFinite(cell.continentality)
    && cell.continentality >= 0
    && cell.continentality <= 1));
  assert.ok(land.every((cell) => Number.isFinite(cell.seasonalTemperatureRangeC)
    && cell.seasonalTemperatureRangeC >= 4
    && cell.seasonalTemperatureRangeC <= 60));
  assert.ok(surface.cells.filter((cell) => !cell.isLand).every((cell) => cell.continentality === 0));
  assert.ok(surface.stats.meanLandSeasonalTemperatureRangeC > 6);
  assert.ok(surface.stats.meanLandSeasonalTemperatureRangeC < 55);
  assert.ok(Math.max(...land.map((cell) => cell.coastDistanceKm)) > 200);
  assert.ok(Math.max(...land.map((cell) => cell.continentality)) > 0.15);
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

test("fine drainage inherits coarse continental divides while refining local channels", () => {
  const coarse = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const fine = createSurfaceProcessWorld(tectonic, { subdivisions: 5 });
  const descendantsPerAnchor = 4;
  const oceanChildByAnchor = new Uint8Array(coarse.cells.length);
  for (const cell of fine.cells) {
    if (!cell.isLand) oceanChildByAnchor[Math.floor(cell.faceId / descendantsPerAnchor)] = 1;
  }
  let inheritedCrossings = 0;
  for (const cell of fine.cells) {
    const lakeAnchor = coarse.cells[Math.floor(cell.faceId / descendantsPerAnchor)];
    assert.equal(cell.isLake, cell.isLand && lakeAnchor.isLake);
    assert.equal(
      cell.lakeSurfaceDepthThresholdKm,
      lakeAnchor.lakeSurfaceDepthThresholdKm,
    );
    if (!cell.isLand || cell.receiverFaceId === null) continue;
    const sourceAnchorId = Math.floor(cell.faceId / descendantsPerAnchor);
    const receiverAnchorId = Math.floor(cell.receiverFaceId / descendantsPerAnchor);
    if (sourceAnchorId === receiverAnchorId
      || !coarse.cells[sourceAnchorId].isLand
      || oceanChildByAnchor[sourceAnchorId] !== 0) continue;
    assert.equal(receiverAnchorId, coarse.cells[sourceAnchorId].receiverFaceId);
    inheritedCrossings += 1;
  }
  assert.ok(inheritedCrossings > 0);
  assert.equal(fine.stats.drainageAnchorSubdivisions, coarse.sphere.subdivisions);
  assert.equal(fine.stats.drainageAnchorMismatches, 0);
  assert.equal(fine.stats.breachedBasinCount, coarse.stats.breachedBasinCount);
  assert.equal(fine.stats.preservedBasinCount, coarse.stats.preservedBasinCount);
  assert.ok(Math.abs(
    fine.stats.spillwayExcavatedVolumeKm3 - coarse.stats.spillwayExcavatedVolumeKm3,
  ) <= coarse.stats.spillwayExcavatedVolumeKm3 * 0.05);
  assert.ok(Math.abs(
    fine.stats.maximumDrainageAreaKm2 - coarse.stats.maximumDrainageAreaKm2,
  ) <= coarse.stats.maximumDrainageAreaKm2 * 0.06);
});

test("surface runoff closes at ocean outlets and produces resolved rivers", () => {
  const surface = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
  });
  const tolerance = Math.max(1e-9, surface.stats.totalLocalRunoffKm3PerYear * 1e-12);
  assert.ok(Math.abs(surface.stats.runoffResidualKm3PerYear) <= tolerance);
  assert.ok(Math.abs(
    surface.stats.totalLocalRunoffKm3PerYear
      - surface.stats.totalOutletRunoffKm3PerYear
      - surface.stats.lakeEvaporationKm3PerYear,
  ) <= tolerance);
  assert.ok(surface.stats.totalOutletRunoffKm3PerYear > 0);
  assert.ok(surface.stats.riverSegmentCount > 0);
  assert.ok(surface.stats.meanRiverSinuosity > 1.005);
  assert.ok(surface.stats.meanRiverSinuosity < 1.5);
  assert.ok(surface.stats.meanRiverMeanderAmplitudeKm > 0);
  assert.ok(surface.stats.meanNeighboringChannelAlignment >= 0);
  assert.ok(surface.stats.meanNeighboringChannelAlignment < 0.9);
  assert.equal(surface.riverMouths.length, surface.stats.riverMouthCount);
  assert.equal(
    surface.stats.oceanRiverMouthCount + surface.stats.lakeInflowCount,
    surface.stats.riverMouthCount,
  );
  assert.ok(surface.stats.oceanRiverMouthCount > 0);
  assert.ok(surface.stats.maximumDrainageAreaKm2 > 20_000);
  const edgeByFaces = new Map(surface.sphere.edges.map((edge) => {
    const low = Math.min(...edge.faces);
    const high = Math.max(...edge.faces);
    return [`${low}:${high}`, edge];
  }));
  for (const river of surface.rivers) {
    assert.ok(river.drainageAreaKm2 >= 20_000);
    assert.equal(surface.cells[river.fromFaceId].isLand, true);
    assert.equal(
      surface.cells[river.fromFaceId].isLake && surface.cells[river.toFaceId].isLake,
      false,
    );
  }
  for (const mouth of surface.riverMouths) {
    const source = surface.cells[mouth.fromFaceId];
    const receiver = surface.cells[mouth.toFaceId];
    assert.equal(source.isLand, true);
    if (mouth.receivingWater === "ocean") {
      assert.equal(receiver.isLand, false);
    } else {
      assert.equal(source.isLake, false);
      assert.equal(receiver.isLake, true);
    }
    const low = Math.min(mouth.fromFaceId, mouth.toFaceId);
    const high = Math.max(mouth.fromFaceId, mouth.toFaceId);
    const edge = edgeByFaces.get(`${low}:${high}`);
    assert.ok(edge);
    const vertices = edge.vertices.map((vertexId) => surface.sphere.vertices[vertexId].position);
    const midpointLength = Math.hypot(
      vertices[0][0] + vertices[1][0],
      vertices[0][1] + vertices[1][1],
      vertices[0][2] + vertices[1][2],
    );
    const midpoint = [
      (vertices[0][0] + vertices[1][0]) / midpointLength,
      (vertices[0][1] + vertices[1][1]) / midpointLength,
      (vertices[0][2] + vertices[1][2]) / midpointLength,
    ];
    const alignment = midpoint[0] * mouth.point[0]
      + midpoint[1] * mouth.point[1]
      + midpoint[2] * mouth.point[2];
    assert.ok(alignment > 1 - 1e-12);
  }
});

test("river presentation nodes are shared while terminal mouths lie on water boundaries", () => {
  const surface = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
  });
  const pointByFace = new Map();
  const terminalPairs = new Set(surface.riverMouths.map((mouth) => `${mouth.fromFaceId}:${mouth.toFaceId}`));
  const neighbors = surface.sphere.faces.map(() => new Set());
  for (const edge of surface.sphere.edges) {
    neighbors[edge.faces[0]].add(edge.faces[1]);
    neighbors[edge.faces[1]].add(edge.faces[0]);
  }
  for (const river of surface.rivers) {
    for (const [faceId, point] of [
      [river.fromFaceId, river.fromPoint],
      [river.toFaceId, river.toPoint],
    ]) {
      const terminal = faceId === river.toFaceId
        && terminalPairs.has(`${river.fromFaceId}:${river.toFaceId}`);
      if (!terminal) {
        const incumbent = pointByFace.get(faceId);
        if (incumbent) assert.deepEqual(point, incumbent);
        else pointByFace.set(faceId, point);
      }
      assert.ok(Math.abs(Math.hypot(...point) - 1) < 1e-12);
      const center = surface.sphere.faces[faceId].center;
      const displacement = Math.acos(Math.max(-1, Math.min(1,
        center[0] * point[0] + center[1] * point[1] + center[2] * point[2],
      )));
      const localStep = Math.min(...[...neighbors[faceId]].map((neighborId) => {
        const neighbor = surface.sphere.faces[neighborId].center;
        return Math.acos(Math.max(-1, Math.min(1,
          center[0] * neighbor[0] + center[1] * neighbor[1] + center[2] * neighbor[2],
        )));
      }));
      assert.ok(displacement <= localStep * (terminal ? 0.72 : 0.381));
    }
    assert.deepEqual(river.path[0], river.fromPoint);
    assert.deepEqual(river.path.at(-1), river.toPoint);
    assert.ok(river.path.length >= 2);
    assert.ok(river.path.every((point) => Math.abs(Math.hypot(...point) - 1) < 1e-12));
    if (!terminalPairs.has(`${river.fromFaceId}:${river.toFaceId}`)) {
      assert.ok(river.path.slice(1, -1).every((point) => surface.sampleContinuous(point).isLand));
    }
    assert.ok(river.confinement >= 0 && river.confinement <= 1);
    assert.ok(river.meanderAmplitudeKm >= 0);
    const segmentKm = Math.acos(Math.max(-1, Math.min(1,
      river.fromPoint[0] * river.toPoint[0]
        + river.fromPoint[1] * river.toPoint[1]
        + river.fromPoint[2] * river.toPoint[2],
    ))) * tectonic.recipe.radiusKm;
    assert.ok(river.meanderAmplitudeKm <= segmentKm * 0.241);
  }
});

test("channel refinement and coastal landforms are causal presentation geometry", () => {
  const refined = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
    channelRefinementScale: 1,
  });
  const straight = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
    channelRefinementScale: 0,
  });
  assert.deepEqual(refined.cells, straight.cells);
  assert.ok(refined.rivers.some((river) => river.path.length > 2 && river.meanderAmplitudeKm > 0));
  assert.ok(straight.rivers.every((river) => river.path.length === 2 && river.meanderAmplitudeKm === 0));
  assert.deepEqual(
    refined.rivers.map((river) => [river.fromFaceId, river.toFaceId, river.drainageAreaKm2]),
    straight.rivers.map((river) => [river.fromFaceId, river.toFaceId, river.drainageAreaKm2]),
  );
  assert.equal(
    Object.values(refined.stats.coastalLandformCounts).reduce((sum, count) => sum + count, 0),
    refined.riverMouths.length,
  );
  assert.ok(refined.riverMouths.every((mouth) => mouth.sedimentSupplyIndex >= 0
    && mouth.sedimentSupplyIndex <= 1));
  assert.ok(refined.riverMouths.some((mouth) => mouth.receivingWater === "ocean"));
  for (const mouth of refined.riverMouths) {
    assert.ok(mouth.sedimentFluxKm3 >= 0);
    assert.ok(mouth.deltaPlainRadiusKm >= 0);
    assert.ok(mouth.deltaProgradationKm >= 0 && mouth.deltaProgradationKm <= 18);
    if (mouth.receivingWater === "lake") assert.equal(mouth.landform, "lake-inflow");
    if (mouth.receivingWater === "lake") assert.equal(mouth.sedimentFluxKm3, 0);
    if (mouth.landform !== "delta" && mouth.landform !== "alluvial-fan") {
      assert.equal(mouth.deltaPlainRadiusKm, 0);
      assert.equal(mouth.deltaProgradationKm, 0);
    }
    for (const branch of mouth.distributaries) {
      assert.ok(branch.length >= 3);
      assert.ok(branch.every((point) => Math.abs(Math.hypot(...point) - 1) < 1e-12));
    }
  }
  const resolvedOceanSedimentKm3 = refined.riverMouths
    .filter((mouth) => mouth.receivingWater === "ocean")
    .reduce((sum, mouth) => sum + mouth.sedimentFluxKm3, 0);
  assert.ok(resolvedOceanSedimentKm3 > 0);
  assert.ok(resolvedOceanSedimentKm3 <= refined.stats.exportedSedimentVolumeKm3
    + Math.max(1e-9, refined.stats.exportedSedimentVolumeKm3 * 1e-12));
});

test("continuous lake coverage interpolates canonical lake shores", () => {
  const surface = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  let shorelineSample = null;
  for (const edge of surface.sphere.edges) {
    const first = surface.cells[edge.faces[0]];
    const second = surface.cells[edge.faces[1]];
    if (first.isLand && second.isLand && first.isLake !== second.isLake) {
      const lakeFaceId = first.isLake ? edge.faces[0] : edge.faces[1];
      const dryFaceId = first.isLake ? edge.faces[1] : edge.faces[0];
      const lake = surface.sphere.faces[lakeFaceId].center;
      const dry = surface.sphere.faces[dryFaceId].center;
      for (let distance = 0.25; distance <= 3; distance += 0.125) {
        const sample = surface.sampleContinuous([
          lake[0] + (dry[0] - lake[0]) * distance,
          lake[1] + (dry[1] - lake[1]) * distance,
          lake[2] + (dry[2] - lake[2]) * distance,
        ]);
        if (sample.isLand && sample.lakeCoverage > 0.05 && sample.lakeCoverage < 0.95) {
          shorelineSample = sample;
          break;
        }
      }
      if (shorelineSample) break;
    }
  }
  assert.ok(shorelineSample);
  assert.ok(shorelineSample.lakeDepthKm >= 0);
});

test("surface processes are deterministic for a world recipe", () => {
  const first = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const second = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  assert.deepEqual(first.stats, second.stats);
  assert.deepEqual(first.rivers, second.rivers);
  assert.deepEqual(first.cells, second.cells);
});

test("continental interior relief adds broad drainage structure without moving the coast", () => {
  const structured = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    continentalReliefScale: 1,
  });
  const flatInterior = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    continentalReliefScale: 0,
  });
  assert.ok(structured.stats.continentalReliefCenterCount > 0);
  assert.ok(structured.stats.maximumContinentalReliefKm > 0);
  assert.equal(flatInterior.stats.maximumContinentalReliefKm, 0);
  assert.deepEqual(
    structured.cells.map((cell) => cell.isLand),
    flatInterior.cells.map((cell) => cell.isLand),
  );
  assert.ok(structured.cells.some((cell, index) => cell.isLand
    && Math.abs(cell.elevationKm - flatInterior.cells[index].elevationKm) > 1e-4));
});

test("larger planets resolve more fixed-physical-scale interior relief provinces", () => {
  const largerTectonic = simulateTectonicWorld({
    ...tectonic.recipe,
    radiusKm: tectonic.recipe.radiusKm * 2,
  });
  const earthScale = createSurfaceProcessWorld(tectonic, { subdivisions: 4 });
  const larger = createSurfaceProcessWorld(largerTectonic, { subdivisions: 4 });
  assert.ok(larger.stats.continentalReliefCenterCount
    > earthScale.stats.continentalReliefCenterCount);
  assert.equal(earthScale.stats.canonicalAnchorMismatches, 0);
  assert.equal(larger.stats.canonicalAnchorMismatches, 0);
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

test("hillslope diffusion conserves terrain volume and preserves land authority", () => {
  const diffused = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    hillslopeDiffusionLengthKm: 42,
    hillslopeDiffusionPasses: 4,
  });
  const undiffused = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    hillslopeDiffusionLengthKm: 0,
  });
  assert.deepEqual(
    diffused.cells.map((cell) => cell.isLand),
    undiffused.cells.map((cell) => cell.isLand),
  );
  assert.ok(diffused.stats.hillslopeErodedVolumeKm3 > 0);
  assert.equal(
    diffused.stats.hillslopeErodedVolumeKm3,
    diffused.stats.hillslopeDepositedVolumeKm3,
  );
  assert.equal(diffused.stats.hillslopeResidualKm3, 0);
  assert.ok(diffused.stats.hillslopeAdjustedCellCount > 0);
  assert.ok(diffused.stats.maximumHillslopeChangeKm > 0);
  assert.equal(undiffused.stats.hillslopeErodedVolumeKm3, 0);
  assert.equal(undiffused.stats.hillslopeDepositedVolumeKm3, 0);
  assert.equal(undiffused.stats.hillslopeAdjustedCellCount, 0);
  const changed = diffused.cells.filter(
    (cell, index) => Math.abs(cell.elevationKm - undiffused.cells[index].elevationKm) > 1e-9,
  );
  assert.ok(changed.length > 0);
  assert.ok(diffused.cells.every((cell) => cell.hillslopeErosionKm >= 0
    && cell.hillslopeDepositionKm >= 0));
});

test("continuous valley relief follows resolved rivers without changing process geography", () => {
  const withValleys = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
    valleyReliefScale: 1,
  });
  const withoutValleys = createSurfaceProcessWorld(tectonic, {
    subdivisions: 4,
    minimumRiverAreaKm2: 20_000,
    valleyReliefScale: 0,
  });
  assert.deepEqual(withValleys.cells, withoutValleys.cells);
  assert.deepEqual(withValleys.rivers, withoutValleys.rivers);
  const majorRiver = withValleys.rivers.reduce((largest, river) => (
    river.drainageAreaKm2 > largest.drainageAreaKm2 ? river : largest
  ));
  const valleySample = withValleys.sampleContinuous(majorRiver.fromPoint);
  const flatSample = withoutValleys.sampleContinuous(majorRiver.fromPoint);
  assert.equal(valleySample.isLand, true);
  assert.ok(valleySample.valleyIncisionKm > 0.03);
  assert.equal(flatSample.valleyIncisionKm, 0);
  assert.ok(valleySample.elevationKm < flatSample.elevationKm);
  assert.equal(valleySample.faceId, flatSample.faceId);
  assert.equal(valleySample.biome, flatSample.biome);
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
  assert.ok(Number.isFinite(first.seasonalTemperatureRangeC));
  assert.ok(first.continentality >= 0 && first.continentality <= 1);
  assert.ok(Number.isFinite(first.drainageAreaKm2) && first.drainageAreaKm2 > 0);
  assert.ok(Number.isFinite(first.dischargeKm3PerYear) && first.dischargeKm3PerYear >= 0);
  assert.ok(Number.isFinite(first.fillDepthKm) && first.fillDepthKm >= 0);
  assert.ok(Number.isFinite(first.spillwayIncisionKm) && first.spillwayIncisionKm >= 0);
  assert.ok(Number.isFinite(first.hillslopeChangeKm));
  assert.ok(Number.isFinite(first.valleyIncisionKm) && first.valleyIncisionKm >= 0);
  assert.ok(Number.isFinite(first.coastalRuggedness)
    && first.coastalRuggedness >= 0
    && first.coastalRuggedness <= 1);
  assert.ok(Number.isFinite(first.coastalSedimentAffinity)
    && first.coastalSedimentAffinity >= 0
    && first.coastalSedimentAffinity <= 1);
  assert.ok(Number.isFinite(first.surfaceTexture));
  assert.ok(Math.abs(first.surfaceTexture) <= 1.0000001);
  assert.ok(Math.abs(first.surfaceTexture - second.surfaceTexture) > 1e-10);

  const repeat = surface.sampleContinuous(towardA);
  assert.deepEqual(repeat, first);
});
