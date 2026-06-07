import Phaser from 'phaser';
import {
  AIRCRAFT_DEFS,
  CELL_SIZE,
  Difficulty,
  HARVESTER_CAPACITY,
  INFANTRY_DEFS,
  InfantryType,
  STRUCT_DEFS,
  StructType,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  UnitType,
} from '../game/definitions';
import type { Aircraft, Building, House, Infantry, OrePatch, Unit } from '../game/entities';
import { DEFAULT_MAP_SETUP, type MapSetupConfig } from '../game/mapSetup';
import {
  BaseAuraRenderer,
  BuildingGlyphRenderer,
  CombatEffectsRenderer,
  OreBloomRenderer,
  SignalFieldRenderer,
  UnitGlyphRenderer,
  cloneVisualConfig,
  createFactionVisualProfiles,
  fallbackProfile,
  type FactionVisualProfile,
  type PsychedelicVisualConfig,
  type VisualQuality,
} from '../game/psychedelicVisuals';
import { GameSim, type SimEvent } from '../game/sim/GameSim';
import {
  DEFAULT_DEBUG_MAX_TICKS,
  DebugTelemetry,
  type DebugRunReport,
  writeDebugReport,
} from '../game/sim/DebugTelemetry';
import { WORLD_H, WORLD_W, setupCameraControls } from './mapView';

const SIM_SPEED = 4;
const SIM_TICK_MS = 1000 / TICKS_PER_SECOND / SIM_SPEED;
const DEBUG_TICKS_PER_FRAME = 1000;

interface GameSceneInitData {
  config?: MapSetupConfig;
  debug?: boolean;
  debugMaxTicks?: number;
}

export class GameScene extends Phaser.Scene {
  sim!: GameSim;
  hudText!: Phaser.GameObjects.Text;
  logText!: Phaser.GameObjects.Text;

  private signalField: SignalFieldRenderer | null = null;
  private oreRenderer: OreBloomRenderer | null = null;
  private baseAuraRenderer: BaseAuraRenderer | null = null;
  private buildingRenderer: BuildingGlyphRenderer | null = null;
  private unitRenderer: UnitGlyphRenderer | null = null;
  private combatRenderer: CombatEffectsRenderer | null = null;

  private simAccumulator = 0;
  private logLines: string[] = [];
  private entityLabels = new Map<string, Phaser.GameObjects.Text>();
  private setupConfig?: MapSetupConfig;
  private debugMode = false;
  private debugMaxTicks = DEFAULT_DEBUG_MAX_TICKS;
  private debugTelemetry: DebugTelemetry | null = null;
  private debugComplete = false;
  private debugStatus = '';
  private visualQuality: VisualQuality = 'medium';
  private visualConfig: PsychedelicVisualConfig = cloneVisualConfig('medium');
  private profiles = new Map<number, FactionVisualProfile>();
  private buildingCompletionState = new Map<number, boolean>();
  private harvestVisualCooldown = new Map<number, number>();
  private showVisualDebug = false;

  constructor() {
    super('GameScene');
  }

  init(data: GameSceneInitData): void {
    this.setupConfig = data.config;
    this.debugMode = data.debug ?? false;
    this.debugMaxTicks = data.debugMaxTicks ?? DEFAULT_DEBUG_MAX_TICKS;
  }

  create(): void {
    this.sim = new GameSim();
    this.sim.init(this.setupConfig ?? DEFAULT_MAP_SETUP);
    if (this.debugMode) {
      this.debugTelemetry = new DebugTelemetry(
        this.setupConfig ?? DEFAULT_MAP_SETUP,
        this.debugMaxTicks,
        DEBUG_TICKS_PER_FRAME,
      );
    }
    this.profiles = this.debugMode ? new Map() : createFactionVisualProfiles(this.sim.getHouses());

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);

    if (!this.debugMode) {
      this.signalField = new SignalFieldRenderer(this, WORLD_W, WORLD_H, this.visualConfig);
      this.oreRenderer = new OreBloomRenderer(this, this.visualConfig);
      this.baseAuraRenderer = new BaseAuraRenderer(this, this.visualConfig);
      this.buildingRenderer = new BuildingGlyphRenderer(this, this.visualConfig);
      this.unitRenderer = new UnitGlyphRenderer(this, this.visualConfig);
      this.combatRenderer = new CombatEffectsRenderer(this, this.visualConfig);
    }

    this.hudText = this.add
      .text(10, 10, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '13px',
        color: '#d9fbff',
        backgroundColor: '#020510cc',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(10);

    this.logText = this.add
      .text(10, this.scale.height - 10, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '11px',
        color: '#c7d7ff',
        backgroundColor: '#02051099',
        padding: { x: 6, y: 4 },
        wordWrap: { width: 400 },
      })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(10);

    if (!this.debugMode) {
      setupCameraControls(this);
      this.installVisualToggles();
    }

    this.add
      .text(WORLD_W - 10, 10, this.debugMode ? 'Debug sim monitor' : 'Spectral RTS automata', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#9adcec',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(10);
  }

  update(time: number, delta: number): void {
    if (this.debugMode) {
      if (this.debugComplete) {
        this.renderHUD();
        this.renderLog();
        return;
      }

      for (let i = 0; i < DEBUG_TICKS_PER_FRAME; i++) {
        this.sim.update();
        const stop = this.debugTelemetry?.recordTick(this.sim) ?? null;
        this.processEvents();
        if (stop) {
          this.completeDebugRun(stop);
          break;
        }
      }
      this.renderHUD();
      this.renderLog();
      return;
    }

    this.simAccumulator += delta;
    while (this.simAccumulator >= SIM_TICK_MS) {
      this.simAccumulator -= SIM_TICK_MS;
      this.sim.update();
      this.processEvents();
    }

    if (!this.debugMode) {
      this.renderWorld(time, delta);
      this.renderEntities(time, delta);
      this.combatRenderer?.update(time, delta);
    }
    this.renderHUD();
    this.renderLog();
  }

  private processEvents(): void {
    let lastDamageProfile: FactionVisualProfile | null = null;

    for (const ev of this.sim.events) {
      const house = ev.houseId !== undefined ? this.sim.getHouse(ev.houseId) : undefined;

      if (ev.type === 'build' || ev.type === 'produce' || ev.type === 'destroy') {
        const prefix = house ? `[${house.name}] ` : '';
        this.pushLog(`${prefix}${ev.message ?? ev.type}`);
      }

      if (this.debugMode) {
        if (ev.type === 'harvest' && ev.message) {
          this.pushLog(`[${house?.name ?? '?'}] Harvest ${ev.message}`);
        }
        continue;
      }

      const profile: FactionVisualProfile = house ? this.profileForHouse(house) : (lastDamageProfile ?? fallbackProfile());

      if (ev.type === 'build') {
        const building = this.findBuildingAtCell(ev.x, ev.y, ev.houseId);
        const p = building ? this.profileForHouseId(building.houseId) : profile;
        const center = building ? this.buildingCenter(building) : this.cellToPoint(ev.x + 0.5, ev.y + 0.5);
        this.signalField?.emitPulse(center.x, center.y, p.primary, CELL_SIZE * 3.2, 0.42);
        if (building?.isComplete) this.buildingRenderer?.emitBuildComplete(building, p);
      }

      if (ev.type === 'produce') {
        const source = ev.houseId !== undefined ? this.findProductionSource(ev.houseId, ev.x, ev.y) : null;
        if (source && house) this.baseAuraRenderer?.emitProductionPulse(house, source);
        const p = this.cellToPoint(ev.x + 0.5, ev.y + 0.5);
        this.signalField?.emitPulse(p.x, p.y, profile.accent, CELL_SIZE * 2.2, 0.34);
      }

      if (ev.type === 'harvest') {
        if (ev.message) this.pushLog(`[${house?.name ?? '?'}] Harvest ${ev.message}`);
        const refinery = ev.houseId !== undefined ? this.findClosestBuilding(ev.houseId, ev.x, ev.y, 4, (b) => b.type === StructType.Refinery) : null;
        if (refinery && house) this.baseAuraRenderer?.emitEconomyPulse(house, refinery);
        const p = this.cellToPoint(ev.x, ev.y);
        this.signalField?.emitPulse(p.x, p.y, 0xffd86d, CELL_SIZE * 3.8, 0.34);
      }

      if (ev.type === 'damage') {
        const weaponType = this.inferWeaponType(ev);
        const targetBuilding = this.findBuildingAtCell(ev.x, ev.y);
        this.combatRenderer?.emitDamage(ev, profile, weaponType);
        this.signalField?.emitGridRipple(ev.x * CELL_SIZE, ev.y * CELL_SIZE, profile.primary);

        if (targetBuilding) {
          this.buildingRenderer?.emitBuildingDamaged(targetBuilding, weaponDamageHint(weaponType), this.profileForHouseId(targetBuilding.houseId));
        }

        lastDamageProfile = profile;
      }

      if (ev.type === 'destroy') {
        const p = this.cellToPoint(ev.x, ev.y);
        this.combatRenderer?.emitDestroy(p.x, p.y, lastDamageProfile ?? profile, this.findBuildingAtCell(ev.x, ev.y) ? 'building' : 'unit');
        this.signalField?.emitPulse(p.x, p.y, (lastDamageProfile ?? profile).accent, CELL_SIZE * 5, 0.52);
      }
    }
  }

  private pushLog(line: string): void {
    this.logLines.unshift(line);
    if (this.logLines.length > 8) this.logLines.pop();
  }

  private renderLog(): void {
    this.logText.setText(this.logLines.join('\n'));
  }

  private renderWorld(time: number, delta: number): void {
    this.signalField?.update(time, delta);
    this.oreRenderer?.updateOreFields(this.sim.getOrePatches(), time, delta);
    this.baseAuraRenderer?.updateBases(this.sim.getHouses(), this.sim.getBuildings(), this.profiles, time, delta);
  }

  private renderEntities(time: number, delta: number): void {
    if (!this.buildingRenderer || !this.unitRenderer) return;

    this.buildingRenderer.beginFrame();
    this.unitRenderer.beginFrame();

    const seenLabels = new Set<string>();

    for (const b of this.sim.getBuildings()) {
      const house = this.sim.getHouse(b.houseId);
      const def = STRUCT_DEFS[b.type];
      const profile = house ? this.profileForHouse(house) : fallbackProfile();
      const c = this.buildingCenter(b);

      const wasComplete = this.buildingCompletionState.get(b.id);
      if (wasComplete === false && b.isComplete) {
        this.buildingRenderer.emitBuildComplete(b, profile);
        this.signalField?.emitPulse(c.x, c.y, profile.accent, CELL_SIZE * 3.4, 0.48);
      }
      this.buildingCompletionState.set(b.id, b.isComplete);

      this.buildingRenderer.drawBuilding(b, profile, time);
      this.upsertEntityLabel(seenLabels, `building-${b.id}`, def.name, c.x, b.cellY * CELL_SIZE - 2, profile.primary);
    }

    for (const u of this.sim.getUnits()) {
      if (u.hp <= 0) continue;
      const house = this.sim.getHouse(u.houseId);
      const def = UNIT_DEFS[u.type];
      const profile = house ? this.profileForHouse(house) : fallbackProfile();
      const x = u.x * CELL_SIZE;
      const y = u.y * CELL_SIZE;

      this.unitRenderer.drawUnit(u, profile, time);
      this.emitHarvesterVisuals(u, profile, time);
      this.upsertEntityLabel(seenLabels, `unit-${u.id}`, def.name, x, y - 12, profile.primary);
    }

    for (const i of this.sim.getInfantry()) {
      if (i.hp <= 0) continue;
      const house = this.sim.getHouse(i.houseId);
      const def = INFANTRY_DEFS[i.type];
      const profile = house ? this.profileForHouse(house) : fallbackProfile();
      const x = i.x * CELL_SIZE;
      const y = i.y * CELL_SIZE;

      this.unitRenderer.drawInfantry(i, profile, time);
      this.upsertEntityLabel(seenLabels, `infantry-${i.id}`, def.name, x, y - 10, profile.primary);
    }

    for (const a of this.sim.getAircraft()) {
      if (a.hp <= 0) continue;
      const house = this.sim.getHouse(a.houseId);
      const def = AIRCRAFT_DEFS[a.type];
      const profile = house ? this.profileForHouse(house) : fallbackProfile();
      const x = a.x * CELL_SIZE;
      const y = a.y * CELL_SIZE;

      this.unitRenderer.drawAircraft(a, profile, time);
      this.upsertEntityLabel(seenLabels, `aircraft-${a.id}`, def.name, x, y - 14, profile.primary);
    }

    this.buildingRenderer.update(time, delta);
    this.unitRenderer.finishFrame(time, delta);
    this.pruneEntityLabels(seenLabels);
  }

  private emitHarvesterVisuals(unit: Unit, profile: FactionVisualProfile, time: number): void {
    if (unit.type !== UnitType.Harvester || unit.cargo >= HARVESTER_CAPACITY) return;
    const ore = this.nearestOre(unit.x, unit.y);
    if (!ore || ore.amount <= 0) return;
    if (Math.hypot(unit.x - ore.cellX, unit.y - ore.cellY) > ore.radius + 1.2) return;

    const next = this.harvestVisualCooldown.get(unit.id) ?? 0;
    if (time < next) return;

    const cooldown = this.visualQuality === 'low' ? 360 : this.visualQuality === 'high' ? 120 : 190;
    this.harvestVisualCooldown.set(unit.id, time + cooldown);
    const orePoint = this.cellToPoint(ore.cellX + 0.5, ore.cellY + 0.5);
    const unitPoint = this.cellToPoint(unit.x, unit.y);
    this.oreRenderer?.emitHarvestTendril(orePoint.x, orePoint.y, unitPoint.x, unitPoint.y, profile.accent);
  }

  private upsertEntityLabel(
    seenLabels: Set<string>,
    key: string,
    label: string,
    x: number,
    y: number,
    color: number,
  ): void {
    seenLabels.add(key);

    let text = this.entityLabels.get(key);
    if (!text) {
      text = this.add
        .text(x, y, label, {
          fontFamily: 'Consolas, monospace',
          fontSize: '9px',
          color: this.colorToCssHex(color),
          backgroundColor: '#02051088',
          padding: { x: 2, y: 1 },
        })
        .setOrigin(0.5, 1)
        .setDepth(7)
        .setResolution(2);
      text.setStroke('#000000', 2);
      this.entityLabels.set(key, text);
    }

    text.setPosition(x, y);
    if (text.text !== label) text.setText(label);
    text.setColor(this.colorToCssHex(color));
  }

  private pruneEntityLabels(seenLabels: Set<string>): void {
    for (const [key, text] of this.entityLabels) {
      if (seenLabels.has(key)) continue;
      text.destroy();
      this.entityLabels.delete(key);
    }

    for (const id of [...this.buildingCompletionState.keys()]) {
      if (!this.sim.getBuildings().some((b) => b.id === id)) this.buildingCompletionState.delete(id);
    }
  }

  private installVisualToggles(): void {
    this.input.keyboard?.on('keydown-V', () => {
      const next: VisualQuality = this.visualQuality === 'low' ? 'medium' : this.visualQuality === 'medium' ? 'high' : 'low';
      this.setVisualQuality(next);
    });
    this.input.keyboard?.on('keydown-P', () => {
      this.showVisualDebug = !this.showVisualDebug;
    });
  }

  private setVisualQuality(quality: VisualQuality): void {
    this.visualQuality = quality;
    this.visualConfig = cloneVisualConfig(quality);
    this.signalField?.setConfig(this.visualConfig);
    this.oreRenderer?.setConfig(this.visualConfig);
    this.baseAuraRenderer?.setConfig(this.visualConfig);
    this.buildingRenderer?.setConfig(this.visualConfig);
    this.unitRenderer?.setConfig(this.visualConfig);
    this.combatRenderer?.setConfig(this.visualConfig);
  }

  private renderHUD(): void {
    const houses = this.sim.getHouses();
    const lines = houses.map((h) => {
      const pwr = h.drain > 0 ? `${h.power}/${h.drain}` : `${h.power}`;
      const bld = this.sim.countBuildings(h.id);
      const unt = this.sim.countUnits(h.id);
      const inf = this.sim.countInfantry(h.id);
      const air = this.sim.countAircraft(h.id);
      const status = h.isDefeated ? ' DEFEATED' : '';
      const difficulty = Difficulty[h.difficulty];
      const tactic = h.aiActiveTactic || 'Buildup';
      return `${h.name}${status}  $${h.credits}  PWR:${pwr}  B:${bld} U:${unt} I:${inf} A:${air}  ${difficulty}/${h.aiPersonality}/${h.aiProductionProfile}  ${tactic}`;
    });

    lines.push(
      this.debugMode
        ? `Tick: ${this.sim.tick}  (${DEBUG_TICKS_PER_FRAME} ticks/frame)  Mode:Debug`
        : `Tick: ${this.sim.tick}  (${TICKS_PER_SECOND * SIM_SPEED} sim tps)  Visual:${this.visualQuality}`,
    );

    if (this.showVisualDebug && this.combatRenderer) {
      const stats = this.combatRenderer.getStats();
      lines.push(`FX beams:${stats.beams} mandalas:${stats.mandalas} motes:${stats.particles} fps:${this.game.loop.actualFps.toFixed(0)}`);
    }

    if (this.sim.winnerId !== null) {
      const w = this.sim.getHouse(this.sim.winnerId);
      lines.push(`>>> ${w?.name ?? 'Unknown'} WINS <<<`);
    }

    if (this.debugMode) {
      lines.push(`Max ticks: ${this.debugMaxTicks}`);
      if (this.debugStatus) lines.push(this.debugStatus);
    }

    this.hudText.setText(lines.join('\n'));
  }

  private completeDebugRun(stop: { result: 'defeat' | 'stall' | 'timeout'; reason: string }): void {
    if (!this.debugTelemetry || this.debugComplete) return;
    this.debugComplete = true;

    const report: DebugRunReport = this.debugTelemetry.buildReport(this.sim, stop);
    this.debugStatus = `Debug complete: ${report.result.type} - writing report...`;
    void writeDebugReport(report)
      .then((path) => {
        this.debugStatus = `Debug report saved: ${path}`;
        this.pushLog(`Report saved: ${path}`);
        this.renderHUD();
        this.renderLog();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.debugStatus = `Debug report write failed: ${message}`;
        this.pushLog(this.debugStatus);
        this.renderHUD();
        this.renderLog();
      });
  }

  private profileForHouse(house: House): FactionVisualProfile {
    return this.profiles.get(house.id) ?? fallbackProfile(house.color);
  }

  private profileForHouseId(houseId: number): FactionVisualProfile {
    const house = this.sim.getHouse(houseId);
    return house ? this.profileForHouse(house) : fallbackProfile();
  }

  private inferWeaponType(ev: SimEvent): string {
    if (ev.fromX === undefined || ev.fromY === undefined || ev.houseId === undefined) return 'signal';

    const sourceBuilding = this.findClosestBuilding(ev.houseId, ev.fromX, ev.fromY, 0.95);
    if (sourceBuilding) {
      if (sourceBuilding.type === StructType.Tesla) return 'tesla';
      if (sourceBuilding.type === StructType.FlameTurret) return 'flame';
      if (sourceBuilding.type === StructType.Sam || sourceBuilding.type === StructType.AaGun) return 'rocket';
      if (sourceBuilding.type === StructType.Pillbox) return 'infantry';
      return 'cannon';
    }

    const sourceUnit = this.findClosestUnit(ev.houseId, ev.fromX, ev.fromY, 0.95);
    if (sourceUnit) {
      if (sourceUnit.type === UnitType.Artillery) return 'artillery';
      if (sourceUnit.type === UnitType.Apc) return 'infantry';
      return 'cannon';
    }

    const sourceInfantry = this.findClosestInfantry(ev.houseId, ev.fromX, ev.fromY, 0.95);
    if (sourceInfantry) {
      if (sourceInfantry.type === InfantryType.Flamethrower) return 'flame';
      if (sourceInfantry.type === InfantryType.Rocket) return 'rocket';
      if (sourceInfantry.type === InfantryType.Grenadier) return 'artillery';
      return 'infantry';
    }

    const sourceAircraft = this.findClosestAircraft(ev.houseId, ev.fromX, ev.fromY, 1.2);
    if (sourceAircraft) return 'aircraft';

    return 'signal';
  }

  private findBuildingAtCell(cellX: number, cellY: number, houseId?: number): Building | null {
    return (
      this.sim.getBuildings().find((b) => {
        if (houseId !== undefined && b.houseId !== houseId) return false;
        const def = STRUCT_DEFS[b.type];
        return cellX >= b.cellX && cellX <= b.cellX + def.width && cellY >= b.cellY && cellY <= b.cellY + def.height;
      }) ?? null
    );
  }

  private findClosestBuilding(
    houseId: number,
    cellX: number,
    cellY: number,
    maxDistance: number,
    predicate: (building: Building) => boolean = () => true,
  ): Building | null {
    let best: Building | null = null;
    let bestD = maxDistance;
    for (const b of this.sim.getBuildings()) {
      if (b.houseId !== houseId || !predicate(b)) continue;
      const c = this.buildingCenterCells(b);
      const d = Math.hypot(c.x - cellX, c.y - cellY);
      if (d <= bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private findProductionSource(houseId: number, cellX: number, cellY: number): Building | null {
    return this.findClosestBuilding(
      houseId,
      cellX + 0.5,
      cellY + 0.5,
      4,
      (b) =>
        b.type === StructType.WarFactory ||
        b.type === StructType.Barracks ||
        b.type === StructType.Tent ||
        b.type === StructType.Helipad ||
        b.type === StructType.Airstrip ||
        b.type === StructType.Refinery,
    );
  }

  private findClosestUnit(houseId: number, cellX: number, cellY: number, maxDistance: number): Unit | null {
    return closest(this.sim.getUnits(), houseId, cellX, cellY, maxDistance);
  }

  private findClosestInfantry(houseId: number, cellX: number, cellY: number, maxDistance: number): Infantry | null {
    return closest(this.sim.getInfantry(), houseId, cellX, cellY, maxDistance);
  }

  private findClosestAircraft(houseId: number, cellX: number, cellY: number, maxDistance: number): Aircraft | null {
    return closest(this.sim.getAircraft(), houseId, cellX, cellY, maxDistance);
  }

  private nearestOre(x: number, y: number): OrePatch | null {
    let best: OrePatch | null = null;
    let bestD = Infinity;
    for (const ore of this.sim.getOrePatches()) {
      const d = Math.hypot(ore.cellX - x, ore.cellY - y);
      if (d < bestD) {
        best = ore;
        bestD = d;
      }
    }
    return best;
  }

  private buildingCenter(building: Building): Phaser.Math.Vector2 {
    const def = STRUCT_DEFS[building.type];
    return this.cellToPoint(building.cellX + def.width / 2, building.cellY + def.height / 2);
  }

  private buildingCenterCells(building: Building): Phaser.Math.Vector2 {
    const def = STRUCT_DEFS[building.type];
    return new Phaser.Math.Vector2(building.cellX + def.width / 2, building.cellY + def.height / 2);
  }

  private cellToPoint(cellX: number, cellY: number): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(cellX * CELL_SIZE, cellY * CELL_SIZE);
  }

  private colorToCssHex(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }
}

function closest<T extends { houseId: number; x: number; y: number }>(
  items: T[],
  houseId: number,
  cellX: number,
  cellY: number,
  maxDistance: number,
): T | null {
  let best: T | null = null;
  let bestD = maxDistance;
  for (const item of items) {
    if (item.houseId !== houseId) continue;
    const d = Math.hypot(item.x - cellX, item.y - cellY);
    if (d <= bestD) {
      best = item;
      bestD = d;
    }
  }
  return best;
}

function weaponDamageHint(weaponType: string): number {
  if (weaponType === 'tesla') return 80;
  if (weaponType === 'artillery') return 70;
  if (weaponType === 'cannon') return 45;
  if (weaponType === 'flame') return 30;
  if (weaponType === 'rocket') return 35;
  return 12;
}
