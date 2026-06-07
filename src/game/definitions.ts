/** Ported / simplified from CODE/RULES.CPP and CODE/HOUSE.CPP */

export const TICKS_PER_SECOND = 15;
export const CELL_SIZE = 32;

export const MAP_COLS = 40;
export const MAP_ROWS = 28;

export const STARTING_CREDITS = 3000;

/** From RulesClass defaults */
export const RULES = {
  powerSurplus: 50,
  powerEmergencyFraction: 0.5,
  refineryRatio: 0.16,
  refineryLimit: 4,
  barracksRatio: 0.16,
  barracksLimit: 2,
  warRatio: 0.1,
  warLimit: 2,
  defenseRatio: 0.5,
  defenseLimit: 40,
  aaRatio: 0.14,
  aaLimit: 10,
  teslaRatio: 0.16,
  teslaLimit: 10,
  helipadRatio: 0.12,
  helipadLimit: 5,
  airstripRatio: 0.12,
  airstripLimit: 5,
  baseSizeAdd: 3,
  infantryReserve: 2000,
  infantryBaseMult: 2,
  attackInterval: 3,
  oreDumpRate: 2,
  maxIQ: 5,
  iqProduction: 5,
  iqHarvester: 3,
  iqAircraft: 4,
  maxUnit: 83,
  maxInfantry: 83,
  maxBuilding: 83,
  maxAircraft: 83,
  teamDelay: 0.6,
  autocreateTime: 5,
  attackedStateTicks: TICKS_PER_SECOND * 60,
  lowPowerDamageDelay: TICKS_PER_SECOND * 60,
  lowPowerDamage: 1,
  repairThreshold: 200,
  repairStep: 25,
  repairPercent: 0.2,
  repairInterval: TICKS_PER_SECOND * 2,
  repairDelayMin: TICKS_PER_SECOND * 10,
  repairDelayMax: TICKS_PER_SECOND * 60,
} as const;

/**
 * Strategic openings the AI commits to at game start. Each reshapes the build
 * cascade, economy size, tech/air priority, and attack aggression so that runs
 * diverge instead of following one fixed formula.
 */
export type AiStrategyKey = 'rush' | 'boom' | 'turtle' | 'techAir' | 'massArmor' | 'balanced';

export interface StrategyDef {
  /** Display label surfaced in telemetry. */
  label: string;
  /** Multiplies RULES.refineryRatio; >1 expands economy (boom), <1 stays lean (rush). */
  refineryRatioMult: number;
  /** Hard cap override for refineries. */
  refineryLimit: number;
  /** Multiplies the effective defense ratio. */
  defenseRatioMult: number;
  /** Urgency assigned to defensive structures. */
  defenseUrgency: Urgency;
  /** Urgency assigned to the Tech Center. */
  techUrgency: Urgency;
  /** Urgency assigned to air production buildings (helipad / airstrip). */
  airUrgency: Urgency;
  /** Whether this strategy actively wants an air force. */
  wantsAir: boolean;
  /** Desired number of air production buildings when wantsAir. */
  airFactoryTarget: number;
  /** How many completed buildings before the AI commits to a War Factory (rush = early). */
  warFactoryAfterBuildings: number;
  /** Multiplies the army size required before launching an attack. */
  attackArmyMult: number;
  /** Multiplies the delay between attack waves (>1 = more patient). */
  attackIntervalMult: number;
  /** Production profile this strategy biases toward. */
  preferredProfile: 'economy' | 'infantry' | 'armor' | 'siege' | 'air' | 'finisher';
}

export enum Faction {
  Allies = 0,
  Soviets = 1,
}

export enum Difficulty {
  Easy = 0,
  Normal = 1,
  Hard = 2,
}

export enum Urgency {
  None = 0,
  Low = 1,
  Medium = 2,
  High = 3,
  Critical = 4,
}

export const STRATEGY_DEFS: Record<AiStrategyKey, StrategyDef> = {
  rush: {
    label: 'Rush',
    refineryRatioMult: 0.7,
    refineryLimit: 2,
    defenseRatioMult: 0.25,
    defenseUrgency: Urgency.Low,
    techUrgency: Urgency.Low,
    airUrgency: Urgency.Low,
    wantsAir: false,
    airFactoryTarget: 0,
    warFactoryAfterBuildings: 2,
    attackArmyMult: 0.45,
    attackIntervalMult: 0.55,
    preferredProfile: 'infantry',
  },
  boom: {
    label: 'Boom Economy',
    refineryRatioMult: 1.6,
    refineryLimit: 4,
    defenseRatioMult: 0.9,
    defenseUrgency: Urgency.Medium,
    techUrgency: Urgency.Medium,
    airUrgency: Urgency.Low,
    wantsAir: false,
    airFactoryTarget: 0,
    warFactoryAfterBuildings: 5,
    attackArmyMult: 1.5,
    attackIntervalMult: 1.4,
    preferredProfile: 'armor',
  },
  turtle: {
    label: 'Turtle',
    refineryRatioMult: 1.15,
    refineryLimit: 3,
    defenseRatioMult: 1.9,
    defenseUrgency: Urgency.High,
    techUrgency: Urgency.Medium,
    airUrgency: Urgency.Low,
    wantsAir: false,
    airFactoryTarget: 0,
    warFactoryAfterBuildings: 4,
    attackArmyMult: 1.8,
    attackIntervalMult: 1.6,
    preferredProfile: 'siege',
  },
  techAir: {
    label: 'Tech Air',
    refineryRatioMult: 1.8,
    refineryLimit: 3,
    defenseRatioMult: 1.1,
    defenseUrgency: Urgency.Medium,
    techUrgency: Urgency.High,
    airUrgency: Urgency.High,
    wantsAir: true,
    airFactoryTarget: 2,
    warFactoryAfterBuildings: 4,
    attackArmyMult: 1.2,
    attackIntervalMult: 0.9,
    preferredProfile: 'air',
  },
  massArmor: {
    label: 'Mass Armor',
    refineryRatioMult: 1.3,
    refineryLimit: 3,
    defenseRatioMult: 0.7,
    defenseUrgency: Urgency.Medium,
    techUrgency: Urgency.Medium,
    airUrgency: Urgency.Low,
    wantsAir: false,
    airFactoryTarget: 0,
    warFactoryAfterBuildings: 3,
    attackArmyMult: 1.25,
    attackIntervalMult: 1.0,
    preferredProfile: 'armor',
  },
  balanced: {
    label: 'Balanced',
    refineryRatioMult: 1.0,
    refineryLimit: 4,
    defenseRatioMult: 1.0,
    defenseUrgency: Urgency.Medium,
    techUrgency: Urgency.Medium,
    airUrgency: Urgency.Medium,
    wantsAir: false,
    airFactoryTarget: 1,
    warFactoryAfterBuildings: 3,
    attackArmyMult: 1.0,
    attackIntervalMult: 1.0,
    preferredProfile: 'armor',
  },
};

export enum HouseState {
  Buildup = 0,
  Broke = 1,
  Attacked = 2,
  Endgame = 3,
}

export enum StructType {
  None = 'none',
  Const = 'const',
  Power = 'power',
  AdvPower = 'adv_power',
  Refinery = 'refinery',
  Barracks = 'barracks',
  Tent = 'tent',
  WarFactory = 'war_factory',
  Pillbox = 'pillbox',
  Turret = 'turret',
  FlameTurret = 'flame_turret',
  Sam = 'sam',
  AaGun = 'aa_gun',
  Tesla = 'tesla',
  Tech = 'tech',
  Helipad = 'helipad',
  Airstrip = 'airstrip',
}

export enum UnitType {
  None = 'none',
  MCV = 'mcv',
  Harvester = 'harvester',
  LightTank = 'light_tank',
  MediumTank = 'medium_tank',
  HeavyTank = 'heavy_tank',
  Artillery = 'artillery',
  Apc = 'apc',
}

export enum InfantryType {
  None = 'none',
  Rifle = 'rifle',
  Grenadier = 'grenadier',
  Rocket = 'rocket',
  Flamethrower = 'flamethrower',
  Engineer = 'engineer',
}

export enum AircraftType {
  None = 'none',
  Hind = 'hind',
  Longbow = 'longbow',
  Mig = 'mig',
  Yak = 'yak',
}

export enum Mission {
  Guard = 'guard',
  Harvest = 'harvest',
  Move = 'move',
  Attack = 'attack',
  Hunt = 'hunt',
  Deploy = 'deploy',
  Return = 'return',
}

export interface StructDef {
  type: StructType;
  name: string;
  cost: number;
  power: number;
  drain: number;
  buildTime: number;
  width: number;
  height: number;
  hp: number;
  faction?: Faction;
  level?: number;
  weaponRange?: number;
  weaponDamage?: number;
  weaponCooldown?: number;
  antiAir?: boolean;
}

export interface UnitDef {
  type: UnitType;
  name: string;
  cost: number;
  buildTime: number;
  speed: number;
  hp: number;
  weaponRange?: number;
  weaponDamage?: number;
  weaponCooldown?: number;
  isHarvester?: boolean;
  isMCV?: boolean;
  faction?: Faction;
  level?: number;
}

export interface InfantryDef {
  type: InfantryType;
  name: string;
  cost: number;
  buildTime: number;
  speed: number;
  hp: number;
  weaponRange?: number;
  weaponDamage?: number;
  weaponCooldown?: number;
  faction?: Faction;
  level?: number;
}

export interface AircraftDef {
  type: AircraftType;
  name: string;
  cost: number;
  buildTime: number;
  speed: number;
  hp: number;
  weaponRange?: number;
  weaponDamage?: number;
  weaponCooldown?: number;
  faction: Faction;
  level?: number;
}

export const STRUCT_DEFS: Record<StructType, StructDef> = {
  [StructType.None]: { type: StructType.None, name: '', cost: 0, power: 0, drain: 0, buildTime: 0, width: 0, height: 0, hp: 0 },
  [StructType.Const]: { type: StructType.Const, name: 'Construction Yard', cost: 0, power: 0, drain: 0, buildTime: 60, width: 2, height: 2, hp: 1000 },
  [StructType.Power]: { type: StructType.Power, name: 'Power Plant', cost: 300, power: 100, drain: 0, buildTime: 40, width: 2, height: 2, hp: 400, level: 1 },
  [StructType.AdvPower]: { type: StructType.AdvPower, name: 'Advanced Power', cost: 700, power: 200, drain: 0, buildTime: 60, width: 2, height: 2, hp: 500, faction: Faction.Soviets, level: 6 },
  [StructType.Refinery]: { type: StructType.Refinery, name: 'Refinery', cost: 2000, power: 0, drain: 40, buildTime: 80, width: 3, height: 2, hp: 900, level: 1 },
  [StructType.Barracks]: { type: StructType.Barracks, name: 'Barracks', cost: 500, power: 0, drain: 20, buildTime: 40, width: 2, height: 2, hp: 500, faction: Faction.Soviets, level: 1 },
  [StructType.Tent]: { type: StructType.Tent, name: 'Tent', cost: 500, power: 0, drain: 20, buildTime: 40, width: 2, height: 2, hp: 500, faction: Faction.Allies, level: 1 },
  [StructType.WarFactory]: { type: StructType.WarFactory, name: 'War Factory', cost: 2000, power: 0, drain: 30, buildTime: 80, width: 3, height: 2, hp: 1000, level: 3 },
  [StructType.Pillbox]: { type: StructType.Pillbox, name: 'Pillbox', cost: 600, power: 0, drain: 0, buildTime: 30, width: 1, height: 1, hp: 400, weaponRange: 5, weaponDamage: 15, weaponCooldown: 45, faction: Faction.Allies, level: 2 },
  [StructType.Turret]: { type: StructType.Turret, name: 'Turret', cost: 800, power: 0, drain: 20, buildTime: 40, width: 1, height: 1, hp: 500, weaponRange: 6, weaponDamage: 40, weaponCooldown: 50, faction: Faction.Allies, level: 4 },
  [StructType.FlameTurret]: { type: StructType.FlameTurret, name: 'Flame Turret', cost: 1000, power: 0, drain: 20, buildTime: 45, width: 1, height: 1, hp: 450, weaponRange: 4, weaponDamage: 25, weaponCooldown: 30, faction: Faction.Soviets, level: 4 },
  [StructType.Sam]: { type: StructType.Sam, name: 'SAM Site', cost: 750, power: 0, drain: 10, buildTime: 35, width: 1, height: 1, hp: 400, weaponRange: 8, weaponDamage: 50, weaponCooldown: 40, antiAir: true, faction: Faction.Soviets, level: 5 },
  [StructType.AaGun]: { type: StructType.AaGun, name: 'AA Gun', cost: 800, power: 0, drain: 50, buildTime: 40, width: 1, height: 1, hp: 450, weaponRange: 8, weaponDamage: 45, weaponCooldown: 35, antiAir: true, faction: Faction.Allies, level: 5 },
  [StructType.Tesla]: { type: StructType.Tesla, name: 'Tesla Coil', cost: 1500, power: 0, drain: 100, buildTime: 60, width: 1, height: 1, hp: 600, weaponRange: 5, weaponDamage: 80, weaponCooldown: 60, faction: Faction.Soviets, level: 7 },
  [StructType.Tech]: { type: StructType.Tech, name: 'Tech Center', cost: 1500, power: 0, drain: 40, buildTime: 70, width: 2, height: 2, hp: 600, level: 7 },
  [StructType.Helipad]: { type: StructType.Helipad, name: 'Helipad', cost: 500, power: 0, drain: 10, buildTime: 35, width: 2, height: 2, hp: 400, level: 6 },
  [StructType.Airstrip]: { type: StructType.Airstrip, name: 'Airstrip', cost: 500, power: 0, drain: 10, buildTime: 35, width: 3, height: 2, hp: 500, faction: Faction.Soviets, level: 6 },
};

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  [UnitType.None]: { type: UnitType.None, name: '', cost: 0, buildTime: 0, speed: 0, hp: 0 },
  [UnitType.MCV]: { type: UnitType.MCV, name: 'MCV', cost: 2000, buildTime: 80, speed: 1.5, hp: 600, isMCV: true, level: 1 },
  [UnitType.Harvester]: { type: UnitType.Harvester, name: 'Harvester', cost: 1400, buildTime: 60, speed: 1.2, hp: 600, isHarvester: true, level: 1 },
  [UnitType.LightTank]: { type: UnitType.LightTank, name: 'Light Tank', cost: 600, buildTime: 40, speed: 2.5, hp: 300, weaponRange: 5, weaponDamage: 30, weaponCooldown: 45, faction: Faction.Allies, level: 3 },
  [UnitType.MediumTank]: { type: UnitType.MediumTank, name: 'Medium Tank', cost: 800, buildTime: 50, speed: 2.2, hp: 400, weaponRange: 5, weaponDamage: 40, weaponCooldown: 50, faction: Faction.Allies, level: 4 },
  [UnitType.HeavyTank]: { type: UnitType.HeavyTank, name: 'Heavy Tank', cost: 1150, buildTime: 65, speed: 1.8, hp: 600, weaponRange: 5, weaponDamage: 55, weaponCooldown: 55, faction: Faction.Soviets, level: 4 },
  [UnitType.Artillery]: { type: UnitType.Artillery, name: 'Artillery', cost: 1600, buildTime: 75, speed: 1.5, hp: 200, weaponRange: 9, weaponDamage: 70, weaponCooldown: 90, faction: Faction.Allies, level: 5 },
  [UnitType.Apc]: { type: UnitType.Apc, name: 'APC', cost: 800, buildTime: 45, speed: 3, hp: 250, weaponRange: 4, weaponDamage: 20, weaponCooldown: 40, level: 4 },
};

export const INFANTRY_DEFS: Record<InfantryType, InfantryDef> = {
  [InfantryType.None]: { type: InfantryType.None, name: '', cost: 0, buildTime: 0, speed: 0, hp: 0 },
  [InfantryType.Rifle]: { type: InfantryType.Rifle, name: 'Rifle Infantry', cost: 100, buildTime: 15, speed: 1.5, hp: 50, weaponRange: 4, weaponDamage: 8, weaponCooldown: 35, level: 1 },
  [InfantryType.Grenadier]: { type: InfantryType.Grenadier, name: 'Grenadier', cost: 160, buildTime: 20, speed: 1.4, hp: 50, weaponRange: 4, weaponDamage: 20, weaponCooldown: 50, faction: Faction.Allies, level: 2 },
  [InfantryType.Rocket]: { type: InfantryType.Rocket, name: 'Rocket Soldier', cost: 300, buildTime: 30, speed: 1.3, hp: 60, weaponRange: 6, weaponDamage: 35, weaponCooldown: 60, level: 3 },
  [InfantryType.Flamethrower]: { type: InfantryType.Flamethrower, name: 'Flamethrower', cost: 300, buildTime: 30, speed: 1.3, hp: 60, weaponRange: 3, weaponDamage: 30, weaponCooldown: 25, faction: Faction.Soviets, level: 3 },
  [InfantryType.Engineer]: { type: InfantryType.Engineer, name: 'Engineer', cost: 500, buildTime: 25, speed: 1.5, hp: 40, level: 4 },
};

export const AIRCRAFT_DEFS: Record<AircraftType, AircraftDef> = {
  [AircraftType.None]: { type: AircraftType.None, name: '', cost: 0, buildTime: 0, speed: 0, hp: 0, faction: Faction.Allies },
  [AircraftType.Hind]: { type: AircraftType.Hind, name: 'Hind', cost: 1500, buildTime: 60, speed: 4, hp: 200, weaponRange: 6, weaponDamage: 40, weaponCooldown: 40, faction: Faction.Soviets, level: 6 },
  [AircraftType.Longbow]: { type: AircraftType.Longbow, name: 'Longbow', cost: 1800, buildTime: 65, speed: 4, hp: 180, weaponRange: 7, weaponDamage: 45, weaponCooldown: 45, faction: Faction.Allies, level: 6 },
  [AircraftType.Mig]: { type: AircraftType.Mig, name: 'MiG', cost: 1200, buildTime: 50, speed: 6, hp: 150, weaponRange: 5, weaponDamage: 60, weaponCooldown: 50, faction: Faction.Soviets, level: 7 },
  [AircraftType.Yak]: { type: AircraftType.Yak, name: 'Yak', cost: 1000, buildTime: 45, speed: 5, hp: 120, weaponRange: 4, weaponDamage: 25, weaponCooldown: 30, faction: Faction.Soviets, level: 6 },
};

export const ORE_VALUE_PER_UNIT = 25;
export const HARVESTER_CAPACITY = 500;
export const ORE_PER_TICK = 8;
