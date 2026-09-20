/**
 * Miners (GDD 6.1, 6.2).
 *
 * A miner produces the ore it sits on at a rate proportional to how many ore tiles
 * its footprint covers, holds a few items in a small buffer, and pushes them onto
 * any adjacent belt that is not pointing back at it, taking turns between belts.
 *
 * A footprint can straddle two ore types. It mines whichever covers more of it
 * (ties go to the lower ore id) and ignores the rest, rather than producing a mix,
 * so that one miner always yields one item.
 */

import { DX, DY, opposite } from '../core/dir';
import { MINER_BUFFER, MINER_MK1_RATE_PER_TILE } from '../config';
import { STRAIGHT, type BeltGrid } from './belts';
import { Ore, ITEM_COUNT, rotatedSize, type ItemId, type PlacedBuilding } from './types';
import type { World } from './world';

export interface MinerOutput {
  /** The belt tile this miner can feed. */
  tile: number;
  /** How the item enters that belt: STRAIGHT, or the side it comes in by. */
  lat: number;
}

export interface MinerState {
  readonly id: number;
  item: ItemId;
  /** Ore tiles under the footprint that are the mined ore. */
  oreTiles: number;
  /** Items per second. */
  rate: number;
  /** Fraction of the next item already produced. */
  progress: number;
  /** Items produced and waiting for a belt with room. */
  stored: number;
  /** Which output goes first next time, so belts share the miner's output evenly. */
  next: number;
  outputs: MinerOutput[];
}

export class MinerSystem {
  private miners = new Map<number, MinerState>();

  constructor(
    private readonly world: World,
    private readonly belts: BeltGrid,
  ) {}

  get count(): number {
    return this.miners.size;
  }

  info(id: number): Readonly<MinerState> | null {
    return this.miners.get(id) ?? null;
  }

  /**
   * Re-derives every miner from the world. Progress and stored items survive for
   * miners that are still there, so editing belts next to a working miner does not
   * throw away what it was carrying.
   */
  rebuild(): void {
    const next = new Map<number, MinerState>();

    for (const building of this.world.buildings()) {
      const def = this.world.defOf(building);
      if (!def || def.kind !== 'miner') continue;

      const { item, oreTiles } = this.surveyOre(building);
      if (item === Ore.None) continue;

      const old = this.miners.get(building.id);
      next.set(building.id, {
        id: building.id,
        item,
        oreTiles,
        rate: oreTiles * MINER_MK1_RATE_PER_TILE,
        progress: old?.progress ?? 0,
        stored: old?.stored ?? 0,
        next: old?.next ?? 0,
        outputs: this.findOutputs(building),
      });
    }

    this.miners = next;
  }

  step(dt: number): void {
    for (const m of this.miners.values()) {
      if (m.stored < MINER_BUFFER) {
        m.progress += m.rate * dt;
        const whole = Math.floor(m.progress);
        if (whole > 0) {
          const take = Math.min(whole, MINER_BUFFER - m.stored);
          m.stored += take;
          m.progress -= take;
        }
      }
      // A full buffer stops the clock instead of banking progress, so a miner that
      // was blocked for an hour does not dump an hour of ore the moment it frees up.
      if (m.stored >= MINER_BUFFER) m.progress = 0;

      if (m.stored > 0) this.emit(m);
    }
  }

  private emit(m: MinerState): void {
    const n = m.outputs.length;
    for (let j = 0; j < n; j++) {
      const index = (m.next + j) % n;
      const out = m.outputs[index]!;
      if (this.belts.tryEnter(out.tile, m.item, out.lat)) {
        m.stored--;
        m.next = (index + 1) % n;
        return;
      }
    }
  }

  private surveyOre(building: PlacedBuilding): { item: ItemId; oreTiles: number } {
    const def = this.world.defOf(building)!;
    const { w, h } = rotatedSize(def, building.rot);
    const tally = new Int32Array(ITEM_COUNT);

    for (let y = building.y; y < building.y + h; y++) {
      for (let x = building.x; x < building.x + w; x++) {
        tally[this.world.oreAt(x, y)]!++;
      }
    }

    let best: ItemId = Ore.None;
    let bestCount = 0;
    for (let ore = 1; ore < ITEM_COUNT; ore++) {
      if (tally[ore]! > bestCount) {
        best = ore;
        bestCount = tally[ore]!;
      }
    }
    return { item: best, oreTiles: bestCount };
  }

  /** Belts around the footprint that a miner is allowed to drop onto. */
  private findOutputs(building: PlacedBuilding): MinerOutput[] {
    const def = this.world.defOf(building)!;
    const { w, h } = rotatedSize(def, building.rot);
    const size = this.world.size;
    const outputs: MinerOutput[] = [];

    const inside = (x: number, y: number): boolean =>
      x >= building.x && x < building.x + w && y >= building.y && y < building.y + h;

    for (let y = building.y; y < building.y + h; y++) {
      for (let x = building.x; x < building.x + w; x++) {
        for (let k = 0; k < 4; k++) {
          const bx = x + DX[k]!;
          const by = y + DY[k]!;
          if (inside(bx, by) || !this.world.inBounds(bx, by)) continue;

          const tile = by * size + bx;
          const facing = this.belts.dir[tile]!;
          if (facing < 0) continue;

          // Direction from that belt back to the miner tile it touches.
          const toMiner = opposite(k);
          // A belt pointing at the miner would carry items into it, not away.
          if (toMiner === facing) continue;

          outputs.push({ tile, lat: toMiner === opposite(facing) ? STRAIGHT : toMiner });
        }
      }
    }
    return outputs;
  }
}
