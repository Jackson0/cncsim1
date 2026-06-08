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
  centerCameraOnWorld,
  drawGrid,
  pointerToCell,
  renderBaseMarkers,
  renderOrePreview,
  setupCameraControls,
} from './mapView';

type SetupMode = 'bases' | 'ore' | 'select';

interface PointerStart {
  x: number;
  y: number;
}

export class SetupScene extends Phaser.Scene {
  private config: MapSetupConfig = cloneMapSetup(DEFAULT_MAP_SETUP);
  private mode: SetupMode = 'bases';
  private selectedBaseId: string | null = null;
  private selectedOreId: string | null = null;
  private worldGfx!: Phaser.GameObjects.Graphics;
  private markerGfx!: Phaser.GameObjects.Graphics;
  private modeButtons!: Record<SetupMode, HTMLButtonElement>;
  private baseListEl: HTMLDivElement | null = null;
  private oreListEl: HTMLDivElement | null = null;
  private setupStatusEl: HTMLDivElement | null = null;
  private selectedInfoEl: HTMLDivElement | null = null;
  private startButton: HTMLButtonElement | null = null;
  private removeBaseButton: HTMLButtonElement | null = null;
  private renameBaseButton: HTMLButtonElement | null = null;
  private factionButton: HTMLButtonElement | null = null;
  private removeOreButton: HTMLButtonElement | null = null;
  private startingCreditsInput: HTMLInputElement | null = null;
  private oreAmountInput: HTMLInputElement | null = null;
  private oreInfiniteInput: HTMLInputElement | null = null;
  private debugModeInput: HTMLInputElement | null = null;
  private debugMaxTicksInput: HTMLInputElement | null = null;
  private panelRoot: HTMLElement | null = null;
  private pointerStart: PointerStart | null = null;
  private nextId = 3;

  constructor() {
    super('SetupScene');
  }

  create(): void {
    this.config = cloneMapSetup(DEFAULT_MAP_SETUP);
    this.selectedBaseId = this.config.bases[0]?.id ?? null;
    this.selectedOreId = this.config.oreFields[0]?.id ?? null;
    this.nextId = Math.max(this.config.bases.length + 1, this.config.oreFields.length + 1, 3);

    document.body.classList.add('setup-active');
    this.scale.refresh();
    centerCameraOnWorld(this);

    drawGrid(this);
    this.worldGfx = this.add.graphics().setDepth(1);
    this.markerGfx = this.add.graphics().setDepth(3);
    setupCameraControls(this);

    this.buildUi();
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
    const host = document.getElementById('setup-panel-root') ?? document.body;
    host.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'setup-panel';

    const title = document.createElement('div');
    title.className = 'setup-title';
    const heading = document.createElement('h1');
    heading.textContent = 'Setup';
    const mapSize = document.createElement('span');
    mapSize.className = 'setup-help';
    mapSize.textContent = `${MAP_COLS}x${MAP_ROWS}`;
    title.append(heading, mapSize);

    const help = document.createElement('div');
    help.className = 'setup-help';
    help.textContent = 'Tap/click places selected items. Right-drag or touch-drag pans. Wheel or pinch zooms. Del removes selected.';

    const modeSection = this.createSection('Mode');
    const modeRow = document.createElement('div');
    modeRow.className = 'setup-row';
    this.modeButtons = {
      bases: this.createButton('Bases', () => this.setMode('bases')),
      ore: this.createButton('Ore', () => this.setMode('ore')),
      select: this.createButton('Select', () => this.setMode('select')),
    };
    modeRow.append(this.modeButtons.bases, this.modeButtons.ore, this.modeButtons.select);
    modeSection.append(modeRow);

    this.selectedInfoEl = document.createElement('div');
    this.selectedInfoEl.className = 'setup-selected';

    const baseSection = this.createSection('Bases');
    const baseActions = document.createElement('div');
    baseActions.className = 'setup-actions';
    const addBaseButton = this.createButton('+ Add', () => this.addBase());
    this.removeBaseButton = this.createButton('- Remove', () => this.removeSelectedBase());
    this.renameBaseButton = this.createButton('Rename', () => this.renameSelectedBase());
    this.factionButton = this.createButton('Faction', () => this.toggleSelectedBaseFaction());
    baseActions.append(addBaseButton, this.removeBaseButton, this.renameBaseButton, this.factionButton);
    this.baseListEl = document.createElement('div');
    this.baseListEl.className = 'setup-list';
    baseSection.append(baseActions, this.baseListEl);

    const oreSection = this.createSection('Ore fields');
    const oreActions = document.createElement('div');
    oreActions.className = 'setup-actions';
    this.removeOreButton = this.createButton('Remove ore', () => this.removeSelectedOre());
    oreActions.append(this.removeOreButton);
    this.oreListEl = document.createElement('div');
    this.oreListEl.className = 'setup-list';
    oreSection.append(oreActions, this.oreListEl);

    const optionsSection = this.createSection('Options');
    optionsSection.append(
      this.createNumberField('Starting credits', String(this.config.startingCredits), '0', '100', (input) => {
        this.startingCreditsInput = input;
        input.addEventListener('input', () => {
          this.config.startingCredits = this.getUiStartingCredits();
          this.syncStartState();
        });
      }),
      this.createOreAmountField(),
      this.createDebugField(),
    );

    this.setupStatusEl = document.createElement('div');
    this.setupStatusEl.className = 'setup-status';
    this.startButton = this.createButton('Start Sim', () => this.startSimulation());
    this.startButton.classList.add('setup-start');

    panel.append(title, help, modeSection, this.selectedInfoEl, baseSection, oreSection, optionsSection, this.setupStatusEl, this.startButton);
    host.append(panel);
    this.panelRoot = host;
  }

  private createSection(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'setup-section';
    const heading = document.createElement('h2');
    heading.textContent = title;
    section.append(heading);
    return section;
  }

  private createNumberField(
    labelText: string,
    value: string,
    min: string,
    step: string,
    onCreate: (input: HTMLInputElement) => void,
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'setup-field';
    label.append(document.createTextNode(labelText));

    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    input.step = step;
    input.value = value;
    label.append(input);
    onCreate(input);

    return label;
  }

  private createOreAmountField(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'setup-field';

    const amountLabel = document.createElement('label');
    amountLabel.append(document.createTextNode('Ore amount'));

    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.min = '1';
    amountInput.step = '100';
    amountInput.value = String(DEFAULT_ORE_AMOUNT);
    amountLabel.append(amountInput);

    const infiniteLabel = document.createElement('label');
    infiniteLabel.className = 'setup-check';
    const infiniteInput = document.createElement('input');
    infiniteInput.type = 'checkbox';
    infiniteLabel.append(infiniteInput, document.createTextNode('Infinite'));

    root.append(amountLabel, infiniteLabel);
    this.oreAmountInput = amountInput;
    this.oreInfiniteInput = infiniteInput;
    return root;
  }

  private createDebugField(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'setup-field';

    const debugLabel = document.createElement('label');
    debugLabel.className = 'setup-check';
    const debugInput = document.createElement('input');
    debugInput.type = 'checkbox';
    debugLabel.append(debugInput, document.createTextNode('Debug'));

    const maxTicksLabel = document.createElement('label');
    maxTicksLabel.append(document.createTextNode('Max ticks'));
    const maxTicksInput = document.createElement('input');
    maxTicksInput.type = 'number';
    maxTicksInput.min = '1';
    maxTicksInput.step = '1000';
    maxTicksInput.value = String(DEFAULT_DEBUG_MAX_TICKS);
    maxTicksLabel.append(maxTicksInput);

    root.append(debugLabel, maxTicksLabel);
    this.debugModeInput = debugInput;
    this.debugMaxTicksInput = maxTicksInput;
    return root;
  }

  private setupInputHandlers(): void {
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
      cellX: Phaser.Math.Clamp(Math.floor(MAP_COLS / 2) - 8 + index * 4, 1, MAP_COLS - 2),
      cellY: Phaser.Math.Clamp(Math.floor(MAP_ROWS / 2) + (index % 2 === 0 ? -4 : 4), 1, MAP_ROWS - 2),
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
      this.setStatus('At least two bases are required.');
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
      this.setStatus(validation.reason ?? 'Setup is invalid.');
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

    if (this.selectedInfoEl) {
      this.selectedInfoEl.textContent = selectedBase
        ? `Selected base: ${selectedBase.name} (${selectedBase.faction === Faction.Allies ? 'Allies' : 'Soviets'}) @ ${selectedBase.cellX},${selectedBase.cellY}`
        : selectedOre
          ? `Selected ore: ${selectedOre.cellX},${selectedOre.cellY} amount=${this.formatOreAmount(selectedOre.amount)}`
          : 'Selected: none';
    }

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
    if (!this.baseListEl) return;
    this.baseListEl.innerHTML = '';

    for (const base of this.config.bases) {
      const isSelected = base.id === this.selectedBaseId;
      const line = `${isSelected ? '> ' : ''}${base.name.padEnd(10)} ${base.faction === Faction.Allies ? 'A' : 'S'} @ ${base.cellX},${base.cellY}`;
      const row = this.createListButton(line, isSelected);
      row.style.color = this.colorToCss(colors.get(base.id) ?? 0xffffff);
      row.addEventListener('click', () => {
        this.selectedBaseId = base.id;
        this.selectedOreId = null;
        this.refreshUi();
      });
      this.baseListEl.append(row);
    }
  }

  private rebuildOreRows(): void {
    if (!this.oreListEl) return;
    this.oreListEl.innerHTML = '';

    for (const ore of this.config.oreFields) {
      const isSelected = ore.id === this.selectedOreId;
      const line = `${isSelected ? '> ' : ''}@ ${ore.cellX},${ore.cellY} amount=${this.formatOreAmount(ore.amount)}`;
      const row = this.createListButton(line, isSelected);
      row.style.color = '#b8dfb8';
      row.addEventListener('click', () => {
        this.selectedOreId = ore.id;
        this.selectedBaseId = null;
        this.refreshUi();
      });
      this.oreListEl.append(row);
    }
  }

  private syncActionButtons(): void {
    this.styleButton(this.removeBaseButton, !!this.selectedBaseId && this.config.bases.length > 2);
    this.styleButton(this.renameBaseButton, !!this.selectedBaseId);
    this.styleButton(this.factionButton, !!this.selectedBaseId);
    this.styleButton(this.removeOreButton, !!this.selectedOreId);

    const selectedBase = this.getSelectedBase();
    if (this.factionButton) {
      this.factionButton.textContent = selectedBase
        ? selectedBase.faction === Faction.Allies ? 'To Sov' : 'To Ally'
        : 'Faction';
    }
  }

  private syncStartState(): void {
    this.config.startingCredits = this.getUiStartingCredits();
    const validation = isValidSetup(this.config);
    this.styleButton(this.startButton, validation.ok);
    this.setStatus(validation.ok ? 'Ready. Click Start Sim to begin.' : validation.reason ?? '');
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

  private destroyHtmlControls(): void {
    document.body.classList.remove('setup-active');
    if (this.panelRoot) this.panelRoot.innerHTML = '';
    this.panelRoot = null;
    this.baseListEl = null;
    this.oreListEl = null;
    this.setupStatusEl = null;
    this.selectedInfoEl = null;
    this.startButton = null;
    this.removeBaseButton = null;
    this.renameBaseButton = null;
    this.factionButton = null;
    this.removeOreButton = null;
    this.startingCreditsInput = null;
    this.oreAmountInput = null;
    this.oreInfiniteInput = null;
    this.debugModeInput = null;
    this.debugMaxTicksInput = null;
    window.setTimeout(() => this.scale.refresh(), 0);
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

  private createButton(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'setup-button';
    button.textContent = label;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      onClick();
    });
    return button;
  }

  private createListButton(label: string, selected: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `setup-list-button${selected ? ' is-selected' : ''}`;
    button.textContent = label;
    return button;
  }

  private styleButton(button: HTMLButtonElement | null, enabled: boolean, active = false): void {
    if (!button) return;
    button.disabled = !enabled;
    button.classList.toggle('is-active', active);
  }

  private setStatus(text: string): void {
    if (this.setupStatusEl) this.setupStatusEl.textContent = text;
  }

  private formatOreAmount(amount: number): string {
    return amount === Number.POSITIVE_INFINITY ? 'inf' : `${Math.floor(amount)}`;
  }

  private colorToCss(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }
}
