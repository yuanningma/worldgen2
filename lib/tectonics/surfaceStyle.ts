import type { SurfaceLithology } from "./surfaceProcess.ts";

export type SurfacePresentationStyle = "atlas" | "relief";

export interface NaturalSurfaceColorInput {
  readonly isLand: boolean;
  readonly isLake: boolean;
  readonly elevationAboveSeaKm: number;
  readonly coastDistanceKm: number;
  readonly temperatureC: number;
  readonly precipitationMPerYear: number;
  readonly lithology: SurfaceLithology;
  readonly erosionResistance: number;
  readonly shade: number;
  readonly surfaceTexture: number;
}

const LITHOLOGY_TINTS: Readonly<Record<SurfaceLithology, readonly [number, number, number]>> = {
  "oceanic-basalt": [78, 103, 111],
  crystalline: [124, 142, 112],
  metamorphic: [154, 130, 112],
  volcanic: [103, 116, 99],
  carbonate: [188, 181, 137],
  sedimentary: [169, 153, 112],
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function mix(
  a: readonly number[],
  b: readonly number[],
  amount: number,
): readonly [number, number, number] {
  return a.map((value, index) => Math.round(
    value + (b[index] - value) * clamp(amount),
  )) as unknown as readonly [number, number, number];
}

function shadeColor(
  base: readonly [number, number, number],
  shade: number,
): readonly [number, number, number] {
  const shaded = base.map((channel) => Math.round(clamp(channel * shade, 0, 255)));
  return shaded as unknown as readonly [number, number, number];
}

export function naturalSurfaceColor(
  style: SurfacePresentationStyle,
  input: NaturalSurfaceColorInput,
): readonly [number, number, number] {
  if (style === "atlas") {
    if (input.isLake) return [112, 168, 204];
    if (!input.isLand) return [177, 207, 232];
    let base: readonly [number, number, number];
    if (input.elevationAboveSeaKm > 4.8 || input.temperatureC < -13) {
      base = [246, 245, 239];
    } else if (input.elevationAboveSeaKm > 3.35) {
      base = [181, 132, 96];
    } else if (input.elevationAboveSeaKm > 2.05) {
      base = [207, 160, 111];
    } else if (input.precipitationMPerYear < 0.42 && input.temperatureC > 4) {
      base = [231, 197, 126];
    } else if (input.precipitationMPerYear > 1.55 && input.temperatureC > 2) {
      base = [92, 151, 79];
    } else if (input.temperatureC < 1) {
      base = [187, 201, 165];
    } else {
      base = [177, 205, 143];
    }
    const paperTexture = 1 + input.surfaceTexture * 0.006;
    return shadeColor(base, paperTexture);
  }

  let base: readonly [number, number, number];
  if (input.isLake) {
    base = [65, 128, 168];
  } else if (!input.isLand) {
    const shelf = clamp(input.coastDistanceKm / 220);
    base = shelf < 0.22
      ? mix([38, 82, 116], [25, 62, 97], shelf / 0.22)
      : mix([25, 62, 97], [9, 31, 61], (shelf - 0.22) / 0.78);
  } else if (input.elevationAboveSeaKm > 4.8 || input.temperatureC < -13) {
    base = [238, 236, 220];
  } else if (input.elevationAboveSeaKm > 2.2) {
    base = mix([177, 139, 91], [216, 200, 169], (input.elevationAboveSeaKm - 2.2) / 2.6);
  } else if (input.precipitationMPerYear < 0.42 && input.temperatureC > 4) {
    base = [210, 181, 111];
  } else if (input.precipitationMPerYear > 1.55 && input.temperatureC > 2) {
    base = [74, 128, 76];
  } else if (input.temperatureC < 1) {
    base = [164, 177, 145];
  } else {
    base = [137, 166, 105];
  }
  if (input.isLand && !input.isLake) {
    const snowOrIce = input.elevationAboveSeaKm > 4.8 || input.temperatureC < -13;
    base = mix(base, LITHOLOGY_TINTS[input.lithology], snowOrIce ? 0.045 : 0.14);
  }
  const textureShade = 1 + input.surfaceTexture
    * (input.isLand && !input.isLake ? 0.018 + input.erosionResistance * 0.011 : 0.004);
  return shadeColor(base, input.shade * textureShade);
}
