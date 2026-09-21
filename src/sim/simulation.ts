/**
 * Ties the world, belts, miners and hub together and advances them one fixed tick
 * at a time (GDD 14.3).
 *
 * The simulation never asks to be told about edits. It compares the world's
 * revision counter against the one it last saw and rebuilds its derived structures
 * when they differ, so any code path that changes the world — a click, an undo, a
 * test — is picked up without having to remember to notify anyone.
 */

import { BELT_SPEED_MK1, SIM_TPS, TUNNEL_RANGE } from '../config';
import { DX, DY } from '../core/dir';
import { RECIPE_BOOK } from '../data/recipes';
import type { RecipeBook } from '../factor/recipeBook';
import { BeltGrid } from './belts';
import { MachineSystem } from './machines';
import { MinerSystem } from './miners';
import { PowerSystem } from './power';
import { Sieve } from './sieve';
import { isBeltKind, rotatedSize, type ItemId, type PlacedBuilding } from './types';
import type { World } from './world';

const DT = 1 / SIM_TPS;

export class Simulation {
  readonly belts: BeltGrid;
  readonly sieve = new Sieve();
  readonly power: PowerSystem;
  readonly miners: MinerSystem;
  readonly machines: MachineSystem;

  /** Ticks simulated so far. */
  tick = 0;

  private seenRevision = -1;
  /** Ids of hub buildings, which take every item they are handed. */
  private readonly hubs = new Set<number>();

  constructor(
    readonly world: World,
    recipes: RecipeBook = RECIPE_BOOK,
  ) {
    this.belts = new BeltGrid(world.size, BELT_SPEED_MK1, SIM_TPS, (id, item) =>
      this.offer(id, item),
    );
    this.power = new PowerSystem(world);
    this.miners = new MinerSystem(world, this.belts, this.power);
    this.machines = new MachineSystem(world, this.belts, recipes, this.power);
  }

  /**
   * What a belt's front item is handed to when it reaches a building. The hub takes
   * everything; a machine takes only what its recipe wants; a generator takes only its
   * fuel; anything else refuses.
   */
  private offer(receiverId: number, item: ItemId): boolean {
    if (this.hubs.has(receiverId)) {
      this.sieve.receive(item);
      return true;
    }
    return this.machines.accept(receiverId, item) || this.power.accept(receiverId, item);
  }

  step(): void {
    if (this.world.revision !== this.seenRevision) this.sync();

    // Power first: machines read this tick's level, so a generator that just lit
    // powers them in the same tick rather than one tick late.
    this.power.step();
    this.belts.step();
    this.miners.step(DT);
    this.machines.step();

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

    belts.clearReceivers();
    belts.clearLinks();
    this.hubs.clear();
    const entrances: PlacedBuilding[] = [];
    for (const building of world.buildings()) {
      const def = world.defOf(building);
      if (!def) continue;

      if (isBeltKind(def.kind)) {
        const tile = building.y * size + building.x;
        if (belts.beltId[tile] !== building.id) belts.setBelt(tile, building.rot, building.id);
        if (def.kind === 'tunnel-in') entrances.push(building);
      } else if (def.kind === 'splitter') {
        const tile = building.y * size + building.x;
        if (belts.beltId[tile] !== building.id) belts.setSplitter(tile, building.id);
      } else if (def.kind === 'hub' || def.kind === 'machine' || def.kind === 'generator') {
        if (def.kind === 'hub') this.hubs.add(building.id);
        const { w, h } = rotatedSize(def, building.rot);
        for (let y = building.y; y < building.y + h; y++) {
          for (let x = building.x; x < building.x + w; x++) belts.setReceiver(y * size + x, building.id);
        }
      }
    }

    this.linkUnderpasses(entrances);

    belts.rebuildOrder();
    this.power.rebuild();
    this.miners.rebuild();
    this.machines.rebuild();
    this.seenRevision = world.revision;
  }

  /**
   * Joins each underpass entrance to the first exit facing the same way within range.
   *
   * An exit can serve only one entrance. Entrances are taken in the order they were
   * built, so the pairing is deterministic; a later entrance that finds its exit
   * already taken is left unlinked and behaves as an ordinary belt.
   */
  private linkUnderpasses(entrances: readonly PlacedBuilding[]): void {
    const { world, belts } = this;
    const size = world.size;

    for (const entrance of entrances) {
      for (let k = 1; k <= TUNNEL_RANGE; k++) {
        const x = entrance.x + DX[entrance.rot]! * k;
        const y = entrance.y + DY[entrance.rot]! * k;
        if (!world.inBounds(x, y)) break;

        const other = world.buildingAt(x, y);
        if (!other || other.rot !== entrance.rot) continue;
        if (world.defOf(other)?.kind !== 'tunnel-out') continue;

        const exit = y * size + x;
        if (!belts.isLinkedExit(exit)) belts.setLink(entrance.y * size + entrance.x, exit);
        break;
      }
    }
  }
}

/** Puts the hub on the map centre, which world generation keeps clear (GDD 4.2). */
export function placeHub(world: World): PlacedBuilding {
  const centre = Math.floor(world.size / 2);
  const hub = world.place('hub', centre - 1, centre - 1, 0);
  if (!hub) throw new Error('Could not place the hub: the centre of the map is not buildable.');
  return hub;
}
