import {
  AircraftType,
  Difficulty,
  Faction,
  HouseState,
  InfantryType,
  Mission,
  ORE_PER_TICK,
  ORE_VALUE_PER_UNIT,
  HARVESTER_CAPACITY,
  RULES,
  StructType,
  TICKS_PER_SECOND,
  UnitType,
  STRUCT_DEFS,
  UNIT_DEFS,
  INFANTRY_DEFS,
  AIRCRAFT_DEFS,
  MAP_COLS,
  MAP_ROWS,
} from '../definitions';
import {
  DEFAULT_MAP_SETUP,
  ORE_FIELD_RADIUS,
  getFactionColorVariant,
  type MapSetupConfig,
} from '../mapSetup';
import {
  genId,
  resetIds,
  type Aircraft,
  type AiPersonality,
  type AiProductionProfile,
  type AiTacticMemory,
  type Building,
  type House,
  type Infantry,
  type OrePatch,
  type ProductionQueue,
  type TeamQuarry,
  type TeamWave,
  type Unit,
} from '../entities';
import { cellKey, dist, moveToward } from '../pathfinding';
import { OccupancyTracker } from '../occupancy';
import { processHouseAI } from '../ai/houseAI';

export interface SimEvent {
  type: 'damage' | 'destroy' | 'build' | 'produce' | 'harvest' | 'attack';
  x: number;
  y: number;
  fromX?: number;
  fromY?: number;
  houseId?: number;
  amount?: number;
  itemKind?: 'structure' | 'unit' | 'infantry' | 'aircraft';
  itemType?: string;
  targetHouseId?: number;
  targetKind?: 'structure' | 'unit' | 'infantry' | 'aircraft';
  targetType?: string;
  message?: string;
}

interface TeamTemplate {
  id: string;
  name: string;
  unit: Partial<Record<UnitType, number>>;
  infantry: Partial<Record<InfantryType, number>>;
  aircraft: Partial<Record<AircraftType, number>>;
  quarry: TeamQuarry;
  profile: AiProductionProfile;
  personalities?: AiPersonality[];
}

const TEAM_TEMPLATES: Record<Faction, TeamTemplate[]> = {
  [Faction.Allies]: [
    {
      id: 'allies-balanced-armor',
      name: 'Balanced Armor',
      unit: { [UnitType.LightTank]: 2, [UnitType.MediumTank]: 2, [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Rifle]: 3, [InfantryType.Rocket]: 2 },
      aircraft: {},
      quarry: 'factories',
      profile: 'armor',
      personalities: ['balanced', 'armor'],
    },
    {
      id: 'allies-artillery-core',
      name: 'Artillery Siege',
      unit: { [UnitType.MediumTank]: 3, [UnitType.Artillery]: 1 },
      infantry: { [InfantryType.Grenadier]: 2 },
      aircraft: {},
      quarry: 'defense',
      profile: 'siege',
      personalities: ['armor', 'opportunist'],
    },
    {
      id: 'allies-infantry-flood',
      name: 'Infantry Flood',
      unit: {},
      infantry: { [InfantryType.Rifle]: 4, [InfantryType.Grenadier]: 3, [InfantryType.Rocket]: 1 },
      aircraft: {},
      quarry: 'buildings',
      profile: 'infantry',
      personalities: ['balanced', 'opportunist'],
    },
    {
      id: 'allies-longbow-harass',
      name: 'Air Harassment',
      unit: {},
      infantry: {},
      aircraft: { [AircraftType.Longbow]: 2 },
      quarry: 'defense',
      profile: 'air',
      personalities: ['air', 'opportunist'],
    },
    {
      id: 'allies-harvester-raid',
      name: 'Harvester Raid',
      unit: { [UnitType.Apc]: 1, [UnitType.LightTank]: 1 },
      infantry: { [InfantryType.Rifle]: 2 },
      aircraft: {},
      quarry: 'harvesters',
      profile: 'economy',
      personalities: ['raider', 'opportunist'],
    },
    {
      id: 'allies-fast-apc-raid',
      name: 'Fast APC Raid',
      unit: { [UnitType.Apc]: 2, [UnitType.LightTank]: 2 },
      infantry: { [InfantryType.Rifle]: 3 },
      aircraft: {},
      quarry: 'power',
      profile: 'infantry',
      personalities: ['raider'],
    },
    {
      id: 'allies-siege-breaker',
      name: 'Siege Breaker',
      unit: { [UnitType.Artillery]: 2, [UnitType.MediumTank]: 2 },
      infantry: { [InfantryType.Rocket]: 2 },
      aircraft: {},
      quarry: 'defense',
      profile: 'siege',
      personalities: ['armor', 'opportunist'],
    },
    {
      id: 'allies-finisher',
      name: 'Base Finisher',
      unit: { [UnitType.MediumTank]: 4, [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Rifle]: 4, [InfantryType.Rocket]: 2 },
      aircraft: {},
      quarry: 'factories',
      profile: 'finisher',
      personalities: ['balanced', 'armor', 'opportunist'],
    },
  ],
  [Faction.Soviets]: [
    {
      id: 'soviet-power-crush',
      name: 'Power Crush',
      unit: { [UnitType.HeavyTank]: 3, [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Rifle]: 2, [InfantryType.Rocket]: 2, [InfantryType.Flamethrower]: 2 },
      aircraft: {},
      quarry: 'power',
      profile: 'armor',
      personalities: ['balanced', 'armor'],
    },
    {
      id: 'soviet-heavy-rush',
      name: 'Heavy Armor Rush',
      unit: { [UnitType.HeavyTank]: 4, [UnitType.Apc]: 1 },
      infantry: {},
      aircraft: {},
      quarry: 'factories',
      profile: 'armor',
      personalities: ['armor'],
    },
    {
      id: 'soviet-flame-flood',
      name: 'Flame Infantry Flood',
      unit: {},
      infantry: { [InfantryType.Rifle]: 4, [InfantryType.Flamethrower]: 3, [InfantryType.Rocket]: 1 },
      aircraft: {},
      quarry: 'buildings',
      profile: 'infantry',
      personalities: ['balanced', 'opportunist'],
    },
    {
      id: 'soviet-air-strike',
      name: 'Air Harassment',
      unit: {},
      infantry: {},
      aircraft: { [AircraftType.Hind]: 2, [AircraftType.Mig]: 1 },
      quarry: 'defense',
      profile: 'air',
      personalities: ['air', 'opportunist'],
    },
    {
      id: 'soviet-harvester-raid',
      name: 'Harvester Raid',
      unit: { [UnitType.HeavyTank]: 1, [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Flamethrower]: 2 },
      aircraft: {},
      quarry: 'harvesters',
      profile: 'economy',
      personalities: ['raider', 'opportunist'],
    },
    {
      id: 'soviet-mixed-assault',
      name: 'Mixed Assault',
      unit: { [UnitType.HeavyTank]: 2, [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Flamethrower]: 3, [InfantryType.Rocket]: 2 },
      aircraft: { [AircraftType.Hind]: 1 },
      quarry: 'power',
      profile: 'armor',
      personalities: ['balanced', 'opportunist'],
    },
    {
      id: 'soviet-scout-probe',
      name: 'Scout Probe',
      unit: { [UnitType.Apc]: 1 },
      infantry: { [InfantryType.Rifle]: 2 },
      aircraft: {},
      quarry: 'harvesters',
      profile: 'infantry',
      personalities: ['raider', 'opportunist'],
    },
    {
      id: 'soviet-finisher',
      name: 'Base Finisher',
      unit: { [UnitType.HeavyTank]: 5 },
      infantry: { [InfantryType.Rocket]: 2 },
      aircraft: {},
      quarry: 'factories',
      profile: 'finisher',
      personalities: ['armor', 'balanced', 'opportunist'],
    },
  ],
};

const PERSONALITY_ORDER: AiPersonality[] = ['balanced', 'raider', 'armor', 'air', 'turtle', 'opportunist'];
const DIFFICULTY_ORDER: Difficulty[] = [Difficulty.Normal, Difficulty.Hard, Difficulty.Easy];

export class GameSim {
  tick = 0;
  houses: House[] = [];
  buildings: Building[] = [];
  units: Unit[] = [];
  infantry: Infantry[] = [];
  aircraft: Aircraft[] = [];
  teamWaves: TeamWave[] = [];
  orePatches: OrePatch[] = [];
  events: SimEvent[] = [];
  blockedCells = new Set<string>();
  winnerId: number | null = null;
  private occupancy = new OccupancyTracker();

  init(config: MapSetupConfig = DEFAULT_MAP_SETUP): void {
    resetIds();
    this.tick = 0;
    this.houses = [];
    this.buildings = [];
    this.units = [];
    this.infantry = [];
    this.aircraft = [];
    this.teamWaves = [];
    this.orePatches = [];
    this.events = [];
    this.blockedCells.clear();
    this.winnerId = null;

    const baseCounts: Record<Faction, number> = {
      [Faction.Allies]: 0,
      [Faction.Soviets]: 0,
    };

    for (const base of config.bases) {
      const variant = baseCounts[base.faction];
      baseCounts[base.faction] += 1;
      const house = this.createHouse(
        base.name,
        base.faction,
        getFactionColorVariant(base.faction, variant),
        config.startingCredits,
        PERSONALITY_ORDER[(this.houses.length + variant) % PERSONALITY_ORDER.length],
        DIFFICULTY_ORDER[this.houses.length % DIFFICULTY_ORDER.length],
      );
      this.spawnMCV(house.id, base.cellX, base.cellY);
      house.centerX = base.cellX;
      house.centerY = base.cellY;
    }

    for (const ore of config.oreFields) {
      this.createOreField(ore.cellX, ore.cellY, ORE_FIELD_RADIUS, ore.amount);
    }

    this.rebuildBlocked();
  }

  private createHouse(
    name: string,
    faction: Faction,
    color: number,
    startingCredits: number,
    personality: AiPersonality,
    difficulty: Difficulty,
  ): House {
    const house: House = {
      id: genId(),
      name,
      faction,
      color,
      credits: startingCredits,
      power: 0,
      drain: 0,
      iq: RULES.maxIQ,
      techLevel: 10,
      difficulty,
      isBaseBuilding: true,
      isDefeated: false,
      isStarted: true,
      state: HouseState.Buildup,
      enemyId: null,
      centerX: 0,
      centerY: 0,
      buildStructure: StructType.None,
      buildUnit: UnitType.None,
      buildInfantry: InfantryType.None,
      buildAircraft: AircraftType.None,
      attackTimer: TICKS_PER_SECOND * 10,
      aiTimer: 0,
      teamTimer: 0,
      alertTime: 0,
      repairTimer: 0,
      lastAttackTick: -Infinity,
      lastAttackerId: null,
      buildingsKilled: {},
      unitsKilled: {},
      isAlerted: true,
      quantities: {},
      maxUnits: RULES.maxUnit,
      maxInfantry: RULES.maxInfantry,
      maxBuildings: RULES.maxBuilding,
      maxAircraft: RULES.maxAircraft,
      productionQueues: [],
      pendingStructure: StructType.None,
      aiPersonality: personality,
      aiProductionProfile: personality === 'air' ? 'air' : personality === 'armor' ? 'armor' : 'economy',
      aiActiveTactic: 'Buildup',
      aiTemplateId: null,
      aiTemplateUntilTick: 0,
      aiRecentTactics: [],
      aiLastEnemyScanTick: -Infinity,
      aiLossWindowTick: 0,
      aiRecentLosses: 0,
      aiPanicUntilTick: 0,
    };
    this.houses.push(house);
    return house;
  }

  private createOreField(cx: number, cy: number, radius: number, amount: number): void {
    this.orePatches.push({
      id: genId(),
      cellX: cx,
      cellY: cy,
      radius,
      amount,
    });
  }

  /** BUILDING.CPP — refinery completion spawns a free harvester */
  private spawnFreeHarvester(houseId: number, refinery: Building): void {
    const def = UNIT_DEFS[UnitType.Harvester];
    const spawnX = refinery.cellX + 1.5;
    const spawnY = refinery.cellY + 2.5;
    this.units.push({
      id: genId(),
      houseId,
      type: UnitType.Harvester,
      x: spawnX,
      y: spawnY,
      hp: def.hp,
      maxHp: def.hp,
      mission: Mission.Harvest,
      targetId: null,
      destX: spawnX,
      destY: spawnY,
      cargo: 0,
      weaponCooldown: 0,
      teamId: null,
    });
    const house = this.getHouse(houseId);
    if (house) {
      this.incQuantity(house, UnitType.Harvester, 1);
      this.events.push({
        type: 'produce',
        x: spawnX,
        y: spawnY,
        houseId,
        itemKind: 'unit',
        itemType: UnitType.Harvester,
        message: 'Harvester (free)',
      });
    }
  }

  private spawnMCV(houseId: number, x: number, y: number): void {
    const def = UNIT_DEFS[UnitType.MCV];
    this.units.push({
      id: genId(),
      houseId,
      type: UnitType.MCV,
      x: x + 0.5,
      y: y + 0.5,
      hp: def.hp,
      maxHp: def.hp,
      mission: Mission.Guard,
      targetId: null,
      destX: x + 0.5,
      destY: y + 0.5,
      cargo: 0,
      weaponCooldown: 0,
      teamId: null,
    });
  }

  getHouses(): House[] {
    return this.houses;
  }

  getHouse(id: number): House | undefined {
    return this.houses.find((h) => h.id === id);
  }

  getBuildings(): Building[] {
    return this.buildings;
  }

  getUnits(): Unit[] {
    return this.units;
  }

  getInfantry(): Infantry[] {
    return this.infantry;
  }

  getAircraft(): Aircraft[] {
    return this.aircraft;
  }

  getOrePatches(): OrePatch[] {
    return this.orePatches;
  }

  countBuildings(houseId: number): number {
    return this.buildings.filter((b) => b.houseId === houseId && b.isComplete).length;
  }

  countUnits(houseId: number): number {
    return this.units.filter((u) => u.houseId === houseId && u.hp > 0).length;
  }

  countInfantry(houseId: number): number {
    return this.infantry.filter((i) => i.houseId === houseId && i.hp > 0).length;
  }

  countAircraft(houseId: number): number {
    return this.aircraft.filter((a) => a.houseId === houseId && a.hp > 0).length;
  }

  getHouseCombatProfile(houseId: number): {
    vehicles: number;
    lightVehicles: number;
    heavyVehicles: number;
    artillery: number;
    apcs: number;
    infantry: number;
    aircraft: number;
    harvesters: number;
    refineries: number;
    factories: number;
    defenses: number;
    antiAir: number;
    power: number;
    drain: number;
    buildings: number;
    combatUnits: number;
    helipads: number;
    airstrips: number;
  } {
    const house = this.getHouse(houseId);
    const vehicles = this.units.filter(
      (u) => u.houseId === houseId && u.hp > 0 && u.type !== UnitType.Harvester && u.type !== UnitType.MCV,
    );
    const buildings = this.buildings.filter((b) => b.houseId === houseId && b.isComplete);
    const defenses = buildings.filter((b) => (STRUCT_DEFS[b.type].weaponDamage ?? 0) > 0);
    const antiAir = buildings.filter((b) => STRUCT_DEFS[b.type].antiAir).length;
    const aircraft = this.countAircraft(houseId);
    const infantry = this.countInfantry(houseId);

    return {
      vehicles: vehicles.length,
      lightVehicles: vehicles.filter((u) => u.type === UnitType.LightTank || u.type === UnitType.Apc).length,
      heavyVehicles: vehicles.filter((u) => u.type === UnitType.MediumTank || u.type === UnitType.HeavyTank).length,
      artillery: vehicles.filter((u) => u.type === UnitType.Artillery).length,
      apcs: vehicles.filter((u) => u.type === UnitType.Apc).length,
      infantry,
      aircraft,
      harvesters: this.countUnitsOfType(houseId, UnitType.Harvester),
      refineries: house?.quantities[StructType.Refinery] ?? 0,
      factories: (house?.quantities[StructType.WarFactory] ?? 0) +
        (house?.quantities[StructType.Barracks] ?? 0) +
        (house?.quantities[StructType.Tent] ?? 0) +
        (house?.quantities[StructType.Helipad] ?? 0) +
        (house?.quantities[StructType.Airstrip] ?? 0),
      defenses: defenses.length,
      antiAir,
      power: house?.power ?? 0,
      drain: house?.drain ?? 0,
      buildings: buildings.length,
      combatUnits: vehicles.length + infantry + aircraft,
      helipads: house?.quantities[StructType.Helipad] ?? 0,
      airstrips: house?.quantities[StructType.Airstrip] ?? 0,
    };
  }

  hasProductionQueued(houseId: number, kind: ProductionQueue['kind']): boolean {
    const house = this.getHouse(houseId);
    return house ? house.productionQueues.some((q) => q.kind === kind) : false;
  }

  countQueued(houseId: number, type: UnitType | InfantryType | AircraftType): number {
    const house = this.getHouse(houseId);
    return house ? house.productionQueues.filter((q) => q.type === type).length : 0;
  }

  countUnitsOfType(houseId: number, type: UnitType): number {
    return this.units.filter((u) => u.houseId === houseId && u.type === type && u.hp > 0).length;
  }

  canBuildUnitType(house: House, type: UnitType): boolean {
    const def = UNIT_DEFS[type];
    if (!def || type === UnitType.None) return false;
    if (def.faction !== undefined && def.faction !== house.faction) return false;
    if ((def.level ?? 1) > house.techLevel) return false;
    if (type !== UnitType.Harvester && type !== UnitType.MCV && !this.hasFactory(house.id, 'war')) return false;
    return true;
  }

  canBuildInfantryType(house: House, type: InfantryType): boolean {
    const def = INFANTRY_DEFS[type];
    if (!def || type === InfantryType.None) return false;
    if (def.faction !== undefined && def.faction !== house.faction) return false;
    if ((def.level ?? 1) > house.techLevel) return false;
    return this.hasFactory(house.id, 'barracks');
  }

  canBuildAircraftType(house: House, type: AircraftType): boolean {
    const def = AIRCRAFT_DEFS[type];
    if (!def || type === AircraftType.None) return false;
    if (def.faction !== house.faction) return false;
    if ((def.level ?? 1) > house.techLevel) return false;
    if (type === AircraftType.Mig || type === AircraftType.Yak) {
      return (house.quantities[StructType.Airstrip] ?? 0) > 0;
    }
    return (house.quantities[StructType.Helipad] ?? 0) > 0;
  }

  getTeamNeeds(
    houseId: number,
    kind: 'unit' | 'infantry' | 'aircraft',
  ): Array<{ type: UnitType | InfantryType | AircraftType; need: number }> {
    const house = this.getHouse(houseId);
    if (!house || !house.isAlerted || house.state === HouseState.Endgame) return [];

    const template = this.pickTeamTemplate(house);
    const needs = kind === 'unit' ? template.unit : kind === 'infantry' ? template.infantry : template.aircraft;
    const result: Array<{ type: UnitType | InfantryType | AircraftType; need: number }> = [];

    for (const [type, amount] of Object.entries(needs)) {
      const wanted = amount ?? 0;
      const available = this.countReadyForTeam(house.id, type) + this.countQueued(house.id, type as UnitType | InfantryType | AircraftType);
      const buildFlag =
        house.buildUnit === type || house.buildInfantry === type || house.buildAircraft === type ? 1 : 0;
      const need = wanted - available - buildFlag;
      if (need > 0) {
        result.push({ type: type as UnitType | InfantryType | AircraftType, need });
      }
    }

    result.sort((a, b) => b.need - a.need);
    return result;
  }

  private pickTeamTemplate(house: House): TeamTemplate {
    const templates = TEAM_TEMPLATES[house.faction].filter((template) =>
      this.isTeamTemplateBuildable(house, template),
    );
    const choices = templates.length > 0 ? templates : TEAM_TEMPLATES[house.faction];
    const cached = choices.find((template) => template.id === house.aiTemplateId);
    if (cached && this.tick < house.aiTemplateUntilTick) return cached;

    const weighted = choices.map((template) => ({
      template,
      weight: this.teamTemplateWeight(house, template),
    }));
    const total = Math.max(1, weighted.reduce((sum, choice) => sum + choice.weight, 0));
    let pick = Math.random() * total;
    let selected = weighted[0].template;

    for (const choice of weighted) {
      pick -= choice.weight;
      if (pick <= 0) {
        selected = choice.template;
        break;
      }
    }

    house.aiTemplateId = selected.id;
    house.aiTemplateUntilTick =
      this.tick + TICKS_PER_SECOND * (18 + Math.floor(Math.random() * 15));
    house.aiActiveTactic = selected.name;
    house.aiProductionProfile = this.chooseProductionProfile(house, selected);
    return selected;
  }

  private teamTemplateWeight(house: House, template: TeamTemplate): number {
    let weight = 10 + this.countTemplateMatch(house, template) * 5;
    const profile = this.getHouseCombatProfile(house.id);
    const enemy = house.enemyId !== null ? this.getHouseCombatProfile(house.enemyId) : null;
    const recentPenalty = this.recentTacticPenalty(house.aiRecentTactics, template.id);

    if (template.personalities?.includes(house.aiPersonality)) weight += 12;
    if (template.profile === house.aiProductionProfile) weight += 8;
    if (house.aiPanicUntilTick > this.tick && template.profile !== 'economy') weight += 18;
    if (enemy) {
      if (template.quarry === 'harvesters' && enemy.harvesters >= 2) weight += 20;
      if (template.quarry === 'power' && enemy.power >= enemy.drain && enemy.drain > 80) weight += 15;
      if (template.quarry === 'defense' && enemy.defenses >= 2) weight += 14;
      if (template.quarry === 'factories' && enemy.factories > profile.factories) weight += 16;
      if (template.profile === 'finisher' && enemy.buildings <= 4) weight += 30;
      if (template.profile === 'air' && enemy.antiAir <= 1) weight += 16;
    }
    if (profile.harvesters === 0 || profile.refineries === 0) {
      weight += template.profile === 'economy' ? 18 : -8;
    }
    if (house.difficulty === Difficulty.Hard && template.profile !== 'economy') weight += 8;
    if (house.difficulty === Difficulty.Easy && template.profile === 'finisher') weight -= 6;
    if (house.aiPersonality === 'turtle' && template.quarry === 'defense') weight += 10;

    return Math.max(1, weight - recentPenalty);
  }

  private countTemplateMatch(house: House, template: TeamTemplate): number {
    let count = 0;
    for (const type of Object.keys(template.unit) as UnitType[]) {
      count += this.countReadyForTeam(house.id, type) + this.countQueued(house.id, type);
    }
    for (const type of Object.keys(template.infantry) as InfantryType[]) {
      count += this.countReadyForTeam(house.id, type) + this.countQueued(house.id, type);
    }
    for (const type of Object.keys(template.aircraft) as AircraftType[]) {
      count += this.countReadyForTeam(house.id, type) + this.countQueued(house.id, type);
    }
    return count;
  }

  private recentTacticPenalty(history: AiTacticMemory[], templateId: string): number {
    return history
      .filter((entry) => entry.id === templateId && this.tick - entry.tick < TICKS_PER_SECOND * 180)
      .reduce((penalty, _entry, index) => penalty + 16 + index * 8, 0);
  }

  private chooseProductionProfile(house: House, template: TeamTemplate): AiProductionProfile {
    const own = this.getHouseCombatProfile(house.id);
    const enemy = house.enemyId !== null ? this.getHouseCombatProfile(house.enemyId) : null;
    if (own.refineries === 0 || own.harvesters === 0 || house.credits < 400) return 'economy';
    if (enemy && enemy.buildings <= 4 && own.combatUnits >= 6) return 'finisher';
    if (house.aiPanicUntilTick > this.tick && own.vehicles >= 2) return 'armor';
    if (template.profile === 'air' && own.helipads + own.airstrips > 0) return 'air';
    if (template.profile === 'siege' && own.factories > 0) return 'siege';
    if (house.aiPersonality === 'armor') return 'armor';
    if (house.aiPersonality === 'air' && own.helipads + own.airstrips > 0) return 'air';
    if (house.aiPersonality === 'raider') return 'infantry';
    return template.profile;
  }

  private isTeamTemplateBuildable(house: House, template: TeamTemplate): boolean {
    for (const type of Object.keys(template.unit) as UnitType[]) {
      if (!this.canBuildUnitType(house, type)) return false;
    }
    for (const type of Object.keys(template.infantry) as InfantryType[]) {
      if (!this.canBuildInfantryType(house, type)) return false;
    }
    for (const type of Object.keys(template.aircraft) as AircraftType[]) {
      if (!this.canBuildAircraftType(house, type)) return false;
    }
    return true;
  }

  private countReadyForTeam(houseId: number, type: string): number {
    if (Object.values(UnitType).includes(type as UnitType)) {
      return this.units.filter(
        (u) =>
          u.houseId === houseId &&
          u.type === type &&
          u.hp > 0 &&
          u.teamId === null &&
          u.type !== UnitType.Harvester &&
          u.type !== UnitType.MCV &&
          u.mission !== Mission.Deploy,
      ).length;
    }
    if (Object.values(InfantryType).includes(type as InfantryType)) {
      return this.infantry.filter(
        (i) => i.houseId === houseId && i.type === type && i.hp > 0 && i.teamId === null,
      ).length;
    }
    return this.aircraft.filter(
      (a) => a.houseId === houseId && a.type === type && a.hp > 0 && a.teamId === null,
    ).length;
  }

  isTiberiumShort(houseId: number): boolean {
    const house = this.getHouse(houseId);
    if (!house) return true;
    const nearOre = this.orePatches.some(
      (o) => o.amount > 0 && dist(o.cellX, o.cellY, house.centerX, house.centerY) < 25,
    );
    return !nearOre;
  }

  hasStructureUnderConstruction(houseId: number): boolean {
    return this.buildings.some((b) => b.houseId === houseId && !b.isComplete);
  }

  rebuildBlocked(): void {
    this.blockedCells.clear();
    for (const b of this.buildings) {
      const def = STRUCT_DEFS[b.type];
      for (let dy = 0; dy < def.height; dy++) {
        for (let dx = 0; dx < def.width; dx++) {
          this.blockedCells.add(cellKey(b.cellX + dx, b.cellY + dy));
        }
      }
    }
  }

  private incQuantity(house: House, key: string, delta: number): void {
    house.quantities[key] = (house.quantities[key] ?? 0) + delta;
  }

  private recalcPower(house: House): void {
    let power = 0;
    let drain = 0;
    for (const b of this.buildings) {
      if (b.houseId !== house.id || !b.isComplete) continue;
      const def = STRUCT_DEFS[b.type];
      power += Math.floor(def.power * Math.max(0, b.hp) / Math.max(1, b.maxHp));
      drain += def.drain;
    }
    house.power = power;
    house.drain = drain;
  }

  tryPlacePendingStructure(house: House): void {
    if (house.pendingStructure === StructType.None) return;
    if (this.hasStructureUnderConstruction(house.id)) return;

    const type = house.pendingStructure;
    const def = STRUCT_DEFS[type];
    if (house.credits < def.cost) {
      house.pendingStructure = StructType.None;
      return;
    }

    const constYard = this.buildings.find(
      (b) => b.houseId === house.id && b.type === StructType.Const && b.isComplete,
    );
    if (!constYard) return;

    const spot = this.findBuildLocation(house.id, def.width, def.height);
    if (!spot) {
      house.pendingStructure = StructType.None;
      return;
    }

    house.credits -= def.cost;
    house.pendingStructure = StructType.None;

    const b: Building = {
      id: genId(),
      houseId: house.id,
      type,
      cellX: spot.x,
      cellY: spot.y,
      hp: def.hp,
      maxHp: def.hp,
      buildProgress: 0,
      buildTime: def.buildTime,
      isComplete: false,
      weaponCooldown: 0,
      isRepairing: false,
    };
    this.buildings.push(b);
    this.events.push({
      type: 'build',
      x: spot.x,
      y: spot.y,
      houseId: house.id,
      itemKind: 'structure',
      itemType: type,
      message: def.name,
    });
    this.rebuildBlocked();
  }

  findBuildLocation(houseId: number, w: number, h: number): { x: number; y: number } | null {
    const house = this.getHouse(houseId);
    if (!house) return null;

    const cx = Math.floor(house.centerX);
    const cy = Math.floor(house.centerY);
    const candidates: { x: number; y: number; score: number }[] = [];

    for (let dy = -12; dy <= 12; dy++) {
      for (let dx = -12; dx <= 12; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (this.canPlaceBuilding(x, y, w, h)) {
          const score = -dist(x, y, cx, cy) + Math.random() * 2;
          candidates.push({ x, y, score });
        }
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  canPlaceBuilding(x: number, y: number, w: number, h: number): boolean {
    if (x < 1 || y < 1 || x + w >= MAP_COLS - 1 || y + h >= MAP_ROWS - 1) return false;
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        if (this.blockedCells.has(cellKey(x + dx, y + dy))) return false;
      }
    }
    return true;
  }

  processProduction(house: House): void {
    if (
      house.buildUnit !== UnitType.None &&
      !this.hasProductionQueued(house.id, 'unit') &&
      this.hasFactory(house.id, 'war')
    ) {
      const def = UNIT_DEFS[house.buildUnit];
      if (house.credits >= def.cost) {
        house.credits -= def.cost;
        const factory = this.buildings.find(
          (b) => b.houseId === house.id && b.type === StructType.WarFactory && b.isComplete,
        );
        house.productionQueues.push({
          kind: 'unit',
          type: house.buildUnit,
          progress: 0,
          total: def.buildTime,
          factoryId: factory?.id ?? null,
        });
        house.buildUnit = UnitType.None;
      }
    }

    if (
      house.buildInfantry !== InfantryType.None &&
      !this.hasProductionQueued(house.id, 'infantry') &&
      this.hasFactory(house.id, 'barracks')
    ) {
      const def = INFANTRY_DEFS[house.buildInfantry];
      if (house.credits >= def.cost) {
        house.credits -= def.cost;
        const barracks = this.buildings.find(
          (b) =>
            b.houseId === house.id &&
            (b.type === StructType.Barracks || b.type === StructType.Tent) &&
            b.isComplete,
        );
        house.productionQueues.push({
          kind: 'infantry',
          type: house.buildInfantry,
          progress: 0,
          total: def.buildTime,
          factoryId: barracks?.id ?? null,
        });
        house.buildInfantry = InfantryType.None;
      }
    }

    if (
      house.buildAircraft !== AircraftType.None &&
      !this.hasProductionQueued(house.id, 'aircraft')
    ) {
      const def = AIRCRAFT_DEFS[house.buildAircraft];
      if (house.credits >= def.cost) {
        const pad = this.buildings.find(
          (b) =>
            b.houseId === house.id &&
            (b.type === StructType.Helipad || b.type === StructType.Airstrip) &&
            b.isComplete,
        );
        if (pad) {
          house.credits -= def.cost;
          house.productionQueues.push({
            kind: 'aircraft',
            type: house.buildAircraft,
            progress: 0,
            total: def.buildTime,
            factoryId: pad.id,
          });
          house.buildAircraft = AircraftType.None;
        }
      }
    }

    for (const q of house.productionQueues) {
      q.progress++;
      if (q.progress < q.total) continue;

      const factory = q.factoryId
        ? this.buildings.find((b) => b.id === q.factoryId)
        : null;
      const spawnX = factory ? factory.cellX + 1 : Math.floor(house.centerX);
      const spawnY = factory ? factory.cellY + 2 : Math.floor(house.centerY);

      if (q.kind === 'unit') {
        const type = q.type as UnitType;
        const def = UNIT_DEFS[type];
        this.units.push({
          id: genId(),
          houseId: house.id,
          type,
          x: spawnX + 0.5,
          y: spawnY + 0.5,
          hp: def.hp,
          maxHp: def.hp,
          mission: type === UnitType.Harvester ? Mission.Harvest : Mission.Guard,
          targetId: null,
          destX: spawnX + 0.5,
          destY: spawnY + 0.5,
          cargo: 0,
          weaponCooldown: 0,
          teamId: null,
        });
        this.incQuantity(house, type, 1);
        this.events.push({
          type: 'produce',
          x: spawnX,
          y: spawnY,
          houseId: house.id,
          itemKind: 'unit',
          itemType: type,
          message: def.name,
        });
      } else if (q.kind === 'infantry') {
        const type = q.type as InfantryType;
        const def = INFANTRY_DEFS[type];
        this.infantry.push({
          id: genId(),
          houseId: house.id,
          type,
          x: spawnX + 0.5,
          y: spawnY + 0.5,
          hp: def.hp,
          maxHp: def.hp,
          mission: Mission.Guard,
          targetId: null,
          destX: spawnX + 0.5,
          destY: spawnY + 0.5,
          weaponCooldown: 0,
          teamId: null,
        });
        this.incQuantity(house, type, 1);
        this.events.push({
          type: 'produce',
          x: spawnX,
          y: spawnY,
          houseId: house.id,
          itemKind: 'infantry',
          itemType: type,
          message: def.name,
        });
      } else if (q.kind === 'aircraft') {
        const type = q.type as AircraftType;
        const def = AIRCRAFT_DEFS[type];
        this.aircraft.push({
          id: genId(),
          houseId: house.id,
          type,
          x: spawnX + 0.5,
          y: spawnY + 0.5,
          hp: def.hp,
          maxHp: def.hp,
          mission: Mission.Guard,
          targetId: null,
          destX: spawnX + 0.5,
          destY: spawnY + 0.5,
          weaponCooldown: 0,
          teamId: null,
        });
        this.incQuantity(house, type, 1);
        this.events.push({
          type: 'produce',
          x: spawnX,
          y: spawnY,
          houseId: house.id,
          itemKind: 'aircraft',
          itemType: type,
          message: def.name,
        });
      }

      q.progress = q.total;
    }

    house.productionQueues = house.productionQueues.filter((q) => q.progress < q.total);
  }

  private hasFactory(houseId: number, kind: 'war' | 'barracks'): boolean {
    return this.buildings.some((b) => {
      if (b.houseId !== houseId || !b.isComplete) return false;
      if (kind === 'war') return b.type === StructType.WarFactory;
      return b.type === StructType.Barracks || b.type === StructType.Tent;
    });
  }

  sellBuilding(houseId: number, type: StructType): boolean {
    const b = this.buildings.find(
      (b) => b.houseId === houseId && b.type === type && b.isComplete,
    );
    if (!b) return false;
    const def = STRUCT_DEFS[type];
    const house = this.getHouse(houseId);
    if (house) house.credits += Math.floor(def.cost * 0.5);
    this.destroyBuilding(b);
    return true;
  }

  assignHunt(id: number, kind: 'unit' | 'infantry' | 'aircraft'): void {
    if (kind === 'unit') {
      const u = this.units.find((u) => u.id === id);
      if (u) {
        u.teamId = null;
        u.targetId = null;
        u.mission = Mission.Hunt;
      }
    } else if (kind === 'infantry') {
      const i = this.infantry.find((i) => i.id === id);
      if (i) {
        i.teamId = null;
        i.targetId = null;
        i.mission = Mission.Hunt;
      }
    } else {
      const a = this.aircraft.find((a) => a.id === id);
      if (a) {
        a.teamId = null;
        a.targetId = null;
        a.mission = Mission.Hunt;
      }
    }
  }

  tryCreateTeamWave(houseId: number): boolean {
    const house = this.getHouse(houseId);
    if (!house || house.teamTimer > 0 || house.enemyId === null || house.state === HouseState.Endgame) {
      return false;
    }

    const template = this.pickTeamTemplate(house);
    const unitIds = this.recruitUnits(house.id, template.unit);
    const infantryIds = this.recruitInfantry(house.id, template.infantry);
    const aircraftIds = this.recruitAircraft(house.id, template.aircraft);
    const required = this.templateSize(template);
    const recruited = unitIds.length + infantryIds.length + aircraftIds.length;
    const minRequired = Math.max(2, Math.ceil(required * this.teamLaunchRatio(house)));

    if (required === 0 || recruited < minRequired) {
      this.clearTeamAssignments([...unitIds, ...infantryIds, ...aircraftIds]);
      return false;
    }

    const enemy = this.getHouse(house.enemyId);
    if (!enemy) {
      this.clearTeamAssignments([...unitIds, ...infantryIds, ...aircraftIds]);
      return false;
    }

    const teamId = genId();
    const rallyX = house.centerX + Math.sign(enemy.centerX - house.centerX) * 4;
    const rallyY = house.centerY;
    for (const u of this.units) {
      if (!unitIds.includes(u.id)) continue;
      u.teamId = teamId;
      u.targetId = null;
      u.destX = rallyX;
      u.destY = rallyY;
      u.mission = Mission.Move;
    }
    for (const i of this.infantry) {
      if (!infantryIds.includes(i.id)) continue;
      i.teamId = teamId;
      i.targetId = null;
      i.destX = rallyX;
      i.destY = rallyY;
      i.mission = Mission.Move;
    }
    for (const a of this.aircraft) {
      if (!aircraftIds.includes(a.id)) continue;
      a.teamId = teamId;
      a.targetId = null;
      a.destX = rallyX;
      a.destY = rallyY;
      a.mission = Mission.Move;
    }

    this.teamWaves.push({
      id: teamId,
      houseId: house.id,
      targetHouseId: enemy.id,
      unitIds,
      infantryIds,
      aircraftIds,
      quarry: template.quarry,
      rallyX,
      rallyY,
      launchTick: this.tick + TICKS_PER_SECOND * 8,
      launched: false,
    });
    house.aiActiveTactic = template.name;
    house.aiProductionProfile = template.profile;
    house.aiRecentTactics = [
      ...house.aiRecentTactics.filter((entry) => this.tick - entry.tick < TICKS_PER_SECOND * 240),
      { id: template.id, tick: this.tick },
    ].slice(-8);
    house.aiTemplateUntilTick = 0;
    house.teamTimer = Math.floor(
      RULES.autocreateTime * TICKS_PER_SECOND * this.teamTimerScale(house) * (7 + Math.random() * 8),
    );
    return true;
  }

  private teamLaunchRatio(house: House): number {
    const gameMinutes = this.tick / (TICKS_PER_SECOND * 60);
    const timeBonus = gameMinutes > 8 ? 0.1 : gameMinutes > 4 ? 0.05 : 0;
    if (house.difficulty === Difficulty.Hard) return Math.min(0.85, 0.72 + timeBonus);
    if (house.difficulty === Difficulty.Easy) return Math.min(0.65, 0.5 + timeBonus);
    return Math.min(0.75, 0.62 + timeBonus);
  }

  private teamTimerScale(house: House): number {
    if (house.aiPanicUntilTick > this.tick) return 0.5;
    if (house.difficulty === Difficulty.Hard) return 0.65;
    if (house.difficulty === Difficulty.Easy) return 1.35;
    return 1;
  }

  fireSale(houseId: number): boolean {
    const targets = this.buildings.filter((b) => b.houseId === houseId && b.isComplete);
    for (const b of [...targets]) {
      this.sellBuilding(houseId, b.type);
    }
    return targets.length > 0;
  }

  doAllToHunt(houseId: number): void {
    for (const u of this.units) {
      if (u.houseId === houseId && u.hp > 0 && u.type !== UnitType.Harvester && u.type !== UnitType.MCV) {
        this.assignHunt(u.id, 'unit');
      }
    }
    for (const i of this.infantry) {
      if (i.houseId === houseId && i.hp > 0) this.assignHunt(i.id, 'infantry');
    }
    for (const a of this.aircraft) {
      if (a.houseId === houseId && a.hp > 0) this.assignHunt(a.id, 'aircraft');
    }
  }

  private templateSize(template: TeamTemplate): number {
    return (
      this.recordTotal(template.unit) +
      this.recordTotal(template.infantry) +
      this.recordTotal(template.aircraft)
    );
  }

  private recordTotal(record: Partial<Record<string, number>>): number {
    return Object.values(record).reduce<number>((sum, value) => sum + (value ?? 0), 0);
  }

  private recruitUnits(houseId: number, needs: Partial<Record<UnitType, number>>): number[] {
    const ids: number[] = [];
    for (const [type, amount] of Object.entries(needs) as Array<[UnitType, number]>) {
      let remaining = amount;
      for (const u of this.units) {
        if (remaining <= 0) break;
        if (
          u.houseId === houseId &&
          u.type === type &&
          u.hp > 0 &&
          u.teamId === null &&
          u.type !== UnitType.Harvester &&
          u.type !== UnitType.MCV
        ) {
          ids.push(u.id);
          u.teamId = -1;
          remaining--;
        }
      }
    }
    return ids;
  }

  private recruitInfantry(houseId: number, needs: Partial<Record<InfantryType, number>>): number[] {
    const ids: number[] = [];
    for (const [type, amount] of Object.entries(needs) as Array<[InfantryType, number]>) {
      let remaining = amount;
      for (const i of this.infantry) {
        if (remaining <= 0) break;
        if (i.houseId === houseId && i.type === type && i.hp > 0 && i.teamId === null) {
          ids.push(i.id);
          i.teamId = -1;
          remaining--;
        }
      }
    }
    return ids;
  }

  private recruitAircraft(houseId: number, needs: Partial<Record<AircraftType, number>>): number[] {
    const ids: number[] = [];
    for (const [type, amount] of Object.entries(needs) as Array<[AircraftType, number]>) {
      let remaining = amount;
      for (const a of this.aircraft) {
        if (remaining <= 0) break;
        if (a.houseId === houseId && a.type === type && a.hp > 0 && a.teamId === null) {
          ids.push(a.id);
          a.teamId = -1;
          remaining--;
        }
      }
    }
    return ids;
  }

  private clearTeamAssignments(ids: number[]): void {
    for (const u of this.units) {
      if (ids.includes(u.id) && u.teamId === -1) u.teamId = null;
    }
    for (const i of this.infantry) {
      if (ids.includes(i.id) && i.teamId === -1) i.teamId = null;
    }
    for (const a of this.aircraft) {
      if (ids.includes(a.id) && a.teamId === -1) a.teamId = null;
    }
  }

  update(): void {
    this.tick++;
    this.events = [];

    for (const house of this.houses) {
      this.recalcPower(house);
      processHouseAI(this, house);
    }

    this.updateBuildingConstruction();
    this.updateLowPowerDamage();
    this.updateBuildingRepair();
    this.initOccupancy();
    this.updateTeamWaves();
    this.updateUnits();
    this.updateInfantry();
    this.updateAircraft();
    this.updateCombat();
    this.updateDefenses();
    this.checkDefeat();
  }

  private updateBuildingConstruction(): void {
    for (const b of this.buildings) {
      if (b.isComplete) continue;
      b.buildProgress++;
      if (b.buildProgress >= b.buildTime) {
        b.isComplete = true;
        const house = this.getHouse(b.houseId);
        if (house) {
          this.incQuantity(house, b.type, 1);
          house.centerX = b.cellX + STRUCT_DEFS[b.type].width / 2;
          house.centerY = b.cellY + STRUCT_DEFS[b.type].height / 2;
          if (b.type === StructType.Refinery) {
            this.spawnFreeHarvester(house.id, b);
          }
        }
        this.rebuildBlocked();
      }
    }
  }

  private updateLowPowerDamage(): void {
    if (this.tick % RULES.lowPowerDamageDelay !== 0) return;

    for (const house of this.houses) {
      if (house.drain <= 0 || house.power >= house.drain) continue;
      for (const b of [...this.buildings]) {
        if (b.houseId !== house.id || !b.isComplete) continue;
        const def = STRUCT_DEFS[b.type];
        if (def.drain <= 0 || b.hp <= b.maxHp * 0.5) continue;
        b.hp -= RULES.lowPowerDamage;
        if (b.hp <= 0) this.destroyBuilding(b);
      }
    }
  }

  private updateBuildingRepair(): void {
    if (this.tick % RULES.repairInterval !== 0) return;

    for (const house of this.houses) {
      house.repairTimer = Math.max(0, house.repairTimer - RULES.repairInterval);

      const repairing = this.buildings.find(
        (b) => b.houseId === house.id && b.isComplete && b.isRepairing && b.hp < b.maxHp,
      );
      if (repairing) {
        this.repairBuildingStep(house, repairing);
        continue;
      }

      if (house.repairTimer > 0 || house.credits < RULES.repairThreshold) continue;

      const damaged = this.buildings
        .filter((b) => b.houseId === house.id && b.isComplete && b.hp > 0 && b.hp < b.maxHp)
        .sort((a, b) => {
          const aConst = a.type === StructType.Const ? 1 : 0;
          const bConst = b.type === StructType.Const ? 1 : 0;
          return bConst - aConst || a.hp / a.maxHp - b.hp / b.maxHp;
        })[0];

      if (damaged) {
        damaged.isRepairing = true;
        house.repairTimer =
          RULES.repairDelayMin +
          Math.floor(Math.random() * (RULES.repairDelayMax - RULES.repairDelayMin + 1));
        this.repairBuildingStep(house, damaged);
      }
    }
  }

  private repairBuildingStep(house: House, b: Building): void {
    const def = STRUCT_DEFS[b.type];
    const cost = Math.max(1, Math.ceil((def.cost / Math.max(1, b.maxHp / RULES.repairStep)) * RULES.repairPercent));
    if (house.credits < cost) {
      b.isRepairing = false;
      return;
    }

    house.credits -= cost;
    b.hp = Math.min(b.maxHp, b.hp + RULES.repairStep);
    if (b.hp >= b.maxHp) b.isRepairing = false;
  }

  private updateTeamWaves(): void {
    for (const team of this.teamWaves) {
      team.unitIds = team.unitIds.filter((id) => this.units.some((u) => u.id === id && u.hp > 0));
      team.infantryIds = team.infantryIds.filter((id) => this.infantry.some((i) => i.id === id && i.hp > 0));
      team.aircraftIds = team.aircraftIds.filter((id) => this.aircraft.some((a) => a.id === id && a.hp > 0));

      if (team.launched) continue;
      if (this.tick < team.launchTick && !this.isTeamAtRally(team)) continue;

      const teamSize = team.unitIds.length + team.infantryIds.length + team.aircraftIds.length;
      const target = this.findBestEnemyTarget(team.houseId, team.rallyX, team.rallyY, team.quarry, teamSize, team.targetHouseId);
      const targetId = target?.id ?? null;
      for (const u of this.units) {
        if (!team.unitIds.includes(u.id)) continue;
        u.targetId = targetId;
        u.mission = targetId === null ? Mission.Hunt : Mission.Attack;
      }
      for (const i of this.infantry) {
        if (!team.infantryIds.includes(i.id)) continue;
        i.targetId = targetId;
        i.mission = targetId === null ? Mission.Hunt : Mission.Attack;
      }
      for (const a of this.aircraft) {
        if (!team.aircraftIds.includes(a.id)) continue;
        a.targetId = targetId;
        a.mission = targetId === null ? Mission.Hunt : Mission.Attack;
      }
      team.launched = true;
    }

    this.teamWaves = this.teamWaves.filter(
      (team) => team.unitIds.length + team.infantryIds.length + team.aircraftIds.length > 0,
    );
  }

  private isTeamAtRally(team: TeamWave): boolean {
    const members = [
      ...this.units.filter((u) => team.unitIds.includes(u.id)),
      ...this.infantry.filter((i) => team.infantryIds.includes(i.id)),
      ...this.aircraft.filter((a) => team.aircraftIds.includes(a.id)),
    ];
    return members.length > 0 && members.every((m) => dist(m.x, m.y, team.rallyX, team.rallyY) < 2.5);
  }

  private initOccupancy(): void {
    this.occupancy.reset();
    for (const u of this.units) {
      if (u.hp > 0) this.occupancy.seedVehicle(u.id, u.x, u.y);
    }
    for (const i of this.infantry) {
      if (i.hp > 0) this.occupancy.seedInfantry(i.id, i.x, i.y);
    }
  }

  private moveUnit(u: Unit, destX: number, destY: number, speed: number): { arrived: boolean } {
    const result = this.occupancy.moveVehicle(
      u.id,
      u.x,
      u.y,
      destX,
      destY,
      speed,
      this.blockedCells,
    );
    u.x = result.x;
    u.y = result.y;
    return { arrived: result.arrived };
  }

  private moveInfantryEntity(
    inf: Infantry,
    destX: number,
    destY: number,
    speed: number,
  ): { arrived: boolean } {
    const result = this.occupancy.moveInfantry(
      inf.id,
      inf.x,
      inf.y,
      destX,
      destY,
      speed,
      this.blockedCells,
    );
    inf.x = result.x;
    inf.y = result.y;
    return { arrived: result.arrived };
  }

  private updateUnits(): void {
    for (const u of this.units) {
      if (u.hp <= 0) continue;
      u.weaponCooldown = Math.max(0, u.weaponCooldown - 1);

      const def = UNIT_DEFS[u.type];

      if (u.type === UnitType.MCV && u.mission === Mission.Guard) {
        u.mission = Mission.Deploy;
      }

      if (u.mission === Mission.Deploy) {
        this.deployMCV(u);
        continue;
      }

      if (u.type === UnitType.Harvester || u.mission === Mission.Harvest) {
        this.updateHarvester(u);
        continue;
      }

      if (u.mission === Mission.Move) {
        this.moveUnit(u, u.destX, u.destY, def.speed * 0.05);
        continue;
      }

      if (u.mission === Mission.Hunt || u.mission === Mission.Attack) {
        this.updateCombatUnit(u, def);
      } else if (u.mission === Mission.Guard && def.weaponDamage) {
        const nearEnemy = this.findEnemyTarget(u.houseId, u.x, u.y, (def.weaponRange ?? 5) + 2, false);
        if (nearEnemy) {
          u.mission = Mission.Attack;
          this.updateCombatUnit(u, def);
        }
      }
    }

    this.units = this.units.filter((u) => u.hp > 0);
  }

  private deployMCV(u: Unit): void {
    const x = Math.floor(u.x);
    const y = Math.floor(u.y);
    if (!this.canPlaceBuilding(x, y, 2, 2)) {
      const spot = this.findBuildLocation(u.houseId, 2, 2);
      if (spot) {
        u.destX = spot.x + 1;
        u.destY = spot.y + 1;
        this.moveUnit(u, u.destX, u.destY, UNIT_DEFS[u.type].speed * 0.05);
      }
      return;
    }

    const def = STRUCT_DEFS[StructType.Const];
    const b: Building = {
      id: genId(),
      houseId: u.houseId,
      type: StructType.Const,
      cellX: x,
      cellY: y,
      hp: def.hp,
      maxHp: def.hp,
      buildProgress: def.buildTime,
      buildTime: def.buildTime,
      isComplete: true,
      weaponCooldown: 0,
      isRepairing: false,
    };
    this.buildings.push(b);
    const house = this.getHouse(u.houseId);
    if (house) {
      this.incQuantity(house, StructType.Const, 1);
      house.centerX = x + 1;
      house.centerY = y + 1;
      house.isStarted = true;
    }
    u.hp = 0;
    this.rebuildBlocked();
    this.events.push({
      type: 'build',
      x,
      y,
      houseId: u.houseId,
      itemKind: 'structure',
      itemType: StructType.Const,
      message: 'Construction Yard',
    });
  }

  private findNearestOre(x: number, y: number): OrePatch | null {
    let best: OrePatch | null = null;
    let bestD = Infinity;
    for (const o of this.orePatches) {
      if (o.amount <= 0) continue;
      const d = dist(x, y, o.cellX, o.cellY);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private findNearestRefinery(houseId: number, x: number, y: number): Building | null {
    let best: Building | null = null;
    let bestD = Infinity;
    for (const b of this.buildings) {
      if (b.houseId !== houseId || b.type !== StructType.Refinery || !b.isComplete) continue;
      const d = dist(x, y, b.cellX + 1, b.cellY + 1);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private updateHarvester(u: Unit): void {
    u.mission = Mission.Harvest;
    const refinery = this.findNearestRefinery(u.houseId, u.x, u.y);

    if (u.cargo >= HARVESTER_CAPACITY && refinery) {
      u.destX = refinery.cellX + 1.5;
      u.destY = refinery.cellY + 2;
      const moved = this.moveUnit(u, u.destX, u.destY, UNIT_DEFS[u.type].speed * 0.05);
      if (moved.arrived) {
        const house = this.getHouse(u.houseId);
        if (house) {
          const value = Math.floor((u.cargo / HARVESTER_CAPACITY) * 700);
          house.credits += value;
          this.events.push({
            type: 'harvest',
            x: u.x,
            y: u.y,
            houseId: u.houseId,
            amount: value,
            message: `+$${value}`,
          });
        }
        u.cargo = 0;
      }
      return;
    }

    const ore = this.findNearestOre(u.x, u.y);
    if (!ore) return;

    u.destX = ore.cellX + 0.5;
    u.destY = ore.cellY + 0.5;
    this.moveUnit(u, u.destX, u.destY, UNIT_DEFS[u.type].speed * 0.05);

    if (dist(u.x, u.y, ore.cellX, ore.cellY) < ore.radius + 1) {
      const mined = Math.min(ORE_PER_TICK * ORE_VALUE_PER_UNIT, ore.amount);
      ore.amount -= mined;
      u.cargo = Math.min(HARVESTER_CAPACITY, u.cargo + mined);
    }
  }

  private updateCombatUnit(
    u: Unit,
    def: (typeof UNIT_DEFS)[UnitType],
  ): void {
    const target = this.getAssignedTarget(u.targetId, u.houseId, false) ??
      (u.mission === Mission.Attack ? this.findBestEnemyTarget(u.houseId, u.x, u.y, 'anything') : null) ??
      this.findEnemyTarget(u.houseId, u.x, u.y, def.weaponRange ?? 5, false);
    if (target) {
      const tx = 'cellX' in target ? target.cellX + 0.5 : target.x;
      const ty = 'cellX' in target ? target.cellY + 0.5 : target.y;
      const range = def.weaponRange ?? 5;
      if (dist(u.x, u.y, tx, ty) <= range) {
        if (u.weaponCooldown <= 0) {
          this.dealDamage(target, def.weaponDamage ?? 10, u.houseId, u.x, u.y, { kind: 'unit', type: u.type });
          u.weaponCooldown = def.weaponCooldown ?? 45;
        }
      } else {
        this.moveUnit(u, tx, ty, def.speed * 0.05);
      }
    } else if (u.mission === Mission.Hunt) {
      const enemyHouse = this.getHouse(
        this.getHouse(u.houseId)?.enemyId ?? -1,
      );
      if (enemyHouse) {
        this.moveUnit(u, enemyHouse.centerX, enemyHouse.centerY, def.speed * 0.05);
      }
    }
  }

  private updateInfantry(): void {
    for (const i of this.infantry) {
      if (i.hp <= 0) continue;
      i.weaponCooldown = Math.max(0, i.weaponCooldown - 1);
      const def = INFANTRY_DEFS[i.type];

      if (i.mission === Mission.Guard && def.weaponDamage) {
        const nearEnemy = this.findEnemyTarget(i.houseId, i.x, i.y, (def.weaponRange ?? 4) + 2, false);
        if (nearEnemy) i.mission = Mission.Attack;
      }

      if (i.mission === Mission.Move) {
        this.moveInfantryEntity(i, i.destX, i.destY, def.speed * 0.05);
        continue;
      }

      if (i.mission === Mission.Hunt || i.mission === Mission.Attack) {
        const target = this.getAssignedTarget(i.targetId, i.houseId, false) ??
          (i.mission === Mission.Attack ? this.findBestEnemyTarget(i.houseId, i.x, i.y, 'anything') : null) ??
          this.findEnemyTarget(i.houseId, i.x, i.y, def.weaponRange ?? 4, false);
        if (target) {
          const tx = 'cellX' in target ? target.cellX + 0.5 : target.x;
          const ty = 'cellX' in target ? target.cellY + 0.5 : target.y;
          if (dist(i.x, i.y, tx, ty) <= (def.weaponRange ?? 4)) {
            if (i.weaponCooldown <= 0) {
              this.dealDamage(target, def.weaponDamage ?? 5, i.houseId, i.x, i.y, { kind: 'infantry', type: i.type });
              i.weaponCooldown = def.weaponCooldown ?? 35;
            }
          } else {
            this.moveInfantryEntity(i, tx, ty, def.speed * 0.05);
          }
        } else {
          const enemy = this.getHouse(this.getHouse(i.houseId)?.enemyId ?? -1);
          if (enemy) {
            this.moveInfantryEntity(i, enemy.centerX, enemy.centerY, def.speed * 0.05);
          }
        }
      }
    }
    this.infantry = this.infantry.filter((i) => i.hp > 0);
  }

  private updateAircraft(): void {
    for (const a of this.aircraft) {
      if (a.hp <= 0) continue;
      a.weaponCooldown = Math.max(0, a.weaponCooldown - 1);
      const def = AIRCRAFT_DEFS[a.type];

      if (a.mission === Mission.Move) {
        const moved = moveToward(a.x, a.y, a.destX, a.destY, def.speed * 0.05);
        a.x = moved.x;
        a.y = moved.y;
        continue;
      }

      if (a.mission === Mission.Hunt || a.mission === Mission.Attack) {
        const target = this.getAssignedTarget(a.targetId, a.houseId, false) ??
          this.findBestEnemyTarget(a.houseId, a.x, a.y, 'anything') ??
          this.findEnemyTarget(a.houseId, a.x, a.y, def.weaponRange ?? 6, false);
        if (target) {
          const tx = 'cellX' in target ? target.cellX + 0.5 : target.x;
          const ty = 'cellX' in target ? target.cellY + 0.5 : target.y;
          if (dist(a.x, a.y, tx, ty) <= (def.weaponRange ?? 6)) {
            if (a.weaponCooldown <= 0) {
              this.dealDamage(target, def.weaponDamage ?? 30, a.houseId, a.x, a.y, { kind: 'aircraft', type: a.type });
              a.weaponCooldown = def.weaponCooldown ?? 40;
            }
          } else {
            const moved = moveToward(a.x, a.y, tx, ty, def.speed * 0.05);
            a.x = moved.x;
            a.y = moved.y;
          }
        } else {
          const enemy = this.getHouse(this.getHouse(a.houseId)?.enemyId ?? -1);
          if (enemy) {
            const moved = moveToward(a.x, a.y, enemy.centerX, enemy.centerY, def.speed * 0.05);
            a.x = moved.x;
            a.y = moved.y;
          }
        }
      }
    }
    this.aircraft = this.aircraft.filter((a) => a.hp > 0);
  }

  private updateDefenses(): void {
    for (const b of this.buildings) {
      if (!b.isComplete) continue;
      const def = STRUCT_DEFS[b.type];
      if (!def.weaponRange) continue;
      if (this.isPoweredOffline(b)) continue;
      b.weaponCooldown = Math.max(0, b.weaponCooldown - 1);
      if (b.weaponCooldown > 0) continue;

      const bx = b.cellX + 0.5;
      const by = b.cellY + 0.5;
      const target = this.findEnemyTarget(b.houseId, bx, by, def.weaponRange, def.antiAir ?? false);
      if (target) {
        this.dealDamage(target, def.weaponDamage ?? 10, b.houseId, bx, by, { kind: 'structure', type: b.type });
        b.weaponCooldown = def.weaponCooldown ?? 45;
      }
    }
  }

  private updateCombat(): void {
    // Units can fire at each other when in guard near enemies
    for (const u of this.units) {
      if (u.hp <= 0 || u.mission === Mission.Harvest || u.type === UnitType.MCV) continue;
      if (u.mission !== Mission.Guard) continue;
      const def = UNIT_DEFS[u.type];
      if (!def.weaponDamage) continue;
      const nearEnemy = this.findEnemyTarget(u.houseId, u.x, u.y, def.weaponRange ?? 5, false);
      if (nearEnemy && u.weaponCooldown <= 0) {
        this.dealDamage(nearEnemy, def.weaponDamage, u.houseId, u.x, u.y, { kind: 'unit', type: u.type });
        u.weaponCooldown = def.weaponCooldown ?? 45;
      }
    }
  }

  private isPoweredOffline(b: Building): boolean {
    const def = STRUCT_DEFS[b.type];
    const house = this.getHouse(b.houseId);
    return !!house && def.drain > 0 && house.drain > 0 && house.power < house.drain;
  }

  findBestEnemyTarget(
    houseId: number,
    x: number,
    y: number,
    quarry: TeamQuarry,
    teamSize = 0,
    preferredHouseId: number | null = null,
  ): Building | Unit | Infantry | Aircraft | null {
    let best: Building | Unit | Infantry | Aircraft | null = null;
    let bestScore = -Infinity;

    const score = (entity: Building | Unit | Infantry | Aircraft): number => {
      const pos = this.targetPosition(entity);
      const preferredBonus = preferredHouseId !== null && entity.houseId === preferredHouseId ? 40 : 0;
      return (
        this.quarryPriority(entity, quarry, teamSize) +
        this.tacticalTargetBonus(entity, teamSize) +
        preferredBonus -
        dist(x, y, pos.x, pos.y) * 2
      );
    };

    for (const entity of this.enemyTargets(houseId, false)) {
      const next = score(entity);
      if (next > bestScore) {
        bestScore = next;
        best = entity;
      }
    }

    return best;
  }

  private getAssignedTarget(
    targetId: number | null,
    attackerHouseId: number,
    airOnly: boolean,
  ): Building | Unit | Infantry | Aircraft | null {
    if (targetId === null) return null;
    const target = this.getTargetById(targetId);
    if (!target || target.houseId === attackerHouseId) return null;
    if ('cellX' in target && !target.isComplete) return null;
    if (!('cellX' in target) && target.hp <= 0) return null;
    if (airOnly && !this.isAircraft(target)) return null;
    if (!airOnly && this.isAircraft(target)) return null;
    return target;
  }

  private getTargetById(id: number): Building | Unit | Infantry | Aircraft | null {
    return (
      this.buildings.find((b) => b.id === id) ??
      this.units.find((u) => u.id === id) ??
      this.infantry.find((i) => i.id === id) ??
      this.aircraft.find((a) => a.id === id) ??
      null
    );
  }

  private enemyTargets(houseId: number, airOnly: boolean): Array<Building | Unit | Infantry | Aircraft> {
    const targets: Array<Building | Unit | Infantry | Aircraft> = [];
    if (!airOnly) {
      targets.push(...this.buildings.filter((b) => b.houseId !== houseId && b.isComplete));
      targets.push(...this.units.filter((u) => u.houseId !== houseId && u.hp > 0));
      targets.push(...this.infantry.filter((i) => i.houseId !== houseId && i.hp > 0));
    } else {
      targets.push(...this.aircraft.filter((a) => a.houseId !== houseId && a.hp > 0));
    }
    return targets;
  }

  private targetPosition(target: Building | Unit | Infantry | Aircraft): { x: number; y: number } {
    return 'cellX' in target
      ? { x: target.cellX + 0.5, y: target.cellY + 0.5 }
      : { x: target.x, y: target.y };
  }

  private quarryPriority(
    target: Building | Unit | Infantry | Aircraft,
    quarry: TeamQuarry,
    teamSize: number,
  ): number {
    const targetHouse = this.getHouseCombatProfile(target.houseId);
    if ('cellX' in target) {
      const def = STRUCT_DEFS[target.type];
      const isFactory =
        target.type === StructType.Const ||
        target.type === StructType.WarFactory ||
        target.type === StructType.Barracks ||
        target.type === StructType.Tent ||
        target.type === StructType.Helipad ||
        target.type === StructType.Airstrip;
      const isDefense = (def.weaponDamage ?? 0) > 0;
      const isPower = def.power > 0;
      const isTech = target.type === StructType.Tech || target.type === StructType.Tesla;
      if (quarry === 'factories' && isFactory) return 500;
      if (quarry === 'defense' && isDefense) return 500;
      if (quarry === 'power' && isPower) return targetHouse.drain > 80 ? 560 : 500;
      if (quarry === 'buildings') return 350;
      if (isTech && targetHouse.power >= targetHouse.drain) return 260;
      return 120 + def.cost / 20;
    }

    if ('cargo' in target) {
      if (quarry === 'harvesters' && target.type === UnitType.Harvester) {
        return targetHouse.refineries >= 2 || targetHouse.harvesters >= 2 ? 580 : 500;
      }
      if (quarry === 'vehicles') return 350;
      if (teamSize <= 3 && target.type === UnitType.Harvester) return 250;
      return target.type === UnitType.Harvester ? 180 : 120;
    }

    if (this.isAircraft(target)) {
      return 100;
    }

    return quarry === 'infantry' ? 350 : 80;
  }

  private tacticalTargetBonus(target: Building | Unit | Infantry | Aircraft, teamSize: number): number {
    let bonus = 0;
    const hpRatio = target.maxHp > 0 ? target.hp / target.maxHp : 1;
    if (hpRatio < 0.35) bonus += 70;
    else if (hpRatio < 0.65) bonus += 35;

    if (!('cellX' in target) && teamSize > 0 && teamSize <= 3) {
      const nearbyAllies = this.enemyTargets(-1, false).filter((entity) => {
        if (entity.houseId !== target.houseId || entity.id === target.id) return false;
        const a = this.targetPosition(entity);
        const b = this.targetPosition(target);
        return dist(a.x, a.y, b.x, b.y) < 5;
      }).length;
      if (nearbyAllies <= 1) bonus += 45;
    }

    return bonus;
  }

  private isAircraft(target: Building | Unit | Infantry | Aircraft): target is Aircraft {
    return !('cellX' in target) && !('cargo' in target) && Object.values(AircraftType).includes(target.type as AircraftType);
  }

  findEnemyTarget(
    houseId: number,
    x: number,
    y: number,
    range: number,
    airOnly: boolean,
  ): Building | Unit | Infantry | Aircraft | null {
    let best: Building | Unit | Infantry | Aircraft | null = null;
    let bestD = range;

    const check = (tx: number, ty: number, entity: Building | Unit | Infantry | Aircraft) => {
      const d = dist(x, y, tx, ty);
      if (d <= bestD) {
        bestD = d;
        best = entity;
      }
    };

    for (const target of this.enemyTargets(houseId, airOnly)) {
      const pos = this.targetPosition(target);
      check(pos.x, pos.y, target);
    }

    return best;
  }

  private dealDamage(
    target: Building | Unit | Infantry | Aircraft,
    damage: number,
    attackerHouseId: number,
    fromX?: number,
    fromY?: number,
    attacker?: { kind: 'structure' | 'unit' | 'infantry' | 'aircraft'; type: string },
  ): void {
    const wasAlive = target.hp > 0;
    target.hp -= damage;
    const tx = 'cellX' in target ? target.cellX + 0.5 : target.x;
    const ty = 'cellY' in target ? target.cellY + 0.5 : target.y;
    const targetMeta = this.getTargetMeta(target);
    if (targetMeta.houseId !== attackerHouseId) {
      const defender = this.getHouse(targetMeta.houseId);
      if (defender) {
        defender.lastAttackTick = this.tick;
        defender.lastAttackerId = attackerHouseId;
        defender.enemyId = attackerHouseId;
      }
    }
    this.events.push({
      type: 'damage',
      x: tx,
      y: ty,
      fromX,
      fromY,
      houseId: attackerHouseId,
      amount: damage,
      itemKind: attacker?.kind,
      itemType: attacker?.type,
      targetHouseId: targetMeta.houseId,
      targetKind: targetMeta.kind,
      targetType: targetMeta.type,
    });

    if (wasAlive && target.hp <= 0) {
      const attacker = this.getHouse(attackerHouseId);
      if (attacker) {
        const record = targetMeta.kind === 'structure' ? attacker.buildingsKilled : attacker.unitsKilled;
        record[targetMeta.houseId] = (record[targetMeta.houseId] ?? 0) + 1;
      }
      if (targetMeta.houseId !== attackerHouseId) {
        this.recordAiLoss(targetMeta.houseId, targetMeta.kind, targetMeta.type);
      }
      if ('cellX' in target) {
        this.destroyBuilding(target);
      } else if ('cargo' in target) {
        const house = this.getHouse(target.houseId);
        if (house) this.incQuantity(house, target.type, -1);
      } else if ('type' in target && Object.values(InfantryType).includes(target.type as InfantryType)) {
        const house = this.getHouse(target.houseId);
        if (house) this.incQuantity(house, target.type, -1);
      } else if ('type' in target && Object.values(AircraftType).includes(target.type as AircraftType)) {
        const house = this.getHouse(target.houseId);
        if (house) this.incQuantity(house, target.type, -1);
      }
      this.events.push({
        type: 'destroy',
        x: tx,
        y: ty,
        houseId: attackerHouseId,
        targetHouseId: targetMeta.houseId,
        targetKind: targetMeta.kind,
        targetType: targetMeta.type,
      });
    }
  }

  private getTargetMeta(
    target: Building | Unit | Infantry | Aircraft,
  ): {
    houseId: number;
    kind: 'structure' | 'unit' | 'infantry' | 'aircraft';
    type: string;
  } {
    if ('cellX' in target) {
      return { houseId: target.houseId, kind: 'structure', type: target.type };
    }
    if ('cargo' in target) {
      return { houseId: target.houseId, kind: 'unit', type: target.type };
    }
    if (Object.values(InfantryType).includes(target.type as InfantryType)) {
      return { houseId: target.houseId, kind: 'infantry', type: target.type };
    }
    return { houseId: target.houseId, kind: 'aircraft', type: target.type };
  }

  private recordAiLoss(
    houseId: number,
    kind: 'structure' | 'unit' | 'infantry' | 'aircraft',
    type: string,
  ): void {
    const house = this.getHouse(houseId);
    if (!house || house.isDefeated) return;

    if (this.tick - house.aiLossWindowTick > TICKS_PER_SECOND * 30) {
      house.aiLossWindowTick = this.tick;
      house.aiRecentLosses = 0;
    }

    house.aiRecentLosses += 1;
    const majorStructure =
      kind === 'structure' &&
      (type === StructType.Refinery ||
        type === StructType.WarFactory ||
        type === StructType.Const ||
        type === StructType.Tech);
    const majorUnitLosses = kind !== 'structure' && house.aiRecentLosses >= 3;

    if (majorStructure || majorUnitLosses) {
      house.aiPanicUntilTick = this.tick + TICKS_PER_SECOND * 45;
      house.aiActiveTactic = 'Panic Counterattack';
      house.aiTemplateUntilTick = 0;
      house.teamTimer = 0;
      house.attackTimer = 0;
    }
  }

  private destroyBuilding(b: Building): void {
    const house = this.getHouse(b.houseId);
    if (house) this.incQuantity(house, b.type, -1);
    this.buildings = this.buildings.filter((x) => x.id !== b.id);
    this.rebuildBlocked();
  }

  private checkDefeat(): void {
    for (const house of this.houses) {
      if (house.isDefeated) continue;
      const hasConst = this.buildings.some(
        (b) => b.houseId === house.id && b.type === StructType.Const && b.isComplete && b.hp > 0,
      );
      const hasUnits =
        this.countUnits(house.id) +
          this.countInfantry(house.id) +
          this.countBuildings(house.id) >
        0;
      if (!hasConst && !hasUnits) {
        house.isDefeated = true;
      }
    }

    const alive = this.houses.filter((h) => !h.isDefeated);
    if (alive.length === 1) {
      this.winnerId = alive[0].id;
    }
  }

  getOreAt(cellX: number, cellY: number): number {
    for (const o of this.orePatches) {
      if (dist(cellX, cellY, o.cellX, o.cellY) <= o.radius) {
        return o.amount;
      }
    }
    return 0;
  }
}
