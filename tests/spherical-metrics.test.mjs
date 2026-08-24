import assert from "node:assert/strict";
import test from "node:test";
import {
  angularDistanceRadians,
  createSphericalRasterGeometry,
  dot,
  latLonToUnit,
  rotateAroundAxis,
  sphereAreaKm2,
} from "../lib/spherical/geometry.ts";
import {
  compareCanonicalMasks,
  evaluateSphericalLandMask,
} from "../lib/evaluation/sphericalLandmassMetrics.ts";
import {
  createCShapedGulfFixture,
  createCompactContinentFixture,
  createDumbbellFixture,
  createEnclosedLakeFixture,
  createEqualAreaCompactAndRibbonFixtures,
  createLobedContinentFixture,
  createNoisyRibbonFixture,
} from "../lib/evaluation/pathologyFixtures.ts";

const fixtureResolution = { width: 240, height: 120, radiusKm: 6_371 };
const evaluationOptions = { scalesKm: [450, 700, 1_000, 1_400] };

test("spherical raster areas close exactly and Euler rotation preserves position on the sphere", () => {
  const geometry = createSphericalRasterGeometry(360, 180, 6_371);
  const expectedArea = sphereAreaKm2(6_371);
  assert.ok(Math.abs(geometry.totalAreaKm2 - expectedArea) / expectedArea < 1e-12);

  const point = latLonToUnit(0, 0);
  const rotated = rotateAroundAxis(point, [0, 0, 1], Math.PI / 2);
  const expected = latLonToUnit(0, Math.PI / 2);
  assert.ok(angularDistanceRadians(rotated, expected) < 1e-12);
  assert.ok(Math.abs(dot(rotated, rotated) - 1) < 1e-12);
});

test("equal-area compact and ribbon fixtures are distinguished by spherical multiscale metrics", () => {
  const [compact, ribbon] = createEqualAreaCompactAndRibbonFixtures(fixtureResolution);
  const compactReport = evaluateSphericalLandMask(compact, evaluationOptions);
  const ribbonReport = evaluateSphericalLandMask(ribbon, evaluationOptions);

  assert.ok(Math.abs(compactReport.landAreaKm2 - ribbonReport.landAreaKm2) / compactReport.landAreaKm2 < 0.025);
  assert.ok(ribbonReport.maximumMajorElongation > compactReport.maximumMajorElongation * 2);
  assert.ok(ribbonReport.maximumMajorDiameterRatio > compactReport.maximumMajorDiameterRatio * 1.25);
  assert.ok(ribbonReport.coreRetentionMean < compactReport.coreRetentionMean - 0.15);
  assert.ok(ribbonReport.ribbonSeverity > compactReport.ribbonSeverity * 1.8);
});

test("narrowing a dumbbell isthmus monotonically worsens split persistence", () => {
  const wide = evaluateSphericalLandMask(createDumbbellFixture(10, fixtureResolution), evaluationOptions);
  const narrow = evaluateSphericalLandMask(createDumbbellFixture(3, fixtureResolution), evaluationOptions);

  assert.equal(wide.majorComponentCount, 1);
  assert.equal(narrow.majorComponentCount, 1);
  assert.ok(narrow.neckSplitPersistence > wide.neckSplitPersistence,
    `split persistence was ${wide.neckSplitPersistence} (wide) and ${narrow.neckSplitPersistence} (narrow)`);
  assert.ok(narrow.multiscale.some((scale) => scale.maximumSplitCount >= 2));
});

test("a narrow-mouth C-shaped gulf is detected without confusing an enclosed lake", () => {
  const wideGulf = evaluateSphericalLandMask(createCShapedGulfFixture(11, fixtureResolution), evaluationOptions);
  const narrowGulf = evaluateSphericalLandMask(createCShapedGulfFixture(3, fixtureResolution), evaluationOptions);
  const lake = evaluateSphericalLandMask(createEnclosedLakeFixture(fixtureResolution), evaluationOptions);

  assert.equal(wideGulf.enclosedLakeCount, 0);
  assert.equal(narrowGulf.enclosedLakeCount, 0);
  assert.ok(narrowGulf.openGulfSeverity > wideGulf.openGulfSeverity,
    `gulf severity was ${wideGulf.openGulfSeverity} (wide) and ${narrowGulf.openGulfSeverity} (narrow)`);
  assert.equal(lake.openGulfSeverity, 0);
  assert.equal(lake.enclosedLakeCount, 1);
  assert.ok(lake.enclosedLakeAreaKm2 > 1_000_000);
});

test("canonical mask comparison is spherical-area weighted", () => {
  const [compact, ribbon] = createEqualAreaCompactAndRibbonFixtures(fixtureResolution);
  const identical = compareCanonicalMasks(compact, compact);
  const different = compareCanonicalMasks(compact, ribbon);
  assert.equal(identical.weightedIntersectionOverUnion, 1);
  assert.equal(identical.differingAreaKm2, 0);
  assert.ok(different.weightedIntersectionOverUnion < 0.4);
  assert.ok(different.differingAreaFraction > 0.05);
});

test("resolved coastline richness distinguishes disks, persistent lobes, and noisy ribbons", () => {
  const disk = evaluateSphericalLandMask(createCompactContinentFixture(fixtureResolution), evaluationOptions);
  const lobed = evaluateSphericalLandMask(createLobedContinentFixture(fixtureResolution), evaluationOptions);
  const noisyRibbon = evaluateSphericalLandMask(createNoisyRibbonFixture(fixtureResolution), evaluationOptions);

  assert.ok(lobed.normalizedMajorCoastlinePerimeter > disk.normalizedMajorCoastlinePerimeter * 1.35);
  assert.ok(lobed.minimumMajorGeodesicSolidity < disk.minimumMajorGeodesicSolidity - 0.25);
  assert.ok(lobed.peninsulaBayBranchSignal > disk.peninsulaBayBranchSignal + 0.1);
  assert.ok(lobed.coastlineRichness > disk.coastlineRichness * 1.8,
    `richness was ${disk.coastlineRichness} (disk) and ${lobed.coastlineRichness} (lobed)`);
  assert.ok(noisyRibbon.normalizedMajorCoastlinePerimeter > lobed.normalizedMajorCoastlinePerimeter);
  assert.ok(noisyRibbon.coastlineRichness < lobed.coastlineRichness * 0.6,
    `noise richness was ${noisyRibbon.coastlineRichness} versus ${lobed.coastlineRichness}`);
  assert.ok(noisyRibbon.maximumMajorElongation > lobed.maximumMajorElongation * 5);
  assert.ok(noisyRibbon.ribbonSeverity > lobed.ribbonSeverity * 3);
});
