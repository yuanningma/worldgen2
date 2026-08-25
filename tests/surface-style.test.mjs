import assert from "node:assert/strict";
import test from "node:test";
import { naturalSurfaceColor } from "../lib/tectonics/surfaceStyle.ts";

const land = {
  isLand: true,
  isLake: false,
  elevationAboveSeaKm: 0.8,
  coastDistanceKm: 120,
  temperatureC: 14,
  precipitationMPerYear: 0.9,
  lithology: "sedimentary",
  erosionResistance: 0.5,
  shade: 0.72,
  surfaceTexture: 0.8,
};

test("illustrated atlas ocean is flat instead of a coastal halo", () => {
  const shallow = naturalSurfaceColor("atlas", { ...land, isLand: false, coastDistanceKm: 0 });
  const deep = naturalSurfaceColor("atlas", {
    ...land,
    isLand: false,
    coastDistanceKm: 4_000,
    shade: 1.2,
    surfaceTexture: -1,
  });
  assert.deepEqual(shallow, [177, 207, 232]);
  assert.deepEqual(deep, shallow);
});

test("atlas and relief styles share fields but produce distinct presentations", () => {
  const atlas = naturalSurfaceColor("atlas", land);
  const relief = naturalSurfaceColor("relief", land);
  assert.notDeepEqual(atlas, relief);
  assert.deepEqual(naturalSurfaceColor("atlas", land), atlas);
  assert.deepEqual(naturalSurfaceColor("relief", land), relief);
});

test("physical relief retains restrained bathymetry without a white shelf", () => {
  const coast = naturalSurfaceColor("relief", { ...land, isLand: false, coastDistanceKm: 0 });
  const deep = naturalSurfaceColor("relief", { ...land, isLand: false, coastDistanceKm: 2_000 });
  assert.ok(coast.every((channel) => channel < 150));
  assert.ok(deep.every((channel, index) => channel <= coast[index]));
});
