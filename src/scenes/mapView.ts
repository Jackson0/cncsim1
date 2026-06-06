import Phaser from 'phaser';
import { CELL_SIZE, MAP_COLS, MAP_ROWS } from '../game/definitions';
import { ORE_FIELD_RADIUS } from '../game/mapSetup';

export const WORLD_W = MAP_COLS * CELL_SIZE;
export const WORLD_H = MAP_ROWS * CELL_SIZE;

export interface PreviewOreField {
  cellX: number;
  cellY: number;
  amount: number;
  radius?: number;
  selected?: boolean;
}

export interface PreviewBaseMarker {
  cellX: number;
  cellY: number;
  color: number;
  selected?: boolean;
}

export function drawGrid(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(0);
  g.fillStyle(0x05060c, 1);
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  g.fillStyle(0x091d24, 0.55);
  g.fillRect(0, 0, WORLD_W, WORLD_H);

  g.lineStyle(1, 0x203a4f, 0.26);
  for (let x = 0; x <= MAP_COLS; x++) {
    g.lineBetween(x * CELL_SIZE, 0, x * CELL_SIZE, WORLD_H);
  }
  for (let y = 0; y <= MAP_ROWS; y++) {
    g.lineBetween(0, y * CELL_SIZE, WORLD_W, y * CELL_SIZE);
  }

  g.lineStyle(1, 0x6fffe0, 0.08);
  for (let x = -WORLD_H; x < WORLD_W; x += CELL_SIZE * 4) {
    g.lineBetween(x, WORLD_H, x + WORLD_H, 0);
  }

  g.lineStyle(1, 0xffd166, 0.06);
  for (let x = 0; x < WORLD_W + WORLD_H; x += CELL_SIZE * 5) {
    g.lineBetween(x, 0, x - WORLD_H, WORLD_H);
  }

  for (let y = 0; y < MAP_ROWS; y += 2) {
    for (let x = 0; x < MAP_COLS; x += 2) {
      const cx = x * CELL_SIZE + CELL_SIZE / 2;
      const cy = y * CELL_SIZE + CELL_SIZE / 2;
      const wave = Math.sin(x * 0.7 + y * 0.43);
      const color = wave > 0.3 ? 0x58f0ff : wave < -0.45 ? 0xff5ea8 : 0x96ffd8;
      g.fillStyle(color, 0.08);
      g.fillCircle(cx, cy, 1.2);
    }
  }

  g.lineStyle(2, 0xffffff, 0.12);
  g.strokeRect(1, 1, WORLD_W - 2, WORLD_H - 2);

  return g;
}

export function setupCameraControls(scene: Phaser.Scene): void {
  scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (p.isDown && p.rightButtonDown()) {
      scene.cameras.main.scrollX -= (p.x - p.prevPosition.x) / scene.cameras.main.zoom;
      scene.cameras.main.scrollY -= (p.y - p.prevPosition.y) / scene.cameras.main.zoom;
    }
  });

  scene.input.on(
    'wheel',
    (_p: Phaser.Input.Pointer, _gos: unknown, _dx: number, dy: number) => {
      const cam = scene.cameras.main;
      const z = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -0.1 : 0.1), 0.5, 2);
      cam.setZoom(z);
    },
  );
}

export function pointerToCell(
  pointer: Phaser.Input.Pointer,
  camera: Phaser.Cameras.Scene2D.Camera,
): { x: number; y: number } | null {
  const worldX = camera.scrollX + pointer.x / camera.zoom;
  const worldY = camera.scrollY + pointer.y / camera.zoom;
  const x = Math.floor(worldX / CELL_SIZE);
  const y = Math.floor(worldY / CELL_SIZE);
  if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return null;
  return { x, y };
}

export function renderOrePreview(
  gfx: Phaser.GameObjects.Graphics,
  oreFields: PreviewOreField[],
  phase = 0,
): void {
  for (const ore of oreFields) {
    const cx = ore.cellX * CELL_SIZE + CELL_SIZE / 2;
    const cy = ore.cellY * CELL_SIZE + CELL_SIZE / 2;
    const radius = (ore.radius ?? ORE_FIELD_RADIUS) * CELL_SIZE;
    const richness =
      ore.amount === Number.POSITIVE_INFINITY ? 1 : Phaser.Math.Clamp(ore.amount / 8000, 0.1, 1);
    const bloom = 0.86 + Math.sin(phase * 0.8 + ore.cellX * 0.31 + ore.cellY * 0.17) * 0.14;
    const green = Math.floor(0x70 + richness * 0x8f);
    const color = (0x18 << 16) | (green << 8) | Math.floor(0x80 + richness * 0x7f);
    const gold = (Math.floor(0xbb + richness * 0x44) << 16) | 0x9a30;

    gfx.fillStyle(color, (0.08 + richness * 0.16) * bloom);
    gfx.fillCircle(cx, cy, radius * 1.18);
    gfx.fillStyle(gold, (0.05 + richness * 0.12) * bloom);
    gfx.fillCircle(cx, cy, radius * 0.72);

    gfx.lineStyle(ore.selected ? 3 : 1, ore.selected ? 0xffffff : 0x83ffd7, ore.selected ? 0.95 : 0.35);
    gfx.strokeCircle(cx, cy, radius * bloom);
    gfx.lineStyle(1, 0xffd166, ore.selected ? 0.65 : 0.22);
    gfx.strokeCircle(cx, cy, radius * 0.54);

    const petals = 13;
    for (let i = 0; i < petals; i++) {
      const a = phase * 0.16 + (Math.PI * 2 * i) / petals;
      const wobble = 0.42 + Math.sin(phase * 1.7 + i * 2.1) * 0.12;
      const ox = cx + Math.cos(a) * radius * wobble;
      const oy = cy + Math.sin(a) * radius * wobble;
      gfx.lineStyle(1, i % 2 === 0 ? 0x7cffd4 : 0xffd166, 0.3 + richness * 0.3);
      gfx.lineBetween(cx, cy, ox, oy);
      gfx.fillStyle(i % 2 === 0 ? 0x7cffd4 : 0xffd166, 0.36 + richness * 0.34);
      gfx.fillCircle(ox, oy, 2.5 + richness * 2.5);
    }
  }
}

export function renderBaseMarkers(
  gfx: Phaser.GameObjects.Graphics,
  bases: PreviewBaseMarker[],
  phase = 0,
): void {
  for (const base of bases) {
    const cx = base.cellX * CELL_SIZE + CELL_SIZE / 2;
    const cy = base.cellY * CELL_SIZE + CELL_SIZE / 2;
    const markerSize = CELL_SIZE * 0.38;
    const outline = base.selected ? 0xffffff : 0x59f1ff;
    const pulse = 0.88 + Math.sin(phase * 2 + base.cellX) * 0.12;

    gfx.fillStyle(base.color, 0.12);
    gfx.fillCircle(cx, cy, CELL_SIZE * 1.1 * pulse);
    gfx.lineStyle(1, base.color, 0.42);
    gfx.strokeCircle(cx, cy, CELL_SIZE * 0.82 * pulse);
    gfx.lineStyle(1, 0xffffff, base.selected ? 0.62 : 0.22);
    gfx.strokeCircle(cx, cy, CELL_SIZE * 0.55);

    gfx.fillStyle(base.color, 0.82);
    gfx.beginPath();
    gfx.moveTo(cx, cy - markerSize);
    gfx.lineTo(cx + markerSize, cy);
    gfx.lineTo(cx, cy + markerSize);
    gfx.lineTo(cx - markerSize, cy);
    gfx.closePath();
    gfx.fillPath();

    gfx.lineStyle(base.selected ? 3 : 2, outline, base.selected ? 0.95 : 0.55);
    gfx.strokePath();

    gfx.lineStyle(1, 0xffffff, 0.75);
    gfx.lineBetween(cx - markerSize * 0.45, cy, cx + markerSize * 0.45, cy);
    gfx.lineBetween(cx, cy - markerSize * 0.45, cx, cy + markerSize * 0.45);
  }
}
