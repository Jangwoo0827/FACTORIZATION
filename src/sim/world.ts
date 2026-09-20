/**
 * Tile grid and building occupancy (GDD 14.2, `sim/world.ts`).
 *
 * Deliberately free of Phaser and DOM references so it stays testable and can
 * later move to a Web Worker.
 */

import {
  Ore,
  Terrain,
  rotatedSize,
  type BuildingDef,
  type PlacedBuilding,
  type PlacementResult,
  type Rotation,
} from './types';

const EMPTY = -1;

export class World {
  readonly size: number;
  readonly terrain: Uint8Array;
  readonly ore: Uint8Array;

  private readonly defs: ReadonlyMap<string, BuildingDef>;
  private readonly occupancy: Int32Array;
  private readonly placed = new Map<number, PlacedBuilding>();
  private nextId = 1;
  private revisionCounter = 0;
  /**
   * What each machine is set to make, by building id. Lives here rather than in the
   * simulation because it is the player's configuration, not simulated state: it
   * must survive a rebuild, and later a save.
   *
   * An entry outlives the building's removal, so undoing the removal restores the
   * machine already set up the way it was.
   */
  private readonly machineRecipes = new Map<number, number>();

  constructor(size: number, defs: ReadonlyMap<string, BuildingDef>) {
    this.size = size;
    this.defs = defs;
    this.terrain = new Uint8Array(size * size);
    this.ore = new Uint8Array(size * size);
    this.occupancy = new Int32Array(size * size).fill(EMPTY);
  }

  get buildingCount(): number {
    return this.placed.size;
  }

  /** The item a machine is set to make, or 0 if it has no recipe yet. */
  recipeOf(buildingId: number): number {
    return this.machineRecipes.get(buildingId) ?? 0;
  }

  /** Sets what a machine makes; 0 clears it. A change is a world change, so it bumps `revision`. */
  setRecipe(buildingId: number, item: number): void {
    if (this.recipeOf(buildingId) === item) return;
    if (item === 0) this.machineRecipes.delete(buildingId);
    else this.machineRecipes.set(buildingId, item);
    this.revisionCounter++;
  }

  /**
   * Increments on every placement, removal or re-insertion. The simulation compares
   * it against the value it last saw to know when its derived structures (belt
   * topology, miner outputs) are stale, so nothing has to notify it explicitly.
   */
  get revision(): number {
    return this.revisionCounter;
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.size && y < this.size;
  }

  terrainAt(x: number, y: number): Terrain {
    return this.terrain[this.index(x, y)] as Terrain;
  }

  setTerrain(x: number, y: number, t: Terrain): void {
    this.terrain[this.index(x, y)] = t;
  }

  oreAt(x: number, y: number): Ore {
    return this.ore[this.index(x, y)] as Ore;
  }

  setOre(x: number, y: number, o: Ore): void {
    this.ore[this.index(x, y)] = o;
  }

  buildingIdAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return EMPTY;
    return this.occupancy[this.index(x, y)]!;
  }

  buildingAt(x: number, y: number): PlacedBuilding | null {
    const id = this.buildingIdAt(x, y);
    return id === EMPTY ? null : this.placed.get(id) ?? null;
  }

  buildings(): IterableIterator<PlacedBuilding> {
    return this.placed.values();
  }

  defOf(building: PlacedBuilding): BuildingDef | undefined {
    return this.defs.get(building.defId);
  }

  checkPlacement(defId: string, x: number, y: number, rot: Rotation): PlacementResult {
    const def = this.defs.get(defId);
    if (!def) return { ok: false, reason: 'unknown-def' };

    const { w, h } = rotatedSize(def, rot);
    let oreTiles = 0;

    for (let ty = y; ty < y + h; ty++) {
      for (let tx = x; tx < x + w; tx++) {
        if (!this.inBounds(tx, ty)) return { ok: false, reason: 'out-of-bounds' };
        const i = this.index(tx, ty);
        if (this.terrain[i] !== Terrain.Plain) return { ok: false, reason: 'terrain' };
        if (this.occupancy[i] !== EMPTY) return { ok: false, reason: 'occupied' };
        if (this.ore[i] !== Ore.None) oreTiles++;
      }
    }

    if (def.needsOre && oreTiles === 0) return { ok: false, reason: 'needs-ore' };
    return { ok: true };
  }

  /** Places a new building, assigning a fresh id. Returns null if the spot is invalid. */
  place(defId: string, x: number, y: number, rot: Rotation): PlacedBuilding | null {
    if (!this.checkPlacement(defId, x, y, rot).ok) return null;
    const building: PlacedBuilding = { id: this.nextId++, defId, x, y, rot };
    this.stamp(building, building.id);
    this.placed.set(building.id, building);
    this.revisionCounter++;
    return building;
  }

  /**
   * Re-inserts a previously removed building, keeping its id. Used by undo so that
   * commands holding a reference stay valid across an undo/redo round trip.
   */
  insert(building: PlacedBuilding): boolean {
    if (!this.checkPlacement(building.defId, building.x, building.y, building.rot).ok) return false;
    this.stamp(building, building.id);
    this.placed.set(building.id, building);
    if (building.id >= this.nextId) this.nextId = building.id + 1;
    this.revisionCounter++;
    return true;
  }

  removeById(id: number): PlacedBuilding | null {
    const building = this.placed.get(id);
    if (!building) return null;
    this.stamp(building, EMPTY);
    this.placed.delete(id);
    this.revisionCounter++;
    return building;
  }

  removeAt(x: number, y: number): PlacedBuilding | null {
    const id = this.buildingIdAt(x, y);
    return id === EMPTY ? null : this.removeById(id);
  }

  private stamp(building: PlacedBuilding, value: number): void {
    const def = this.defs.get(building.defId);
    if (!def) return;
    const { w, h } = rotatedSize(def, building.rot);
    for (let ty = building.y; ty < building.y + h; ty++) {
      for (let tx = building.x; tx < building.x + w; tx++) {
        this.occupancy[this.index(tx, ty)] = value;
      }
    }
  }
}
