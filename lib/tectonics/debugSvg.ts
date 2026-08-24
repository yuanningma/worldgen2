export type Vec3 = readonly [x: number, y: number, z: number];

export type CrustKind = "continental" | "transitional" | "oceanic" | "arc" | "volcanic";

export type BoundaryKind = "divergent" | "convergent" | "transform" | "collision" | "diffuse";

export interface TectonicDebugCell {
  id: number;
  /** Indices into TectonicDebugSnapshot.vertices, ordered around the cell. */
  vertexIndices: readonly number[];
  plateId: number;
  crustKind: CrustKind;
  crustAgeMyr: number;
  crustThicknessKm: number;
  provenanceId: number;
  elevationKm: number;
}

export interface TectonicDebugBoundary {
  kind: BoundaryKind;
  /** A spherical polyline. Two points are sufficient for an individual edge. */
  points: readonly Vec3[];
}

/**
 * Stable, renderer-facing projection of the simulator state. Keeping this small
 * prevents diagnostic tooling from becoming coupled to mutable solver storage.
 */
export interface TectonicDebugSnapshot {
  seed: string;
  simulationTimeMyr: number;
  vertices: readonly Vec3[];
  cells: readonly TectonicDebugCell[];
  boundaries: readonly TectonicDebugBoundary[];
}

export interface ContactSheetOptions {
  panelWidth?: number;
  panelHeight?: number;
  columns?: number;
  title?: string;
}

type PanelKey = "plate" | "boundary" | "crust" | "age" | "thickness" | "provenance" | "elevation";

interface PanelDefinition {
  key: PanelKey;
  title: string;
  subtitle: string;
  fill: (cell: TectonicDebugCell) => string;
}

const TAU = Math.PI * 2;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function validateSnapshot(snapshot: TectonicDebugSnapshot): void {
  if (snapshot.vertices.length < 3) throw new Error("debug snapshot needs at least three vertices");
  for (let vertexIndex = 0; vertexIndex < snapshot.vertices.length; vertexIndex += 1) {
    const vertex = snapshot.vertices[vertexIndex];
    if (vertex.length !== 3) throw new Error(`vertex ${vertexIndex} must have three components`);
    vertex.forEach((value, component) => assertFinite(value, `vertex ${vertexIndex}[${component}]`));
    const length = Math.hypot(vertex[0], vertex[1], vertex[2]);
    if (Math.abs(length - 1) > 1e-4) throw new Error(`vertex ${vertexIndex} must be a unit vector`);
  }
  for (const cell of snapshot.cells) {
    if (cell.vertexIndices.length < 3) throw new Error(`cell ${cell.id} needs at least three vertices`);
    for (const vertexIndex of cell.vertexIndices) {
      if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= snapshot.vertices.length) {
        throw new Error(`cell ${cell.id} references invalid vertex ${vertexIndex}`);
      }
    }
    assertFinite(cell.crustAgeMyr, `cell ${cell.id} crustAgeMyr`);
    assertFinite(cell.crustThicknessKm, `cell ${cell.id} crustThicknessKm`);
    assertFinite(cell.elevationKm, `cell ${cell.id} elevationKm`);
  }
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

function hsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${Math.round(((hue % 360) + 360) % 360)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function categoricalColor(id: number, saturation = 62, lightness = 55): string {
  // The irrational golden-angle step remains well distributed for adjacent IDs.
  return hsl(id * 137.507764, saturation, lightness + ((Math.abs(id) * 17) % 9) - 4);
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function interpolateStops(value: number, stops: readonly (readonly [number, readonly [number, number, number]])[]): string {
  const normalized = clamp(value);
  let upperIndex = 1;
  while (upperIndex < stops.length && normalized > stops[upperIndex][0]) upperIndex += 1;
  const upper = stops[Math.min(upperIndex, stops.length - 1)];
  const lower = stops[Math.max(0, upperIndex - 1)];
  const amount = upper[0] === lower[0] ? 0 : (normalized - lower[0]) / (upper[0] - lower[0]);
  const color = lower[1].map((channel, index) => Math.round(channel + (upper[1][index] - channel) * amount));
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

const crustColors: Record<CrustKind, string> = {
  continental: "#d2b16c",
  transitional: "#a49b72",
  oceanic: "#315f80",
  arc: "#c86f55",
  volcanic: "#8b5c76",
};

const boundaryColors: Record<BoundaryKind, string> = {
  divergent: "#4bd4dc",
  convergent: "#ff735c",
  transform: "#f6d866",
  collision: "#f2f0e6",
  diffuse: "#b795e8",
};

function panelDefinitions(snapshot: TectonicDebugSnapshot): PanelDefinition[] {
  const maxAge = Math.max(1, ...snapshot.cells.map((cell) => cell.crustAgeMyr));
  const maxThickness = Math.max(12, ...snapshot.cells.map((cell) => cell.crustThicknessKm));
  const minimumElevation = Math.min(-8, ...snapshot.cells.map((cell) => cell.elevationKm));
  const maximumElevation = Math.max(8, ...snapshot.cells.map((cell) => cell.elevationKm));
  return [
    {
      key: "plate",
      title: "PLATE ID",
      subtitle: "Rigid ownership; boundaries must form a closed partition",
      fill: (cell) => categoricalColor(cell.plateId),
    },
    {
      key: "boundary",
      title: "BOUNDARY TYPE",
      subtitle: "Cyan divergent · red convergent · white collision · yellow transform",
      fill: () => "#172834",
    },
    {
      key: "crust",
      title: "CRUST TYPE",
      subtitle: "Continental · transitional · oceanic · arc · volcanic",
      fill: (cell) => crustColors[cell.crustKind],
    },
    {
      key: "age",
      title: "CRUST AGE",
      subtitle: `0–${Math.round(maxAge)} Myr; ridges should begin at age zero`,
      fill: (cell) => interpolateStops(cell.crustAgeMyr / maxAge, [
        [0, [255, 244, 177]],
        [0.35, [89, 191, 176]],
        [0.7, [61, 91, 150]],
        [1, [45, 28, 74]],
      ]),
    },
    {
      key: "thickness",
      title: "CRUST THICKNESS",
      subtitle: `0–${maxThickness.toFixed(1)} km; collision zones should broaden and thicken`,
      fill: (cell) => interpolateStops(cell.crustThicknessKm / maxThickness, [
        [0, [24, 43, 68]],
        [0.25, [43, 112, 135]],
        [0.55, [185, 178, 104]],
        [1, [244, 229, 194]],
      ]),
    },
    {
      key: "provenance",
      title: "PROVENANCE",
      subtitle: "Persistent terranes should remain visible across changing plate ownership",
      fill: (cell) => categoricalColor(cell.provenanceId, 48, 60),
    },
    {
      key: "elevation",
      title: "ISOSTATIC ELEVATION",
      subtitle: `${minimumElevation.toFixed(1)} to ${maximumElevation.toFixed(1)} km; sea level is the zero contour`,
      fill: (cell) => {
        if (cell.elevationKm < 0) {
          return interpolateStops((cell.elevationKm - minimumElevation) / -minimumElevation, [
            [0, [7, 25, 56]],
            [1, [55, 142, 171]],
          ]);
        }
        return interpolateStops(cell.elevationKm / maximumElevation, [
          [0, [218, 207, 150]],
          [0.28, [92, 151, 89]],
          [0.68, [137, 110, 91]],
          [1, [250, 249, 242]],
        ]);
      },
    },
  ];
}

function project(vertex: Vec3, width: number, height: number): readonly [number, number] {
  const longitude = Math.atan2(vertex[1], vertex[0]);
  const latitude = Math.asin(clamp(vertex[2], -1, 1));
  return [((longitude + Math.PI) / TAU) * width, ((Math.PI / 2 - latitude) / Math.PI) * height];
}

function unwrap(points: readonly (readonly [number, number])[], width: number): readonly (readonly [number, number])[] {
  if (points.length === 0) return points;
  const result: [number, number][] = [[points[0][0], points[0][1]]];
  for (let index = 1; index < points.length; index += 1) {
    let x = points[index][0];
    const previousX = result[index - 1][0];
    while (x - previousX > width / 2) x -= width;
    while (x - previousX < -width / 2) x += width;
    result.push([x, points[index][1]]);
  }
  return result;
}

function pathData(points: readonly (readonly [number, number])[], close: boolean): string {
  if (points.length === 0) return "";
  const commands = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`);
  if (close) commands.push("Z");
  return commands.join("");
}

function repeatedPaths(
  vertices: readonly Vec3[],
  vertexIndices: readonly number[],
  width: number,
  height: number,
): string[] {
  const points = unwrap(vertexIndices.map((index) => project(vertices[index], width, height)), width);
  return [-width, 0, width].map((shift) => pathData(points.map(([x, y]) => [x + shift, y]), true));
}

function repeatedLinePaths(points3d: readonly Vec3[], width: number, height: number): string[] {
  const points = unwrap(points3d.map((point) => project(point, width, height)), width);
  return [-width, 0, width].map((shift) => pathData(points.map(([x, y]) => [x + shift, y]), false));
}

function renderPanel(
  snapshot: TectonicDebugSnapshot,
  panel: PanelDefinition,
  panelIndex: number,
  panelWidth: number,
  panelHeight: number,
  columns: number,
): string {
  const gutter = 24;
  const headerHeight = 54;
  const sheetHeaderHeight = 116;
  const column = panelIndex % columns;
  const row = Math.floor(panelIndex / columns);
  const x = gutter + column * (panelWidth + gutter);
  const y = sheetHeaderHeight + row * (panelHeight + headerHeight + gutter);
  const clipId = `panel-${panel.key}`;
  const shapes: string[] = [];
  for (const cell of snapshot.cells) {
    for (const path of repeatedPaths(snapshot.vertices, cell.vertexIndices, panelWidth, panelHeight)) {
      const color = panel.fill(cell);
      shapes.push(`<path d="${path}" fill="${color}" stroke="${color}" stroke-width="0.35"/>`);
    }
  }
  if (panel.key === "boundary" || panel.key === "plate") {
    for (const boundary of snapshot.boundaries) {
      const color = boundaryColors[boundary.kind];
      const strokeWidth = boundary.kind === "collision" ? 2.2 : 1.45;
      for (const path of repeatedLinePaths(boundary.points, panelWidth, panelHeight)) {
        shapes.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`);
      }
    }
  }
  return [
    `<g transform="translate(${x} ${y})">`,
    `<text class="panel-title" x="0" y="-29">${escapeXml(panel.title)}</text>`,
    `<text class="panel-subtitle" x="0" y="-10">${escapeXml(panel.subtitle)}</text>`,
    `<rect width="${panelWidth}" height="${panelHeight}" rx="2" fill="#091822" stroke="#36505e"/>`,
    `<clipPath id="${clipId}"><rect width="${panelWidth}" height="${panelHeight}" rx="2"/></clipPath>`,
    `<g clip-path="url(#${clipId})">${shapes.join("")}</g>`,
    `</g>`,
  ].join("");
}

export function renderTectonicContactSheet(
  snapshot: TectonicDebugSnapshot,
  options: ContactSheetOptions = {},
): string {
  validateSnapshot(snapshot);
  const panelWidth = Math.max(240, Math.round(options.panelWidth ?? 520));
  const panelHeight = Math.max(120, Math.round(options.panelHeight ?? panelWidth / 2));
  const columns = Math.max(1, Math.min(4, Math.round(options.columns ?? 2)));
  const panels = panelDefinitions(snapshot);
  const gutter = 24;
  const headerHeight = 54;
  const sheetHeaderHeight = 116;
  const rows = Math.ceil(panels.length / columns);
  const width = gutter + columns * (panelWidth + gutter);
  const height = sheetHeaderHeight + rows * (panelHeight + headerHeight + gutter) + 24;
  const title = options.title ?? "TECTONIC PROTOTYPE · SCIENTIFIC CONTACT SHEET";
  const cells = snapshot.cells.length.toLocaleString("en-US");
  const plates = new Set(snapshot.cells.map((cell) => cell.plateId)).size.toLocaleString("en-US");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">`,
    `<style>`,
    `text{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;fill:#dbe5e7}`,
    `.title{font-size:20px;font-weight:700;letter-spacing:2px}.meta{font-size:11px;fill:#8fa6ad;letter-spacing:.8px}`,
    `.panel-title{font-size:13px;font-weight:700;letter-spacing:1.4px}.panel-subtitle{font-size:9px;fill:#8fa6ad}`,
    `</style>`,
    `<rect width="100%" height="100%" fill="#06131c"/>`,
    `<text class="title" x="${gutter}" y="32">${escapeXml(title)}</text>`,
    `<text class="meta" x="${gutter}" y="55">SEED ${escapeXml(snapshot.seed)} · ${snapshot.simulationTimeMyr.toFixed(1)} MYR · ${cells} CELLS · ${plates} PLATES · EQUIRECTANGULAR DEBUG PROJECTION</text>`,
    panels.map((panel, index) => renderPanel(snapshot, panel, index, panelWidth, panelHeight, columns)).join(""),
    `</svg>`,
  ].join("\n");
}
