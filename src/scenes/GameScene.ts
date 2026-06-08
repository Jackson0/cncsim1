import Phaser from 'phaser';
import {
  AIRCRAFT_DEFS,
  CELL_SIZE,
  Difficulty,
  HARVESTER_CAPACITY,
  INFANTRY_DEFS,
  STRUCT_DEFS,
  StructType,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  UnitType,
} from '../game/definitions';
import type { Building, House, OrePatch, Unit } from '../game/entities';
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
import { resolveWeaponVisualId, weaponDamageHint } from '../game/weaponVisuals';
import {
  DEFAULT_DEBUG_MAX_TICKS,
  DebugTelemetry,
  type DebugRunReport,
  writeDebugReport,
} from '../game/sim/DebugTelemetry';
import { WORLD_H, WORLD_W, centerCameraOnWorld, pointerToCell, setupCameraControls } from './mapView';

type EntityKind = 'building' | 'unit' | 'infantry' | 'aircraft';

interface EntitySelection {
  kind: EntityKind;
  id: number;
}

interface PointerStart {
  x: number;
  y: number;
}

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

  private signalField: SignalFieldRenderer | null = null;
  private oreRenderer: OreBloomRenderer | null = null;
  private baseAuraRenderer: BaseAuraRenderer | null = null;
  private buildingRenderer: BuildingGlyphRenderer | null = null;
  private unitRenderer: UnitGlyphRenderer | null = null;
  private combatRenderer: CombatEffectsRenderer | null = null;

  private simAccumulator = 0;
  private logLines: string[] = [];
  private setupConfig?: MapSetupConfig;
  private panelRoot: HTMLElement | null = null;
  private selectedInfoEl: HTMLDivElement | null = null;
  private statusInfoEl: HTMLDivElement | null = null;
  private logInfoEl: HTMLDivElement | null = null;
  private selectedEntity: EntitySelection | null = null;
  private pointerStart: PointerStart | null = null;
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

    document.body.classList.remove('setup-active');
    document.body.classList.add('game-active');
    this.scale.refresh();
    centerCameraOnWorld(this);
    this.buildPlayPanel();

    if (!this.debugMode) {
      this.signalField = new SignalFieldRenderer(this, WORLD_W, WORLD_H, this.visualConfig);
      this.oreRenderer = new OreBloomRenderer(this, this.visualConfig);
      this.baseAuraRenderer = new BaseAuraRenderer(this, this.visualConfig);
      this.buildingRenderer = new BuildingGlyphRenderer(this, this.visualConfig);
      this.unitRenderer = new UnitGlyphRenderer(this, this.visualConfig);
      this.combatRenderer = new CombatEffectsRenderer(this, this.visualConfig);
    }

    if (!this.debugMode) {
      setupCameraControls(this);
      this.setupSelectionHandlers();
      this.installVisualToggles();
    }

    this.refreshPlayPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyHtmlControls());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroyHtmlControls());
  }

  update(time: number, delta: number): void {
    if (this.debugMode) {
      if (this.debugComplete) {
        this.refreshPlayPanel();
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
      this.refreshPlayPanel();
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
    this.refreshPlayPanel();
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

  private renderWorld(time: number, delta: number): void {
    this.signalField?.update(time, delta);
    this.oreRenderer?.updateOreFields(this.sim.getOrePatches(), time, delta);
    this.baseAuraRenderer?.updateBases(this.sim.getHouses(), this.sim.getBuildings(), this.profiles, time, delta);
  }

  private renderEntities(time: number, delta: number): void {
    if (!this.buildingRenderer || !this.unitRenderer) return;

    this.buildingRenderer.beginFrame();
    this.unitRenderer.beginFrame();

    for (const b of this.sim.getBuildings()) {
      const house = this.sim.getHouse(b.houseId);
      const profile = house ? this.profileForHouse(house) : fallbackProfile();
      const c = this.buildingCenter(b);

      const wasComplete = this.buildingCompletionState.get(b.id);
      if (wasComplete === false && b.isComplete) {
        this.buildingRenderer.emitBuildComplete(b, profile);
        this.signalField?.emitPulse(c.x, c.y, profile.accent, CELL_SIZE * 3.4, 0.48);
      }
      this.buildingCompletionState.set(b.id, b.isComplete);

      this.buildingRenderer.drawBuilding(b, profile, time);
    }

    for (const u of this.sim.getUnits()) {
      if (u.hp <= 0) continue;
      const house = this.sim.getHouse(u.houseId);
      const profile = house ? this.profileForHouse(house) : fallbackProfile();

      this.unitRenderer.drawUnit(u, profile, time);
      this.emitHarvesterVisuals(u, profile, time);
    }

    for (const i of this.sim.getInfantry()) {
      if (i.hp <= 0) continue;
      const house = this.sim.getHouse(i.houseId);
      const profile = house ? this.profileForHouse(house) : fallbackProfile();

      this.unitRenderer.drawInfantry(i, profile, time);
    }

    for (const a of this.sim.getAircraft()) {
      if (a.hp <= 0) continue;
      const house = this.sim.getHouse(a.houseId);
      const profile = house ? this.profileForHouse(house) : fallbackProfile();

      this.unitRenderer.drawAircraft(a, profile, time);
    }

    this.buildingRenderer.update(time, delta);
    this.unitRenderer.finishFrame(time, delta);
    this.pruneBuildingCompletionState();
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

  private pruneBuildingCompletionState(): void {
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

  private buildPlayPanel(): void {
    const host = document.getElementById('game-panel-root') ?? document.body;
    host.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'setup-panel';

    const title = document.createElement('div');
    title.className = 'setup-title';
    const heading = document.createElement('h1');
    heading.textContent = this.debugMode ? 'Debug' : 'Spectate';
    const subtitle = document.createElement('span');
    subtitle.className = 'setup-help';
    subtitle.textContent = this.debugMode ? 'Sim monitor' : 'Spectral RTS automata';
    title.append(heading, subtitle);

    const help = document.createElement('div');
    help.className = 'setup-help';
    help.textContent = 'Click a unit or building for details. Right-drag or touch-drag pans. Wheel or pinch zooms toward the cursor.';

    const selectedSection = this.createPanelSection('Selected');
    this.selectedInfoEl = document.createElement('div');
    this.selectedInfoEl.className = 'setup-selected';
    selectedSection.append(this.selectedInfoEl);

    const statusSection = this.createPanelSection('Status');
    this.statusInfoEl = document.createElement('div');
    this.statusInfoEl.className = 'setup-selected';
    statusSection.append(this.statusInfoEl);

    const logSection = this.createPanelSection('Events');
    this.logInfoEl = document.createElement('div');
    this.logInfoEl.className = 'setup-selected';
    logSection.append(this.logInfoEl);

    panel.append(title, help, selectedSection, statusSection, logSection);
    host.append(panel);
    this.panelRoot = host;
  }

  private createPanelSection(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'setup-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  private refreshPlayPanel(): void {
    if (!this.selectedInfoEl || !this.statusInfoEl || !this.logInfoEl) return;

    this.validateSelection();
    this.selectedInfoEl.textContent = this.formatSelectedEntity();
    this.statusInfoEl.textContent = this.formatStatusLines().join('\n');
    this.logInfoEl.textContent = this.logLines.length > 0 ? this.logLines.join('\n') : 'No events yet.';
  }

  private formatStatusLines(): string[] {
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

    return lines;
  }

  private formatSelectedEntity(): string {
    if (!this.selectedEntity) {
      return 'Selected: none\nClick a unit or building on the map.';
    }

    const selection = this.selectedEntity;
    if (selection.kind === 'building') {
      const building = this.sim.getBuildings().find((b) => b.id === selection.id);
      if (!building) return 'Selected: none';
      const def = STRUCT_DEFS[building.type];
      const house = this.sim.getHouse(building.houseId);
      const lines = [
        def.name,
        `Health: ${building.hp}/${building.maxHp}`,
        `Owner: ${house?.name ?? 'Unknown'}`,
        `Cell: (${building.cellX}, ${building.cellY})`,
      ];
      if (!building.isComplete) {
        lines.push(`Building: ${Math.floor((building.buildProgress / building.buildTime) * 100)}%`);
      }
      return lines.join('\n');
    }

    if (selection.kind === 'unit') {
      const unit = this.sim.getUnits().find((u) => u.id === selection.id);
      if (!unit || unit.hp <= 0) return 'Selected: none';
      const def = UNIT_DEFS[unit.type];
      const house = this.sim.getHouse(unit.houseId);
      const lines = [
        def.name,
        `Health: ${unit.hp}/${unit.maxHp}`,
        `Owner: ${house?.name ?? 'Unknown'}`,
        `Position: (${unit.x.toFixed(1)}, ${unit.y.toFixed(1)})`,
      ];
      if (unit.cargo > 0) lines.push(`Cargo: ${unit.cargo}`);
      return lines.join('\n');
    }

    if (selection.kind === 'infantry') {
      const infantry = this.sim.getInfantry().find((i) => i.id === selection.id);
      if (!infantry || infantry.hp <= 0) return 'Selected: none';
      const def = INFANTRY_DEFS[infantry.type];
      const house = this.sim.getHouse(infantry.houseId);
      return [
        def.name,
        `Health: ${infantry.hp}/${infantry.maxHp}`,
        `Owner: ${house?.name ?? 'Unknown'}`,
        `Position: (${infantry.x.toFixed(1)}, ${infantry.y.toFixed(1)})`,
      ].join('\n');
    }

    const aircraft = this.sim.getAircraft().find((a) => a.id === selection.id);
    if (!aircraft || aircraft.hp <= 0) return 'Selected: none';
    const def = AIRCRAFT_DEFS[aircraft.type];
    const house = this.sim.getHouse(aircraft.houseId);
    return [
      def.name,
      `Health: ${aircraft.hp}/${aircraft.maxHp}`,
      `Owner: ${house?.name ?? 'Unknown'}`,
      `Position: (${aircraft.x.toFixed(1)}, ${aircraft.y.toFixed(1)})`,
    ].join('\n');
  }

  private validateSelection(): void {
    if (!this.selectedEntity) return;
    const { kind, id } = this.selectedEntity;
    const exists =
      kind === 'building'
        ? this.sim.getBuildings().some((b) => b.id === id)
        : kind === 'unit'
          ? this.sim.getUnits().some((u) => u.id === id && u.hp > 0)
          : kind === 'infantry'
            ? this.sim.getInfantry().some((i) => i.id === id && i.hp > 0)
            : this.sim.getAircraft().some((a) => a.id === id && a.hp > 0);
    if (!exists) this.selectedEntity = null;
  }

  private setupSelectionHandlers(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      if (!pointerToCell(pointer, this.cameras.main)) return;
      this.pointerStart = { x: pointer.x, y: pointer.y };
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (!this.pointerStart) return;
      const distance = Phaser.Math.Distance.Between(this.pointerStart.x, this.pointerStart.y, pointer.x, pointer.y);
      this.pointerStart = null;
      if (distance > 12) return;
      this.handleMapClick(pointer);
    });
  }

  private handleMapClick(pointer: Phaser.Input.Pointer): void {
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const picked = this.pickEntityAtWorld(worldPoint.x, worldPoint.y);
    this.selectedEntity = picked;
    this.refreshPlayPanel();
  }

  private pickEntityAtWorld(worldX: number, worldY: number): EntitySelection | null {
    let bestSelection: EntitySelection | null = null;
    let bestDist = Infinity;

    const consider = (selection: EntitySelection, entityX: number, entityY: number, radius: number): void => {
      const dist = Math.hypot(worldX - entityX, worldY - entityY);
      if (dist > radius || dist >= bestDist) return;
      bestDist = dist;
      bestSelection = selection;
    };

    for (const aircraft of this.sim.getAircraft()) {
      if (aircraft.hp <= 0) continue;
      consider(
        { kind: 'aircraft', id: aircraft.id },
        aircraft.x * CELL_SIZE,
        aircraft.y * CELL_SIZE,
        CELL_SIZE * 0.75,
      );
    }

    for (const infantry of this.sim.getInfantry()) {
      if (infantry.hp <= 0) continue;
      consider(
        { kind: 'infantry', id: infantry.id },
        infantry.x * CELL_SIZE,
        infantry.y * CELL_SIZE,
        CELL_SIZE * 0.55,
      );
    }

    for (const unit of this.sim.getUnits()) {
      if (unit.hp <= 0) continue;
      consider({ kind: 'unit', id: unit.id }, unit.x * CELL_SIZE, unit.y * CELL_SIZE, CELL_SIZE * 0.65);
    }

    const cellX = Math.floor(worldX / CELL_SIZE);
    const cellY = Math.floor(worldY / CELL_SIZE);
    const building = this.findBuildingAtCell(cellX, cellY);
    if (building) {
      const center = this.buildingCenter(building);
      consider({ kind: 'building', id: building.id }, center.x, center.y, CELL_SIZE * 1.4);
    }

    return bestSelection;
  }

  private destroyHtmlControls(): void {
    document.body.classList.remove('game-active');
    if (this.panelRoot) this.panelRoot.innerHTML = '';
    this.panelRoot = null;
    this.selectedInfoEl = null;
    this.statusInfoEl = null;
    this.logInfoEl = null;
    window.setTimeout(() => this.scale.refresh(), 0);
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
        this.refreshPlayPanel();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.debugStatus = `Debug report write failed: ${message}`;
        this.pushLog(this.debugStatus);
        this.refreshPlayPanel();
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
    if (ev.itemKind && ev.itemType) {
      return resolveWeaponVisualId(ev.itemKind, ev.itemType);
    }
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

}
