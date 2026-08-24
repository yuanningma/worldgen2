import { add3, cross3, normalize3, scale3, type Vec3 } from "./vector.ts";

export type ConveyorSide = -1 | 1;

export interface OceanConveyorConfig {
  readonly ridgePoint: Vec3;
  /** Tangent direction from the ridge toward side +1. */
  readonly spreadingDirection: Vec3;
  readonly basinHalfWidthRadians: number;
  readonly alongRidgeHalfSpanRadians: number;
  readonly halfSpreadingRateRadPerMyr: number;
  readonly timestepMyr: number;
}

export interface OceanCrustParcel {
  readonly id: number;
  readonly side: ConveyorSide;
  readonly innerDistanceRadians: number;
  readonly outerDistanceRadians: number;
  readonly center: Vec3;
  readonly ageMyr: number;
  readonly areaSteradians: number;
}

export interface OceanConveyorBudget {
  readonly createdAreaSteradians: number;
  readonly subductedAreaSteradians: number;
  readonly activeAreaSteradians: number;
  readonly residualAreaSteradians: number;
}

export interface OceanConveyorState {
  readonly config: OceanConveyorConfig;
  readonly elapsedMyr: number;
  readonly nextParcelId: number;
  readonly parcels: readonly OceanCrustParcel[];
  readonly cumulativeCreatedAreaSteradians: number;
  readonly cumulativeSubductedAreaSteradians: number;
  readonly budget: OceanConveyorBudget;
}

function validateConfig(config: OceanConveyorConfig): OceanConveyorConfig {
  normalize3(config.ridgePoint);
  normalize3(config.spreadingDirection);
  if (!(config.basinHalfWidthRadians > 0 && config.basinHalfWidthRadians < Math.PI)) {
    throw new RangeError("basinHalfWidthRadians must be between 0 and pi");
  }
  if (!(config.alongRidgeHalfSpanRadians > 0 && config.alongRidgeHalfSpanRadians <= Math.PI / 2)) {
    throw new RangeError("alongRidgeHalfSpanRadians must be between 0 and pi/2");
  }
  if (!(config.halfSpreadingRateRadPerMyr > 0) || !Number.isFinite(config.halfSpreadingRateRadPerMyr)) {
    throw new RangeError("halfSpreadingRateRadPerMyr must be finite and positive");
  }
  if (!(config.timestepMyr > 0) || !Number.isFinite(config.timestepMyr)) {
    throw new RangeError("timestepMyr must be finite and positive");
  }
  return config;
}

function conveyorFrame(config: OceanConveyorConfig): { ridge: Vec3; travel: Vec3 } {
  const ridge = normalize3(config.ridgePoint);
  const candidate = normalize3(config.spreadingDirection);
  const along = normalize3(cross3(ridge, candidate));
  const travel = normalize3(cross3(along, ridge));
  return { ridge, travel };
}

function parcelCenter(config: OceanConveyorConfig, side: ConveyorSide, distance: number): Vec3 {
  const { ridge, travel } = conveyorFrame(config);
  const signedDistance = side * distance;
  return normalize3(add3(
    scale3(ridge, Math.cos(signedDistance)),
    scale3(travel, Math.sin(signedDistance)),
  ));
}

function stripArea(config: OceanConveyorConfig, angularWidth: number): number {
  // Exact area of a longitude-like spherical strip over the configured ridge span.
  return 2 * Math.sin(config.alongRidgeHalfSpanRadians) * angularWidth;
}

function activeArea(parcels: readonly OceanCrustParcel[]): number {
  return parcels.reduce((sum, parcel) => sum + parcel.areaSteradians, 0);
}

export function createOceanConveyor(config: OceanConveyorConfig): OceanConveyorState {
  const checked = validateConfig(config);
  return {
    config: checked,
    elapsedMyr: 0,
    nextParcelId: 1,
    parcels: [],
    cumulativeCreatedAreaSteradians: 0,
    cumulativeSubductedAreaSteradians: 0,
    budget: {
      createdAreaSteradians: 0,
      subductedAreaSteradians: 0,
      activeAreaSteradians: 0,
      residualAreaSteradians: 0,
    },
  };
}

export function stepOceanConveyor(state: OceanConveyorState, stepCount = 1): OceanConveyorState {
  if (!Number.isInteger(stepCount) || stepCount < 0) {
    throw new RangeError("stepCount must be a non-negative integer");
  }
  let current = state;
  for (let step = 0; step < stepCount; step += 1) current = stepOnce(current);
  return current;
}

function stepOnce(state: OceanConveyorState): OceanConveyorState {
  const config = state.config;
  const advance = config.halfSpreadingRateRadPerMyr * config.timestepMyr;
  if (advance > config.basinHalfWidthRadians) {
    throw new RangeError("A timestep cannot advance farther than the conveyor half-width");
  }

  const parcels: OceanCrustParcel[] = [];
  let subductedThisStep = 0;
  for (const parcel of state.parcels) {
    const inner = parcel.innerDistanceRadians + advance;
    const unclippedOuter = parcel.outerDistanceRadians + advance;
    const outer = Math.min(unclippedOuter, config.basinHalfWidthRadians);
    const originalWidth = parcel.outerDistanceRadians - parcel.innerDistanceRadians;
    const retainedWidth = Math.max(0, outer - inner);
    const removedWidth = originalWidth - retainedWidth;
    subductedThisStep += stripArea(config, removedWidth);
    if (retainedWidth > 0) {
      parcels.push({
        ...parcel,
        innerDistanceRadians: inner,
        outerDistanceRadians: outer,
        center: parcelCenter(config, parcel.side, (inner + outer) / 2),
        ageMyr: parcel.ageMyr + config.timestepMyr,
        areaSteradians: stripArea(config, retainedWidth),
      });
    }
  }

  let nextParcelId = state.nextParcelId;
  let createdThisStep = 0;
  for (const side of [-1, 1] as const) {
    const width = Math.min(advance, config.basinHalfWidthRadians);
    const area = stripArea(config, width);
    parcels.push({
      id: nextParcelId,
      side,
      innerDistanceRadians: 0,
      outerDistanceRadians: width,
      center: parcelCenter(config, side, width / 2),
      ageMyr: 0,
      areaSteradians: area,
    });
    nextParcelId += 1;
    createdThisStep += area;
  }

  parcels.sort((a, b) => a.side - b.side
    || a.innerDistanceRadians - b.innerDistanceRadians
    || a.id - b.id);
  const cumulativeCreated = state.cumulativeCreatedAreaSteradians + createdThisStep;
  const cumulativeSubducted = state.cumulativeSubductedAreaSteradians + subductedThisStep;
  const active = activeArea(parcels);
  const residual = cumulativeCreated - cumulativeSubducted - active;

  return {
    config,
    elapsedMyr: state.elapsedMyr + config.timestepMyr,
    nextParcelId,
    parcels,
    cumulativeCreatedAreaSteradians: cumulativeCreated,
    cumulativeSubductedAreaSteradians: cumulativeSubducted,
    budget: {
      createdAreaSteradians: createdThisStep,
      subductedAreaSteradians: subductedThisStep,
      activeAreaSteradians: active,
      residualAreaSteradians: residual,
    },
  };
}
