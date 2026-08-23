import { Delaunay } from "d3-delaunay";

export type RenderStyle = "satellite" | "ink" | "climate";

export interface WorldSettings {
  seed: string;
  width: number;
  height: number;
  simulationSites?: number;
  planetScale?: number;
  continentSize: number;
  seaLevel?: number;
  coastDetail: number;
  tectonics: number;
  moisture: number;
  style: RenderStyle;
}

export interface WorldStats {
  name: string;
  survey: string;
  landPercent: number;
  plateCount: number;
  riverCount: number;
  continentSystems: number;
  coastlineIndex: number;
  frameClearance: number;
  largestLandmassPercent: number;
  oceanGapPercent: number;
  meanLandmassElongation: number;
  coastScaleRatio: number;
  coastHierarchyIndex: number;
  islandAreaPercent: number;
  islandSizeDiversity: number;
  majorLandmassCount: number;
  effectiveLandmassCount: number;
  landmassLatitudeDiversity: number;
  landmassSpacingIrregularity: number;
  verticalLandmassBias: number;
  meanMajorLandmassElongation: number;
  landCoreRetention: number;
  landCoreCoverage: number;
  neckFragmentation: number;
  circumferenceKm: number;
  focusLongitude: number;
  generationMs: number;
}

export interface WorldResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stats: WorldStats;
}

interface GraphMesh {
  cellCount: number;
  aspect: number;
  x: Float32Array;
  y: Float32Array;
  neighborOffsets: Uint32Array;
  neighbors: Uint32Array;
  triangles: Uint32Array;
  boundary: Uint8Array;
}

interface Plate {
  id: number;
  siteCell: number;
  x: number;
  y: number;
  weight: number;
  vx: number;
  vy: number;
  continental: boolean;
  crustBias: number;
}

interface TerrainCandidate {
  plates: Plate[];
  plateId: Int16Array;
  potential: Float32Array;
  elevation: Float32Array;
  landMask: Uint8Array;
  ridge: Float32Array;
  seaLevel: number;
  score: number;
  coastlineIndex: number;
  frameClearance: number;
  continentComponents: number;
  largestLandmassShare: number;
  oceanGapShare: number;
  meanLandmassElongation: number;
  oceanBasin: OceanBasinPlan;
}

interface CoastPoint {
  x: number;
  y: number;
  width: number;
}

interface CoastFeature {
  points: CoastPoint[];
  strength: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface CrustStroke {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radiusA: number;
  radiusB: number;
  strength: number;
}

interface CrustMass {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  angle: number;
  strength: number;
  harmonicA: number;
  harmonicB: number;
  phaseA: number;
  phaseB: number;
}

interface CrustComposition {
  masses: CrustMass[];
  terranes: CrustStroke[];
  cuts: CrustStroke[];
  period: number;
}

interface ContinentalSystemPlan {
  id: number;
  province: number;
  targetX: number;
  targetY: number;
  quota: number;
  prominence: number;
}

interface OceanBasinPlan {
  center: number;
  width: number;
  tilt: number;
  meander: number;
  phase: number;
  widthPhase: number;
}

interface ContinentalAssignment {
  cluster: Int16Array;
  systems: ContinentalSystemPlan[];
  oceanBasin: OceanBasinPlan;
}

export interface RasterTerrain {
  elevation: Float32Array;
  mountainStrength: Float32Array;
  coastCoverage: Float32Array;
  coastSigned: Float32Array;
  coastlineIndex: number;
  frameClearance: number;
  coastScaleRatio: number;
  coastHierarchyIndex: number;
  islandAreaPercent: number;
  islandSizeDiversity: number;
  largestLandmassShare: number;
  meaningfulLandmassCount: number;
  majorLandmassCount: number;
  effectiveLandmassCount: number;
  landmassLatitudeDiversity: number;
  landmassSpacingIrregularity: number;
  verticalLandmassBias: number;
  meanMajorLandmassElongation: number;
  landCoreRetention: number;
  landCoreCoverage: number;
  neckFragmentation: number;
  rockLevel: number;
  snowLevel: number;
}

export interface WorldModel extends WorldResult {
  settings: WorldSettings;
  seed: number;
  raster: RasterTerrain;
  riverMask: Uint8Array;
  shadeMap: Uint8Array;
}

const TAU = Math.PI * 2;
const FRAME_OCEAN_MARGIN = 0.045;

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function wrap(value: number, period = 1) {
  return ((value % period) + period) % period;
}

function periodicDelta(from: number, to: number, period = 1) {
  const delta = to - from;
  return delta - Math.round(delta / period) * period;
}

function smoothstep(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function targetLandFraction(settings: WorldSettings) {
  if (settings.seaLevel === undefined) return mix(0.16, 0.47, settings.continentSize / 100);
  return mix(0.48, 0.19, clamp(settings.seaLevel / 100));
}

function planetScaleMetrics(settings: WorldSettings) {
  const control = clamp((settings.planetScale ?? 60) / 100);
  const circumferenceKm = mix(28_000, 72_000, control);
  const earthRatio = circumferenceKm / 40_075;
  return {
    control,
    circumferenceKm,
    earthRatio,
    // Geographic formations retain an approximately characteristic physical
    // size. On a larger globe they therefore occupy less of the 2:1 atlas,
    // leaving room for more independent plate provinces and ocean passages.
    featureScale: clamp(Math.pow(earthRatio, -0.78), 0.64, 1.34),
    plateMultiplier: clamp(Math.pow(earthRatio, 1.08), 0.72, 1.82),
  };
}

function oceanBasinProfile(plan: OceanBasinPlan, latitude: number, aspect: number) {
  const centeredLatitude = latitude - 0.5;
  const primaryBend = Math.sin((latitude * 1.17 + plan.phase) * TAU);
  const secondaryBend = Math.sin((latitude * 2.43 - plan.phase * 0.61) * TAU);
  const center = wrap(
    plan.center + plan.tilt * centeredLatitude + plan.meander * (primaryBend + secondaryBend * 0.34),
    aspect,
  );
  const widthVariation = 1
    + Math.sin((latitude * 1.31 + plan.widthPhase) * TAU) * 0.18
    + Math.sin((latitude * 2.77 - plan.widthPhase * 0.73) * TAU) * 0.07;
  return {
    center,
    halfWidth: plan.width * 0.5 * clamp(widthVariation, 0.72, 1.28),
  };
}

function smootherstep(value: number) {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function seedToInt(seed: string) {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    value ^= seed.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function makeRandom(initialSeed: number) {
  let seed = initialSeed >>> 0;
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144269);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function gradientDot(ix: number, iy: number, dx: number, dy: number, seed: number) {
  switch (Math.floor(hash(ix, iy, seed) * 8) & 7) {
    case 0: return dx;
    case 1: return -dx;
    case 2: return dy;
    case 3: return -dy;
    case 4: return (dx + dy) * Math.SQRT1_2;
    case 5: return (dx - dy) * Math.SQRT1_2;
    case 6: return (-dx + dy) * Math.SQRT1_2;
    default: return (-dx - dy) * Math.SQRT1_2;
  }
}

function gradientNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = smootherstep(fx);
  const sy = smootherstep(fy);
  const top = mix(
    gradientDot(ix, iy, fx, fy, seed),
    gradientDot(ix + 1, iy, fx - 1, fy, seed),
    sx,
  );
  const bottom = mix(
    gradientDot(ix, iy + 1, fx, fy - 1, seed),
    gradientDot(ix + 1, iy + 1, fx - 1, fy - 1, seed),
    sx,
  );
  return clamp(mix(top, bottom, sy) * 1.35, -1, 1);
}

function periodicGradientFbmFromUnit(
  longitudeX: number,
  longitudeY: number,
  y: number,
  frequency: number,
  seed: number,
  octaves = 4,
) {
  let value = 0;
  let amplitude = 0.56;
  let octaveFrequency = frequency;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const radius = octaveFrequency / TAU;
    const circleX = longitudeX * radius;
    const circleY = longitudeY * radius;
    const vertical = y * octaveFrequency;
    const first = gradientNoise(circleX + vertical * 0.31, circleY + vertical * 0.73, seed + octave * 53);
    const second = gradientNoise(circleX * 0.82 - vertical * 0.67 + 17, circleY * 0.82 + vertical * 0.39 - 11, seed + octave * 53 + 19);
    value += mix(first, second, 0.42) * amplitude;
    total += amplitude;
    octaveFrequency *= 2.03;
    amplitude *= 0.48;
  }
  return value / total;
}

function periodicGradientFbm(x: number, y: number, frequency: number, seed: number, octaves = 4) {
  const angle = wrap(x) * TAU;
  return periodicGradientFbmFromUnit(Math.cos(angle), Math.sin(angle), y, frequency, seed, octaves);
}

function periodicRidgedNoise(x: number, y: number, frequency: number, seed: number) {
  return 1 - Math.abs(periodicGradientFbm(x, y, frequency, seed, 4));
}

class MinHeap {
  private values: { index: number; priority: number; source?: number }[] = [];

  push(item: { index: number; priority: number; source?: number }) {
    this.values.push(item);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const parentValue = this.values[parent];
      if (parentValue.priority < item.priority || (parentValue.priority === item.priority && parentValue.index <= item.index)) break;
      this.values[child] = parentValue;
      child = parent;
    }
    this.values[child] = item;
  }

  pop() {
    if (!this.values.length) return undefined;
    const root = this.values[0];
    const tail = this.values.pop();
    if (this.values.length && tail) {
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1;
        if (left >= this.values.length) break;
        const right = left + 1;
        let child = left;
        if (right < this.values.length) {
          const a = this.values[left];
          const b = this.values[right];
          if (b.priority < a.priority || (b.priority === a.priority && b.index < a.index)) child = right;
        }
        const childValue = this.values[child];
        if (childValue.priority > tail.priority || (childValue.priority === tail.priority && childValue.index >= tail.index)) break;
        this.values[parent] = childValue;
        parent = child;
      }
      this.values[parent] = tail;
    }
    return root;
  }

  get size() { return this.values.length; }
}

function poissonAttempt(random: () => number, aspect: number, radius: number) {
  const cellSize = radius / Math.SQRT2;
  const gridWidth = Math.ceil(aspect / cellSize);
  const gridHeight = Math.ceil(1 / cellSize);
  const grid = new Int32Array(gridWidth * gridHeight).fill(-1);
  const points: [number, number][] = [];
  const active: number[] = [];
  const margin = radius * 0.58;

  const add = (x: number, y: number) => {
    const index = points.length;
    points.push([x, y]);
    active.push(index);
    grid[Math.floor(y / cellSize) * gridWidth + Math.floor(x / cellSize)] = index;
  };
  add(margin + random() * (aspect - margin * 2), margin + random() * (1 - margin * 2));

  while (active.length) {
    const activeSlot = Math.floor(random() * active.length);
    const origin = points[active[activeSlot]];
    let placed = false;
    for (let attempt = 0; attempt < 28; attempt += 1) {
      const angle = random() * TAU;
      const distance = radius * (1 + random());
      const x = origin[0] + Math.cos(angle) * distance;
      const y = origin[1] + Math.sin(angle) * distance;
      if (x < margin || x > aspect - margin || y < margin || y > 1 - margin) continue;
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      let valid = true;
      for (let oy = -2; oy <= 2 && valid; oy += 1) {
        const py = gy + oy;
        if (py < 0 || py >= gridHeight) continue;
        for (let ox = -2; ox <= 2; ox += 1) {
          const px = gx + ox;
          if (px < 0 || px >= gridWidth) continue;
          const pointIndex = grid[py * gridWidth + px];
          if (pointIndex < 0) continue;
          const point = points[pointIndex];
          if (Math.hypot(x - point[0], y - point[1]) < radius) {
            valid = false;
            break;
          }
        }
      }
      if (!valid) continue;
      add(x, y);
      placed = true;
      break;
    }
    if (!placed) {
      active[activeSlot] = active[active.length - 1];
      active.pop();
    }
  }
  return points;
}

function generatePoissonPoints(random: () => number, targetCount: number, aspect: number) {
  let radius = Math.sqrt(aspect / targetCount) * 0.9;
  let points: [number, number][] = [];
  for (let pass = 0; pass < 3; pass += 1) {
    points = poissonAttempt(random, aspect, radius);
    if (points.length >= targetCount * 0.78) break;
    radius *= 0.9;
  }

  const boundarySpacing = radius * 0.88;
  const boundaryPoints: [number, number][] = [];
  const horizontalCount = Math.max(2, Math.ceil(aspect / boundarySpacing));
  const verticalCount = Math.max(2, Math.ceil(1 / boundarySpacing));
  for (let i = 0; i <= horizontalCount; i += 1) {
    const x = (i / horizontalCount) * aspect;
    boundaryPoints.push([x, 0], [x, 1]);
  }
  for (let i = 1; i < verticalCount; i += 1) {
    const y = i / verticalCount;
    boundaryPoints.push([0, y], [aspect, y]);
  }
  return boundaryPoints.concat(points);
}

function buildGraphMesh(seed: number, width: number, height: number, simulationSites?: number) {
  const aspect = width / height;
  const targetCount = simulationSites
    ? Math.round(clamp(simulationSites, 1800, 28000))
    : Math.round(clamp((width * height) / 26, 1800, 28000));
  const random = makeRandom(seed ^ 0x51f15e);
  const points = generatePoissonPoints(random, targetCount, aspect);
  const delaunay = Delaunay.from(points);
  const cellCount = points.length;
  const x = new Float32Array(cellCount);
  const y = new Float32Array(cellCount);
  const boundary = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    x[index] = points[index][0];
    y[index] = points[index][1];
    if (points[index][1] === 0 || points[index][1] === 1) boundary[index] = 1;
  }

  const neighborSets = Array.from({ length: cellCount }, (_, index) => new Set(delaunay.neighbors(index)));
  const leftSeam = points.map((point, index) => ({ point, index }))
    .filter(({ point }) => point[0] === 0 && point[1] > 0 && point[1] < 1)
    .sort((a, b) => a.point[1] - b.point[1]);
  const rightSeam = points.map((point, index) => ({ point, index }))
    .filter(({ point }) => point[0] === aspect && point[1] > 0 && point[1] < 1)
    .sort((a, b) => a.point[1] - b.point[1]);
  for (let seam = 0; seam < Math.min(leftSeam.length, rightSeam.length); seam += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      const other = seam + offset;
      if (other < 0 || other >= rightSeam.length) continue;
      neighborSets[leftSeam[seam].index].add(rightSeam[other].index);
      neighborSets[rightSeam[other].index].add(leftSeam[seam].index);
    }
  }

  const neighborLists: number[][] = [];
  let neighborCount = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const neighbors = Array.from(neighborSets[index]).sort((a, b) => a - b);
    neighborLists.push(neighbors);
    neighborCount += neighbors.length;
  }
  const neighborOffsets = new Uint32Array(cellCount + 1);
  const neighbors = new Uint32Array(neighborCount);
  let cursor = 0;
  for (let index = 0; index < cellCount; index += 1) {
    neighborOffsets[index] = cursor;
    for (const neighbor of neighborLists[index]) neighbors[cursor++] = neighbor;
  }
  neighborOffsets[cellCount] = cursor;

  return {
    cellCount,
    aspect,
    x,
    y,
    neighborOffsets,
    neighbors,
    triangles: new Uint32Array(delaunay.triangles),
    boundary,
  } satisfies GraphMesh;
}

function graphDistance(mesh: GraphMesh, a: number, b: number) {
  return Math.max(0.001, Math.hypot(periodicDelta(mesh.x[a], mesh.x[b], mesh.aspect), mesh.y[a] - mesh.y[b]));
}

function choosePlateSites(mesh: GraphMesh, random: () => number, count: number) {
  const sites: number[] = [];
  let first = Math.floor(random() * mesh.cellCount);
  while (mesh.boundary[first]) first = (first + 1) % mesh.cellCount;
  sites.push(first);
  const nearest = new Float32Array(mesh.cellCount).fill(Number.POSITIVE_INFINITY);
  while (sites.length < count) {
    const last = sites[sites.length - 1];
    let best = 0;
    let bestScore = -1;
    for (let cell = 0; cell < mesh.cellCount; cell += 1) {
      if (mesh.boundary[cell]) continue;
      nearest[cell] = Math.min(nearest[cell], graphDistance(mesh, cell, last));
      const score = nearest[cell] * (0.86 + hash(cell, sites.length, 911) * 0.24);
      if (score > bestScore) {
        best = cell;
        bestScore = score;
      }
    }
    sites.push(best);
  }
  return sites;
}

function assignPlateOwnership(mesh: GraphMesh, plates: Plate[]) {
  const plateId = new Int16Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    let bestPlate = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const plate of plates) {
      const dx = periodicDelta(plate.x, mesh.x[cell], mesh.aspect);
      const dy = mesh.y[cell] - plate.y;
      const score = (dx * dx + dy * dy) / (plate.weight * plate.weight);
      if (score < bestScore || (score === bestScore && plate.id < bestPlate)) {
        bestPlate = plate.id;
        bestScore = score;
      }
    }
    plateId[cell] = bestPlate;
  }
  return plateId;
}

function buildPlateAdjacency(mesh: GraphMesh, plateId: Int16Array, plateCount: number) {
  const adjacency = Array.from({ length: plateCount }, () => new Set<number>());
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const plate = plateId[cell];
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      const other = plateId[mesh.neighbors[cursor]];
      if (plate !== other) adjacency[plate].add(other);
    }
  }
  return adjacency;
}

function assignContinentalClusters(
  plates: Plate[],
  adjacency: Set<number>[],
  random: () => number,
  continentalShare: number,
  aspect: number,
  planet: ReturnType<typeof planetScaleMetrics>,
): ContinentalAssignment {
  const desired = Math.round(plates.length * clamp(continentalShare, 0.28, 0.58));
  const mass = clamp((continentalShare - 0.28) / 0.3);
  const scaleRoots = mix(4.5, 9.2, clamp((planet.earthRatio - 0.68) / 1.12));
  const expectedRoots = scaleRoots - mass * 0.72 + (plates.length - 27) * 0.035;
  const rootCapacity = Math.max(4, Math.floor(desired / (planet.control > 0.62 ? 2 : 1.65)));
  const rootCount = Math.min(desired, rootCapacity, Math.round(clamp(expectedRoots + (random() - 0.5) * 1.8, 4, 10)));

  // Compose the planet in a few unequal geographic provinces around one legible
  // ocean basin. This is a clustered point process, rather than farthest-point
  // sampling: neighboring systems can form an "Old World" family while another
  // remains isolated across a broad sea. The exact continent count still emerges
  // later when sea level cuts the continuous field.
  const oceanBasin: OceanBasinPlan = {
    center: random() * aspect,
    width: clamp(mix(0.4, 0.66, random()) * mix(0.96, 1.12, planet.control), 0.38, 0.72),
    tilt: (random() - 0.5) * mix(0.16, 0.28, planet.control),
    meander: mix(0.035, 0.085, random()) * mix(0.9, 1.18, planet.control),
    phase: random(),
    widthPhase: random(),
  };
  const landCenter = wrap(oceanBasin.center + aspect * 0.5, aspect);
  const provinceCount = rootCount >= 8 && random() < 0.74 ? 4 : rootCount >= 6 && random() < 0.82 ? 3 : 2;
  const landArc = aspect - oceanBasin.width;

  // Unequal Dirichlet-like gaps prevent the geographic provinces from landing
  // on a regular longitude grid. One gap is deliberately widened and another
  // tightened, producing an isolated continent plus a more closely related
  // "Old World" family without prescribing the final number of landmasses.
  const gapWeights = Array.from({ length: provinceCount + 1 }, () => (
    0.22 + Math.pow(-Math.log(Math.max(0.025, random())), 1.18)
  ));
  const wideGap = 1 + Math.floor(random() * Math.max(1, provinceCount - 1));
  gapWeights[wideGap] *= mix(1.65, 2.45, random());
  const alternativeInternalGaps = Array.from({ length: Math.max(0, provinceCount - 1) }, (_, index) => index + 1)
    .filter((gap) => gap !== wideGap);
  const narrowGap = alternativeInternalGaps.length
    ? alternativeInternalGaps[Math.floor(random() * alternativeInternalGaps.length)]
    : (random() < 0.5 ? 0 : provinceCount);
  gapWeights[narrowGap] *= mix(0.42, 0.68, random());
  const totalGapWeight = gapWeights.reduce((sum, weight) => sum + weight, 0);
  const occupiedArc = landArc * mix(0.78, 0.9, random());
  let cursor = -occupiedArc * 0.5;
  const provinceOffsets: number[] = [];
  for (let province = 0; province < provinceCount; province += 1) {
    cursor += occupiedArc * (gapWeights[province] / totalGapWeight);
    provinceOffsets.push(cursor);
  }

  // Latitudes follow a slanted, low-frequency continental drift curve with a
  // small independent offset. This produces staggered hemispheres and varied
  // polar reach instead of the former alternating north/south rows.
  const latitudeCenter = mix(0.36, 0.64, random());
  const latitudeTrend = (random() - 0.5) * mix(0.34, 0.58, planet.control);
  const latitudeWave = mix(0.08, 0.2, random());
  const latitudePhase = random() * TAU;
  const latitudePattern: number[] = [];
  provinceOffsets.forEach((offset, index) => {
    const normalizedOffset = offset / Math.max(0.001, occupiedArc * 0.5);
    const curve = latitudeCenter
      + latitudeTrend * normalizedOffset * 0.5
      + Math.sin(latitudePhase + normalizedOffset * mix(1.15, 2.35, random())) * latitudeWave
      + (random() - 0.5) * 0.13;
    const previous = index > 0 ? latitudePattern[index - 1] : Number.NaN;
    let latitude = clamp(curve, 0.14, 0.86);
    if (Number.isFinite(previous) && Math.abs(latitude - previous) < 0.055) {
      latitude = clamp(latitude + (random() < 0.5 ? -1 : 1) * mix(0.07, 0.14, random()), 0.14, 0.86);
    }
    latitudePattern.push(latitude);
  });
  const rawProvinceWeights = provinceCount === 4 ? [1.72, 1.18, 0.92, 0.68] : provinceCount === 3 ? [1.7, 1.08, 0.82] : [1.62, 1.08];
  const provinceWeights = rawProvinceWeights.map((weight) => mix(weight, 1, planet.control * 0.58));
  if (random() < 0.38) provinceWeights[0] *= mix(1.22, 1.08, planet.control);

  const provinceAssignments = Array.from({ length: provinceCount }, (_, index) => index);
  while (provinceAssignments.length < rootCount) {
    let total = 0;
    for (const weight of provinceWeights) total += weight;
    let draw = random() * total;
    let selected = 0;
    for (let province = 0; province < provinceWeights.length; province += 1) {
      draw -= provinceWeights[province];
      if (draw <= 0) {
        selected = province;
        break;
      }
    }
    provinceAssignments.push(selected);
  }
  provinceAssignments.sort((a, b) => a - b);

  const systems: ContinentalSystemPlan[] = [];
  const roots: number[] = [];
  for (let id = 0; id < rootCount; id += 1) {
    const province = provinceAssignments[id];
    const siblings = systems.filter((system) => system.province === province).length;
    const angle = random() * TAU + siblings * 2.17;
    const spread = siblings === 0
      ? mix(0.018, 0.058, random())
      : mix(0.13, 0.32, random()) * Math.pow(planet.featureScale, 0.2) * mix(1, 1.18, planet.control);
    const provisionalY = clamp(latitudePattern[province] + Math.sin(angle) * spread * mix(0.48, 0.8, random()), 0.14, 0.86);
    const oceanAtLatitude = oceanBasinProfile(oceanBasin, provisionalY, aspect);
    const oceanShift = periodicDelta(oceanBasin.center, oceanAtLatitude.center, aspect);
    const targetX = wrap(landCenter + provinceOffsets[province] + oceanShift + Math.cos(angle) * spread, aspect);
    const targetY = provisionalY;
    const prominenceSample = random();
    const prominence = id === 0
      ? mix(mix(1.75, 2.15, prominenceSample), mix(1.5, 1.82, prominenceSample), planet.control)
      : provinceWeights[province] * mix(0.76, 1.16, prominenceSample);

    let root = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const plate of plates) {
      if (roots.includes(plate.id)) continue;
      const targetDistance = Math.hypot(periodicDelta(targetX, plate.x, aspect), plate.y - targetY);
      let crowding = 0;
      for (const existing of roots) {
        const separation = Math.hypot(periodicDelta(plates[existing].x, plate.x, aspect), plate.y - plates[existing].y);
        const minimumSeparation = mix(0.145, 0.27, planet.control) * Math.pow(planet.featureScale, 0.1);
        if (separation < minimumSeparation) crowding += (minimumSeparation - separation) * 8;
      }
      const score = targetDistance + crowding + Math.abs(plate.y - 0.5) * 0.035 + random() * 0.025;
      if (score < bestScore) {
        bestScore = score;
        root = plate.id;
      }
    }
    if (root < 0) break;
    roots.push(root);
    systems.push({ id, province, targetX, targetY, quota: 1, prominence });
  }

  let quotaAssigned = systems.length;
  if (desired >= systems.length * 2) {
    for (const system of systems) system.quota = 2;
    quotaAssigned = systems.length * 2;
  }
  while (quotaAssigned < desired) {
    let selected = 0;
    let bestNeed = -1;
    for (const system of systems) {
      const need = system.prominence / Math.pow(system.quota + 0.35, 1.18) * mix(0.9, 1.1, random());
      if (need > bestNeed) {
        bestNeed = need;
        selected = system.id;
      }
    }
    systems[selected].quota += 1;
    quotaAssigned += 1;
  }

  const continental = new Uint8Array(plates.length);
  const cluster = new Int16Array(plates.length).fill(-1);
  roots.forEach((root, index) => {
    continental[root] = 1;
    cluster[root] = index;
  });
  let assigned = roots.length;
  let roundsWithoutGrowth = 0;
  while (assigned < desired && roundsWithoutGrowth < roots.length * 4) {
    let grew = false;
    const growthOrder = systems
      .filter((system) => {
        let count = 0;
        for (let id = 0; id < cluster.length; id += 1) if (cluster[id] === system.id) count += 1;
        return count < system.quota;
      })
      .sort((a, b) => b.prominence - a.prominence || a.id - b.id);
    for (const system of growthOrder) {
      if (assigned >= desired) break;
      const clusterId = system.id;
      const frontier: { plate: number; score: number }[] = [];
      for (const plate of plates) {
        if (cluster[plate.id] !== clusterId) continue;
        for (const neighbor of adjacency[plate.id]) {
          if (continental[neighbor]) continue;
          const candidate = plates[neighbor];
          const targetDistance = Math.hypot(periodicDelta(system.targetX, candidate.x, aspect), candidate.y - system.targetY);
          const rootDistance = Math.hypot(periodicDelta(plates[roots[clusterId]].x, candidate.x, aspect), candidate.y - plates[roots[clusterId]].y);
          const latitudePenalty = Math.abs(candidate.y - 0.5) * 0.06;
          frontier.push({ plate: neighbor, score: targetDistance * 0.7 + rootDistance * 0.34 + random() * 0.11 + latitudePenalty });
        }
      }
      frontier.sort((a, b) => a.score - b.score || a.plate - b.plate);
      if (frontier.length) {
        const selected = frontier[0].plate;
        continental[selected] = 1;
        cluster[selected] = clusterId;
        assigned += 1;
        grew = true;
      }
    }
    roundsWithoutGrowth = grew ? 0 : roundsWithoutGrowth + 1;
  }
  plates.forEach((plate) => { plate.continental = Boolean(continental[plate.id]); });
  return { cluster, systems, oceanBasin };
}

function buildCrustComposition(
  plates: Plate[],
  assignment: ContinentalAssignment,
  aspect: number,
  random: () => number,
  planet: ReturnType<typeof planetScaleMetrics>,
): CrustComposition {
  const masses: CrustMass[] = [];
  const terranes: CrustStroke[] = [];
  const cuts: CrustStroke[] = [];
  const geographyScale = planet.featureScale;
  const groups = new Map<number, Plate[]>();
  for (const plate of plates) {
    const clusterId = assignment.cluster[plate.id];
    if (clusterId < 0) continue;
    const group = groups.get(clusterId) ?? [];
    group.push(plate);
    groups.set(clusterId, group);
  }
  const constrainY = (value: number) => clamp(value, 0.065, 0.935);
  const point = (plate: Plate) => ({ x: plate.x, y: plate.y });
  const entries = [...groups.entries()].sort((a, b) => {
    const planA = assignment.systems[a[0]];
    const planB = assignment.systems[b[0]];
    return (planB?.prominence ?? 0) - (planA?.prominence ?? 0) || b[1].length - a[1].length;
  });

  const addPath = (
    target: CrustStroke[],
    start: { x: number; y: number },
    heading: number,
    length: number,
    segments: number,
    widthA: number,
    widthB: number,
    strength: number,
    curl: number,
  ) => {
    let previous = start;
    let previousWidth = widthA;
    let direction = heading;
    for (let segment = 1; segment <= segments; segment += 1) {
      const progress = segment / segments;
      direction += curl / segments + (random() - 0.5) * mix(0.2, 0.07, progress);
      const step = length / segments * mix(0.88, 1.12, random());
      const next = {
        x: previous.x + Math.cos(direction) * step,
        y: constrainY(previous.y + Math.sin(direction) * step),
      };
      const nextWidth = mix(widthA, widthB, Math.pow(progress, 0.82)) * mix(0.9, 1.08, random());
      target.push({
        ax: previous.x,
        ay: previous.y,
        bx: next.x,
        by: next.y,
        radiusA: previousWidth,
        radiusB: nextWidth,
        strength,
      });
      previous = next;
      previousWidth = nextWidth;
    }
    return previous;
  };

  const addIslandChain = (
    origin: { x: number; y: number },
    heading: number,
    totalLength: number,
    islandCount: number,
    firstRadius: number,
    bend: number,
    strength: number,
  ) => {
    totalLength *= geographyScale;
    firstRadius *= geographyScale * 1.08;
    let px = origin.x;
    let py = origin.y;
    let direction = heading;
    for (let island = 0; island < islandCount; island += 1) {
      const progress = island / Math.max(1, islandCount - 1);
      direction += bend / islandCount + (random() - 0.5) * 0.34;
      const spacing = Math.max(
        totalLength / Math.max(1, islandCount - 0.35) * mix(0.82, 1.28, random()),
        firstRadius * mix(3.15, 3.75, random()),
      );
      px += Math.cos(direction) * spacing;
      py = constrainY(py + Math.sin(direction) * spacing);
      const anchorBoost = island === 0 || (island === Math.floor(islandCount * 0.55) && random() < 0.58) ? 1.28 : 1;
      const radius = firstRadius * mix(1, 0.34, Math.pow(progress, 0.72)) * mix(0.72, 1.24, random()) * anchorBoost;
      const islandAngle = direction + (random() - 0.5) * 0.95;
      masses.push({
        x: px,
        y: py,
        radiusX: radius * mix(1.12, 1.56, random()),
        radiusY: radius * mix(0.62, 1, random()),
        angle: islandAngle,
        strength: strength * mix(1.04, 1.22, random()),
        harmonicA: mix(0.1, 0.2, random()),
        harmonicB: mix(0.055, 0.13, random()),
        phaseA: random() * TAU,
        phaseB: random() * TAU,
      });
    }
  };

  for (let rank = 0; rank < entries.length; rank += 1) {
    const [clusterId, group] = entries[rank];
    const system = assignment.systems[clusterId];
    const rawNodes = group.map(point);
    const referenceX = rawNodes[0].x;
    const uncompressed = rawNodes.map((node) => ({ ...node, x: referenceX + periodicDelta(referenceX, node.x, aspect) }));
    const rawCentroid = uncompressed.reduce((sum, node) => ({ x: sum.x + node.x / uncompressed.length, y: sum.y + node.y / uncompressed.length }), { x: 0, y: 0 });
    const compression = rank === 0 ? mix(0.68, 0.79, random()) : mix(0.56, 0.72, random());
    let nodes = uncompressed.map((node) => ({
      x: rawCentroid.x + (node.x - rawCentroid.x) * compression,
      y: constrainY(rawCentroid.y + (node.y - rawCentroid.y) * compression),
    }));
    const centroid = nodes.reduce((sum, node) => ({ x: sum.x + node.x / nodes.length, y: sum.y + node.y / nodes.length }), { x: 0, y: 0 });
    const prominence = clamp((system?.prominence ?? 1) / 2.1, 0.42, 1);
    const coreScale = mix(0.92, 1.12, prominence);
    const isDominant = rank === 0;
    const isRifted = rank === 1 && random() < 0.38;
    const isCrescent = rank > 0 && rank < entries.length - 1 && random() < 0.12;
    const isArchipelagic = group.length === 1 && rank >= Math.ceil(entries.length * 0.58);

    // A distorted anisotropic cratonic mass gives every major system a readable
    // body before lobes, peninsulas, and rifts modify its outline. This avoids
    // both a union of circular blobs and a skeleton of connected strokes.
    const massAngle = random() * TAU;
    if (nodes.length > 1) {
      let covarianceX = 0;
      let covarianceY = 0;
      let covarianceXY = 0;
      for (const node of nodes) {
        const dx = node.x - centroid.x;
        const dy = node.y - centroid.y;
        covarianceX += dx * dx;
        covarianceY += dy * dy;
        covarianceXY += dx * dy;
      }
      const nodeAngle = 0.5 * Math.atan2(2 * covarianceXY, covarianceX - covarianceY);
      const trace = covarianceX + covarianceY;
      const eigenRoot = Math.sqrt(Math.max(0, (covarianceX - covarianceY) ** 2 + 4 * covarianceXY ** 2));
      const majorVariance = Math.max(0, (trace + eigenRoot) * 0.5);
      const minorVariance = Math.max(0, (trace - eigenRoot) * 0.5);
      const nodeElongation = Math.sqrt((majorVariance + 0.00004) / (minorVariance + 0.00004));
      const alongCompression = nodeElongation > 1.55 ? clamp(1.42 / nodeElongation, 0.5, 0.92) : 1;
      const cosine = Math.cos(nodeAngle);
      const sine = Math.sin(nodeAngle);
      nodes = nodes.map((node) => {
        const dx = node.x - centroid.x;
        const dy = node.y - centroid.y;
        const along = (dx * cosine + dy * sine) * alongCompression;
        const across = -dx * sine + dy * cosine;
        return {
          x: centroid.x + along * cosine - across * sine,
          y: constrainY(centroid.y + along * sine + across * cosine),
        };
      });
    }
    const archipelagoScale = isArchipelagic ? mix(0.54, 0.66, random()) : 1;
    const radiusSample = random();
    const dominantRadius = mix(
      mix(0.155, 0.215, radiusSample),
      mix(0.14, 0.19, radiusSample),
      planet.control,
    );
    const majorRadius = (isDominant ? dominantRadius : mix(0.11, 0.175, radiusSample))
      * coreScale * archipelagoScale * geographyScale;
    const minorRadius = majorRadius * mix(0.66, 0.88, random());
    masses.push({
      x: centroid.x,
      y: centroid.y,
      radiusX: majorRadius,
      radiusY: minorRadius,
      angle: massAngle,
      strength: mix(0.94, 1.08, random()),
      harmonicA: mix(0.08, 0.16, random()),
      harmonicB: mix(0.045, 0.11, random()),
      phaseA: random() * TAU,
      phaseB: random() * TAU,
    });
    if (isArchipelagic) {
      const chainHeading = massAngle + (random() < 0.5 ? -1 : 1) * mix(0.45, 1.05, random());
      const chainOrigin = {
        x: centroid.x - Math.cos(chainHeading) * majorRadius * 0.52,
        y: constrainY(centroid.y - Math.sin(chainHeading) * majorRadius * 0.52),
      };
      addIslandChain(
        chainOrigin,
        chainHeading,
        mix(0.105, 0.185, random()),
        5 + Math.floor(random() * 4),
        mix(0.014, 0.024, random()),
        (random() < 0.5 ? -1 : 1) * mix(0.45, 0.95, random()),
        mix(0.93, 1.06, random()),
      );
    }
    if ((isDominant || group.length >= 3) && random() < 0.72) {
      const offsetAngle = massAngle + mix(0.7, 1.35, random()) * (random() < 0.5 ? -1 : 1);
      const offset = majorRadius * mix(0.42, 0.72, random());
      masses.push({
        x: centroid.x + Math.cos(offsetAngle) * offset,
        y: constrainY(centroid.y + Math.sin(offsetAngle) * offset),
        radiusX: majorRadius * mix(0.56, 0.78, random()),
        radiusY: minorRadius * mix(0.58, 0.82, random()),
        angle: massAngle + (random() - 0.5) * 1.1,
        strength: mix(0.88, 1.01, random()),
        harmonicA: mix(0.07, 0.14, random()),
        harmonicB: mix(0.04, 0.09, random()),
        phaseA: random() * TAU,
        phaseB: random() * TAU,
      });
    }

    // Broad, overlapping terranes establish compact silhouettes. Plate centers
    // influence their placement, but are pulled toward a shared cratonic core so
    // a three-plate system does not become a chain of paddles.
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const radius = mix(0.067, 0.108, random()) * coreScale * (isArchipelagic ? 0.72 : 1) * geographyScale;
      const angle = Math.atan2(group[index].vy, group[index].vx) + (random() - 0.5) * 0.75;
      const halfLength = mix(0.018, 0.052, random()) * coreScale * geographyScale;
      terranes.push({
        ax: node.x - Math.cos(angle) * halfLength,
        ay: constrainY(node.y - Math.sin(angle) * halfLength),
        bx: node.x + Math.cos(angle) * halfLength,
        by: constrainY(node.y + Math.sin(angle) * halfLength),
        radiusA: radius * mix(0.82, 1, random()),
        radiusB: radius * mix(0.82, 1, random()),
        strength: mix(0.96, 1.1, random()),
      });
    }

    // A few offset lobes make shoulders, inland plains, and asymmetric capes.
    // They are deliberately shorter and wider than the old branch grammar.
    const lobeCount = (isDominant ? 3 : 2) + Math.floor(random() * 2);
    const lobePhase = random() * TAU;
    for (let lobe = 0; lobe < lobeCount; lobe += 1) {
      const angle = lobePhase + (lobe / lobeCount) * TAU + (random() - 0.5) * 0.68;
      const offset = mix(majorRadius * 0.48, majorRadius * 0.84, random());
      const lobeCenter = {
        x: centroid.x + Math.cos(angle) * offset,
        y: constrainY(centroid.y + Math.sin(angle) * offset),
      };
      masses.push({
        x: lobeCenter.x,
        y: lobeCenter.y,
        radiusX: majorRadius * mix(0.31, 0.5, random()),
        radiusY: minorRadius * mix(0.34, 0.56, random()),
        angle: angle + (random() - 0.5) * 1.35,
        strength: mix(0.91, 1.04, random()),
        harmonicA: mix(0.11, 0.2, random()),
        harmonicB: mix(0.065, 0.13, random()),
        phaseA: random() * TAU,
        phaseB: random() * TAU,
      });
      const halfLength = mix(0.027, 0.071, random()) * coreScale * geographyScale;
      const width = mix(0.04, 0.071, random()) * coreScale * (isArchipelagic ? 0.68 : 1) * geographyScale;
      const tangent = angle + (random() - 0.5) * 0.9;
      terranes.push({
        ax: lobeCenter.x - Math.cos(tangent) * halfLength,
        ay: constrainY(lobeCenter.y - Math.sin(tangent) * halfLength),
        bx: lobeCenter.x + Math.cos(tangent) * halfLength,
        by: constrainY(lobeCenter.y + Math.sin(tangent) * halfLength),
        radiusA: width * mix(0.82, 1, random()),
        radiusB: width * mix(0.76, 1, random()),
        strength: mix(0.94, 1.08, random()),
      });
    }

    if (nodes.length > 1) {
      const connected = new Set<number>([Math.floor(random() * nodes.length)]);
      while (connected.size < nodes.length) {
        let bestFrom = 0;
        let bestTo = 0;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const from of connected) {
          for (let to = 0; to < nodes.length; to += 1) {
            if (connected.has(to)) continue;
            const distance = Math.hypot(nodes[to].x - nodes[from].x, nodes[to].y - nodes[from].y);
            const score = distance * mix(0.88, 1.12, random());
            if (score < bestScore) {
              bestScore = score;
              bestFrom = from;
              bestTo = to;
            }
          }
        }
        const a = nodes[bestFrom];
        const b = nodes[bestTo];
        const bendX = (a.x + b.x) * 0.5 + (random() - 0.5) * 0.035;
        const bendY = (a.y + b.y) * 0.5 + (random() - 0.5) * 0.035;
        const width = mix(0.049, 0.075, random()) * coreScale * geographyScale;
        terranes.push(
          { ax: a.x, ay: a.y, bx: bendX, by: bendY, radiusA: width, radiusB: width * mix(0.82, 1.04, random()), strength: 1.04 },
          { ax: bendX, ay: bendY, bx: b.x, by: b.y, radiusA: width * mix(0.82, 1.04, random()), radiusB: width, strength: 1.04 },
        );
        connected.add(bestTo);
      }
    }

    // Sparse peninsula grammar: most systems get one or two arms; only a single
    // secondary system can become crescent-like. Fine shoreline noise supplies
    // the many small capes instead of repeating the same macro stroke everywhere.
    const branchCount = isArchipelagic ? 0 : isDominant ? 2 + (random() < 0.38 ? 1 : 0) : 1 + (random() < 0.4 ? 1 : 0);
    const branchPhase = random() * TAU;
    for (let branch = 0; branch < branchCount; branch += 1) {
      const anchor = nodes.length > 1
        ? [...nodes].sort((a, b) => Math.hypot(b.x - centroid.x, b.y - centroid.y) - Math.hypot(a.x - centroid.x, a.y - centroid.y))[branch % nodes.length]
        : nodes[0];
      let outwardX = anchor.x - centroid.x;
      let outwardY = anchor.y - centroid.y;
      const outwardLength = Math.hypot(outwardX, outwardY);
      if (outwardLength < 0.025) {
        outwardX = Math.cos(branchPhase + (branch / Math.max(1, branchCount)) * TAU);
        outwardY = Math.sin(branchPhase + (branch / Math.max(1, branchCount)) * TAU);
      }
      const baseAngle = Math.atan2(outwardY, outwardX) + (random() - 0.5) * 0.92;
      const totalLength = (isCrescent && branch === 0 ? mix(0.075, 0.12, random()) : mix(0.045, 0.096, random())) * geographyScale;
      const rootWidth = mix(0.038, 0.058, random()) * geographyScale;
      const tipWidth = rootWidth * mix(0.66, 0.86, random());
      const hook = (random() < 0.5 ? -1 : 1) * (isCrescent && branch === 0 ? mix(0.58, 0.92, random()) : mix(0.16, 0.52, random()));
      const end = addPath(terranes, anchor, baseAngle, totalLength, 3 + Math.floor(random() * 2), rootWidth, tipWidth, mix(0.98, 1.1, random()), hook);

      if (random() < (isDominant ? 0.68 : 0.5)) {
        const tangent = baseAngle + hook + (random() < 0.5 ? -1 : 1) * mix(0.55, 0.95, random());
        const gap = mix(0.025, 0.052, random());
        const fragmentStart = { x: end.x + Math.cos(tangent) * gap, y: constrainY(end.y + Math.sin(tangent) * gap) };
        addIslandChain(
          fragmentStart,
          tangent,
          mix(0.075, 0.16, random()),
          4 + Math.floor(random() * 5),
          mix(0.01, 0.019, random()),
          (random() < 0.5 ? -1 : 1) * mix(0.28, 0.78, random()),
          mix(0.91, 1.04, random()),
        );
      }
    }

    if (!isArchipelagic && random() < (isDominant ? 0.68 : 0.48)) {
      const coastAngle = random() * TAU;
      const chainHeading = coastAngle + (random() < 0.5 ? -1 : 1) * mix(0.28, 0.82, random());
      const coastOrigin = {
        x: centroid.x + Math.cos(coastAngle) * (majorRadius + mix(0.02, 0.045, random())),
        y: constrainY(centroid.y + Math.sin(coastAngle) * (majorRadius + mix(0.02, 0.045, random()))),
      };
      addIslandChain(
        coastOrigin,
        chainHeading,
        mix(0.07, 0.145, random()),
        3 + Math.floor(random() * 5),
        mix(0.008, 0.016, random()),
        (random() < 0.5 ? -1 : 1) * mix(0.35, 0.82, random()),
        mix(0.91, 1.03, random()),
      );
    }

    const outerNodes = [...nodes].sort((a, b) => Math.hypot(b.x - centroid.x, b.y - centroid.y) - Math.hypot(a.x - centroid.x, a.y - centroid.y));
    const inletCount = (isRifted ? 2 : isDominant ? 2 : 1) + (random() < 0.3 ? 1 : 0);
    for (let inlet = 0; inlet < inletCount; inlet += 1) {
      const anchor = outerNodes[inlet % outerNodes.length];
      let angle = Math.atan2(anchor.y - centroid.y, anchor.x - centroid.x);
      angle += (random() - 0.5) * 0.58;
      const outside = mix(0.05, 0.1, random()) * geographyScale;
      const start = { x: anchor.x + Math.cos(angle) * outside, y: constrainY(anchor.y + Math.sin(angle) * outside) };
      const cutLength = outside + mix(0.035, isRifted ? 0.105 : 0.078, random()) * geographyScale;
      const mouthWidth = mix(0.027, 0.052, random()) * geographyScale;
      const headWidth = mix(0.013, 0.025, random()) * geographyScale;
      const cutCurl = (random() < 0.5 ? -1 : 1) * mix(0.12, 0.48, random());
      const head = addPath(cuts, start, angle + Math.PI, cutLength, 3 + Math.floor(random() * 2), mouthWidth, headWidth, mix(1.2, 1.52, random()), cutCurl);
      if (random() < 0.5) {
        const branchAngle = angle + Math.PI + cutCurl + (random() < 0.5 ? -1 : 1) * mix(0.55, 0.95, random());
        addPath(cuts, head, branchAngle, mix(0.025, 0.055, random()) * geographyScale, 2, headWidth * 1.15, headWidth * 0.6, mix(1.12, 1.4, random()), (random() - 0.5) * 0.3);
      }
    }

    const basinCount = random() < (isRifted ? 0.68 : 0.34) ? 1 : 0;
    for (let basin = 0; basin < basinCount; basin += 1) {
      const angle = random() * TAU;
      const offset = mix(0.015, 0.052, random()) * geographyScale;
      const basinX = centroid.x + Math.cos(angle) * offset;
      const basinY = constrainY(centroid.y + Math.sin(angle) * offset);
      cuts.push({
        ax: basinX,
        ay: basinY,
        bx: basinX + Math.cos(angle + Math.PI * 0.5) * mix(0.022, 0.058, random()) * geographyScale,
        by: constrainY(basinY + Math.sin(angle + Math.PI * 0.5) * mix(0.022, 0.058, random()) * geographyScale),
        radiusA: mix(0.023, 0.048, random()) * geographyScale,
        radiusB: mix(0.018, 0.04, random()) * geographyScale,
        strength: mix(1.04, 1.38, random()),
      });
    }

    if (isRifted && outerNodes.length > 1 && random() < 0.62) {
      const firstEdge = outerNodes[Math.floor(random() * outerNodes.length)];
      const opposite = [...outerNodes].sort((a, b) => {
        const first = (a.x - centroid.x) * (firstEdge.x - centroid.x) + (a.y - centroid.y) * (firstEdge.y - centroid.y);
        const second = (b.x - centroid.x) * (firstEdge.x - centroid.x) + (b.y - centroid.y) * (firstEdge.y - centroid.y);
        return first - second;
      })[0];
      cuts.push({
        ax: firstEdge.x,
        ay: firstEdge.y,
        bx: opposite.x,
        by: opposite.y,
        radiusA: mix(0.009, 0.018, random()) * geographyScale,
        radiusB: mix(0.008, 0.016, random()) * geographyScale,
        strength: mix(1.22, 1.52, random()),
      });
    }
  }
  return { masses, terranes, cuts, period: aspect };
}

function evaluateCrustMass(x: number, y: number, mass: CrustMass) {
  const cosAngle = Math.cos(mass.angle);
  const sinAngle = Math.sin(mass.angle);
  const dx = x - mass.x;
  const dy = y - mass.y;
  const localX = dx * cosAngle + dy * sinAngle;
  const localY = -dx * sinAngle + dy * cosAngle;
  const theta = Math.atan2(localY / mass.radiusY, localX / mass.radiusX);
  const boundary = Math.max(0.72, 1
    + Math.sin(theta * 3 + mass.phaseA) * mass.harmonicA
    + Math.sin(theta * 5 + mass.phaseB) * mass.harmonicB);
  const radius = Math.hypot(localX / mass.radiusX, localY / mass.radiusY) / boundary;
  return (1 - Math.pow(radius, 1.62)) * mass.strength;
}

function evaluateCrustStroke(x: number, y: number, stroke: CrustStroke) {
  const dx = stroke.bx - stroke.ax;
  const dy = stroke.by - stroke.ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 1e-8 ? clamp(((x - stroke.ax) * dx + (y - stroke.ay) * dy) / lengthSquared) : 0;
  const closestX = stroke.ax + dx * projection;
  const closestY = stroke.ay + dy * projection;
  const radius = mix(stroke.radiusA, stroke.radiusB, projection);
  const length = Math.sqrt(Math.max(1e-8, lengthSquared));
  const lateral = ((x - closestX) * -dy + (y - closestY) * dx) / length;
  const phase = stroke.ax * 71.7 + stroke.ay * 113.9 + stroke.bx * 37.1 + stroke.by * 59.3;
  const shoulder = Math.sin(projection * TAU * 1.35 + phase) * 0.085
    + Math.sign(lateral || 1) * Math.sin(projection * Math.PI + phase * 0.37) * 0.055;
  const shapedRadius = Math.max(0.003, radius * (1 + shoulder));
  const normalizedDistance = Math.hypot(x - closestX, y - closestY) / shapedRadius;
  // A broad-topped terrane retains geographic width as sea level rises. Linear
  // capsule falloff collapses to medial lines, which produced the old skinny,
  // tacked-on silhouettes at low land fractions.
  return (1 - Math.pow(normalizedDistance, 1.48)) * stroke.strength;
}

function evaluateCrustComposition(composition: CrustComposition, x: number, y: number) {
  let terrane = -1.4;
  for (const mass of composition.masses) {
    const periodicX = x + Math.round((mass.x - x) / composition.period) * composition.period;
    terrane = Math.max(terrane, evaluateCrustMass(periodicX, y, mass));
  }
  for (const stroke of composition.terranes) {
    const centerX = (stroke.ax + stroke.bx) * 0.5;
    const periodicX = x + Math.round((centerX - x) / composition.period) * composition.period;
    terrane = Math.max(terrane, evaluateCrustStroke(periodicX, y, stroke));
  }
  let cut = 0;
  for (const stroke of composition.cuts) {
    const centerX = (stroke.ax + stroke.bx) * 0.5;
    const periodicX = x + Math.round((centerX - x) / composition.period) * composition.period;
    cut = Math.max(cut, Math.max(0, evaluateCrustStroke(periodicX, y, stroke)));
  }
  return terrane - cut * 1.12;
}

function propagateBoundaryField(
  mesh: GraphMesh,
  plateId: Int16Array,
  plates: Plate[],
  convergent: boolean,
) {
  const distance = new Float32Array(mesh.cellCount).fill(Number.POSITIVE_INFINITY);
  const strength = new Float32Array(mesh.cellCount);
  const heap = new MinHeap();
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      const neighbor = mesh.neighbors[cursor];
      if (cell >= neighbor || plateId[cell] === plateId[neighbor]) continue;
      const a = plates[plateId[cell]];
      const b = plates[plateId[neighbor]];
      const dx = periodicDelta(mesh.x[cell], mesh.x[neighbor], mesh.aspect);
      const dy = mesh.y[neighbor] - mesh.y[cell];
      const length = Math.hypot(dx, dy) || 1;
      const relative = (b.vx - a.vx) * (dx / length) + (b.vy - a.vy) * (dy / length);
      const matches = convergent ? relative < -0.11 : relative > 0.15;
      if (!matches) continue;
      const typeBoost = a.continental && b.continental ? 1.2 : a.continental || b.continental ? 0.86 : 0.56;
      const sourceStrength = clamp(Math.abs(relative) * 0.72 * typeBoost, 0.15, 1.4);
      for (const source of [cell, neighbor]) {
        if (sourceStrength > strength[source] || distance[source] > 0) {
          distance[source] = 0;
          strength[source] = sourceStrength;
          heap.push({ index: source, priority: 0, source });
        }
      }
    }
  }

  const maxDistance = convergent ? 0.105 : 0.065;
  while (heap.size) {
    const current = heap.pop()!;
    if (current.priority > distance[current.index] + 1e-7 || current.priority > maxDistance) continue;
    for (let cursor = mesh.neighborOffsets[current.index]; cursor < mesh.neighborOffsets[current.index + 1]; cursor += 1) {
      const neighbor = mesh.neighbors[cursor];
      const next = current.priority + graphDistance(mesh, current.index, neighbor);
      if (next < distance[neighbor] && next <= maxDistance) {
        distance[neighbor] = next;
        strength[neighbor] = strength[current.index];
        heap.push({ index: neighbor, priority: next, source: current.source });
      }
    }
  }
  return { distance, strength };
}

function smoothGraphField(mesh: GraphMesh, source: Float32Array, passes: number, centerWeight = 0.56) {
  let current = source.slice();
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.slice();
    for (let cell = 0; cell < mesh.cellCount; cell += 1) {
      if (mesh.boundary[cell]) continue;
      let sum = 0;
      let weight = 0;
      for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
        const neighbor = mesh.neighbors[cursor];
        const edgeWeight = 1 / Math.max(0.002, graphDistance(mesh, cell, neighbor));
        sum += current[neighbor] * edgeWeight;
        weight += edgeWeight;
      }
      next[cell] = current[cell] * centerWeight + (sum / Math.max(weight, 1e-6)) * (1 - centerWeight);
    }
    current = next;
  }
  return current;
}

function selectThreshold(values: Float32Array, targetFraction: number) {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const landCells = Math.round(clamp(targetFraction) * sorted.length);
  if (landCells <= 0) return sorted[sorted.length - 1];
  if (landCells >= sorted.length) return sorted[0] - 1e-6;
  return sorted[sorted.length - landCells] - 1e-6;
}

function graphCoastlineIndex(mesh: GraphMesh, mask: Uint8Array) {
  let land = 0;
  let edges = 0;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!mask[cell]) continue;
    land += 1;
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      if (!mask[mesh.neighbors[cursor]]) edges += 1;
    }
  }
  return land ? edges / Math.sqrt(land) : 0;
}

function thresholdGraphField(mesh: GraphMesh, field: Float32Array, landFraction: number) {
  const threshold = selectThreshold(field, landFraction);
  const result = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    result[cell] = !mesh.boundary[cell] && field[cell] > threshold ? 1 : 0;
  }
  return result;
}

function measureTerrain(
  mesh: GraphMesh,
  landMask: Uint8Array,
  desiredCoast: number,
  measureCoastHierarchy = true,
  planetControl = 0.6,
) {
  const visited = new Uint8Array(mesh.cellCount);
  const components: { size: number; elongation: number }[] = [];
  const longitudeBins = 36;
  const binLand = new Uint32Array(longitudeBins);
  const binTotal = new Uint32Array(longitudeBins);
  let coastEdges = 0;
  let landCells = 0;
  let minimumEdgeDistance = 0.5;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const bin = Math.min(longitudeBins - 1, Math.floor((mesh.x[cell] / mesh.aspect) * longitudeBins));
    binTotal[bin] += 1;
    if (!landMask[cell]) continue;
    binLand[bin] += 1;
    landCells += 1;
    const edgeDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    minimumEdgeDistance = Math.min(minimumEdgeDistance, edgeDistance);
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      if (!landMask[mesh.neighbors[cursor]]) coastEdges += 1;
    }
    if (visited[cell]) continue;
    let size = 0;
    const anchorX = mesh.x[cell];
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    const queue = [cell];
    visited[cell] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      size += 1;
      const x = anchorX + periodicDelta(anchorX, mesh.x[current], mesh.aspect);
      const y = mesh.y[current];
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      for (let cursor = mesh.neighborOffsets[current]; cursor < mesh.neighborOffsets[current + 1]; cursor += 1) {
        const neighbor = mesh.neighbors[cursor];
        if (landMask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    const meanX = sumX / size;
    const meanY = sumY / size;
    const covarianceX = Math.max(0, sumXX / size - meanX * meanX);
    const covarianceY = Math.max(0, sumYY / size - meanY * meanY);
    const covarianceXY = sumXY / size - meanX * meanY;
    const trace = covarianceX + covarianceY;
    const root = Math.sqrt(Math.max(0, (covarianceX - covarianceY) ** 2 + 4 * covarianceXY ** 2));
    const major = Math.max(0, (trace + root) * 0.5);
    const minor = Math.max(0, (trace - root) * 0.5);
    components.push({
      size,
      elongation: Math.sqrt((major + 0.00008) / (minor + 0.00008)),
    });
  }
  components.sort((a, b) => b.size - a.size);
  const meaningful = components.filter((component) => component.size >= Math.max(5, landCells * 0.006));
  const largestShare = landCells ? (components[0]?.size ?? 0) / landCells : 1;
  const secondShare = landCells ? (components[1]?.size ?? 0) / landCells : 0;
  const coastlineIndex = landCells ? coastEdges / Math.sqrt(landCells) : 0;
  const islandMinimum = Math.max(2, landCells * 0.00022);
  const islandMaximum = landCells * 0.006;
  const islandComponents = components.filter((component) => component.size >= islandMinimum && component.size < islandMaximum);
  const islandShare = islandComponents.reduce((sum, component) => sum + component.size, 0) / Math.max(1, landCells);
  const tinyCells = components
    .filter((component) => component.size < islandMinimum)
    .reduce((sum, component) => sum + component.size, 0);
  const weightedElongation = meaningful.reduce((sum, component) => sum + component.elongation * component.size, 0)
    / Math.max(1, meaningful.reduce((sum, component) => sum + component.size, 0));
  const excessivelyNarrow = meaningful.filter((component) => component.elongation > 3.35).length;
  let mediumCoast = desiredCoast * 0.8;
  let broadCoast = desiredCoast * 0.58;
  if (measureCoastHierarchy) {
    const mediumField = smoothGraphField(mesh, Float32Array.from(landMask), 2, 0.62);
    const broadField = smoothGraphField(mesh, mediumField, 5, 0.62);
    mediumCoast = graphCoastlineIndex(
      mesh,
      thresholdGraphField(mesh, mediumField, landCells / mesh.cellCount),
    );
    broadCoast = graphCoastlineIndex(
      mesh,
      thresholdGraphField(mesh, broadField, landCells / mesh.cellCount),
    );
  }
  let longestOceanRun = 0;
  let currentOceanRun = 0;
  for (let index = 0; index < longitudeBins * 2; index += 1) {
    const bin = index % longitudeBins;
    const density = binLand[bin] / Math.max(1, binTotal[bin]);
    currentOceanRun = density < 0.115 ? Math.min(longitudeBins, currentOceanRun + 1) : 0;
    longestOceanRun = Math.max(longestOceanRun, currentOceanRun);
  }
  const oceanGap = longestOceanRun / longitudeBins;
  const clearancePenalty = Math.max(0, 0.06 - minimumEdgeDistance) * 115;
  const desiredComponents = Math.round(mix(4, 8, planetControl));
  const componentPenalty = meaningful.length < desiredComponents
    ? (desiredComponents - meaningful.length) * 6.6
    : Math.max(0, meaningful.length - (desiredComponents + 3)) * 2.6;
  const largestTarget = mix(0.5, 0.3, planetControl);
  const hierarchyPenalty = Math.max(0, 0.28 - largestShare) * 48
    + Math.max(0, largestShare - largestTarget) * 104
    + Math.max(0, 0.1 - secondShare) * 26
    + Math.max(0, 0.075 - (largestShare - secondShare)) * 34;
  const oceanCompositionPenalty = Math.max(0, 0.105 - oceanGap) * 82
    + Math.max(0, oceanGap - 0.36) * 34;
  const shapePenalty = Math.max(0, weightedElongation - 2.25) * 9
    + Math.max(0, excessivelyNarrow - 1) * 7;
  const islandPenalty = Math.max(0, 0.014 - islandShare) * 92
    + Math.max(0, islandShare - 0.06) * 34
    + Math.max(0, 4 - islandComponents.length) * 0.42;
  const coastHierarchyPenalty = Math.max(0, desiredCoast * 0.8 - mediumCoast) * 0.72
    + Math.max(0, desiredCoast * 0.58 - broadCoast) * 0.48
    + Math.max(0, coastlineIndex - mediumCoast * 1.72) * 0.34;
  const score = 38
    - componentPenalty
    - coastHierarchyPenalty
    - oceanCompositionPenalty
    - shapePenalty
    - islandPenalty
    - hierarchyPenalty
    - Math.abs(coastlineIndex - desiredCoast) * 0.52
    - (tinyCells / Math.max(1, landCells)) * 27
    - clearancePenalty;
  return {
    score,
    coastlineIndex,
    meaningfulComponents: meaningful.length,
    frameClearance: minimumEdgeDistance,
    largestLandmassShare: largestShare,
    oceanGapShare: oceanGap,
    meanLandmassElongation: weightedElongation,
  };
}

function buildTerrainCandidate(mesh: GraphMesh, seed: number, attempt: number, settings: WorldSettings): TerrainCandidate {
  const random = makeRandom(seed ^ Math.imul(attempt + 1, 0x9e3779b1));
  const planet = planetScaleMetrics(settings);
  const plateCount = Math.round(clamp((19 + random() * 7) * planet.plateMultiplier, 16, 46));
  const sites = choosePlateSites(mesh, random, plateCount);
  const plates: Plate[] = sites.map((siteCell, id) => {
    const angle = random() * TAU;
    return {
      id,
      siteCell,
      x: mesh.x[siteCell],
      y: mesh.y[siteCell],
      weight: 0.86 + random() * 0.28,
      vx: Math.cos(angle) * (0.35 + random() * 0.65),
      vy: Math.sin(angle) * (0.35 + random() * 0.65),
      continental: false,
      crustBias: 0,
    };
  });
  const plateId = assignPlateOwnership(mesh, plates);
  const adjacency = buildPlateAdjacency(mesh, plateId, plateCount);
  const targetLand = targetLandFraction(settings);
  const continentalShare = mix(0.3, 0.5, settings.continentSize / 100);
  const continentAssignment = assignContinentalClusters(
    plates,
    adjacency,
    random,
    continentalShare,
    mesh.aspect,
    planet,
  );
  const crustComposition = buildCrustComposition(plates, continentAssignment, mesh.aspect, random, planet);
  for (const plate of plates) {
    plate.crustBias = plate.continental ? 0.12 + random() * 0.1 : -0.08 - random() * 0.08;
  }
  const convergence = propagateBoundaryField(mesh, plateId, plates, true);
  const divergence = propagateBoundaryField(mesh, plateId, plates, false);
  const tectonicAmount = mix(0.25, 0.9, settings.tectonics / 100);

  const base = new Float32Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const plate = plates[plateId[cell]];
    const distance = Math.hypot(periodicDelta(plate.x, mesh.x[cell], mesh.aspect), mesh.y[cell] - plate.y);
    const interior = clamp(1 - distance / 0.34);
    const nx = mesh.x[cell] / mesh.aspect;
    const ny = mesh.y[cell];
    const structuredCrust = evaluateCrustComposition(crustComposition, mesh.x[cell], ny);
    const macro = periodicGradientFbm(nx + attempt * 0.137, ny - attempt * 0.091, 2.45, seed + 101, 4);
    const regional = periodicGradientFbm(nx - 0.23, ny + 0.19, 7.8, seed + 149, 4);
    const coastAmplitude = mix(0.07, 0.17, settings.coastDetail / 100);
    const oceanProfile = oceanBasinProfile(continentAssignment.oceanBasin, ny, mesh.aspect);
    const oceanDistance = Math.abs(periodicDelta(oceanProfile.center, mesh.x[cell], mesh.aspect));
    const oceanHalfWidth = oceanProfile.halfWidth;
    const oceanBasin = 1 - smoothstep((oceanDistance - oceanHalfWidth * 0.5) / Math.max(0.01, oceanHalfWidth * 0.78));
    const polarDistance = Math.min(ny, 1 - ny);
    const polarBand = 0.16;
    const edgePenalty = polarDistance < polarBand
      ? Math.pow((polarBand - polarDistance) / polarBand, 1.55) * 3.1
      : 0;
    let basePotential = clamp(structuredCrust, -1.4, 1.1) * mix(0.82, 0.94, planet.control)
      + plate.crustBias
      + (plate.continental ? interior * 0.05 : -interior * 0.035)
      + macro * mix(0.31, 0.19, planet.control)
      + regional * coastAmplitude * mix(1, 0.78, planet.control)
      - oceanBasin * mix(0.68, 1.12, planet.control)
      - edgePenalty;
    if (!plate.continental && polarDistance > 0.12 && Number.isFinite(convergence.distance[cell])) {
      const arcInfluence = Math.exp(-convergence.distance[cell] / 0.014) * convergence.strength[cell];
      const arcBeads = smoothstep((periodicGradientFbm(nx + 0.07, ny - 0.22, 34, seed + 181, 3) + 0.18) / 0.92);
      const arcPotential = -0.31 + arcInfluence * tectonicAmount * mix(0.09, 0.72, arcBeads);
      basePotential = Math.max(basePotential, arcPotential);
    }
    base[cell] = mesh.boundary[cell] ? -3.5 : basePotential;
  }
  const potential = smoothGraphField(mesh, base, 1, 0.84);
  const eligiblePotential: number[] = [];
  const reservedOceanBasin: OceanBasinPlan = {
    ...continentAssignment.oceanBasin,
    width: continentAssignment.oceanBasin.width * mix(0.46, 0.62, planet.control),
  };
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const polarDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    const oceanProfile = oceanBasinProfile(reservedOceanBasin, mesh.y[cell], mesh.aspect);
    const oceanDistance = Math.abs(periodicDelta(oceanProfile.center, mesh.x[cell], mesh.aspect));
    if (polarDistance > FRAME_OCEAN_MARGIN && !mesh.boundary[cell] && oceanDistance > oceanProfile.halfWidth) {
      eligiblePotential.push(potential[cell]);
    }
  }
  const targetEligibleFraction = clamp((targetLand * mesh.cellCount) / Math.max(1, eligiblePotential.length), 0, 0.92);
  const seaLevel = selectThreshold(Float32Array.from(eligiblePotential), targetEligibleFraction);
  const landMask = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const polarDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    const oceanProfile = oceanBasinProfile(reservedOceanBasin, mesh.y[cell], mesh.aspect);
    const oceanDistance = Math.abs(periodicDelta(oceanProfile.center, mesh.x[cell], mesh.aspect));
    landMask[cell] = potential[cell] > seaLevel
      && oceanDistance > oceanProfile.halfWidth
      && polarDistance > FRAME_OCEAN_MARGIN
      && !mesh.boundary[cell] ? 1 : 0;
  }

  const ridge = new Float32Array(mesh.cellCount);
  const elevation = new Float32Array(mesh.cellCount);
  let minPotential = Number.POSITIVE_INFINITY;
  let maxPotential = Number.NEGATIVE_INFINITY;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    minPotential = Math.min(minPotential, potential[cell]);
    maxPotential = Math.max(maxPotential, potential[cell]);
  }
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const nx = mesh.x[cell] / mesh.aspect;
    const ny = mesh.y[cell];
    const convergentInfluence = Number.isFinite(convergence.distance[cell])
      ? Math.exp(-convergence.distance[cell] / 0.034) * convergence.strength[cell]
      : 0;
    const divergentInfluence = Number.isFinite(divergence.distance[cell])
      ? Math.exp(-divergence.distance[cell] / 0.025) * divergence.strength[cell]
      : 0;
    ridge[cell] = convergentInfluence * mix(0.48, 1, periodicRidgedNoise(nx, ny, 21, seed + 241));
    if (landMask[cell]) {
      const relative = clamp((potential[cell] - seaLevel) / Math.max(0.001, maxPotential - seaLevel));
      const hills = periodicGradientFbm(nx + 0.17, ny - 0.13, 12, seed + 269, 5) * 0.052;
      const fractured = Math.max(0, periodicRidgedNoise(nx, ny, 27, seed + 293) - 0.67) * 0.042;
      elevation[cell] = 0.008 + Math.pow(relative, 0.68) * 0.38 + hills + fractured
        + ridge[cell] * tectonicAmount * 0.72
        - divergentInfluence * tectonicAmount * 0.12;
      elevation[cell] = Math.max(0.003, elevation[cell]);
    } else {
      const relative = clamp((seaLevel - potential[cell]) / Math.max(0.001, seaLevel - minPotential));
      elevation[cell] = -0.012 - Math.pow(relative, 0.72) * 0.64 - divergentInfluence * tectonicAmount * 0.08;
    }
  }

  const measured = measureTerrain(
    mesh,
    landMask,
    mix(12.2, 18.4, settings.coastDetail / 100),
    true,
    planet.control,
  );
  // Also judge the same continuous crust at a lower exposed-land fraction.
  // Attractive continents should remain broad geographic bodies when sea level
  // rises instead of collapsing into a set of long capsule centerlines.
  const sparseThreshold = selectThreshold(
    Float32Array.from(eligiblePotential),
    clamp((Math.max(0.17, targetLand - 0.075) * mesh.cellCount) / Math.max(1, eligiblePotential.length), 0, 0.9),
  );
  const sparseLandMask = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const polarDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    const oceanProfile = oceanBasinProfile(reservedOceanBasin, mesh.y[cell], mesh.aspect);
    const oceanDistance = Math.abs(periodicDelta(oceanProfile.center, mesh.x[cell], mesh.aspect));
    sparseLandMask[cell] = potential[cell] > sparseThreshold
      && oceanDistance > oceanProfile.halfWidth
      && polarDistance > FRAME_OCEAN_MARGIN
      && !mesh.boundary[cell] ? 1 : 0;
  }
  const sparseMeasured = measureTerrain(
    mesh,
    sparseLandMask,
    mix(11.4, 16.8, settings.coastDetail / 100),
    false,
    planet.control,
  );
  const lowLandStabilityPenalty = Math.max(0, sparseMeasured.meanLandmassElongation - 2.55) * 7.2
    + Math.max(0, sparseMeasured.largestLandmassShare - 0.68) * 34
    + Math.max(0, Math.round(mix(4, 7, planet.control)) - sparseMeasured.meaningfulComponents) * 2.5;
  return {
    plates,
    plateId,
    potential,
    elevation,
    landMask,
    ridge,
    seaLevel,
    score: measured.score - lowLandStabilityPenalty,
    coastlineIndex: measured.coastlineIndex,
    frameClearance: measured.frameClearance,
    continentComponents: measured.meaningfulComponents,
    largestLandmassShare: measured.largestLandmassShare,
    oceanGapShare: measured.oceanGapShare,
    meanLandmassElongation: measured.meanLandmassElongation,
    oceanBasin: reservedOceanBasin,
  };
}

function thermalErodeGraph(mesh: GraphMesh, elevation: Float32Array, landMask: Uint8Array, passes: number) {
  const delta = new Float32Array(mesh.cellCount);
  for (let pass = 0; pass < passes; pass += 1) {
    delta.fill(0);
    for (let cell = 0; cell < mesh.cellCount; cell += 1) {
      if (!landMask[cell]) continue;
      let lowest = -1;
      let lowestHeight = elevation[cell];
      for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
        const neighbor = mesh.neighbors[cursor];
        if (landMask[neighbor] && elevation[neighbor] < lowestHeight) {
          lowest = neighbor;
          lowestHeight = elevation[neighbor];
        }
      }
      const difference = elevation[cell] - lowestHeight;
      if (lowest >= 0 && difference > 0.075) {
        const transfer = (difference - 0.075) * 0.16;
        delta[cell] -= transfer;
        delta[lowest] += transfer;
      }
    }
    for (let cell = 0; cell < mesh.cellCount; cell += 1) {
      if (landMask[cell]) elevation[cell] = Math.max(0.003, elevation[cell] + delta[cell]);
    }
  }
}

function createGraphTerrain(mesh: GraphMesh, seed: number, settings: WorldSettings) {
  const candidates = [buildTerrainCandidate(mesh, seed, 0, settings)];
  for (let attempt = 1; attempt < 6; attempt += 1) {
    candidates.push(buildTerrainCandidate(mesh, seed, attempt, settings));
  }

  // Graph metrics can distinguish connectedness and gross elongation, but they
  // cannot see whether complexity survives raster generalization. Render the
  // Every candidate reaches a small, fixed cartographic grid before selection.
  // Graph metrics are useful for rejecting obvious failures, but raster-space
  // covariance is substantially better at spotting a world where otherwise
  // attractive continents all share the same north-south silhouette.
  // the same scale profile used for the final map. This is resolution-stable
  // and prevents fine noise from gaming a single perimeter score.
  const finalists = candidates.sort((a, b) => b.score - a.score);
  if (settings.width < 512 || settings.height < 256) {
    const best = finalists[0];
    thermalErodeGraph(mesh, best.elevation, best.landMask, 2);
    return best;
  }
  const coarseSettings = { ...settings, width: 512, height: 256 };
  const planet = planetScaleMetrics(settings);
  const desiredHierarchy = mix(11.2, 15.6, settings.coastDetail / 100);
  const desiredMajorLands = mix(3.2, 7.5, planet.control);
  const desiredEffectiveLands = mix(3, 7, planet.control);
  const largestLandmassTarget = mix(0.5, 0.27, planet.control);
  const desiredIslandArea = mix(1.8, 3.4, planet.control);
  const desiredLatitudeDiversity = mix(0.46, 0.62, planet.control);
  const desiredSpacingIrregularity = mix(0.32, 0.48, planet.control);
  let best = finalists[0];
  let bestVisualScore = Number.NEGATIVE_INFINITY;
  for (const candidate of finalists) {
    const morphology = buildRasterTerrain(mesh, candidate, coarseSettings, seed);
    const visualScore = candidate.score
      - Math.max(0, desiredHierarchy - morphology.coastHierarchyIndex) * 1.05
      - Math.max(0, morphology.coastHierarchyIndex - 20.5) * 0.48
      - Math.max(0, desiredIslandArea - morphology.islandAreaPercent) * 1.15
      - Math.max(0, morphology.islandAreaPercent - 5.8) * 0.42
      - Math.max(0, 0.42 - morphology.islandSizeDiversity) * 2.2
      - Math.max(0, morphology.largestLandmassShare - largestLandmassTarget) * 180
      - Math.max(0, desiredMajorLands - morphology.majorLandmassCount) * 12
      - Math.max(0, morphology.majorLandmassCount - desiredMajorLands - 2) * 2.1
      - Math.max(0, desiredEffectiveLands - morphology.effectiveLandmassCount) * 18
      - Math.max(0, desiredLatitudeDiversity - morphology.landmassLatitudeDiversity) * 13.5
      - Math.max(0, desiredSpacingIrregularity - morphology.landmassSpacingIrregularity) * 14.5
      - Math.max(0, morphology.meanMajorLandmassElongation - 1.85) * 25
      - Math.max(0, morphology.neckFragmentation - 0.18) * 60
      - Math.max(0, morphology.neckFragmentation - 0.55) * 90
      - Math.max(0, 0.82 - morphology.landCoreCoverage) * 18
      - Math.max(0, desiredMajorLands + 1 - morphology.meaningfulLandmassCount) * 2.8;
    if (visualScore > bestVisualScore) {
      bestVisualScore = visualScore;
      best = candidate;
    }
  }
  thermalErodeGraph(mesh, best.elevation, best.landMask, 2);
  return best;
}

function routeGraphRivers(mesh: GraphMesh, terrain: TerrainCandidate, settings: WorldSettings, seed: number) {
  const filled = terrain.elevation.slice();
  const receiver = new Int32Array(mesh.cellCount).fill(-1);
  const visited = new Uint8Array(mesh.cellCount);
  const accumulation = new Float32Array(mesh.cellCount);
  const heap = new MinHeap();
  let landCells = 0;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const nx = mesh.x[cell] / mesh.aspect;
    const ny = mesh.y[cell];
    accumulation[cell] = terrain.landMask[cell]
      ? 0.42 + clamp(periodicGradientFbm(nx + 0.31, ny - 0.27, 5.3, seed + 347, 4) * 0.5 + 0.5 + (settings.moisture - 50) / 90) * 1.35
      : 0;
    if (terrain.landMask[cell]) landCells += 1;
    if (!terrain.landMask[cell] || mesh.boundary[cell]) {
      visited[cell] = 1;
      heap.push({ index: cell, priority: terrain.elevation[cell] });
    }
  }
  while (heap.size) {
    const current = heap.pop()!;
    for (let cursor = mesh.neighborOffsets[current.index]; cursor < mesh.neighborOffsets[current.index + 1]; cursor += 1) {
      const neighbor = mesh.neighbors[cursor];
      if (visited[neighbor]) continue;
      visited[neighbor] = 1;
      receiver[neighbor] = current.index;
      filled[neighbor] = Math.max(terrain.elevation[neighbor], current.priority + 1e-6);
      heap.push({ index: neighbor, priority: filled[neighbor] });
    }
  }
  const order = Array.from({ length: mesh.cellCount }, (_, index) => index)
    .filter((cell) => terrain.landMask[cell])
    .sort((a, b) => filled[b] - filled[a] || b - a);
  for (const cell of order) {
    const target = receiver[cell];
    if (target >= 0) accumulation[target] += accumulation[cell];
  }
  const threshold = landCells * mix(0.0056, 0.0028, settings.moisture / 100);
  const river = new Uint8Array(mesh.cellCount);
  for (const cell of order) {
    if (accumulation[cell] >= threshold && terrain.elevation[cell] > 0.012) river[cell] = 1;
  }
  let riverCount = 0;
  const drawableSources = new Uint8Array(mesh.cellCount);
  for (const cell of order) {
    if (!river[cell]) continue;
    let hasRiverInflow = false;
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      const neighbor = mesh.neighbors[cursor];
      if (receiver[neighbor] === cell && river[neighbor]) {
        hasRiverInflow = true;
        break;
      }
    }
    if (!hasRiverInflow) {
      let pathLength = 0;
      let steps = 0;
      let current = cell;
      while (current >= 0 && steps < mesh.cellCount) {
        const target = receiver[current];
        if (target < 0) break;
        pathLength += graphDistance(mesh, current, target);
        steps += 1;
        current = target;
        if (!terrain.landMask[current]) break;
      }
      if (steps >= 4 && pathLength >= 0.045) {
        drawableSources[cell] = 1;
        riverCount += 1;
      }
    }
    terrain.elevation[cell] = Math.max(0.003, terrain.elevation[cell] - clamp(Math.log2(accumulation[cell] / threshold + 1) * 0.012, 0.004, 0.035));
  }
  return { receiver, accumulation, river, drawableSources, threshold, riverCount };
}

function rasterizeTriangles(mesh: GraphMesh, values: Float32Array, width: number, height: number) {
  const output = new Float32Array(width * height);
  output.fill(Number.NaN);
  for (let triangle = 0; triangle < mesh.triangles.length; triangle += 3) {
    const ia = mesh.triangles[triangle];
    const ib = mesh.triangles[triangle + 1];
    const ic = mesh.triangles[triangle + 2];
    const ax = (mesh.x[ia] / mesh.aspect) * (width - 1);
    const ay = mesh.y[ia] * (height - 1);
    const bx = (mesh.x[ib] / mesh.aspect) * (width - 1);
    const by = mesh.y[ib] * (height - 1);
    const cx = (mesh.x[ic] / mesh.aspect) * (width - 1);
    const cy = mesh.y[ic] * (height - 1);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-9) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
        const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -1e-5 || wb < -1e-5 || wc < -1e-5) continue;
        output[y * width + x] = values[ia] * wa + values[ib] * wb + values[ic] * wc;
      }
    }
  }
  for (let index = 0; index < output.length; index += 1) if (!Number.isFinite(output[index])) output[index] = -0.7;
  return output;
}

function sampleField(field: Float32Array, width: number, height: number, x: number, y: number, wrapX = false) {
  const px = wrapX ? wrap(x, width) : clamp(x, 0, width - 1);
  const py = clamp(y, 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = wrapX ? (x0 + 1) % width : Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = px - x0;
  const fy = py - y0;
  return mix(
    mix(field[y0 * width + x0], field[y0 * width + x1], fx),
    mix(field[y1 * width + x0], field[y1 * width + x1], fx),
    fy,
  );
}

function blurField(source: Float32Array, width: number, height: number, passes = 1) {
  let current = source.slice();
  let temporary = new Float32Array(source.length);
  const weights = [1, 4, 6, 4, 1];
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let offset = -2; offset <= 2; offset += 1) {
          sum += current[row + wrap(x + offset, width)] * weights[offset + 2];
        }
        temporary[row + x] = sum / 16;
      }
    }
    const swap = current;
    current = temporary;
    temporary = swap;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let offset = -2; offset <= 2; offset += 1) {
          sum += current[clamp(y + offset, 0, height - 1) * width + x] * weights[offset + 2];
        }
        temporary[y * width + x] = sum / 16;
      }
    }
    const verticalSwap = current;
    current = temporary;
    temporary = verticalSwap;
  }
  return current;
}

function boxBlurField(source: Float32Array, width: number, height: number, radius: number, passes = 1) {
  let current = source.slice();
  let temporary = new Float32Array(source.length);
  const diameter = radius * 2 + 1;
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) sum += current[row + wrap(offset, width)];
      for (let x = 0; x < width; x += 1) {
        temporary[row + x] = sum / diameter;
        sum += current[row + wrap(x + radius + 1, width)] - current[row + wrap(x - radius, width)];
      }
    }
    [current, temporary] = [temporary, current];
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let offset = -radius; offset <= radius; offset += 1) sum += current[clamp(offset, 0, height - 1) * width + x];
      for (let y = 0; y < height; y += 1) {
        temporary[y * width + x] = sum / diameter;
        sum += current[clamp(y + radius + 1, 0, height - 1) * width + x]
          - current[clamp(y - radius, 0, height - 1) * width + x];
      }
    }
    [current, temporary] = [temporary, current];
  }
  return current;
}

// Exact squared-Euclidean transform by Felzenszwalb & Huttenlocher. Running
// the separable 1D transform vertically, then over three copies of each row,
// keeps longitude periodic without allocating a three-times-larger world.
function distanceTransform1d(source: Float64Array, length: number, output: Float64Array) {
  const locations = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  let envelope = 0;
  locations[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;
  for (let q = 1; q < length; q += 1) {
    let intersection = ((source[q] + q * q) - (source[locations[envelope]] + locations[envelope] * locations[envelope]))
      / (2 * q - 2 * locations[envelope]);
    while (intersection <= boundaries[envelope]) {
      envelope -= 1;
      intersection = ((source[q] + q * q) - (source[locations[envelope]] + locations[envelope] * locations[envelope]))
        / (2 * q - 2 * locations[envelope]);
    }
    envelope += 1;
    locations[envelope] = q;
    boundaries[envelope] = intersection;
    boundaries[envelope + 1] = Number.POSITIVE_INFINITY;
  }
  envelope = 0;
  for (let q = 0; q < length; q += 1) {
    while (boundaries[envelope + 1] < q) envelope += 1;
    const delta = q - locations[envelope];
    output[q] = delta * delta + source[locations[envelope]];
  }
}

function euclideanDistanceTo(mask: Uint8Array, width: number, height: number, target: number, wrapX: boolean) {
  const infinity = 1e15;
  const vertical = new Float64Array(mask.length);
  const sourceColumn = new Float64Array(height);
  const outputColumn = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) sourceColumn[y] = mask[y * width + x] === target ? 0 : infinity;
    distanceTransform1d(sourceColumn, height, outputColumn);
    for (let y = 0; y < height; y += 1) vertical[y * width + x] = outputColumn[y];
  }

  const rowLength = wrapX ? width * 3 : width;
  const sourceRow = new Float64Array(rowLength);
  const outputRow = new Float64Array(rowLength);
  const distance = new Float32Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < rowLength; x += 1) sourceRow[x] = vertical[y * width + (x % width)];
    distanceTransform1d(sourceRow, rowLength, outputRow);
    const offset = wrapX ? width : 0;
    for (let x = 0; x < width; x += 1) distance[y * width + x] = Math.sqrt(outputRow[offset + x]);
  }
  return distance;
}

function signedEuclideanDistance(mask: Uint8Array, width: number, height: number, wrapX = false) {
  const distance = new Float32Array(mask.length);
  const toOcean = euclideanDistanceTo(mask, width, height, 0, wrapX);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) distance[index] = Math.max(0.5, toOcean[index] - 0.5);
  }
  const toLand = euclideanDistanceTo(mask, width, height, 1, wrapX);
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) distance[index] = -Math.max(0.5, toLand[index] - 0.5);
  }
  return distance;
}

function selectRasterThreshold(
  values: Float32Array,
  width: number,
  height: number,
  targetFraction: number,
  marginX: number,
  marginY: number,
  excluded?: Uint8Array,
) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let eligible = 0;
  for (let y = marginY; y < height - marginY; y += 1) {
    for (let x = marginX; x < width - marginX; x += 1) {
      const index = y * width + x;
      if (excluded?.[index]) continue;
      const value = values[index];
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
      eligible += 1;
    }
  }
  const binCount = 4096;
  const histogram = new Uint32Array(binCount);
  const scale = (binCount - 1) / Math.max(1e-6, maximum - minimum);
  for (let y = marginY; y < height - marginY; y += 1) {
    for (let x = marginX; x < width - marginX; x += 1) {
      const index = y * width + x;
      if (excluded?.[index]) continue;
      const bin = clamp(Math.floor((values[index] - minimum) * scale), 0, binCount - 1);
      histogram[bin] += 1;
    }
  }
  const desired = Math.min(eligible, Math.round(targetFraction * width * height));
  let cumulative = 0;
  for (let bin = binCount - 1; bin >= 0; bin -= 1) {
    cumulative += histogram[bin];
    if (cumulative >= desired) return minimum + bin / scale;
  }
  return minimum;
}

function buildCoastFeatures(mesh: GraphMesh, terrain: TerrainCandidate, settings: WorldSettings, seed: number) {
  type CoastCandidate = { x: number; y: number; dx: number; dy: number };
  const candidates: CoastCandidate[] = [];
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!terrain.landMask[cell]) continue;
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      const ocean = mesh.neighbors[cursor];
      if (terrain.landMask[ocean]) continue;
      const landX = mesh.x[cell];
      const oceanX = mesh.x[ocean];
      const landY = mesh.y[cell];
      const oceanY = mesh.y[ocean];
      if (Math.min(landY, 1 - landY) < 0.075) continue;
      const vx = periodicDelta(landX, oceanX, mesh.aspect);
      const vy = oceanY - landY;
      const length = Math.hypot(vx, vy);
      if (length < 1e-5) continue;
      candidates.push({
        x: wrap(landX + vx * 0.5, mesh.aspect),
        y: (landY + oceanY) * 0.5,
        dx: vx / length,
        dy: vy / length,
      });
    }
  }
  const random = makeRandom(seed ^ 0x42c0a57);
  const selected: CoastFeature[] = [];
  const anchors: CoastCandidate[] = [];
  const planet = planetScaleMetrics(settings);
  const geographyScale = planet.featureScale;
  const makeFeature = (points: CoastPoint[], strength: number): CoastFeature => {
    const padding = Math.max(...points.map((point) => point.width));
    return {
      points,
      strength,
      minX: Math.min(...points.map((point) => point.x)) - padding,
      maxX: Math.max(...points.map((point) => point.x)) + padding,
      minY: Math.min(...points.map((point) => point.y)) - padding,
      maxY: Math.max(...points.map((point) => point.y)) + padding,
    };
  };
  const coastControl = settings.coastDetail / 100;
  const distanceBetween = (a: CoastCandidate, b: CoastCandidate) => Math.hypot(
    periodicDelta(a.x, b.x, mesh.aspect),
    a.y - b.y,
  );
  const createSystem = (candidate: CoastCandidate, band: "regional" | "meso") => {
    const regional = band === "regional";
    const peninsula = random() < (regional ? 0.38 : 0.44);
    const slender = !peninsula && regional && random() < 0.06;
    const sign = peninsula ? 1 : -1;
    const featureLength = (regional
      ? peninsula ? mix(0.034, 0.074, random()) : mix(0.035, 0.078, random())
      : peninsula ? mix(0.008, 0.029, random()) : mix(0.008, 0.028, random()))
      * mix(0.82, 1.14, coastControl) * geographyScale;
    const rootWidth = featureLength * (regional
      ? peninsula ? mix(0.32, 0.48, random()) : slender ? mix(0.28, 0.36, random()) : mix(0.36, 0.52, random())
      : peninsula ? mix(0.28, 0.43, random()) : mix(0.32, 0.48, random()));
    const tipWidth = rootWidth * (peninsula
      ? mix(0.68, 0.92, random())
      : slender ? mix(0.58, 0.74, random()) : mix(0.68, 0.9, random()));
    const segmentCount = regional ? 5 + Math.floor(random() * 3) : 3 + Math.floor(random() * 3);
    const points: CoastPoint[] = [];
    let heading = Math.atan2(candidate.dy * sign, candidate.dx * sign);
    const curl = (random() < 0.5 ? -1 : 1) * (regional ? mix(0.24, 0.92, random()) : mix(0.18, 0.72, random()));
    const mouthOffset = peninsula ? -rootWidth * 0.28 : rootWidth * 0.38;
    let px = candidate.x + candidate.dx * mouthOffset;
    let py = candidate.y + candidate.dy * mouthOffset;
    points.push({ x: px, y: py, width: rootWidth });
    for (let segment = 1; segment <= segmentCount; segment += 1) {
      const progress = segment / segmentCount;
      heading += curl / segmentCount + (random() - 0.5) * mix(0.34, 0.12, progress);
      const step = featureLength / segmentCount * mix(0.78, 1.24, random());
      px += Math.cos(heading) * step;
      py = clamp(py + Math.sin(heading) * step, 0.055, 0.945);
      const width = mix(rootWidth, tipWidth, Math.pow(progress, 0.82)) * mix(0.82, 1.14, random());
      points.push({ x: px, y: py, width });
    }
    selected.push(makeFeature(points, sign * (regional
      ? peninsula ? mix(0.7, 1.02, random()) : mix(0.62, 0.88, random())
      : mix(0.34, 0.68, random()))));
    anchors.push(candidate);

    // Regional systems carry smaller subordinate landforms. The nesting is the
    // important part: a large gulf can contain coves and drowned valleys, while
    // a major cape can fork into two asymmetric headlands.
    const branchCount = regional
      ? peninsula ? (random() < 0.26 ? 1 : 0) : (random() < 0.55 ? 1 : 0)
      : 0;
    for (let branch = 0; branch < branchCount; branch += 1) {
      const rootIndex = Math.min(points.length - 2, 1 + Math.floor(mix(0.25, 0.68, random()) * (points.length - 1)));
      const root = points[rootIndex];
      const previous = points[Math.max(0, rootIndex - 1)];
      const parentHeading = Math.atan2(root.y - previous.y, root.x - previous.x);
      let branchHeading = parentHeading + (random() < 0.5 ? -1 : 1) * mix(0.52, 1.12, random());
      const branchLength = featureLength * mix(0.26, regional ? 0.56 : 0.42, random());
      const branchSegments = 2 + Math.floor(random() * (regional ? 3 : 2));
      const branchPoints: CoastPoint[] = [{ ...root, width: root.width * mix(0.65, 0.84, random()) }];
      let bx = root.x;
      let by = root.y;
      for (let segment = 1; segment <= branchSegments; segment += 1) {
        const progress = segment / branchSegments;
        branchHeading += (random() - 0.5) * 0.34;
        const step = branchLength / branchSegments * mix(0.82, 1.18, random());
        bx += Math.cos(branchHeading) * step;
        by = clamp(by + Math.sin(branchHeading) * step, 0.055, 0.945);
        branchPoints.push({
          x: bx,
          y: by,
          width: mix(branchPoints[0].width, tipWidth * 1.05, Math.pow(progress, 0.78)),
        });
      }
      selected.push(makeFeature(branchPoints, sign * (regional ? mix(0.3, 0.52, random()) : mix(0.2, 0.36, random()))));
    }
    return points;
  };

  // First establish a sparse set of features that remain legible at world-map
  // scale. Then grow several smaller neighbors around each one. This produces
  // geographic provinces instead of distributing equally-sized notches around
  // every coast.
  const coastSystemMultiplier = clamp(Math.pow(planet.earthRatio, 1.28), 0.72, 1.72);
  const regionalTarget = Math.round(mix(8, 13, coastControl) * coastSystemMultiplier);
  const regionalAnchors: CoastCandidate[] = [];
  let attempts = 0;
  while (regionalAnchors.length < regionalTarget && attempts < regionalTarget * 40 && candidates.length) {
    attempts += 1;
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (regionalAnchors.some((anchor) => distanceBetween(anchor, candidate) < 0.052 * geographyScale)) continue;
    createSystem(candidate, "regional");
    regionalAnchors.push(candidate);
  }

  const mesoTarget = Math.round(mix(42, 80, coastControl) * coastSystemMultiplier);
  let mesoSystems = 0;
  for (const regionalAnchor of regionalAnchors) {
    const localTarget = 3 + Math.floor(random() * 4);
    for (let local = 0; local < localTarget && mesoSystems < mesoTarget; local += 1) {
      const nearby = candidates.filter((candidate) => {
        const distance = distanceBetween(regionalAnchor, candidate);
        return distance > 0.018 * geographyScale && distance < mix(0.065, 0.125, coastControl) * geographyScale
          && !anchors.some((anchor) => distanceBetween(anchor, candidate) < 0.011 * geographyScale);
      });
      if (!nearby.length) break;
      createSystem(nearby[Math.floor(random() * nearby.length)], "meso");
      mesoSystems += 1;
    }
  }
  attempts = 0;
  while (mesoSystems < mesoTarget && attempts < mesoTarget * 36 && candidates.length) {
    attempts += 1;
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (anchors.some((anchor) => distanceBetween(anchor, candidate) < 0.011 * geographyScale)) continue;
    createSystem(candidate, "meso");
    mesoSystems += 1;
  }
  return selected;
}

function coastFeatureValue(features: CoastFeature[], x: number, y: number, amplitude: number, period: number) {
  let positive = 0;
  let negative = 0;
  for (const feature of features) {
    const centerX = (feature.minX + feature.maxX) * 0.5;
    const queryX = x + Math.round((centerX - x) / period) * period;
    if (queryX < feature.minX || queryX > feature.maxX || y < feature.minY || y > feature.maxY) continue;
    let featureValue = 0;
    for (let pointIndex = 0; pointIndex < feature.points.length; pointIndex += 1) {
      const point = feature.points[pointIndex];
      const previous = feature.points[Math.max(0, pointIndex - 1)];
      const next = feature.points[Math.min(feature.points.length - 1, pointIndex + 1)];
      const tangent = Math.atan2(next.y - previous.y, next.x - previous.x);
      const cosAngle = Math.cos(tangent);
      const sinAngle = Math.sin(tangent);
      const dx = queryX - point.x;
      const dy = y - point.y;
      const along = dx * cosAngle + dy * sinAngle;
      const across = -dx * sinAngle + dy * cosAngle;
      const distance = Math.hypot(along / Math.max(0.0025, point.width * 1.16), across / Math.max(0.0025, point.width * 0.86));
      featureValue = Math.max(featureValue, Math.pow(smoothstep(1 - distance), 1.12));
    }
    for (let segment = 0; segment + 1 < feature.points.length; segment += 1) {
      const a = feature.points[segment];
      const b = feature.points[segment + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 1e-8
        ? clamp(((queryX - a.x) * dx + (y - a.y) * dy) / lengthSquared)
        : 0;
      const closestX = a.x + dx * projection;
      const closestY = a.y + dy * projection;
      const radius = Math.max(0.0025, mix(a.width, b.width, projection) * 0.62);
      const distance = Math.hypot(queryX - closestX, y - closestY);
      featureValue = Math.max(featureValue, Math.pow(smoothstep(1 - distance / radius), 1.18));
    }
    const contribution = featureValue * feature.strength * amplitude;
    if (contribution >= 0) positive = Math.max(positive, contribution);
    else negative = Math.min(negative, contribution);
  }
  return clamp(positive + negative, -amplitude, amplitude);
}

function buildFaultAtlas(seed: number) {
  const width = 160;
  const height = 100;
  const random = makeRandom(seed ^ 0xd04f17);
  const faults = Array.from({ length: 88 }, () => {
    const z = random() * 2 - 1;
    const angle = random() * TAU;
    const radius = Math.sqrt(Math.max(0, 1 - z * z));
    return { x: Math.cos(angle) * radius, y: z, z: Math.sin(angle) * radius };
  });
  const field = new Float32Array(width * height);
  let sum = 0;
  let sumSquares = 0;
  for (let y = 0; y < height; y += 1) {
    const latitude = (0.5 - y / (height - 1)) * Math.PI;
    const cosLatitude = Math.cos(latitude);
    const py = Math.sin(latitude);
    for (let x = 0; x < width; x += 1) {
      const longitude = (x / (width - 1) - 0.5) * TAU;
      const px = cosLatitude * Math.cos(longitude);
      const pz = cosLatitude * Math.sin(longitude);
      let value = 0;
      for (const fault of faults) value += px * fault.x + py * fault.y + pz * fault.z >= 0 ? 1 : -1;
      const index = y * width + x;
      field[index] = value;
      sum += value;
      sumSquares += value * value;
    }
  }
  const mean = sum / field.length;
  const deviation = Math.sqrt(Math.max(1, sumSquares / field.length - mean * mean));
  for (let index = 0; index < field.length; index += 1) field[index] = clamp((field[index] - mean) / (deviation * 2.4), -1, 1);
  return { field, width, height };
}

function elevationQuantile(elevation: Float32Array, coverage: Float32Array, fraction: number) {
  let maximum = 0;
  for (let index = 0; index < elevation.length; index += 1) {
    if (coverage[index] > 0.5) maximum = Math.max(maximum, elevation[index]);
  }
  const histogram = new Uint32Array(2048);
  let land = 0;
  for (let index = 0; index < elevation.length; index += 1) {
    if (coverage[index] <= 0.5) continue;
    histogram[clamp(Math.floor((elevation[index] / Math.max(1e-6, maximum)) * (histogram.length - 1)), 0, histogram.length - 1)] += 1;
    land += 1;
  }
  const desired = land * fraction;
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin += 1) {
    cumulative += histogram[bin];
    if (cumulative >= desired) return (bin / (histogram.length - 1)) * maximum;
  }
  return maximum;
}

function coastlinePerimeterAtScale(coverage: Float32Array, width: number, height: number, step: number) {
  let perimeter = 0;
  const offset = Math.floor(step * 0.5);
  for (let y = offset; y < height; y += step) {
    const previousY = Math.max(offset, y - step);
    for (let x = offset; x < width; x += step) {
      const land = coverage[y * width + x] > 0.5;
      const leftX = wrap(x - step, width);
      if (land !== (coverage[y * width + leftX] > 0.5)) perimeter += step;
      if (y !== previousY && land !== (coverage[previousY * width + x] > 0.5)) perimeter += step;
    }
  }
  return perimeter;
}

interface RasterLandmassComponent {
  area: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  elongation: number;
  verticality: number;
}

function rasterLandmassComponents(coverage: ArrayLike<number>, width: number, height: number) {
  const visited = new Uint8Array(coverage.length);
  const queue = new Uint32Array(coverage.length);
  const components: RasterLandmassComponent[] = [];
  for (let start = 0; start < coverage.length; start += 1) {
    if (coverage[start] <= 0.5 || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let sumY = 0;
    let sumLongitudeX = 0;
    let sumLongitudeY = 0;
    let sumX = 0;
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    let minY = height;
    let maxY = 0;
    const anchorX = start % width;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      sumY += y;
      const longitude = (x / Math.max(1, width)) * TAU;
      sumLongitudeX += Math.cos(longitude);
      sumLongitudeY += Math.sin(longitude);
      const unwrappedX = anchorX + periodicDelta(anchorX, x, width);
      sumX += unwrappedX;
      sumXX += unwrappedX * unwrappedX;
      sumYY += y * y;
      sumXY += unwrappedX * y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      const left = y * width + wrap(x - 1, width);
      const right = y * width + wrap(x + 1, width);
      if (coverage[left] > 0.5 && !visited[left]) { visited[left] = 1; queue[tail++] = left; }
      if (coverage[right] > 0.5 && !visited[right]) { visited[right] = 1; queue[tail++] = right; }
      if (y > 0) {
        const up = current - width;
        if (coverage[up] > 0.5 && !visited[up]) { visited[up] = 1; queue[tail++] = up; }
      }
      if (y + 1 < height) {
        const down = current + width;
        if (coverage[down] > 0.5 && !visited[down]) { visited[down] = 1; queue[tail++] = down; }
      }
    }
    const meanX = sumX / Math.max(1, area);
    const meanY = sumY / Math.max(1, area);
    const covarianceX = Math.max(0, sumXX / Math.max(1, area) - meanX * meanX);
    const covarianceY = Math.max(0, sumYY / Math.max(1, area) - meanY * meanY);
    const covarianceXY = sumXY / Math.max(1, area) - meanX * meanY;
    const trace = covarianceX + covarianceY;
    const root = Math.sqrt(Math.max(0, (covarianceX - covarianceY) ** 2 + 4 * covarianceXY ** 2));
    const major = Math.max(0, (trace + root) * 0.5);
    const minor = Math.max(0, (trace - root) * 0.5);
    const principalAngle = 0.5 * Math.atan2(2 * covarianceXY, covarianceX - covarianceY);
    components.push({
      area,
      minY,
      maxY,
      centerX: wrap(Math.atan2(sumLongitudeY, sumLongitudeX) / TAU),
      centerY: meanY,
      elongation: Math.sqrt((major + 1) / (minor + 1)),
      verticality: Math.abs(Math.sin(principalAngle)),
    });
  }
  return components.sort((a, b) => b.area - a.area);
}

function rasterMorphologyMetrics(
  coverage: Float32Array,
  width: number,
  height: number,
  landPixels: number,
  unit: number,
  featureScale: number,
) {
  const scales = [unit, unit * 2, unit * 4, unit * 8, unit * 16];
  const normalizedPerimeters = scales.map((scale) => (
    coastlinePerimeterAtScale(coverage, width, height, scale) / Math.max(1, Math.sqrt(landPixels))
  ));
  const coastHierarchyIndex = normalizedPerimeters[1] * 0.12
    + normalizedPerimeters[2] * 0.34
    + normalizedPerimeters[3] * 0.34
    + normalizedPerimeters[4] * 0.2;

  const components = rasterLandmassComponents(coverage, width, height);
  const areas = components.map((component) => component.area);
  const meaningfulLandmassCount = areas.filter((area) => area >= landPixels * 0.006).length;
  const largestLandmassShare = (areas[0] ?? 0) / Math.max(1, landPixels);
  const majorComponents = components.filter((component) => component.area >= landPixels * 0.04);
  const majorLandmassCount = majorComponents.length;
  const majorArea = majorComponents.reduce((sum, component) => sum + component.area, 0);
  const meanMajorLandmassElongation = majorComponents.reduce((sum, component) => (
    sum + component.elongation * component.area
  ), 0) / Math.max(1, majorArea);
  const continentalAreas = areas.filter((area) => area >= landPixels * 0.004);
  const continentalPixels = continentalAreas.reduce((sum, area) => sum + area, 0);
  let concentration = 0;
  for (const area of continentalAreas) concentration += (area / Math.max(1, continentalPixels)) ** 2;
  const effectiveLandmassCount = concentration > 0 ? 1 / concentration : 0;
  const deviation = (values: number[]) => {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
  };
  const latitudeScale = Math.max(1, height - 1);
  const centerDeviation = deviation(majorComponents.map((component) => component.centerY / latitudeScale));
  const northEdgeDeviation = deviation(majorComponents.map((component) => component.minY / latitudeScale));
  const southEdgeDeviation = deviation(majorComponents.map((component) => component.maxY / latitudeScale));
  const pairAlignments: number[] = [];
  for (let first = 0; first < majorComponents.length; first += 1) {
    for (let second = first + 1; second < majorComponents.length; second += 1) {
      const a = majorComponents[first];
      const b = majorComponents[second];
      const northMatch = Math.exp(-Math.abs(a.minY - b.minY) / (latitudeScale * 0.055));
      const southMatch = Math.exp(-Math.abs(a.maxY - b.maxY) / (latitudeScale * 0.055));
      const centerMatch = Math.exp(-Math.abs(a.centerY - b.centerY) / (latitudeScale * 0.075));
      pairAlignments.push(Math.sqrt(northMatch * southMatch) * mix(0.78, 1, centerMatch));
    }
  }
  pairAlignments.sort((a, b) => b - a);
  const alignedPairCount = Math.max(1, Math.ceil(pairAlignments.length * 0.35));
  const strongestAlignment = pairAlignments.length
    ? pairAlignments.slice(0, alignedPairCount).reduce((sum, value) => sum + value, 0) / alignedPairCount
    : 1;
  const globalLatitudeStagger = clamp(centerDeviation / 0.2) * 0.5
    + clamp(((northEdgeDeviation + southEdgeDeviation) * 0.5) / 0.18) * 0.5;
  const landmassLatitudeDiversity = majorComponents.length < 2
    ? 0
    : (1 - strongestAlignment) * 0.72 + globalLatitudeStagger * 0.28;
  const majorLongitudes = majorComponents.map((component) => component.centerX).sort((a, b) => a - b);
  const longitudeGaps = majorLongitudes.map((longitude, index) => (
    index + 1 < majorLongitudes.length
      ? majorLongitudes[index + 1] - longitude
      : 1 + majorLongitudes[0] - longitude
  ));
  const meanLongitudeGap = longitudeGaps.length ? 1 / longitudeGaps.length : 0;
  const longitudeGapDeviation = deviation(longitudeGaps);
  const landmassSpacingIrregularity = majorLongitudes.length < 2
    ? 0
    : clamp((longitudeGapDeviation / Math.max(0.001, meanLongitudeGap)) / 0.72);
  let verticalWeight = 0;
  let verticalTotal = 0;
  for (const component of majorComponents) {
    const shapeWeight = smoothstep((component.elongation - 1.12) / 1.18) * component.area;
    verticalWeight += component.verticality * shapeWeight;
    verticalTotal += shapeWeight;
  }
  const verticalLandmassBias = verticalTotal > 0 ? verticalWeight / verticalTotal : 0;
  const landMask = Uint8Array.from(coverage, (value) => (value > 0.5 ? 1 : 0));
  const landDistance = euclideanDistanceTo(landMask, width, height, 0, true);
  const shallowCoreRadius = Math.max(1.5, unit * 2.6 * featureScale);
  const deepCoreRadius = Math.max(shallowCoreRadius + 1, unit * 7.2 * featureScale);
  let shallowCorePixels = 0;
  let deepCorePixels = 0;
  for (let index = 0; index < landMask.length; index += 1) {
    if (!landMask[index]) continue;
    if (landDistance[index] >= shallowCoreRadius) shallowCorePixels += 1;
    if (landDistance[index] >= deepCoreRadius) deepCorePixels += 1;
  }
  const landCoreRetention = deepCorePixels / Math.max(1, shallowCorePixels);
  const landCoreCoverage = shallowCorePixels / Math.max(1, landPixels);
  const neckCoreRadius = Math.max(2, unit * 4.8 * featureScale);
  const neckCoreMask = new Uint8Array(landMask.length);
  for (let index = 0; index < landMask.length; index += 1) {
    if (landMask[index] && landDistance[index] >= neckCoreRadius) neckCoreMask[index] = 1;
  }
  const substantialCoreCount = rasterLandmassComponents(neckCoreMask, width, height)
    .filter((component) => component.area >= landPixels * 0.012).length;
  const neckFragmentation = Math.max(0, substantialCoreCount - majorLandmassCount) / Math.max(1, majorLandmassCount);
  const islandMinimum = Math.max(3, landPixels * 0.000025);
  const islandMaximum = landPixels * 0.006;
  const islands = areas.filter((area) => area >= islandMinimum && area < islandMaximum);
  const islandPixels = islands.reduce((sum, area) => sum + area, 0);
  const bins = new Float32Array(7);
  for (const area of islands) {
    const relative = area / Math.max(1, landPixels);
    const bin = clamp(Math.floor((Math.log10(relative) + 4.65) * 2.2), 0, bins.length - 1);
    bins[bin] += 1;
  }
  let entropy = 0;
  for (const count of bins) {
    if (!count || !islands.length) continue;
    const probability = count / islands.length;
    entropy -= probability * Math.log2(probability);
  }
  const entropyNormalized = entropy / Math.log2(bins.length);
  const islandAreaShare = islandPixels / Math.max(1, landPixels);
  const islandSizeDiversity = entropyNormalized
    * smoothstep(islands.length / 26)
    * smoothstep(islandAreaShare / 0.028);
  return {
    coastScaleRatio: normalizedPerimeters[0] / Math.max(0.001, normalizedPerimeters[3]),
    coastHierarchyIndex,
    islandAreaPercent: islandAreaShare * 100,
    islandSizeDiversity,
    largestLandmassShare,
    meaningfulLandmassCount,
    majorLandmassCount,
    effectiveLandmassCount,
    landmassLatitudeDiversity,
    landmassSpacingIrregularity,
    verticalLandmassBias,
    meanMajorLandmassElongation,
    landCoreRetention,
    landCoreCoverage,
    neckFragmentation,
  };
}

function buildRasterTerrain(mesh: GraphMesh, terrain: TerrainCandidate, settings: WorldSettings, seed: number): RasterTerrain {
  const { width, height } = settings;
  const pixelScale = Math.min(width, height) / 630;
  const potentialMap = rasterizeTriangles(mesh, terrain.potential, width, height);
  const reliefRadius = Math.max(3, Math.round(pixelScale * 5));
  const macroElevation = boxBlurField(rasterizeTriangles(mesh, terrain.elevation, width, height), width, height, reliefRadius, 2);
  const ridgeMap = boxBlurField(
    rasterizeTriangles(mesh, terrain.ridge, width, height),
    width,
    height,
    Math.max(1, Math.round(reliefRadius * 0.36)),
    1,
  );
  const macroLand = new Uint8Array(width * height);
  const oceanReserve = new Uint8Array(width * height);
  const frameMarginX = 0;
  const frameMarginY = Math.ceil(height * FRAME_OCEAN_MARGIN);
  for (let y = 0; y < height; y += 1) {
    const oceanProfile = oceanBasinProfile(terrain.oceanBasin, y / Math.max(1, height - 1), mesh.aspect);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const worldX = (x / Math.max(1, width - 1)) * mesh.aspect;
      const reserved = Math.abs(periodicDelta(oceanProfile.center, worldX, mesh.aspect)) < oceanProfile.halfWidth;
      oceanReserve[index] = reserved ? 1 : 0;
      macroLand[index] = potentialMap[index] > terrain.seaLevel && !reserved ? 1 : 0;
    }
  }
  const signedDistance = signedEuclideanDistance(macroLand, width, height, true);
  const features = buildCoastFeatures(mesh, terrain, settings, seed);
  const faultAtlas = buildFaultAtlas(seed);
  const coastalField = new Float32Array(width * height);
  const warpXField = new Float32Array(width * height);
  const warpYField = new Float32Array(width * height);
  const detailControl = settings.coastDetail / 100;
  const planet = planetScaleMetrics(settings);
  const frequencyScale = 1 / planet.featureScale;
  const detailAmplitude = mix(14, 84, detailControl) * pixelScale;
  const warpAmplitude = mix(4, 15, detailControl) * pixelScale;
  const minimumDimension = Math.min(width, height);

  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const longitude = nx * TAU;
      const longitudeX = Math.cos(longitude);
      const longitudeY = Math.sin(longitude);
      const warpX = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.13, 2.4 * frequencyScale, seed + 521, 3) * warpAmplitude;
      const warpY = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.21, 2.4 * frequencyScale, seed + 557, 3) * warpAmplitude;
      const index = y * width + x;
      warpXField[index] = warpX;
      warpYField[index] = warpY;
      const baseDistance = sampleField(signedDistance, width, height, x + warpX, y + warpY, true);
      const envelope = Math.exp(-((Math.abs(baseDistance) / Math.max(4, detailAmplitude * 2.7)) ** 2));
      const fault = sampleField(faultAtlas.field, faultAtlas.width, faultAtlas.height, nx * (faultAtlas.width - 1), ny * (faultAtlas.height - 1));
      const regionalRoughness = mix(0.42, 1.16, smoothstep(
        0.5 + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.08, 3.1 * frequencyScale, seed + 579, 3) * 0.72,
      ));
      const coastNoise = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 4.2 * frequencyScale, seed + 593, 4) * 0.24
        + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.17, 10.5 * frequencyScale, seed + 617, 4) * 0.3
        + regionalRoughness * (
          periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.23, 25 * frequencyScale, seed + 641, 3) * 0.28
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.09, 58 * frequencyScale, seed + 673, 2) * 0.17
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.31, 124 * frequencyScale, seed + 691, 1) * 0.085
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.28, 268 * frequencyScale, seed + 709, 1) * 0.045
        )
        + fault * 0.1;
      const feature = coastFeatureValue(features, nx * mesh.aspect, ny, detailAmplitude * 0.9, mesh.aspect);
      const polarClearance = Math.min(ny, 1 - ny);
      const polarEnvelope = smoothstep((polarClearance - FRAME_OCEAN_MARGIN * 0.45) / (FRAME_OCEAN_MARGIN * 1.35));
      coastalField[index] = baseDistance + (coastNoise * detailAmplitude + feature) * envelope * polarEnvelope;
    }
  }

  const targetLand = targetLandFraction(settings);
  const threshold = selectRasterThreshold(coastalField, width, height, targetLand, frameMarginX, frameMarginY, oceanReserve);
  const coastCoverage = new Float32Array(width * height);
  const coastSigned = new Float32Array(width * height);
  const elevation = new Float32Array(width * height);
  const mountainStrength = new Float32Array(width * height);
  let coastEdges = 0;
  let landPixels = 0;
  let minimumClearance = 0.5;
  const tectonicAmount = mix(0.28, 1, settings.tectonics / 100);

  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const nx = x / Math.max(1, width - 1);
      const longitude = nx * TAU;
      const longitudeX = Math.cos(longitude);
      const longitudeY = Math.sin(longitude);
      const signed = oceanReserve[index]
        ? -Math.max(1, Math.abs(coastalField[index] - threshold))
        : coastalField[index] - threshold;
      coastSigned[index] = signed;
      const horizontal = coastalField[y * width + ((x + 1) % width)] - coastalField[y * width + wrap(x - 1, width)];
      const vertical = coastalField[Math.min(height - 1, y + 1) * width + x] - coastalField[Math.max(0, y - 1) * width + x];
      const localGradient = Math.max(0.65, Math.hypot(horizontal, vertical) * 0.5);
      const withinFrame = y >= frameMarginY && y < height - frameMarginY;
      const coverage = withinFrame && !oceanReserve[index] ? smoothstep(0.5 + signed / (localGradient * 1.65)) : 0;
      coastCoverage[index] = coverage;
      if (coverage > 0.5) {
        landPixels += 1;
        minimumClearance = Math.min(minimumClearance, ny, 1 - ny);
      }
      if (x > 0 && (coverage > 0.5) !== (coastCoverage[index - 1] > 0.5)) coastEdges += 1;
      if (y > 0 && (coverage > 0.5) !== (coastCoverage[index - width] > 0.5)) coastEdges += 1;

      const warpX = warpXField[index];
      const warpY = warpYField[index];
      const structural = sampleField(macroElevation, width, height, x + warpX, y + warpY, true);
      const ridgeEnvelope = clamp(sampleField(ridgeMap, width, height, x + warpX, y + warpY, true));
      if (signed > 0 && withinFrame) {
        const inland = smoothstep(signed / (78 * pixelScale));
        const hills = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 8.5, seed + 701, 5) * 0.031
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.15, 25, seed + 733, 4) * 0.009;
        const folded = 1 - Math.abs(periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.17, 33, seed + 761, 4));
        const rangeBreaks = smoothstep(0.52 + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.31, 7.4, seed + 787, 3) * 0.66);
        const rangeCore = Math.pow(ridgeEnvelope, 1.72) * mix(0.3, 1, Math.pow(folded, 3.2)) * mix(0.48, 1.12, rangeBreaks);
        mountainStrength[index] = clamp(rangeCore * 1.58);
        const mountainCore = rangeCore * (0.08 + Math.pow(folded, 4.2) * 0.72);
        const foothills = Math.pow(ridgeEnvelope, 1.08) * 0.027;
        const mountains = tectonicAmount * (mountainCore + foothills);
        elevation[index] = Math.max(0.003,
          0.007 + Math.pow(inland, 0.68) * 0.22 + Math.max(0, structural) * 0.11
          + hills * mix(0.42, 1, inland) + mountains);
      } else {
        const depth = clamp(-signed / (minimumDimension * 0.19));
        elevation[index] = -0.004 - Math.pow(depth, 0.7) * 0.58 + Math.min(0, structural) * 0.1;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    if ((coastCoverage[y * width] > 0.5) !== (coastCoverage[(y + 1) * width - 1] > 0.5)) coastEdges += 1;
  }

  const measurementUnit = Math.max(1, Math.round(Math.min(width, height) / 512));
  const morphology = rasterMorphologyMetrics(coastCoverage, width, height, landPixels, measurementUnit, planet.featureScale);

  return {
    elevation,
    mountainStrength,
    coastCoverage,
    coastSigned,
    coastlineIndex: landPixels ? coastEdges / Math.sqrt(landPixels) : 0,
    frameClearance: minimumClearance,
    coastScaleRatio: morphology.coastScaleRatio,
    coastHierarchyIndex: morphology.coastHierarchyIndex,
    islandAreaPercent: morphology.islandAreaPercent,
    islandSizeDiversity: morphology.islandSizeDiversity,
    largestLandmassShare: morphology.largestLandmassShare,
    meaningfulLandmassCount: morphology.meaningfulLandmassCount,
    majorLandmassCount: morphology.majorLandmassCount,
    effectiveLandmassCount: morphology.effectiveLandmassCount,
    landmassLatitudeDiversity: morphology.landmassLatitudeDiversity,
    landmassSpacingIrregularity: morphology.landmassSpacingIrregularity,
    verticalLandmassBias: morphology.verticalLandmassBias,
    meanMajorLandmassElongation: morphology.meanMajorLandmassElongation,
    landCoreRetention: morphology.landCoreRetention,
    landCoreCoverage: morphology.landCoreCoverage,
    neckFragmentation: morphology.neckFragmentation,
    rockLevel: elevationQuantile(elevation, coastCoverage, 0.87),
    snowLevel: elevationQuantile(elevation, coastCoverage, 0.98),
  };
}

function drawRiverMask(
  mesh: GraphMesh,
  routing: ReturnType<typeof routeGraphRivers>,
  raster: RasterTerrain,
  width: number,
  height: number,
) {
  const mask = new Uint8Array(width * height);
  const hasRiverInflow = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!routing.river[cell]) continue;
    const target = routing.receiver[cell];
    if (target >= 0 && routing.river[target]) hasRiverInflow[target] = 1;
  }

  type RiverPoint = { x: number; y: number; strength: number };
  const smoothPath = (points: RiverPoint[]) => {
    let current = points;
    for (let pass = 0; pass < 2 && current.length > 2; pass += 1) {
      const next: RiverPoint[] = [current[0]];
      for (let index = 0; index + 1 < current.length; index += 1) {
        const a = current[index];
        const b = current[index + 1];
        next.push(
          { x: mix(a.x, b.x, 0.25), y: mix(a.y, b.y, 0.25), strength: mix(a.strength, b.strength, 0.25) },
          { x: mix(a.x, b.x, 0.75), y: mix(a.y, b.y, 0.75), strength: mix(a.strength, b.strength, 0.75) },
        );
      }
      next.push(current[current.length - 1]);
      current = next;
    }
    return current;
  };

  const drawCapsule = (a: RiverPoint, b: RiverPoint) => {
    for (const shift of [-width, 0, width]) {
      const shiftedA = { ...a, x: a.x + shift };
      const shiftedB = { ...b, x: b.x + shift };
      const pixelScale = Math.min(width, height) / 630;
      const strength = Math.max(1, (a.strength + b.strength) * 0.5);
      const radius = clamp((0.2 + Math.log2(strength + 1) * 0.22) * pixelScale, 0.26, 1.75 * pixelScale);
      const padding = radius + 1.25;
      const minX = Math.max(0, Math.floor(Math.min(shiftedA.x, shiftedB.x) - padding));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(shiftedA.x, shiftedB.x) + padding));
      const minY = Math.max(0, Math.floor(Math.min(shiftedA.y, shiftedB.y) - padding));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(shiftedA.y, shiftedB.y) + padding));
      const dx = shiftedB.x - shiftedA.x;
      const dy = shiftedB.y - shiftedA.y;
      const lengthSquared = dx * dx + dy * dy;
      const opacity = Math.min(225, 92 + Math.log2(strength + 1) * 31);
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const index = y * width + x;
          if (raster.coastCoverage[index] < 0.22) continue;
          const projection = lengthSquared > 0
            ? clamp(((x + 0.5 - shiftedA.x) * dx + (y + 0.5 - shiftedA.y) * dy) / lengthSquared)
            : 0;
          const closestX = shiftedA.x + dx * projection;
          const closestY = shiftedA.y + dy * projection;
          const distance = Math.hypot(x + 0.5 - closestX, y + 0.5 - closestY);
          const coverage = smoothstep(radius + 0.8 - distance);
          if (coverage > 0) mask[index] = Math.max(mask[index], Math.round(opacity * coverage));
        }
      }
    }
  };

  for (let source = 0; source < mesh.cellCount; source += 1) {
    if (!routing.drawableSources[source] || hasRiverInflow[source]) continue;
    const points: RiverPoint[] = [];
    let cell = source;
    let guard = 0;
    while (cell >= 0 && guard < mesh.cellCount) {
      const rawX = (mesh.x[cell] / mesh.aspect) * (width - 1);
      const unwrappedX = points.length
        ? rawX + Math.round((points[points.length - 1].x - rawX) / width) * width
        : rawX;
      points.push({
        x: unwrappedX,
        y: mesh.y[cell] * (height - 1),
        strength: routing.accumulation[cell] / routing.threshold,
      });
      const target = routing.receiver[cell];
      if (target < 0) break;
      cell = target;
      guard += 1;
      if (!routing.river[cell]) {
        const mouthX = (mesh.x[cell] / mesh.aspect) * (width - 1);
        points.push({
          x: mouthX + Math.round((points[points.length - 1].x - mouthX) / width) * width,
          y: mesh.y[cell] * (height - 1),
          strength: routing.accumulation[cell] / routing.threshold,
        });
        break;
      }
    }
    const path = smoothPath(points);
    let pathLength = 0;
    for (let index = 0; index + 1 < path.length; index += 1) {
      pathLength += Math.hypot(path[index + 1].x - path[index].x, path[index + 1].y - path[index].y);
    }
    if (points.length < 4 || pathLength < height * 0.045) continue;
    for (let index = 0; index + 1 < path.length; index += 1) drawCapsule(path[index], path[index + 1]);
  }

  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] && raster.elevation[index] > 0) {
      raster.elevation[index] = Math.max(0.0025, raster.elevation[index] - (mask[index] / 255) * 0.018);
    }
  }
  return mask;
}

function hillshade(heightMap: Float32Array, broadHeight: Float32Array, width: number, height: number, x: number, y: number) {
  const x0 = wrap(x - 1, width);
  const x1 = (x + 1) % width;
  const y0 = Math.max(0, y - 1);
  const y1 = Math.min(height - 1, y + 1);
  const verticalScale = Math.min(width, height) * 0.145;
  const fineDx = (heightMap[y * width + x1] - heightMap[y * width + x0]) * 0.5;
  const fineDy = (heightMap[y1 * width + x] - heightMap[y0 * width + x]) * 0.5;
  const broadDx = (broadHeight[y * width + x1] - broadHeight[y * width + x0]) * 0.5;
  const broadDy = (broadHeight[y1 * width + x] - broadHeight[y0 * width + x]) * 0.5;
  const illuminate = (dx: number, dy: number, scale: number) => {
    const nx = -dx * scale;
    const ny = -dy * scale;
    return (nx * -0.5 + ny * -0.43 + 0.75) / Math.hypot(nx, ny, 1);
  };
  const fineLight = illuminate(fineDx, fineDy, verticalScale * 0.72);
  const broadLight = illuminate(broadDx, broadDy, verticalScale * 1.15);
  const relief = heightMap[y * width + x] - broadHeight[y * width + x];
  return clamp(0.58 + mix(broadLight, fineLight, 0.46) * 0.57 + relief * 0.6, 0.3, 1.3);
}

function satelliteLandColor(
  elevation: number,
  temperature: number,
  moisture: number,
  rockLevel: number,
  snowLevel: number,
  mountainStrength: number,
): [number, number, number] {
  const green = smoothstep((moisture - 0.26) / 0.5);
  const cool = smoothstep((0.38 - temperature) / 0.36);
  const warm = smoothstep((temperature - 0.38) / 0.34);
  const dry: [number, number, number] = [mix(129, 162, warm), mix(121, 139, warm), mix(89, 88, warm)];
  const forest: [number, number, number] = [mix(54, 36, warm), mix(82, 78, warm), mix(54, 44, warm)];
  let color: [number, number, number] = [mix(dry[0], forest[0], green), mix(dry[1], forest[1], green), mix(dry[2], forest[2], green)];
  color = [mix(color[0], 108, cool * 0.5), mix(color[1], 115, cool * 0.5), mix(color[2], 92, cool * 0.5)];
  const rock = smoothstep((mountainStrength - 0.14) / 0.46)
    * smoothstep((elevation - rockLevel * 0.58) / Math.max(0.025, rockLevel * 0.5));
  color = [mix(color[0], 116, rock), mix(color[1], 113, rock), mix(color[2], 105, rock)];
  const snow = smoothstep((mountainStrength - 0.64) / 0.3)
    * smoothstep((elevation - snowLevel * 0.7) / Math.max(0.025, snowLevel * 0.2))
    * smoothstep((0.62 - temperature) / 0.34);
  return [mix(color[0], 208, snow), mix(color[1], 213, snow), mix(color[2], 207, snow)];
}

function climateAtlasLandColor(
  elevation: number,
  temperature: number,
  moisture: number,
  rockLevel: number,
  snowLevel: number,
  mountainStrength: number,
): [number, number, number] {
  if (mountainStrength > 0.68 && elevation >= snowLevel * 0.66 && temperature < 0.74) return [241, 241, 224];
  if (mountainStrength > 0.38 && elevation >= rockLevel * 0.52) return [166, 112, 78];
  if (mountainStrength > 0.13 && elevation >= rockLevel * 0.38) return [207, 155, 108];
  if (temperature < 0.2) return [220, 226, 205];
  if (moisture < 0.24 && temperature > 0.54) return [229, 188, 103];
  if (moisture < 0.34) return temperature > 0.56 ? [216, 194, 125] : [197, 194, 139];
  if (moisture > 0.72 && temperature > 0.55) return [58, 124, 48];
  if (moisture > 0.64) return [105, 157, 75];
  return temperature < 0.42 ? [174, 204, 146] : [190, 217, 158];
}

function renderWorld(
  raster: RasterTerrain,
  riverMask: Uint8Array,
  settings: WorldSettings,
  seed: number,
) {
  const { width, height } = settings;
  const heightMap = raster.elevation;
  const broadHeight = blurField(heightMap, width, height, 5);
  const climateScale = 3;
  const climateWidth = Math.ceil(width / climateScale);
  const climateHeight = Math.ceil(height / climateScale);
  const weatherNoise = new Float32Array(climateWidth * climateHeight);
  const moistureNoise = new Float32Array(climateWidth * climateHeight);
  const oceanNoise = new Float32Array(climateWidth * climateHeight);
  const surfaceNoise = new Float32Array(climateWidth * climateHeight);
  for (let y = 0; y < climateHeight; y += 1) {
    const ny = y / Math.max(1, climateHeight - 1);
    for (let x = 0; x < climateWidth; x += 1) {
      const nx = x / Math.max(1, climateWidth - 1);
      const index = y * climateWidth + x;
      const longitude = nx * TAU;
      const longitudeX = Math.cos(longitude);
      const longitudeY = Math.sin(longitude);
      weatherNoise[index] = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 2.8, seed + 401, 3);
      moistureNoise[index] = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.13, 4.8, seed + 433, 4);
      oceanNoise[index] = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.17, 15, seed + 461, 3);
      surfaceNoise[index] = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.21, 27, seed + 487, 3);
    }
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  const shadeMap = new Uint8Array(width * height);
  let landPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    const latitude = Math.abs(ny - 0.5) * 2;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const elevation = heightMap[index];
      const coverage = raster.coastCoverage[index];
      landPixels += coverage;
      const climateX = x / climateScale;
      const climateY = y / climateScale;
      const temperature = clamp(1 - latitude * 0.88 - Math.max(0, elevation) * 0.57
        + sampleField(weatherNoise, climateWidth, climateHeight, climateX, climateY, true) * 0.055);
      const moisture = clamp(0.5 + sampleField(moistureNoise, climateWidth, climateHeight, climateX, climateY, true) * 0.34
        + (settings.moisture - 50) / 95 + (1 - latitude) * 0.08);
      const shade = hillshade(heightMap, broadHeight, width, height, x, y);
      shadeMap[index] = Math.round(clamp(shade / 1.3) * 255);
      const depth = clamp(-elevation * 2.05);
      let oceanColor: [number, number, number];
      let landColor: [number, number, number];

      if (settings.style === "climate") {
        oceanColor = depth > 0.42 ? [168, 203, 232] : [186, 215, 239];
        landColor = climateAtlasLandColor(
          Math.max(0.003, elevation), temperature, moisture, raster.rockLevel, raster.snowLevel, raster.mountainStrength[index],
        );
      } else if (settings.style === "ink") {
        const waterContour = Math.abs(((-Math.min(0, elevation) * 30) % 1) - 0.5) < 0.035 ? 13 : 0;
        oceanColor = [82 - depth * 22 + waterContour, 116 - depth * 25 + waterContour, 119 - depth * 22 + waterContour];
        const contour = Math.abs(((Math.max(0, elevation) * 15) % 1) - 0.5) < 0.045 ? -21 : 0;
        const tint = moisture > 0.58 ? [177, 174, 126] : moisture < 0.34 ? [205, 179, 126] : [194, 184, 139];
        landColor = [tint[0] * shade + contour, tint[1] * shade + contour, tint[2] * shade + contour];
      } else {
        const shelf = Math.exp(-Math.abs(elevation) * 21);
        const oceanTexture = sampleField(oceanNoise, climateWidth, climateHeight, climateX, climateY, true);
        oceanColor = [mix(5, 22, shelf) + oceanTexture * 2.2, mix(24, 72, shelf) + oceanTexture * 3.5, mix(42, 91, shelf) + oceanTexture * 4.2];
        oceanColor = [oceanColor[0] * mix(0.74, 1, 1 - depth), oceanColor[1] * mix(0.67, 1, 1 - depth), oceanColor[2] * mix(0.75, 1, 1 - depth)];
        landColor = satelliteLandColor(
          Math.max(0.003, elevation), temperature, moisture, raster.rockLevel, raster.snowLevel, raster.mountainStrength[index],
        );
        const texture = sampleField(surfaceNoise, climateWidth, climateHeight, climateX, climateY, true) * (moisture > 0.45 ? 3.5 : 2.7);
        landColor = [landColor[0] * shade + texture, landColor[1] * shade + texture, landColor[2] * shade + texture * 0.65];
        const beach = (1 - smoothstep(Math.max(0, elevation) / 0.026)) * smoothstep(coverage);
        landColor = [mix(landColor[0], 184, beach), mix(landColor[1], 168, beach), mix(landColor[2], 112, beach)];
      }

      let color: [number, number, number] = [
        mix(oceanColor[0], landColor[0], coverage),
        mix(oceanColor[1], landColor[1], coverage),
        mix(oceanColor[2], landColor[2], coverage),
      ];
      if (settings.style === "ink" || settings.style === "climate") {
        const coastLine = clamp(4 * coverage * (1 - coverage));
        const outline = settings.style === "climate" ? [76, 91, 73] : [54, 61, 54];
        color = [mix(color[0], outline[0], coastLine), mix(color[1], outline[1], coastLine), mix(color[2], outline[2], coastLine)];
      }

      if (riverMask[index] && coverage > 0.18) {
        const riverBlend = (riverMask[index] / 255) * smoothstep(coverage);
        const riverColor = settings.style === "climate" ? [55, 106, 163] : settings.style === "ink" ? [45, 83, 89] : [18, 72, 91];
        color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
      }
      const grain = settings.style === "climate" ? 0 : (hash(x, y, seed + 509) - 0.5) * (settings.style === "ink" ? 3 : 1.4);
      const target = index * 4;
      pixels[target] = clamp(color[0] + grain, 0, 255);
      pixels[target + 1] = clamp(color[1] + grain, 0, 255);
      pixels[target + 2] = clamp(color[2] + grain, 0, 255);
      pixels[target + 3] = 255;
    }
  }
  return { pixels, landPixels, shadeMap };
}

function sampleByteField(source: Uint8Array, width: number, height: number, x: number, y: number) {
  const wrappedX = wrap(x, width);
  const clampedY = clamp(y, 0, height - 1);
  const x0 = Math.floor(wrappedX);
  const y0 = Math.floor(clampedY);
  const x1 = (x0 + 1) % width;
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = wrappedX - x0;
  const fy = clampedY - y0;
  return mix(
    mix(source[y0 * width + x0], source[y0 * width + x1], fx),
    mix(source[y1 * width + x0], source[y1 * width + x1], fx),
    fy,
  );
}

/**
 * Render a memory-bounded slice of a large 2:1 atlas. The tectonic model stays
 * modest in size; only the final RGBA strip exists at export resolution. Fine
 * periodic detail is confined to the shoreline so 8K adds capes and coves
 * without inventing new continental structure or breaking the longitude seam.
 */
export function renderCartographicStrip(
  model: WorldModel,
  outputWidth: number,
  outputHeight: number,
  startY: number,
  stripHeight: number,
) {
  if (outputWidth < 2 || outputHeight < 2 || startY < 0 || stripHeight < 1 || startY + stripHeight > outputHeight) {
    throw new Error("Invalid atlas export bounds");
  }
  if (outputWidth > 10000 || outputHeight > 5000) throw new Error("Atlas export exceeds the 10K × 5K safety limit");

  const sourceWidth = model.width;
  const sourceHeight = model.height;
  const heightScale = outputHeight / sourceHeight;
  const detailScale = outputHeight / 4096;
  const detailControl = model.settings.coastDetail / 100;
  const planet = planetScaleMetrics(model.settings);
  const frequencyScale = 1 / planet.featureScale;
  const shoreRoughness = mix(0.72, 1.34, detailControl);
  const coastBand = Math.max(4, 104 * detailScale);
  const pixels = new Uint8ClampedArray(outputWidth * stripHeight * 4);

  for (let localY = 0; localY < stripHeight; localY += 1) {
    const y = startY + localY;
    const ny = y / Math.max(1, outputHeight - 1);
    const sourceY = ny * (sourceHeight - 1);
    const latitude = Math.abs(ny - 0.5) * 2;
    for (let x = 0; x < outputWidth; x += 1) {
      const seamX = x === outputWidth - 1 ? 0 : x;
      const nx = seamX / Math.max(1, outputWidth - 1);
      const sourceX = nx * (sourceWidth - 1);
      let signed = sampleField(model.raster.coastSigned, sourceWidth, sourceHeight, sourceX, sourceY, true) * heightScale;

      if (Math.abs(signed) < coastBand) {
        const longitude = nx * TAU;
        const longitudeX = Math.cos(longitude);
        const longitudeY = Math.sin(longitude);
        const envelope = Math.exp(-((Math.abs(signed) / Math.max(2, coastBand * 0.58)) ** 2));
        const warpLongitude = longitude
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.11, 13 * frequencyScale, model.seed + 887, 2) * 0.026;
        const warpLatitude = ny
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.23, 17 * frequencyScale, model.seed + 899, 2) * 0.018;
        const warpedX = Math.cos(warpLongitude);
        const warpedY = Math.sin(warpLongitude);
        const regional = mix(0.52, 1.24, smoothstep(
          0.5 + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 3.2 * frequencyScale, model.seed + 903, 3) * 0.72,
        ));
        const micro = periodicGradientFbmFromUnit(warpedX, warpedY, warpLatitude, 64 * frequencyScale, model.seed + 911, 2) * 36
          + periodicGradientFbmFromUnit(warpedX, warpedY, warpLatitude - 0.19, 170 * frequencyScale, model.seed + 947, 2) * 17
          + periodicGradientFbmFromUnit(warpedX, warpedY, warpLatitude + 0.27, 430 * frequencyScale, model.seed + 983, 1) * 7
          + periodicGradientFbmFromUnit(warpedX, warpedY, warpLatitude - 0.31, 1100 * frequencyScale, model.seed + 997, 1) * 3;
        signed += micro * detailScale * shoreRoughness * regional * envelope;
      }

      const coverage = smoothstep(0.5 + signed / Math.max(0.68, 0.92 * detailScale));
      let color: [number, number, number];
      if (coverage < 0.01) {
        const depth = smoothstep(-signed / Math.max(8, outputHeight * 0.055));
        color = model.settings.style === "climate"
          ? depth > 0.42 ? [168, 203, 232] : [186, 215, 239]
          : model.settings.style === "ink"
            ? [mix(103, 69, depth), mix(139, 105, depth), mix(145, 119, depth)]
            : [mix(31, 8, depth), mix(91, 41, depth), mix(108, 63, depth)];
      } else {
        const elevation = Math.max(0.0025, sampleField(model.raster.elevation, sourceWidth, sourceHeight, sourceX, sourceY, true));
        const mountainStrength = sampleField(model.raster.mountainStrength, sourceWidth, sourceHeight, sourceX, sourceY, true);
        const depth = smoothstep(-signed / Math.max(8, outputHeight * 0.055));
        const longitude = nx * TAU;
        const longitudeX = Math.cos(longitude);
        const longitudeY = Math.sin(longitude);
        const temperature = clamp(1 - latitude * 0.88 - elevation * 0.57
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 2.8, model.seed + 401, 3) * 0.055);
        const moisture = clamp(0.5
          + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.13, 4.8, model.seed + 433, 4) * 0.34
          + (model.settings.moisture - 50) / 95 + (1 - latitude) * 0.08);
        let land: [number, number, number];
        let ocean: [number, number, number];
        if (model.settings.style === "climate") {
          land = climateAtlasLandColor(elevation, temperature, moisture, model.raster.rockLevel, model.raster.snowLevel, mountainStrength);
          ocean = depth > 0.42 ? [168, 203, 232] : [186, 215, 239];
        } else if (model.settings.style === "ink") {
          const tint: [number, number, number] = moisture > 0.58 ? [177, 174, 126] : moisture < 0.34 ? [205, 179, 126] : [194, 184, 139];
          const contour = Math.abs(((elevation * 17) % 1) - 0.5) < 0.026 ? -18 : 0;
          land = [tint[0] + contour, tint[1] + contour, tint[2] + contour];
          ocean = [mix(103, 69, depth), mix(139, 105, depth), mix(145, 119, depth)];
        } else {
          const natural = satelliteLandColor(elevation, temperature, moisture, model.raster.rockLevel, model.raster.snowLevel, mountainStrength);
          const relief = sampleByteField(model.shadeMap, sourceWidth, sourceHeight, sourceX, sourceY) / 255 * 1.3;
          const mountainBand = smoothstep((mountainStrength - 0.18) / 0.5);
          const reliefGrain = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.29, 185, model.seed + 1007, 2) * mountainBand * 0.08;
          const reliefLight = clamp(0.72 + relief * 0.34 + reliefGrain, 0.66, 1.19);
          const muted: [number, number, number] = [
            mix(natural[0], 119, 0.24) * reliefLight,
            mix(natural[1], 139, 0.24) * reliefLight,
            mix(natural[2], 101, 0.24) * reliefLight,
          ];
          const beach = smoothstep(1 - Math.max(0, signed) / Math.max(2.2, 5.5 * detailScale));
          const contour = Math.abs(((elevation * 32) % 1) - 0.5) < 0.017 ? -7 : 0;
          land = [
            mix(muted[0] + contour, 190, beach * 0.48),
            mix(muted[1] + contour, 179, beach * 0.48),
            mix(muted[2] + contour, 129, beach * 0.48),
          ];
          ocean = [mix(31, 8, depth), mix(91, 41, depth), mix(108, 63, depth)];
        }
        color = [mix(ocean[0], land[0], coverage), mix(ocean[1], land[1], coverage), mix(ocean[2], land[2], coverage)];

        const coastLine = smoothstep(1 - Math.abs(signed) / Math.max(0.9, 1.65 * detailScale));
        const coastInk = model.settings.style === "climate" ? [76, 91, 73] : [48, 62, 57];
        color = [mix(color[0], coastInk[0], coastLine * 0.62), mix(color[1], coastInk[1], coastLine * 0.62), mix(color[2], coastInk[2], coastLine * 0.62)];
        const river = sampleByteField(model.riverMask, sourceWidth, sourceHeight, sourceX, sourceY) / 255;
        if (river > 0.025 && coverage > 0.12) {
          const riverBlend = river * smoothstep(coverage) * (model.settings.style === "climate" ? 0.78 : 0.86);
          const riverColor = model.settings.style === "climate" ? [55, 106, 163] : [28, 91, 113];
          color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
        }
      }

      const grain = model.settings.style === "climate" ? 0 : (hash(seamX, y, model.seed + 1019) - 0.5) * 1.25;
      const target = (localY * outputWidth + x) * 4;
      pixels[target] = clamp(color[0] + grain, 0, 255);
      pixels[target + 1] = clamp(color[1] + grain, 0, 255);
      pixels[target + 2] = clamp(color[2] + grain, 0, 255);
      pixels[target + 3] = 255;
    }
  }
  return pixels;
}

function chooseWorldName(random: () => number) {
  const first = ["Verdant", "Aurelian", "Sable", "Stormward", "Elder", "Thorn", "Ivory", "Cerulean", "Ashen", "Ember"];
  const second = ["Reach", "Expanse", "Marches", "Wilds", "Dominion", "Coast", "Crown", "Basin", "Isles", "Meridian"];
  return `The ${first[Math.floor(random() * first.length)]} ${second[Math.floor(random() * second.length)]}`;
}

function findFocusLongitude(coverage: Float32Array, width: number, height: number) {
  const columns = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) columns[x] += coverage[y * width + x];
  }
  const span = Math.max(1, Math.floor(width * 0.48));
  let current = 0;
  for (let x = 0; x < span; x += 1) current += columns[x];
  let best = current;
  let bestStart = 0;
  for (let start = 1; start < width; start += 1) {
    current -= columns[start - 1];
    current += columns[(start + span - 1) % width];
    if (current > best) {
      best = current;
      bestStart = start;
    }
  }
  const center = (bestStart + span * 0.5) % width;
  return (center / width - 0.5) * TAU;
}

export function generateWorldModel(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldModel {
  const started = performance.now();
  const seed = seedToInt(settings.seed || "ATLAS");
  const planet = planetScaleMetrics(settings);
  onProgress?.("Sampling the dense wrapped mesh", 10);
  const mesh = buildGraphMesh(seed, settings.width, settings.height, settings.simulationSites);
  onProgress?.("Composing continental systems and rifts", 28);
  const terrain = createGraphTerrain(mesh, seed, settings);
  onProgress?.("Conditioning graph drainage", 55);
  const routing = routeGraphRivers(mesh, terrain, settings, seed);
  onProgress?.("Fracturing capes and coastlines", 68);
  const raster = buildRasterTerrain(mesh, terrain, settings, seed);
  onProgress?.("Carving antialiased river valleys", 82);
  const riverMask = drawRiverMask(mesh, routing, raster, settings.width, settings.height);
  onProgress?.("Composing the satellite survey", 88);
  const rendered = renderWorld(raster, riverMask, settings, seed);
  onProgress?.("Survey complete", 100);

  const landPercent = Math.round((rendered.landPixels / (settings.width * settings.height)) * 100);
  const survey = landPercent > 42 ? "Continental interior" : landPercent < 21 ? "Oceanic archipelago" : settings.moisture > 68 ? "Verdant plate mosaic" : settings.moisture < 34 ? "Arid rifted continents" : "Temperate plate mosaic";
  return {
    pixels: rendered.pixels,
    width: settings.width,
    height: settings.height,
    stats: {
      name: chooseWorldName(makeRandom(seed ^ 0xa7f17)),
      survey,
      landPercent,
      plateCount: terrain.plates.length,
      riverCount: routing.riverCount,
      continentSystems: raster.majorLandmassCount,
      coastlineIndex: Math.round(raster.coastlineIndex * 10) / 10,
      frameClearance: Math.round(raster.frameClearance * 1000) / 10,
      largestLandmassPercent: Math.round(raster.largestLandmassShare * 1000) / 10,
      oceanGapPercent: Math.round(terrain.oceanGapShare * 1000) / 10,
      meanLandmassElongation: Math.round(terrain.meanLandmassElongation * 100) / 100,
      coastScaleRatio: Math.round(raster.coastScaleRatio * 100) / 100,
      coastHierarchyIndex: Math.round(raster.coastHierarchyIndex * 10) / 10,
      islandAreaPercent: Math.round(raster.islandAreaPercent * 10) / 10,
      islandSizeDiversity: Math.round(raster.islandSizeDiversity * 100) / 100,
      majorLandmassCount: raster.majorLandmassCount,
      effectiveLandmassCount: Math.round(raster.effectiveLandmassCount * 10) / 10,
      landmassLatitudeDiversity: Math.round(raster.landmassLatitudeDiversity * 100) / 100,
      landmassSpacingIrregularity: Math.round(raster.landmassSpacingIrregularity * 100) / 100,
      verticalLandmassBias: Math.round(raster.verticalLandmassBias * 100) / 100,
      meanMajorLandmassElongation: Math.round(raster.meanMajorLandmassElongation * 100) / 100,
      landCoreRetention: Math.round(raster.landCoreRetention * 100) / 100,
      landCoreCoverage: Math.round(raster.landCoreCoverage * 100) / 100,
      neckFragmentation: Math.round(raster.neckFragmentation * 100) / 100,
      circumferenceKm: Math.round(planet.circumferenceKm / 100) * 100,
      focusLongitude: findFocusLongitude(raster.coastCoverage, settings.width, settings.height),
      generationMs: Math.round(performance.now() - started),
    },
    settings: { ...settings },
    seed,
    raster,
    riverMask,
    shadeMap: rendered.shadeMap,
  };
}

export function generateWorld(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldResult {
  const model = generateWorldModel(settings, onProgress);
  return { pixels: model.pixels, width: model.width, height: model.height, stats: model.stats };
}
