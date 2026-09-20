/**
 * Where a building puts what it makes (GDD 6.2).
 *
 * Miners and machines share one rule: an item goes onto any adjacent belt that is
 * not pointing back at the building, and successive items take turns between the
 * belts that are available. Kept in one place so the two cannot drift apart.
 */

import { DX, DY, opposite } from '../core/dir';
import { STRAIGHT, type BeltGrid } from './belts';
import { rotatedSize, type ItemId, type PlacedBuilding } from './types';
import type { World } from './world';

export interface Port {
  /** The belt tile this building can feed. */
  tile: number;
  /** How the item enters that belt: STRAIGHT, or the side it comes in by. */
  lat: number;
}

/** Belts around the footprint that the building is allowed to drop onto. */
export function findPorts(world: World, belts: BeltGrid, building: PlacedBuilding): Port[] {
  const def = world.defOf(building);
  if (!def) return [];

  const { w, h } = rotatedSize(def, building.rot);
  const size = world.size;
  const ports: Port[] = [];

  const inside = (x: number, y: number): boolean =>
    x >= building.x && x < building.x + w && y >= building.y && y < building.y + h;

  for (let y = building.y; y < building.y + h; y++) {
    for (let x = building.x; x < building.x + w; x++) {
      for (let k = 0; k < 4; k++) {
        const bx = x + DX[k]!;
        const by = y + DY[k]!;
        if (inside(bx, by) || !world.inBounds(bx, by)) continue;

        const tile = by * size + bx;

        // Direction from that tile back to the building tile it touches.
        const toBuilding = opposite(k);

        // A splitter takes an item from any side. `lat` is the side it arrives on.
        if (belts.isSplitter(tile)) {
          ports.push({ tile, lat: toBuilding });
          continue;
        }

        const facing = belts.dir[tile]!;
        if (facing < 0) continue;
        // A belt pointing at the building carries items into it, not away, so it is
        // an input. It must not also be an output, or a machine would push its
        // product straight back onto its own feed line.
        if (toBuilding === facing) continue;

        ports.push({ tile, lat: toBuilding === opposite(facing) ? STRAIGHT : toBuilding });
      }
    }
  }
  return ports;
}

/**
 * Puts one item onto the first port with room, starting from `start` and wrapping.
 *
 * Returns the index the next item should start from, so the belts share the output
 * evenly, or -1 if none of them had room and the item stays with the caller.
 */
export function emitToPorts(
  belts: BeltGrid,
  ports: readonly Port[],
  start: number,
  item: ItemId,
): number {
  const n = ports.length;
  for (let j = 0; j < n; j++) {
    const index = (start + j) % n;
    const port = ports[index]!;
    if (belts.tryEnter(port.tile, item, port.lat)) return (index + 1) % n;
  }
  return -1;
}
