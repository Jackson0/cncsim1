import { Faction, MAP_COLS, MAP_ROWS, STARTING_CREDITS } from './definitions';

export const ORE_FIELD_RADIUS = 4;
export const DEFAULT_ORE_AMOUNT = 8000;

export interface BaseSpawn {
  id: string;
  name: string;
  faction: Faction;
  cellX: number;
  cellY: number;
}

export interface OreFieldSetup {
  id: string;
  cellX: number;
  cellY: number;
  amount: number;
}

export interface MapSetupConfig {
  startingCredits: number;
  bases: BaseSpawn[];
  oreFields: OreFieldSetup[];
}

const DEFAULT_BASE_Y = Math.floor(MAP_ROWS / 2);
const DEFAULT_BASE_X = Math.floor(MAP_COLS / 2);
const DEFAULT_BASE_SPACING = 16;

export const DEFAULT_MAP_SETUP: MapSetupConfig = {
  startingCredits: STARTING_CREDITS,
  bases: [
    {
      id: 'base-1',
      name: 'Allies',
      faction: Faction.Allies,
      cellX: DEFAULT_BASE_X - DEFAULT_BASE_SPACING,
      cellY: DEFAULT_BASE_Y,
    },
    {
      id: 'base-2',
      name: 'Soviets',
      faction: Faction.Soviets,
      cellX: DEFAULT_BASE_X + DEFAULT_BASE_SPACING,
      cellY: DEFAULT_BASE_Y,
    },
  ],
  oreFields: [
    {
      id: 'ore-1',
      cellX: DEFAULT_BASE_X,
      cellY: DEFAULT_BASE_Y,
      amount: Number.POSITIVE_INFINITY,
    },
  ],
};

export interface SetupValidationResult {
  ok: boolean;
  reason?: string;
}

const inBounds = (x: number, y: number): boolean =>
  x >= 0 && x < MAP_COLS && y >= 0 && y < MAP_ROWS;

export function isValidSetup(config: MapSetupConfig): SetupValidationResult {
  if (!Number.isFinite(config.startingCredits) || config.startingCredits < 0) {
    return { ok: false, reason: 'Starting credits must be zero or higher.' };
  }
  if (config.bases.length < 2) {
    return { ok: false, reason: 'Place at least two bases.' };
  }
  if (config.oreFields.length < 1) {
    return { ok: false, reason: 'Place at least one ore field.' };
  }

  for (const base of config.bases) {
    if (!inBounds(base.cellX, base.cellY)) {
      return { ok: false, reason: `Base "${base.name}" is out of bounds.` };
    }
  }

  for (const ore of config.oreFields) {
    if (!inBounds(ore.cellX, ore.cellY)) {
      return { ok: false, reason: 'An ore field is out of bounds.' };
    }
    if (!(ore.amount > 0 || ore.amount === Number.POSITIVE_INFINITY)) {
      return { ok: false, reason: 'Ore field amount must be positive.' };
    }
  }

  return { ok: true };
}

export function cloneMapSetup(config: MapSetupConfig): MapSetupConfig {
  return {
    startingCredits: config.startingCredits,
    bases: config.bases.map((base) => ({ ...base })),
    oreFields: config.oreFields.map((ore) => ({ ...ore })),
  };
}

const ALLIES_COLOR_PALETTE = [0x4488ff, 0x2d65d8, 0x66bbff, 0x5f9dff];
const SOVIET_COLOR_PALETTE = [0xff4444, 0xdd2f2f, 0xff6a6a, 0xff8c8c];

export function getFactionColorVariant(faction: Faction, variant: number): number {
  const palette = faction === Faction.Allies ? ALLIES_COLOR_PALETTE : SOVIET_COLOR_PALETTE;
  return palette[variant % palette.length];
}
