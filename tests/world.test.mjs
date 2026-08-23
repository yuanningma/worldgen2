import assert from "node:assert/strict";
import test from "node:test";
import { generateWorld, generateWorldModel, renderCartographicStrip } from "../lib/world.ts";

const base = {
  seed: "VERDANT-047",
  width: 144,
  height: 90,
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

test("global sea level cuts the continuous height field", () => {
  const lowSea = generateWorld({ ...base, seaLevel: 18 });
  const highSea = generateWorld({ ...base, seaLevel: 86 });
  assert.ok(lowSea.stats.landPercent > highSea.stats.landPercent + 12);
});

test("continental systems emerge in a bounded natural range", () => {
  const world = generateWorld(base);
  assert.ok(world.stats.continentSystems >= 3);
  assert.ok(world.stats.continentSystems <= 9);
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
});

test("the structural coast has meaningful perimeter without fragmenting the world", () => {
  const world = generateWorld(base);
  assert.ok(world.stats.coastlineIndex > 10.5, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.coastlineIndex < 45, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.landPercent >= 15 && world.stats.landPercent <= 50);
  assert.ok(world.stats.frameClearance >= 2, `frame clearance was ${world.stats.frameClearance}%`);
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
