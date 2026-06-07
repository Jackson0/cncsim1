import {
  AircraftType,
  Difficulty,
  Faction,
  HouseState,
  InfantryType,
  Mission,
  StructType,
  UnitType,
} from './definitions';

let nextId = 1;
export function genId(): number {
  return nextId++;
}

export function resetIds(): void {
  nextId = 1;
}

export interface Building {
  id: number;
  houseId: number;
  type: StructType;
  cellX: number;
  cellY: number;
  hp: number;
  maxHp: number;
  buildProgress: number;
  buildTime: number;
  isComplete: boolean;
  weaponCooldown: number;
  isRepairing: boolean;
}

export interface Unit {
  id: number;
  houseId: number;
  type: UnitType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mission: Mission;
  targetId: number | null;
  destX: number;
  destY: number;
  cargo: number;
  weaponCooldown: number;
  teamId: number | null;
  buildProgress?: number;
  buildTime?: number;
}

export interface Infantry {
  id: number;
  houseId: number;
  type: InfantryType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mission: Mission;
  targetId: number | null;
  destX: number;
  destY: number;
  weaponCooldown: number;
  teamId: number | null;
}

export interface Aircraft {
  id: number;
  houseId: number;
  type: AircraftType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mission: Mission;
  targetId: number | null;
  destX: number;
  destY: number;
  weaponCooldown: number;
  teamId: number | null;
}

export interface OrePatch {
  id: number;
  cellX: number;
  cellY: number;
  radius: number;
  amount: number;
}

export interface ProductionQueue {
  kind: 'unit' | 'infantry' | 'aircraft' | 'structure';
  type: UnitType | InfantryType | AircraftType | StructType;
  progress: number;
  total: number;
  factoryId: number | null;
}

export type TeamQuarry =
  | 'anything'
  | 'buildings'
  | 'harvesters'
  | 'vehicles'
  | 'infantry'
  | 'factories'
  | 'defense'
  | 'power';

export type AiPersonality = 'raider' | 'turtle' | 'armor' | 'air' | 'balanced' | 'opportunist';
export type AiProductionProfile = 'economy' | 'infantry' | 'armor' | 'siege' | 'air' | 'finisher';

export interface AiTacticMemory {
  id: string;
  tick: number;
}

export interface TeamWave {
  id: number;
  houseId: number;
  targetHouseId: number;
  unitIds: number[];
  infantryIds: number[];
  aircraftIds: number[];
  quarry: TeamQuarry;
  rallyX: number;
  rallyY: number;
  launchTick: number;
  launched: boolean;
}

export interface House {
  id: number;
  name: string;
  faction: Faction;
  color: number;
  credits: number;
  power: number;
  drain: number;
  iq: number;
  techLevel: number;
  difficulty: Difficulty;
  isBaseBuilding: boolean;
  isDefeated: boolean;
  isStarted: boolean;
  state: HouseState;
  enemyId: number | null;
  centerX: number;
  centerY: number;
  buildStructure: StructType;
  buildUnit: UnitType;
  buildInfantry: InfantryType;
  buildAircraft: AircraftType;
  attackTimer: number;
  aiTimer: number;
  teamTimer: number;
  alertTime: number;
  repairTimer: number;
  lastAttackTick: number;
  lastAttackerId: number | null;
  buildingsKilled: Record<number, number>;
  unitsKilled: Record<number, number>;
  isAlerted: boolean;
  quantities: Record<string, number>;
  maxUnits: number;
  maxInfantry: number;
  maxBuildings: number;
  maxAircraft: number;
  productionQueues: ProductionQueue[];
  pendingStructure: StructType;
  aiPersonality: AiPersonality;
  aiProductionProfile: AiProductionProfile;
  aiActiveTactic: string;
  aiTemplateId: string | null;
  aiTemplateUntilTick: number;
  aiRecentTactics: AiTacticMemory[];
  aiLastEnemyScanTick: number;
  aiLossWindowTick: number;
  aiRecentLosses: number;
  aiPanicUntilTick: number;
}
