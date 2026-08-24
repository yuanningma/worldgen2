import {
  cross3,
  dot3,
  normalize3,
  scale3,
  subtract3,
  type Vec3,
} from "./index.ts";
import type { TectonicWorldModel, WorldCellState } from "./worldSimulation.ts";

export interface TectonicAtlasOptions {
  width?: number;
  height?: number;
  title?: string;
  showBoundaries?: boolean;
  showGraticule?: boolean;
  reliefExaggeration?: number;
  projection?: "mollweide" | "equal-earth" | "equirectangular";
  /** Horizontal sampling resolution of the derived atlas raster. */
  rasterWidth?: number;
  /** Presentation-only interpolation; canonical land/sea remains unsmoothed. */
  smoothInterior?: boolean;
}

type Rgb = readonly [number, number, number];

const TAU = Math.PI * 2;
const LIGHT = normalize3([-0.38, -0.42, 0.82]);

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] as string);
}

type Projection = NonNullable<TectonicAtlasOptions["projection"]>;
type LonLat = readonly [longitude: number, latitude: number];

const EQUAL_EARTH_A1 = 1.340264;
const EQUAL_EARTH_A2 = -0.081106;
const EQUAL_EARTH_A3 = 0.000893;
const EQUAL_EARTH_A4 = 0.003796;
const EQUAL_EARTH_M = Math.sqrt(3) / 2;
const EQUAL_EARTH_X_MAX = 2 * Math.sqrt(3) * Math.PI / (3 * EQUAL_EARTH_A1);
const EQUAL_EARTH_THETA_MAX = Math.asin(EQUAL_EARTH_M);
const EQUAL_EARTH_Y_MAX = EQUAL_EARTH_THETA_MAX * (
  EQUAL_EARTH_A1
  + EQUAL_EARTH_A2 * EQUAL_EARTH_THETA_MAX ** 2
  + EQUAL_EARTH_A3 * EQUAL_EARTH_THETA_MAX ** 6
  + EQUAL_EARTH_A4 * EQUAL_EARTH_THETA_MAX ** 8
);

function lonLat(vertex: Vec3): LonLat {
  return [Math.atan2(vertex[1], vertex[0]), Math.asin(clamp(vertex[2], -1, 1))];
}

function projectGeographic(
  point: LonLat,
  projection: Projection,
  width: number,
  height: number,
): readonly [number, number] {
  const [longitude, latitude] = point;
  if (projection === "equirectangular") {
    return [((longitude + Math.PI) / TAU) * width, ((Math.PI / 2 - latitude) / Math.PI) * height];
  }
  if (projection === "mollweide") {
    let low = -Math.PI / 2;
    let high = Math.PI / 2;
    const target = Math.PI * Math.sin(latitude);
    for (let iteration = 0; iteration < 22; iteration += 1) {
      const theta = (low + high) / 2;
      if (2 * theta + Math.sin(2 * theta) < target) low = theta;
      else high = theta;
    }
    const theta = (low + high) / 2;
    const rawX = 2 * Math.SQRT2 / Math.PI * longitude * Math.cos(theta);
    const rawY = Math.SQRT2 * Math.sin(theta);
    return [width * (0.5 + rawX / (4 * Math.SQRT2)), height * (0.5 - rawY / (2 * Math.SQRT2))];
  }
  const theta = Math.asin(EQUAL_EARTH_M * Math.sin(latitude));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const denominator = 3 * (
    9 * EQUAL_EARTH_A4 * theta6 * theta2
    + 7 * EQUAL_EARTH_A3 * theta6
    + 3 * EQUAL_EARTH_A2 * theta2
    + EQUAL_EARTH_A1
  );
  const x = 2 * Math.sqrt(3) * longitude * Math.cos(theta) / denominator;
  const y = theta * (
    EQUAL_EARTH_A4 * theta6 * theta2
    + EQUAL_EARTH_A3 * theta6
    + EQUAL_EARTH_A2 * theta2
    + EQUAL_EARTH_A1
  );
  return [width * (0.5 + x / (2 * EQUAL_EARTH_X_MAX)), height * (0.5 - y / (2 * EQUAL_EARTH_Y_MAX))];
}

function unwrap(points: readonly LonLat[]): readonly LonLat[] {
  if (points.length === 0) return points;
  const result: [number, number][] = [[points[0][0], points[0][1]]];
  for (let index = 1; index < points.length; index += 1) {
    let longitude = points[index][0];
    const previousLongitude = result[index - 1][0];
    while (longitude - previousLongitude > Math.PI) longitude -= TAU;
    while (longitude - previousLongitude < -Math.PI) longitude += TAU;
    result.push([longitude, points[index][1]]);
  }
  return result;
}

function pathData(points: readonly (readonly [number, number])[], close: boolean): string {
  if (points.length === 0) return "";
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}${close ? "Z" : ""}`;
}

function slerp(a: Vec3, b: Vec3, amount: number): Vec3 {
  const angle = Math.acos(clamp(dot3(a, b), -1, 1));
  if (angle < 1e-8) return a;
  const sine = Math.sin(angle);
  return normalize3([
    (a[0] * Math.sin((1 - amount) * angle) + b[0] * Math.sin(amount * angle)) / sine,
    (a[1] * Math.sin((1 - amount) * angle) + b[1] * Math.sin(amount * angle)) / sine,
    (a[2] * Math.sin((1 - amount) * angle) + b[2] * Math.sin(amount * angle)) / sine,
  ]);
}

function densify(vertices: readonly Vec3[], close: boolean, segments = 3): Vec3[] {
  const result: Vec3[] = [];
  const edgeCount = close ? vertices.length : vertices.length - 1;
  for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex += 1) {
    const a = vertices[edgeIndex];
    const b = vertices[(edgeIndex + 1) % vertices.length];
    for (let step = 0; step < segments; step += 1) result.push(slerp(a, b, step / segments));
  }
  if (!close && vertices.length > 0) result.push(vertices[vertices.length - 1]);
  return result;
}

function visiblePathCopies(
  vertices: readonly Vec3[],
  projection: Projection,
  width: number,
  height: number,
  close: boolean,
): string[] {
  const geographic = unwrap(densify(vertices, close).map(lonLat));
  const paths: string[] = [];
  for (const shift of [-TAU, 0, TAU]) {
    const points = geographic.map(([longitude, latitude]) => (
      projectGeographic([longitude + shift, latitude], projection, width, height)
    ));
    const minimumX = Math.min(...points.map(([x]) => x));
    const maximumX = Math.max(...points.map(([x]) => x));
    if (maximumX >= -1 && minimumX <= width + 1) paths.push(pathData(points, close));
  }
  return paths;
}

function interpolate(value: number, stops: readonly (readonly [number, Rgb])[]): Rgb {
  const normalized = clamp(value);
  let upperIndex = 1;
  while (upperIndex < stops.length && normalized > stops[upperIndex][0]) upperIndex += 1;
  const upper = stops[Math.min(upperIndex, stops.length - 1)];
  const lower = stops[Math.max(0, upperIndex - 1)];
  const amount = upper[0] === lower[0] ? 0 : (normalized - lower[0]) / (upper[0] - lower[0]);
  return lower[1].map((channel, index) => Math.round(channel + (upper[1][index] - channel) * amount)) as unknown as Rgb;
}

function shadedRgb(color: Rgb, amount: number): Rgb {
  return color.map((channel) => Math.round(clamp(channel * amount, 0, 255))) as unknown as Rgb;
}

function rgbString(color: Rgb): string {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function cellBaseColor(cell: WorldCellState, seaLevelKm: number, elevationBounds: readonly [number, number]): Rgb {
  if (!cell.isLand) {
    const depth = Math.max(0, cell.waterDepthKm);
    return interpolate(clamp(depth / 7), [
      [0, [83, 158, 177]],
      [0.12, [43, 116, 151]],
      [0.45, [22, 70, 108]],
      [1, [5, 28, 58]],
    ]);
  }
  const relativeElevation = Math.max(0, cell.elevationKm - seaLevelKm);
  const landRange = Math.max(0.5, elevationBounds[1] - seaLevelKm);
  return interpolate(relativeElevation / landRange, [
    [0, [207, 193, 126]],
    [0.035, [124, 157, 91]],
    [0.2, [91, 136, 79]],
    [0.45, [136, 123, 91]],
    [0.7, [160, 145, 125]],
    [0.88, [202, 197, 185]],
    [1, [247, 247, 242]],
  ]);
}

function cellShading(model: TectonicWorldModel, reliefExaggeration: number): number[] {
  const cellsByFace = new Map(model.cells.map((cell) => [cell.faceId, cell]));
  const gradient: [number, number, number][] = model.sphere.faces.map(() => [0, 0, 0]);
  const weights = new Float64Array(model.sphere.faces.length);
  for (const edge of model.sphere.edges) {
    const [faceAId, faceBId] = edge.faces;
    const faceA = model.sphere.faces[faceAId];
    const faceB = model.sphere.faces[faceBId];
    const cellA = cellsByFace.get(faceAId);
    const cellB = cellsByFace.get(faceBId);
    if (!cellA || !cellB) continue;
    const horizontalKm = Math.max(1, edge.arcLengthRadians * model.recipe.radiusKm);
    const slope = (cellB.elevationKm - cellA.elevationKm) / horizontalKm;
    const directionA = normalize3(subtract3(faceB.center, scale3(faceA.center, dot3(faceA.center, faceB.center))));
    const directionB = normalize3(subtract3(faceA.center, scale3(faceB.center, dot3(faceB.center, faceA.center))));
    for (let component = 0; component < 3; component += 1) {
      gradient[faceAId][component] += directionA[component] * slope;
      gradient[faceBId][component] -= directionB[component] * slope;
    }
    weights[faceAId] += 1;
    weights[faceBId] += 1;
  }
  return model.sphere.faces.map((face) => {
    const weight = Math.max(1, weights[face.id]);
    const localGradient: Vec3 = [
      gradient[face.id][0] / weight,
      gradient[face.id][1] / weight,
      gradient[face.id][2] / weight,
    ];
    const normal = normalize3(subtract3(face.center, scale3(localGradient, reliefExaggeration)));
    const illumination = dot3(normal, LIGHT);
    return clamp(0.78 + illumination * 0.32, 0.48, 1.12);
  });
}

function graticulePaths(width: number, height: number, projection: Projection): string[] {
  const paths: string[] = [];
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const radians = latitude * Math.PI / 180;
    const points = Array.from({ length: 73 }, (_, index) => (
      projectGeographic([-Math.PI + index * TAU / 72, radians], projection, width, height)
    ));
    paths.push(pathData(points, false));
  }
  for (let longitude = -150; longitude <= 150; longitude += 30) {
    const radians = longitude * Math.PI / 180;
    const points = Array.from({ length: 73 }, (_, index) => (
      projectGeographic([radians, -Math.PI / 2 + index * Math.PI / 72], projection, width, height)
    ));
    paths.push(pathData(points, false));
  }
  return paths;
}

function projectionOutline(width: number, height: number, projection: Projection): string {
  if (projection === "equirectangular") return `M0,0H${width}V${height}H0Z`;
  const geographic: LonLat[] = [];
  for (let index = 0; index <= 72; index += 1) geographic.push([-Math.PI, -Math.PI / 2 + index * Math.PI / 72]);
  for (let index = 1; index <= 72; index += 1) geographic.push([-Math.PI + index * TAU / 72, Math.PI / 2]);
  for (let index = 71; index >= 0; index -= 1) geographic.push([Math.PI, -Math.PI / 2 + index * Math.PI / 72]);
  for (let index = 71; index >= 1; index -= 1) geographic.push([-Math.PI + index * TAU / 72, -Math.PI / 2]);
  return pathData(geographic.map((point) => projectGeographic(point, projection, width, height)), true);
}

function inverseProject(
  x: number,
  y: number,
  projection: Projection,
  width: number,
  height: number,
): Vec3 | null {
  if (projection === "equirectangular") {
    const longitude = x / width * TAU - Math.PI;
    const latitude = Math.PI / 2 - y / height * Math.PI;
    const radial = Math.cos(latitude);
    return [radial * Math.cos(longitude), radial * Math.sin(longitude), Math.sin(latitude)];
  }
  if (projection === "mollweide") {
    const rawY = (0.5 - y / height) * 2 * Math.SQRT2;
    const theta = Math.asin(clamp(rawY / Math.SQRT2, -1, 1));
    const latitude = Math.asin(clamp((2 * theta + Math.sin(2 * theta)) / Math.PI, -1, 1));
    const rawX = (x / width - 0.5) * 4 * Math.SQRT2;
    const cosine = Math.cos(theta);
    if (cosine < 1e-10) return Math.abs(rawX) < 1e-8 ? [0, 0, Math.sign(latitude)] : null;
    const longitude = Math.PI * rawX / (2 * Math.SQRT2 * cosine);
    if (Math.abs(longitude) > Math.PI + 1e-7) return null;
    const radial = Math.cos(latitude);
    return [radial * Math.cos(longitude), radial * Math.sin(longitude), Math.sin(latitude)];
  }
  const targetY = (0.5 - y / height) * 2 * EQUAL_EARTH_Y_MAX;
  let low = -EQUAL_EARTH_THETA_MAX;
  let high = EQUAL_EARTH_THETA_MAX;
  for (let iteration = 0; iteration < 22; iteration += 1) {
    const theta = (low + high) / 2;
    const theta2 = theta * theta;
    const theta6 = theta2 * theta2 * theta2;
    const candidateY = theta * (
      EQUAL_EARTH_A4 * theta6 * theta2
      + EQUAL_EARTH_A3 * theta6
      + EQUAL_EARTH_A2 * theta2
      + EQUAL_EARTH_A1
    );
    if (candidateY < targetY) low = theta;
    else high = theta;
  }
  const theta = (low + high) / 2;
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const denominator = 3 * (
    9 * EQUAL_EARTH_A4 * theta6 * theta2
    + 7 * EQUAL_EARTH_A3 * theta6
    + 3 * EQUAL_EARTH_A2 * theta2
    + EQUAL_EARTH_A1
  );
  const rawX = (x / width - 0.5) * 2 * EQUAL_EARTH_X_MAX;
  const longitude = rawX * denominator / (2 * Math.sqrt(3) * Math.cos(theta));
  if (Math.abs(longitude) > Math.PI + 1e-7) return null;
  const latitude = Math.asin(clamp(Math.sin(theta) / EQUAL_EARTH_M, -1, 1));
  const radial = Math.cos(latitude);
  return [radial * Math.cos(longitude), radial * Math.sin(longitude), Math.sin(latitude)];
}

interface KdNode {
  readonly faceId: number;
  readonly axis: 0 | 1 | 2;
  readonly left: KdNode | null;
  readonly right: KdNode | null;
}

function buildKdTree(faceIds: number[], centers: readonly Vec3[], depth = 0): KdNode | null {
  if (faceIds.length === 0) return null;
  const axis = (depth % 3) as 0 | 1 | 2;
  faceIds.sort((a, b) => centers[a][axis] - centers[b][axis] || a - b);
  const middle = Math.floor(faceIds.length / 2);
  return {
    faceId: faceIds[middle],
    axis,
    left: buildKdTree(faceIds.slice(0, middle), centers, depth + 1),
    right: buildKdTree(faceIds.slice(middle + 1), centers, depth + 1),
  };
}

function nearestFace(root: KdNode, centers: readonly Vec3[], point: Vec3): number {
  let bestFace = root.faceId;
  let bestDistance = Infinity;
  const visit = (node: KdNode | null): void => {
    if (!node) return;
    const center = centers[node.faceId];
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const dz = point[2] - center[2];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance || (distance === bestDistance && node.faceId < bestFace)) {
      bestDistance = distance;
      bestFace = node.faceId;
    }
    const delta = point[node.axis] - center[node.axis];
    const near = delta < 0 ? node.left : node.right;
    const far = delta < 0 ? node.right : node.left;
    visit(near);
    if (delta * delta <= bestDistance) visit(far);
  };
  visit(root);
  return bestFace;
}

function containsSphericalPoint(model: TectonicWorldModel, faceId: number, point: Vec3): boolean {
  const face = model.sphere.faces[faceId];
  const vertices = face.vertices.map((vertexId) => model.sphere.vertices[vertexId].position);
  for (let index = 0; index < 3; index += 1) {
    const edgeNormal = cross3(vertices[index], vertices[(index + 1) % 3]);
    if (dot3(edgeNormal, point) < -1e-11) return false;
  }
  return true;
}

function faceNeighbors(model: TectonicWorldModel): readonly number[][] {
  const neighbors: number[][] = model.sphere.faces.map(() => []);
  for (const edge of model.sphere.edges) {
    neighbors[edge.faces[0]].push(edge.faces[1]);
    neighbors[edge.faces[1]].push(edge.faces[0]);
  }
  return neighbors;
}

function smoothCanonicalClassColors(
  model: TectonicWorldModel,
  cellsByFace: ReadonlyMap<number, WorldCellState>,
  neighbors: readonly number[][],
  colors: readonly Rgb[],
  passes = 4,
): readonly Rgb[] {
  let current = colors.map((color) => [...color] as unknown as Rgb);
  for (let pass = 0; pass < passes; pass += 1) {
    current = model.sphere.faces.map((face) => {
      const canonicalLand = (cellsByFace.get(face.id) as WorldCellState).isLand;
      const sameClass = neighbors[face.id].filter((neighbor) => (
        (cellsByFace.get(neighbor) as WorldCellState).isLand === canonicalLand
      ));
      // Retain the source face more strongly than any one neighbor. Repeating
      // this conservative diffusion suppresses the visible control mesh while
      // never averaging a land sample with an ocean sample (or vice versa).
      const totalWeight = 2 + sameClass.length;
      return [0, 1, 2].map((channel) => Math.round((
        current[face.id][channel] * 2
        + sameClass.reduce((sum, neighbor) => sum + current[neighbor][channel], 0)
      ) / totalWeight)) as unknown as Rgb;
    });
  }
  return current;
}

function canonicalFaceAtPoint(
  model: TectonicWorldModel,
  neighbors: readonly number[][],
  tree: KdNode,
  centers: readonly Vec3[],
  point: Vec3,
): number {
  const nearest = nearestFace(tree, centers, point);
  if (containsSphericalPoint(model, nearest, point)) return nearest;
  const visited = new Set([nearest]);
  let frontier = [nearest];
  for (let depth = 0; depth < 4; depth += 1) {
    const next: number[] = [];
    for (const faceId of frontier) {
      for (const neighbor of neighbors[faceId]) {
        if (visited.has(neighbor)) continue;
        if (containsSphericalPoint(model, neighbor, point)) return neighbor;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  // Degenerate edge/vertex samples may satisfy multiple faces. The stable ID
  // fallback keeps the raster deterministic while preserving the same field.
  for (const face of model.sphere.faces) if (containsSphericalPoint(model, face.id, point)) return face.id;
  return nearest;
}

function renderRasterCells(
  model: TectonicWorldModel,
  cellsByFace: ReadonlyMap<number, WorldCellState>,
  colors: readonly Rgb[],
  projection: Projection,
  width: number,
  height: number,
  requestedRasterWidth: number,
  smoothInterior: boolean,
): string {
  const rasterWidth = Math.max(160, Math.min(width, Math.round(requestedRasterWidth)));
  const rasterHeight = Math.max(80, Math.round(rasterWidth * height / width));
  const pixelWidth = width / rasterWidth;
  const pixelHeight = height / rasterHeight;
  const centers = model.sphere.faces.map((face) => face.center);
  const neighbors = faceNeighbors(model);
  const presentationColors = smoothInterior
    ? smoothCanonicalClassColors(model, cellsByFace, neighbors, colors)
    : colors;
  const tree = buildKdTree(model.sphere.faces.map((face) => face.id), centers);
  if (!tree) return "";
  const pathsByColor = new Map<string, string[]>();
  for (let row = 0; row < rasterHeight; row += 1) {
    let runColor = "";
    let runStart = 0;
    const flush = (end: number): void => {
      if (runColor === "" || end <= runStart) return;
      const commands = pathsByColor.get(runColor) ?? [];
      const x = runStart * pixelWidth;
      const y = row * pixelHeight;
      commands.push(`M${x.toFixed(2)},${y.toFixed(2)}h${((end - runStart) * pixelWidth + 0.08).toFixed(2)}v${(pixelHeight + 0.08).toFixed(2)}h-${((end - runStart) * pixelWidth + 0.08).toFixed(2)}Z`);
      pathsByColor.set(runColor, commands);
    };
    for (let column = 0; column <= rasterWidth; column += 1) {
      let colorKey = "";
      if (column < rasterWidth) {
        const point = inverseProject((column + 0.5) * pixelWidth, (row + 0.5) * pixelHeight, projection, width, height);
        if (point) {
          const faceId = canonicalFaceAtPoint(model, neighbors, tree, centers, point);
          if (smoothInterior) {
            const canonicalLand = (cellsByFace.get(faceId) as WorldCellState).isLand;
            const candidates = [faceId, ...neighbors[faceId].filter((candidate) => (
              (cellsByFace.get(candidate) as WorldCellState).isLand === canonicalLand
            ))];
            let totalWeight = 0;
            const blended = [0, 0, 0];
            for (const candidate of candidates) {
              const weight = Math.exp((dot3(centers[candidate], point) - 1) * 110);
              totalWeight += weight;
              for (let channel = 0; channel < 3; channel += 1) blended[channel] += presentationColors[candidate][channel] * weight;
            }
            const quantized = blended.map((channel) => Math.round(channel / totalWeight / 5) * 5) as unknown as Rgb;
            colorKey = rgbString(quantized);
          } else colorKey = rgbString(presentationColors[faceId]);
        }
      }
      if (colorKey !== runColor) {
        flush(column);
        runColor = colorKey;
        runStart = column;
      }
    }
  }
  // The cellsByFace dependency is intentional: it asserts the color array was
  // built from every canonical face rather than from a renderer-side mask.
  if (colors.length !== cellsByFace.size) throw new Error("atlas color field does not cover canonical cells");
  return [...pathsByColor.entries()].map(([color, commands]) => `<path d="${commands.join("")}" fill="${color}" shape-rendering="crispEdges"/>`).join("");
}

const boundaryColors: Record<string, string> = {
  divergent: "#56d4db",
  convergent: "#f2735c",
  transform: "#f1d36b",
  collision: "#f7f3e8",
  stable: "#78909a",
  diffuse: "#b69ae3",
};

function validateWorld(model: TectonicWorldModel): Map<number, WorldCellState> {
  if (model.cells.length !== model.sphere.faces.length) {
    throw new Error(`world has ${model.cells.length} cells for ${model.sphere.faces.length} faces`);
  }
  const cellsByFace = new Map<number, WorldCellState>();
  for (const cell of model.cells) {
    if (cellsByFace.has(cell.faceId) || !model.sphere.faces[cell.faceId]) {
      throw new Error(`world contains duplicate or invalid face ${cell.faceId}`);
    }
    if (!Number.isFinite(cell.elevationKm) || !Number.isFinite(cell.waterDepthKm)) {
      throw new Error(`cell ${cell.faceId} has non-finite elevation or water depth`);
    }
    if (cell.waterDepthKm < 0 || (cell.isLand && cell.waterDepthKm !== 0) || (!cell.isLand && cell.waterDepthKm <= 0)) {
      throw new Error(`cell ${cell.faceId} has an inconsistent canonical water state`);
    }
    cellsByFace.set(cell.faceId, cell);
  }
  return cellsByFace;
}

/** Render a single whole-world atlas without mutating or reclassifying the model. */
export function renderTectonicAtlasSvg(model: TectonicWorldModel, options: TectonicAtlasOptions = {}): string {
  const cellsByFace = validateWorld(model);
  const width = Math.max(640, Math.round(options.width ?? 2048));
  const mapHeight = Math.max(320, Math.round(options.height ?? width / 2));
  const headerHeight = 108;
  const footerHeight = 52;
  const totalHeight = headerHeight + mapHeight + footerHeight;
  const showBoundaries = options.showBoundaries ?? false;
  const showGraticule = options.showGraticule ?? true;
  const projection = options.projection ?? "mollweide";
  const shading = cellShading(model, options.reliefExaggeration ?? 8);
  const elevations = model.cells.map((cell) => cell.elevationKm);
  const elevationBounds: readonly [number, number] = [Math.min(...elevations), Math.max(...elevations)];
  const landArea = model.cells.reduce((sum, cell) => sum + (cell.isLand ? model.sphere.faces[cell.faceId].areaSteradians : 0), 0);
  const landPercent = (landArea / model.sphere.totalAreaSteradians) * 100;
  const title = options.title ?? "ATLAS FORGE · EVOLVING TECTONIC WORLD";
  const clipId = "atlas-map-clip";
  const colors = model.sphere.faces.map((face) => {
    const cell = cellsByFace.get(face.id) as WorldCellState;
    return shadedRgb(cellBaseColor(cell, model.seaLevelKm, elevationBounds), shading[face.id]);
  });
  const cellRaster = renderRasterCells(
    model,
    cellsByFace,
    colors,
    projection,
    width,
    mapHeight,
    options.rasterWidth ?? Math.min(1024, width),
    options.smoothInterior ?? false,
  );

  const coastPaths: string[] = [];
  for (const edge of model.sphere.edges) {
    const cellA = cellsByFace.get(edge.faces[0]) as WorldCellState;
    const cellB = cellsByFace.get(edge.faces[1]) as WorldCellState;
    if (cellA.isLand === cellB.isLand) continue;
    const vertices = edge.vertices.map((vertexId) => model.sphere.vertices[vertexId].position);
    for (const path of visiblePathCopies(vertices, projection, width, mapHeight, false)) {
      coastPaths.push(`<path d="${path}" fill="none" stroke="#eee3bd" stroke-opacity="0.58" stroke-width="0.48"/>`);
    }
  }

  const boundaryPaths: string[] = [];
  if (showBoundaries) {
    for (const boundary of model.boundaries) {
      const edge = model.sphere.edges[boundary.edgeId];
      if (!edge) continue;
      const vertices = edge.vertices.map((vertexId) => model.sphere.vertices[vertexId].position);
      for (const path of visiblePathCopies(vertices, projection, width, mapHeight, false)) {
        boundaryPaths.push(`<path d="${path}" fill="none" stroke="${boundaryColors[boundary.kind] ?? boundaryColors.stable}" stroke-width="1.25" stroke-opacity="0.82" stroke-linecap="round"/>`);
      }
    }
  }

  const graticule = showGraticule
    ? graticulePaths(width, mapHeight, projection).map((path) => `<path d="${path}" fill="none" stroke="#d5e3e4" stroke-opacity="0.11" stroke-width="0.7"/>`).join("")
    : "";
  const radiusKm = model.recipe.radiusKm.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const residual = Math.max(
    Math.abs(model.areaBudget.coverageResidualSteradians),
    Math.abs(model.areaBudget.crustResidualSteradians),
  );
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" role="img" aria-label="${escapeXml(title)}">`,
    `<style>text{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;fill:#e1e8e5}.title{font-size:22px;font-weight:700;letter-spacing:2px}.eyebrow{font-size:10px;fill:#e06e46;letter-spacing:2px}.meta{font-size:11px;fill:#9eb1b4;letter-spacing:.7px}.footer{font-size:10px;fill:#81979d;letter-spacing:.5px}</style>`,
    `<rect width="100%" height="100%" fill="#06141d"/>`,
    `<text class="eyebrow" x="28" y="28">CANONICAL GEOLOGIC SNAPSHOT · V${model.version}</text>`,
    `<text class="title" x="28" y="58">${escapeXml(title)}</text>`,
    `<text class="meta" x="28" y="84">SEED ${escapeXml(String(model.recipe.seed))} · ${model.elapsedMyr.toFixed(1)} MYR · ${model.plates.length} PLATES · ${model.cells.length.toLocaleString("en-US")} CELLS · ${landPercent.toFixed(1)}% LAND</text>`,
    `<clipPath id="${clipId}"><path d="${projectionOutline(width, mapHeight, projection)}"/></clipPath>`,
    `<g transform="translate(0 ${headerHeight})" clip-path="url(#${clipId})">`,
    `<path d="${projectionOutline(width, mapHeight, projection)}" fill="#071b2c"/>`,
    cellRaster,
    graticule,
    coastPaths.join(""),
    boundaryPaths.join(""),
    `</g>`,
    `<text class="footer" x="28" y="${headerHeight + mapHeight + 30}">RADIUS ${radiusKm} KM · SEA LEVEL ${model.seaLevelKm.toFixed(3)} KM · AREA RESIDUAL ${residual.toExponential(2)} SR · LAND/SEA IS CANONICAL ACROSS ALL OUTPUTS</text>`,
    `<text class="footer" x="${width - 28}" y="${headerHeight + mapHeight + 30}" text-anchor="end">${showBoundaries ? "BOUNDARIES ON" : "BOUNDARIES OFF"} · ${projection === "mollweide" ? "MOLLWEIDE" : projection === "equal-earth" ? "EQUAL EARTH" : "EQUIRECTANGULAR 360°"}</text>`,
    `</svg>`,
  ].join("\n");
}
