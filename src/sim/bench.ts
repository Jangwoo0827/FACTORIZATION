/**
 * A crowded scene for measuring the simulation and renderer (GDD M1 benchmark).
 *
 * Nested square belt loops, each carrying a steady stream of ore around itself.
 * Loops make a fair benchmark because nothing drains: items keep moving and stay
 * conserved for as long as the scene runs, so timing does not degrade as a supply
 * runs out. They also exercise the cycle path in the update order, which a scene
 * of straight lines would never touch.
 */

import { DEF_MAP } from '../data/buildings';
import { Ore } from './types';
import type { Simulation } from './simulation';
import { World } from './world';

export interface BenchOptions {
  /** Stop adding loops once at least this many belts exist. */
  belts: number;
  /** Items to place on each belt tile, at even spacing. */
  itemsPerBelt: 1 | 2;
}

/** Item positions along a tile for each density, front to back. */
const FILL: Record<1 | 2, readonly number[]> = {
  1: [0.5],
  2: [0.75, 0.25],
};

/** An empty, obstacle-free world, so the only cost measured is the belts themselves. */
export function createBenchWorld(size = 128): World {
  return new World(size, DEF_MAP);
}

/**
 * Lays out the loops in `world`. Returns how many belts were placed.
 *
 * Each loop is a clockwise square ring. Successive rings sit two tiles apart so a
 * one-tile gap always separates them and no belt ever feeds a neighbouring ring.
 * They stop shrinking before they reach the middle, where the hub goes.
 */
export function buildRings(world: World, target: number): number {
  const size = world.size;
  const keepClear = 10;
  let placed = 0;

  for (let k = 1; placed < target; k += 2) {
    const max = size - 1 - k;
    if (max - k < keepClear) break;

    for (let x = k; x < max; x++) if (world.place('conveyor', x, k, 0)) placed++;
    for (let y = k; y < max; y++) if (world.place('conveyor', max, y, 1)) placed++;
    for (let x = max; x > k; x--) if (world.place('conveyor', x, max, 2)) placed++;
    for (let y = max; y > k; y--) if (world.place('conveyor', k, y, 3)) placed++;
  }
  return placed;
}

/** Fills every belt in the simulation with ore at the requested density. */
export function fillBelts(sim: Simulation, itemsPerBelt: 1 | 2): number {
  sim.sync();
  let pushed = 0;
  for (const tile of sim.belts.orderedTiles()) {
    for (const p of FILL[itemsPerBelt]) {
      if (sim.belts.debugPush(tile, Ore.Iron, p)) pushed++;
    }
  }
  return pushed;
}
