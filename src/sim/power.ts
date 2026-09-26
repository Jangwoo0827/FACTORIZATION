/**
 * Power grids: generators, poles and the machines that draw from them (GDD 8).
 *
 * A pole joins every pole within reach to one grid, and every consumer or generator
 * within reach of a pole to that pole's grid. A building in reach of poles from two
 * different grids belongs to the nearest one. That is the whole wiring model: there
 * are no wires to draw, and the player's only decision is where to put poles.
 *
 * Supply is what the burning generators give, demand is what the attached consumers
 * ask for, and a grid's **level** is how much of the demand is met, from 0 to
 * `POWER_FULL`. Below full, every consumer on the grid slows down by the same
 * fraction (a brownout, GDD 8) instead of stopping: the failure is gradual, which is
 * kinder than everything going dark the moment one generator runs out of coal.
 *
 * Everything is whole numbers. Levels are in thousandths so a machine can turn "60%
 * power" into "one tick of work in every 1000/600 ticks" with an integer credit
 * counter instead of a float that drifts (see `machines.ts`), and at full power that
 * counter degenerates to exactly one tick of work per tick.
 */

import { GENERATOR_FUEL_BUFFER, SIM_TPS } from '../config';
import type { ItemId } from './types';
import { rotatedSize } from './types';
import type { World } from './world';

/** A grid's level when every consumer gets everything it asks for. */
export const POWER_FULL = 1000;

/** What one consumer or generator is wired to, for the inspector and the overlay. */
export interface PowerInfo {
  /** Whether any pole reaches it. Without one it has no power at all. */
  readonly connected: boolean;
  /** Grid index, or -1. */
  readonly grid: number;
  readonly supply: number;
  readonly demand: number;
  /** Fraction of demand met, 0..POWER_FULL. */
  readonly level: number;
}

export interface GridInfo {
  readonly index: number;
  /** Building ids of the poles in it, ascending. */
  readonly poles: readonly number[];
  supply: number;
  demand: number;
  level: number;
  generators: number;
  consumers: number;
}

export interface GeneratorState {
  readonly id: number;
  readonly output: number;
  readonly fuel: ItemId;
  readonly burnTicks: number;
  /** Fuel items waiting, not counting the one being burnt. */
  stored: number;
  /** Ticks left on the item being burnt; 0 when nothing is. */
  burnLeft: number;
  /** Whether it is producing power this tick. */
  burning: boolean;
  grid: number;
}

interface Consumer {
  readonly id: number;
  readonly draw: number;
  grid: number;
}

/** A segment of the overlay: two tile-centre points, and the grid it belongs to. */
export interface Wire {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly grid: number;
}

interface Pole {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly range: number;
}

export class PowerSystem {
  private grids: GridInfo[] = [];
  private consumers = new Map<number, Consumer>();
  private generators = new Map<number, GeneratorState>();
  private wireList: Wire[] = [];

  /** Called when a burnt fuel item is used up, for statistics. */
  onFuelBurnt: (item: ItemId) => void = () => {};

  constructor(private readonly world: World) {}

  get gridList(): readonly GridInfo[] {
    return this.grids;
  }

  get wires(): readonly Wire[] {
    return this.wireList;
  }

  generator(id: number): Readonly<GeneratorState> | null {
    return this.generators.get(id) ?? null;
  }

  /**
   * How much of what a building asks for it is getting. A building that draws no
   * power always gets everything; one that draws power but is out of every pole's
   * reach gets nothing.
   */
  levelOf(id: number): number {
    const consumer = this.consumers.get(id);
    if (!consumer) return POWER_FULL;
    return consumer.grid < 0 ? 0 : this.grids[consumer.grid]!.level;
  }

  /** How a consumer or generator is wired, or null for a building with nothing to do with power. */
  infoOf(id: number): PowerInfo | null {
    const grid = this.consumers.get(id)?.grid ?? this.generators.get(id)?.grid;
    if (grid === undefined) return null;
    if (grid < 0) return { connected: false, grid: -1, supply: 0, demand: 0, level: 0 };
    const g = this.grids[grid]!;
    return { connected: true, grid, supply: g.supply, demand: g.demand, level: g.level };
  }

  /** Totals across every grid, for the HUD gauge. `level` is the worst grid's. */
  summary(): { supply: number; demand: number; level: number; grids: number } {
    let supply = 0;
    let demand = 0;
    let level = POWER_FULL;
    for (const g of this.grids) {
      supply += g.supply;
      demand += g.demand;
      if (g.demand > 0) level = Math.min(level, g.level);
    }
    return { supply, demand, level, grids: this.grids.length };
  }

  /** The grid a pole belongs to, or null if there is no such pole. */
  gridOfPole(id: number): Readonly<GridInfo> | null {
    return this.grids.find((g) => g.poles.includes(id)) ?? null;
  }

  /** Whether a fuel item is welcome at a generator right now. */
  accept(id: number, item: ItemId): boolean {
    const gen = this.generators.get(id);
    if (!gen || gen.fuel !== item) return false;
    if (gen.stored >= GENERATOR_FUEL_BUFFER) return false;
    gen.stored++;
    return true;
  }

  /**
   * Re-derives the grids from the world. Generators keep their fuel and burn state
   * across it, so editing the map next to a running generator does not put it out.
   */
  rebuild(): void {
    const { world } = this;
    const poles: Pole[] = [];
    const consumerBuildings: { id: number; x: number; y: number; w: number; h: number; draw: number }[] = [];
    const generatorBuildings: typeof consumerBuildings = [];
    const old = this.generators;
    const generators = new Map<number, GeneratorState>();

    for (const b of world.buildings()) {
      const def = world.defOf(b);
      if (!def) continue;
      if (def.pole) {
        poles.push({ id: b.id, x: b.x, y: b.y, range: def.pole.range });
        continue;
      }
      // Most buildings in a busy factory are belts, which are neither a generator nor a
      // consumer: skip the footprint math for them so a full rebuild stays cheap however
      // many belts are on the map (this loop runs on every placement and removal).
      if (!def.generator && !(def.draw && def.draw > 0)) continue;
      const { w, h } = rotatedSize(def, b.rot);
      if (def.generator) {
        generatorBuildings.push({ id: b.id, x: b.x, y: b.y, w, h, draw: 0 });
        const previous = old.get(b.id);
        generators.set(b.id, {
          id: b.id,
          output: def.generator.output,
          fuel: def.generator.fuel,
          burnTicks: Math.round(def.generator.burnSeconds * SIM_TPS),
          stored: previous?.stored ?? 0,
          burnLeft: previous?.burnLeft ?? 0,
          burning: previous?.burning ?? false,
          grid: -1,
        });
      }
      if (def.draw && def.draw > 0) {
        consumerBuildings.push({ id: b.id, x: b.x, y: b.y, w, h, draw: def.draw });
      }
    }

    // Ascending id, so which grid is "first" and who wins a tie never depends on the
    // order the world happens to list its buildings in (undo re-inserts at the end).
    poles.sort((a, b) => a.id - b.id);

    const parent = poles.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };

    // Two poles are wired when each is within the shorter reach of the two.
    for (let i = 0; i < poles.length; i++) {
      for (let j = i + 1; j < poles.length; j++) {
        const a = poles[i]!;
        const b = poles[j]!;
        if (chebyshev(a.x - b.x, a.y - b.y) <= Math.min(a.range, b.range)) {
          const ra = find(i);
          const rb = find(j);
          if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
        }
      }
    }

    // Grid numbers follow the lowest pole id in each group.
    const gridOfRoot = new Map<number, number>();
    const grids: GridInfo[] = [];
    const poleGrid: number[] = [];
    for (let i = 0; i < poles.length; i++) {
      const root = find(i);
      let index = gridOfRoot.get(root);
      if (index === undefined) {
        index = grids.length;
        gridOfRoot.set(root, index);
        grids.push({ index, poles: [], supply: 0, demand: 0, level: POWER_FULL, generators: 0, consumers: 0 });
      }
      (grids[index]!.poles as number[]).push(poles[i]!.id);
      poleGrid.push(index);
    }

    const wires: Wire[] = [];
    for (let i = 0; i < poles.length; i++) {
      for (let j = i + 1; j < poles.length; j++) {
        const a = poles[i]!;
        const b = poles[j]!;
        if (chebyshev(a.x - b.x, a.y - b.y) <= Math.min(a.range, b.range)) {
          wires.push({ ax: a.x + 0.5, ay: a.y + 0.5, bx: b.x + 0.5, by: b.y + 0.5, grid: poleGrid[i]! });
        }
      }
    }

    /** The pole nearest to a footprint that reaches it, or -1. Ties go to the lower id. */
    const attach = (t: { x: number; y: number; w: number; h: number }): number => {
      let best = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < poles.length; i++) {
        const p = poles[i]!;
        const dx = Math.max(0, t.x - p.x, p.x - (t.x + t.w - 1));
        const dy = Math.max(0, t.y - p.y, p.y - (t.y + t.h - 1));
        const d = chebyshev(dx, dy);
        if (d <= p.range && d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      return best;
    };

    const consumers = new Map<number, Consumer>();
    for (const c of consumerBuildings) {
      const pole = attach(c);
      const grid = pole < 0 ? -1 : poleGrid[pole]!;
      consumers.set(c.id, { id: c.id, draw: c.draw, grid });
      if (grid >= 0) {
        grids[grid]!.demand += c.draw;
        grids[grid]!.consumers++;
        wires.push({ ax: poles[pole]!.x + 0.5, ay: poles[pole]!.y + 0.5, bx: c.x + c.w / 2, by: c.y + c.h / 2, grid });
      }
    }
    for (const g of generatorBuildings) {
      const pole = attach(g);
      const state = generators.get(g.id)!;
      state.grid = pole < 0 ? -1 : poleGrid[pole]!;
      if (state.grid >= 0) {
        grids[state.grid]!.generators++;
        wires.push({ ax: poles[pole]!.x + 0.5, ay: poles[pole]!.y + 0.5, bx: g.x + g.w / 2, by: g.y + g.h / 2, grid: state.grid });
      }
    }

    this.grids = grids;
    this.consumers = consumers;
    this.generators = generators;
    this.wireList = wires;
    this.settle();
  }

  /** One tick: generators burn, then every grid's level is worked out for machines to read. */
  step(): void {
    for (const gen of this.generators.values()) {
      if (gen.burnLeft === 0 && gen.stored > 0) {
        gen.stored--;
        gen.burnLeft = gen.burnTicks;
        this.onFuelBurnt(gen.fuel);
      }
      gen.burning = gen.burnLeft > 0;
      if (gen.burning) gen.burnLeft--;
    }
    this.settle();
  }

  /** Works out each grid's supply and level from which generators are burning. */
  private settle(): void {
    for (const g of this.grids) g.supply = 0;
    for (const gen of this.generators.values()) {
      if (gen.burning && gen.grid >= 0) this.grids[gen.grid]!.supply += gen.output;
    }
    for (const g of this.grids) {
      g.level =
        g.demand === 0 ? POWER_FULL : Math.min(POWER_FULL, Math.floor((g.supply * POWER_FULL) / g.demand));
    }
  }
}

function chebyshev(dx: number, dy: number): number {
  return Math.max(Math.abs(dx), Math.abs(dy));
}
