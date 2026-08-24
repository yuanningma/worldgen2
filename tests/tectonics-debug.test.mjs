import assert from "node:assert/strict";
import test from "node:test";
import { createTectonicDebugFixture } from "../lib/tectonics/debugFixture.ts";
import { renderTectonicContactSheet } from "../lib/tectonics/debugSvg.ts";

test("tectonic debug fixture is deterministic and exercises scientific layers", () => {
  const options = { seed: "TEST-RIFT", subdivisions: 2, plateCount: 7 };
  const first = createTectonicDebugFixture(options);
  const second = createTectonicDebugFixture(options);
  assert.deepEqual(first, second);
  assert.equal(first.cells.length, 320);
  assert.equal(new Set(first.cells.map((cell) => cell.plateId)).size, options.plateCount);
  assert.deepEqual(
    [...new Set(first.boundaries.map((boundary) => boundary.kind))].sort(),
    ["collision", "convergent", "diffuse", "divergent", "transform"],
  );
  assert.ok(new Set(first.cells.map((cell) => cell.crustKind)).size >= 4);
});

test("contact sheet renders every canonical layer as standalone deterministic SVG", () => {
  const snapshot = createTectonicDebugFixture({ seed: "SVG-CHECK", subdivisions: 1, plateCount: 5 });
  const first = renderTectonicContactSheet(snapshot, { panelWidth: 300 });
  const second = renderTectonicContactSheet(snapshot, { panelWidth: 300 });
  assert.equal(first, second);
  assert.match(first, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  for (const title of [
    "PLATE ID",
    "BOUNDARY TYPE",
    "CRUST TYPE",
    "CRUST AGE",
    "CRUST THICKNESS",
    "PROVENANCE",
    "ISOSTATIC ELEVATION",
  ]) assert.match(first, new RegExp(`>${title}<`));
  assert.doesNotMatch(first, /\b(?:NaN|Infinity)\b/);
});

test("contact-sheet validation rejects non-spherical geometry", () => {
  const snapshot = createTectonicDebugFixture({ subdivisions: 0, plateCount: 3 });
  const invalid = { ...snapshot, vertices: [[2, 0, 0], ...snapshot.vertices.slice(1)] };
  assert.throws(() => renderTectonicContactSheet(invalid), /unit vector/);
});
