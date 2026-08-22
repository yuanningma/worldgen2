import { Delaunay } from "d3-delaunay";

export type RenderStyle = "satellite" | "ink";

export interface WorldSettings {
  seed: string;
  width: number;
  height: number;
  simulationSites?: number;
  continentSize: number;
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
  coastlineIndex: number;
  frameClearance: number;
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

interface CrustComposition {
  terranes: CrustStroke[];
  cuts: CrustStroke[];
  period: number;
}

interface RasterTerrain {
  elevation: Float32Array;
  coastCoverage: Float32Array;
  coastlineIndex: number;
  frameClearance: number;
  rockLevel: number;
  snowLevel: number;
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

function assignContinentalClusters(plates: Plate[], adjacency: Set<number>[], random: () => number, targetLand: number, aspect: number) {
  const desired = Math.round(plates.length * clamp(targetLand * 1.06, 0.26, 0.62));
  const rootCount = Math.min(desired, 2 + Math.floor(random() * 2));
  const roots: number[] = [];
  const nearest = new Float32Array(plates.length).fill(Number.POSITIVE_INFINITY);
  const first = Math.floor(random() * plates.length);
  roots.push(first);
  while (roots.length < rootCount) {
    const last = roots[roots.length - 1];
    let best = 0;
    let bestDistance = -1;
    for (const plate of plates) {
      const distance = Math.hypot(periodicDelta(plates[last].x, plate.x, aspect), plate.y - plates[last].y);
      nearest[plate.id] = Math.min(nearest[plate.id], distance);
      if (nearest[plate.id] > bestDistance && !roots.includes(plate.id)) {
        bestDistance = nearest[plate.id];
        best = plate.id;
      }
    }
    roots.push(best);
  }

  const continental = new Uint8Array(plates.length);
  const cluster = new Int16Array(plates.length).fill(-1);
  roots.forEach((root, index) => {
    continental[root] = 1;
    cluster[root] = index;
  });
  let assigned = roots.length;
  let roundsWithoutGrowth = 0;
  while (assigned < desired && roundsWithoutGrowth < roots.length * 3) {
    let grew = false;
    for (let clusterId = 0; clusterId < roots.length && assigned < desired; clusterId += 1) {
      const frontier: { plate: number; score: number }[] = [];
      for (const plate of plates) {
        if (cluster[plate.id] !== clusterId) continue;
        for (const neighbor of adjacency[plate.id]) {
          if (continental[neighbor]) continue;
          const candidate = plates[neighbor];
          const latitudePenalty = Math.abs(candidate.y - 0.5) * 0.25;
          frontier.push({ plate: neighbor, score: random() + latitudePenalty });
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
  return cluster;
}

function buildCrustComposition(
  plates: Plate[],
  cluster: Int16Array,
  aspect: number,
  random: () => number,
): CrustComposition {
  const terranes: CrustStroke[] = [];
  const cuts: CrustStroke[] = [];
  const groups = new Map<number, Plate[]>();
  for (const plate of plates) {
    const clusterId = cluster[plate.id];
    if (clusterId < 0) continue;
    const group = groups.get(clusterId) ?? [];
    group.push(plate);
    groups.set(clusterId, group);
  }
  const constrainY = (value: number) => clamp(value, 0.065, 0.935);
  // Work in the mesh's physical metric (0..aspect by 0..1), not normalized
  // texture UVs. Using 0..1 for both axes made every horizontal feature twice
  // as wide on a 2:1 world texture, which produced the paddle-like continents.
  const point = (plate: Plate) => ({ x: plate.x, y: plate.y });

  for (const group of groups.values()) {
    const rawNodes = group.map(point);
    const referenceX = rawNodes[0].x;
    const nodes = rawNodes.map((node) => ({ ...node, x: referenceX + periodicDelta(referenceX, node.x, aspect) }));
    const centroid = nodes.reduce((sum, node) => ({ x: sum.x + node.x / nodes.length, y: sum.y + node.y / nodes.length }), { x: 0, y: 0 });

    // Compact terranes and bent minimum-span links establish a connected core without
    // turning the continental field back into a union of plate-sized circles.
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const radius = mix(0.046, 0.078, random());
      const angle = Math.atan2(group[index].vy, group[index].vx) + (random() - 0.5) * 0.75;
      const halfLength = mix(0.026, 0.068, random());
      terranes.push({
        ax: node.x - Math.cos(angle) * halfLength,
        ay: constrainY(node.y - Math.sin(angle) * halfLength),
        bx: node.x + Math.cos(angle) * halfLength,
        by: constrainY(node.y + Math.sin(angle) * halfLength),
        radiusA: radius * mix(0.72, 1, random()),
        radiusB: radius * mix(0.72, 1, random()),
        strength: mix(0.9, 1.08, random()),
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
        const bendX = (a.x + b.x) * 0.5 + (random() - 0.5) * 0.045;
        const bendY = (a.y + b.y) * 0.5 + (random() - 0.5) * 0.045;
        const width = mix(0.034, 0.057, random());
        terranes.push(
          { ax: a.x, ay: a.y, bx: bendX, by: bendY, radiusA: width, radiusB: width * mix(0.68, 1.04, random()), strength: 1.02 },
          { ax: bendX, ay: bendY, bx: b.x, by: b.y, radiusA: width * mix(0.68, 1.04, random()), radiusB: width, strength: 1.02 },
        );
        connected.add(bestTo);
      }
    }

    // Hooked, tapered branches create the recognizable arms and peninsula hierarchy.
    const branchCount = 2 + nodes.length + Math.floor(random() * 2);
    for (let branch = 0; branch < branchCount; branch += 1) {
      const anchor = nodes[Math.floor(random() * nodes.length)];
      let outwardX = anchor.x - centroid.x;
      let outwardY = anchor.y - centroid.y;
      const outwardLength = Math.hypot(outwardX, outwardY);
      if (outwardLength < 0.025) {
        const plate = group[Math.floor(random() * group.length)];
        outwardX = plate.vx;
        outwardY = plate.vy;
      }
      const baseAngle = Math.atan2(outwardY, outwardX) + (random() - 0.5) * 1.45;
      const hook = (random() < 0.5 ? -1 : 1) * mix(0.32, 1.08, random());
      const totalLength = mix(0.11, 0.23, random());
      const segmentCount = 3 + Math.floor(random() * 3);
      const rootWidth = mix(0.027, 0.047, random());
      const tipWidth = rootWidth * mix(0.52, 0.74, random());
      let previous = anchor;
      let previousWidth = rootWidth;
      let heading = baseAngle;
      for (let segment = 1; segment <= segmentCount; segment += 1) {
        const progress = segment / segmentCount;
        heading += hook / segmentCount + (random() - 0.5) * mix(0.34, 0.12, progress);
        const step = totalLength / segmentCount * mix(0.8, 1.2, random());
        const next = {
          x: previous.x + Math.cos(heading) * step,
          y: constrainY(previous.y + Math.sin(heading) * step),
        };
        const nextWidth = mix(rootWidth, tipWidth, Math.pow(progress, 0.82)) * mix(0.84, 1.12, random());
        terranes.push({
          ax: previous.x, ay: previous.y, bx: next.x, by: next.y,
          radiusA: previousWidth, radiusB: nextWidth, strength: mix(0.96, 1.1, random()),
        });
        previous = next;
        previousWidth = nextWidth;
      }
      const end = previous;

      if (random() < 0.26) {
        const tangent = baseAngle + hook + (random() < 0.5 ? -1 : 1) * mix(0.7, 1.15, random());
        const fragmentStart = {
          x: end.x + Math.cos(tangent) * mix(0.045, 0.082, random()),
          y: constrainY(end.y + Math.sin(tangent) * mix(0.045, 0.082, random())),
        };
        const fragmentLength = mix(0.025, 0.07, random());
        terranes.push({
          ax: fragmentStart.x,
          ay: fragmentStart.y,
          bx: fragmentStart.x + Math.cos(tangent + (random() - 0.5) * 0.65) * fragmentLength,
          by: constrainY(fragmentStart.y + Math.sin(tangent + (random() - 0.5) * 0.65) * fragmentLength),
          radiusA: mix(0.015, 0.026, random()),
          radiusB: mix(0.012, 0.02, random()),
          strength: mix(0.9, 1.04, random()),
        });
      }
    }

    // Subtractive strokes are equally important: they turn a sprawling mass into
    // gulfs, rifts, straits, and occasional inland seas.
    const outerNodes = [...nodes].sort((a, b) => Math.hypot(b.x - centroid.x, b.y - centroid.y) - Math.hypot(a.x - centroid.x, a.y - centroid.y));
    const inletCount = 2 + Math.floor(random() * 3);
    for (let inlet = 0; inlet < inletCount; inlet += 1) {
      const anchor = outerNodes[inlet % outerNodes.length];
      let angle = Math.atan2(anchor.y - centroid.y, anchor.x - centroid.x);
      angle += (random() - 0.5) * 0.65;
      const outside = mix(0.09, 0.17, random());
      const inside = mix(0.085, 0.18, random());
      const cutSegments = 3 + Math.floor(random() * 3);
      const mouthWidth = mix(0.042, 0.072, random());
      const headWidth = mix(0.018, 0.032, random());
      const cutCurl = (random() < 0.5 ? -1 : 1) * mix(0.18, 0.58, random());
      const cutPoints = [{
        x: anchor.x + Math.cos(angle) * outside,
        y: constrainY(anchor.y + Math.sin(angle) * outside),
      }];
      let cutHeading = angle + Math.PI;
      for (let segment = 1; segment <= cutSegments; segment += 1) {
        cutHeading += cutCurl / cutSegments + (random() - 0.5) * 0.18;
        const previous = cutPoints[cutPoints.length - 1];
        const step = (outside + inside) / cutSegments * mix(0.84, 1.16, random());
        cutPoints.push({
          x: previous.x + Math.cos(cutHeading) * step,
          y: constrainY(previous.y + Math.sin(cutHeading) * step),
        });
      }
      for (let segment = 0; segment + 1 < cutPoints.length; segment += 1) {
        const a = cutPoints[segment];
        const b = cutPoints[segment + 1];
        const progressA = segment / cutSegments;
        const progressB = (segment + 1) / cutSegments;
        cuts.push({
          ax: a.x, ay: a.y, bx: b.x, by: b.y,
          radiusA: mix(mouthWidth, headWidth, Math.pow(progressA, 0.74)),
          radiusB: mix(mouthWidth, headWidth, Math.pow(progressB, 0.74)),
          strength: mix(1.2, 1.54, random()),
        });
      }
      if (random() < 0.72) {
        const rootIndex = 1 + Math.floor(random() * Math.max(1, cutPoints.length - 2));
        const root = cutPoints[rootIndex];
        const prior = cutPoints[rootIndex - 1];
        const branchAngle = Math.atan2(root.y - prior.y, root.x - prior.x)
          + (random() < 0.5 ? -1 : 1) * mix(0.55, 1.05, random());
        const branchLength = mix(0.035, 0.075, random());
        cuts.push({
          ax: root.x, ay: root.y,
          bx: root.x + Math.cos(branchAngle) * branchLength,
          by: constrainY(root.y + Math.sin(branchAngle) * branchLength),
          radiusA: mix(0.02, 0.034, random()), radiusB: mix(0.012, 0.022, random()),
          strength: mix(1.16, 1.48, random()),
        });
      }
    }

    const basinCount = random() < 0.78 ? 1 + (random() < 0.32 ? 1 : 0) : 0;
    for (let basin = 0; basin < basinCount; basin += 1) {
      const angle = random() * TAU;
      const offset = mix(0.018, 0.065, random());
      const basinX = centroid.x + Math.cos(angle) * offset;
      const basinY = constrainY(centroid.y + Math.sin(angle) * offset);
      cuts.push({
        ax: basinX,
        ay: basinY,
        bx: basinX + Math.cos(angle + Math.PI * 0.5) * mix(0.025, 0.075, random()),
        by: constrainY(basinY + Math.sin(angle + Math.PI * 0.5) * mix(0.025, 0.075, random())),
        radiusA: mix(0.032, 0.062, random()),
        radiusB: mix(0.022, 0.052, random()),
        strength: mix(1.02, 1.42, random()),
      });
    }

    if (outerNodes.length > 2 && random() < 0.55) {
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
        radiusA: mix(0.012, 0.024, random()),
        radiusB: mix(0.01, 0.022, random()),
        strength: mix(1.28, 1.68, random()),
      });
    }
  }
  return { terranes, cuts, period: aspect };
}

function evaluateCrustStroke(x: number, y: number, stroke: CrustStroke) {
  const dx = stroke.bx - stroke.ax;
  const dy = stroke.by - stroke.ay;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 1e-8 ? clamp(((x - stroke.ax) * dx + (y - stroke.ay) * dy) / lengthSquared) : 0;
  const closestX = stroke.ax + dx * projection;
  const closestY = stroke.ay + dy * projection;
  const radius = mix(stroke.radiusA, stroke.radiusB, projection);
  return (1 - Math.hypot(x - closestX, y - closestY) / Math.max(0.003, radius)) * stroke.strength;
}

function evaluateCrustComposition(composition: CrustComposition, x: number, y: number) {
  let terrane = -1.4;
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

function measureTerrain(mesh: GraphMesh, landMask: Uint8Array, targetComponents: number, desiredCoast: number) {
  const visited = new Uint8Array(mesh.cellCount);
  const componentSizes: number[] = [];
  let coastEdges = 0;
  let landCells = 0;
  let minimumEdgeDistance = 0.5;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!landMask[cell]) continue;
    landCells += 1;
    const edgeDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    minimumEdgeDistance = Math.min(minimumEdgeDistance, edgeDistance);
    for (let cursor = mesh.neighborOffsets[cell]; cursor < mesh.neighborOffsets[cell + 1]; cursor += 1) {
      if (!landMask[mesh.neighbors[cursor]]) coastEdges += 1;
    }
    if (visited[cell]) continue;
    let size = 0;
    const queue = [cell];
    visited[cell] = 1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      size += 1;
      for (let cursor = mesh.neighborOffsets[current]; cursor < mesh.neighborOffsets[current + 1]; cursor += 1) {
        const neighbor = mesh.neighbors[cursor];
        if (landMask[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }
    componentSizes.push(size);
  }
  componentSizes.sort((a, b) => b - a);
  const meaningful = componentSizes.filter((size) => size >= Math.max(5, landCells * 0.006));
  const largestShare = landCells ? (componentSizes[0] ?? 0) / landCells : 1;
  const coastlineIndex = landCells ? coastEdges / Math.sqrt(landCells) : 0;
  const tinyCells = componentSizes.filter((size) => size < Math.max(5, landCells * 0.003)).reduce((sum, size) => sum + size, 0);
  const clearancePenalty = Math.max(0, 0.06 - minimumEdgeDistance) * 115;
  const score = 26
    - Math.abs(meaningful.length - targetComponents) * 4.2
    - Math.max(0, largestShare - 0.68) * 25
    - Math.abs(coastlineIndex - desiredCoast) * 0.65
    - (tinyCells / Math.max(1, landCells)) * 35
    - clearancePenalty;
  return { score, coastlineIndex, meaningfulComponents: meaningful.length, frameClearance: minimumEdgeDistance };
}

function buildTerrainCandidate(mesh: GraphMesh, seed: number, attempt: number, settings: WorldSettings): TerrainCandidate {
  const random = makeRandom(seed ^ Math.imul(attempt + 1, 0x9e3779b1));
  const plateCount = 20 + Math.floor(random() * 7);
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
  const targetLand = mix(0.16, 0.47, settings.continentSize / 100);
  const continentCluster = assignContinentalClusters(plates, adjacency, random, targetLand, mesh.aspect);
  const crustComposition = buildCrustComposition(plates, continentCluster, mesh.aspect, random);
  for (const plate of plates) {
    plate.crustBias = plate.continental ? 0.12 + random() * 0.1 : -0.08 - random() * 0.08;
  }

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
    const polarDistance = Math.min(ny, 1 - ny);
    const polarBand = 0.16;
    const edgePenalty = polarDistance < polarBand
      ? Math.pow((polarBand - polarDistance) / polarBand, 1.55) * 3.1
      : 0;
    base[cell] = clamp(structuredCrust, -1.4, 1.1) * 0.82
      + plate.crustBias
      + (plate.continental ? interior * 0.05 : -interior * 0.035)
      + macro * 0.3
      + regional * coastAmplitude
      - edgePenalty;
    if (mesh.boundary[cell]) base[cell] = -3.5;
  }
  const potential = smoothGraphField(mesh, base, 1, 0.84);
  const eligiblePotential: number[] = [];
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const polarDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    if (polarDistance > FRAME_OCEAN_MARGIN && !mesh.boundary[cell]) eligiblePotential.push(potential[cell]);
  }
  const targetEligibleFraction = clamp((targetLand * mesh.cellCount) / Math.max(1, eligiblePotential.length), 0, 0.92);
  const seaLevel = selectThreshold(Float32Array.from(eligiblePotential), targetEligibleFraction);
  const landMask = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const polarDistance = Math.min(mesh.y[cell], 1 - mesh.y[cell]);
    landMask[cell] = potential[cell] > seaLevel && polarDistance > FRAME_OCEAN_MARGIN && !mesh.boundary[cell] ? 1 : 0;
  }

  const convergence = propagateBoundaryField(mesh, plateId, plates, true);
  const divergence = propagateBoundaryField(mesh, plateId, plates, false);
  const ridge = new Float32Array(mesh.cellCount);
  const elevation = new Float32Array(mesh.cellCount);
  let minPotential = Number.POSITIVE_INFINITY;
  let maxPotential = Number.NEGATIVE_INFINITY;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    minPotential = Math.min(minPotential, potential[cell]);
    maxPotential = Math.max(maxPotential, potential[cell]);
  }
  const tectonicAmount = mix(0.25, 0.9, settings.tectonics / 100);
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

  const measured = measureTerrain(mesh, landMask, 3, mix(11, 15.5, settings.coastDetail / 100));
  return {
    plates,
    plateId,
    potential,
    elevation,
    landMask,
    ridge,
    seaLevel,
    score: measured.score,
    coastlineIndex: measured.coastlineIndex,
    frameClearance: measured.frameClearance,
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
  let best = buildTerrainCandidate(mesh, seed, 0, settings);
  for (let attempt = 1; attempt < 5; attempt += 1) {
    const candidate = buildTerrainCandidate(mesh, seed, attempt, settings);
    if (candidate.score > best.score) best = candidate;
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
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const nx = mesh.x[cell] / mesh.aspect;
    const ny = mesh.y[cell];
    accumulation[cell] = terrain.landMask[cell]
      ? 0.42 + clamp(periodicGradientFbm(nx + 0.31, ny - 0.27, 5.3, seed + 347, 4) * 0.5 + 0.5 + (settings.moisture - 50) / 90) * 1.35
      : 0;
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
  const threshold = mesh.cellCount * mix(0.0052, 0.0024, settings.moisture / 100);
  const river = new Uint8Array(mesh.cellCount);
  for (const cell of order) {
    if (accumulation[cell] >= threshold && terrain.elevation[cell] > 0.012) river[cell] = 1;
  }
  let riverCount = 0;
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
    if (!hasRiverInflow) riverCount += 1;
    terrain.elevation[cell] = Math.max(0.003, terrain.elevation[cell] - clamp(Math.log2(accumulation[cell] / threshold + 1) * 0.012, 0.004, 0.035));
  }
  return { receiver, accumulation, river, threshold, riverCount };
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
) {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let eligible = 0;
  for (let y = marginY; y < height - marginY; y += 1) {
    for (let x = marginX; x < width - marginX; x += 1) {
      const value = values[y * width + x];
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
      const bin = clamp(Math.floor((values[y * width + x] - minimum) * scale), 0, binCount - 1);
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
  const desired = Math.round(mix(14, 30, settings.coastDetail / 100));
  let systems = 0;
  let attempts = 0;
  while (systems < desired && candidates.length && attempts < desired * 22) {
    attempts += 1;
    const candidate = candidates[Math.floor(random() * candidates.length)];
    if (anchors.some((anchor) => Math.hypot(periodicDelta(anchor.x, candidate.x, mesh.aspect), anchor.y - candidate.y) < 0.044)) continue;

    const peninsula = random() < 0.18;
    const sign = peninsula ? 1 : -1;
    const featureLength = (peninsula ? mix(0.035, 0.078, random()) : mix(0.055, 0.145, random()))
      * mix(0.78, 1.16, settings.coastDetail / 100);
    const rootWidth = featureLength * (peninsula ? mix(0.24, 0.36, random()) : mix(0.28, 0.46, random()));
    const tipWidth = rootWidth * (peninsula ? mix(0.68, 0.9, random()) : mix(0.45, 0.68, random()));
    const segmentCount = 4 + Math.floor(random() * 3);
    const points: CoastPoint[] = [];
    let heading = Math.atan2(candidate.dy * sign, candidate.dx * sign);
    const curl = (random() < 0.5 ? -1 : 1) * mix(0.22, 0.85, random());
    const mouthOffset = peninsula ? -rootWidth * 0.35 : rootWidth * 0.45;
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
    selected.push(makeFeature(points, sign * mix(0.72, 1.04, random())));
    anchors.push(candidate);
    systems += 1;

    // Side branches turn a single smooth cape or gulf into a geographic system:
    // forked fjords, drowned valleys, hooked peninsulas, and nested coves.
    const branchCount = peninsula ? 0 : 1 + Math.floor(random() * 2);
    for (let branch = 0; branch < branchCount; branch += 1) {
      const rootIndex = Math.min(points.length - 2, 1 + Math.floor(mix(0.25, 0.68, random()) * (points.length - 1)));
      const root = points[rootIndex];
      const previous = points[Math.max(0, rootIndex - 1)];
      const parentHeading = Math.atan2(root.y - previous.y, root.x - previous.x);
      let branchHeading = parentHeading + (random() < 0.5 ? -1 : 1) * mix(0.52, 1.12, random());
      const branchLength = featureLength * mix(0.3, 0.58, random());
      const branchSegments = 2 + Math.floor(random() * 3);
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
      selected.push(makeFeature(branchPoints, sign * mix(0.32, 0.52, random())));
    }
  }
  return selected;
}

function coastFeatureValue(features: CoastFeature[], x: number, y: number, amplitude: number, period: number) {
  let value = 0;
  for (const feature of features) {
    const centerX = (feature.minX + feature.maxX) * 0.5;
    const queryX = x + Math.round((centerX - x) / period) * period;
    if (queryX < feature.minX || queryX > feature.maxX || y < feature.minY || y > feature.maxY) continue;
    let featureValue = 0;
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
      const radius = Math.max(0.0025, mix(a.width, b.width, projection));
      const distance = Math.hypot(queryX - closestX, y - closestY);
      featureValue = Math.max(featureValue, Math.pow(smoothstep(1 - distance / radius), 1.18));
    }
    value += featureValue * feature.strength * amplitude;
  }
  return value;
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

function buildRasterTerrain(mesh: GraphMesh, terrain: TerrainCandidate, settings: WorldSettings, seed: number): RasterTerrain {
  const { width, height } = settings;
  const pixelScale = Math.min(width, height) / 630;
  const potentialMap = rasterizeTriangles(mesh, terrain.potential, width, height);
  const reliefRadius = Math.max(3, Math.round(pixelScale * 5));
  const macroElevation = boxBlurField(rasterizeTriangles(mesh, terrain.elevation, width, height), width, height, reliefRadius, 2);
  const ridgeMap = boxBlurField(rasterizeTriangles(mesh, terrain.ridge, width, height), width, height, Math.max(2, Math.round(reliefRadius * 0.7)), 2);
  const macroLand = new Uint8Array(width * height);
  const frameMarginX = 0;
  const frameMarginY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      macroLand[index] = potentialMap[index] > terrain.seaLevel ? 1 : 0;
    }
  }
  const signedDistance = signedEuclideanDistance(macroLand, width, height, true);
  const features = buildCoastFeatures(mesh, terrain, settings, seed);
  const faultAtlas = buildFaultAtlas(seed);
  const coastalField = new Float32Array(width * height);
  const warpXField = new Float32Array(width * height);
  const warpYField = new Float32Array(width * height);
  const detailControl = settings.coastDetail / 100;
  const detailAmplitude = mix(16, 72, detailControl) * pixelScale;
  const warpAmplitude = mix(4, 15, detailControl) * pixelScale;
  const minimumDimension = Math.min(width, height);

  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const longitude = nx * TAU;
      const longitudeX = Math.cos(longitude);
      const longitudeY = Math.sin(longitude);
      const warpX = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.13, 2.4, seed + 521, 3) * warpAmplitude;
      const warpY = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.21, 2.4, seed + 557, 3) * warpAmplitude;
      const index = y * width + x;
      warpXField[index] = warpX;
      warpYField[index] = warpY;
      const baseDistance = sampleField(signedDistance, width, height, x + warpX, y + warpY, true);
      const envelope = Math.exp(-((Math.abs(baseDistance) / Math.max(4, detailAmplitude * 2.7)) ** 2));
      const fault = sampleField(faultAtlas.field, faultAtlas.width, faultAtlas.height, nx * (faultAtlas.width - 1), ny * (faultAtlas.height - 1));
      const coastNoise = periodicGradientFbmFromUnit(longitudeX, longitudeY, ny, 4.2, seed + 593, 4) * 0.31
        + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.17, 10.5, seed + 617, 4) * 0.28
        + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.23, 25, seed + 641, 3) * 0.21
        + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny - 0.09, 58, seed + 673, 2) * 0.13
        + periodicGradientFbmFromUnit(longitudeX, longitudeY, ny + 0.31, 124, seed + 691, 1) * 0.07
        + fault * 0.1;
      const feature = coastFeatureValue(features, nx * mesh.aspect, ny, detailAmplitude * 0.9, mesh.aspect);
      coastalField[index] = baseDistance + (coastNoise * detailAmplitude + feature) * envelope;
    }
  }

  const targetLand = mix(0.16, 0.47, settings.continentSize / 100);
  const threshold = selectRasterThreshold(coastalField, width, height, targetLand, frameMarginX, frameMarginY);
  const coastCoverage = new Float32Array(width * height);
  const elevation = new Float32Array(width * height);
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
      const signed = coastalField[index] - threshold;
      const horizontal = coastalField[y * width + ((x + 1) % width)] - coastalField[y * width + wrap(x - 1, width)];
      const vertical = coastalField[Math.min(height - 1, y + 1) * width + x] - coastalField[Math.max(0, y - 1) * width + x];
      const localGradient = Math.max(0.65, Math.hypot(horizontal, vertical) * 0.5);
      const withinFrame = true;
      const coverage = smoothstep(0.5 + signed / (localGradient * 1.65));
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
        const mountainCore = Math.pow(ridgeEnvelope, 1.28) * (0.1 + Math.pow(folded, 3.5) * 0.62);
        const foothills = Math.pow(ridgeEnvelope, 0.68) * 0.045;
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

  return {
    elevation,
    coastCoverage,
    coastlineIndex: landPixels ? coastEdges / Math.sqrt(landPixels) : 0,
    frameClearance: minimumClearance,
    rockLevel: elevationQuantile(elevation, coastCoverage, 0.79),
    snowLevel: elevationQuantile(elevation, coastCoverage, 0.955),
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
      const radius = clamp((0.38 + Math.log2(strength + 1) * 0.34) * pixelScale, 0.42, 2.8 * pixelScale);
      const padding = radius + 1.25;
      const minX = Math.max(0, Math.floor(Math.min(shiftedA.x, shiftedB.x) - padding));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(shiftedA.x, shiftedB.x) + padding));
      const minY = Math.max(0, Math.floor(Math.min(shiftedA.y, shiftedB.y) - padding));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(shiftedA.y, shiftedB.y) + padding));
      const dx = shiftedB.x - shiftedA.x;
      const dy = shiftedB.y - shiftedA.y;
      const lengthSquared = dx * dx + dy * dy;
      const opacity = Math.min(235, 112 + Math.log2(strength + 1) * 34);
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
    if (!routing.river[source] || hasRiverInflow[source]) continue;
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
): [number, number, number] {
  const green = smoothstep((moisture - 0.26) / 0.5);
  const cool = smoothstep((0.38 - temperature) / 0.36);
  const warm = smoothstep((temperature - 0.38) / 0.34);
  const dry: [number, number, number] = [mix(129, 162, warm), mix(121, 139, warm), mix(89, 88, warm)];
  const forest: [number, number, number] = [mix(54, 36, warm), mix(82, 78, warm), mix(54, 44, warm)];
  let color: [number, number, number] = [mix(dry[0], forest[0], green), mix(dry[1], forest[1], green), mix(dry[2], forest[2], green)];
  color = [mix(color[0], 108, cool * 0.5), mix(color[1], 115, cool * 0.5), mix(color[2], 92, cool * 0.5)];
  const rock = smoothstep((elevation - rockLevel) / Math.max(0.035, snowLevel - rockLevel));
  color = [mix(color[0], 116, rock), mix(color[1], 113, rock), mix(color[2], 105, rock)];
  const snow = smoothstep((elevation - snowLevel) / Math.max(0.025, snowLevel * 0.12)) * smoothstep((0.58 - temperature) / 0.32);
  return [mix(color[0], 208, snow), mix(color[1], 213, snow), mix(color[2], 207, snow)];
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
      const depth = clamp(-elevation * 2.05);
      let oceanColor: [number, number, number];
      let landColor: [number, number, number];

      if (settings.style === "ink") {
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
        landColor = satelliteLandColor(Math.max(0.003, elevation), temperature, moisture, raster.rockLevel, raster.snowLevel);
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
      if (settings.style === "ink") {
        const coastLine = clamp(4 * coverage * (1 - coverage));
        color = [mix(color[0], 54, coastLine), mix(color[1], 61, coastLine), mix(color[2], 54, coastLine)];
      }

      if (riverMask[index] && coverage > 0.18) {
        const riverBlend = (riverMask[index] / 255) * smoothstep(coverage);
        const riverColor = settings.style === "ink" ? [45, 83, 89] : [18, 72, 91];
        color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
      }
      const grain = (hash(x, y, seed + 509) - 0.5) * (settings.style === "ink" ? 3 : 1.4);
      const target = index * 4;
      pixels[target] = clamp(color[0] + grain, 0, 255);
      pixels[target + 1] = clamp(color[1] + grain, 0, 255);
      pixels[target + 2] = clamp(color[2] + grain, 0, 255);
      pixels[target + 3] = 255;
    }
  }
  return { pixels, landPixels };
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

export function generateWorld(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldResult {
  const started = performance.now();
  const seed = seedToInt(settings.seed || "ATLAS");
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
      coastlineIndex: Math.round(raster.coastlineIndex * 10) / 10,
      frameClearance: Math.round(raster.frameClearance * 1000) / 10,
      focusLongitude: findFocusLongitude(raster.coastCoverage, settings.width, settings.height),
      generationMs: Math.round(performance.now() - started),
    },
  };
}
