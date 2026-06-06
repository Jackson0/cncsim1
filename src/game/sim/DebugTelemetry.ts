import {
  AIRCRAFT_DEFS,
  AircraftType,
  Faction,
  INFANTRY_DEFS,
  InfantryType,
  Mission,
  STRUCT_DEFS,
  StructType,
  UNIT_DEFS,
  UnitType,
} from '../definitions';
import type { Aircraft, Building, House, Infantry, Unit } from '../entities';
import type { MapSetupConfig } from '../mapSetup';
import type { GameSim, SimEvent } from './GameSim';

export const DEFAULT_DEBUG_MAX_TICKS = 30000;

const SNAPSHOT_INTERVAL_TICKS = 1000;
const IMPORTANT_EVENT_LIMIT = 50;
const STALL_MIN_TICK = 10000;
const NO_DAMAGE_STALL_TICKS = 5000;
const NO_BUILDING_DESTROYED_STALL_TICKS = 10000;

type DebugResult = 'defeat' | 'stall' | 'timeout';

interface DebugStop {
  result: DebugResult;
  reason: string;
}

interface HouseTelemetry {
  houseId: number;
  name: string;
  faction: string;
  damageDealt: number;
  damageTaken: number;
  harvestIncome: number;
  buildingsDestroyed: number;
  unitsDestroyed: number;
  infantryDestroyed: number;
  aircraftDestroyed: number;
  losses: number;
  buildOrder: DebugBuildOrderItem[];
}

interface DebugBuildOrderItem {
  tick: number;
  event: 'build' | 'produce';
  kind: string;
  type: string;
}

interface DebugImportantEvent {
  tick: number;
  type: string;
  house?: string;
  targetHouse?: string;
  kind?: string;
  itemType?: string;
  amount?: number;
}

interface DebugHouseSnapshot {
  id: number;
  name: string;
  credits: number;
  power: number;
  drain: number;
  buildings: number;
  units: number;
  infantry: number;
  aircraft: number;
  harvesters: number;
  refineries: number;
  combatUnits: number;
  idleCombatUnits: number;
  attackUnits: number;
  enemyBuildingsRemaining: number;
  score: number;
}

interface DebugTimelineSnapshot {
  tick: number;
  houses: DebugHouseSnapshot[];
}

export interface DebugRunReport {
  run: {
    generatedAt: string;
    maxTicks: number;
    ticksPerFrame: number;
    snapshotIntervalTicks: number;
    map: ReturnType<typeof sanitizeMapConfig>;
  };
  result: {
    type: DebugResult;
    reason: string;
    winner: string | null;
    winnerReason: string;
    finalTick: number;
  };
  scoreboard: DebugHouseSnapshot[];
  timelineSnapshots: DebugTimelineSnapshot[];
  buildOrders: Record<string, DebugBuildOrderItem[]>;
  combatSummary: Record<string, Omit<HouseTelemetry, 'houseId' | 'name' | 'faction' | 'buildOrder'>>;
  economySummary: Record<string, { harvestIncome: number; finalCredits: number; harvesters: number; refineries: number }>;
  importantEvents: DebugImportantEvent[];
  stallDiagnostics: ReturnType<DebugTelemetry['buildStallDiagnostics']>;
  endState: {
    houses: DebugHouseSnapshot[];
    remainingBuildings: Array<{ house: string; type: string; hp: number; cellX: number; cellY: number }>;
  };
}

export class DebugTelemetry {
  private houseStats = new Map<number, HouseTelemetry>();
  private timelineSnapshots: DebugTimelineSnapshot[] = [];
  private importantEvents: DebugImportantEvent[] = [];
  private lastDamageTick = 0;
  private lastBuildingDestroyedTick = 0;
  private sawDamage = false;

  constructor(
    private config: MapSetupConfig,
    private maxTicks: number,
    private ticksPerFrame: number,
  ) {}

  recordTick(sim: GameSim): DebugStop | null {
    this.ensureHouseStats(sim);
    this.recordEvents(sim.tick, sim.events);

    if (sim.tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      this.timelineSnapshots.push({ tick: sim.tick, houses: this.buildHouseSnapshots(sim) });
    }

    return this.getStopCondition(sim);
  }

  buildReport(sim: GameSim, stop: DebugStop): DebugRunReport {
    const scoreboard = this.buildHouseSnapshots(sim).sort((a, b) => b.score - a.score);
    const winner = scoreboard[0] ?? null;
    const buildOrders: Record<string, DebugBuildOrderItem[]> = {};
    const combatSummary: DebugRunReport['combatSummary'] = {};
    const economySummary: DebugRunReport['economySummary'] = {};

    for (const stat of this.houseStats.values()) {
      buildOrders[stat.name] = stat.buildOrder;
      combatSummary[stat.name] = {
        damageDealt: stat.damageDealt,
        damageTaken: stat.damageTaken,
        harvestIncome: stat.harvestIncome,
        buildingsDestroyed: stat.buildingsDestroyed,
        unitsDestroyed: stat.unitsDestroyed,
        infantryDestroyed: stat.infantryDestroyed,
        aircraftDestroyed: stat.aircraftDestroyed,
        losses: stat.losses,
      };

      const house = sim.getHouse(stat.houseId);
      economySummary[stat.name] = {
        harvestIncome: stat.harvestIncome,
        finalCredits: house?.credits ?? 0,
        harvesters: sim.countUnitsOfType(stat.houseId, UnitType.Harvester),
        refineries: house?.quantities[StructType.Refinery] ?? 0,
      };
    }

    return {
      run: {
        generatedAt: new Date().toISOString(),
        maxTicks: this.maxTicks,
        ticksPerFrame: this.ticksPerFrame,
        snapshotIntervalTicks: SNAPSHOT_INTERVAL_TICKS,
        map: sanitizeMapConfig(this.config),
      },
      result: {
        type: stop.result,
        reason: stop.reason,
        winner: winner?.name ?? null,
        winnerReason: stop.result === 'defeat' ? 'last surviving house' : 'score after run stop',
        finalTick: sim.tick,
      },
      scoreboard,
      timelineSnapshots: this.timelineSnapshots,
      buildOrders,
      combatSummary,
      economySummary,
      importantEvents: this.importantEvents,
      stallDiagnostics: this.buildStallDiagnostics(sim, winner?.id ?? null),
      endState: {
        houses: scoreboard,
        remainingBuildings: sim.getBuildings().map((building) => {
          const house = sim.getHouse(building.houseId);
          return {
            house: house?.name ?? String(building.houseId),
            type: building.type,
            hp: building.hp,
            cellX: building.cellX,
            cellY: building.cellY,
          };
        }),
      },
    };
  }

  private ensureHouseStats(sim: GameSim): void {
    for (const house of sim.getHouses()) {
      if (this.houseStats.has(house.id)) continue;
      this.houseStats.set(house.id, {
        houseId: house.id,
        name: house.name,
        faction: Faction[house.faction],
        damageDealt: 0,
        damageTaken: 0,
        harvestIncome: 0,
        buildingsDestroyed: 0,
        unitsDestroyed: 0,
        infantryDestroyed: 0,
        aircraftDestroyed: 0,
        losses: 0,
        buildOrder: [],
      });
    }
  }

  private recordEvents(tick: number, events: SimEvent[]): void {
    for (const event of events) {
      const actor = event.houseId !== undefined ? this.houseStats.get(event.houseId) : undefined;
      const target = event.targetHouseId !== undefined ? this.houseStats.get(event.targetHouseId) : undefined;

      if (event.type === 'damage') {
        const previousDamageTick = this.lastDamageTick;
        this.sawDamage = true;
        this.lastDamageTick = tick;
        actor && (actor.damageDealt += event.amount ?? 0);
        target && (target.damageTaken += event.amount ?? 0);

        if (previousDamageTick > 0 && tick - previousDamageTick > 3000) {
          this.pushImportantEvent(tick, event, 'damage-after-long-quiet');
        }
      }

      if (event.type === 'destroy') {
        this.pushImportantEvent(tick, event, 'destroy');
        if (event.targetKind === 'structure') {
          this.lastBuildingDestroyedTick = tick;
          actor && (actor.buildingsDestroyed += 1);
        } else if (event.targetKind === 'unit') {
          actor && (actor.unitsDestroyed += 1);
        } else if (event.targetKind === 'infantry') {
          actor && (actor.infantryDestroyed += 1);
        } else if (event.targetKind === 'aircraft') {
          actor && (actor.aircraftDestroyed += 1);
        }
        target && (target.losses += 1);
      }

      if ((event.type === 'build' || event.type === 'produce') && actor && event.itemKind && event.itemType) {
        actor.buildOrder.push({
          tick,
          event: event.type,
          kind: event.itemKind,
          type: event.itemType,
        });
        this.pushImportantEvent(tick, event, event.type);
      }

      if (event.type === 'harvest' && actor) {
        actor.harvestIncome += event.amount ?? 0;
      }
    }
  }

  private getStopCondition(sim: GameSim): DebugStop | null {
    if (sim.winnerId !== null) {
      return { result: 'defeat', reason: 'one house remained alive' };
    }

    if (sim.tick >= this.maxTicks) {
      return { result: 'timeout', reason: `reached max tick runtime ${this.maxTicks}` };
    }

    const scoreboard = this.buildHouseSnapshots(sim).sort((a, b) => b.score - a.score);
    const leader = scoreboard[0];
    const runnerUp = scoreboard[1];
    const scoreRatio = leader && runnerUp ? leader.score / Math.max(1, runnerUp.score) : 1;

    if (
      this.sawDamage &&
      sim.tick >= STALL_MIN_TICK &&
      sim.tick - this.lastDamageTick >= NO_DAMAGE_STALL_TICKS &&
      scoreRatio >= 1.35
    ) {
      return {
        result: 'stall',
        reason: `no damage for ${NO_DAMAGE_STALL_TICKS} ticks with a clear score leader`,
      };
    }

    if (
      this.lastBuildingDestroyedTick > 0 &&
      sim.tick >= STALL_MIN_TICK &&
      sim.tick - this.lastBuildingDestroyedTick >= NO_BUILDING_DESTROYED_STALL_TICKS &&
      scoreRatio >= 1.5
    ) {
      return {
        result: 'stall',
        reason: `no building destroyed for ${NO_BUILDING_DESTROYED_STALL_TICKS} ticks with a clear score leader`,
      };
    }

    return null;
  }

  private buildHouseSnapshots(sim: GameSim): DebugHouseSnapshot[] {
    return sim.getHouses().map((house) => this.buildHouseSnapshot(sim, house));
  }

  private buildHouseSnapshot(sim: GameSim, house: House): DebugHouseSnapshot {
    const enemyBuildingsRemaining = sim
      .getHouses()
      .filter((enemy) => enemy.id !== house.id && !enemy.isDefeated)
      .reduce((sum, enemy) => sum + sim.countBuildings(enemy.id), 0);
    const combatUnits = countCombatEntities(sim, house.id);
    const attackUnits = countMissionEntities(sim, house.id, Mission.Attack) + countMissionEntities(sim, house.id, Mission.Hunt);
    const idleCombatUnits = Math.max(0, combatUnits - attackUnits);

    return {
      id: house.id,
      name: house.name,
      credits: house.credits,
      power: house.power,
      drain: house.drain,
      buildings: sim.countBuildings(house.id),
      units: sim.countUnits(house.id),
      infantry: sim.countInfantry(house.id),
      aircraft: sim.countAircraft(house.id),
      harvesters: sim.countUnitsOfType(house.id, UnitType.Harvester),
      refineries: house.quantities[StructType.Refinery] ?? 0,
      combatUnits,
      idleCombatUnits,
      attackUnits,
      enemyBuildingsRemaining,
      score: this.scoreHouse(sim, house),
    };
  }

  private scoreHouse(sim: GameSim, house: House): number {
    const stat = this.houseStats.get(house.id);
    const ownLosses = stat?.losses ?? 0;
    return Math.round(
      house.credits * 0.05 +
        sim.countBuildings(house.id) * 300 +
        sim.countUnits(house.id) * 120 +
        sim.countInfantry(house.id) * 40 +
        sim.countAircraft(house.id) * 180 +
        (stat?.damageDealt ?? 0) * 0.5 +
        (stat?.buildingsDestroyed ?? 0) * 600 -
        ownLosses * 150,
    );
  }

  private pushImportantEvent(tick: number, event: SimEvent, type: string): void {
    this.importantEvents.push({
      tick,
      type,
      house: event.houseId !== undefined ? this.houseStats.get(event.houseId)?.name : undefined,
      targetHouse: event.targetHouseId !== undefined ? this.houseStats.get(event.targetHouseId)?.name : undefined,
      kind: event.itemKind ?? event.targetKind,
      itemType: event.itemType ?? event.targetType,
      amount: event.amount,
    });
    if (this.importantEvents.length > IMPORTANT_EVENT_LIMIT) {
      this.importantEvents.shift();
    }
  }

  private buildStallDiagnostics(sim: GameSim, dominantHouseId: number | null) {
    const dominantHouse = dominantHouseId !== null ? sim.getHouse(dominantHouseId) : undefined;
    const opponents = dominantHouse
      ? sim.getHouses().filter((house) => house.id !== dominantHouse.id)
      : [];
    const crippledHouse = opponents
      .map((house) => this.buildHouseSnapshot(sim, house))
      .sort((a, b) => a.score - b.score)[0];
    const crippledId = crippledHouse?.id ?? null;
    const enemyBuildings = crippledId === null
      ? []
      : sim.getBuildings().filter((building) => building.houseId === crippledId);
    const dominantCombat = dominantHouse ? getCombatEntities(sim, dominantHouse.id) : [];

    return {
      lastDamageTick: this.lastDamageTick,
      lastBuildingDestroyedTick: this.lastBuildingDestroyedTick,
      ticksSinceDamage: sim.tick - this.lastDamageTick,
      ticksSinceBuildingDestroyed: sim.tick - this.lastBuildingDestroyedTick,
      dominantHouse: dominantHouse?.name ?? null,
      crippledHouse: crippledHouse?.name ?? null,
      remainingEnemyBuildings: enemyBuildings.map((building) => ({
        type: building.type,
        hp: building.hp,
        cellX: building.cellX,
        cellY: building.cellY,
      })),
      dominantCombatUnits: {
        total: dominantCombat.length,
        huntMission: dominantCombat.filter((entity) => entity.mission === Mission.Hunt).length,
        attackMission: dominantCombat.filter((entity) => entity.mission === Mission.Attack).length,
        guardMission: dominantCombat.filter((entity) => entity.mission === Mission.Guard).length,
        idleForMoreThan3000Ticks: sim.tick - this.lastDamageTick > 3000 ? dominantCombat.length : 0,
      },
      nearestDominantUnitsToEnemyBuildings: nearestCombatUnitsToBuildings(dominantCombat, enemyBuildings).slice(0, 20),
    };
  }
}

export async function writeDebugReport(report: DebugRunReport): Promise<string> {
  const response = await fetch('/debug-runs/latest-run.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report, null, 2),
  });

  if (!response.ok) {
    throw new Error(`debug report write failed: ${response.status}`);
  }

  const result = (await response.json()) as { path: string };
  return result.path;
}

function countCombatEntities(sim: GameSim, houseId: number): number {
  return getCombatEntities(sim, houseId).length;
}

function countMissionEntities(sim: GameSim, houseId: number, mission: Mission): number {
  return getCombatEntities(sim, houseId).filter((entity) => entity.mission === mission).length;
}

function getCombatEntities(sim: GameSim, houseId: number): Array<Unit | Infantry | Aircraft> {
  const units = sim.getUnits().filter((unit) => unit.houseId === houseId && unit.hp > 0 && (UNIT_DEFS[unit.type].weaponDamage ?? 0) > 0);
  const infantry = sim.getInfantry().filter((inf) => inf.houseId === houseId && inf.hp > 0 && (INFANTRY_DEFS[inf.type].weaponDamage ?? 0) > 0);
  const aircraft = sim.getAircraft().filter((air) => air.houseId === houseId && air.hp > 0 && (AIRCRAFT_DEFS[air.type].weaponDamage ?? 0) > 0);
  return [...units, ...infantry, ...aircraft];
}

function nearestCombatUnitsToBuildings(
  combatUnits: Array<Unit | Infantry | Aircraft>,
  buildings: Building[],
): Array<{ type: string; mission: Mission; distanceToNearestEnemyBuilding: number; weaponRange: number }> {
  if (buildings.length === 0) return [];
  return combatUnits
    .map((entity) => {
      const nearest = buildings.reduce((best, building) => {
        const def = STRUCT_DEFS[building.type];
        const bx = building.cellX + def.width / 2;
        const by = building.cellY + def.height / 2;
        return Math.min(best, Math.hypot(entity.x - bx, entity.y - by));
      }, Number.POSITIVE_INFINITY);
      return {
        type: entity.type,
        mission: entity.mission,
        distanceToNearestEnemyBuilding: Math.round(nearest * 100) / 100,
        weaponRange: weaponRangeFor(entity),
      };
    })
    .sort((a, b) => a.distanceToNearestEnemyBuilding - b.distanceToNearestEnemyBuilding);
}

function weaponRangeFor(entity: Unit | Infantry | Aircraft): number {
  if (Object.values(UnitType).includes(entity.type as UnitType)) {
    return UNIT_DEFS[entity.type as UnitType].weaponRange ?? 0;
  }
  if (Object.values(InfantryType).includes(entity.type as InfantryType)) {
    return INFANTRY_DEFS[entity.type as InfantryType].weaponRange ?? 0;
  }
  return AIRCRAFT_DEFS[entity.type as AircraftType].weaponRange ?? 0;
}

function sanitizeMapConfig(config: MapSetupConfig) {
  return {
    startingCredits: config.startingCredits,
    bases: config.bases.map((base) => ({ ...base, faction: Faction[base.faction] })),
    oreFields: config.oreFields.map((ore) => ({
      ...ore,
      amount: ore.amount === Number.POSITIVE_INFINITY ? 'Infinity' : ore.amount,
    })),
  };
}
