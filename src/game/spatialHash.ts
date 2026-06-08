import type { Aircraft, Building, Infantry, Unit } from './entities';

export type CombatEntity = Building | Unit | Infantry | Aircraft;

/**
 * Spatial hash grid for fast proximity queries during combat targeting.
 * Rebuilt once per sim tick (GameSim.rebuildSpatialHash) before the
 * movement/combat phase. Entity positions are snapshotted at rebuild time;
 * at 60 sim-ticks/sec the one-tick positional lag is imperceptible.
 *
 * Cell size 4 game-cells means a typical weapon-range-5 query touches
 * ~9–16 grid cells (~15–30 candidate entities) instead of scanning all
 * entities — roughly 15–30× fewer iterations at 500 units on screen.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly grid = new Map<number, CombatEntity[]>();

  /**
   * All inserted entities grouped by houseId.
   * Used by findBestEnemyTarget to avoid rebuilding enemy arrays on every call.
   */
  readonly byHouse = new Map<number, CombatEntity[]>();

  constructor(cellSize = 4) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.grid.clear();
    this.byHouse.clear();
  }

  private key(cx: number, cy: number): number {
    // Map is ≤80 wide and ≤56 tall; with cellSize=4 max cx=20, cy=14.
    // cy is always < 100, so this packing is collision-free.
    return cx * 100 + cy;
  }

  insert(entity: CombatEntity): void {
    const ex = 'cellX' in entity ? entity.cellX : entity.x;
    const ey = 'cellX' in entity ? entity.cellY : entity.y;
    const cx = Math.floor(ex / this.cellSize);
    const cy = Math.floor(ey / this.cellSize);
    const k = this.key(cx, cy);

    let cell = this.grid.get(k);
    if (!cell) {
      cell = [];
      this.grid.set(k, cell);
    }
    cell.push(entity);

    let house = this.byHouse.get(entity.houseId);
    if (!house) {
      house = [];
      this.byHouse.set(entity.houseId, house);
    }
    house.push(entity);
  }

  /**
   * Returns all entities in grid cells that overlap the AABB
   * [x−radius, x+radius] × [y−radius, y+radius].
   *
   * NOTE: the result set is a superset of the true radius; callers must
   * perform an exact distance check (dist ≤ range) before using a candidate.
   */
  queryRadius(x: number, y: number, radius: number): CombatEntity[] {
    const result: CombatEntity[] = [];
    const minCx = Math.floor((x - radius) / this.cellSize);
    const maxCx = Math.floor((x + radius) / this.cellSize);
    const minCy = Math.floor((y - radius) / this.cellSize);
    const maxCy = Math.floor((y + radius) / this.cellSize);
    for (let gx = minCx; gx <= maxCx; gx++) {
      for (let gy = minCy; gy <= maxCy; gy++) {
        const cell = this.grid.get(this.key(gx, gy));
        if (cell) {
          for (const e of cell) result.push(e);
        }
      }
    }
    return result;
  }
}
