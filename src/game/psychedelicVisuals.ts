import Phaser from 'phaser';
import {
  AIRCRAFT_DEFS,
  AircraftType,
  CELL_SIZE,
  Faction,
  HARVESTER_CAPACITY,
  INFANTRY_DEFS,
  InfantryType,
  MAP_COLS,
  MAP_ROWS,
  STRUCT_DEFS,
  StructType,
  UNIT_DEFS,
  UnitType,
} from './definitions';
import type { Aircraft, Building, House, Infantry, OrePatch, Unit } from './entities';
import type { SimEvent } from './sim/GameSim';

export type VisualQuality = 'low' | 'medium' | 'high';

export interface PsychedelicVisualConfig {
  quality: VisualQuality;
  enableBackgroundFlow: boolean;
  enableTrails: boolean;
  enableOreMandalas: boolean;
  enableCombatMandalas: boolean;
  enableScreenFlashes: boolean;
  enableGridRipples: boolean;
  trailFadeAlpha: number;
  maxParticles: number;
  maxActiveShockwaves: number;
  maxActiveBeams: number;
  maxActiveMandalas: number;
}

export const PSYCHEDELIC_VISUAL_PRESETS: Record<VisualQuality, PsychedelicVisualConfig> = {
  low: {
    quality: 'low',
    enableBackgroundFlow: false,
    enableTrails: true,
    enableOreMandalas: false,
    enableCombatMandalas: false,
    enableScreenFlashes: false,
    enableGridRipples: false,
    trailFadeAlpha: 0.1,
    maxParticles: 140,
    maxActiveShockwaves: 32,
    maxActiveBeams: 36,
    maxActiveMandalas: 12,
  },
  medium: {
    quality: 'medium',
    enableBackgroundFlow: false,
    enableTrails: true,
    enableOreMandalas: true,
    enableCombatMandalas: true,
    enableScreenFlashes: false,
    enableGridRipples: true,
    trailFadeAlpha: 0.15,
    maxParticles: 420,
    maxActiveShockwaves: 80,
    maxActiveBeams: 80,
    maxActiveMandalas: 40,
  },
  high: {
    quality: 'high',
    enableBackgroundFlow: true,
    enableTrails: true,
    enableOreMandalas: true,
    enableCombatMandalas: true,
    enableScreenFlashes: true,
    enableGridRipples: true,
    trailFadeAlpha: 0.2,
    maxParticles: 680,
    maxActiveShockwaves: 120,
    maxActiveBeams: 110,
    maxActiveMandalas: 70,
  },
};

export interface FactionVisualProfile {
  primary: number;
  secondary: number;
  accent: number;
  aura: number;
  pulseSpeed: number;
  pulseOffset: number;
  glyphStyle: 'angular' | 'radial' | 'organic' | 'crystalline';
  trailStyle: 'comet' | 'ribbon' | 'spark' | 'smokeLight';
  beamStyle: 'straight' | 'split' | 'zigzag' | 'wave';
  mandalaSeed: number;
}

interface PulseEffect {
  x: number;
  y: number;
  color: number;
  radius: number;
  intensity: number;
  age: number;
  duration: number;
  ripple: boolean;
}

interface TendrilEffect {
  oreX: number;
  oreY: number;
  harvesterX: number;
  harvesterY: number;
  color: number;
  age: number;
  duration: number;
  phase: number;
}

interface MoteEffect {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  age: number;
  duration: number;
  size: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
}

interface AuraPulse {
  x: number;
  y: number;
  color: number;
  age: number;
  duration: number;
  radius: number;
  kind: 'power' | 'production' | 'economy';
}

interface GlyphBurst {
  x: number;
  y: number;
  color: number;
  age: number;
  duration: number;
  radius: number;
  kind: 'complete' | 'damage' | 'destroy';
}

interface TrailPoint {
  x: number;
  y: number;
  color: number;
  age: number;
  width: number;
}

interface BeamEffect {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  profile: FactionVisualProfile;
  weaponType: string;
  age: number;
  duration: number;
  seed: number;
}

interface ImpactMandala {
  x: number;
  y: number;
  profile: FactionVisualProfile;
  weaponType: string;
  intensity: number;
  age: number;
  duration: number;
  destroy: boolean;
}

export interface CombatVisualStats {
  beams: number;
  mandalas: number;
  particles: number;
  shockwaves: number;
}

export function cloneVisualConfig(quality: VisualQuality = 'medium'): PsychedelicVisualConfig {
  return { ...PSYCHEDELIC_VISUAL_PRESETS[quality] };
}

export function createFactionVisualProfiles(houses: House[]): Map<number, FactionVisualProfile> {
  const profiles = new Map<number, FactionVisualProfile>();
  const factionCounts: Record<Faction, number> = {
    [Faction.Allies]: 0,
    [Faction.Soviets]: 0,
  };

  for (const house of houses) {
    const variant = factionCounts[house.faction]++;
    profiles.set(house.id, createFactionVisualProfile(house, variant));
  }

  return profiles;
}

export function fallbackProfile(color = 0xc8f7ff): FactionVisualProfile {
  return {
    primary: color,
    secondary: shiftHue(color, 0.12),
    accent: 0xffffff,
    aura: mixColor(color, 0xffffff, 0.3),
    pulseSpeed: 1.4,
    pulseOffset: 0,
    glyphStyle: 'radial',
    trailStyle: 'comet',
    beamStyle: 'straight',
    mandalaSeed: 1,
  };
}

class ConfigurableRenderer {
  protected config: PsychedelicVisualConfig;

  constructor(config: PsychedelicVisualConfig) {
    this.config = config;
  }

  setConfig(config: PsychedelicVisualConfig): void {
    this.config = config;
  }
}

export class SignalFieldRenderer extends ConfigurableRenderer {
  private staticGfx: Phaser.GameObjects.Graphics;
  private flowGfx: Phaser.GameObjects.Graphics;
  private pulseGfx: Phaser.GameObjects.Graphics;
  private pulses: PulseEffect[] = [];

  constructor(
    scene: Phaser.Scene,
    private width: number,
    private height: number,
    config: PsychedelicVisualConfig,
  ) {
    super(config);
    this.staticGfx = scene.add.graphics().setDepth(0);
    this.flowGfx = scene.add.graphics().setDepth(0.2).setBlendMode(Phaser.BlendModes.ADD);
    this.pulseGfx = scene.add.graphics().setDepth(0.4).setBlendMode(Phaser.BlendModes.ADD);
    this.renderStaticField();
  }

  renderStaticField(): void {
    const g = this.staticGfx;
    g.clear();
    g.fillStyle(0x03040a, 1);
    g.fillRect(0, 0, this.width, this.height);
    g.fillStyle(0x071221, 0.86);
    g.fillRect(0, 0, this.width, this.height);

    for (let i = 0; i < 8; i++) {
      const radius = Math.max(this.width, this.height) * (0.58 - i * 0.045);
      g.fillStyle(i % 2 === 0 ? 0x072838 : 0x1a0826, 0.035);
      g.fillCircle(this.width / 2, this.height / 2, radius);
    }

    g.lineStyle(1, 0x44d9ff, 0.11);
    for (let x = 0; x <= MAP_COLS; x++) {
      const alpha = x % 4 === 0 ? 0.2 : 0.085;
      g.lineStyle(1, x % 4 === 0 ? 0x7bffee : 0x28758d, alpha);
      g.lineBetween(x * CELL_SIZE, 0, x * CELL_SIZE, this.height);
    }
    for (let y = 0; y <= MAP_ROWS; y++) {
      const alpha = y % 4 === 0 ? 0.18 : 0.075;
      g.lineStyle(1, y % 4 === 0 ? 0x7bffee : 0x28758d, alpha);
      g.lineBetween(0, y * CELL_SIZE, this.width, y * CELL_SIZE);
    }

    g.lineStyle(1, 0x86fff2, 0.06);
    for (let x = -this.height; x < this.width; x += CELL_SIZE * 3) {
      g.lineBetween(x, this.height, x + this.height, 0);
    }
    g.lineStyle(1, 0xff4fd8, 0.045);
    for (let x = 0; x < this.width + this.height; x += CELL_SIZE * 5) {
      g.lineBetween(x, 0, x - this.height, this.height);
    }

    for (let y = 0; y < MAP_ROWS; y += 2) {
      for (let x = 0; x < MAP_COLS; x += 2) {
        const cx = x * CELL_SIZE + CELL_SIZE / 2;
        const cy = y * CELL_SIZE + CELL_SIZE / 2;
        const n = Math.sin(x * 1.7 + y * 0.91) + Math.cos(x * 0.31 - y * 1.27);
        const color = n > 0.65 ? 0x6affd9 : n < -0.45 ? 0xff55ba : 0x5577ff;
        g.fillStyle(color, 0.06);
        g.fillCircle(cx, cy, 1 + Math.abs(n) * 0.9);
      }
    }

    g.lineStyle(2, 0xd9ffff, 0.13);
    g.strokeRect(1, 1, this.width - 2, this.height - 2);
  }

  update(time: number, delta: number): void {
    this.flowGfx.clear();
    this.pulseGfx.clear();

    if (this.config.enableBackgroundFlow) {
      this.drawBackgroundFlow(time);
    }

    this.pulses = this.pulses.filter((pulse) => {
      pulse.age += delta;
      const pct = Phaser.Math.Clamp(pulse.age / pulse.duration, 0, 1);
      const alpha = (1 - pct) * pulse.intensity;
      const r = pulse.radius * (0.12 + pct);

      this.pulseGfx.lineStyle(pulse.ripple ? 2 : 1, pulse.color, alpha * 0.58);
      this.pulseGfx.strokeCircle(pulse.x, pulse.y, r);
      this.pulseGfx.lineStyle(1, 0xffffff, alpha * 0.22);
      this.pulseGfx.strokeCircle(pulse.x, pulse.y, r * 0.62);

      if (pulse.ripple) {
        const cellX = Math.floor(pulse.x / CELL_SIZE);
        const cellY = Math.floor(pulse.y / CELL_SIZE);
        const span = Math.ceil((r / CELL_SIZE) * 0.65);
        this.pulseGfx.lineStyle(1, pulse.color, alpha * 0.18);
        for (let i = -span; i <= span; i++) {
          const x = (cellX + i) * CELL_SIZE;
          const y = (cellY + i) * CELL_SIZE;
          if (x >= 0 && x <= this.width) this.pulseGfx.lineBetween(x, pulse.y - r * 0.3, x, pulse.y + r * 0.3);
          if (y >= 0 && y <= this.height) this.pulseGfx.lineBetween(pulse.x - r * 0.3, y, pulse.x + r * 0.3, y);
        }
      }

      return pulse.age < pulse.duration;
    });
  }

  emitPulse(x: number, y: number, color: number, radius: number, intensity: number): void {
    this.pulses.push({
      x,
      y,
      color,
      radius,
      intensity,
      age: 0,
      duration: 900,
      ripple: false,
    });
    this.trimPulses();
  }

  emitGridRipple(x: number, y: number, color: number): void {
    if (!this.config.enableGridRipples) return;
    this.pulses.push({
      x,
      y,
      color,
      radius: CELL_SIZE * 4.2,
      intensity: 0.55,
      age: 0,
      duration: 620,
      ripple: true,
    });
    this.trimPulses();
  }

  private drawBackgroundFlow(time: number): void {
    const g = this.flowGfx;
    const t = time / 1000;
    const count = this.config.quality === 'high' ? 22 : 10;

    for (let i = 0; i < count; i++) {
      const offset = ((t * (12 + i * 0.37) + i * CELL_SIZE * 2.7) % (this.width + this.height)) - this.height;
      const alpha = 0.035 + Math.sin(t * 0.4 + i * 1.7) * 0.012;
      g.lineStyle(1, i % 3 === 0 ? 0xff4fd8 : 0x66ffe2, alpha);
      g.lineBetween(offset, this.height, offset + this.height, 0);
    }
  }

  private trimPulses(): void {
    while (this.pulses.length > this.config.maxActiveShockwaves) this.pulses.shift();
  }
}

export class OreBloomRenderer extends ConfigurableRenderer {
  private fieldGfx: Phaser.GameObjects.Graphics;
  private effectGfx: Phaser.GameObjects.Graphics;
  private maxAmountById = new Map<number, number>();
  private amountRatioOverride = new Map<string, number>();
  private tendrils: TendrilEffect[] = [];
  private motes: MoteEffect[] = [];

  constructor(scene: Phaser.Scene, config: PsychedelicVisualConfig) {
    super(config);
    this.fieldGfx = scene.add.graphics().setDepth(1).setBlendMode(Phaser.BlendModes.ADD);
    this.effectGfx = scene.add.graphics().setDepth(4.4).setBlendMode(Phaser.BlendModes.ADD);
  }

  updateOreFields(fields: OrePatch[], time: number, delta: number): void {
    this.fieldGfx.clear();
    this.effectGfx.clear();
    for (const field of fields) this.updateOreField(field, time);
    this.updateTendrils(delta);
    this.updateMotes(delta);
  }

  updateOreField(field: OrePatch, time: number): void {
    const maxKnown = this.maxAmountById.get(field.id);
    if (maxKnown === undefined && Number.isFinite(field.amount)) {
      this.maxAmountById.set(field.id, Math.max(1, field.amount));
    }
    const maxAmount = this.maxAmountById.get(field.id) ?? Math.max(1, field.amount);
    const override = this.amountRatioOverride.get(String(field.id));
    const ratio =
      override ??
      (field.amount === Number.POSITIVE_INFINITY ? 1 : Phaser.Math.Clamp(field.amount / maxAmount, 0.05, 1));
    const cx = field.cellX * CELL_SIZE + CELL_SIZE / 2;
    const cy = field.cellY * CELL_SIZE + CELL_SIZE / 2;
    const radius = field.radius * CELL_SIZE;
    const breath = 0.86 + Math.sin(time * 0.0012 + field.id * 1.31) * 0.14;
    const phase = time * 0.00045 + field.id * 0.73;
    const petals = this.config.quality === 'low' ? 8 : this.config.quality === 'high' ? 18 : 13;
    const rings = this.config.enableOreMandalas ? (this.config.quality === 'high' ? 4 : 3) : 2;
    const coreColor = mixColor(0x57ffd2, 0xffe06d, 0.24 + ratio * 0.38);
    const shadowColor = mixColor(0x2e6fff, 0xff43ba, 0.34);

    this.fieldGfx.fillStyle(0x5affd6, 0.08 * ratio * breath);
    this.fieldGfx.fillCircle(cx, cy, radius * 1.28 * breath);
    this.fieldGfx.fillStyle(0xffd76d, 0.045 * ratio);
    this.fieldGfx.fillCircle(cx, cy, radius * 0.82);
    this.fieldGfx.fillStyle(shadowColor, 0.035 * ratio);
    this.fieldGfx.fillCircle(cx, cy, radius * 1.5);

    for (let i = 0; i < rings; i++) {
      const ringPct = (i + 1) / rings;
      const ringRadius = radius * (0.24 + ringPct * 0.78) * breath;
      this.fieldGfx.lineStyle(i === rings - 1 ? 2 : 1, i % 2 === 0 ? 0x70ffd8 : 0xffda78, (0.16 + ratio * 0.22) * (1 - i * 0.08));
      this.fieldGfx.strokeCircle(cx, cy, ringRadius);
    }

    if (this.config.enableOreMandalas) {
      for (let i = 0; i < petals; i++) {
        const a = phase + (Math.PI * 2 * i) / petals;
        const alternate = i % 2 === 0;
        const petalWave = 0.7 + Math.sin(time * 0.002 + i * 0.9 + field.id) * 0.16;
        const inner = radius * (0.22 + ratio * 0.08);
        const outer = radius * (0.58 + ratio * 0.28) * petalWave;
        const ix = cx + Math.cos(a) * inner;
        const iy = cy + Math.sin(a) * inner;
        const ox = cx + Math.cos(a) * outer;
        const oy = cy + Math.sin(a) * outer;
        const color = alternate ? 0x65ffd5 : 0xffd866;

        this.fieldGfx.lineStyle(alternate ? 1 : 2, color, 0.22 + ratio * 0.34);
        this.fieldGfx.lineBetween(ix, iy, ox, oy);
        this.fieldGfx.fillStyle(color, 0.3 + ratio * 0.36);
        this.fieldGfx.fillCircle(ox, oy, 2 + ratio * 3.5);
      }
    }

    const orbiters = this.config.quality === 'high' ? 6 : this.config.quality === 'medium' ? 3 : 0;
    for (let i = 0; i < orbiters; i++) {
      const a = -phase * (1.2 + i * 0.08) + (Math.PI * 2 * i) / orbiters;
      const r = radius * (0.46 + i * 0.08);
      this.fieldGfx.fillStyle(i % 2 === 0 ? 0xffffff : coreColor, 0.48 * ratio);
      this.fieldGfx.fillCircle(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2 + ratio * 2);
    }

    this.fieldGfx.fillStyle(coreColor, 0.72 * ratio);
    this.fieldGfx.fillCircle(cx, cy, 4 + ratio * 5);
  }

  emitHarvestTendril(oreX: number, oreY: number, harvesterX: number, harvesterY: number, color: number): void {
    this.tendrils.push({
      oreX,
      oreY,
      harvesterX,
      harvesterY,
      color,
      age: 0,
      duration: 320,
      phase: Math.random() * Math.PI * 2,
    });
    while (this.tendrils.length > 24) this.tendrils.shift();

    const moteCount = this.config.quality === 'high' ? 5 : this.config.quality === 'medium' ? 3 : 1;
    for (let i = 0; i < moteCount; i++) {
      if (this.motes.length >= this.config.maxParticles) break;
      this.motes.push({
        x: oreX,
        y: oreY,
        vx: 0,
        vy: 0,
        color: i % 2 === 0 ? 0xffe06d : color,
        age: i * -45,
        duration: 420 + i * 35,
        size: 2.1 + i * 0.45,
        fromX: oreX,
        fromY: oreY,
        toX: harvesterX,
        toY: harvesterY,
      });
    }
  }

  setOreAmountRatio(fieldId: string, ratio: number): void {
    this.amountRatioOverride.set(fieldId, Phaser.Math.Clamp(ratio, 0, 1));
  }

  private updateTendrils(delta: number): void {
    this.tendrils = this.tendrils.filter((tendril) => {
      tendril.age += delta;
      const pct = Phaser.Math.Clamp(tendril.age / tendril.duration, 0, 1);
      const alpha = 1 - pct;
      const points = this.makeWavyLine(
        tendril.oreX,
        tendril.oreY,
        tendril.harvesterX,
        tendril.harvesterY,
        7,
        8 + Math.sin(tendril.phase) * 3,
        tendril.phase + tendril.age * 0.018,
      );

      this.effectGfx.lineStyle(4, tendril.color, alpha * 0.14);
      this.strokePolyline(this.effectGfx, points);
      this.effectGfx.lineStyle(1, 0xffffff, alpha * 0.65);
      this.strokePolyline(this.effectGfx, points);
      return tendril.age < tendril.duration;
    });
  }

  private updateMotes(delta: number): void {
    this.motes = this.motes.filter((mote) => {
      mote.age += delta;
      if (mote.age < 0) return true;
      const pct = Phaser.Math.Clamp(mote.age / mote.duration, 0, 1);
      const alpha = 1 - pct;

      if (mote.fromX !== undefined && mote.toX !== undefined && mote.fromY !== undefined && mote.toY !== undefined) {
        const bend = Math.sin(pct * Math.PI) * 7;
        const dx = mote.toX - mote.fromX;
        const dy = mote.toY - mote.fromY;
        const len = Math.max(1, Math.hypot(dx, dy));
        mote.x = Phaser.Math.Linear(mote.fromX, mote.toX, pct) + (-dy / len) * bend;
        mote.y = Phaser.Math.Linear(mote.fromY, mote.toY, pct) + (dx / len) * bend;
      } else {
        mote.x += mote.vx * (delta / 16.67);
        mote.y += mote.vy * (delta / 16.67);
      }

      this.effectGfx.fillStyle(mote.color, alpha * 0.62);
      this.effectGfx.fillCircle(mote.x, mote.y, mote.size * (0.7 + pct * 0.6));
      this.effectGfx.fillStyle(0xffffff, alpha * 0.42);
      this.effectGfx.fillCircle(mote.x, mote.y, Math.max(1, mote.size * 0.45));
      return mote.age < mote.duration;
    });
  }

  private makeWavyLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    segments: number,
    amplitude: number,
    phase: number,
  ): Phaser.Math.Vector2[] {
    const points: Phaser.Math.Vector2[] = [];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len;
    const ny = dx / len;

    for (let i = 0; i <= segments; i++) {
      const pct = i / segments;
      const wave = Math.sin(phase + pct * Math.PI * 2) * amplitude * Math.sin(pct * Math.PI);
      points.push(new Phaser.Math.Vector2(Phaser.Math.Linear(fromX, toX, pct) + nx * wave, Phaser.Math.Linear(fromY, toY, pct) + ny * wave));
    }

    return points;
  }

  private strokePolyline(g: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[]): void {
    for (let i = 1; i < points.length; i++) {
      g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    }
  }
}

export class BaseAuraRenderer extends ConfigurableRenderer {
  private gfx: Phaser.GameObjects.Graphics;
  private pulses: AuraPulse[] = [];
  private redrawTimer = 0;

  constructor(scene: Phaser.Scene, config: PsychedelicVisualConfig) {
    super(config);
    this.gfx = scene.add.graphics().setDepth(2).setBlendMode(Phaser.BlendModes.ADD);
  }

  updateBase(_base: House, _profile: FactionVisualProfile, _time: number): void {
    // The batched updateBases path keeps all base circuit lines in one Graphics object.
  }

  updateBases(houses: House[], buildings: Building[], profiles: Map<number, FactionVisualProfile>, time: number, delta: number): void {
    this.redrawTimer += delta;
    const shouldRedraw = this.redrawTimer >= (this.config.quality === 'low' ? 180 : 110);
    if (!shouldRedraw && this.pulses.length === 0) return;

    this.redrawTimer = 0;
    this.gfx.clear();

    for (const house of houses) {
      const profile = profiles.get(house.id) ?? fallbackProfile(house.color);
      const owned = buildings.filter((b) => b.houseId === house.id && b.isComplete);
      if (owned.length === 0) continue;

      const center = this.getBaseCenter(house, owned);
      const pulse = 0.86 + Math.sin(time * 0.001 * profile.pulseSpeed + profile.pulseOffset) * 0.14;
      const radius = CELL_SIZE * (2.7 + Math.min(6, owned.length * 0.24));

      this.gfx.fillStyle(profile.aura, 0.035 * pulse);
      this.gfx.fillCircle(center.x, center.y, radius);
      this.gfx.lineStyle(1, profile.primary, 0.1 * pulse);
      this.gfx.strokeCircle(center.x, center.y, radius * 0.74);

      for (const building of owned) {
        const b = buildingCenter(building);
        this.gfx.lineStyle(1, profile.secondary, 0.07 + pulse * 0.06);
        this.gfx.lineBetween(center.x, center.y, b.x, b.y);
        this.gfx.fillStyle(profile.primary, 0.08);
        this.gfx.fillCircle(b.x, b.y, CELL_SIZE * 0.72);
      }
    }

    this.drawPulses(delta);
  }

  emitPowerPulse(_base: House, sourceBuilding: Building): void {
    const c = buildingCenter(sourceBuilding);
    this.addPulse(c.x, c.y, 0x7dffcf, 'power', CELL_SIZE * 3.2);
  }

  emitProductionPulse(_base: House, sourceBuilding: Building): void {
    const c = buildingCenter(sourceBuilding);
    this.addPulse(c.x, c.y, 0xf3d4ff, 'production', CELL_SIZE * 2.8);
  }

  emitEconomyPulse(_base: House, refinery: Building): void {
    const c = buildingCenter(refinery);
    this.addPulse(c.x, c.y, 0xffd96b, 'economy', CELL_SIZE * 3.4);
  }

  private drawPulses(delta: number): void {
    this.pulses = this.pulses.filter((pulse) => {
      pulse.age += delta;
      const pct = Phaser.Math.Clamp(pulse.age / pulse.duration, 0, 1);
      const alpha = 1 - pct;
      const radius = pulse.radius * (0.18 + pct);
      const color = pulse.kind === 'economy' ? 0xffd96b : pulse.kind === 'production' ? 0xf2a6ff : pulse.color;
      this.gfx.lineStyle(pulse.kind === 'power' ? 1 : 2, color, alpha * 0.32);
      this.gfx.strokeCircle(pulse.x, pulse.y, radius);
      this.gfx.fillStyle(color, alpha * 0.025);
      this.gfx.fillCircle(pulse.x, pulse.y, radius * 0.75);
      return pulse.age < pulse.duration;
    });
  }

  private addPulse(x: number, y: number, color: number, kind: AuraPulse['kind'], radius: number): void {
    this.pulses.push({ x, y, color, age: 0, duration: 760, radius, kind });
    while (this.pulses.length > this.config.maxActiveShockwaves) this.pulses.shift();
  }

  private getBaseCenter(house: House, buildings: Building[]): Phaser.Math.Vector2 {
    const cyard = buildings.find((b) => b.type === StructType.Const) ?? buildings[0];
    if (cyard) return buildingCenter(cyard);
    return new Phaser.Math.Vector2((house.centerX + 0.5) * CELL_SIZE, (house.centerY + 0.5) * CELL_SIZE);
  }
}

export class BuildingGlyphRenderer extends ConfigurableRenderer {
  private gfx: Phaser.GameObjects.Graphics;
  private bursts: GlyphBurst[] = [];

  constructor(scene: Phaser.Scene, config: PsychedelicVisualConfig) {
    super(config);
    this.gfx = scene.add.graphics().setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
  }

  beginFrame(): void {
    this.gfx.clear();
  }

  drawBuilding(building: Building, profile: FactionVisualProfile, time: number): void {
    const def = STRUCT_DEFS[building.type];
    const c = buildingCenter(building);
    const radius = Math.max(def.width, def.height) * CELL_SIZE * 0.5 + 6;
    const phase = time * 0.001 * profile.pulseSpeed + profile.pulseOffset + building.id * 0.21;
    const healthRatio = Phaser.Math.Clamp(building.hp / building.maxHp, 0, 1);

    if (!building.isComplete) {
      this.drawConstruction(building, building.buildProgress / building.buildTime, profile, time);
      return;
    }

    const flicker = healthRatio < 0.35 ? 0.72 + Math.sin(time * 0.015 + building.id) * 0.28 : 1;
    const auraAlpha = (0.11 + Math.sin(phase) * 0.035) * flicker;

    this.gfx.fillStyle(profile.aura, auraAlpha * 0.42);
    this.gfx.fillCircle(c.x, c.y, radius * 1.22);
    this.gfx.lineStyle(1, profile.secondary, 0.22 * flicker);
    this.gfx.strokeCircle(c.x, c.y, radius * (0.92 + Math.sin(phase * 0.8) * 0.04));

    switch (building.type) {
      case StructType.Const:
        this.drawConstructionYard(c.x, c.y, radius, profile, phase, flicker);
        break;
      case StructType.Power:
      case StructType.AdvPower:
        this.drawPowerGlyph(c.x, c.y, radius, profile, phase, building.type === StructType.AdvPower);
        break;
      case StructType.Refinery:
        this.drawRefineryGlyph(c.x, c.y, radius, profile, phase);
        break;
      case StructType.Barracks:
      case StructType.Tent:
        this.drawSpawnerGlyph(c.x, c.y, radius, profile, phase, building.type === StructType.Tent);
        break;
      case StructType.WarFactory:
        this.drawWarFactoryGlyph(c.x, c.y, radius, profile, phase);
        break;
      case StructType.Pillbox:
      case StructType.Turret:
      case StructType.FlameTurret:
      case StructType.Sam:
      case StructType.AaGun:
        this.drawSentryGlyph(c.x, c.y, radius, profile, phase, building.type);
        break;
      case StructType.Tesla:
        this.drawTeslaGlyph(c.x, c.y, radius, profile, phase);
        break;
      case StructType.Tech:
        this.drawTechGlyph(c.x, c.y, radius, profile, phase);
        break;
      case StructType.Helipad:
      case StructType.Airstrip:
        this.drawLaunchGlyph(c.x, c.y, radius, profile, phase, building.type === StructType.Airstrip);
        break;
      default:
        this.drawCorePolygon(c.x, c.y, radius, 6, profile, phase, 0.94);
        break;
    }

    if (building.hp < building.maxHp) this.drawIntegrityArc(c.x, c.y, radius * 1.08, healthRatio);
  }

  drawConstruction(building: Building, progress: number, profile: FactionVisualProfile, time: number): void {
    const def = STRUCT_DEFS[building.type];
    const c = buildingCenter(building);
    const w = def.width * CELL_SIZE;
    const h = def.height * CELL_SIZE;
    const radius = Math.max(w, h) * 0.48 + 4;
    const pct = Phaser.Math.Clamp(progress, 0, 1);
    const phase = time * 0.002 + building.id * 0.37;

    this.gfx.fillStyle(profile.primary, 0.05 + pct * 0.06);
    this.gfx.fillRect(c.x - w / 2, c.y - h / 2, w, h);
    this.gfx.lineStyle(1, profile.secondary, 0.22 + pct * 0.22);
    this.gfx.strokeRect(c.x - w / 2, c.y - h / 2, w, h);
    this.gfx.lineStyle(1, 0xffffff, 0.15 + pct * 0.22);
    this.gfx.strokeCircle(c.x, c.y, radius * (0.65 + pct * 0.24));

    for (let i = 0; i < 4; i++) {
      const a = phase + (Math.PI * 2 * i) / 4;
      const start = a;
      const end = a + Math.PI * 0.3 + pct * Math.PI * 0.5;
      this.gfx.lineStyle(2, i % 2 === 0 ? profile.primary : profile.accent, 0.38 + pct * 0.38);
      this.gfx.beginPath();
      this.gfx.arc(c.x, c.y, radius, start, end);
      this.gfx.strokePath();

      const moteX = c.x + Math.cos(a + pct * Math.PI) * radius;
      const moteY = c.y + Math.sin(a + pct * Math.PI) * radius;
      this.gfx.fillStyle(profile.accent, 0.6);
      this.gfx.fillCircle(moteX, moteY, 2.5);
    }

    this.drawProgressArc(c.x, c.y, radius * 1.15, pct, 0xffd96b);
  }

  emitBuildComplete(building: Building, profile: FactionVisualProfile): void {
    const c = buildingCenter(building);
    this.bursts.push({ x: c.x, y: c.y, color: profile.accent, age: 0, duration: 640, radius: CELL_SIZE * 2.8, kind: 'complete' });
    this.trimBursts();
  }

  emitBuildingDamaged(building: Building, damageAmount: number, profile: FactionVisualProfile): void {
    const c = buildingCenter(building);
    this.bursts.push({
      x: c.x,
      y: c.y,
      color: mixColor(profile.primary, 0xff4f79, 0.55),
      age: 0,
      duration: 300,
      radius: CELL_SIZE * (0.8 + damageAmount / 80),
      kind: 'damage',
    });
    this.trimBursts();
  }

  emitBuildingDestroyed(building: Building, profile: FactionVisualProfile): void {
    const c = buildingCenter(building);
    this.bursts.push({ x: c.x, y: c.y, color: profile.primary, age: 0, duration: 760, radius: CELL_SIZE * 4, kind: 'destroy' });
    this.trimBursts();
  }

  update(time: number, delta: number): void {
    this.bursts = this.bursts.filter((burst) => {
      burst.age += delta;
      const pct = Phaser.Math.Clamp(burst.age / burst.duration, 0, 1);
      const alpha = 1 - pct;
      const radius = burst.radius * (burst.kind === 'damage' ? 0.35 + pct * 0.5 : 0.2 + pct);

      this.gfx.lineStyle(burst.kind === 'damage' ? 1 : 2, burst.color, alpha * 0.48);
      this.gfx.strokeCircle(burst.x, burst.y, radius);
      if (burst.kind !== 'damage') {
        drawRadialSpokes(this.gfx, burst.x, burst.y, radius * 0.22, radius, 10, time * 0.001, burst.color, alpha * 0.25);
      }
      return burst.age < burst.duration;
    });
  }

  private drawConstructionYard(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number, alpha: number): void {
    this.drawCorePolygon(x, y, radius * 0.52, 8, profile, phase, alpha);
    this.gfx.lineStyle(2, profile.secondary, 0.5 * alpha);
    this.gfx.strokeCircle(x, y, radius * 0.72);
    this.gfx.lineStyle(1, profile.accent, 0.42 * alpha);
    this.gfx.strokeCircle(x, y, radius * 0.42);

    for (let i = 0; i < 4; i++) {
      const a = phase * 0.2 + (Math.PI * 2 * i) / 4;
      const ax = x + Math.cos(a) * radius * 0.9;
      const ay = y + Math.sin(a) * radius * 0.9;
      this.gfx.lineStyle(2, profile.primary, 0.58 * alpha);
      this.gfx.lineBetween(x, y, ax, ay);
      drawDiamond(this.gfx, ax, ay, radius * 0.14, profile.accent, profile.primary, 0.82 * alpha, a);
    }
  }

  private drawPowerGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number, advanced: boolean): void {
    const spokes = advanced ? 12 : 8;
    this.gfx.lineStyle(2, profile.primary, 0.54);
    this.gfx.strokeCircle(x, y, radius * 0.48);
    this.gfx.lineStyle(1, profile.accent, 0.36);
    this.gfx.strokeCircle(x, y, radius * (advanced ? 0.82 : 0.66));
    drawRadialSpokes(this.gfx, x, y, radius * 0.16, radius * 0.78, spokes, phase, profile.secondary, 0.58);
    this.drawCorePolygon(x, y, radius * 0.34, advanced ? 10 : 6, profile, -phase * 0.8, 0.92);
  }

  private drawRefineryGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number): void {
    this.gfx.lineStyle(3, 0xffd86d, 0.56);
    this.gfx.beginPath();
    this.gfx.arc(x, y, radius * 0.54, phase, phase + Math.PI * 1.35);
    this.gfx.strokePath();
    this.gfx.lineStyle(2, profile.primary, 0.46);
    this.gfx.beginPath();
    this.gfx.arc(x, y, radius * 0.32, phase + Math.PI, phase + Math.PI * 2.52);
    this.gfx.strokePath();
    drawRadialSpokes(this.gfx, x, y, radius * 0.18, radius * 0.7, 7, -phase, 0xffd96b, 0.3);
    drawDiamond(this.gfx, x, y, radius * 0.32, mixColor(0xffd96b, profile.primary, 0.25), profile.accent, 0.88, phase * 0.5);
  }

  private drawSpawnerGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number, allied: boolean): void {
    const sides = allied ? 7 : 5;
    this.gfx.fillStyle(profile.secondary, 0.12);
    this.gfx.fillCircle(x, y, radius * 0.58);
    this.drawCorePolygon(x, y, radius * 0.44, sides, profile, phase * 0.35, 0.9);
    this.gfx.lineStyle(1, profile.accent, 0.5);
    this.gfx.strokeCircle(x, y, radius * (0.22 + Math.sin(phase) * 0.035));
  }

  private drawWarFactoryGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number): void {
    this.gfx.lineStyle(2, profile.primary, 0.58);
    this.gfx.strokeRect(x - radius * 0.52, y - radius * 0.34, radius * 1.04, radius * 0.68);
    this.gfx.lineStyle(1, profile.secondary, 0.4);
    this.gfx.strokeRect(x - radius * 0.34, y - radius * 0.52, radius * 0.68, radius * 1.04);
    drawRadialSpokes(this.gfx, x, y, radius * 0.2, radius * 0.6, 6, phase, profile.accent, 0.38);
    this.drawCorePolygon(x, y, radius * 0.28, 6, profile, phase * 0.6, 0.96);
  }

  private drawSentryGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number, type: StructType): void {
    const color = type === StructType.FlameTurret ? 0xff9a3d : type === StructType.Sam || type === StructType.AaGun ? 0x8fdcff : profile.primary;
    this.gfx.lineStyle(2, color, 0.66);
    this.gfx.strokeCircle(x, y, radius * 0.42);
    this.gfx.lineStyle(2, profile.accent, 0.42);
    const prongs = type === StructType.Sam || type === StructType.AaGun ? 6 : 4;
    drawRadialSpokes(this.gfx, x, y, radius * 0.18, radius * 0.64, prongs, phase, color, 0.64);
    this.gfx.fillStyle(color, 0.66);
    this.gfx.fillCircle(x, y, radius * 0.16);
  }

  private drawTeslaGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number): void {
    this.gfx.lineStyle(2, 0xaaffff, 0.72);
    this.gfx.strokeCircle(x, y, radius * (0.48 + Math.sin(phase * 2.3) * 0.05));
    this.drawCorePolygon(x, y, radius * 0.34, 9, { ...profile, primary: 0x8fffff, secondary: profile.primary }, phase, 0.95);
    for (let i = 0; i < 5; i++) {
      const a = phase * 1.7 + (Math.PI * 2 * i) / 5;
      const r1 = radius * 0.2;
      const r2 = radius * (0.58 + Math.sin(phase + i) * 0.08);
      this.gfx.lineStyle(1, i % 2 === 0 ? 0xffffff : 0x55fff1, 0.52);
      this.gfx.lineBetween(x + Math.cos(a) * r1, y + Math.sin(a) * r1, x + Math.cos(a + 0.25) * r2, y + Math.sin(a + 0.25) * r2);
    }
  }

  private drawTechGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number): void {
    for (let i = 0; i < 4; i++) {
      this.gfx.lineStyle(1 + (i % 2), i % 2 === 0 ? profile.primary : profile.accent, 0.24 + i * 0.08);
      this.gfx.strokeCircle(x, y, radius * (0.2 + i * 0.16));
    }
    this.drawCorePolygon(x, y, radius * 0.34, 12, profile, phase * 0.18, 0.95);
    drawRadialSpokes(this.gfx, x, y, radius * 0.12, radius * 0.72, 12, -phase * 0.4, profile.secondary, 0.34);
  }

  private drawLaunchGlyph(x: number, y: number, radius: number, profile: FactionVisualProfile, phase: number, airstrip: boolean): void {
    this.gfx.lineStyle(2, profile.primary, 0.52);
    if (airstrip) {
      this.gfx.strokeRect(x - radius * 0.72, y - radius * 0.28, radius * 1.44, radius * 0.56);
      this.gfx.lineBetween(x - radius * 0.64, y, x + radius * 0.64, y);
    } else {
      this.gfx.strokeCircle(x, y, radius * 0.58);
      this.gfx.lineBetween(x - radius * 0.5, y, x + radius * 0.5, y);
      this.gfx.lineBetween(x, y - radius * 0.5, x, y + radius * 0.5);
    }
    this.gfx.lineStyle(1, profile.accent, 0.42);
    this.gfx.beginPath();
    this.gfx.arc(x, y, radius * 0.72, phase, phase + Math.PI * 0.78);
    this.gfx.strokePath();
  }

  private drawCorePolygon(x: number, y: number, radius: number, sides: number, profile: FactionVisualProfile, phase: number, alpha: number): void {
    const pts = radialPoints(x, y, radius, sides, phase);
    this.gfx.fillStyle(mixColor(profile.primary, profile.secondary, 0.24), alpha * 0.34);
    this.gfx.fillPoints(pts, true);
    this.gfx.lineStyle(2, profile.primary, alpha * 0.78);
    this.gfx.strokePoints([...pts, pts[0]], false);
    this.gfx.lineStyle(1, profile.accent, alpha * 0.46);
    this.gfx.strokeCircle(x, y, radius * 0.52);
    this.gfx.fillStyle(0xffffff, alpha * 0.8);
    this.gfx.fillCircle(x, y, Math.max(2, radius * 0.08));
  }

  private drawProgressArc(x: number, y: number, radius: number, pct: number, color: number): void {
    this.gfx.lineStyle(1, 0xffffff, 0.18);
    this.gfx.strokeCircle(x, y, radius);
    this.gfx.lineStyle(3, color, 0.78);
    this.gfx.beginPath();
    this.gfx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    this.gfx.strokePath();
  }

  private drawIntegrityArc(x: number, y: number, radius: number, pct: number): void {
    this.gfx.lineStyle(2, 0xff4f79, 0.56);
    this.gfx.beginPath();
    this.gfx.arc(x, y, radius, -Math.PI / 2 + Math.PI * 2 * pct, Math.PI * 1.5);
    this.gfx.strokePath();
  }

  private trimBursts(): void {
    while (this.bursts.length > this.config.maxActiveMandalas) this.bursts.shift();
  }
}

export class UnitGlyphRenderer extends ConfigurableRenderer {
  private trailGfx: Phaser.GameObjects.Graphics;
  private unitGfx: Phaser.GameObjects.Graphics;
  private trails = new Map<string, TrailPoint[]>();
  private activeTrailKeys = new Set<string>();
  private bursts: GlyphBurst[] = [];

  constructor(scene: Phaser.Scene, config: PsychedelicVisualConfig) {
    super(config);
    this.trailGfx = scene.add.graphics().setDepth(4).setBlendMode(Phaser.BlendModes.ADD);
    this.unitGfx = scene.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
  }

  beginFrame(): void {
    this.unitGfx.clear();
    this.trailGfx.clear();
    this.activeTrailKeys.clear();
  }

  drawUnit(unit: Unit, profile: FactionVisualProfile, time: number): void {
    const def = UNIT_DEFS[unit.type];
    const x = unit.x * CELL_SIZE;
    const y = unit.y * CELL_SIZE;
    const speed = Math.hypot(unit.destX - unit.x, unit.destY - unit.y);
    const angle = speed > 0.05 ? Math.atan2(unit.destY - unit.y, unit.destX - unit.x) : time * 0.0004 + unit.id;
    const phase = time * 0.0016 * profile.pulseSpeed + unit.id * 0.73;
    const size = unit.type === UnitType.MCV ? 17 : unit.type === UnitType.Harvester ? 15 : 12 + (def.hp / 600) * 5;

    this.recordTrail(`unit-${unit.id}`, x, y, profile, size * 0.18, this.trailLength(unit.type, 'unit'));
    this.drawUnitAura(x, y, size, profile, phase);

    switch (unit.type) {
      case UnitType.MCV:
        this.drawSeedGlyph(x, y, size, profile, phase, angle);
        break;
      case UnitType.Harvester:
        this.drawHarvesterGlyph(x, y, size, profile, phase, angle, unit.cargo / HARVESTER_CAPACITY);
        break;
      case UnitType.Artillery:
        this.drawArtilleryGlyph(x, y, size, profile, phase, angle);
        break;
      case UnitType.Apc:
        this.drawApcGlyph(x, y, size, profile, phase, angle);
        break;
      default:
        this.drawTankGlyph(x, y, size, profile, phase, angle, unit.type);
        break;
    }

    if (unit.hp < unit.maxHp) this.drawHealthArc(x, y, size * 1.25, unit.hp / unit.maxHp);
  }

  updateTrail(unit: Unit, profile: FactionVisualProfile, _delta: number): void {
    this.recordTrail(`unit-${unit.id}`, unit.x * CELL_SIZE, unit.y * CELL_SIZE, profile, 2, this.trailLength(unit.type, 'unit'));
  }

  drawInfantry(infantry: Infantry, profile: FactionVisualProfile, time: number): void {
    const def = INFANTRY_DEFS[infantry.type];
    const x = infantry.x * CELL_SIZE;
    const y = infantry.y * CELL_SIZE;
    const angle = Math.atan2(infantry.destY - infantry.y, infantry.destX - infantry.x);
    const phase = time * 0.0024 * profile.pulseSpeed + infantry.id;
    const size = 5.5 + (def.hp / 80) * 2;

    this.recordTrail(`infantry-${infantry.id}`, x, y, profile, size * 0.22, this.trailLength(infantry.type, 'infantry'));
    this.drawUnitAura(x, y, size, profile, phase);

    if (infantry.type === InfantryType.Engineer) {
      drawCross(this.unitGfx, x, y, size, 0xfff1a8, 0xffffff, 0.9, angle);
      this.unitGfx.lineStyle(1, 0xffffff, 0.42);
      this.unitGfx.strokeCircle(x, y, size * 0.95);
    } else if (infantry.type === InfantryType.Rocket) {
      drawPolygon(this.unitGfx, radialPoints(x, y, size, 3, angle), mixColor(profile.primary, 0xffffff, 0.15), profile.accent, 0.92);
    } else if (infantry.type === InfantryType.Grenadier) {
      drawDiamond(this.unitGfx, x, y, size, profile.primary, profile.accent, 0.9, angle);
      this.unitGfx.fillStyle(profile.accent, 0.86);
      this.unitGfx.fillCircle(x + Math.cos(phase) * size * 1.2, y + Math.sin(phase) * size * 1.2, 1.8);
    } else if (infantry.type === InfantryType.Flamethrower) {
      this.unitGfx.lineStyle(2, 0xffad4d, 0.88);
      this.unitGfx.lineBetween(x - Math.cos(angle) * size, y - Math.sin(angle) * size, x + Math.cos(angle) * size, y + Math.sin(angle) * size);
      this.unitGfx.fillStyle(0xfff0a6, 0.85);
      this.unitGfx.fillCircle(x, y, size * 0.48);
    } else {
      this.unitGfx.fillStyle(profile.primary, 0.92);
      this.unitGfx.fillCircle(x, y, size * 0.62);
      this.unitGfx.lineStyle(1, profile.accent, 0.68);
      this.unitGfx.lineBetween(x, y, x + Math.cos(angle) * size * 1.15, y + Math.sin(angle) * size * 1.15);
    }
  }

  drawAircraft(aircraft: Aircraft, profile: FactionVisualProfile, time: number): void {
    const def = AIRCRAFT_DEFS[aircraft.type];
    const x = aircraft.x * CELL_SIZE;
    const y = aircraft.y * CELL_SIZE;
    const angle = Math.atan2(aircraft.destY - aircraft.y, aircraft.destX - aircraft.x);
    const phase = time * 0.0026 + aircraft.id;
    const size = 12 + def.speed * 1.2;

    this.recordTrail(`aircraft-${aircraft.id}`, x, y, profile, size * 0.22, this.trailLength(aircraft.type, 'aircraft'));
    this.drawUnitAura(x, y, size, profile, phase);
    const pts = [
      new Phaser.Math.Vector2(x + Math.cos(angle) * size, y + Math.sin(angle) * size),
      new Phaser.Math.Vector2(x + Math.cos(angle + 2.55) * size * 0.75, y + Math.sin(angle + 2.55) * size * 0.75),
      new Phaser.Math.Vector2(x + Math.cos(angle + Math.PI) * size * 0.28, y + Math.sin(angle + Math.PI) * size * 0.28),
      new Phaser.Math.Vector2(x + Math.cos(angle - 2.55) * size * 0.75, y + Math.sin(angle - 2.55) * size * 0.75),
    ];
    drawPolygon(this.unitGfx, pts, mixColor(profile.primary, 0xffffff, 0.12), profile.accent, 0.94);

    if (aircraft.type === AircraftType.Longbow) {
      this.unitGfx.lineStyle(1, 0xffffff, 0.64);
      this.unitGfx.lineBetween(x + Math.cos(angle + 1.4) * size * 0.5, y + Math.sin(angle + 1.4) * size * 0.5, x + Math.cos(angle - 1.4) * size * 0.5, y + Math.sin(angle - 1.4) * size * 0.5);
    } else if (aircraft.type === AircraftType.Mig || aircraft.type === AircraftType.Yak) {
      this.unitGfx.lineStyle(1, profile.secondary, 0.72);
      this.unitGfx.lineBetween(x, y, x - Math.cos(angle) * size * 1.2, y - Math.sin(angle) * size * 1.2);
    }
  }

  emitProduced(unit: Unit, _sourceBuilding: Building, profile: FactionVisualProfile): void {
    this.bursts.push({ x: unit.x * CELL_SIZE, y: unit.y * CELL_SIZE, color: profile.accent, age: 0, duration: 520, radius: CELL_SIZE * 1.8, kind: 'complete' });
    this.trimBursts();
  }

  emitUnitDamaged(unit: Unit, damageAmount: number, profile: FactionVisualProfile): void {
    this.bursts.push({ x: unit.x * CELL_SIZE, y: unit.y * CELL_SIZE, color: mixColor(profile.primary, 0xff5b70, 0.65), age: 0, duration: 240, radius: 10 + damageAmount * 0.4, kind: 'damage' });
    this.trimBursts();
  }

  emitUnitDestroyed(unit: Unit, profile: FactionVisualProfile): void {
    this.bursts.push({ x: unit.x * CELL_SIZE, y: unit.y * CELL_SIZE, color: profile.primary, age: 0, duration: 560, radius: CELL_SIZE * 2.2, kind: 'destroy' });
    this.trimBursts();
  }

  finishFrame(time: number, delta: number): void {
    this.drawTrails(delta);
    this.drawBursts(time, delta);
  }

  private drawSeedGlyph(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number, angle: number): void {
    drawPolygon(this.unitGfx, radialPoints(x, y, size, 6, angle + phase * 0.12), profile.primary, profile.accent, 0.92);
    this.unitGfx.lineStyle(1, profile.secondary, 0.58);
    this.unitGfx.strokeCircle(x, y, size * 0.68);
    drawRadialSpokes(this.unitGfx, x, y, size * 0.25, size * 0.88, 6, phase, profile.accent, 0.4);
  }

  private drawHarvesterGlyph(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number, angle: number, cargoPct: number): void {
    const cargo = Phaser.Math.Clamp(cargoPct, 0, 1);
    this.unitGfx.lineStyle(3, 0xffd86d, 0.62 + cargo * 0.24);
    this.unitGfx.beginPath();
    this.unitGfx.arc(x, y, size * 0.72, angle - Math.PI * 0.75, angle + Math.PI * 0.75);
    this.unitGfx.strokePath();
    drawDiamond(this.unitGfx, x, y, size * 0.58, mixColor(profile.primary, 0xffd86d, 0.38), profile.accent, 0.86, angle + Math.PI / 4);
    this.drawCargoArc(x, y, size * 1.05, cargo);
    this.unitGfx.fillStyle(0xfff4aa, 0.55 + cargo * 0.35);
    this.unitGfx.fillCircle(x + Math.cos(angle) * size * 0.38, y + Math.sin(angle) * size * 0.38, 2.5 + cargo * 2);
    this.unitGfx.lineStyle(1, profile.secondary, 0.42);
    this.unitGfx.strokeCircle(x, y, size * (0.42 + Math.sin(phase) * 0.04));
  }

  private drawTankGlyph(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number, angle: number, type: UnitType): void {
    const sides = type === UnitType.HeavyTank ? 8 : type === UnitType.MediumTank ? 6 : 4;
    const scale = type === UnitType.HeavyTank ? 1.1 : type === UnitType.LightTank ? 0.86 : 1;
    drawPolygon(this.unitGfx, radialPoints(x, y, size * scale, sides, angle + Math.PI / sides), profile.primary, profile.accent, 0.92);
    this.unitGfx.lineStyle(type === UnitType.HeavyTank ? 3 : 2, profile.secondary, 0.7);
    this.unitGfx.lineBetween(x, y, x + Math.cos(angle) * size * 1.12, y + Math.sin(angle) * size * 1.12);
    if (type === UnitType.HeavyTank) {
      this.unitGfx.strokeCircle(x, y, size * 0.52);
      this.unitGfx.strokeCircle(x, y, size * 0.28);
    } else {
      this.unitGfx.lineStyle(1, profile.accent, 0.38);
      this.unitGfx.strokeCircle(x, y, size * (0.42 + Math.sin(phase) * 0.04));
    }
  }

  private drawArtilleryGlyph(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number, angle: number): void {
    this.unitGfx.lineStyle(3, profile.primary, 0.9);
    this.unitGfx.lineBetween(x - Math.cos(angle) * size * 0.7, y - Math.sin(angle) * size * 0.7, x + Math.cos(angle) * size * 1.2, y + Math.sin(angle) * size * 1.2);
    this.unitGfx.lineStyle(1, profile.accent, 0.68);
    this.unitGfx.strokeCircle(x, y, size * 0.58);
    drawDiamond(this.unitGfx, x, y, size * 0.42, profile.secondary, profile.accent, 0.76, phase * 0.3);
  }

  private drawApcGlyph(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number, angle: number): void {
    drawPolygon(this.unitGfx, radialPoints(x, y, size * 0.85, 8, angle), mixColor(profile.primary, 0xffffff, 0.1), profile.accent, 0.9);
    for (let i = 0; i < 3; i++) {
      const a = phase + (Math.PI * 2 * i) / 3;
      this.unitGfx.fillStyle(profile.secondary, 0.72);
      this.unitGfx.fillCircle(x + Math.cos(a) * size * 0.35, y + Math.sin(a) * size * 0.35, 1.6);
    }
  }

  private drawUnitAura(x: number, y: number, size: number, profile: FactionVisualProfile, phase: number): void {
    this.unitGfx.fillStyle(profile.aura, 0.08 + Math.sin(phase) * 0.025);
    this.unitGfx.fillCircle(x, y, size * 1.45);
  }

  private drawCargoArc(x: number, y: number, radius: number, pct: number): void {
    this.unitGfx.lineStyle(1, 0xffffff, 0.22);
    this.unitGfx.strokeCircle(x, y, radius);
    this.unitGfx.lineStyle(2, 0xffd86d, 0.86);
    this.unitGfx.beginPath();
    this.unitGfx.arc(x, y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(pct, 0, 1));
    this.unitGfx.strokePath();
  }

  private drawHealthArc(x: number, y: number, radius: number, pct: number): void {
    this.unitGfx.lineStyle(1, 0xff4f79, 0.72);
    this.unitGfx.beginPath();
    this.unitGfx.arc(x, y, radius, -Math.PI / 2 + Math.PI * 2 * Phaser.Math.Clamp(pct, 0, 1), Math.PI * 1.5);
    this.unitGfx.strokePath();
  }

  private recordTrail(key: string, x: number, y: number, profile: FactionVisualProfile, width: number, maxPoints: number): void {
    if (!this.config.enableTrails) return;
    this.activeTrailKeys.add(key);
    const points = this.trails.get(key) ?? [];
    const last = points[points.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 0.9) {
      points.push({ x, y, color: profile.primary, age: 0, width });
      while (points.length > maxPoints) points.shift();
    } else {
      last.x = x;
      last.y = y;
      last.color = profile.primary;
      last.width = width;
    }
    this.trails.set(key, points);
  }

  private drawTrails(delta: number): void {
    for (const [key, points] of this.trails) {
      if (!this.activeTrailKeys.has(key)) {
        this.trails.delete(key);
        continue;
      }

      for (const point of points) point.age += delta;
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const point = points[i];
        const pct = i / points.length;
        const alpha = pct * this.config.trailFadeAlpha;
        this.trailGfx.lineStyle(point.width + pct * 4, point.color, alpha);
        this.trailGfx.lineBetween(prev.x, prev.y, point.x, point.y);
        this.trailGfx.fillStyle(point.color, alpha * 0.36);
        this.trailGfx.fillCircle(point.x, point.y, 1.5 + pct * 3.5);
      }
    }
  }

  private drawBursts(time: number, delta: number): void {
    this.bursts = this.bursts.filter((burst) => {
      burst.age += delta;
      const pct = Phaser.Math.Clamp(burst.age / burst.duration, 0, 1);
      const alpha = 1 - pct;
      const radius = burst.radius * (0.25 + pct);
      this.unitGfx.lineStyle(1, burst.color, alpha * 0.54);
      this.unitGfx.strokeCircle(burst.x, burst.y, radius);
      if (burst.kind === 'destroy') {
        drawRadialSpokes(this.unitGfx, burst.x, burst.y, radius * 0.2, radius, 8, time * 0.003, burst.color, alpha * 0.24);
      }
      return burst.age < burst.duration;
    });
  }

  private trailLength(type: UnitType | InfantryType | AircraftType, kind: 'unit' | 'infantry' | 'aircraft'): number {
    const qualityBonus = this.config.quality === 'high' ? 8 : this.config.quality === 'medium' ? 3 : 0;
    if (kind === 'aircraft') return 26 + qualityBonus;
    if (kind === 'infantry') return 7 + Math.floor(qualityBonus / 2);
    if (type === UnitType.Harvester || type === UnitType.MCV) return 12 + qualityBonus;
    return 14 + qualityBonus;
  }

  private trimBursts(): void {
    while (this.bursts.length > this.config.maxActiveMandalas) this.bursts.shift();
  }
}

export class CombatEffectsRenderer extends ConfigurableRenderer {
  private gfx: Phaser.GameObjects.Graphics;
  private beams: BeamEffect[] = [];
  private mandalas: ImpactMandala[] = [];
  private particles: MoteEffect[] = [];

  constructor(scene: Phaser.Scene, config: PsychedelicVisualConfig) {
    super(config);
    this.gfx = scene.add.graphics().setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
  }

  emitDamage(event: SimEvent, profile: FactionVisualProfile, weaponType: string): void {
    const toX = event.x * CELL_SIZE;
    const toY = event.y * CELL_SIZE;
    if (event.fromX !== undefined && event.fromY !== undefined) {
      this.emitBeam(event.fromX * CELL_SIZE, event.fromY * CELL_SIZE, toX, toY, profile, weaponType);
    }
    this.emitImpact(toX, toY, profile, weaponType, weaponIntensity(weaponType));
  }

  emitBeam(fromX: number, fromY: number, toX: number, toY: number, profile: FactionVisualProfile, weaponType: string): void {
    const duration = weaponType === 'artillery' ? 520 : weaponType === 'tesla' ? 260 : 190;
    this.beams.push({
      fromX,
      fromY,
      toX,
      toY,
      profile,
      weaponType,
      age: 0,
      duration,
      seed: Math.random() * Math.PI * 2,
    });
    while (this.beams.length > this.config.maxActiveBeams) this.beams.shift();
  }

  emitImpact(x: number, y: number, profile: FactionVisualProfile, weaponType: string, intensity: number): void {
    this.mandalas.push({
      x,
      y,
      profile,
      weaponType,
      intensity,
      age: 0,
      duration: 320 + intensity * 260,
      destroy: false,
    });
    while (this.mandalas.length > this.config.maxActiveMandalas) this.mandalas.shift();

    const count = this.config.quality === 'low' ? 2 : Math.floor(4 + intensity * (this.config.quality === 'high' ? 9 : 5));
    this.spawnParticles(x, y, profile, count, intensity);
  }

  emitDestroy(x: number, y: number, profile: FactionVisualProfile, entityType: string): void {
    const intensity = entityType === 'building' ? 2.2 : 1.35;
    this.mandalas.push({
      x,
      y,
      profile,
      weaponType: 'destroy',
      intensity,
      age: 0,
      duration: entityType === 'building' ? 860 : 620,
      destroy: true,
    });
    while (this.mandalas.length > this.config.maxActiveMandalas) this.mandalas.shift();
    this.spawnParticles(x, y, profile, Math.floor(8 + intensity * 8), intensity);
  }

  update(_time: number, delta: number): void {
    this.gfx.clear();
    this.updateBeams(delta);
    this.updateMandalas(delta);
    this.updateParticles(delta);
  }

  getStats(): CombatVisualStats {
    return {
      beams: this.beams.length,
      mandalas: this.mandalas.length,
      particles: this.particles.length,
      shockwaves: this.mandalas.length,
    };
  }

  private updateBeams(delta: number): void {
    this.beams = this.beams.filter((beam) => {
      beam.age += delta;
      const pct = Phaser.Math.Clamp(beam.age / beam.duration, 0, 1);
      const alpha = 1 - pct;
      const style = beam.weaponType === 'tesla' ? 'zigzag' : beam.weaponType === 'flame' ? 'wave' : beam.profile.beamStyle;
      const headPct = beam.weaponType === 'artillery' ? pct : 1;
      const headX = Phaser.Math.Linear(beam.fromX, beam.toX, headPct);
      const headY = Phaser.Math.Linear(beam.fromY, beam.toY, headPct);

      if (beam.weaponType === 'artillery') {
        this.gfx.lineStyle(2, beam.profile.secondary, alpha * 0.22);
        this.gfx.lineBetween(beam.fromX, beam.fromY, headX, headY);
        this.gfx.fillStyle(beam.profile.accent, alpha * 0.82);
        this.gfx.fillCircle(headX, headY, 5 + Math.sin(beam.age * 0.035) * 1.5);
        this.gfx.fillStyle(beam.profile.primary, alpha * 0.2);
        this.gfx.fillCircle(headX, headY, 14);
        return beam.age < beam.duration;
      }

      if (style === 'split') {
        const offsets = [-3, 0, 3];
        const normal = lineNormal(beam.fromX, beam.fromY, headX, headY);
        for (let i = 0; i < offsets.length; i++) {
          const offset = offsets[i];
          this.gfx.lineStyle(i === 1 ? 2 : 1, i === 1 ? 0xffffff : beam.profile.primary, alpha * (i === 1 ? 0.86 : 0.45));
          this.gfx.lineBetween(beam.fromX + normal.x * offset, beam.fromY + normal.y * offset, headX + normal.x * offset, headY + normal.y * offset);
        }
      } else if (style === 'zigzag') {
        this.drawJaggedBeam(beam.fromX, beam.fromY, headX, headY, beam.profile, alpha, beam.seed + beam.age * 0.06);
      } else if (style === 'wave') {
        this.drawWaveBeam(beam.fromX, beam.fromY, headX, headY, beam.profile, alpha, beam.seed + beam.age * 0.025, beam.weaponType === 'flame');
      } else {
        this.gfx.lineStyle(5, beam.profile.primary, alpha * 0.16);
        this.gfx.lineBetween(beam.fromX, beam.fromY, headX, headY);
        this.gfx.lineStyle(2, 0xffffff, alpha * 0.88);
        this.gfx.lineBetween(beam.fromX, beam.fromY, headX, headY);
      }

      this.gfx.fillStyle(0xffffff, alpha * 0.8);
      this.gfx.fillCircle(headX, headY, 2.6);
      return beam.age < beam.duration;
    });
  }

  private updateMandalas(delta: number): void {
    this.mandalas = this.mandalas.filter((mandala) => {
      mandala.age += delta;
      const pct = Phaser.Math.Clamp(mandala.age / mandala.duration, 0, 1);
      const alpha = 1 - pct;
      const radius = (mandala.destroy ? 18 : 6) + pct * CELL_SIZE * (1.8 + mandala.intensity * 1.2);
      const rings = this.config.enableCombatMandalas ? (mandala.destroy ? 3 : 2) : 1;

      this.gfx.fillStyle(0xffffff, alpha * (mandala.destroy ? 0.18 : 0.1));
      this.gfx.fillCircle(mandala.x, mandala.y, Math.max(2, 8 * alpha));
      for (let i = 0; i < rings; i++) {
        const r = radius * (1 - i * 0.22);
        this.gfx.lineStyle(i === 0 ? 2 : 1, i % 2 === 0 ? mandala.profile.primary : mandala.profile.accent, alpha * (0.56 - i * 0.12));
        this.gfx.strokeCircle(mandala.x, mandala.y, r);
      }

      if (this.config.enableCombatMandalas) {
        const spokes = mandala.destroy ? 14 : mandala.weaponType === 'tesla' ? 12 : 8;
        drawRadialSpokes(
          this.gfx,
          mandala.x,
          mandala.y,
          radius * 0.16,
          radius * (mandala.destroy ? 0.88 : 0.62),
          spokes,
          mandala.age * 0.004 + mandala.profile.mandalaSeed,
          mandala.weaponType === 'flame' ? 0xffb34d : mandala.profile.secondary,
          alpha * 0.34,
        );
      }

      return mandala.age < mandala.duration;
    });
  }

  private updateParticles(delta: number): void {
    this.particles = this.particles.filter((particle) => {
      particle.age += delta;
      const pct = Phaser.Math.Clamp(particle.age / particle.duration, 0, 1);
      const alpha = 1 - pct;
      particle.x += particle.vx * (delta / 16.67);
      particle.y += particle.vy * (delta / 16.67);
      particle.vx *= 0.988;
      particle.vy *= 0.988;
      this.gfx.fillStyle(particle.color, alpha * 0.62);
      this.gfx.fillCircle(particle.x, particle.y, particle.size * (1 + pct));
      return particle.age < particle.duration;
    });
  }

  private spawnParticles(x: number, y: number, profile: FactionVisualProfile, count: number, intensity: number): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.config.maxParticles) break;
      const a = Math.random() * Math.PI * 2;
      const speed = (0.45 + Math.random() * 1.4) * intensity;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        color: i % 3 === 0 ? 0xffffff : i % 2 === 0 ? profile.primary : profile.secondary,
        age: 0,
        duration: 320 + Math.random() * 320,
        size: 1.8 + Math.random() * 3.2,
      });
    }
  }

  private drawJaggedBeam(fromX: number, fromY: number, toX: number, toY: number, profile: FactionVisualProfile, alpha: number, phase: number): void {
    const points = jaggedLine(fromX, fromY, toX, toY, 7, 9, phase);
    this.gfx.lineStyle(5, profile.primary, alpha * 0.16);
    strokePolyline(this.gfx, points);
    this.gfx.lineStyle(2, 0xffffff, alpha * 0.82);
    strokePolyline(this.gfx, points);
    this.gfx.lineStyle(1, profile.secondary, alpha * 0.56);
    for (let i = 1; i < points.length - 1; i += 2) {
      const p = points[i];
      const a = phase + i;
      this.gfx.lineBetween(p.x, p.y, p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12);
    }
  }

  private drawWaveBeam(fromX: number, fromY: number, toX: number, toY: number, profile: FactionVisualProfile, alpha: number, phase: number, flame: boolean): void {
    const points = waveLine(fromX, fromY, toX, toY, 9, flame ? 12 : 6, phase);
    this.gfx.lineStyle(flame ? 7 : 4, flame ? 0xff8d35 : profile.primary, alpha * (flame ? 0.22 : 0.16));
    strokePolyline(this.gfx, points);
    this.gfx.lineStyle(flame ? 2 : 1, flame ? 0xfff2a6 : 0xffffff, alpha * 0.75);
    strokePolyline(this.gfx, points);
  }
}

function createFactionVisualProfile(house: House, variant: number): FactionVisualProfile {
  const base = house.color;
  const seed = seededNumber(house.id * 97 + variant * 31 + house.faction * 151);
  const hueShift = (seed - 0.5) * 0.18 + variant * 0.035;
  const primary = shiftHue(base, hueShift);
  const secondary = shiftHue(primary, house.faction === Faction.Allies ? 0.12 : -0.08);
  const accent = mixColor(shiftHue(primary, house.faction === Faction.Allies ? -0.19 : 0.16), 0xffffff, 0.35);
  const aura = mixColor(primary, house.faction === Faction.Allies ? 0x63ffe0 : 0xff72a6, 0.3);

  const alliesGlyphs: FactionVisualProfile['glyphStyle'][] = ['radial', 'crystalline', 'radial', 'organic'];
  const sovietGlyphs: FactionVisualProfile['glyphStyle'][] = ['angular', 'crystalline', 'angular', 'organic'];
  const alliesTrails: FactionVisualProfile['trailStyle'][] = ['comet', 'ribbon', 'ribbon', 'comet'];
  const sovietTrails: FactionVisualProfile['trailStyle'][] = ['spark', 'smokeLight', 'spark', 'comet'];
  const alliesBeams: FactionVisualProfile['beamStyle'][] = ['split', 'straight', 'wave', 'split'];
  const sovietBeams: FactionVisualProfile['beamStyle'][] = ['zigzag', 'wave', 'zigzag', 'straight'];

  return {
    primary,
    secondary,
    accent,
    aura,
    pulseSpeed: house.faction === Faction.Allies ? 1.05 + seed * 0.38 : 1.35 + seed * 0.52,
    pulseOffset: seed * Math.PI * 2,
    glyphStyle: house.faction === Faction.Allies ? alliesGlyphs[variant % alliesGlyphs.length] : sovietGlyphs[variant % sovietGlyphs.length],
    trailStyle: house.faction === Faction.Allies ? alliesTrails[variant % alliesTrails.length] : sovietTrails[variant % sovietTrails.length],
    beamStyle: house.faction === Faction.Allies ? alliesBeams[variant % alliesBeams.length] : sovietBeams[variant % sovietBeams.length],
    mandalaSeed: seed * 1000 + variant * 17,
  };
}

function buildingCenter(building: Building): Phaser.Math.Vector2 {
  const def = STRUCT_DEFS[building.type];
  return new Phaser.Math.Vector2(
    building.cellX * CELL_SIZE + (def.width * CELL_SIZE) / 2,
    building.cellY * CELL_SIZE + (def.height * CELL_SIZE) / 2,
  );
}

function radialPoints(x: number, y: number, radius: number, sides: number, rotation: number): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rotation + (Math.PI * 2 * i) / sides;
    points.push(new Phaser.Math.Vector2(x + Math.cos(a) * radius, y + Math.sin(a) * radius));
  }
  return points;
}

function drawPolygon(g: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[], fill: number, stroke: number, alpha: number): void {
  g.fillStyle(fill, alpha * 0.5);
  g.fillPoints(points, true);
  g.lineStyle(2, stroke, alpha);
  g.strokePoints([...points, points[0]], false);
  g.fillStyle(0xffffff, alpha * 0.72);
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  g.fillCircle(cx, cy, 1.8);
}

function drawDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, fill: number, stroke: number, alpha: number, rotation: number): void {
  drawPolygon(g, radialPoints(x, y, size, 4, rotation), fill, stroke, alpha);
}

function drawCross(g: Phaser.GameObjects.Graphics, x: number, y: number, size: number, fill: number, stroke: number, alpha: number, rotation: number): void {
  const dx = Math.cos(rotation) * size;
  const dy = Math.sin(rotation) * size;
  const px = -dy;
  const py = dx;
  g.lineStyle(4, fill, alpha * 0.82);
  g.lineBetween(x - dx, y - dy, x + dx, y + dy);
  g.lineBetween(x - px, y - py, x + px, y + py);
  g.lineStyle(1, stroke, alpha);
  g.strokeCircle(x, y, size * 0.54);
}

function drawRadialSpokes(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  count: number,
  phase: number,
  color: number,
  alpha: number,
): void {
  g.lineStyle(1, color, alpha);
  for (let i = 0; i < count; i++) {
    const a = phase + (Math.PI * 2 * i) / count;
    g.lineBetween(x + Math.cos(a) * innerRadius, y + Math.sin(a) * innerRadius, x + Math.cos(a) * outerRadius, y + Math.sin(a) * outerRadius);
  }
}

function strokePolyline(g: Phaser.GameObjects.Graphics, points: Phaser.Math.Vector2[]): void {
  for (let i = 1; i < points.length; i++) {
    g.lineBetween(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }
}

function jaggedLine(fromX: number, fromY: number, toX: number, toY: number, segments: number, amplitude: number, phase: number): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  const normal = lineNormal(fromX, fromY, toX, toY);
  for (let i = 0; i <= segments; i++) {
    const pct = i / segments;
    const offset = i === 0 || i === segments ? 0 : (seededNumber(Math.floor(phase * 100 + i * 41)) - 0.5) * amplitude * 2;
    points.push(new Phaser.Math.Vector2(Phaser.Math.Linear(fromX, toX, pct) + normal.x * offset, Phaser.Math.Linear(fromY, toY, pct) + normal.y * offset));
  }
  return points;
}

function waveLine(fromX: number, fromY: number, toX: number, toY: number, segments: number, amplitude: number, phase: number): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  const normal = lineNormal(fromX, fromY, toX, toY);
  for (let i = 0; i <= segments; i++) {
    const pct = i / segments;
    const wave = Math.sin(phase + pct * Math.PI * 2) * amplitude * Math.sin(pct * Math.PI);
    points.push(new Phaser.Math.Vector2(Phaser.Math.Linear(fromX, toX, pct) + normal.x * wave, Phaser.Math.Linear(fromY, toY, pct) + normal.y * wave));
  }
  return points;
}

function lineNormal(fromX: number, fromY: number, toX: number, toY: number): Phaser.Math.Vector2 {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.max(1, Math.hypot(dx, dy));
  return new Phaser.Math.Vector2(-dy / len, dx / len);
}

function weaponIntensity(weaponType: string): number {
  if (weaponType === 'tesla') return 2.1;
  if (weaponType === 'artillery') return 1.9;
  if (weaponType === 'flame') return 1.55;
  if (weaponType === 'aircraft') return 1.45;
  if (weaponType === 'rocket') return 1.35;
  if (weaponType === 'infantry') return 0.72;
  return 1;
}

function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function shiftHue(color: number, shift: number): number {
  const { h, s, l } = rgbToHsl(color);
  return hslToRgb((h + shift + 1) % 1, Math.min(1, s * 1.08), Math.min(0.78, l * 1.1 + 0.04));
}

function rgbToHsl(color: number): { h: number; s: number; l: number } {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): number {
  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number): number => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  return ((Math.round(r * 255) & 0xff) << 16) | ((Math.round(g * 255) & 0xff) << 8) | (Math.round(b * 255) & 0xff);
}

function seededNumber(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
