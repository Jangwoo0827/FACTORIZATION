/**
 * The hub's inventory (GDD 6.3).
 *
 * Two counters that are deliberately kept apart:
 *
 *  - `stock` is what construction will spend. It is capped.
 *  - `delivered` is the running total that seals (missions) will read. It is not,
 *    and spending stock never reduces it, so building never sets progress back.
 *
 * The hub never refuses an item. If stock is full the surplus is discarded but
 * still counted as delivered, which means a belt feeding the hub can never back
 * up and jam.
 */

import { HUB_STOCK_CAP } from '../config';
import { ITEM_COUNT, type Cost, type ItemId } from './types';

/**
 * Snapshots kept for the per-minute rate. N snapshots span N-1 seconds, so 61 gives
 * a full minute.
 */
const HISTORY_SNAPSHOTS = 61;

export class Sieve {
  readonly stock = new Int32Array(ITEM_COUNT);
  readonly delivered = new Float64Array(ITEM_COUNT);

  private readonly history: Float64Array[] = [];

  receive(item: ItemId): void {
    this.delivered[item]!++;
    if (this.stock[item]! < HUB_STOCK_CAP) this.stock[item]!++;
  }

  /** Whether the stock covers every line of a price. */
  canAfford(cost: readonly Cost[]): boolean {
    for (const { item, count } of cost) if (this.stock[item]! < count) return false;
    return true;
  }

  /** The first line of a price the stock cannot cover, or null if it is all covered. */
  shortfall(cost: readonly Cost[]): { item: ItemId; need: number; have: number } | null {
    for (const { item, count } of cost) {
      if (this.stock[item]! < count) return { item, need: count, have: this.stock[item]! };
    }
    return null;
  }

  /**
   * Takes a price out of stock. Deliberately does not touch `delivered`: building
   * must never set mission progress back (GDD 6.3). The caller checks `canAfford`.
   */
  spend(cost: readonly Cost[]): void {
    for (const { item, count } of cost) this.stock[item]! -= count;
  }

  /** Gives a price back, up to the stock cap. */
  refund(cost: readonly Cost[]): void {
    for (const { item, count } of cost) {
      this.stock[item] = Math.min(HUB_STOCK_CAP, this.stock[item]! + count);
    }
  }

  /**
   * Adds to stock without counting as delivered: starting supplies and hand-mined
   * ore are usable for building but are not production, so they must not advance
   * missions.
   */
  addStock(item: ItemId, count: number): void {
    this.stock[item] = Math.min(HUB_STOCK_CAP, this.stock[item]! + count);
  }

  /** Called once per simulated second. */
  recordSecond(): void {
    this.history.push(this.delivered.slice());
    if (this.history.length > HISTORY_SNAPSHOTS) this.history.shift();
  }

  /**
   * How many of an item arrived in exactly the last 60 seconds, or null until a full
   * minute has been recorded.
   *
   * A whole number, unlike `perMinute`, and only ever a whole window: a seal that asks
   * for a steady rate must not be satisfied by one lucky second at the start.
   */
  deliveredInLastMinute(item: ItemId): number | null {
    if (this.history.length < HISTORY_SNAPSHOTS) return null;
    return this.history[this.history.length - 1]![item]! - this.history[0]![item]!;
  }

  /**
   * Deliveries per minute, averaged over up to the last minute.
   *
   * Compares two snapshots rather than the live counter. The counter includes part
   * of a second that has not been recorded yet, and dividing that by whole seconds
   * makes the figure jitter up and down between refreshes. Snapshots are a whole
   * number of seconds apart, so the result is exact and changes once a second.
   *
   * Reads zero until two snapshots exist, rather than guessing.
   */
  perMinute(item: ItemId): number {
    const first = this.history[0];
    const last = this.history[this.history.length - 1];
    if (!first || !last || this.history.length < 2) return 0;
    return ((last[item]! - first[item]!) / (this.history.length - 1)) * 60;
  }
}
