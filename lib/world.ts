import { Delaunay } from "d3-delaunay";

export type RenderStyle = "satellite" | "ink";

export interface WorldSettings {
  seed: string;
  width: number;
  height: number;
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
  score: number;
  coastlineIndex: number;
  frameClearance: number;
}

const TAU = Math.PI * 2;
const FRAME_OCEAN_MARGIN = 0.045;

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(value: number) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
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

function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const top = mix(hash(ix, iy, seed), hash(ix + 1, iy, seed), fx);
  const bottom = mix(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), fx);
  return mix(top, bottom, fy);
}

function fbm(x: number, y: number, seed: number, octaves = 5) {
  let value = 0;
  let amplitude = 0.53;
  let frequency = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise(x * frequency, y * frequency, seed + octave * 37) * amplitude;
    total += amplitude;
    frequency *= 2.06;
    amplitude *= 0.49;
  }
  return value / total;
}

function ridgedNoise(x: number, y: number, seed: number) {
  return 1 - Math.abs(fbm(x, y, seed, 4) * 2 - 1);
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

function buildGraphMesh(seed: number, width: number, height: number) {
  const aspect = width / height;
  const targetCount = Math.round(clamp((width * height) / 45, 1400, 15500));
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
    if (points[index][0] === 0 || points[index][0] === aspect || points[index][1] === 0 || points[index][1] === 1) boundary[index] = 1;
  }

  const neighborLists: number[][] = [];
  let neighborCount = 0;
  for (let index = 0; index < cellCount; index += 1) {
    const neighbors = Array.from(delaunay.neighbors(index)).sort((a, b) => a - b);
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
  return Math.hypot(mesh.x[a] - mesh.x[b], mesh.y[a] - mesh.y[b]);
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
      const dx = mesh.x[cell] - plate.x;
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

function assignContinentalClusters(plates: Plate[], adjacency: Set<number>[], random: () => number, targetLand: number) {
  const desired = Math.round(plates.length * clamp(targetLand * 1.06, 0.26, 0.62));
  const rootCount = Math.min(desired, 3 + Math.floor(random() * 2));
  const roots: number[] = [];
  const nearest = new Float32Array(plates.length).fill(Number.POSITIVE_INFINITY);
  const first = Math.floor(random() * plates.length);
  roots.push(first);
  while (roots.length < rootCount) {
    const last = roots[roots.length - 1];
    let best = 0;
    let bestDistance = -1;
    for (const plate of plates) {
      const distance = Math.hypot(plate.x - plates[last].x, plate.y - plates[last].y);
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
      const dx = mesh.x[neighbor] - mesh.x[cell];
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

function measureTerrain(mesh: GraphMesh, landMask: Uint8Array, targetComponents: number) {
  const visited = new Uint8Array(mesh.cellCount);
  const componentSizes: number[] = [];
  let coastEdges = 0;
  let landCells = 0;
  let minimumEdgeDistance = 0.5;
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!landMask[cell]) continue;
    landCells += 1;
    const nx = mesh.x[cell] / mesh.aspect;
    const edgeDistance = Math.min(nx, 1 - nx, mesh.y[cell], 1 - mesh.y[cell]);
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
  const desiredCoast = 11.5;
  const clearancePenalty = Math.max(0, 0.072 - minimumEdgeDistance) * 115;
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
  assignContinentalClusters(plates, adjacency, random, targetLand);
  for (const plate of plates) {
    plate.crustBias = plate.continental ? 0.62 + random() * 0.25 : -0.62 - random() * 0.2;
  }

  const base = new Float32Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const plate = plates[plateId[cell]];
    const distance = Math.hypot(mesh.x[cell] - plate.x, mesh.y[cell] - plate.y);
    const interior = clamp(1 - distance / 0.34);
    const nx = mesh.x[cell] / mesh.aspect;
    const ny = mesh.y[cell];
    const macro = fbm(nx * 2.7 + attempt * 9, ny * 2.7 - attempt * 7, seed + 101, 4) - 0.5;
    const regional = fbm(nx * 7.6 - 4, ny * 7.6 + 3, seed + 149, 4) - 0.5;
    const coastAmplitude = mix(0.08, 0.23, settings.coastDetail / 100);
    const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
    const edgePenalty = edge < 0.13 ? Math.pow((0.13 - edge) / 0.13, 1.55) * 1.85 : 0;
    base[cell] = plate.crustBias
      + (plate.continental ? interior * 0.14 : -interior * 0.08)
      + macro * 0.34
      + regional * coastAmplitude
      - edgePenalty;
    if (edge <= FRAME_OCEAN_MARGIN || mesh.boundary[cell]) base[cell] = -3.5;
  }
  const potential = smoothGraphField(mesh, base, 5, 0.64);
  const eligiblePotential: number[] = [];
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const nx = mesh.x[cell] / mesh.aspect;
    const edge = Math.min(nx, 1 - nx, mesh.y[cell], 1 - mesh.y[cell]);
    if (edge > FRAME_OCEAN_MARGIN && !mesh.boundary[cell]) eligiblePotential.push(potential[cell]);
  }
  const targetEligibleFraction = clamp((targetLand * mesh.cellCount) / Math.max(1, eligiblePotential.length), 0, 0.92);
  const seaLevel = selectThreshold(Float32Array.from(eligiblePotential), targetEligibleFraction);
  const landMask = new Uint8Array(mesh.cellCount);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    const nx = mesh.x[cell] / mesh.aspect;
    const edge = Math.min(nx, 1 - nx, mesh.y[cell], 1 - mesh.y[cell]);
    landMask[cell] = potential[cell] > seaLevel && edge > FRAME_OCEAN_MARGIN && !mesh.boundary[cell] ? 1 : 0;
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
    ridge[cell] = convergentInfluence * mix(0.48, 1, ridgedNoise(nx * 21, ny * 21, seed + 241));
    if (landMask[cell]) {
      const relative = clamp((potential[cell] - seaLevel) / Math.max(0.001, maxPotential - seaLevel));
      const hills = (fbm(nx * 12 + 8, ny * 12 - 5, seed + 269, 5) - 0.5) * 0.105;
      const fractured = Math.max(0, ridgedNoise(nx * 27, ny * 27, seed + 293) - 0.62) * 0.065;
      elevation[cell] = 0.008 + Math.pow(relative, 0.68) * 0.38 + hills + fractured
        + ridge[cell] * tectonicAmount * 0.72
        - divergentInfluence * tectonicAmount * 0.12;
      elevation[cell] = Math.max(0.003, elevation[cell]);
    } else {
      const relative = clamp((seaLevel - potential[cell]) / Math.max(0.001, seaLevel - minPotential));
      elevation[cell] = -0.012 - Math.pow(relative, 0.72) * 0.64 - divergentInfluence * tectonicAmount * 0.08;
    }
  }

  const measured = measureTerrain(mesh, landMask, 4);
  return {
    plates,
    plateId,
    potential,
    elevation,
    landMask,
    ridge,
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
      ? 0.42 + clamp(fbm(nx * 5.3 + 17, ny * 5.3 - 11, seed + 347, 4) + (settings.moisture - 50) / 90) * 1.35
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

function drawRiverMask(
  mesh: GraphMesh,
  routing: ReturnType<typeof routeGraphRivers>,
  width: number,
  height: number,
) {
  const mask = new Uint8Array(width * height);
  for (let cell = 0; cell < mesh.cellCount; cell += 1) {
    if (!routing.river[cell]) continue;
    const target = routing.receiver[cell];
    if (target < 0) continue;
    const x0 = (mesh.x[cell] / mesh.aspect) * (width - 1);
    const y0 = mesh.y[cell] * (height - 1);
    const x1 = (mesh.x[target] / mesh.aspect) * (width - 1);
    const y1 = mesh.y[target] * (height - 1);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const strength = routing.accumulation[cell] / routing.threshold;
    const radius = strength > 7 ? 2 : strength > 2.4 ? 1 : 0;
    const alpha = Math.min(220, 75 + Math.log2(strength + 1) * 42);
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(mix(x0, x1, t));
      const y = Math.round(mix(y0, y1, t));
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < width && py < height) mask[py * width + px] = Math.max(mask[py * width + px], alpha);
        }
      }
    }
  }
  return mask;
}

function hillshade(heightMap: Float32Array, width: number, height: number, x: number, y: number) {
  const x0 = Math.max(0, x - 1);
  const x1 = Math.min(width - 1, x + 1);
  const y0 = Math.max(0, y - 1);
  const y1 = Math.min(height - 1, y + 1);
  const tl = heightMap[y0 * width + x0];
  const top = heightMap[y0 * width + x];
  const tr = heightMap[y0 * width + x1];
  const left = heightMap[y * width + x0];
  const right = heightMap[y * width + x1];
  const bl = heightMap[y1 * width + x0];
  const bottom = heightMap[y1 * width + x];
  const br = heightMap[y1 * width + x1];
  const dzdx = (tr + right * 2 + br - tl - left * 2 - bl) / 8;
  const dzdy = (bl + bottom * 2 + br - tl - top * 2 - tr) / 8;
  const nx = -dzdx * 24;
  const ny = -dzdy * 24;
  const normalLength = Math.hypot(nx, ny, 1);
  const light = (nx * -0.48 + ny * -0.42 + 0.77) / normalLength;
  return clamp(0.54 + light * 0.58 - Math.hypot(dzdx, dzdy) * 1.2, 0.3, 1.32);
}

function satelliteLandColor(elevation: number, temperature: number, moisture: number): [number, number, number] {
  const green = smoothstep((moisture - 0.26) / 0.5);
  const cool = smoothstep((0.38 - temperature) / 0.36);
  const dry: [number, number, number] = temperature > 0.58 ? [162, 139, 88] : [129, 121, 89];
  const forest: [number, number, number] = temperature > 0.5 ? [36, 78, 44] : [54, 82, 54];
  let color: [number, number, number] = [mix(dry[0], forest[0], green), mix(dry[1], forest[1], green), mix(dry[2], forest[2], green)];
  color = [mix(color[0], 108, cool * 0.5), mix(color[1], 115, cool * 0.5), mix(color[2], 92, cool * 0.5)];
  const rock = smoothstep((elevation - 0.43) / 0.28);
  color = [mix(color[0], 122, rock), mix(color[1], 118, rock), mix(color[2], 104, rock)];
  const snow = smoothstep((elevation - mix(0.76, 0.48, cool)) / 0.11) * smoothstep((0.4 - temperature) / 0.3);
  return [mix(color[0], 208, snow), mix(color[1], 213, snow), mix(color[2], 207, snow)];
}

function renderWorld(
  heightMap: Float32Array,
  riverMask: Uint8Array,
  settings: WorldSettings,
  seed: number,
) {
  const { width, height } = settings;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let landPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    const latitude = Math.abs(ny - 0.5) * 2;
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const index = y * width + x;
      const elevation = heightMap[index];
      const temperature = clamp(1 - latitude * 0.88 - Math.max(0, elevation) * 0.62 + (fbm(nx * 3.1, ny * 3.1, seed + 401, 3) - 0.5) * 0.1);
      const moisture = clamp(fbm(nx * 5.4 + 19, ny * 5.4 - 13, seed + 433, 5) * 0.78 + (settings.moisture - 50) / 95 + (1 - latitude) * 0.08);
      const shade = hillshade(heightMap, width, height, x, y);
      let color: [number, number, number];

      if (settings.style === "ink") {
        if (elevation <= 0) {
          const depth = clamp(-elevation * 2.1);
          const contour = Math.abs(((-elevation * 30) % 1) - 0.5) < 0.04 ? 17 : 0;
          color = [82 - depth * 22 + contour, 116 - depth * 25 + contour, 119 - depth * 22 + contour];
        } else {
          landPixels += 1;
          const contour = Math.abs(((elevation * 15) % 1) - 0.5) < 0.05 ? -25 : 0;
          const tint = moisture > 0.58 ? [177, 174, 126] : moisture < 0.34 ? [205, 179, 126] : [194, 184, 139];
          color = [tint[0] * shade + contour, tint[1] * shade + contour, tint[2] * shade + contour];
          if (elevation < 0.01) color = [72, 70, 56];
        }
      } else if (elevation <= 0) {
        const depth = clamp(-elevation * 2.2);
        const shelf = Math.exp(-Math.abs(elevation) * 22);
        const texture = fbm(nx * 20, ny * 20, seed + 461, 3) - 0.5;
        color = [mix(6, 19, shelf) + texture * 5, mix(26, 68, shelf) + texture * 8, mix(43, 82, shelf) + texture * 10];
        color = [color[0] * mix(0.76, 1, 1 - depth), color[1] * mix(0.68, 1, 1 - depth), color[2] * mix(0.76, 1, 1 - depth)];
      } else {
        landPixels += 1;
        color = elevation < 0.014 ? [177, 163, 111] : satelliteLandColor(elevation, temperature, moisture);
        const texture = (fbm(nx * 32 + 5, ny * 32 - 4, seed + 487, 3) - 0.5) * (moisture > 0.45 ? 13 : 8);
        color = [color[0] * shade + texture, color[1] * shade + texture, color[2] * shade + texture * 0.72];
      }

      if (riverMask[index] && elevation > 0.004) {
        const riverBlend = riverMask[index] / 255;
        const riverColor = settings.style === "ink" ? [45, 83, 89] : [18, 72, 91];
        color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
      }
      const grain = (hash(x, y, seed + 509) - 0.5) * (settings.style === "ink" ? 8 : 4.5);
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

export function generateWorld(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldResult {
  const started = performance.now();
  const seed = seedToInt(settings.seed || "ATLAS");
  onProgress?.("Sampling the planetary mesh", 10);
  const mesh = buildGraphMesh(seed, settings.width, settings.height);
  onProgress?.("Solving plate and crust regions", 28);
  const terrain = createGraphTerrain(mesh, seed, settings);
  onProgress?.("Conditioning graph drainage", 55);
  const routing = routeGraphRivers(mesh, terrain, settings, seed);
  onProgress?.("Interpolating Delaunay relief", 72);
  const heightMap = rasterizeTriangles(mesh, terrain.elevation, settings.width, settings.height);
  const riverMask = drawRiverMask(mesh, routing, settings.width, settings.height);
  onProgress?.("Composing the satellite survey", 88);
  const rendered = renderWorld(heightMap, riverMask, settings, seed);
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
      coastlineIndex: Math.round(terrain.coastlineIndex * 10) / 10,
      frameClearance: Math.round(terrain.frameClearance * 1000) / 10,
      generationMs: Math.round(performance.now() - started),
    },
  };
}
