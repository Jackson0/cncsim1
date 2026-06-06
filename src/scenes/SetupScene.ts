import Phaser from 'phaser';
import { Faction, MAP_COLS, MAP_ROWS } from '../game/definitions';
import {
  DEFAULT_MAP_SETUP,
  DEFAULT_ORE_AMOUNT,
  ORE_FIELD_RADIUS,
  cloneMapSetup,
  getFactionColorVariant,
  isValidSetup,
  type BaseSpawn,
  type MapSetupConfig,
} from '../game/mapSetup';
import { DEFAULT_DEBUG_MAX_TICKS } from '../game/sim/DebugTelemetry';
import {
  WORLD_H,
  WORLD_W,
  drawGrid,
  pointerToCell,
  renderBaseMarkers,
  renderOrePreview,
  setupCameraControls,
} from './mapView';

type SetupMode = 'bases' | 'ore' | 'select';

const PANEL_W = 380;

export class SetupScene extends Phaser.Scene {
  private config: MapSetupConfig = cloneMapSetup(DEFAULT_MAP_SETUP);
  private mode: SetupMode = 'bases';
  private selectedBaseId: string | null = null;
  private selectedOreId: string | null = null;
  private worldGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private modeButtons!: Record<SetupMode, Phaser.GameObjects.Text>;
  private baseRows: Phaser.GameObjects.Text[] = [];
  private oreRows: Phaser.GameObjects.Text[] = [];
  private setupStatusText!: Phaser.GameObjects.Text;
  private selectedInfoText!: Phaser.GameObjects.Text;
  private startButton!: Phaser.GameObjects.Text;
  private removeBaseButton!: Phaser.GameObjects.Text;
  private renameBaseButton!: Phaser.GameObjects.Text;
  private factionButton!: Phaser.GameObjects.Text;
  private removeOreButton!: Phaser.GameObjects.Text;
  private nextId = 3;
  private startingCreditsRoot: HTMLDivElement | null = null;
  private startingCreditsInput: HTMLInputElement | null = null;
  private oreControlsRoot: HTMLDivElement | null = null;
  private oreAmountInput: HTMLInputElement | null = null;
  private oreInfiniteInput: HTMLInputElement | null = null;
  private debugModeRoot: HTMLDivElement | null = null;
  private debugModeInput: HTMLInputElement | null = null;
  private debugMaxTicksInput: HTMLInputElement | null = null;

  constructor() {
    super('SetupScene');
  }

  create(): void {
    this.config = cloneMapSetup(DEFAULT_MAP_SETUP);
    this.selectedBaseId = this.config.bases[0]?.id ?? null;
    this.selectedOreId = this.config.oreFields[0]?.id ?? null;
    this.nextId = Math.max(this.config.bases.length + 1, this.config.oreFields.length + 1, 3);

    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.centerOn(WORLD_W / 2, WORLD_H / 2);

    drawGrid(this);
    this.worldGfx = this.add.graphics().setDepth(1);
    this.markerGfx = this.add.graphics().setDepth(3);
    setupCameraControls(this);

    this.buildUi();
    this.createStartingCreditsControl();
    this.createOreControls();
    this.createDebugModeControl();
    this.setupInputHandlers();
    this.refreshUi();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyHtmlControls());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroyHtmlControls());
  }

  update(): void {
    const phase = this.time.now / 1000;
    this.worldGfx.clear();
    renderOrePreview(
      this.worldGfx,
      this.config.oreFields.map((ore) => ({
        cellX: ore.cellX,
        cellY: ore.cellY,
        amount: ore.amount,
        radius: ORE_FIELD_RADIUS,
        selected: ore.id === this.selectedOreId,
      })),
      phase,
    );

    this.markerGfx.clear();
    const colors = this.getBaseColorMap();
    renderBaseMarkers(
      this.markerGfx,
      this.config.bases.map((base) => ({
        cellX: base.cellX,
        cellY: base.cellY,
        color: colors.get(base.id) ?? 0xffffff,
        selected: base.id === this.selectedBaseId,
      })),
      phase,
    );
  }

  private buildUi(): void {
    this.add
      .rectangle(0, 0, PANEL_W, this.scale.height, 0x020510, 0.78)
      .setOrigin(0, 0)
      .setDepth(9)
      .setScrollFactor(0);

    this.add
      .text(12, 10, 'Signal Setup', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '24px',
        color: '#effcff',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.add
      .text(12, 42, 'LMB place - RMB pan - scroll zoom - Del removes selected', {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#9adcec',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.modeButtons = {
      bases: this.createButton(12, 66, 'Bases', () => this.setMode('bases')),
      ore: this.createButton(94, 66, 'Ore', () => this.setMode('ore')),
      select: this.createButton(156, 66, 'Select', () => this.setMode('select')),
    };

    this.add
      .text(12, 104, 'Bases', {
        fontFamily: 'Consolas, monospace',
        fontSize: '13px',
        color: '#cceeff',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.createButton(70, 102, '+ Add', () => this.addBase());
    this.removeBaseButton = this.createButton(128, 102, '- Remove', () => this.removeSelectedBase());
    this.renameBaseButton = this.createButton(212, 102, 'Rename', () => this.renameSelectedBase());
    this.factionButton = this.createButton(288, 102, 'Faction', () => this.toggleSelectedBaseFaction());

    this.selectedInfoText = this.add
      .text(12, 132, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '12px',
        color: '#cde1f4',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.add
      .text(12, 314, 'Ore fields', {
        fontFamily: 'Consolas, monospace',
        fontSize: '13px',
        color: '#cceeff',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.removeOreButton = this.createButton(98, 312, 'Remove ore', () => this.removeSelectedOre());

    this.setupStatusText = this.add
      .text(12, this.scale.height - 92, '', {
        fontFamily: 'Consolas, monospace',
        fontSize: '12px',
        color: '#ffcc88',
      })
      .setDepth(10)
      .setScrollFactor(0);

    this.startButton = this.createButton(12, this.scale.height - 58, 'Start Sim', () => this.startSimulation());
  }

  private setupInputHandlers(): void {
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!pointer.leftButtonDown()) return;
      if (pointer.x <= PANEL_W) return;
      this.handleMapClick(pointer);
    });

    this.input.keyboard?.on('keydown-DELETE', () => this.deleteSelection());
    this.input.keyboard?.on('keydown-BACKSPACE', () => this.deleteSelection());
  }

  private handleMapClick(pointer: Phaser.Input.Pointer): void {
    const cell = pointerToCell(pointer, this.cameras.main);
    if (!cell) return;

    if (this.mode === 'bases') {
      const targetBase = this.getSelectedBase() ?? this.config.bases[0];
      if (!targetBase) return;
      targetBase.cellX = cell.x;
      targetBase.cellY = cell.y;
      this.selectedBaseId = targetBase.id;
      this.selectedOreId = null;
      this.refreshUi();
      return;
    }

    if (this.mode === 'ore') {
      const ore = {
        id: `ore-${this.nextId++}`,
        cellX: cell.x,
        cellY: cell.y,
        amount: this.getUiOreAmount(),
      };
      this.config.oreFields.push(ore);
      this.selectedOreId = ore.id;
      this.selectedBaseId = null;
      this.refreshUi();
      return;
    }

    const pick = this.pickAtCell(cell.x, cell.y);
    if (pick.baseId) {
      this.selectedBaseId = pick.baseId;
      this.selectedOreId = null;
    } else if (pick.oreId) {
      this.selectedOreId = pick.oreId;
      this.selectedBaseId = null;
    } else if (this.selectedBaseId) {
      const base = this.getSelectedBase();
      if (base) {
        base.cellX = cell.x;
        base.cellY = cell.y;
      }
    } else if (this.selectedOreId) {
      const ore = this.getSelectedOre();
      if (ore) {
        ore.cellX = cell.x;
        ore.cellY = cell.y;
      }
    }
    this.refreshUi();
  }

  private setMode(mode: SetupMode): void {
    this.mode = mode;
    this.refreshUi();
  }

  private addBase(): void {
    const index = this.config.bases.length;
    const base: BaseSpawn = {
      id: `base-${this.nextId++}`,
      name: `Player ${index + 1}`,
      faction: index % 2 === 0 ? Faction.Allies : Faction.Soviets,
      cellX: Phaser.Math.Clamp(4 + index * 2, 1, MAP_COLS - 2),
      cellY: Phaser.Math.Clamp(Math.floor(MAP_ROWS / 2) + (index % 2 === 0 ? -2 : 2), 1, MAP_ROWS - 2),
    };
    this.config.bases.push(base);
    this.selectedBaseId = base.id;
    this.selectedOreId = null;
    this.mode = 'bases';
    this.refreshUi();
  }

  private removeSelectedBase(): void {
    if (!this.selectedBaseId) return;
    if (this.config.bases.length <= 2) {
      this.setupStatusText.setText('At least two bases are required.');
      return;
    }
    this.config.bases = this.config.bases.filter((base) => base.id !== this.selectedBaseId);
    this.selectedBaseId = this.config.bases[0]?.id ?? null;
    this.refreshUi();
  }

  private renameSelectedBase(): void {
    const base = this.getSelectedBase();
    if (!base) return;
    const renamed = window.prompt('Base name', base.name);
    if (renamed === null) return;
    const trimmed = renamed.trim();
    if (trimmed.length === 0) return;
    base.name = trimmed;
    this.refreshUi();
  }

  private toggleSelectedBaseFaction(): void {
    const base = this.getSelectedBase();
    if (!base) return;
    base.faction = base.faction === Faction.Allies ? Faction.Soviets : Faction.Allies;
    this.refreshUi();
  }

  private removeSelectedOre(): void {
    if (!this.selectedOreId) return;
    this.config.oreFields = this.config.oreFields.filter((ore) => ore.id !== this.selectedOreId);
    this.selectedOreId = this.config.oreFields[0]?.id ?? null;
    this.refreshUi();
  }

  private deleteSelection(): void {
    if (this.selectedBaseId) {
      this.removeSelectedBase();
      return;
    }
    if (this.selectedOreId) {
      this.removeSelectedOre();
    }
  }

  private startSimulation(): void {
    this.config.startingCredits = this.getUiStartingCredits();
    const validation = isValidSetup(this.config);
    if (!validation.ok) {
      this.setupStatusText.setText(validation.reason ?? 'Setup is invalid.');
      return;
    }
    this.scene.start('GameScene', {
      config: cloneMapSetup(this.config),
      debug: this.isDebugMode(),
      debugMaxTicks: this.getDebugMaxTicks(),
    });
  }

  private refreshUi(): void {
    const selectedBase = this.getSelectedBase();
    const selectedOre = this.getSelectedOre();
    const colors = this.getBaseColorMap();

    this.selectedInfoText.setText(
      selectedBase
        ? `Selected base: ${selectedBase.name} (${selectedBase.faction === Faction.Allies ? 'Allies' : 'Soviets'}) @ ${selectedBase.cellX},${selectedBase.cellY}`
        : selectedOre
          ? `Selected ore: ${selectedOre.cellX},${selectedOre.cellY} amount=${this.formatOreAmount(selectedOre.amount)}`
          : 'Selected: none',
    );

    this.syncModeButtons();
    this.rebuildBaseRows(colors);
    this.rebuildOreRows();
    this.syncActionButtons();
    this.syncStartState();
  }

  private syncModeButtons(): void {
    this.styleButton(this.modeButtons.bases, true, this.mode === 'bases');
    this.styleButton(this.modeButtons.ore, true, this.mode === 'ore');
    this.styleButton(this.modeButtons.select, true, this.mode === 'select');
  }

  private rebuildBaseRows(colors: Map<string, number>): void {
    for (const row of this.baseRows) row.destroy();
    this.baseRows = [];

    let y = 158;
    for (const base of this.config.bases) {
      const isSelected = base.id === this.selectedBaseId;
      const line = `${isSelected ? '>' : ' '} ${base.name.padEnd(10)} ${base.faction === Faction.Allies ? 'A' : 'S'} @ ${base.cellX},${base.cellY}`;
      const row = this.add
        .text(12, y, line, {
          fontFamily: 'Consolas, monospace',
          fontSize: '11px',
          color: this.colorToCss(colors.get(base.id) ?? 0xffffff),
          backgroundColor: isSelected ? '#223748' : '#00000044',
          padding: { x: 4, y: 2 },
        })
        .setDepth(10)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      row.on('pointerup', () => {
        this.selectedBaseId = base.id;
        this.selectedOreId = null;
        this.refreshUi();
      });
      this.baseRows.push(row);
      y += 22;
    }
  }

  private rebuildOreRows(): void {
    for (const row of this.oreRows) row.destroy();
    this.oreRows = [];

    let y = 338;
    for (const ore of this.config.oreFields) {
      const isSelected = ore.id === this.selectedOreId;
      const line = `${isSelected ? '>' : ' '} @ ${ore.cellX},${ore.cellY} amount=${this.formatOreAmount(ore.amount)}`;
      const row = this.add
        .text(12, y, line, {
          fontFamily: 'Consolas, monospace',
          fontSize: '11px',
          color: '#b8dfb8',
          backgroundColor: isSelected ? '#2b3f20' : '#00000044',
          padding: { x: 4, y: 2 },
        })
        .setDepth(10)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true });
      row.on('pointerup', () => {
        this.selectedOreId = ore.id;
        this.selectedBaseId = null;
        this.refreshUi();
      });
      this.oreRows.push(row);
      y += 22;
    }
  }

  private syncActionButtons(): void {
    this.styleButton(this.removeBaseButton, !!this.selectedBaseId && this.config.bases.length > 2);
    this.styleButton(this.renameBaseButton, !!this.selectedBaseId);
    this.styleButton(this.factionButton, !!this.selectedBaseId);
    this.styleButton(this.removeOreButton, !!this.selectedOreId);

    const selectedBase = this.getSelectedBase();
    if (selectedBase) {
      this.factionButton.setText(selectedBase.faction === Faction.Allies ? 'To Sov' : 'To Ally');
    } else {
      this.factionButton.setText('Faction');
    }
  }

  private syncStartState(): void {
    this.config.startingCredits = this.getUiStartingCredits();
    const validation = isValidSetup(this.config);
    this.styleButton(this.startButton, validation.ok);
    this.setupStatusText.setText(validation.ok ? 'Ready. Click Start Sim to begin.' : validation.reason ?? '');
  }

  private getBaseColorMap(): Map<string, number> {
    const result = new Map<string, number>();
    const counts: Record<Faction, number> = {
      [Faction.Allies]: 0,
      [Faction.Soviets]: 0,
    };

    for (const base of this.config.bases) {
      const variant = counts[base.faction];
      counts[base.faction] += 1;
      result.set(base.id, getFactionColorVariant(base.faction, variant));
    }
    return result;
  }

  private getSelectedBase(): BaseSpawn | undefined {
    if (!this.selectedBaseId) return undefined;
    return this.config.bases.find((base) => base.id === this.selectedBaseId);
  }

  private getSelectedOre():
    | {
        id: string;
        cellX: number;
        cellY: number;
        amount: number;
      }
    | undefined {
    if (!this.selectedOreId) return undefined;
    return this.config.oreFields.find((ore) => ore.id === this.selectedOreId);
  }

  private pickAtCell(cellX: number, cellY: number): { baseId: string | null; oreId: string | null } {
    let bestBase: BaseSpawn | null = null;
    let bestBaseDist = Infinity;
    for (const base of this.config.bases) {
      const d = Math.hypot(base.cellX - cellX, base.cellY - cellY);
      if (d <= 1 && d < bestBaseDist) {
        bestBase = base;
        bestBaseDist = d;
      }
    }

    let bestOre: (typeof this.config.oreFields)[number] | null = null;
    let bestOreDist = Infinity;
    for (const ore of this.config.oreFields) {
      const d = Math.hypot(ore.cellX - cellX, ore.cellY - cellY);
      if (d <= ORE_FIELD_RADIUS && d < bestOreDist) {
        bestOre = ore;
        bestOreDist = d;
      }
    }

    if (bestBase && (!bestOre || bestBaseDist <= bestOreDist)) {
      return { baseId: bestBase.id, oreId: null };
    }
    if (bestOre) {
      return { baseId: null, oreId: bestOre.id };
    }
    return { baseId: null, oreId: null };
  }

  private createOreControls(): void {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '14px';
    root.style.top = '520px';
    root.style.zIndex = '20';
    root.style.padding = '8px';
    root.style.background = 'rgba(0,0,0,0.55)';
    root.style.border = '1px solid rgba(175,200,225,0.35)';
    root.style.borderRadius = '4px';
    root.style.color = '#cde1f4';
    root.style.fontFamily = 'Consolas, monospace';
    root.style.fontSize = '12px';

    const amountLabel = document.createElement('label');
    amountLabel.textContent = 'Ore amount: ';
    amountLabel.style.marginRight = '6px';

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '1';
    amountInput.step = '100';
    amountInput.value = String(DEFAULT_ORE_AMOUNT);
    amountInput.style.width = '110px';
    amountInput.style.marginRight = '10px';

    const infiniteLabel = document.createElement('label');
    infiniteLabel.style.display = 'inline-flex';
    infiniteLabel.style.alignItems = 'center';
    infiniteLabel.style.gap = '4px';

    const infiniteInput = document.createElement('input');
    infiniteInput.type = 'checkbox';
    infiniteLabel.append(infiniteInput, document.createTextNode('Infinite'));

    root.append(amountLabel, amountInput, infiniteLabel);
    document.body.appendChild(root);

    this.oreControlsRoot = root;
    this.oreAmountInput = amountInput;
    this.oreInfiniteInput = infiniteInput;
  }

  private createStartingCreditsControl(): void {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '14px';
    root.style.top = '474px';
    root.style.zIndex = '20';
    root.style.padding = '8px';
    root.style.background = 'rgba(0,0,0,0.55)';
    root.style.border = '1px solid rgba(175,200,225,0.35)';
    root.style.borderRadius = '4px';
    root.style.color = '#cde1f4';
    root.style.fontFamily = 'Consolas, monospace';
    root.style.fontSize = '12px';

    const label = document.createElement('label');
    label.textContent = 'Starting credits: ';
    label.style.marginRight = '6px';

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '100';
    input.value = String(this.config.startingCredits);
    input.style.width = '110px';
    input.addEventListener('input', () => {
      this.config.startingCredits = this.getUiStartingCredits();
      this.syncStartState();
    });

    root.append(label, input);
    document.body.appendChild(root);

    this.startingCreditsRoot = root;
    this.startingCreditsInput = input;
  }

  private createDebugModeControl(): void {
    const root = document.createElement('div');
    root.style.position = 'fixed';
    root.style.left = '14px';
    root.style.top = '566px';
    root.style.zIndex = '20';
    root.style.padding = '8px';
    root.style.background = 'rgba(0,0,0,0.55)';
    root.style.border = '1px solid rgba(175,200,225,0.35)';
    root.style.borderRadius = '4px';
    root.style.color = '#cde1f4';
    root.style.fontFamily = 'Consolas, monospace';
    root.style.fontSize = '12px';

    const label = document.createElement('label');
    label.style.display = 'inline-flex';
    label.style.alignItems = 'center';
    label.style.gap = '6px';

    const input = document.createElement('input');
    input.type = 'checkbox';
    label.append(input, document.createTextNode('Debug'));

    const maxTicksLabel = document.createElement('label');
    maxTicksLabel.style.display = 'block';
    maxTicksLabel.style.marginTop = '8px';
    maxTicksLabel.textContent = 'Max ticks: ';

    const maxTicksInput = document.createElement('input');
    maxTicksInput.type = 'number';
    maxTicksInput.min = '1';
    maxTicksInput.step = '1000';
    maxTicksInput.value = String(DEFAULT_DEBUG_MAX_TICKS);
    maxTicksInput.style.width = '110px';
    maxTicksInput.style.marginLeft = '6px';
    maxTicksLabel.append(maxTicksInput);

    root.append(label, maxTicksLabel);
    document.body.appendChild(root);

    this.debugModeRoot = root;
    this.debugModeInput = input;
    this.debugMaxTicksInput = maxTicksInput;
  }

  private destroyHtmlControls(): void {
    this.startingCreditsInput = null;
    this.startingCreditsRoot?.remove();
    this.startingCreditsRoot = null;
    this.oreAmountInput = null;
    this.oreInfiniteInput = null;
    this.oreControlsRoot?.remove();
    this.oreControlsRoot = null;
    this.debugModeInput = null;
    this.debugMaxTicksInput = null;
    this.debugModeRoot?.remove();
    this.debugModeRoot = null;
  }

  private getUiOreAmount(): number {
    if (this.oreInfiniteInput?.checked) {
      return Number.POSITIVE_INFINITY;
    }
    const value = Number(this.oreAmountInput?.value ?? DEFAULT_ORE_AMOUNT);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_ORE_AMOUNT;
    return value;
  }

  private getUiStartingCredits(): number {
    const value = Number(this.startingCreditsInput?.value ?? this.config.startingCredits);
    if (!Number.isFinite(value) || value < 0) return -1;
    return Math.floor(value);
  }

  private isDebugMode(): boolean {
    return this.debugModeInput?.checked ?? false;
  }

  private getDebugMaxTicks(): number {
    const value = Number(this.debugMaxTicksInput?.value ?? DEFAULT_DEBUG_MAX_TICKS);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_DEBUG_MAX_TICKS;
    return Math.floor(value);
  }

  private createButton(
    x: number,
    y: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    const button = this.add
      .text(x, y, label, {
        fontFamily: 'Segoe UI, sans-serif',
        fontSize: '12px',
        color: '#d6e9ff',
        backgroundColor: '#23425a',
        padding: { x: 6, y: 4 },
      })
      .setDepth(10)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });

    button.setData('enabled', true);
    button.on('pointerup', () => {
      if (!button.getData('enabled')) return;
      onClick();
    });
    return button;
  }

  private styleButton(button: Phaser.GameObjects.Text, enabled: boolean, active = false): void {
    button.setData('enabled', enabled);
    button.setAlpha(enabled ? 1 : 0.45);
    if (!enabled) {
      button.setBackgroundColor('#343434');
      return;
    }
    button.setBackgroundColor(active ? '#2e6b96' : '#23425a');
  }

  private formatOreAmount(amount: number): string {
    return amount === Number.POSITIVE_INFINITY ? 'inf' : `${Math.floor(amount)}`;
  }

  private colorToCss(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }
}
