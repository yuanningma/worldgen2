import assert from "node:assert/strict";
import test from "node:test";
import { renderTectonicAtlasSvg } from "../lib/tectonics/atlasSvg.ts";
import { simulateTectonicWorld } from "../lib/tectonics/index.ts";

const world = simulateTectonicWorld({
  seed: "atlas-render-test",
  subdivisions: 1,
  plateCount: 6,
  historyMyr: 30,
  timestepMyr: 3,
  oceanFraction: 0.66,
});

test("single-atlas renderer is deterministic and carries canonical model metadata", () => {
  const options = { width: 640, rasterWidth: 160, showBoundaries: true };
  const first = renderTectonicAtlasSvg(world, options);
  const second = renderTectonicAtlasSvg(world, options);
  assert.equal(first, second);
  assert.match(first, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(first, /ATLAS FORGE · EVOLVING TECTONIC WORLD/);
  assert.match(first, /SEED atlas-render-test · 30\.0 MYR · 6 PLATES · 80 CELLS/);
  assert.match(first, /LAND\/SEA IS CANONICAL ACROSS ALL OUTPUTS/);
  assert.match(first, /BOUNDARIES ON/);
  assert.doesNotMatch(first, /PLATE ID|CRUST AGE|\bNaN\b|\bInfinity\b/);
});

test("atlas presentation switches overlays without changing simulated geography", () => {
  const withBoundaries = renderTectonicAtlasSvg(world, { width: 640, rasterWidth: 160, showBoundaries: true });
  const withoutBoundaries = renderTectonicAtlasSvg(world, { width: 640, rasterWidth: 160, showBoundaries: false });
  assert.notEqual(withBoundaries, withoutBoundaries);
  assert.match(withoutBoundaries, /BOUNDARIES OFF/);
  assert.equal(world.cells.filter((cell) => cell.isLand).length, world.cells.filter((cell) => cell.waterDepthKm === 0).length);
});

test("presentation defaults to pole-safe Mollweide with tectonic overlays off", () => {
  const svg = renderTectonicAtlasSvg(world, { width: 640, rasterWidth: 160 });
  assert.match(svg, /BOUNDARIES OFF · MOLLWEIDE/);
  assert.match(svg, /clipPath id="atlas-map-clip"/);
});

test("atlas validation rejects contradictory canonical water state", () => {
  const cell = world.cells[0];
  const cells = [...world.cells];
  cells[0] = { ...cell, isLand: true, waterDepthKm: 1 };
  assert.throws(() => renderTectonicAtlasSvg({ ...world, cells }, { width: 640, rasterWidth: 160 }), /canonical water state/);
});
