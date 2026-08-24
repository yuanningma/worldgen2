import {
  cellCenter,
  clamp,
  createSphericalRasterGeometry,
  dot,
  normalize,
  sphereAreaKm2,
  type SphericalRasterGeometry,
  type Vec3,
} from "../spherical/geometry.ts";

export interface SphericalLandMask {
  readonly width: number;
  readonly height: number;
  readonly radiusKm: number;
  /** Zero is water; any non-zero value is canonical land. */
  readonly land: Uint8Array;
}

export interface LandmassShapeMetrics {
  readonly cellCount: number;
  readonly areaKm2: number;
  readonly areaShareOfLand: number;
  readonly centroid: Vec3;
  /** Rotation-invariant tangent-plane covariance axis ratio. */
  readonly elongation: number;
  readonly geodesicDiameterKm: number;
  readonly equalAreaRadiusKm: number;
  readonly diameterToEqualAreaDiameter: number;
  readonly coastlinePerimeterKm: number;
  /** 1 is the perimeter of an equal-area spherical cap; larger values are less compact. */
  readonly normalizedPerimeter: number;
  /** Area divided by the centroid-centered spherical cap enclosing the component. */
  readonly geodesicSolidityProxy: number;
}

export interface MorphologyScaleMetrics {
  readonly scaleKm: number;
  readonly resolved: boolean;
  readonly retainedLandFraction: number;
  readonly weightedSplitExcess: number;
  readonly maximumSplitCount: number;
  readonly gulfChamberAreaKm2: number;
  readonly gulfSeverity: number;
  readonly openedCoastlinePerimeterKm: number;
  readonly coastlinePerimeterRetention: number;
  readonly peninsulaAreaFraction: number;
  readonly bayAreaFraction: number;
}

export interface SphericalLandmassReport {
  readonly landAreaKm2: number;
  readonly landFraction: number;
  readonly componentCount: number;
  readonly majorComponentCount: number;
  readonly effectiveComponentCount: number;
  readonly areaGini: number;
  readonly components: readonly LandmassShapeMetrics[];
  readonly majorComponents: readonly LandmassShapeMetrics[];
  readonly maximumMajorElongation: number;
  readonly maximumMajorDiameterRatio: number;
  readonly nominalCellSizeKm: number;
  readonly multiscale: readonly MorphologyScaleMetrics[];
  readonly coreRetentionMean: number;
  readonly neckSplitPersistence: number;
  readonly ribbonSeverity: number;
  readonly openGulfSeverity: number;
  readonly enclosedLakeAreaKm2: number;
  readonly enclosedLakeCount: number;
  readonly coastlinePerimeterKm: number;
  readonly normalizedMajorCoastlinePerimeter: number;
  readonly minimumMajorGeodesicSolidity: number;
  /** Persistent non-cap coastline structure; fine-only noise is discounted. */
  readonly coastlineRichness: number;
  readonly coastlineFineNoiseFraction: number;
  readonly peninsulaBayBranchSignal: number;
}

export interface EvaluationOptions {
  /** Physical erosion / opening scales. Scales below the sampling limit are reported but do not affect summaries. */
  readonly scalesKm?: readonly number[];
  readonly minimumSamplesAcross?: number;
  readonly majorComponentMinimumLandShare?: number;
}

export interface CanonicalMaskComparison {
  readonly weightedIntersectionOverUnion: number;
  readonly differingAreaKm2: number;
  readonly differingAreaFraction: number;
}

interface Component {
  label: number;
  readonly cells: number[];
  areaKm2: number;
}

interface ComponentsResult {
  readonly labels: Int32Array;
  readonly components: Component[];
}

class MinimumHeap {
  private readonly indices: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.indices.length;
  }

  push(index: number, priority: number): void {
    let position = this.indices.length;
    this.indices.push(index);
    this.priorities.push(priority);
    while (position > 0) {
      const parent = (position - 1) >> 1;
      if (this.priorities[parent] <= priority) break;
      this.indices[position] = this.indices[parent];
      this.priorities[position] = this.priorities[parent];
      position = parent;
    }
    this.indices[position] = index;
    this.priorities[position] = priority;
  }

  pop(): readonly [number, number] | undefined {
    if (this.indices.length === 0) return undefined;
    const rootIndex = this.indices[0];
    const rootPriority = this.priorities[0];
    const lastIndex = this.indices.pop() as number;
    const lastPriority = this.priorities.pop() as number;
    if (this.indices.length > 0) {
      let position = 0;
      while (true) {
        const left = position * 2 + 1;
        if (left >= this.indices.length) break;
        const right = left + 1;
        const child = right < this.indices.length && this.priorities[right] < this.priorities[left]
          ? right
          : left;
        if (this.priorities[child] >= lastPriority) break;
        this.indices[position] = this.indices[child];
        this.priorities[position] = this.priorities[child];
        position = child;
      }
      this.indices[position] = lastIndex;
      this.priorities[position] = lastPriority;
    }
    return [rootIndex, rootPriority];
  }
}

function validateMask(mask: SphericalLandMask): void {
  if (!Number.isInteger(mask.width) || mask.width < 4) throw new Error("mask width must be an integer of at least 4");
  if (!Number.isInteger(mask.height) || mask.height < 2) throw new Error("mask height must be an integer of at least 2");
  if (!(mask.radiusKm > 0) || !Number.isFinite(mask.radiusKm)) throw new Error("mask radiusKm must be finite and positive");
  if (mask.land.length !== mask.width * mask.height) throw new Error("mask land array has the wrong length");
}

function forEachNeighbor(
  index: number,
  geometry: SphericalRasterGeometry,
  visit: (neighbor: number, distanceKm: number) => void,
): void {
  const { width, height, radiusKm, rowLatitudes } = geometry;
  const x = index % width;
  const y = Math.floor(index / width);
  const latitude = rowLatitudes[y];
  const longitudeStep = Math.PI * 2 / width;

  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = y + dy;
    if (ny < 0 || ny >= height) continue;
    const neighborLatitude = rowLatitudes[ny];
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + width) % width;
      const cosine = Math.sin(latitude) * Math.sin(neighborLatitude)
        + Math.cos(latitude) * Math.cos(neighborLatitude) * Math.cos(dx * longitudeStep);
      const distanceKm = Math.acos(clamp(cosine, -1, 1)) * radiusKm;
      visit(ny * width + nx, distanceKm);
    }
  }
}

function distanceToValue(
  values: Uint8Array,
  sourceValue: 0 | 1,
  geometry: SphericalRasterGeometry,
): Float64Array {
  const distances = new Float64Array(values.length);
  distances.fill(Number.POSITIVE_INFINITY);
  const heap = new MinimumHeap();

  for (let index = 0; index < values.length; index += 1) {
    const normalizedValue = values[index] === 0 ? 0 : 1;
    if (normalizedValue === sourceValue) {
      distances[index] = 0;
      heap.push(index, 0);
    }
  }

  while (heap.size > 0) {
    const popped = heap.pop() as readonly [number, number];
    const [index, distance] = popped;
    if (distance !== distances[index]) continue;
    forEachNeighbor(index, geometry, (neighbor, edgeDistance) => {
      const candidate = distance + edgeDistance;
      if (candidate < distances[neighbor]) {
        distances[neighbor] = candidate;
        heap.push(neighbor, candidate);
      }
    });
  }
  return distances;
}

function findComponents(active: Uint8Array, geometry: SphericalRasterGeometry): ComponentsResult {
  const labels = new Int32Array(active.length);
  labels.fill(-1);
  const components: Component[] = [];
  const queue = new Int32Array(active.length);

  for (let start = 0; start < active.length; start += 1) {
    if (active[start] === 0 || labels[start] !== -1) continue;
    const label = components.length;
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    labels[start] = label;
    const cells: number[] = [];
    let areaKm2 = 0;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      cells.push(index);
      areaKm2 += geometry.cellAreasKm2[index];
      forEachNeighbor(index, geometry, (neighbor) => {
        if (active[neighbor] !== 0 && labels[neighbor] === -1) {
          labels[neighbor] = label;
          queue[tail] = neighbor;
          tail += 1;
        }
      });
    }
    components.push({ label, cells, areaKm2 });
  }

  components.sort((a, b) => b.areaKm2 - a.areaKm2);
  // Restore labels to the sorted component order so downstream overlap accounting is simple.
  components.forEach((component, sortedLabel) => {
    component.label = sortedLabel;
    for (const cell of component.cells) labels[cell] = sortedLabel;
  });
  return { labels, components };
}

function tangentBasis(centroid: Vec3): readonly [Vec3, Vec3] {
  const reference: Vec3 = Math.abs(centroid[2]) < 0.85 ? [0, 0, 1] : [1, 0, 0];
  const first = normalize([
    reference[1] * centroid[2] - reference[2] * centroid[1],
    reference[2] * centroid[0] - reference[0] * centroid[2],
    reference[0] * centroid[1] - reference[1] * centroid[0],
  ]);
  const second = normalize([
    centroid[1] * first[2] - centroid[2] * first[1],
    centroid[2] * first[0] - centroid[0] * first[2],
    centroid[0] * first[1] - centroid[1] * first[0],
  ]);
  return [first, second];
}

function shapeMetrics(
  component: Component,
  geometry: SphericalRasterGeometry,
  totalLandAreaKm2: number,
  coastlinePerimeterKm: number,
): LandmassShapeMetrics {
  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;
  for (const index of component.cells) {
    const weight = geometry.cellAreasKm2[index];
    const point = cellCenter(geometry, index);
    centroidX += point[0] * weight;
    centroidY += point[1] * weight;
    centroidZ += point[2] * weight;
  }
  const centroid = normalize([centroidX, centroidY, centroidZ]);
  const [basisX, basisY] = tangentBasis(centroid);
  let covarianceXX = 0;
  let covarianceXY = 0;
  let covarianceYY = 0;

  for (const index of component.cells) {
    const weight = geometry.cellAreasKm2[index];
    const point = cellCenter(geometry, index);
    const cosine = clamp(dot(centroid, point), -1, 1);
    const angle = Math.acos(cosine);
    const sine = Math.sin(angle);
    let tangentX = 0;
    let tangentY = 0;
    if (sine > 1e-12) {
      const scale = angle / sine;
      tangentX = dot(point, basisX) * scale;
      tangentY = dot(point, basisY) * scale;
    }
    covarianceXX += weight * tangentX * tangentX;
    covarianceXY += weight * tangentX * tangentY;
    covarianceYY += weight * tangentY * tangentY;
  }
  covarianceXX /= component.areaKm2;
  covarianceXY /= component.areaKm2;
  covarianceYY /= component.areaKm2;
  const trace = covarianceXX + covarianceYY;
  const discriminant = Math.sqrt(Math.max(0,
    (covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY * covarianceXY));
  const largestEigenvalue = Math.max(0, (trace + discriminant) / 2);
  const smallestEigenvalue = Math.max(1e-12, (trace - discriminant) / 2);
  const elongation = Math.sqrt(largestEigenvalue / smallestEigenvalue);

  let endpoint = component.cells[0];
  for (let pass = 0; pass < 2; pass += 1) {
    const origin = cellCenter(geometry, endpoint);
    let farthestAngle = -1;
    for (const index of component.cells) {
      const angle = Math.acos(clamp(dot(origin, cellCenter(geometry, index)), -1, 1));
      if (angle > farthestAngle) {
        farthestAngle = angle;
        endpoint = index;
      }
    }
  }
  const origin = cellCenter(geometry, endpoint);
  let diameterAngle = 0;
  let enclosingAngle = 0;
  for (const index of component.cells) {
    const point = cellCenter(geometry, index);
    diameterAngle = Math.max(diameterAngle,
      Math.acos(clamp(dot(origin, point), -1, 1)));
    enclosingAngle = Math.max(enclosingAngle,
      Math.acos(clamp(dot(centroid, point), -1, 1)));
  }
  const geodesicDiameterKm = diameterAngle * geometry.radiusKm;
  const capCosine = clamp(1 - component.areaKm2 / (2 * Math.PI * geometry.radiusKm ** 2), -1, 1);
  const equalAreaRadiusKm = Math.acos(capCosine) * geometry.radiusKm;
  const equalAreaPerimeterKm = 2 * Math.PI * geometry.radiusKm
    * Math.sin(equalAreaRadiusKm / geometry.radiusKm);
  const enclosingCapAreaKm2 = 2 * Math.PI * geometry.radiusKm ** 2 * (1 - Math.cos(enclosingAngle));

  return {
    cellCount: component.cells.length,
    areaKm2: component.areaKm2,
    areaShareOfLand: component.areaKm2 / totalLandAreaKm2,
    centroid,
    elongation,
    geodesicDiameterKm,
    equalAreaRadiusKm,
    diameterToEqualAreaDiameter: geodesicDiameterKm / Math.max(1e-9, equalAreaRadiusKm * 2),
    coastlinePerimeterKm,
    normalizedPerimeter: coastlinePerimeterKm / Math.max(1e-9, equalAreaPerimeterKm),
    geodesicSolidityProxy: Math.min(1, component.areaKm2 / Math.max(1e-9, enclosingCapAreaKm2)),
  };
}

function gini(areas: readonly number[]): number {
  if (areas.length <= 1) return 0;
  const sorted = [...areas].sort((a, b) => a - b);
  const total = sorted.reduce((sum, area) => sum + area, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let index = 0; index < sorted.length; index += 1) weighted += (index + 1) * sorted[index];
  return (2 * weighted) / (sorted.length * total) - (sorted.length + 1) / sorted.length;
}

function coastlinePerimeters(
  active: Uint8Array,
  labels: Int32Array,
  componentCount: number,
  geometry: SphericalRasterGeometry,
): { totalKm: number; byComponentKm: Float64Array } {
  const { width, height, radiusKm } = geometry;
  const longitudeStep = Math.PI * 2 / width;
  const latitudeStep = Math.PI / height;
  const meridianEdgeKm = latitudeStep * radiusKm;
  const byComponentKm = new Float64Array(componentCount);
  let totalKm = 0;
  const add = (label: number, lengthKm: number): void => {
    totalKm += lengthKm;
    if (label >= 0) byComponentKm[label] += lengthKm;
  };

  for (let y = 0; y < height; y += 1) {
    const northLatitude = Math.PI / 2 - y * latitudeStep;
    const southLatitude = northLatitude - latitudeStep;
    const northEdgeKm = longitudeStep * radiusKm * Math.max(0, Math.cos(northLatitude));
    const southEdgeKm = longitudeStep * radiusKm * Math.max(0, Math.cos(southLatitude));
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (active[index] === 0) continue;
      const label = labels[index];
      const west = y * width + (x + width - 1) % width;
      const east = y * width + (x + 1) % width;
      if (active[west] === 0) add(label, meridianEdgeKm);
      if (active[east] === 0) add(label, meridianEdgeKm);
      if (y > 0 && active[index - width] === 0) add(label, northEdgeKm);
      if (y + 1 < height && active[index + width] === 0) add(label, southEdgeKm);
    }
  }
  return { totalKm, byComponentKm };
}

function morphologicalOpening(
  active: Uint8Array,
  scaleKm: number,
  geometry: SphericalRasterGeometry,
): Uint8Array {
  const distanceToInactive = distanceToValue(active, 0, geometry);
  const eroded = new Uint8Array(active.length);
  for (let index = 0; index < active.length; index += 1) {
    if (active[index] !== 0 && distanceToInactive[index] >= scaleKm) eroded[index] = 1;
  }
  if (!eroded.some((value) => value !== 0)) return eroded;
  const distanceToEroded = distanceToValue(eroded, 1, geometry);
  const opened = new Uint8Array(active.length);
  for (let index = 0; index < active.length; index += 1) {
    if (distanceToEroded[index] <= scaleKm) opened[index] = 1;
  }
  return opened;
}

function gulfMetricsAtScale(
  scaleKm: number,
  geometry: SphericalRasterGeometry,
  mainOcean: Uint8Array,
  oceanClearanceKm: Float64Array,
): readonly [number, number] {
  const openAtScale = new Uint8Array(mainOcean.length);
  for (let index = 0; index < mainOcean.length; index += 1) {
    if (mainOcean[index] !== 0 && oceanClearanceKm[index] >= scaleKm) openAtScale[index] = 1;
  }
  const { components } = findComponents(openAtScale, geometry);
  if (components.length <= 1) return [0, 0];
  const minimumChamberAreaKm2 = Math.PI * scaleKm * scaleKm;
  let chamberAreaKm2 = 0;
  for (let index = 1; index < components.length; index += 1) {
    if (components[index].areaKm2 >= minimumChamberAreaKm2) {
      chamberAreaKm2 = Math.max(chamberAreaKm2, components[index].areaKm2);
    }
  }
  return [chamberAreaKm2, chamberAreaKm2 / minimumChamberAreaKm2];
}

export function evaluateSphericalLandMask(
  mask: SphericalLandMask,
  options: EvaluationOptions = {},
): SphericalLandmassReport {
  validateMask(mask);
  const geometry = createSphericalRasterGeometry(mask.width, mask.height, mask.radiusKm);
  const land = new Uint8Array(mask.land.length);
  let landAreaKm2 = 0;
  for (let index = 0; index < land.length; index += 1) {
    if (mask.land[index] !== 0) {
      land[index] = 1;
      landAreaKm2 += geometry.cellAreasKm2[index];
    }
  }
  if (landAreaKm2 === 0 || landAreaKm2 >= geometry.totalAreaKm2) {
    throw new Error("evaluation requires both land and water cells");
  }

  const landComponents = findComponents(land, geometry);
  const originalPerimeters = coastlinePerimeters(
    land,
    landComponents.labels,
    landComponents.components.length,
    geometry,
  );
  const componentMetrics = landComponents.components.map((component) =>
    shapeMetrics(component, geometry, landAreaKm2, originalPerimeters.byComponentKm[component.label]));
  const majorMinimumShare = options.majorComponentMinimumLandShare ?? 0.02;
  const majorIndices = landComponents.components
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => component.areaKm2 / landAreaKm2 >= majorMinimumShare);
  const majorComponents = majorIndices.map(({ index }) => componentMetrics[index]);
  const areas = componentMetrics.map((component) => component.areaKm2);
  const squaredShares = componentMetrics.reduce((sum, component) =>
    sum + component.areaShareOfLand ** 2, 0);

  const water = new Uint8Array(land.length);
  for (let index = 0; index < land.length; index += 1) water[index] = land[index] === 0 ? 1 : 0;
  const waterComponents = findComponents(water, geometry);
  const mainOceanLabel = waterComponents.components.length > 0 ? waterComponents.components[0].label : -1;
  const mainOcean = new Uint8Array(land.length);
  let enclosedLakeAreaKm2 = 0;
  for (let index = 0; index < water.length; index += 1) {
    if (waterComponents.labels[index] === mainOceanLabel) mainOcean[index] = 1;
    else if (water[index] !== 0) enclosedLakeAreaKm2 += geometry.cellAreasKm2[index];
  }

  const nominalCellSizeKm = Math.sqrt(geometry.totalAreaKm2 / land.length);
  const minimumSamplesAcross = options.minimumSamplesAcross ?? 3;
  const rawScales = options.scalesKm ?? [100, 200, 400, 800];
  const scales = [...new Set(rawScales.filter((scale) => Number.isFinite(scale) && scale > 0))]
    .sort((a, b) => a - b);
  if (scales.length === 0) throw new Error("at least one positive morphology scale is required");

  const distanceToWaterKm = distanceToValue(land, 0, geometry);
  const oceanClearanceKm = distanceToValue(land, 1, geometry);
  const multiscale: MorphologyScaleMetrics[] = [];

  for (const scaleKm of scales) {
    const erodedLand = new Uint8Array(land.length);
    let retainedAreaKm2 = 0;
    for (let index = 0; index < land.length; index += 1) {
      if (land[index] !== 0 && distanceToWaterKm[index] >= scaleKm) {
        erodedLand[index] = 1;
        retainedAreaKm2 += geometry.cellAreasKm2[index];
      }
    }
    const erodedComponents = findComponents(erodedLand, geometry);
    let weightedSplitExcess = 0;
    let maximumSplitCount = 0;
    for (const { component, index: majorIndex } of majorIndices) {
      const overlapAreas = new Float64Array(erodedComponents.components.length);
      for (const cell of component.cells) {
        const erodedLabel = erodedComponents.labels[cell];
        if (erodedLabel >= 0) overlapAreas[erodedLabel] += geometry.cellAreasKm2[cell];
      }
      const minimumSurvivorArea = Math.max(
        geometry.totalAreaKm2 / land.length * 4,
        component.areaKm2 * 0.01,
      );
      let splitCount = 0;
      for (const overlapArea of overlapAreas) if (overlapArea >= minimumSurvivorArea) splitCount += 1;
      maximumSplitCount = Math.max(maximumSplitCount, splitCount);
      const share = componentMetrics[majorIndex].areaShareOfLand;
      weightedSplitExcess += Math.max(0, splitCount - 1) * share;
    }
    const [gulfChamberAreaKm2, gulfSeverity] = gulfMetricsAtScale(
      scaleKm,
      geometry,
      mainOcean,
      oceanClearanceKm,
    );
    const openedLand = morphologicalOpening(land, scaleKm, geometry);
    const openedLandComponents = findComponents(openedLand, geometry);
    const openedCoastlinePerimeterKm = coastlinePerimeters(
      openedLand,
      openedLandComponents.labels,
      openedLandComponents.components.length,
      geometry,
    ).totalKm;
    const openedOcean = morphologicalOpening(water, scaleKm, geometry);
    let peninsulaAreaKm2 = 0;
    let bayAreaKm2 = 0;
    for (let index = 0; index < land.length; index += 1) {
      if (land[index] !== 0 && openedLand[index] === 0) {
        peninsulaAreaKm2 += geometry.cellAreasKm2[index];
      }
      const closedLand = openedOcean[index] === 0;
      if (land[index] === 0 && closedLand) bayAreaKm2 += geometry.cellAreasKm2[index];
    }
    multiscale.push({
      scaleKm,
      resolved: scaleKm >= nominalCellSizeKm * minimumSamplesAcross,
      retainedLandFraction: retainedAreaKm2 / landAreaKm2,
      weightedSplitExcess,
      maximumSplitCount,
      gulfChamberAreaKm2,
      gulfSeverity,
      openedCoastlinePerimeterKm,
      coastlinePerimeterRetention: openedCoastlinePerimeterKm
        / Math.max(1e-9, originalPerimeters.totalKm),
      peninsulaAreaFraction: peninsulaAreaKm2 / landAreaKm2,
      bayAreaFraction: bayAreaKm2 / landAreaKm2,
    });
  }

  const resolvedScales = multiscale.filter((scale) => scale.resolved);
  const summaryScales = resolvedScales.length > 0 ? resolvedScales : multiscale;
  const coreRetentionMean = summaryScales.reduce((sum, scale) =>
    sum + scale.retainedLandFraction, 0) / summaryScales.length;
  const neckSplitPersistence = summaryScales.reduce((sum, scale) =>
    sum + scale.weightedSplitExcess, 0) / summaryScales.length;
  const maximumMajorElongation = majorComponents.reduce((maximum, component) =>
    Math.max(maximum, component.elongation), 1);
  const maximumMajorDiameterRatio = majorComponents.reduce((maximum, component) =>
    Math.max(maximum, component.diameterToEqualAreaDiameter), 1);
  const elongationPenalty = Math.max(0, Math.log2(maximumMajorElongation));
  const ribbonSeverity = (1 - coreRetentionMean) * (1 + elongationPenalty);
  const openGulfSeverity = summaryScales.reduce((maximum, scale) =>
    Math.max(maximum, scale.gulfSeverity), 0);
  const majorCoastlinePerimeterKm = majorComponents.reduce((sum, component) =>
    sum + component.coastlinePerimeterKm, 0);
  const majorEqualAreaPerimeterKm = majorComponents.reduce((sum, component) =>
    sum + component.coastlinePerimeterKm / Math.max(1e-9, component.normalizedPerimeter), 0);
  const normalizedMajorCoastlinePerimeter = majorCoastlinePerimeterKm
    / Math.max(1e-9, majorEqualAreaPerimeterKm);
  const minimumMajorGeodesicSolidity = majorComponents.reduce((minimum, component) =>
    Math.min(minimum, component.geodesicSolidityProxy), 1);
  const perimeterRetentions = summaryScales.map((scale) =>
    clamp(scale.coastlinePerimeterRetention, 0, 1));
  const meanPerimeterRetention = perimeterRetentions.reduce((sum, retention) =>
    sum + retention, 0) / perimeterRetentions.length;
  const persistentPerimeterRetention = Math.min(...perimeterRetentions);
  const coastlineFineNoiseFraction = 1 - perimeterRetentions[0];
  const peninsulaBayBranchSignal = summaryScales.reduce((sum, scale) =>
    sum + Math.min(1, scale.peninsulaAreaFraction + scale.bayAreaFraction), 0) / summaryScales.length;
  const persistentPerimeterExcess = Math.max(0, normalizedMajorCoastlinePerimeter - 1)
    * Math.sqrt(meanPerimeterRetention * persistentPerimeterRetention)
    * (1 - coastlineFineNoiseFraction * 0.7);
  const largeScaleShapeDeparture = 0.3 + 0.7 * (1 - minimumMajorGeodesicSolidity);
  const coastlineRichness = persistentPerimeterExcess * largeScaleShapeDeparture
    + peninsulaBayBranchSignal * 0.35;

  return {
    landAreaKm2,
    landFraction: landAreaKm2 / geometry.totalAreaKm2,
    componentCount: componentMetrics.length,
    majorComponentCount: majorComponents.length,
    effectiveComponentCount: squaredShares > 0 ? 1 / squaredShares : 0,
    areaGini: gini(areas),
    components: componentMetrics,
    majorComponents,
    maximumMajorElongation,
    maximumMajorDiameterRatio,
    nominalCellSizeKm,
    multiscale,
    coreRetentionMean,
    neckSplitPersistence,
    ribbonSeverity,
    openGulfSeverity,
    enclosedLakeAreaKm2,
    enclosedLakeCount: Math.max(0, waterComponents.components.length - 1),
    coastlinePerimeterKm: originalPerimeters.totalKm,
    normalizedMajorCoastlinePerimeter,
    minimumMajorGeodesicSolidity,
    coastlineRichness,
    coastlineFineNoiseFraction,
    peninsulaBayBranchSignal,
  };
}

export function compareCanonicalMasks(
  first: SphericalLandMask,
  second: SphericalLandMask,
): CanonicalMaskComparison {
  validateMask(first);
  validateMask(second);
  if (first.width !== second.width || first.height !== second.height || first.radiusKm !== second.radiusKm) {
    throw new Error("canonical mask comparison requires identical geometry");
  }
  const geometry = createSphericalRasterGeometry(first.width, first.height, first.radiusKm);
  let intersectionKm2 = 0;
  let unionKm2 = 0;
  let differingAreaKm2 = 0;
  for (let index = 0; index < first.land.length; index += 1) {
    const a = first.land[index] !== 0;
    const b = second.land[index] !== 0;
    if (a && b) intersectionKm2 += geometry.cellAreasKm2[index];
    if (a || b) unionKm2 += geometry.cellAreasKm2[index];
    if (a !== b) differingAreaKm2 += geometry.cellAreasKm2[index];
  }
  return {
    weightedIntersectionOverUnion: unionKm2 > 0 ? intersectionKm2 / unionKm2 : 1,
    differingAreaKm2,
    differingAreaFraction: differingAreaKm2 / sphereAreaKm2(first.radiusKm),
  };
}
