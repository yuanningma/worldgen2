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
  generationMs: number;
}

export interface WorldResult {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stats: WorldStats;
}

type Point = { x: number; y: number };
type CratonNode = Point & { rx: number; ry: number };
type Continent = { nodes: CratonNode[]; ranges: [Point, Point][] };
type Plate = Point & { vx: number; vy: number; oceanic: boolean };

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

function pointSegmentDistance(px: number, py: number, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / lengthSquared);
  return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
}

function createContinents(random: () => number, size: number) {
  const count = 4;
  const scale = mix(0.64, 1.48, size / 100);
  const continents: Continent[] = [];
  const anchors: Point[] = [];

  for (let c = 0; c < count; c += 1) {
    let anchor = { x: 0.2 + random() * 0.6, y: 0.2 + random() * 0.6 };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = { x: 0.12 + random() * 0.76, y: 0.16 + random() * 0.68 };
      if (anchors.every((other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) > 0.2)) {
        anchor = candidate;
        break;
      }
    }
    anchors.push(anchor);

    const nodeCount = 3 + Math.floor(random() * 3);
    const direction = random() * TAU;
    const nodes: CratonNode[] = [];
    for (let n = 0; n < nodeCount; n += 1) {
      const centered = n - (nodeCount - 1) / 2;
      const bend = Math.sin((n / Math.max(1, nodeCount - 1)) * Math.PI) * (random() - 0.5) * 0.12;
      const x = clamp(anchor.x + Math.cos(direction) * centered * 0.075 + Math.cos(direction + Math.PI / 2) * bend + (random() - 0.5) * 0.05, 0.07, 0.93);
      const y = clamp(anchor.y + Math.sin(direction) * centered * 0.09 + Math.sin(direction + Math.PI / 2) * bend + (random() - 0.5) * 0.05, 0.09, 0.91);
      nodes.push({
        x,
        y,
        rx: (0.09 + random() * 0.055) * scale,
        ry: (0.12 + random() * 0.07) * scale,
      });
    }

    if (random() > 0.28) {
      const source = nodes[Math.floor(random() * nodes.length)];
      const angle = direction + (random() > 0.5 ? 1 : -1) * (0.75 + random() * 0.55);
      nodes.push({
        x: clamp(source.x + Math.cos(angle) * (0.1 + random() * 0.08), 0.06, 0.94),
        y: clamp(source.y + Math.sin(angle) * (0.1 + random() * 0.08), 0.08, 0.92),
        rx: (0.055 + random() * 0.035) * scale,
        ry: (0.07 + random() * 0.04) * scale,
      });
    }

    const ranges: [Point, Point][] = [];
    if (nodes.length > 2) {
      const rangeOffset = (random() - 0.5) * 0.08;
      const normal = { x: Math.cos(direction + Math.PI / 2) * rangeOffset, y: Math.sin(direction + Math.PI / 2) * rangeOffset };
      ranges.push([
        { x: nodes[0].x + normal.x, y: nodes[0].y + normal.y },
        { x: nodes[Math.min(nodes.length - 1, nodeCount - 1)].x + normal.x, y: nodes[Math.min(nodes.length - 1, nodeCount - 1)].y + normal.y },
      ]);
    }
    continents.push({ nodes, ranges });
  }
  return continents;
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

function continentField(x: number, y: number, continents: Continent[]) {
  let strongest = -2;
  for (const continent of continents) {
    for (const node of continent.nodes) {
      const distance = Math.hypot((x - node.x) / node.rx, (y - node.y) / node.ry);
      strongest = Math.max(strongest, 1 - distance);
    }
    for (let index = 1; index < continent.nodes.length; index += 1) {
      const a = continent.nodes[index - 1];
      const b = continent.nodes[index];
      const width = Math.min(a.rx, b.rx) * 0.68;
      strongest = Math.max(strongest, 0.62 - pointSegmentDistance(x, y, a, b) / width);
    }
  }
  return strongest;
}

function plateUplift(x: number, y: number, plates: Plate[], amount: number, seed: number) {
  const warpX = (fbm(x * 2.1 + 17, y * 2.1, seed + 91, 3) - 0.5) * 0.13;
  const warpY = (fbm(x * 2.1, y * 2.1 + 17, seed + 137, 3) - 0.5) * 0.13;
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
  const ridge = ridgedNoise(x * 15, y * 15, seed + 263);
  return boundary * convergence * ridge * amount;
}

function rangeUplift(x: number, y: number, continents: Continent[], amount: number, seed: number) {
  let range = 0;
  for (const continent of continents) {
    for (const [a, b] of continent.ranges) {
      const distorted = pointSegmentDistance(
        x + (fbm(x * 8, y * 8, seed + 311, 3) - 0.5) * 0.035,
        y + (fbm(x * 8 + 9, y * 8, seed + 347, 3) - 0.5) * 0.035,
        a,
        b,
      );
      range = Math.max(range, Math.exp(-distorted * 55));
    }
  }
  return range * ridgedNoise(x * 23, y * 23, seed + 379) * amount;
}

class MinHeap {
  private values: { index: number; height: number }[] = [];

  push(item: { index: number; height: number }) {
    this.values.push(item);
    let child = this.values.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.values[parent].height <= item.height) break;
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
        const child = right < this.values.length && this.values[right].height < this.values[left].height ? right : left;
        if (this.values[child].height >= tail.height) break;
        this.values[parent] = this.values[child];
        parent = child;
      }
      this.values[parent] = tail;
    }
    return root;
  }

  get size() { return this.values.length; }
}

function routeRivers(heightMap: Float32Array, width: number, height: number, moisture: number) {
  const stride = 4;
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
      terrain[index] = heightMap[sourceY * width + sourceX];
      filled[index] = terrain[index];
      accumulation[index] = terrain[index] > 0 ? mix(0.65, 1.55, moisture / 100) : 0;
      if (terrain[index] <= 0 || x === 0 || y === 0 || x === hydroWidth - 1 || y === hydroHeight - 1) {
        visited[index] = 1;
        heap.push({ index, height: terrain[index] });
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
      filled[next] = Math.max(terrain[next], current.height + 0.00001);
      heap.push({ index: next, height: filled[next] });
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
  const threshold = mix(105, 46, moisture / 100);
  const drawLine = (x0: number, y0: number, x1: number, y1: number, strength: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    const radius = strength > 420 ? 2 : strength > 145 ? 1 : 0;
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(mix(x0, x1, step / steps));
      const y = Math.round(mix(y0, y1, step / steps));
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          const px = x + ox;
          const py = y + oy;
          if (px >= 0 && py >= 0 && px < width && py < height) mask[py * width + px] = Math.max(mask[py * width + px], Math.min(255, 85 + Math.log2(strength) * 18));
        }
      }
    }
  };

  for (const index of land) {
    const target = receiver[index];
    if (target < 0 || accumulation[index] < threshold || terrain[index] < 0.015) continue;
    const x = index % hydroWidth;
    const y = Math.floor(index / hydroWidth);
    const tx = target % hydroWidth;
    const ty = Math.floor(target / hydroWidth);
    drawLine(x * stride + 2, y * stride + 2, tx * stride + 2, ty * stride + 2, accumulation[index]);
    if (accumulation[index] < threshold * 1.3) riverCount += 1;
  }
  return { mask, riverCount: Math.max(0, Math.round(riverCount / 2.4)) };
}

function chooseWorldName(random: () => number) {
  const first = ["Verdant", "Aurelian", "Sable", "Stormward", "Elder", "Thorn", "Ivory", "Cerulean", "Ashen", "Ember"];
  const second = ["Reach", "Expanse", "Marches", "Wilds", "Dominion", "Coast", "Crown", "Basin", "Isles", "Meridian"];
  return `The ${first[Math.floor(random() * first.length)]} ${second[Math.floor(random() * second.length)]}`;
}

export function generateWorld(settings: WorldSettings, onProgress?: (stage: string, progress: number) => void): WorldResult {
  const started = performance.now();
  const { width, height } = settings;
  const seed = seedToInt(settings.seed || "ATLAS");
  const random = makeRandom(seed);
  const plateCount = 10 + Math.floor(random() * 5);
  const continents = createContinents(random, settings.continentSize);
  const plates = createPlates(random, plateCount);
  const heightMap = new Float32Array(width * height);
  const moistureMap = new Float32Array(width * height);
  const temperatureMap = new Float32Array(width * height);
  onProgress?.("Growing continental shelves", 18);

  let landPixels = 0;
  for (let y = 0; y < height; y += 1) {
    const ny = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const nx = x / Math.max(1, width - 1);
      const warpStrength = mix(0.055, 0.145, settings.coastDetail / 100);
      const wx = nx + (fbm(nx * 2.4 + 7, ny * 2.4, seed + 11, 4) - 0.5) * warpStrength;
      const wy = ny + (fbm(nx * 2.4, ny * 2.4 + 7, seed + 29, 4) - 0.5) * warpStrength;
      const macro = fbm(wx * 3.3, wy * 3.3, seed + 47, 5) - 0.5;
      const fine = fbm(wx * 13, wy * 13, seed + 73, 4) - 0.5;
      const coastNoise = macro * mix(0.42, 0.76, settings.coastDetail / 100) + fine * mix(0.05, 0.2, settings.coastDetail / 100);
      const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
      const edgeFade = clamp((edge - 0.018) / 0.08);
      let elevation = continentField(wx, wy, continents) + coastNoise - 0.105 + (edgeFade - 1) * 0.9;

      if (elevation > 0) {
        elevation = Math.pow(elevation, 0.82);
        const tectonicAmount = mix(0.16, 0.58, settings.tectonics / 100);
        elevation += plateUplift(nx, ny, plates, tectonicAmount, seed) * 0.36;
        elevation += rangeUplift(nx, ny, continents, tectonicAmount, seed) * 0.62;
        elevation += Math.max(0, ridgedNoise(nx * 11, ny * 11, seed + 401) - 0.72) * 0.12;
        landPixels += 1;
      } else {
        elevation = Math.max(-1, elevation * 0.72);
      }

      const index = y * width + x;
      heightMap[index] = elevation;
      const latitude = Math.abs(ny - 0.5) * 2;
      temperatureMap[index] = clamp(1 - latitude * 0.9 - Math.max(0, elevation) * 0.62 + (fbm(nx * 4, ny * 4, seed + 433, 3) - 0.5) * 0.14);
      const wetNoise = fbm(nx * 5.2 + 20, ny * 5.2 - 8, seed + 461, 5);
      const rainShadow = clamp(0.68 - Math.max(0, elevation) * 0.36 + (fbm(nx * 2 - 3, ny * 2, seed + 487, 3) - 0.5) * 0.28);
      moistureMap[index] = clamp(wetNoise * 0.62 + rainShadow * 0.38 + (settings.moisture - 50) / 100);
    }
  }

  onProgress?.("Routing watersheds", 56);
  const rivers = routeRivers(heightMap, width, height, settings.moisture);
  onProgress?.("Composing biomes", 78);
  const pixels = new Uint8ClampedArray(width * height * 4);
  const lightX = -0.58;
  const lightY = -0.52;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const elevation = heightMap[index];
      const left = heightMap[y * width + Math.max(0, x - 1)];
      const right = heightMap[y * width + Math.min(width - 1, x + 1)];
      const up = heightMap[Math.max(0, y - 1) * width + x];
      const down = heightMap[Math.min(height - 1, y + 1) * width + x];
      const slopeX = (right - left) * 5.2;
      const slopeY = (down - up) * 5.2;
      const shade = clamp(0.77 + (slopeX * lightX + slopeY * lightY) * 0.42, 0.38, 1.28);
      const moisture = moistureMap[index];
      const temperature = temperatureMap[index];
      let color: [number, number, number];

      if (settings.style === "ink") {
        if (elevation <= 0) {
          const depth = clamp(-elevation * 3.2);
          const contour = Math.abs(((-elevation * 34) % 1) - 0.5) < 0.045 ? 18 : 0;
          color = [82 - depth * 20 + contour, 116 - depth * 24 + contour, 119 - depth * 21 + contour];
        } else {
          const contour = Math.abs(((elevation * 15) % 1) - 0.5) < 0.055 ? -26 : 0;
          const tint = moisture > 0.58 ? [177, 174, 126] : moisture < 0.36 ? [205, 179, 126] : [194, 184, 139];
          color = [tint[0] * shade + contour, tint[1] * shade + contour, tint[2] * shade + contour];
          if (elevation < 0.012) color = [69, 67, 54];
        }
      } else if (elevation <= 0) {
        const depth = clamp(-elevation * 3.1);
        const shelf = Math.exp(-Math.abs(elevation) * 24);
        const texture = fbm(x / width * 22, y / height * 22, seed + 557, 3) - 0.5;
        color = [mix(6, 15, shelf) + texture * 5, mix(27, 66, shelf) + texture * 8, mix(42, 78, shelf) + texture * 10];
        color = [color[0] * mix(0.82, 1, 1 - depth), color[1] * mix(0.72, 1, 1 - depth), color[2] * mix(0.78, 1, 1 - depth)];
      } else if (elevation < 0.018) {
        color = [176, 163, 111];
      } else if (temperature < 0.12 || (elevation > 0.78 && temperature < 0.34)) {
        color = [205, 211, 203];
      } else if (elevation > 0.7) {
        color = [122, 119, 105];
      } else if (temperature > 0.63 && moisture < 0.32) {
        color = [170, 143, 86];
      } else if (moisture > 0.63) {
        color = temperature > 0.5 ? [39, 79, 46] : [51, 79, 52];
      } else if (moisture > 0.46) {
        color = [76, 105, 62];
      } else if (temperature < 0.3) {
        color = [112, 119, 94];
      } else {
        color = [128, 119, 76];
      }

      if (elevation > 0) color = [color[0] * shade, color[1] * shade, color[2] * shade];
      if (rivers.mask[index] && elevation > 0.007) {
        const riverBlend = rivers.mask[index] / 255;
        const riverColor = settings.style === "ink" ? [45, 83, 89] : [20, 75, 91];
        color = [mix(color[0], riverColor[0], riverBlend), mix(color[1], riverColor[1], riverBlend), mix(color[2], riverColor[2], riverBlend)];
      }
      const grain = (hash(x, y, seed + 613) - 0.5) * (settings.style === "ink" ? 9 : 5);
      const target = index * 4;
      pixels[target] = clamp(color[0] + grain, 0, 255);
      pixels[target + 1] = clamp(color[1] + grain, 0, 255);
      pixels[target + 2] = clamp(color[2] + grain, 0, 255);
      pixels[target + 3] = 255;
    }
  }

  onProgress?.("Survey complete", 100);
  const landPercent = Math.round((landPixels / (width * height)) * 100);
  const survey = landPercent > 40 ? "Continental interior" : landPercent < 23 ? "Oceanic archipelago" : settings.moisture > 68 ? "Verdant continental shelf" : settings.moisture < 34 ? "Arid continental chain" : "Temperate archipelago";
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
      generationMs: Math.round(performance.now() - started),
    },
  };
}
