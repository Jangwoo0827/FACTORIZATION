/**
 * Ties the world, belts, miners and hub together and advances them one fixed tick
 * at a time (GDD 14.3).
 *
 * The simulation never asks to be told about edits. It compares the world's
 * revision counter against the one it last saw and rebuilds its derived structures
 * when they differ, so any code path that changes the world — a click, an undo, a
 * test — is picked up without having to remember to notify anyone.
 */

import { BELT_SPEED_MK1, SIM_TPS } from '../config';
import { BeltGrid } from './belts';
import { MinerSystem } from './miners';
import { Sieve } from './sieve';
import { rotatedSize, type PlacedBuilding } from './types';
import type { World } from './world';

const DT = 1 / SIM_TPS;

export class Simulation {
  readonly belts: BeltGrid;
  readonly sieve = new Sieve();
  readonly miners: MinerSystem;

  /** Ticks simulated so far. */
  tick = 0;

  private seenRevision = -1;

  constructor(readonly world: World) {
    this.belts = new BeltGrid(world.size, BELT_SPEED_MK1, SIM_TPS, (item) =>
      this.sieve.receive(item),
    );
    this.miners = new MinerSystem(world, this.belts);
  }

  step(): void {
    if (this.world.revision !== this.seenRevision) this.sync();

    this.belts.step();
    this.miners.step(DT);

    this.tick++;
    if (this.tick % SIM_TPS === 0) this.sieve.recordSecond();
  }

  /** Re-reads the world into the belt grid and miner list. Idempotent. */
  sync(): void {
    const { world, belts } = this;
    const size = world.size;

    // Drop belts whose building is gone or was replaced, taking their items with
    // them. A building brought back by undo keeps its id, so its belt is kept.
    for (let tile = 0; tile < belts.tileCount; tile++) {
      const id = belts.beltId[tile]!;
      if (id === -1) continue;
      const x = tile % size;
      const y = (tile - x) / size;
      if (world.buildingIdAt(x, y) !== id) belts.clearBelt(tile);
    }

    belts.clearSinks();
    for (const building of world.buildings()) {
      const def = world.defOf(building);
      if (!def) continue;

      if (def.kind === 'belt') {
        const tile = building.y * size + building.x;
        if (belts.beltId[tile] !== building.id) belts.setBelt(tile, building.rot, building.id);
      } else if (def.kind === 'hub') {
        const { w, h } = rotatedSize(def, building.rot);
        for (let y = building.y; y < building.y + h; y++) {
          for (let x = building.x; x < building.x + w; x++) belts.setSink(y * size + x);
        }
      }
    }

    belts.rebuildOrder();
    this.miners.rebuild();
    this.seenRevision = world.revision;
  }
}

/** Puts the hub on the map centre, which world generation keeps clear (GDD 4.2). */
export function placeHub(world: World): PlacedBuilding {
  const centre = Math.floor(world.size / 2);
  const hub = world.place('hub', centre - 1, centre - 1, 0);
  if (!hub) throw new Error('Could not place the hub: the centre of the map is not buildable.');
  return hub;
}
