import assert from "node:assert/strict";
import test from "node:test";
import { generateWorld, generateWorldModel, renderCartographicStrip } from "../lib/world.ts";

const base = {
  seed: "VERDANT-047",
  width: 144,
  height: 90,
  planetScale: 60,
  continentSize: 56,
  seaLevel: 52,
  coastDetail: 76,
  tectonics: 58,
  moisture: 54,
  style: "satellite",
};

test("a world seed is deterministic", () => {
  const first = generateWorld(base);
  const second = generateWorld(base);
  assert.deepEqual(first.pixels, second.pixels);
  assert.equal(first.stats.landPercent, second.stats.landPercent);
  assert.equal(first.pixels.length, base.width * base.height * 4);
});

test("different seeds produce different geography", () => {
  const first = generateWorld(base);
  const second = generateWorld({ ...base, seed: "SABLE-908" });
  assert.notDeepEqual(first.pixels, second.pixels);
});

test("the categorical climate atlas is a distinct deterministic rendering", () => {
  const first = generateWorld({ ...base, style: "climate" });
  const second = generateWorld({ ...base, style: "climate" });
  const satellite = generateWorld(base);
  assert.deepEqual(first.pixels, second.pixels);
  assert.notDeepEqual(first.pixels, satellite.pixels);
  assert.equal(first.stats.landPercent, satellite.stats.landPercent);
});

test("global sea level cuts the continuous height field", () => {
  const lowSea = generateWorld({ ...base, seaLevel: 18 });
  const highSea = generateWorld({ ...base, seaLevel: 86 });
  assert.ok(lowSea.stats.landPercent > highSea.stats.landPercent + 12);
});

test("continental systems emerge in a bounded natural range", () => {
  const world = generateWorld({ ...base, width: 512, height: 256, simulationSites: 1400 });
  assert.ok(world.stats.continentSystems >= 3);
  assert.ok(world.stats.continentSystems <= 9);
  assert.equal(world.stats.continentSystems, world.stats.majorLandmassCount);
  assert.ok(world.stats.effectiveLandmassCount >= 2.5);
  assert.ok(world.stats.landmassLatitudeDiversity >= 0.6,
    `latitude diversity was ${world.stats.landmassLatitudeDiversity}`);
  assert.ok(world.stats.landmassSpacingIrregularity >= 0.35,
    `spacing irregularity was ${world.stats.landmassSpacingIrregularity}`);
});

test("planet scale changes the natural geographic carrying capacity", () => {
  // Exercise the normal visual-candidate path: tiny test rasters intentionally
  // skip its scale-space morphology scoring for suite speed.
  const compact = generateWorld({ ...base, width: 512, height: 256, simulationSites: 1400, planetScale: 12 });
  const grand = generateWorld({ ...base, width: 512, height: 256, simulationSites: 1400, planetScale: 84 });
  assert.ok(grand.stats.circumferenceKm > compact.stats.circumferenceKm * 1.7);
  assert.ok(grand.stats.plateCount > compact.stats.plateCount);
  assert.ok(grand.stats.effectiveLandmassCount > compact.stats.effectiveLandmassCount + 0.8,
    `effective landmasses were ${compact.stats.effectiveLandmassCount} and ${grand.stats.effectiveLandmassCount}`);
  assert.ok(grand.stats.continentSystems >= compact.stats.continentSystems,
    `major lands were ${compact.stats.continentSystems} and ${grand.stats.continentSystems}`);
});

test("large cartographic exports are deterministic, bounded, and seamless by strip", () => {
  const model = generateWorldModel({ ...base, width: 160, height: 80, simulationSites: 2200 });
  const first = renderCartographicStrip(model, 512, 256, 32, 24);
  const second = renderCartographicStrip(model, 512, 256, 32, 24);
  assert.deepEqual(first, second);
  assert.equal(first.length, 512 * 24 * 4);
  for (let y = 0; y < 24; y += 1) {
    const left = y * 512 * 4;
    const right = (y * 512 + 511) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      assert.ok(Math.abs(first[left + channel] - first[right + channel]) <= 2);
    }
  }
  const fourKStrip = renderCartographicStrip(model, 4096, 2048, 640, 2);
  assert.equal(fourKStrip.length, 4096 * 2 * 4);
});

test("the composition planner creates hierarchy, open ocean, and compact major landmasses", () => {
  const world = generateWorld(base);
  assert.ok(world.stats.largestLandmassPercent >= 25, `largest system was ${world.stats.largestLandmassPercent}%`);
  assert.ok(world.stats.largestLandmassPercent <= 90, `largest system was ${world.stats.largestLandmassPercent}%`);
  assert.ok(world.stats.oceanGapPercent >= 8, `open-ocean gap was ${world.stats.oceanGapPercent}%`);
  assert.ok(world.stats.meanLandmassElongation <= 3.4, `mean elongation was ${world.stats.meanLandmassElongation}`);
});

test("the structural coast has meaningful perimeter without fragmenting the world", () => {
  const world = generateWorld(base);
  assert.ok(world.stats.coastlineIndex > 10.5, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.coastlineIndex < 45, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.landPercent >= 15 && world.stats.landPercent <= 50);
  assert.ok(world.stats.frameClearance >= 2, `frame clearance was ${world.stats.frameClearance}%`);
  assert.ok(world.stats.coastScaleRatio >= 1.2, `coast scale ratio was ${world.stats.coastScaleRatio}`);
  assert.ok(world.stats.coastHierarchyIndex >= 8, `coast hierarchy was ${world.stats.coastHierarchyIndex}`);
  assert.ok(world.stats.islandAreaPercent >= 0.5 && world.stats.islandAreaPercent <= 8,
    `island area was ${world.stats.islandAreaPercent}%`);
  assert.ok(world.stats.islandSizeDiversity >= 0 && world.stats.islandSizeDiversity <= 1,
    `island diversity was ${world.stats.islandSizeDiversity}`);
});

test("coastal complexity adds persistent multiscale detail instead of only enlarging pixels", () => {
  const low = generateWorld({ ...base, width: 192, height: 96, simulationSites: 2200, coastDetail: 15 });
  const high = generateWorld({ ...base, width: 192, height: 96, simulationSites: 2200, coastDetail: 95 });
  assert.ok(high.stats.coastScaleRatio > low.stats.coastScaleRatio + 0.1,
    `scale ratios were ${low.stats.coastScaleRatio} and ${high.stats.coastScaleRatio}`);
});

test("the equirectangular texture joins cleanly at the longitude seam", () => {
  const world = generateWorld(base);
  let totalDifference = 0;
  for (let y = 0; y < base.height; y += 1) {
    const left = y * base.width * 4;
    const right = (y * base.width + base.width - 1) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      totalDifference += Math.abs(world.pixels[left + channel] - world.pixels[right + channel]);
    }
  }
  const meanDifference = totalDifference / (base.height * 3);
  assert.ok(meanDifference < 6, `longitude seam difference was ${meanDifference}`);
  assert.ok(world.stats.focusLongitude >= -Math.PI && world.stats.focusLongitude <= Math.PI);
});

test("render resolution does not change the simulated plate world", () => {
  const simulationSites = 2200;
  const preview = generateWorld({ ...base, width: 160, height: 80, simulationSites });
  const high = generateWorld({ ...base, width: 320, height: 160, simulationSites });
  assert.equal(preview.stats.name, high.stats.name);
  assert.equal(preview.stats.plateCount, high.stats.plateCount);
  assert.ok(Math.abs(preview.stats.landPercent - high.stats.landPercent) <= 1);
  assert.ok(Math.abs(preview.stats.frameClearance - high.stats.frameClearance) <= 1.5);
});

test("fixed-seed suite preserves terrane complexity and oceanic polar caps", () => {
  for (const seed of [
    "VERDANT-047", "SABLE-908", "AURELIA-311", "THORN-782",
    "EMBER-164", "MISTRAL-529", "HALCYON-846", "BRAMBLE-203",
    "VESPER-675", "CERULEAN-418", "IVORY-991", "STORM-357",
  ]) {
    const world = generateWorld({ ...base, seed });
    assert.ok(world.stats.landPercent >= 28 && world.stats.landPercent <= 42, `${seed} land was ${world.stats.landPercent}%`);
    assert.ok(world.stats.coastlineIndex >= 10.5 && world.stats.coastlineIndex <= 45, `${seed} coast was ${world.stats.coastlineIndex}`);
    assert.ok(world.stats.frameClearance >= 2, `${seed} frame clearance was ${world.stats.frameClearance}%`);
  }
});
