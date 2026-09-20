import { DEF_MAP } from '../src/data/buildings';
import { DX, DY } from '../src/core/dir';
import { SLOTS, SPACING, type BeltGrid } from '../src/sim/belts';
import { Simulation } from '../src/sim/simulation';
import { World } from '../src/sim/world';
import type { Rotation } from '../src/sim/types';

export function makeWorld(size = 32): World {
  return new World(size, DEF_MAP);
}

export function tileOf(world: World, x: number, y: number): number {
  return y * world.size + x;
}

/** Places a conveyor, failing loudly so a typo in a test cannot silently do nothing. */
export function belt(world: World, x: number, y: number, dir: Rotation): void {
  if (!world.place('conveyor', x, y, dir)) throw new Error(`could not place belt at ${x},${y}`);
}

/** A straight run of belts starting at (x, y) and heading in `dir`. */
export function run(world: World, x: number, y: number, length: number, dir: Rotation): void {
  for (let i = 0; i < length; i++) belt(world, x + DX[dir]! * i, y + DY[dir]! * i, dir);
}

export function place(
  world: World,
  defId: string,
  x: number,
  y: number,
  rot: Rotation = 0,
): number {
  const placed = world.place(defId, x, y, rot);
  if (!placed) throw new Error(`could not place ${defId} at ${x},${y}`);
  return placed.id;
}

export function stepN(sim: Simulation, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.step();
}

export interface Located {
  tile: number;
  slot: number;
  item: number;
  p: number;
  lat: number;
}

/** Every item on the belts, with where it is. */
export function allItems(belts: BeltGrid): Located[] {
  const out: Located[] = [];
  for (let tile = 0; tile < belts.tileCount; tile++) {
    for (let i = 0; i < belts.count[tile]!; i++) {
      const slot = tile * SLOTS + i;
      out.push({
        tile,
        slot: i,
        item: belts.item[slot]!,
        p: belts.pos[slot]!,
        lat: belts.lat[slot]!,
      });
    }
  }
  return out;
}

/**
 * Checks the rules every belt must obey at every instant. Returns a list of
 * violations rather than asserting, so a failing test can print all of them.
 *
 * `crossBoundary` also checks spacing between the last item on one tile and the
 * first on the next along a straight run. It holds everywhere except closed loops,
 * where stepping order is arbitrary and an item can legitimately move twice in one
 * tick.
 */
export function violations(belts: BeltGrid, crossBoundary = true): string[] {
  const problems: string[] = [];
  const size = belts.size;

  for (let tile = 0; tile < belts.tileCount; tile++) {
    const c = belts.count[tile]!;
    if (c > SLOTS) problems.push(`tile ${tile}: ${c} items exceeds capacity`);

    for (let i = 0; i < c; i++) {
      const p = belts.pos[tile * SLOTS + i]!;
      if (p > 1 + 1e-4) problems.push(`tile ${tile} slot ${i}: p=${p} past the exit edge`);
      if (p < -1e-4) problems.push(`tile ${tile} slot ${i}: p=${p} before the entry edge`);
      if (i > 0) {
        const ahead = belts.pos[tile * SLOTS + i - 1]!;
        if (ahead - p < SPACING - 2e-3) {
          problems.push(`tile ${tile}: slots ${i - 1},${i} only ${(ahead - p).toFixed(4)} apart`);
        }
      }
    }

    if (crossBoundary && c > 0) {
      const d = belts.dir[tile]!;
      const x = tile % size;
      const y = (tile - x) / size;
      const nx = x + DX[d]!;
      const ny = y + DY[d]!;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      // Only straight-through connections share a path. An item waiting at the end
      // of a side feeder sits at the edge of the next tile, on a different path from
      // the straight items near its back edge, so their positions do not conflict.
      if (belts.dir[next] !== d) continue;
      const cn = belts.count[next]!;
      if (cn === 0) continue;

      const front = belts.pos[tile * SLOTS]!;
      const rear = belts.pos[next * SLOTS + cn - 1]!;
      const gap = 1 - front + rear;
      if (gap < SPACING - 2e-3) {
        problems.push(`across ${tile}->${next}: only ${gap.toFixed(4)} apart`);
      }
    }
  }
  return problems;
}
