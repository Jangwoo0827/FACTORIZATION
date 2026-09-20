/**
 * Conveyor simulation (GDD 7.1).
 *
 * Single lane, up to four items per tile, minimum spacing 0.25. Each item carries a
 * position `p` along its tile: 0 is the entry edge, 1 the exit edge. At the Mk1
 * speed of 1.5 tiles/s and 0.25 spacing that is 6 items/s, which the tests pin.
 *
 * State lives in flat typed arrays indexed by tile, four slots per tile, so the
 * whole belt network is a handful of contiguous buffers: cheap to step, cheap to
 * snapshot, and the renderer can read it directly without any allocation.
 *
 * Slots are kept ordered front to back (highest `p` first). Every way onto a belt
 * enters at `p = 0`, which is the smallest position there can be, so entry is
 * always an append at the back and never needs a sorted insert.
 *
 * Pure TypeScript: no renderer, no DOM (GDD 14.2).
 */

import { DX, DY, opposite } from '../core/dir';
import type { ItemId } from './types';

export const SLOTS = 4;
export const SPACING = 0.25;
/**
 * `lat` value for an item that entered through the back of its tile. Any other
 * value is the direction, from the tile's centre, of the side it came in by.
 */
export const STRAIGHT = 4;

/**
 * Float32 storage and repeated 0.05 steps drift by a few 1e-7 per tick. Without a
 * tolerance, items at exactly 0.25 apart would be refused entry at a tile boundary
 * by rounding alone, and a saturated belt would fall short of 6 items/s.
 */
const EPS = 1e-3;

export class BeltGrid {
  readonly size: number;
  readonly tileCount: number;

  /** Direction each tile's belt carries items, or -1 where there is no belt. */
  readonly dir: Int8Array;
  /** Id of the building occupying the tile, so a replaced belt can be told from a kept one. */
  readonly beltId: Int32Array;
  /** Items currently on each tile, 0..SLOTS. */
  readonly count: Uint8Array;
  /** Position of each slot along its tile. */
  readonly pos: Float32Array;
  /** Position at the start of the tick, so the renderer can interpolate. */
  readonly prev: Float32Array;
  readonly item: Uint8Array;
  readonly lat: Uint8Array;
  /**
   * Id of the building that receives items handed to this tile, or -1 where nothing
   * does. The hub and every machine's footprint are receivers; what each one does
   * with an item, including refusing it, is up to the `offer` callback.
   */
  readonly receiver: Int32Array;

  private order: Int32Array;
  private orderLength = 0;
  private readonly stepPerTick: number;
  private readonly offer: (receiverId: number, item: ItemId) => boolean;

  constructor(
    size: number,
    speedTilesPerSecond: number,
    ticksPerSecond: number,
    offer: (receiverId: number, item: ItemId) => boolean,
  ) {
    this.size = size;
    this.tileCount = size * size;
    this.stepPerTick = speedTilesPerSecond / ticksPerSecond;
    this.offer = offer;

    this.dir = new Int8Array(this.tileCount).fill(-1);
    this.beltId = new Int32Array(this.tileCount).fill(-1);
    this.count = new Uint8Array(this.tileCount);
    this.pos = new Float32Array(this.tileCount * SLOTS);
    this.prev = new Float32Array(this.tileCount * SLOTS);
    this.item = new Uint8Array(this.tileCount * SLOTS);
    this.lat = new Uint8Array(this.tileCount * SLOTS);
    this.receiver = new Int32Array(this.tileCount).fill(-1);
    this.order = new Int32Array(this.tileCount);
  }

  // ------------------------------------------------------------ topology

  setBelt(tile: number, direction: number, buildingId: number): void {
    this.dir[tile] = direction;
    this.beltId[tile] = buildingId;
    this.count[tile] = 0;
  }

  /** Removes the belt and, with it, every item that was on it. */
  clearBelt(tile: number): void {
    this.dir[tile] = -1;
    this.beltId[tile] = -1;
    this.count[tile] = 0;
  }

  clearReceivers(): void {
    this.receiver.fill(-1);
  }

  setReceiver(tile: number, buildingId: number): void {
    this.receiver[tile] = buildingId;
  }

  isBelt(tile: number): boolean {
    return this.dir[tile]! >= 0;
  }

  /** Tiles in the order they are stepped: every belt after the belt it feeds. */
  orderedTiles(): Int32Array {
    return this.order.subarray(0, this.orderLength);
  }

  /**
   * Recomputes the update order after the topology changed.
   *
   * Stepping downstream-first is what lets a jam clear from the front in a single
   * tick: the front item leaves, then the one behind it advances into the space,
   * and so on back along the line. Stepped the other way round, a freed slot would
   * only propagate one tile per tick and a saturated belt would lose throughput.
   *
   * Breadth-first from the tiles that feed nothing gives exactly that order. Belts
   * on a closed loop are never reached that way; they are appended at the end in
   * tile order. A loop has no downstream-first order to find, and stepping it in any
   * fixed order is deterministic, which is all that matters.
   */
  rebuildOrder(): void {
    const size = this.size;
    const visited = new Uint8Array(this.tileCount);
    const queue = this.order;
    let head = 0;
    let tail = 0;

    for (let t = 0; t < this.tileCount; t++) {
      if (this.dir[t]! >= 0 && this.downstreamBelt(t) === -1) {
        queue[tail++] = t;
        visited[t] = 1;
      }
    }

    while (head < tail) {
      const n = queue[head++]!;
      const nx = n % size;
      const ny = (n - nx) / size;
      const facing = this.dir[n]!;

      // The belt directly behind is examined first, so where a straight feeder and
      // a side feeder compete for the same slot the straight one is stepped first.
      const back = opposite(facing);
      for (let j = 0; j < 4; j++) {
        const k = (back + j) % 4;
        const mx = nx + DX[k]!;
        const my = ny + DY[k]!;
        if (mx < 0 || my < 0 || mx >= size || my >= size) continue;
        const m = my * size + mx;
        if (visited[m] || this.dir[m]! < 0) continue;
        if (this.downstreamBelt(m) !== n) continue;
        visited[m] = 1;
        queue[tail++] = m;
      }
    }

    // Anything left is on a loop.
    for (let t = 0; t < this.tileCount; t++) {
      if (this.dir[t]! >= 0 && !visited[t]) queue[tail++] = t;
    }
    this.orderLength = tail;
  }

  /**
   * The belt tile that `tile` hands items to, or -1. A belt facing straight back at
   * it does not count: two belts nose to nose cannot exchange items.
   */
  private downstreamBelt(tile: number): number {
    const d = this.dir[tile]!;
    if (d < 0) return -1;
    const x = tile % this.size;
    const y = (tile - x) / this.size;
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) return -1;
    const next = ny * this.size + nx;
    const nd = this.dir[next]!;
    if (nd < 0 || nd === opposite(d)) return -1;
    return next;
  }

  // ------------------------------------------------------------ stepping

  step(): void {
    this.prev.set(this.pos);
    for (let o = 0; o < this.orderLength; o++) this.advance(this.order[o]!);
  }

  private advance(tile: number): void {
    const c = this.count[tile]!;
    if (c === 0) return;

    const base = tile * SLOTS;
    const step = this.stepPerTick;
    // Position of the item just ahead, once it has moved this tick. Infinity while
    // no item remains ahead, i.e. for whichever item is currently the front.
    let lead = Infinity;
    let write = 0;

    for (let i = 0; i < c; i++) {
      const src = base + i;
      const old = this.pos[src]!;
      let p = old + step;

      if (lead !== Infinity) {
        const limit = lead - SPACING;
        if (p > limit) p = limit;
        // Never slide backwards, even if the spacing was already violated.
        if (p < old) p = old;
      } else if (p >= 1) {
        // Reached the end of the tile. The overshoot is carried into the next one so
        // no distance is lost at tile boundaries, and the previous position is
        // re-expressed in the next tile's frame so interpolation stays continuous.
        if (this.tryExit(tile, this.item[src]!, p - 1, this.prev[src]! - 1)) continue;
        p = 1;
      }

      const dst = base + write;
      if (dst !== src) {
        this.prev[dst] = this.prev[src]!;
        this.item[dst] = this.item[src]!;
        this.lat[dst] = this.lat[src]!;
      }
      this.pos[dst] = p;
      lead = p;
      write++;
    }

    this.count[tile] = write;
  }

  /** Tries to hand the front item on. Returns true if it left this tile. */
  private tryExit(tile: number, item: ItemId, carried: number, prevInNext: number): boolean {
    const d = this.dir[tile]!;
    const x = tile % this.size;
    const y = (tile - x) / this.size;
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) return false;
    const next = ny * this.size + nx;

    const nd = this.dir[next]!;
    if (nd >= 0) {
      if (nd === opposite(d)) return false;
      // Straight on if the next belt points the same way; otherwise this is a side
      // entry, and the side it came in by is back toward this tile.
      const lat = nd === d ? STRAIGHT : opposite(d);
      return this.insert(next, item, carried, prevInNext, lat);
    }

    const receiver = this.receiver[next]!;
    if (receiver >= 0) {
      // Accepted or refused is the receiver's call. A refusal leaves the item at the
      // end of this belt, which is how a machine that wants something else jams the
      // line behind it rather than silently swallowing the wrong ingredient.
      return this.offer(receiver, item);
    }
    return false;
  }

  /**
   * Appends an item at the back of a tile if there is room.
   *
   * Room means a free slot and a full spacing to the item currently at the back.
   * Because callers only ever enter at or near p = 0, the new item really is the
   * rearmost and no reordering is needed.
   */
  private insert(tile: number, item: ItemId, p: number, prevP: number, lat: number): boolean {
    const c = this.count[tile]!;
    if (c >= SLOTS) return false;

    const base = tile * SLOTS;
    if (c > 0 && this.pos[base + c - 1]! - p < SPACING - EPS) return false;

    const slot = base + c;
    this.pos[slot] = p;
    this.prev[slot] = prevP;
    this.item[slot] = item;
    this.lat[slot] = lat;
    this.count[tile] = c + 1;
    return true;
  }

  /**
   * Puts an item onto a belt from outside the belt network (a miner, later a
   * machine). Returns false, leaving the item with the caller, if there is no room.
   */
  tryEnter(tile: number, item: ItemId, lat: number): boolean {
    if (this.dir[tile]! < 0) return false;
    return this.insert(tile, item, 0, 0, lat);
  }

  // ------------------------------------------------------------ inspection

  totalItems(): number {
    let total = 0;
    for (let t = 0; t < this.tileCount; t++) total += this.count[t]!;
    return total;
  }

  /**
   * Appends an item at an exact position with no room check, for building test and
   * benchmark scenes. Callers must supply positions front to back.
   */
  debugPush(tile: number, item: ItemId, p: number, lat: number = STRAIGHT): boolean {
    const c = this.count[tile]!;
    if (c >= SLOTS) return false;
    const slot = tile * SLOTS + c;
    this.pos[slot] = p;
    this.prev[slot] = p;
    this.item[slot] = item;
    this.lat[slot] = lat;
    this.count[tile] = c + 1;
    return true;
  }
}
