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
  STRATEGY_DEFS,
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

function wantsAirInfra(house: House): boolean {
  return STRATEGY_DEFS[house.aiStrategy].wantsAir || house.aiPersonality === 'air';
}

/**
 * Credits an air-seeking house should keep in reserve so ground production does
 * not starve its tech path: first the Tech Center + air pad, then each aircraft
 * up to one per pad. Returns 0 once the air force is established.
 */
function airCreditReserve(sim: GameSim, house: House): number {
  if (!wantsAirInfra(house)) return 0;
  const pads = (house.quantities[StructType.Helipad] ?? 0) + (house.quantities[StructType.Airstrip] ?? 0);
  // Keep the reserve above structure cost (2000) so credits actually accumulate
  // toward the refinery/war-factory/tech path instead of leaking into tanks.
  if ((house.quantities[StructType.Tech] ?? 0) < 1 || pads < 1) return 2100;
  // Guarantee at least one aircraft takes to the field, then let ground
  // production resume and top up the air force opportunistically.
  if (sim.countAircraft(house.id) < 1) return 2000;
  return 0;
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

function difficultyAttackScale(difficulty: Difficulty): number {
  if (difficulty === Difficulty.Easy) return 2;
  if (difficulty === Difficulty.Hard) return 0.6;
  return 1;
}

function difficultySkipChance(difficulty: Difficulty): number {
  if (difficulty === Difficulty.Easy) return 0.4;
  if (difficulty === Difficulty.Hard) return 0;
  return 0.25;
}

function armedGroundCount(sim: GameSim, house: House): number {
  return sim.getUnits().filter((u) => {
    if (u.houseId !== house.id || u.hp <= 0) return false;
    return (UNIT_DEFS[u.type].weaponDamage ?? 0) > 0;
  }).length + sim.getInfantry().filter((i) => i.houseId === house.id && i.hp > 0).length;
}

/** HOUSE.CPP AI_Building */
export function aiBuilding(sim: GameSim, house: House): void {
  if (house.buildStructure !== StructType.None || house.pendingStructure !== StructType.None) return;
  if (!house.isBaseBuilding) return;
  if (sim.hasStructureUnderConstruction(house.id)) return;

  const strat = STRATEGY_DEFS[house.aiStrategy];
  const money = availableMoney(house);
  const hasInc = hasIncome(sim, house);
  const curBuildings = sim.countBuildings(house.id);
  const choices: BuildChoice[] = [];
  const enemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;
  const enemyProfile = enemy ? sim.getHouseCombatProfile(enemy.id) : null;
  const pendingDrain = sim.getBuildings()
    .filter((b) => b.houseId === house.id && !b.isComplete)
    .reduce((sum, b) => sum + STRUCT_DEFS[b.type].drain, 0);

  const addPower = (type: StructType) => {
    const def = STRUCT_DEFS[type];
    if (!canBuildStructure(sim, house, type)) return;
    if (house.power > house.drain + pendingDrain + RULES.powerSurplus) return;
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
  const refineryRatio = RULES.refineryRatio * strat.refineryRatioMult;
  if (!sim.isTiberiumShort(house.id) && refCount < roundUp(refineryRatio, curBuildings) && refCount < strat.refineryLimit) {
    const def = STRUCT_DEFS[StructType.Refinery];
    if (canBuildStructure(sim, house, StructType.Refinery) && (money > def.cost || hasInc)) {
      const wantsStrongEconomy =
        strat.preferredProfile === 'economy' || house.aiStrategy === 'boom';
      choices.push({
        urgency: refCount === 0 || wantsStrongEconomy ? Urgency.High : Urgency.Medium,
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
  if (warCount < 1 && hasBarracks(house) && curBuildings >= strat.warFactoryAfterBuildings) {
    const def = STRUCT_DEFS[StructType.WarFactory];
    if (canBuildStructure(sim, house, StructType.WarFactory) && money >= def.cost) {
      choices.push({ urgency: Urgency.Critical, structure: StructType.WarFactory });
    }
  } else if (warCount >= 1 && warCount < roundUp(RULES.warRatio, curBuildings) && warCount < RULES.warLimit && (money > 2000 || hasInc)) {
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
  const defenseRatio =
    RULES.defenseRatio *
    strat.defenseRatioMult *
    (house.aiPersonality === 'turtle' ? 1.35 : house.aiPersonality === 'raider' ? 0.8 : 1);
  if (hasWarFactory(house) && defCount < roundUp(defenseRatio, curBuildings) && defCount < RULES.defenseLimit) {
    const vehicleThreat = enemyProfile ? enemyProfile.vehicles + enemyProfile.aircraft : 0;
    const infantryThreat = enemyProfile ? enemyProfile.infantry : 0;
    const fallbackDefense =
      house.faction === Faction.Soviets
        ? StructType.FlameTurret
        : vehicleThreat > infantryThreat
          ? StructType.Turret
          : infantryThreat > vehicleThreat
            ? StructType.Pillbox
            : Math.random() < 0.5
              ? StructType.Pillbox
              : StructType.Turret;
    const types = [StructType.FlameTurret, fallbackDefense];
    for (const t of types) {
      const def = STRUCT_DEFS[t];
      if (canBuildStructure(sim, house, t) && (def.cost < money || hasInc)) {
        choices.push({ urgency: strat.defenseUrgency, structure: t });
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
      choices.push({ urgency: strat.techUrgency, structure: StructType.Tech });
    }
  }

  const wantsAir = strat.wantsAir || house.aiPersonality === 'air';
  if (hasTech(house) && wantsAir) {
    const currentPads =
      (house.quantities[StructType.Helipad] ?? 0) + (house.quantities[StructType.Airstrip] ?? 0);
    const padTarget = Math.max(1, strat.airFactoryTarget);
    if (currentPads < padTarget) {
      // Soviets favour the airstrip (jets); both factions can field helipads.
      const airFactories =
        house.faction === Faction.Soviets
          ? [StructType.Airstrip, StructType.Helipad]
          : [StructType.Helipad];
      for (const padType of airFactories) {
        const def = STRUCT_DEFS[padType];
        if (canBuildStructure(sim, house, padType) && (def.cost < money || hasInc)) {
          choices.push({ urgency: strat.airUrgency, structure: padType });
          break;
        }
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

  // Two harvesters per refinery keeps the economy strong enough to actually
  // reach the tech/air tier, and puts more harvesters on the field to watch.
  if (
    house.iq >= RULES.iqHarvester &&
    (house.difficulty !== Difficulty.Hard || house.aiProductionProfile === 'economy' || wantsAirInfra(house)) &&
    !sim.isTiberiumShort(house.id) &&
    harvesters < refineries * 2
  ) {
    house.buildUnit = UnitType.Harvester;
    return;
  }

  if (!house.isBaseBuilding) return;

  // Air-focused houses bank credits so the Tech Center, air pad, and aircraft
  // get funded before the war chest is drained on ground units.
  if (house.credits < airCreditReserve(sim, house)) return;

  const enemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;
  const enemyProfile = enemy ? sim.getHouseCombatProfile(enemy.id) : null;

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
    let w = def.weaponDamage ? 20 : 1;

    if (house.aiProductionProfile === 'armor') {
      if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 14;
      if (t === UnitType.LightTank) w += 6;
    } else if (house.aiProductionProfile === 'siege') {
      if (t === UnitType.Artillery) w += 22;
      if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 6;
    } else if (house.aiProductionProfile === 'infantry') {
      if (t === UnitType.Apc) w += 12;
      if (t === UnitType.LightTank) w += 5;
    } else if (house.aiProductionProfile === 'finisher') {
      if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 18;
      if (t === UnitType.Apc) w += 6;
    }

    if (house.aiStrategy === 'massArmor') {
      if (t === UnitType.HeavyTank || t === UnitType.MediumTank) w += 18;
      if (t === UnitType.LightTank) w += 6;
    } else if (house.aiStrategy === 'rush') {
      if (t === UnitType.LightTank || t === UnitType.Apc) w += 12;
    } else if (house.aiStrategy === 'turtle') {
      if (t === UnitType.Artillery) w += 14;
      if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 4;
    } else if (house.aiStrategy === 'boom') {
      if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 10;
    }

    if (enemyProfile) {
      if (enemyProfile.heavyVehicles > enemyProfile.lightVehicles + enemyProfile.infantry) {
        if (t === UnitType.Artillery) w += 18;
        if (t === UnitType.Apc) w += 8;
        if (t === UnitType.MediumTank) w += 6;
      }
      if (enemyProfile.lightVehicles + enemyProfile.infantry > enemyProfile.heavyVehicles + 2) {
        if (t === UnitType.MediumTank || t === UnitType.HeavyTank) w += 14;
        if (t === UnitType.Apc) w += 6;
      }
      if (enemyProfile.defenses >= 2 && t === UnitType.Artillery) w += 16;
      if (enemyProfile.harvesters >= 2 && (t === UnitType.LightTank || t === UnitType.Apc)) w += 8;
    }

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

  // Bank toward the Tech Center / air pad / aircraft before spending on infantry.
  if (house.credits < airCreditReserve(sim, house)) return;

  const enemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;
  const enemyProfile = enemy ? sim.getHouseCombatProfile(enemy.id) : null;
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
    let nextW = w;
    if (enemy && enemyQ > myQ) {
      nextW += 2;
    }
    if (house.aiProductionProfile === 'infantry') {
      if (type === InfantryType.Rifle || type === InfantryType.Flamethrower || type === InfantryType.Grenadier) nextW += 4;
    } else if (house.aiProductionProfile === 'siege' || house.aiProductionProfile === 'armor') {
      if (type === InfantryType.Rocket) nextW += 4;
    } else if (house.aiProductionProfile === 'finisher') {
      if (type !== InfantryType.Engineer) nextW += 3;
    }
    if (house.aiStrategy === 'rush') {
      if (type === InfantryType.Rifle) nextW += 6;
      if (type === InfantryType.Flamethrower || type === InfantryType.Grenadier) nextW += 3;
    } else if (house.aiStrategy === 'turtle') {
      if (type === InfantryType.Rocket) nextW += 5;
    } else if (house.aiStrategy === 'techAir') {
      if (type === InfantryType.Rocket) nextW += 3;
    }
    if (enemyProfile && enemyProfile.vehicles > enemyProfile.infantry && type === InfantryType.Rocket) nextW += 4;

    if (enemy && enemyQ > myQ) {
      weights.push({ type, w: nextW });
    } else if (house.credits > RULES.infantryReserve || curInf < curBld * RULES.infantryBaseMult) {
      weights.push({ type, w: nextW });
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

  const shouldRescoreEnemy =
    house.enemyId === null ||
    sim.tick - house.aiLastEnemyScanTick >= TICKS_PER_SECOND * 30 ||
    house.aiPanicUntilTick > sim.tick;

  if (shouldRescoreEnemy) {
    const enemies = sim.getHouses().filter((h) => h.id !== house.id && !h.isDefeated);
    if (enemies.length > 0 && sim.countBuildings(house.id) > 0) {
      const currentEnemy = house.enemyId !== null ? sim.getHouse(house.enemyId) : null;
      let best = currentEnemy && !currentEnemy.isDefeated ? currentEnemy : enemies[0];
      let bestScore = -Infinity;
      let currentScore = -Infinity;
      for (const e of enemies) {
        const d = Math.hypot(house.centerX - e.centerX, house.centerY - e.centerY);
        const profile = sim.getHouseCombatProfile(e.id);
        const score =
          1000 -
          d * 2 +
          sim.countBuildings(e.id) * 5 +
          profile.harvesters * 12 +
          profile.factories * 8 +
          (e.buildingsKilled[house.id] ?? 0) * 5 +
          (e.unitsKilled[house.id] ?? 0) +
          (house.lastAttackerId === e.id ? 140 : 0);
        if (currentEnemy?.id === e.id) currentScore = score;
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (house.enemyId === null || bestScore > currentScore + 75 || house.aiPanicUntilTick > sim.tick) {
        house.enemyId = best.id;
      }
      house.aiLastEnemyScanTick = sim.tick;
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
  const strat = STRATEGY_DEFS[house.aiStrategy];
  const forced = sim.countBuildings(house.id) === 0;
  const panic = house.aiPanicUntilTick > sim.tick;
  const armedCount =
    armedGroundCount(sim, house) +
    sim.getAircraft().filter((a) => a.houseId === house.id && a.hp > 0).length;
  const baseThreshold = Math.min(
    4 + Math.floor(sim.tick / (TICKS_PER_SECOND * 120)),
    house.difficulty === Difficulty.Hard ? 12 : 10,
  );
  const minForAttack = forced || panic
    ? 1
    : Math.max(1, Math.round(baseThreshold * strat.attackArmyMult));
  const interval =
    RULES.attackInterval *
    TICKS_PER_SECOND *
    difficultyAttackScale(house.difficulty) *
    strat.attackIntervalMult *
    (0.5 + Math.random());

  if (!forced && armedCount < minForAttack) {
    house.attackTimer = interval;
    return;
  }

  const shuffle =
    !panic &&
    !(sim.tick > TICKS_PER_SECOND * 60 && forced) &&
    Math.random() < difficultySkipChance(house.difficulty);

  if (!shuffle || forced) {
    for (const u of sim.getUnits()) {
      if (u.houseId !== house.id || u.hp <= 0) continue;
      if (!forced && u.teamId !== null) continue;
      const def = UNIT_DEFS[u.type];
      if (def.weaponDamage && (forced || Math.random() < 0.75)) {
        sim.assignHunt(u.id, 'unit');
      }
    }
    for (const i of sim.getInfantry()) {
      if (i.houseId !== house.id || i.hp <= 0) continue;
      if (!forced && i.teamId !== null) continue;
      if (forced || Math.random() < 0.75) {
        sim.assignHunt(i.id, 'infantry');
      }
    }
    for (const a of sim.getAircraft()) {
      if (a.houseId !== house.id || a.hp <= 0) continue;
      if (!forced && a.teamId !== null) continue;
      if (forced || Math.random() < 0.75) {
        sim.assignHunt(a.id, 'aircraft');
      }
    }
  }

  house.attackTimer = interval;
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

