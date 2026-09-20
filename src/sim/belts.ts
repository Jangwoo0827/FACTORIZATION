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

/** What occupies a tile, as far as the belt network is concerned. */
const NONE = 0;
const BELT = 1;
const SPLITTER = 2;

export class BeltGrid {
  readonly size: number;
  readonly tileCount: number;

  /** Direction each tile's belt carries items, or -1 where there is no belt (a splitter has none). */
  readonly dir: Int8Array;
  /** NONE, BELT or SPLITTER. */
  private readonly kind: Uint8Array;
  /**
   * A splitter holds one item at a time, passed on within the same tick it arrived or
   * the next: `splitterItem` is 0 when empty, `splitterFrom` the side it came in by
   * (never used as an exit), and `splitterNext` where the round robin starts.
   */
  readonly splitterItem: Uint8Array;
  private readonly splitterFrom: Uint8Array;
  private readonly splitterNext: Uint8Array;
  /**
   * For an underpass entrance, the exit tile it hands items to; -1 otherwise. Items
   * cross the gap in one step, so they can pass over whatever is built in between.
   */
  private readonly link: Int32Array;
  /** The reverse of `link`: for an exit, the entrance feeding it; -1 otherwise. */
  private readonly linkedFrom: Int32Array;
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
    this.kind = new Uint8Array(this.tileCount);
    this.splitterItem = new Uint8Array(this.tileCount);
    this.splitterFrom = new Uint8Array(this.tileCount);
    this.splitterNext = new Uint8Array(this.tileCount);
    this.link = new Int32Array(this.tileCount).fill(-1);
    this.linkedFrom = new Int32Array(this.tileCount).fill(-1);
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
    this.kind[tile] = BELT;
    this.beltId[tile] = buildingId;
    this.count[tile] = 0;
  }

  /** Puts a splitter on a tile. It has no direction: it sends items out every side but the one they came in by. */
  setSplitter(tile: number, buildingId: number): void {
    this.dir[tile] = -1;
    this.kind[tile] = SPLITTER;
    this.beltId[tile] = buildingId;
    this.count[tile] = 0;
    this.splitterItem[tile] = 0;
    this.splitterNext[tile] = 0;
  }

  /** Removes whatever was on the tile and, with it, every item it held. */
  clearBelt(tile: number): void {
    this.dir[tile] = -1;
    this.kind[tile] = NONE;
    this.beltId[tile] = -1;
    this.count[tile] = 0;
    this.splitterItem[tile] = 0;
  }

  isSplitter(tile: number): boolean {
    return this.kind[tile] === SPLITTER;
  }

  /** The item a splitter is holding, or 0. */
  splitterContents(tile: number): number {
    return this.splitterItem[tile]!;
  }

  clearLinks(): void {
    this.link.fill(-1);
    this.linkedFrom.fill(-1);
  }

  /** Joins an underpass entrance to its exit. */
  setLink(entrance: number, exit: number): void {
    this.link[entrance] = exit;
    this.linkedFrom[exit] = entrance;
  }

  linkOf(entrance: number): number {
    return this.link[entrance]!;
  }

  isLinkedExit(tile: number): boolean {
    return this.linkedFrom[tile]! >= 0;
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
      const kind = this.kind[t]!;
      const feedsNothing =
        kind === BELT ? this.downstreamBelt(t) === -1 : kind === SPLITTER && !this.splitterHasTarget(t);
      if (feedsNothing) {
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
      const back = facing >= 0 ? opposite(facing) : 0;
      for (let j = 0; j < 4; j++) {
        const k = (back + j) % 4;
        const mx = nx + DX[k]!;
        const my = ny + DY[k]!;
        if (mx < 0 || my < 0 || mx >= size || my >= size) continue;
        const m = my * size + mx;
        if (visited[m] || !this.feeds(m, n, k)) continue;
        visited[m] = 1;
        queue[tail++] = m;
      }

      // An underpass entrance is not adjacent to its exit, so the neighbour scan
      // above cannot find it. It hands items to the exit, so it goes after it.
      const entrance = this.linkedFrom[n]!;
      if (entrance >= 0 && !visited[entrance]) {
        visited[entrance] = 1;
        queue[tail++] = entrance;
      }
    }

    // Anything left is on a loop.
    for (let t = 0; t < this.tileCount; t++) {
      if (this.kind[t] !== NONE && !visited[t]) queue[tail++] = t;
    }
    this.orderLength = tail;
  }

  /**
   * Whether tile `m` hands items to tile `n`, given that `m` is `n + DIR[k]`.
   *
   * A belt feeds one place. A splitter feeds every neighbour that will take from it,
   * which is why ordering can only be approximate around one: the splitter is placed
   * after the first of its outputs to be reached, so a later one may see its
   * freed-up space a tick late. That costs a sliver of latency, never correctness.
   */
  private feeds(m: number, n: number, k: number): boolean {
    const kind = this.kind[m]!;
    if (kind === BELT) return this.downstreamBelt(m) === n;
    if (kind !== SPLITTER) return false;
    // `m` is on side k of `n`, so n is on side opposite(k) of m. A belt there that
    // faces back at the splitter (direction k) does not take from it.
    const nd = this.dir[n]!;
    if (nd >= 0) return nd !== k;
    return this.kind[n] === SPLITTER;
  }

  /** Whether a splitter has any belt or splitter next to it that could take an item. */
  private splitterHasTarget(tile: number): boolean {
    const x = tile % this.size;
    const y = (tile - x) / this.size;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
      const next = ny * this.size + nx;
      const nd = this.dir[next]!;
      if (nd >= 0 ? nd !== opposite(k) : this.kind[next] === SPLITTER) return true;
    }
    return false;
  }

  /**
   * The belt tile that `tile` hands items to, or -1. A belt facing straight back at
   * it does not count: two belts nose to nose cannot exchange items.
   */
  private downstreamBelt(tile: number): number {
    const d = this.dir[tile]!;
    if (d < 0) return -1;
    // An underpass entrance hands items to its exit, wherever that is.
    if (this.link[tile]! >= 0) return this.link[tile]!;
    const x = tile % this.size;
    const y = (tile - x) / this.size;
    const nx = x + DX[d]!;
    const ny = y + DY[d]!;
    if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) return -1;
    const next = ny * this.size + nx;
    const nd = this.dir[next]!;
    if (nd >= 0) return nd === opposite(d) ? -1 : next;
    return this.kind[next] === SPLITTER ? next : -1;
  }

  // ------------------------------------------------------------ stepping

  step(): void {
    this.prev.set(this.pos);
    for (let o = 0; o < this.orderLength; o++) {
      const tile = this.order[o]!;
      if (this.kind[tile] === SPLITTER) this.advanceSplitter(tile);
      else this.advance(tile);
    }
  }

  /**
   * Passes a splitter's item on, trying each side in turn starting from where the
   * last one left off, and skipping the side it arrived from.
   *
   * Skipping a full or refusing side is what makes a splitter useful: a blocked
   * output does not stall the others, and when every output is blocked the item just
   * stays, holding up whatever feeds the splitter until something clears.
   */
  private advanceSplitter(tile: number): void {
    const item = this.splitterItem[tile]!;
    if (item === 0) return;

    const from = this.splitterFrom[tile]!;
    const start = this.splitterNext[tile]!;
    const x = tile % this.size;
    const y = (tile - x) / this.size;

    for (let j = 0; j < 4; j++) {
      const k = (start + j) % 4;
      if (k === from) continue;

      const nx = x + DX[k]!;
      const ny = y + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue;
      const next = ny * this.size + nx;

      const nd = this.dir[next]!;
      let passed = false;
      if (nd >= 0) {
        // A belt facing back at the splitter carries items in, not away.
        if (nd === opposite(k)) continue;
        passed = this.insert(next, item, 0, 0, nd === k ? STRAIGHT : opposite(k));
      } else if (this.kind[next] === SPLITTER) {
        passed = this.splitterIn(next, item, opposite(k));
      } else if (this.receiver[next]! >= 0) {
        passed = this.offer(this.receiver[next]!, item);
      }

      if (passed) {
        this.splitterItem[tile] = 0;
        this.splitterNext[tile] = (k + 1) % 4;
        return;
      }
    }
  }

  /** Hands an item to a splitter if it is empty. `from` is the side it arrives on. */
  private splitterIn(tile: number, item: ItemId, from: number): boolean {
    if (this.splitterItem[tile] !== 0) return false;
    this.splitterItem[tile] = item;
    this.splitterFrom[tile] = from;
    return true;
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

    // An underpass entrance: the item leaves the tile at the far end and reappears at
    // the exit's start. Its previous position is set to where it lands, since
    // interpolating across the gap would draw it sliding under the ground.
    const exit = this.link[tile]!;
    if (exit >= 0) return this.insert(exit, item, carried, carried, STRAIGHT);

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

    if (this.kind[next] === SPLITTER) return this.splitterIn(next, item, opposite(d));

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
    // For a splitter `lat` is the side the item arrives on, a direction 0..3.
    if (this.kind[tile] === SPLITTER) return this.splitterIn(tile, item, lat);
    if (this.dir[tile]! < 0) return false;
    return this.insert(tile, item, 0, 0, lat);
  }

  // ------------------------------------------------------------ inspection

  totalItems(): number {
    let total = 0;
    for (let t = 0; t < this.tileCount; t++) total += this.count[t]! + (this.splitterItem[t]! !== 0 ? 1 : 0);
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
