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
  generationMs: number;
}

export interface WorldResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stats: WorldStats;
}

type Point = { x: number; y: number };
type CrustNode = Point & { growth: number };
type RangeArc = { points: Point[]; width: number; strength: number };
type CoastBite = Point & { rx: number; ry: number; angle: number };
type ContinentPlan = { spine: Point[]; crustArcs: CrustNode[][]; ranges: RangeArc[]; bites: CoastBite[] };
type Plate = Point & { vx: number; vy: number; oceanic: boolean };
type CoastModel = {
  width: number;
  height: number;
  signedDistance: Float32Array;
  continents: ContinentPlan[];
  coastlineIndex: number;
};

const TAU = Math.PI * 2;
const NEIGHBORS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(t: number) {
  const value = clamp(t);
  return value * value * (3 - 2 * value);
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

function pointSegmentDistance(px: number, py: number, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / lengthSquared);
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

class MinHeap {
  private values: { index: number; priority: number; owner?: number }[] = [];

  push(item: { index: number; priority: number; owner?: number }) {
    this.values.push(item);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.values[parent].priority <= item.priority) break;
      this.values[child] = this.values[parent];
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
        const child = right < this.values.length && this.values[right].priority < this.values[left].priority ? right : left;
        if (this.values[child].priority >= tail.priority) break;
        this.values[parent] = this.values[child];
        parent = child;
      }
      this.values[parent] = tail;
    }
    return root;
  }

  get size() { return this.values.length; }
}

function createContinentPlans(random: () => number) {
  const count = 3 + Math.floor(random() * 2);
  const anchors: Point[] = [];
  const continents: ContinentPlan[] = [];

  for (let continentIndex = 0; continentIndex < count; continentIndex += 1) {
    let anchor = { x: 0.18 + random() * 0.64, y: 0.18 + random() * 0.64 };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const candidate = { x: 0.13 + random() * 0.74, y: 0.15 + random() * 0.7 };
      if (anchors.every((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) > 0.24)) {
        anchor = candidate;
        break;
      }
    }
    anchors.push(anchor);

    const nodeCount = 4 + Math.floor(random() * 3);
    const axis = random() * TAU;
    const step = 0.048 + random() * 0.018;
    const mainArc: CrustNode[] = [];
    let heading = axis + (random() - 0.5) * 0.42;
    let point: CrustNode = {
      x: clamp(anchor.x - Math.cos(axis) * step * nodeCount * 0.44, 0.08, 0.92),
      y: clamp(anchor.y - Math.sin(axis) * step * nodeCount * 0.44, 0.1, 0.9),
      growth: 0.48 + random() * 0.42,
    };
    mainArc.push(point);
    for (let node = 1; node < nodeCount; node += 1) {
      const targetHeading = axis + Math.sin((node / (nodeCount - 1)) * Math.PI) * (random() - 0.5) * 0.92;
      heading = mix(heading, targetHeading, 0.48) + (random() - 0.5) * 0.34;
      point = {
        x: clamp(point.x + Math.cos(heading) * step * (0.78 + random() * 0.48), 0.07, 0.93),
        y: clamp(point.y + Math.sin(heading) * step * (0.88 + random() * 0.52), 0.09, 0.91),
        growth: clamp(0.26 + random() * 0.82),
      };
      mainArc.push(point);
    }

    const crustArcs: CrustNode[][] = [mainArc];
    const branchCount = 1 + (random() > 0.54 ? 1 : 0);
    for (let branch = 0; branch < branchCount; branch += 1) {
      const sourceIndex = 1 + Math.floor(random() * Math.max(1, mainArc.length - 2));
      const source = mainArc[Math.min(mainArc.length - 1, sourceIndex)];
      const branchHeading = axis + (random() > 0.5 ? 1 : -1) * (0.78 + random() * 0.62);
      const branchLength = 2 + (random() > 0.58 ? 1 : 0);
      const branchArc: CrustNode[] = [{ ...source, growth: Math.max(0.5, source.growth) }];
      let branchPoint = source;
      for (let branchNode = 1; branchNode <= branchLength; branchNode += 1) {
        const bend = (branchNode / branchLength) * (random() - 0.5) * 0.72;
        branchPoint = {
          x: clamp(branchPoint.x + Math.cos(branchHeading + bend) * step * (0.72 + random() * 0.38), 0.07, 0.93),
          y: clamp(branchPoint.y + Math.sin(branchHeading + bend) * step * (0.8 + random() * 0.42), 0.09, 0.91),
          growth: clamp(0.76 - branchNode * 0.18 + random() * 0.22, 0.2, 0.86),
        };
        branchArc.push(branchPoint);
      }
      crustArcs.push(branchArc);
    }

    const spine: Point[] = mainArc.map(({ x, y }) => ({ x, y }));

    const ranges: RangeArc[] = [];
    const normal = axis + Math.PI / 2;
    const offset = (random() > 0.5 ? 1 : -1) * (0.014 + random() * 0.027);
    const mainRange = spine.slice(1, -1).map((spinePoint, index, points) => ({
      x: clamp(spinePoint.x + Math.cos(normal) * offset * Math.sin(((index + 1) / (points.length + 1)) * Math.PI), 0.04, 0.96),
      y: clamp(spinePoint.y + Math.sin(normal) * offset * Math.sin(((index + 1) / (points.length + 1)) * Math.PI), 0.04, 0.96),
    }));
    if (mainRange.length >= 2) ranges.push({ points: mainRange, width: 0.013 + random() * 0.009, strength: 0.82 + random() * 0.36 });

    for (let arcIndex = 1; arcIndex < crustArcs.length; arcIndex += 1) {
      const branch = crustArcs[arcIndex];
      if (branch.length >= 3 && random() > 0.35) {
        ranges.push({
          points: branch.map(({ x, y }) => ({ x, y })),
          width: 0.01 + random() * 0.007,
          strength: 0.5 + random() * 0.32,
        });
      }
    }

    if (spine.length > 5 && random() > 0.42) {
      const center = spine[Math.floor(spine.length / 2)];
      const branchAngle = axis + (random() > 0.5 ? 1 : -1) * (0.7 + random() * 0.45);
      ranges.push({
        points: [
          center,
          { x: clamp(center.x + Math.cos(branchAngle) * 0.055, 0.04, 0.96), y: clamp(center.y + Math.sin(branchAngle) * 0.065, 0.04, 0.96) },
          { x: clamp(center.x + Math.cos(branchAngle + 0.24) * 0.12, 0.04, 0.96), y: clamp(center.y + Math.sin(branchAngle + 0.24) * 0.13, 0.04, 0.96) },
        ],
        width: 0.014 + random() * 0.009,
        strength: 0.48 + random() * 0.28,
      });
    }
    const bites: CoastBite[] = [];
    const biteCount = 2 + (random() > 0.56 ? 1 : 0);
    for (let bite = 0; bite < biteCount; bite += 1) {
      const source = spine[1 + Math.floor(random() * Math.max(1, spine.length - 2))];
      const side = random() > 0.5 ? 1 : -1;
      const biteAngle = normal + (side < 0 ? Math.PI : 0) + (random() - 0.5) * 0.54;
      bites.push({
        x: source.x + Math.cos(biteAngle) * (0.092 + random() * 0.035),
        y: source.y + Math.sin(biteAngle) * (0.092 + random() * 0.035),
        rx: 0.043 + random() * 0.032,
        ry: 0.022 + random() * 0.024,
        angle: biteAngle + Math.PI / 2 + (random() - 0.5) * 0.4,
      });
    }
    continents.push({ spine, crustArcs, ranges, bites });
  }
  return continents;
}

function chamferDistance(mask: Uint8Array, target: number, width: number, height: number) {
  const distance = new Float32Array(mask.length);
  distance.fill(1e6);
  for (let index = 0; index < mask.length; index += 1) if (mask[index] === target) distance[index] = 0;
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + 1);
      if (y > 0) value = Math.min(value, distance[index - width] + 1);
      if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + diagonal);
      if (x + 1 < width && y > 0) value = Math.min(value, distance[index - width + 1] + diagonal);
      distance[index] = value;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let value = distance[index];
      if (x + 1 < width) value = Math.min(value, distance[index + 1] + 1);
      if (y + 1 < height) value = Math.min(value, distance[index + width] + 1);
      if (x + 1 < width && y + 1 < height) value = Math.min(value, distance[index + width + 1] + diagonal);
      if (x > 0 && y + 1 < height) value = Math.min(value, distance[index + width - 1] + diagonal);
      distance[index] = value;
    }
  }
  return distance;
}

function measureMask(mask: Uint8Array, width: number, height: number, targetCoverage: number, detail: number) {
  let area = 0;
  let perimeter = 0;
  let edgeContacts = 0;
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let components = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      area += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeContacts += 1;
      if (x === 0 || !mask[index - 1]) perimeter += 1;
      if (x === width - 1 || !mask[index + 1]) perimeter += 1;
      if (y === 0 || !mask[index - width]) perimeter += 1;
      if (y === height - 1 || !mask[index + width]) perimeter += 1;
      if (visited[index]) continue;
      components += 1;
      let head = 0;
      let tail = 0;
      queue[tail++] = index;
      visited[index] = 1;
      while (head < tail) {
        const current = queue[head++];
        const cx = current % width;
        const cy = Math.floor(current / width);
        for (const [dx, dy] of NEIGHBORS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
  }

  const coverage = area / mask.length;
  const coastlineIndex = area ? perimeter / Math.sqrt(area) : 0;
  const desiredIndex = mix(8.8, 12.8, detail / 100);
  const score = 18
    - Math.abs(coverage - targetCoverage) * 72
    - Math.abs(coastlineIndex - desiredIndex) * 0.75
    - Math.abs(components - 4) * 1.2
    - edgeContacts * 0.08;
  return { score, coastlineIndex };
}

function buildCoastCandidate(seed: number, attempt: number, size: number, detail: number, aspect: number): CoastModel & { score: number } {
  const random = makeRandom(seed + Math.imul(attempt + 1, 0x9e3779b1));
  const width = 320;
  const height = Math.max(168, Math.round(width / aspect));
  const length = width * height;
  const continents = createContinentPlans(random);
  const traversalCost = new Float32Array(length);
  const bestCost = new Float32Array(length);
  const owner = new Int16Array(length).fill(-1);
  const heap = new MinHeap();
  bestCost.fill(Number.POSITIVE_INFINITY);

  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const warpX = (fbm(nx * 2.5 + 17, ny * 2.5, seed + attempt * 97 + 31, 3) - 0.5) * 0.12;
      const warpY = (fbm(nx * 2.5, ny * 2.5 - 11, seed + attempt * 97 + 53, 3) - 0.5) * 0.12;
      const fabric = fbm((nx + warpX) * 7.2, (ny + warpY) * 7.2, seed + attempt * 131 + 71, 4);
      const fracture = ridgedNoise(nx * 13.5 - 3, ny * 13.5 + 8, seed + attempt * 151 + 89);
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
      const edgePenalty = edge < 0.055 ? Math.pow((0.055 - edge) / 0.055, 2) * 9 : 0;
      traversalCost[y * width + x] = 0.63 + (1 - fabric) * 0.58 + Math.pow(fracture, 4) * 0.46 + edgePenalty;
    }
  }

  const gridScale = width / 196;
  const addSeed = (x: number, y: number, continentIndex: number, initialCost: number) => {
    const px = clamp(Math.round(x * (width - 1)), 1, width - 2);
    const py = clamp(Math.round(y * (height - 1)), 1, height - 2);
    const index = py * width + px;
    if (bestCost[index] > initialCost) {
      bestCost[index] = initialCost;
      owner[index] = continentIndex;
      heap.push({ index, priority: initialCost, owner: continentIndex });
    }
  };

  continents.forEach((continent, continentIndex) => {
    for (const arc of continent.crustArcs) {
      for (let segment = 1; segment < arc.length; segment += 1) {
        const a = arc[segment - 1];
        const b = arc[segment];
        const steps = Math.max(2, Math.ceil(Math.hypot((b.x - a.x) * width, (b.y - a.y) * height) * 1.35));
        for (let step = 0; step <= steps; step += 1) {
          const t = step / steps;
          const growth = mix(a.growth, b.growth, smoothstep(t));
          const lobeBias = -growth * mix(2.4, 5.8, size / 100) * gridScale;
          const neckBias = Math.sin(t * Math.PI) * mix(2.2, 5.1, 1 - Math.min(a.growth, b.growth)) * gridScale;
          addSeed(mix(a.x, b.x, t), mix(a.y, b.y, t), continentIndex, lobeBias + neckBias);
        }
      }
    }
  });

  const growthBudget = mix(7.3, 19.2, size / 100) * gridScale;
  while (heap.size) {
    const current = heap.pop()!;
    if (current.priority > bestCost[current.index] + 1e-6 || current.priority > growthBudget + 2) continue;
    const cx = current.index % width;
    const cy = Math.floor(current.index / width);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      const diagonal = dx && dy ? Math.SQRT2 : 1;
      const directionalGrain = 1 + Math.abs(dx * 0.42 + dy * 0.18) * (hash(nx, ny, seed + 197) - 0.5) * 0.3;
      const nextCost = current.priority + traversalCost[next] * diagonal * directionalGrain;
      if (nextCost < bestCost[next]) {
        bestCost[next] = nextCost;
        owner[next] = current.owner ?? -1;
        heap.push({ index: next, priority: nextCost, owner: current.owner });
      }
    }
  }

  const mask = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    if (bestCost[index] <= growthBudget && owner[index] >= 0) mask[index] = 1;
  }

  // Subtractive coastal ellipses create broad gulfs and scalloped bays.
  for (const continent of continents) {
    for (const bite of continent.bites) {
      const cosine = Math.cos(bite.angle);
      const sine = Math.sin(bite.angle);
      for (let y = 0; y < height; y += 1) {
        const ny = y / Math.max(1, height - 1);
        for (let x = 0; x < width; x += 1) {
          const index = y * width + x;
          if (!mask[index]) continue;
          const nx = x / Math.max(1, width - 1);
          const dx = nx - bite.x;
          const dy = ny - bite.y;
          const bx = dx * cosine + dy * sine;
          const by = -dx * sine + dy * cosine;
          if ((bx * bx) / (bite.rx * bite.rx) + (by * by) / (bite.ry * bite.ry) < 1) mask[index] = 0;
        }
      }
    }
  }

  const targetCoverage = mix(0.14, 0.45, size / 100);
  const measured = measureMask(mask, width, height, targetCoverage, detail);
  const distanceToWater = chamferDistance(mask, 0, width, height);
  const distanceToLand = chamferDistance(mask, 1, width, height);
  let signedDistance = new Float32Array(length);
  for (let index = 0; index < length; index += 1) signedDistance[index] = mask[index] ? distanceToWater[index] : -distanceToLand[index];
  for (let pass = 0; pass < 2; pass += 1) {
    const smoothed = signedDistance.slice();
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        smoothed[index] = (signedDistance[index] * 4 + signedDistance[index - 1] + signedDistance[index + 1] + signedDistance[index - width] + signedDistance[index + width]) / 8;
      }
    }
    signedDistance = smoothed;
  }

  return { width, height, signedDistance, continents, coastlineIndex: measured.coastlineIndex, score: measured.score };
}

function createCoastModel(seed: number, size: number, detail: number, aspect: number) {
  let best = buildCoastCandidate(seed, 0, size, detail, aspect);
  for (let attempt = 1; attempt < 3; attempt += 1) {
    const candidate = buildCoastCandidate(seed, attempt, size, detail, aspect);
    if (candidate.score > best.score) best = candidate;
  }
  return best;
}

function sampleGrid(field: Float32Array, width: number, height: number, x: number, y: number) {
  const px = clamp(x) * (width - 1);
  const py = clamp(y) * (height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = smoothstep(px - x0);
  const fy = smoothstep(py - y0);
  return mix(mix(field[y0 * width + x0], field[y0 * width + x1], fx), mix(field[y1 * width + x0], field[y1 * width + x1], fx), fy);
}

function coastField(x: number, y: number, model: CoastModel, detail: number, seed: number) {
  const warpStrength = mix(0.003, 0.018, detail / 100);
  const warpedX = x + (fbm(x * 2.8 + 29, y * 2.8, seed + 193, 3) - 0.5) * warpStrength * 2;
  const warpedY = y + (fbm(x * 2.8, y * 2.8 - 29, seed + 199, 3) - 0.5) * warpStrength * 2;
  const base = sampleGrid(model.signedDistance, model.width, model.height, warpedX, warpedY);
  const macro = fbm(x * 5.4 + 13, y * 5.4 - 9, seed + 211, 4) - 0.5;
  const coves = fbm(x * 18.5 - 5, y * 18.5 + 7, seed + 239, 3) - 0.5;
  const grain = ridgedNoise(x * 31, y * 31, seed + 251) - 0.5;
  const amplitude = mix(1.15, 4.2, detail / 100) * (model.width / 196);
  const coastalEnvelope = Math.exp(-Math.abs(base) * 0.24);
  return base + (macro * amplitude + coves * amplitude * 0.62 + grain * amplitude * 0.24) * coastalEnvelope;
}

function createPlates(random: () => number, count: number) {
  const plates: Plate[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = random() * TAU;
    const speed = 0.25 + random() * 0.75;
    plates.push({
      x: random(),
      y: random(),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      oceanic: random() > 0.46,
    });
  }
  return plates;
}

function plateUplift(x: number, y: number, plates: Plate[], amount: number, seed: number) {
  const warpX = (fbm(x * 2.1 + 17, y * 2.1, seed + 281, 3) - 0.5) * 0.13;
  const warpY = (fbm(x * 2.1, y * 2.1 + 17, seed + 307, 3) - 0.5) * 0.13;
  const px = x + warpX;
  const py = y + warpY;
  let first = 0;
  let second = 1;
  let firstDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < plates.length; index += 1) {
    const dx = px - plates[index].x;
    const dy = py - plates[index].y;
    const distance = dx * dx + dy * dy;
    if (distance < firstDistance) {
      secondDistance = firstDistance;
      second = first;
      firstDistance = distance;
      first = index;
    } else if (distance < secondDistance) {
      secondDistance = distance;
      second = index;
    }
  }
  const a = plates[first];
  const b = plates[second];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = (b.x - a.x) / length;
  const ny = (b.y - a.y) / length;
  const convergence = Math.max(0, (a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
  const boundary = Math.exp(-Math.abs(Math.sqrt(secondDistance) - Math.sqrt(firstDistance)) * 62);
  const ridge = ridgedNoise(x * 16, y * 16, seed + 331);
  const continentalCollision = a.oceanic === b.oceanic ? 0.76 : 1.08;
  return boundary * convergence * ridge * continentalCollision * amount;
}

function rangeUplift(x: number, y: number, continents: ContinentPlan[], amount: number, seed: number) {
  const warpX = (fbm(x * 8.5 + 4, y * 8.5, seed + 353, 3) - 0.5) * 0.028;
  const warpY = (fbm(x * 8.5, y * 8.5 - 4, seed + 379, 3) - 0.5) * 0.028;
  let strongest = 0;
  for (const continent of continents) {
    for (const range of continent.ranges) {
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 1; index < range.points.length; index += 1) {
        distance = Math.min(distance, pointSegmentDistance(x + warpX, y + warpY, range.points[index - 1], range.points[index]));
      }
      const profile = Math.exp(-Math.pow(distance / range.width, 1.38) * 1.7);
      strongest = Math.max(strongest, profile * range.strength);
    }
  }
  const ridgeTexture = mix(0.46, 1, ridgedNoise(x * 27, y * 27, seed + 401));
  const peakBreakup = mix(0.72, 1.08, fbm(x * 43, y * 43, seed + 419, 3));
  return strongest * ridgeTexture * peakBreakup * amount;
}

function thermalErode(heightMap: Float32Array, width: number, height: number, iterations: number) {
  const delta = new Float32Array(heightMap.length);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    delta.fill(0);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const elevation = heightMap[index];
        if (elevation <= 0.006) continue;
        let lowest = index;
        let lowestHeight = elevation;
        for (const [dx, dy] of NEIGHBORS) {
          const next = (y + dy) * width + x + dx;
          const nextHeight = heightMap[next];
          if (nextHeight > 0.004 && nextHeight < lowestHeight) {
            lowest = next;
            lowestHeight = nextHeight;
          }
        }
        const difference = elevation - lowestHeight;
        const talus = 0.018;
        if (lowest !== index && difference > talus) {
          const transfer = (difference - talus) * 0.16;
          delta[index] -= transfer;
          delta[lowest] += transfer;
        }
      }
    }
    for (let index = 0; index < heightMap.length; index += 1) {
      if (heightMap[index] > 0) heightMap[index] = Math.max(0.002, heightMap[index] + delta[index]);
    }
  }
}

function createClimate(heightMap: Float32Array, width: number, height: number, moistureSetting: number, seed: number) {
  const moistureMap = new Float32Array(heightMap.length);
  const temperatureMap = new Float32Array(heightMap.length);
  const globalWetness = (moistureSetting - 50) / 115;
  const eastward = (seed & 1) === 0;

  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    const latitude = Math.abs(ny - 0.5) * 2;
    let humidity = clamp(0.62 + globalWetness + (hash(y, seed & 1023, seed + 431) - 0.5) * 0.18);
    let previousElevation = 0;
    for (let step = 0; step < width; step += 1) {
      const x = eastward ? step : width - 1 - step;
      const nx = x / Math.max(1, width - 1);
      const index = y * width + x;
      const elevation = heightMap[index];
      temperatureMap[index] = clamp(1 - latitude * 0.9 - Math.max(0, elevation) * 0.64 + (fbm(nx * 3.2, ny * 3.2, seed + 449, 3) - 0.5) * 0.12);
      if (elevation <= 0) {
        humidity = Math.max(humidity, 0.78 - latitude * 0.08);
        moistureMap[index] = 1;
        previousElevation = 0;
        continue;
      }
      const rise = Math.max(0, elevation - previousElevation);
      const orographicRain = humidity * clamp(0.12 + rise * 4.8, 0.12, 0.88);
      const convection = (0.035 + (1 - latitude) * 0.055) * humidity;
      const wetTexture = fbm(nx * 6.2 + 20, ny * 6.2 - 8, seed + 467, 4);
      moistureMap[index] = clamp(orographicRain * 1.55 + convection + wetTexture * 0.31 + globalWetness);
      humidity = clamp(humidity - orographicRain * 0.32 - Math.max(0, previousElevation - elevation) * 0.08 + 0.008);
      previousElevation = elevation;
    }
  }
  return { moistureMap, temperatureMap };
}

function routeRivers(heightMap: Float32Array, moistureMap: Float32Array, width: number, height: number, moisture: number) {
  const stride = 3;
  const hydroWidth = Math.ceil(width / stride);
  const hydroHeight = Math.ceil(height / stride);
  const length = hydroWidth * hydroHeight;
  const terrain = new Float32Array(length);
  const filled = new Float32Array(length);
  const receiver = new Int32Array(length).fill(-1);
  const visited = new Uint8Array(length);
  const accumulation = new Float32Array(length);
  const heap = new MinHeap();

  for (let y = 0; y < hydroHeight; y += 1) {
    for (let x = 0; x < hydroWidth; x += 1) {
      const index = y * hydroWidth + x;
      const sourceX = Math.min(width - 1, x * stride + 2);
      const sourceY = Math.min(height - 1, y * stride + 2);
      const sourceIndex = sourceY * width + sourceX;
      terrain[index] = heightMap[sourceIndex];
      filled[index] = terrain[index];
      accumulation[index] = terrain[index] > 0 ? 0.38 + moistureMap[sourceIndex] * 1.42 : 0;
      if (terrain[index] <= 0 || x === 0 || y === 0 || x === hydroWidth - 1 || y === hydroHeight - 1) {
        visited[index] = 1;
        heap.push({ index, priority: terrain[index] });
      }
    }
  }

  while (heap.size) {
    const current = heap.pop()!;
    const cx = current.index % hydroWidth;
    const cy = Math.floor(current.index / hydroWidth);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= hydroWidth || ny >= hydroHeight) continue;
      const next = ny * hydroWidth + nx;
      if (visited[next]) continue;
      visited[next] = 1;
      receiver[next] = current.index;
      filled[next] = Math.max(terrain[next], current.priority + 0.00001);
      heap.push({ index: next, priority: filled[next] });
    }
  }

  const land = Array.from({ length }, (_, index) => index)
    .filter((index) => terrain[index] > 0)
    .sort((a, b) => filled[b] - filled[a]);
  for (const index of land) {
    const target = receiver[index];
    if (target >= 0) accumulation[target] += accumulation[index];
  }

  const mask = new Uint8Array(width * height);
  let riverCount = 0;
  const threshold = mix(158, 68, moisture / 100);
  const cellPoint = (x: number, y: number) => ({
    x: x * stride + stride / 2 + (hash(x, y, 701) - 0.5) * stride * 0.72,
    y: y * stride + stride / 2 + (hash(x, y, 733) - 0.5) * stride * 0.72,
  });
  const drawLine = (x0: number, y0: number, x1: number, y1: number, strength: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const radius = strength > 820 ? 2 : strength > 290 ? 1 : 0;
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(mix(x0, x1, step / steps));
      const y = Math.round(mix(y0, y1, step / steps));
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < width && py < height) {
            const value = Math.min(218, 42 + Math.log2(strength) * 14);
            mask[py * width + px] = Math.max(mask[py * width + px], value);
          }
        }
      }
    }
  };

  for (const index of land) {
    const target = receiver[index];
    if (target < 0 || accumulation[index] < threshold || terrain[index] < 0.012) continue;
    const x = index % hydroWidth;
    const y = Math.floor(index / hydroWidth);
    const tx = target % hydroWidth;
    const ty = Math.floor(target / hydroWidth);
    const sourcePoint = cellPoint(x, y);
    const targetPoint = cellPoint(tx, ty);
    drawLine(sourcePoint.x, sourcePoint.y, targetPoint.x, targetPoint.y, accumulation[index]);
    if (accumulation[index] < threshold * 1.28) riverCount += 1;
  }
  return { mask, riverCount: Math.max(0, Math.round(riverCount / 2.25)) };
}

function carveRiverValleys(heightMap: Float32Array, riverMask: Uint8Array, width: number, height: number) {
  const original = heightMap.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!riverMask[index] || original[index] <= 0.006) continue;
      const depth = (riverMask[index] / 255) * 0.026;
      for (let oy = -2; oy <= 2; oy += 1) {
        for (let ox = -2; ox <= 2; ox += 1) {
          const distance = Math.hypot(ox, oy);
          if (distance > 2.25) continue;
          const target = (y + oy) * width + x + ox;
          if (original[target] > 0) heightMap[target] = Math.max(0.002, heightMap[target] - depth * (1 - distance / 2.5));
        }
      }
    }
  }
}

function chooseWorldName(random: () => number) {
  const first = ["Verdant", "Aurelian", "Sable", "Stormward", "Elder", "Thorn", "Ivory", "Cerulean", "Ashen", "Ember"];
  const second = ["Reach", "Expanse", "Marches", "Wilds", "Dominion", "Coast", "Crown", "Basin", "Isles", "Meridian"];
  return `The ${first[Math.floor(random() * first.length)]} ${second[Math.floor(random() * second.length)]}`;
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
  const nx = -dzdx * 27;
  const ny = -dzdy * 27;
  const nz = 1;
  const normalLength = Math.hypot(nx, ny, nz);
  const light = (nx * -0.48 + ny * -0.42 + nz * 0.77) / normalLength;
  const slope = Math.hypot(dzdx, dzdy) * 8;
  return clamp(0.52 + light * 0.62 - slope * 0.22, 0.3, 1.34);
}

function satelliteLandColor(elevation: number, temperature: number, moisture: number): [number, number, number] {
  const green = smoothstep((moisture - 0.27) / 0.48);
  const cool = smoothstep((0.42 - temperature) / 0.38);
  const dry: [number, number, number] = temperature > 0.58 ? [164, 139, 86] : [132, 122, 88];
  const forest: [number, number, number] = temperature > 0.5 ? [37, 79, 45] : [55, 82, 53];
  let color: [number, number, number] = [
    mix(dry[0], forest[0], green),
    mix(dry[1], forest[1], green),
    mix(dry[2], forest[2], green),
  ];
  color = [mix(color[0], 108, cool * 0.55), mix(color[1], 115, cool * 0.55), mix(color[2], 91, cool * 0.55)];
  const rock = smoothstep((elevation - 0.42) / 0.3);
  color = [mix(color[0], 122, rock), mix(color[1], 118, rock), mix(color[2], 104, rock)];
  const snow = smoothstep((elevation - mix(0.72, 0.45, cool)) / 0.11) * smoothstep((0.38 - temperature) / 0.28);
  return [mix(color[0], 207, snow), mix(color[1], 212, snow), mix(color[2], 205, snow)];
}

export function generateWorld(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldResult {
  const started = performance.now();
  const { width, height } = settings;
  const seed = seedToInt(settings.seed || "ATLAS");
  const random = makeRandom(seed);
  const plateCount = 10 + Math.floor(random() * 5);
  onProgress?.("Selecting continental structure", 9);
  const coastModel = createCoastModel(seed, settings.continentSize, settings.coastDetail, width / height);
  const plates = createPlates(random, plateCount);
  const heightMap = new Float32Array(width * height);
  onProgress?.("Growing fractured continental crust", 27);

  let landPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const coast = coastField(nx, ny, coastModel, settings.coastDetail, seed);
      let elevation: number;
      if (coast > 0) {
        const inlandness = clamp(coast / (coastModel.width * 0.092));
        const hills = (fbm(nx * 9.5 + 3, ny * 9.5 - 2, seed + 487, 5) - 0.5) * (0.058 + inlandness * 0.1);
        const rollingRelief = Math.max(0, ridgedNoise(nx * 15, ny * 15, seed + 509) - 0.61) * 0.078;
        const fineRelief = (ridgedNoise(nx * 38, ny * 38, seed + 523) - 0.56) * 0.018 * inlandness;
        elevation = 0.008 + Math.pow(inlandness, 0.72) * 0.31 + hills + rollingRelief + fineRelief;
        const tectonicAmount = mix(0.16, 0.62, settings.tectonics / 100);
        elevation += plateUplift(nx, ny, plates, tectonicAmount, seed) * 0.2;
        elevation += rangeUplift(nx, ny, coastModel.continents, tectonicAmount, seed) * 0.94;
        elevation = Math.max(0.002, elevation);
        landPixels += 1;
      } else {
        const depth = clamp(-coast / (coastModel.width * 0.112));
        const abyssTexture = (fbm(nx * 5.6, ny * 5.6, seed + 541, 3) - 0.5) * 0.055 * depth;
        elevation = -0.012 - Math.pow(depth, 0.72) * 0.56 + abyssTexture;
      }
      heightMap[y * width + x] = elevation;
    }
  }

  onProgress?.("Weathering mountain belts", 47);
  thermalErode(heightMap, width, height, 2);
  const climate = createClimate(heightMap, width, height, settings.moisture, seed);
  onProgress?.("Filling basins and routing watersheds", 63);
  const rivers = routeRivers(heightMap, climate.moistureMap, width, height, settings.moisture);
  carveRiverValleys(heightMap, rivers.mask, width, height);
  onProgress?.("Composing relief and biomes", 82);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const elevation = heightMap[index];
      const shade = hillshade(heightMap, width, height, x, y);
      const moisture = climate.moistureMap[index];
      const temperature = climate.temperatureMap[index];
      let color: [number, number, number];

      if (settings.style === "ink") {
        if (elevation <= 0) {
          const depth = clamp(-elevation * 2.2);
          const contour = Math.abs(((-elevation * 30) % 1) - 0.5) < 0.04 ? 17 : 0;
          color = [82 - depth * 22 + contour, 116 - depth * 25 + contour, 119 - depth * 22 + contour];
        } else {
          const contour = Math.abs(((elevation * 15) % 1) - 0.5) < 0.05 ? -25 : 0;
          const tint = moisture > 0.58 ? [177, 174, 126] : moisture < 0.34 ? [205, 179, 126] : [194, 184, 139];
          color = [tint[0] * shade + contour, tint[1] * shade + contour, tint[2] * shade + contour];
          if (elevation < 0.009) color = [72, 70, 56];
        }
      } else if (elevation <= 0) {
        const depth = clamp(-elevation * 2.25);
        const shelf = Math.exp(-Math.abs(elevation) * 20);
        const texture = fbm(x / width * 20, y / height * 20, seed + 587, 3) - 0.5;
        color = [mix(6, 20, shelf) + texture * 5, mix(26, 69, shelf) + texture * 8, mix(43, 82, shelf) + texture * 10];
        color = [color[0] * mix(0.76, 1, 1 - depth), color[1] * mix(0.68, 1, 1 - depth), color[2] * mix(0.76, 1, 1 - depth)];
      } else {
        color = elevation < 0.014 ? [177, 163, 111] : satelliteLandColor(elevation, temperature, moisture);
        const vegetationTexture = (fbm(x / width * 34 + 5, y / height * 34 - 4, seed + 601, 3) - 0.5) * (moisture > 0.45 ? 14 : 8);
        color = [color[0] * shade + vegetationTexture, color[1] * shade + vegetationTexture, color[2] * shade + vegetationTexture * 0.72];
      }

      if (rivers.mask[index] && elevation > 0.005) {
        const riverBlend = rivers.mask[index] / 255;
        const riverColor = settings.style === "ink" ? [45, 83, 89] : [19, 72, 91];
        color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
      }
      const grain = (hash(x, y, seed + 619) - 0.5) * (settings.style === "ink" ? 8 : 4.5);
      const target = index * 4;
      pixels[target] = clamp(color[0] + grain, 0, 255);
      pixels[target + 1] = clamp(color[1] + grain, 0, 255);
      pixels[target + 2] = clamp(color[2] + grain, 0, 255);
      pixels[target + 3] = 255;
    }
  }

  onProgress?.("Survey complete", 100);
  const landPercent = Math.round((landPixels / (width * height)) * 100);
  const survey = landPercent > 42 ? "Continental interior" : landPercent < 21 ? "Oceanic archipelago" : settings.moisture > 68 ? "Verdant continental shelf" : settings.moisture < 34 ? "Arid continental chain" : "Temperate broken continent";
  return {
    pixels,
    width,
    height,
    stats: {
      name: chooseWorldName(random),
      survey,
      landPercent,
      plateCount,
      riverCount: rivers.riverCount,
      coastlineIndex: Math.round(coastModel.coastlineIndex * 10) / 10,
      generationMs: Math.round(performance.now() - started),
    },
  };
}
