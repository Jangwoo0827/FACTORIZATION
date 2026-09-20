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
import { ITEM_COUNT, type ItemId } from './types';

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

  /** Called once per simulated second. */
  recordSecond(): void {
    this.history.push(this.delivered.slice());
    if (this.history.length > HISTORY_SNAPSHOTS) this.history.shift();
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
