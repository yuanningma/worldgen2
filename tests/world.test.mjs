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
  assert.ok(world.stats.coastlineIndex > 7.5, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.coastlineIndex < 18, `coastline index was ${world.stats.coastlineIndex}`);
  assert.ok(world.stats.landPercent >= 15 && world.stats.landPercent <= 50);
});
