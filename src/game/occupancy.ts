import { MAP_COLS, MAP_ROWS } from './definitions';
import { cellKey, dist, findPath, moveToward } from './pathfinding';

/** Ported concept from RULES.CPP CloseEnoughDistance (~2.5 cells in original). */
export const CLOSE_ENOUGH = 1.5;

export const INFANTRY_SPOT_COUNT = 5;

/** Sub-cell stopping positions (center + corners), from CODE/CONST.CPP StoppingCoordAbs. */
export const INFANTRY_SPOT_OFFSETS: readonly { x: number; y: number }[] = [
  { x: 0.5, y: 0.5 },
  { x: 0.25, y: 0.25 },
  { x: 0.75, y: 0.25 },
  { x: 0.25, y: 0.75 },
  { x: 0.75, y: 0.75 },
];

export interface MoveResult {
  x: number;
  y: number;
  arrived: boolean;
}

export class OccupancyTracker {
  private vehicleByCell = new Map<string, number>();
  private infantrySpotMask = new Map<string, number>();
  private infantrySpotById = new Map<number, number>();
  private infantryCellById = new Map<number, string>();

  reset(): void {
    this.vehicleByCell.clear();
    this.infantrySpotMask.clear();
    this.infantrySpotById.clear();
    this.infantryCellById.clear();
  }

  seedVehicle(id: number, x: number, y: number): void {
    this.vehicleByCell.set(cellKey(Math.floor(x), Math.floor(y)), id);
  }

  seedInfantry(id: number, x: number, y: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const key = cellKey(cx, cy);
    let spot = this.infantrySpotById.get(id);
    if (spot === undefined || ((this.infantrySpotMask.get(key) ?? 0) & (1 << spot)) !== 0) {
      spot = this.claimInfantrySpot(key);
      this.infantrySpotById.set(id, spot);
    }
    this.infantryCellById.set(id, key);
    this.infantrySpotMask.set(key, (this.infantrySpotMask.get(key) ?? 0) | (1 << spot));
  }

  canVehicleEnter(cellX: number, cellY: number, excludeId: number): boolean {
    if (cellX < 0 || cellY < 0 || cellX >= MAP_COLS || cellY >= MAP_ROWS) return false;
    const occupant = this.vehicleByCell.get(cellKey(cellX, cellY));
    return occupant === undefined || occupant === excludeId;
  }

  canInfantryEnter(cellX: number, cellY: number): boolean {
    if (cellX < 0 || cellY < 0 || cellX >= MAP_COLS || cellY >= MAP_ROWS) return false;
    if (this.vehicleByCell.has(cellKey(cellX, cellY))) return false;
    const mask = this.infantrySpotMask.get(cellKey(cellX, cellY)) ?? 0;
    return mask !== (1 << INFANTRY_SPOT_COUNT) - 1;
  }

  setVehiclePosition(id: number, x: number, y: number): void {
    for (const [key, occupant] of this.vehicleByCell) {
      if (occupant === id) {
        this.vehicleByCell.delete(key);
        break;
      }
    }
    this.vehicleByCell.set(cellKey(Math.floor(x), Math.floor(y)), id);
  }

  setInfantryPosition(id: number, x: number, y: number): void {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    const newKey = cellKey(cx, cy);
    const oldKey = this.infantryCellById.get(id);

    if (oldKey && oldKey !== newKey) {
      const oldSpot = this.infantrySpotById.get(id) ?? 0;
      const oldMask = this.infantrySpotMask.get(oldKey) ?? 0;
      const next = oldMask & ~(1 << oldSpot);
      if (next === 0) {
        this.infantrySpotMask.delete(oldKey);
      } else {
        this.infantrySpotMask.set(oldKey, next);
      }
    }

    let spot = this.infantrySpotById.get(id);
    const newMask = this.infantrySpotMask.get(newKey) ?? 0;
    if (spot === undefined || (newMask & (1 << spot)) !== 0) {
      spot = this.claimInfantrySpot(newKey);
      this.infantrySpotById.set(id, spot);
    }

    this.infantryCellById.set(id, newKey);
    this.infantrySpotMask.set(newKey, (this.infantrySpotMask.get(newKey) ?? 0) | (1 << spot));
  }

  buildPathBlocked(buildingBlocked: Set<string>, excludeVehicleId: number): Set<string> {
    const blocked = new Set(buildingBlocked);
    for (const [key, id] of this.vehicleByCell) {
      if (id !== excludeVehicleId) blocked.add(key);
    }
    for (const [key] of this.infantrySpotMask) {
      const mask = this.infantrySpotMask.get(key) ?? 0;
      if (mask === (1 << INFANTRY_SPOT_COUNT) - 1) {
        blocked.add(key);
      }
    }
    return blocked;
  }

  resolveVehicleDestination(
    goalX: number,
    goalY: number,
    excludeId: number,
    buildingBlocked: Set<string>,
  ): { x: number; y: number } {
    const gx = Math.floor(goalX);
    const gy = Math.floor(goalY);
    for (const cell of spiralCells(gx, gy, 14)) {
      const key = cellKey(cell.x, cell.y);
      if (
        this.canVehicleEnter(cell.x, cell.y, excludeId) &&
        !buildingBlocked.has(key)
      ) {
        return { x: cell.x + 0.5, y: cell.y + 0.5 };
      }
    }
    return { x: gx + 0.5, y: gy + 0.5 };
  }

  resolveInfantryDestination(
    goalX: number,
    goalY: number,
    buildingBlocked: Set<string>,
  ): { x: number; y: number } {
    const gx = Math.floor(goalX);
    const gy = Math.floor(goalY);
    for (const cell of spiralCells(gx, gy, 14)) {
      const key = cellKey(cell.x, cell.y);
      if (buildingBlocked.has(key)) continue;
      if (!this.canInfantryEnter(cell.x, cell.y)) continue;
      const mask = this.infantrySpotMask.get(key) ?? 0;
      const spot = firstFreeSpot(mask);
      if (spot === null) continue;
      const offset = INFANTRY_SPOT_OFFSETS[spot];
      return { x: cell.x + offset.x, y: cell.y + offset.y };
    }
    return { x: gx + 0.5, y: gy + 0.5 };
  }

  moveVehicle(
    id: number,
    x: number,
    y: number,
    destX: number,
    destY: number,
    speed: number,
    buildingBlocked: Set<string>,
    closeEnough = CLOSE_ENOUGH,
  ): MoveResult {
    if (dist(x, y, destX, destY) <= closeEnough) {
      const stop = this.resolveVehicleDestination(destX, destY, id, buildingBlocked);
      this.setVehiclePosition(id, stop.x, stop.y);
      return { x: stop.x, y: stop.y, arrived: true };
    }

    const goal = this.resolveVehicleDestination(destX, destY, id, buildingBlocked);
    const blocked = this.buildPathBlocked(buildingBlocked, id);
    const path = findPath(x, y, goal.x, goal.y, blocked);
    const target = path && path.length > 0 ? path[0] : goal;

    const nextCellX = Math.floor(target.x);
    const nextCellY = Math.floor(target.y);
    const currentCellX = Math.floor(x);
    const currentCellY = Math.floor(y);

    if (
      (nextCellX !== currentCellX || nextCellY !== currentCellY) &&
      !this.canVehicleEnter(nextCellX, nextCellY, id)
    ) {
      return { x, y, arrived: false };
    }

    const moved = moveToward(x, y, target.x, target.y, speed);
    this.setVehiclePosition(id, moved.x, moved.y);

    const arrived =
      moved.arrived && dist(moved.x, moved.y, destX, destY) <= closeEnough;
    if (arrived) {
      const stop = this.resolveVehicleDestination(destX, destY, id, buildingBlocked);
      this.setVehiclePosition(id, stop.x, stop.y);
      return { x: stop.x, y: stop.y, arrived: true };
    }

    return { x: moved.x, y: moved.y, arrived: false };
  }

  moveInfantry(
    id: number,
    x: number,
    y: number,
    destX: number,
    destY: number,
    speed: number,
    buildingBlocked: Set<string>,
    closeEnough = CLOSE_ENOUGH,
  ): MoveResult {
    if (dist(x, y, destX, destY) <= closeEnough) {
      const stop = this.resolveInfantryDestination(destX, destY, buildingBlocked);
      this.setInfantryPosition(id, stop.x, stop.y);
      return { x: stop.x, y: stop.y, arrived: true };
    }

    const goal = this.resolveInfantryDestination(destX, destY, buildingBlocked);
    const blocked = this.buildPathBlocked(buildingBlocked, -1);
    const path = findPath(x, y, goal.x, goal.y, blocked);
    const target = path && path.length > 0 ? path[0] : goal;

    const nextCellX = Math.floor(target.x);
    const nextCellY = Math.floor(target.y);
    if (!this.canInfantryEnter(nextCellX, nextCellY)) {
      const currentCellX = Math.floor(x);
      const currentCellY = Math.floor(y);
      if (nextCellX !== currentCellX || nextCellY !== currentCellY) {
        return { x, y, arrived: false };
      }
    }

    const moved = moveToward(x, y, target.x, target.y, speed);
    this.setInfantryPosition(id, moved.x, moved.y);

    const arrived =
      moved.arrived && dist(moved.x, moved.y, destX, destY) <= closeEnough;
    if (arrived) {
      const stop = this.resolveInfantryDestination(destX, destY, buildingBlocked);
      this.setInfantryPosition(id, stop.x, stop.y);
      return { x: stop.x, y: stop.y, arrived: true };
    }

    return { x: moved.x, y: moved.y, arrived: false };
  }

  private claimInfantrySpot(cellKeyStr: string): number {
    const mask = this.infantrySpotMask.get(cellKeyStr) ?? 0;
    const spot = firstFreeSpot(mask);
    return spot ?? 0;
  }

}

function firstFreeSpot(mask: number): number | null {
  for (let i = 0; i < INFANTRY_SPOT_COUNT; i++) {
    if ((mask & (1 << i)) === 0) return i;
  }
  return null;
}

function spiralCells(cx: number, cy: number, maxRadius: number): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (r === 0 || Math.abs(dx) === r || Math.abs(dy) === r) {
          const x = cx + dx;
          const y = cy + dy;
          if (x >= 0 && y >= 0 && x < MAP_COLS && y < MAP_ROWS) {
            cells.push({ x, y });
          }
        }
      }
    }
  }
  return cells;
}
