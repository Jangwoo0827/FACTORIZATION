/**
 * Production statistics (GDD 11.2): how much of each item the factory makes and uses.
 *
 *  - **Produced**: an ore dug by a miner, or an item finished by a machine.
 *  - **Consumed**: ingredients a machine takes when it starts a craft, or fuel a
 *    generator starts burning.
 *
 * Building from the hub's stock is neither: it is spending, not production, and the
 * hub has its own counters (`Sieve`). Hand mining is not production either.
 *
 * Counts are kept as running totals and snapshotted once per simulated second, up to
 * an hour back. A rate over any window is then the difference of two snapshots, so
 * reading it costs the same whether the window is a minute or an hour, and it only
 * ever covers whole recorded seconds (the same reason as `Sieve.perMinute`: a partial
 * second divided by whole seconds makes the figure jitter).
 */

import { ITEM_COUNT, type ItemId } from './types';

/** An hour of seconds, plus one: N snapshots span N-1 seconds. */
export const STATS_HISTORY = 3601;

export interface StatsState {
  readonly produced: readonly number[];
  readonly consumed: readonly number[];
  /** Snapshots recorded, oldest first, at most an hour's worth. */
  readonly snapshots: number;
  /** Per item that was ever made or used: its snapshots, oldest first. Others are all zero. */
  readonly producedSeries: readonly (readonly [number, readonly number[]])[];
  readonly consumedSeries: readonly (readonly [number, readonly number[]])[];
}

export class ProductionStats {
  readonly produced = new Float64Array(ITEM_COUNT);
  readonly consumed = new Float64Array(ITEM_COUNT);

  /** Snapshots of `produced`/`consumed`, one per second, oldest first, in a ring. */
  private readonly producedRing = new Float64Array(STATS_HISTORY * ITEM_COUNT);
  private readonly consumedRing = new Float64Array(STATS_HISTORY * ITEM_COUNT);
  /** Snapshots taken so far, which keeps counting past the ring's size. */
  private recorded = 0;

  /**
   * The totals and the recorded history, for a save. Only items that were ever made or
   * used are written; early in a game that is most of the saving.
   */
  exportState(): StatsState {
    const n = Math.min(this.recorded, STATS_HISTORY);
    const series = (ring: Float64Array) =>
      this.activeItems().map((item) => {
        const values: number[] = [];
        for (let k = n - 1; k >= 0; k--) values.push(this.snapshotBack(ring, item, k) ?? 0);
        return [item, values] as const;
      });
    return {
      produced: Array.from(this.produced),
      consumed: Array.from(this.consumed),
      snapshots: n,
      producedSeries: series(this.producedRing),
      consumedSeries: series(this.consumedRing),
    };
  }

  importState(state: StatsState): void {
    this.produced.fill(0);
    this.consumed.fill(0);
    this.producedRing.fill(0);
    this.consumedRing.fill(0);
    state.produced.forEach((v, i) => i < ITEM_COUNT && (this.produced[i] = v));
    state.consumed.forEach((v, i) => i < ITEM_COUNT && (this.consumed[i] = v));
    const n = Math.min(state.snapshots, STATS_HISTORY);
    const write = (ring: Float64Array, series: StatsState['producedSeries']) => {
      for (const [item, values] of series) {
        if (item < 0 || item >= ITEM_COUNT) continue;
        for (let k = 0; k < n; k++) ring[k * ITEM_COUNT + item] = values[k] ?? 0;
      }
    };
    write(this.producedRing, state.producedSeries);
    write(this.consumedRing, state.consumedSeries);
    this.recorded = n;
  }

  produce(item: ItemId, count = 1): void {
    this.produced[item]! += count;
  }

  consume(item: ItemId, count = 1): void {
    this.consumed[item]! += count;
  }

  /** Called once per simulated second. */
  recordSecond(): void {
    const slot = (this.recorded % STATS_HISTORY) * ITEM_COUNT;
    this.producedRing.set(this.produced, slot);
    this.consumedRing.set(this.consumed, slot);
    this.recorded++;
  }

  /** Whole seconds of history available, capped at an hour. */
  get seconds(): number {
    return Math.max(0, Math.min(this.recorded, STATS_HISTORY) - 1);
  }

  /** Items per minute made over the last `windowSeconds` (or all there is, if less). */
  producedPerMinute(item: ItemId, windowSeconds: number): number {
    return this.rate(this.producedRing, item, windowSeconds);
  }

  consumedPerMinute(item: ItemId, windowSeconds: number): number {
    return this.rate(this.consumedRing, item, windowSeconds);
  }

  /**
   * How many were made in each of `buckets` equal slices of the window, oldest first,
   * as items per minute. For a small graph. Slices older than the recorded history
   * are zero.
   */
  producedSeries(item: ItemId, windowSeconds: number, buckets: number): number[] {
    const out: number[] = [];
    const span = windowSeconds / buckets;
    for (let b = 0; b < buckets; b++) {
      // Seconds back from now to each end of the slice.
      const from = Math.round(windowSeconds - b * span);
      const to = Math.round(windowSeconds - (b + 1) * span);
      const older = this.snapshotBack(this.producedRing, item, from);
      const newer = this.snapshotBack(this.producedRing, item, to);
      out.push(older === null || newer === null || from === to ? 0 : ((newer - older) / (from - to)) * 60);
    }
    return out;
  }

  /** Every item that has ever been made or used. */
  activeItems(): ItemId[] {
    const out: ItemId[] = [];
    for (let i = 1; i < ITEM_COUNT; i++) if (this.produced[i]! > 0 || this.consumed[i]! > 0) out.push(i);
    return out;
  }

  private rate(ring: Float64Array, item: ItemId, windowSeconds: number): number {
    const span = Math.min(windowSeconds, this.seconds);
    if (span <= 0) return 0;
    const now = this.snapshotBack(ring, item, 0)!;
    const then = this.snapshotBack(ring, item, span)!;
    return ((now - then) / span) * 60;
  }

  /** The snapshot taken `back` seconds before the latest, or null if that is not recorded. */
  private snapshotBack(ring: Float64Array, item: ItemId, back: number): number | null {
    if (back < 0 || back > this.seconds || this.recorded === 0) return null;
    const index = (this.recorded - 1 - back) % STATS_HISTORY;
    return ring[index * ITEM_COUNT + item]!;
  }
}
