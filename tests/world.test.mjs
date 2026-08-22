import assert from "node:assert/strict";
import test from "node:test";
import { generateWorld } from "../lib/world.ts";

const base = {
  seed: "VERDANT-047",
  width: 144,
  height: 90,
  continentSize: 56,
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

test("continent mass increases land coverage for a fixed seed", () => {
  const sparse = generateWorld({ ...base, continentSize: 15 });
  const broad = generateWorld({ ...base, continentSize: 90 });
  assert.ok(broad.stats.landPercent > sparse.stats.landPercent + 10);
});

test("the structural coast has meaningful perimeter without fragmenting the world", () => {
  const world = generateWorld(base);
  assert.ok(world.stats.coastlineIndex > 10.5, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.coastlineIndex < 24, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.landPercent >= 15 && world.stats.landPercent <= 50);
  assert.ok(world.stats.frameClearance >= 4.4, `frame clearance was ${world.stats.frameClearance}%`);
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

test("fixed-seed suite preserves terrane complexity and oceanic polar caps", () => {
  for (const seed of [
    "VERDANT-047", "SABLE-908", "AURELIA-311", "THORN-782",
    "EMBER-164", "MISTRAL-529", "HALCYON-846", "BRAMBLE-203",
    "VESPER-675", "CERULEAN-418", "IVORY-991", "STORM-357",
  ]) {
    const world = generateWorld({ ...base, seed });
    assert.ok(world.stats.landPercent >= 28 && world.stats.landPercent <= 42, `${seed} land was ${world.stats.landPercent}%`);
    assert.ok(world.stats.coastlineIndex >= 10.5 && world.stats.coastlineIndex <= 24, `${seed} coast was ${world.stats.coastlineIndex}`);
    assert.ok(world.stats.frameClearance >= 4.4, `${seed} frame clearance was ${world.stats.frameClearance}%`);
  }
});
