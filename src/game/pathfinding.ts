import { MAP_COLS, MAP_ROWS } from './definitions';

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function manhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

export function findPath(
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  blocked: Set<string>,
  maxSteps = 200,
): Vec2[] | null {
  const startKey = cellKey(Math.floor(startX), Math.floor(startY));
  const goalKey = cellKey(Math.floor(goalX), Math.floor(goalY));

  if (startKey === goalKey) return [];

  const open: { x: number; y: number; g: number; f: number; parent?: string }[] = [];
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>();

  const sx = Math.floor(startX);
  const sy = Math.floor(startY);
  const gx = Math.floor(goalX);
  const gy = Math.floor(goalY);

  const h0 = manhattan(sx, sy, gx, gy);
  open.push({ x: sx, y: sy, g: 0, f: h0 });
  gScore.set(startKey, 0);

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  let steps = 0;
  while (open.length > 0 && steps++ < maxSteps) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const ck = cellKey(current.x, current.y);

    if (ck === goalKey) {
      const path: Vec2[] = [];
      let k: string | undefined = ck;
      while (k && k !== startKey) {
        const [px, py] = k.split(',').map(Number);
        path.unshift({ x: px + 0.5, y: py + 0.5 });
        k = cameFrom.get(k);
      }
      return path;
    }

    for (const [dx, dy] of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_COLS || ny >= MAP_ROWS) continue;

      const nk = cellKey(nx, ny);
      if (blocked.has(nk) && nk !== goalKey) continue;

      const tentative = current.g + (dx !== 0 && dy !== 0 ? 1.414 : 1);
      if (tentative >= (gScore.get(nk) ?? Infinity)) continue;

      cameFrom.set(nk, ck);
      gScore.set(nk, tentative);
      const f = tentative + manhattan(nx, ny, gx, gy);
      if (!open.some((n) => n.x === nx && n.y === ny)) {
        open.push({ x: nx, y: ny, g: tentative, f });
      }
    }
  }

  return null;
}

interface Vec2 {
  x: number;
  y: number;
}

export function moveToward(
  x: number,
  y: number,
  destX: number,
  destY: number,
  speed: number,
): { x: number; y: number; arrived: boolean } {
  const d = dist(x, y, destX, destY);
  if (d <= speed) {
    return { x: destX, y: destY, arrived: true };
  }
  const ratio = speed / d;
  return {
    x: x + (destX - x) * ratio,
    y: y + (destY - y) * ratio,
    arrived: false,
  };
}
