/**
 * CPU AI ported from CODE/HOUSE.CPP — AI_Building, AI_Unit, AI_Infantry,
 * AI_Aircraft, Expert_AI / AI_Attack (simplified for sim).
 */
import {
  AircraftType,
  Difficulty,
  Faction,
  HouseState,
  InfantryType,
  RULES,
  StructType,
  TICKS_PER_SECOND,
  UnitType,
  Urgency,
  STRUCT_DEFS,
  UNIT_DEFS,
  INFANTRY_DEFS,
  AIRCRAFT_DEFS,
} from '../definitions';
import type { House } from '../entities';
import type { GameSim } from '../sim/GameSim';

interface BuildChoice {
  urgency: Urgency;
  structure: StructType;
}

function roundUp(ratio: number, count: number): number {
  return Math.max(1, Math.ceil(ratio * count));
}

function canBuildStructure(sim: GameSim, house: House, type: StructType): boolean {
  const def = STRUCT_DEFS[type];
  if (!def || type === StructType.None) return false;
  if (def.faction !== undefined && def.faction !== house.faction) return false;
  if ((def.level ?? 1) > house.techLevel) return false;
  if (type === StructType.WarFactory && !hasBarracks(house)) return false;
  if (type === StructType.Tech && !hasWarFactory(house)) return false;
  if ((type === StructType.Helipad || type === StructType.Airstrip) && !hasTech(house)) return false;
  if (type === StructType.Tesla && house.faction !== Faction.Soviets) return false;
  if (type === StructType.AdvPower && house.faction !== Faction.Soviets) return false;
  if (type === StructType.AaGun && house.faction !== Faction.Allies) return false;
  if (type === StructType.Sam && house.faction !== Faction.Soviets) return false;
  if (type === StructType.Airstrip && house.faction !== Faction.Soviets) return false;
  return sim.countBuildings(house.id) < house.maxBuildings;
}

function hasBarracks(h: House): boolean {
  return (h.quantities[StructType.Barracks] ?? 0) + (h.quantities[StructType.Tent] ?? 0) > 0;
}

function hasWarFactory(h: House): boolean {
  return (h.quantities[StructType.WarFactory] ?? 0) > 0;
}

function hasTech(h: House): boolean {
  return (h.quantities[StructType.Tech] ?? 0) > 0;
}

function powerFraction(house: House): number {
  if (house.drain <= 0) return 1;
  return Math.min(1, house.power / house.drain);
}

function availableMoney(house: House): number {
  return house.credits;
}

function canMakeMoney(house: House): boolean {
  return house.credits > 300 || (house.quantities[StructType.Refinery] ?? 0) > 0;
}

function hasIncome(sim: GameSim, house: House): boolean {
  return (
    (house.quantities[StructType.Refinery] ?? 0) > 0 &&
    !sim.isTiberiumShort(house.id) &&
    sim.countUnitsOfType(house.id, UnitType.Harvester) > 0
  );
}

/** HOUSE.CPP AI_Building */
export function aiBuilding(sim: GameSim, house: House): void {
  if (house.buildStructure !== StructType.None || house.pendingStructure !== StructType.None) return;
  if (!house.isBaseBuilding) return;
  if (sim.hasStructureUnderConstruction(house.id)) return;

  const money = availableMoney(house);
  const hasInc = hasIncome(sim, house);
  const curBuildings = sim.countBuildings(house.id);
  const choices: BuildChoice[] = [];
  const enemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;

  const addPower = (type: StructType) => {
    const def = STRUCT_DEFS[type];
    if (!canBuildStructure(sim, house, type)) return;
    if (house.power > house.drain + RULES.powerSurplus) return;
    if (def.cost > money && !hasInc) return;
    choices.push({
      urgency: (house.quantities[StructType.Refinery] ?? 0) === 0 ? Urgency.Low : Urgency.Medium,
      structure: type,
    });
  };

  if (house.faction === Faction.Soviets && hasWarFactory(house)) {
    addPower(StructType.AdvPower);
  }
  addPower(StructType.Power);

  const refCount = house.quantities[StructType.Refinery] ?? 0;
  if (!sim.isTiberiumShort(house.id) && refCount < roundUp(RULES.refineryRatio, curBuildings) && refCount < RULES.refineryLimit) {
    const def = STRUCT_DEFS[StructType.Refinery];
    if (canBuildStructure(sim, house, StructType.Refinery) && (money > def.cost || hasInc)) {
      choices.push({
        urgency: refCount === 0 ? Urgency.High : Urgency.Medium,
        structure: StructType.Refinery,
      });
    }
  }

  const barracksType = house.faction === Faction.Allies ? StructType.Tent : StructType.Barracks;
  const barracksCount = (house.quantities[StructType.Barracks] ?? 0) + (house.quantities[StructType.Tent] ?? 0);
  if (barracksCount < roundUp(RULES.barracksRatio, curBuildings) && barracksCount < RULES.barracksLimit && (money > 500 || hasInc)) {
    const def = STRUCT_DEFS[barracksType];
    if (canBuildStructure(sim, house, barracksType) && (def.cost < money || hasInc)) {
      choices.push({
        urgency: barracksCount > 0 ? Urgency.Low : Urgency.Medium,
        structure: barracksType,
      });
    }
  }

  const warCount = house.quantities[StructType.WarFactory] ?? 0;
  if (warCount < 1 && hasBarracks(house)) {
    const def = STRUCT_DEFS[StructType.WarFactory];
    if (canBuildStructure(sim, house, StructType.WarFactory) && money >= def.cost) {
      choices.push({ urgency: Urgency.Critical, structure: StructType.WarFactory });
    }
  } else if (warCount < roundUp(RULES.warRatio, curBuildings) && warCount < RULES.warLimit && (money > 2000 || hasInc)) {
    const def = STRUCT_DEFS[StructType.WarFactory];
    if (canBuildStructure(sim, house, StructType.WarFactory) && (def.cost < money || hasInc)) {
      choices.push({
        urgency: warCount > 0 ? Urgency.Low : Urgency.Medium,
        structure: StructType.WarFactory,
      });
    }
  }

  const defCount =
    (house.quantities[StructType.Pillbox] ?? 0) +
    (house.quantities[StructType.Turret] ?? 0) +
    (house.quantities[StructType.FlameTurret] ?? 0);
  if (hasWarFactory(house) && defCount < roundUp(RULES.defenseRatio, curBuildings) && defCount < RULES.defenseLimit) {
    const fallbackDefense = Math.random() < 0.5 ? StructType.Pillbox : StructType.Turret;
    const types = [StructType.FlameTurret, fallbackDefense];
    for (const t of types) {
      const def = STRUCT_DEFS[t];
      if (canBuildStructure(sim, house, t) && (def.cost < money || hasInc)) {
        choices.push({ urgency: Urgency.Medium, structure: t });
        break;
      }
    }
  }

  const aaCount = (house.quantities[StructType.Sam] ?? 0) + (house.quantities[StructType.AaGun] ?? 0);
  const airThreat = enemy ? sim.countAircraft(enemy.id) > 0 : false;
  if (airThreat && aaCount < roundUp(RULES.aaRatio, curBuildings) && aaCount < RULES.aaLimit) {
    for (const aaType of [StructType.Sam, StructType.AaGun]) {
      const def = STRUCT_DEFS[aaType];
      if (canBuildStructure(sim, house, aaType) && (def.cost < money || hasInc)) {
        choices.push({
          urgency: aaCount < (enemy ? sim.countAircraft(enemy.id) : 0) ? Urgency.High : Urgency.Medium,
          structure: aaType,
        });
        break;
      }
    }
  }

  if (house.faction === Faction.Soviets) {
    const teslaCount = house.quantities[StructType.Tesla] ?? 0;
    if (teslaCount < roundUp(RULES.teslaRatio, curBuildings) && teslaCount < RULES.teslaLimit && powerFraction(house) >= 1) {
      const def = STRUCT_DEFS[StructType.Tesla];
      if (canBuildStructure(sim, house, StructType.Tesla) && (def.cost < money || hasInc)) {
        choices.push({ urgency: Urgency.Medium, structure: StructType.Tesla });
      }
    }
  }

  if ((house.quantities[StructType.Tech] ?? 0) < 1 && powerFraction(house) >= 1) {
    const def = STRUCT_DEFS[StructType.Tech];
    if (canBuildStructure(sim, house, StructType.Tech) && (def.cost < money || hasInc)) {
      choices.push({ urgency: Urgency.Medium, structure: StructType.Tech });
    }
  }

  if (hasTech(house)) {
    const airFactories = [
      { type: StructType.Helipad, ratio: RULES.helipadRatio, limit: RULES.helipadLimit },
      { type: StructType.Airstrip, ratio: RULES.airstripRatio, limit: RULES.airstripLimit },
    ];
    for (const { type: padType, ratio: padRatio, limit: padLimit } of airFactories) {
      const padCount = house.quantities[padType] ?? 0;
      if (padCount >= roundUp(padRatio, curBuildings) || padCount >= padLimit) continue;

      const def = STRUCT_DEFS[padType];
      if (canBuildStructure(sim, house, padType) && (def.cost < money || hasInc)) {
        choices.push({ urgency: Urgency.Medium, structure: padType });
      }
    }
  }

  if (choices.length === 0) return;

  let best = choices[0];
  for (const c of choices) {
    if (c.urgency > best.urgency) best = c;
  }
  house.pendingStructure = best.structure;
}

/** HOUSE.CPP AI_Unit */
export function aiUnit(sim: GameSim, house: House): void {
  if (house.buildUnit !== UnitType.None) return;
  if (sim.hasProductionQueued(house.id, 'unit')) return;
  if (sim.countUnits(house.id) >= house.maxUnits) return;
  if (!hasWarFactory(house)) return;

  const harvesters = sim.countUnitsOfType(house.id, UnitType.Harvester);
  const refineries = house.quantities[StructType.Refinery] ?? 0;

  if (
    house.iq >= RULES.iqHarvester &&
    house.difficulty !== Difficulty.Hard &&
    !sim.isTiberiumShort(house.id) &&
    refineries > harvesters
  ) {
    house.buildUnit = UnitType.Harvester;
    return;
  }

  if (!house.isBaseBuilding) return;

  for (const need of sim.getTeamNeeds(house.id, 'unit')) {
    const type = need.type as UnitType;
    const def = UNIT_DEFS[type];
    if (sim.canBuildUnitType(house, type) && def.cost <= house.credits) {
      house.buildUnit = type;
      return;
    }
  }

  const weights: { type: UnitType; w: number }[] = [];
  const candidates: UnitType[] = [
    UnitType.LightTank,
    UnitType.MediumTank,
    UnitType.HeavyTank,
    UnitType.Artillery,
    UnitType.Apc,
  ];

  for (const t of candidates) {
    const def = UNIT_DEFS[t];
    if (!sim.canBuildUnitType(house, t)) continue;
    if (def.cost > house.credits) continue;
    const w = def.weaponDamage ? 20 : 1;
    weights.push({ type: t, w });
  }

  if (weights.length === 0) return;
  const total = weights.reduce((s, w) => s + w.w, 0);
  let pick = Math.floor(Math.random() * total);
  for (const w of weights) {
    if (pick < w.w) {
      house.buildUnit = w.type;
      return;
    }
    pick -= w.w;
  }
}

/** HOUSE.CPP AI_Infantry */
export function aiInfantry(sim: GameSim, house: House): void {
  if (house.buildInfantry !== InfantryType.None) return;
  if (sim.hasProductionQueued(house.id, 'infantry')) return;
  if (sim.countInfantry(house.id) >= house.maxInfantry) return;
  if (!hasBarracks(house)) return;
  if (!house.isBaseBuilding) return;

  if (!hasWarFactory(house) && house.credits < RULES.infantryReserve) return;

  const enemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;
  const curInf = sim.countInfantry(house.id);
  const curBld = sim.countBuildings(house.id);

  for (const need of sim.getTeamNeeds(house.id, 'infantry')) {
    const type = need.type as InfantryType;
    const def = INFANTRY_DEFS[type];
    if (sim.canBuildInfantryType(house, type) && def.cost <= house.credits) {
      house.buildInfantry = type;
      return;
    }
  }

  const weights: { type: InfantryType; w: number }[] = [];
  const track: { type: InfantryType; w: number }[] = [
    { type: InfantryType.Rifle, w: 3 },
    { type: InfantryType.Grenadier, w: 5 },
    { type: InfantryType.Rocket, w: 2 },
    { type: InfantryType.Flamethrower, w: 5 },
    { type: InfantryType.Engineer, w: 1 },
  ];

  for (const { type, w } of track) {
    const def = INFANTRY_DEFS[type];
    if (!sim.canBuildInfantryType(house, type)) continue;
    if (def.cost > house.credits && house.credits < RULES.infantryReserve) continue;
    const enemyQ = enemy ? (enemy.quantities[type] ?? 0) : 0;
    const myQ = house.quantities[type] ?? 0;
    if (enemy && enemyQ > myQ) {
      weights.push({ type, w: w + 2 });
    } else if (house.credits > RULES.infantryReserve || curInf < curBld * RULES.infantryBaseMult) {
      weights.push({ type, w });
    }
  }

  if (weights.length === 0) return;
  const total = weights.reduce((s, w) => s + w.w, 0);
  let pick = Math.floor(Math.random() * total);
  for (const w of weights) {
    if (pick < w.w) {
      house.buildInfantry = w.type;
      return;
    }
    pick -= w.w;
  }
}

/** HOUSE.CPP AI_Aircraft */
export function aiAircraft(sim: GameSim, house: House): void {
  if (house.iq < RULES.iqAircraft) return;
  if (house.buildAircraft !== AircraftType.None) return;
  if (sim.hasProductionQueued(house.id, 'aircraft')) return;
  if (sim.countAircraft(house.id) >= house.maxAircraft) return;

  for (const need of sim.getTeamNeeds(house.id, 'aircraft')) {
    const type = need.type as AircraftType;
    const def = AIRCRAFT_DEFS[type];
    if (sim.canBuildAircraftType(house, type) && def.cost <= house.credits) {
      house.buildAircraft = type;
      return;
    }
  }

  const heliPad = house.quantities[StructType.Helipad] ?? 0;
  const airStrip = house.quantities[StructType.Airstrip] ?? 0;
  const heliCount = (house.quantities[AircraftType.Hind] ?? 0) + (house.quantities[AircraftType.Longbow] ?? 0);
  const jetCount = (house.quantities[AircraftType.Mig] ?? 0) + (house.quantities[AircraftType.Yak] ?? 0);

  if (
    house.faction === Faction.Allies &&
    heliPad > heliCount &&
    sim.canBuildAircraftType(house, AircraftType.Longbow)
  ) {
    house.buildAircraft = AircraftType.Longbow;
  } else if (
    house.faction === Faction.Soviets &&
    heliPad > heliCount &&
    sim.canBuildAircraftType(house, AircraftType.Hind)
  ) {
    house.buildAircraft = AircraftType.Hind;
  } else if (
    house.faction === Faction.Soviets &&
    airStrip > jetCount &&
    sim.canBuildAircraftType(house, AircraftType.Mig)
  ) {
    house.buildAircraft = AircraftType.Mig;
  }
}

/** Expert_AI state + attack — simplified */
export function expertAI(sim: GameSim, house: House): void {
  if (house.enemyId !== null) {
    const enemy = sim.getHouse(house.enemyId);
    if (!enemy || enemy.isDefeated || sim.countBuildings(enemy.id) === 0) {
      house.enemyId = null;
    }
  }

  if (house.enemyId === null) {
    const enemies = sim.getHouses().filter((h) => h.id !== house.id && !h.isDefeated);
    if (enemies.length > 0 && sim.countBuildings(house.id) > 0) {
      let best = enemies[0];
      let bestScore = -Infinity;
      for (const e of enemies) {
        const d = Math.hypot(house.centerX - e.centerX, house.centerY - e.centerY);
        const score =
          1000 -
          d * 2 +
          sim.countBuildings(e.id) * 5 +
          (e.buildingsKilled[house.id] ?? 0) * 5 +
          (e.unitsKilled[house.id] ?? 0) +
          (house.lastAttackerId === e.id ? 100 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      house.enemyId = best.id;
    }
  }

  if (house.state === HouseState.Endgame) {
    sim.fireSale(house.id);
    sim.doAllToHunt(house.id);
  } else {
    if (house.state === HouseState.Buildup && house.credits < 25) {
      house.state = HouseState.Broke;
    }
    if (house.state === HouseState.Broke && house.credits >= 25) {
      house.state = HouseState.Buildup;
    }
    if (sim.tick - house.lastAttackTick < RULES.attackedStateTicks) {
      house.state = HouseState.Attacked;
    } else if (house.state === HouseState.Attacked) {
      house.state = HouseState.Buildup;
    }
  }

  const hasFactory =
    (house.quantities[StructType.Const] ?? 0) > 0 ||
    (house.quantities[StructType.Barracks] ?? 0) > 0 ||
    (house.quantities[StructType.Tent] ?? 0) > 0 ||
    (house.quantities[StructType.WarFactory] ?? 0) > 0 ||
    (house.quantities[StructType.Helipad] ?? 0) > 0 ||
    (house.quantities[StructType.Airstrip] ?? 0) > 0;
  if (house.state !== HouseState.Attacked && sim.countBuildings(house.id) > 0 && !hasFactory) {
    house.state = HouseState.Endgame;
    sim.fireSale(house.id);
    sim.doAllToHunt(house.id);
  }

  if (house.credits < 100 && !canMakeMoney(house) && hasWarFactory(house)) {
    aiRaiseMoney(sim, house, Urgency.High);
  }

  if (
    house.state !== HouseState.Buildup &&
    powerFraction(house) < RULES.powerEmergencyFraction &&
    house.power < house.drain - 100
  ) {
    aiRaisePower(sim, house);
  }

  if (house.credits < 1000 && house.power > house.drain + 300) {
    aiLowerPower(sim, house);
  }

  if (house.isAlerted && house.teamTimer <= 0) {
    sim.tryCreateTeamWave(house.id);
  }

  if (house.attackTimer <= 0) {
    aiAttack(sim, house);
  }
}

function aiRaiseMoney(sim: GameSim, house: House, urgency: Urgency): void {
  const sellOrder: { type: StructType; urg: Urgency }[] = [
    { type: StructType.Tech, urg: Urgency.Low },
    { type: StructType.Tesla, urg: Urgency.Medium },
    { type: StructType.Helipad, urg: Urgency.Medium },
  ];
  for (const { type, urg } of sellOrder) {
    if (urgency >= urg) {
      if (sim.sellBuilding(house.id, type)) return;
    }
  }
}

function aiRaisePower(sim: GameSim, house: House): void {
  const order = [StructType.Tech, StructType.Tesla, StructType.Helipad, StructType.Turret];
  for (const t of order) {
    if (sim.sellBuilding(house.id, t)) return;
  }
}

function aiLowerPower(sim: GameSim, house: House): void {
  sim.sellBuilding(house.id, StructType.Power);
}

/** HOUSE.CPP AI_Attack */
function aiAttack(sim: GameSim, house: House): void {
  const forced = sim.countBuildings(house.id) === 0;
  const shuffle = !(sim.tick > TICKS_PER_SECOND * 60 && forced) && Math.random() < 0.33;

  if (!shuffle || forced) {
    for (const u of sim.getUnits()) {
      if (u.houseId !== house.id || u.hp <= 0) continue;
      const def = UNIT_DEFS[u.type];
      if (def.weaponDamage && (forced || Math.random() < 0.75)) {
        sim.assignHunt(u.id, 'unit');
      }
    }
    for (const i of sim.getInfantry()) {
      if (i.houseId !== house.id || i.hp <= 0) continue;
      if (forced || Math.random() < 0.75) {
        sim.assignHunt(i.id, 'infantry');
      }
    }
    for (const a of sim.getAircraft()) {
      if (a.houseId !== house.id || a.hp <= 0) continue;
      if (forced || Math.random() < 0.75) {
        sim.assignHunt(a.id, 'aircraft');
      }
    }
  }

  house.attackTimer =
    RULES.attackInterval * TICKS_PER_SECOND * (0.5 + Math.random());
}

export function processHouseAI(sim: GameSim, house: House): void {
  if (house.isDefeated) return;

  house.attackTimer = Math.max(0, house.attackTimer - 1);
  house.teamTimer = Math.max(0, house.teamTimer - 1);

  if (house.isBaseBuilding || house.iq >= RULES.iqProduction) {
    house.isBaseBuilding = true;
    house.isStarted = true;
    house.isAlerted = true;
  }

  house.aiTimer--;
  if (house.aiTimer <= 0) {
    expertAI(sim, house);
    house.aiTimer = TICKS_PER_SECOND * 5 + Math.floor(Math.random() * TICKS_PER_SECOND / 2);
  }

  aiBuilding(sim, house);
  aiUnit(sim, house);
  aiInfantry(sim, house);
  aiAircraft(sim, house);

  sim.processProduction(house);
  sim.tryPlacePendingStructure(house);
}

