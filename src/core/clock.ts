/**
 * Turns wall-clock time into simulation ticks.
 *
 * The simulation must not depend on how often anything happens to call it. A
 * browser stops animation frames for a hidden tab and slows its timers to once a
 * second or worse, so a loop that runs "one tick per frame" or "one tick per timer
 * fire" stalls the factory the moment the window is covered. This clock instead
 * tracks how much real time has passed and reports how many ticks are owed, so it
 * gives the same answer whether it is called 60 times a second or once a minute.
 *
 * Owed time is kept in two buckets with different caps, because there are two very
 * different reasons for a large gap:
 *
 *  - **Live** time accrues in short gaps between calls. If the machine simply cannot
 *    run the simulation fast enough, this piles up without bound, so it is capped
 *    at about a second and the excess dropped: the game runs slower than real time
 *    but stays responsive, rather than spending every frame chasing a backlog.
 *
 *  - **Away** time is a single long gap: the tab was frozen or the machine slept.
 *    Nothing was wrong with the simulation, it just was not asked to run, so the
 *    factory should have kept going. Up to a generous cap it is owed in full and
 *    caught up on return.
 *
 * Pure: no timers, no DOM. The caller supplies the time.
 */

export interface SimClockOptions {
  /** Length of one simulation tick, in seconds. */
  tickSeconds: number;
  /** Most live (short-gap) time that may be owed before the excess is dropped. */
  liveCapSeconds: number;
  /** Most away (long-gap) time that will be caught up. */
  awayCapSeconds: number;
  /** A gap longer than this is away time; a shorter one is live. */
  awayThresholdSeconds: number;
}

/** Owed time is a running float sum; this keeps a tick that is due by rounding from being missed. */
const EPSILON = 1e-9;

export class SimClock {
  private lastMs: number | null = null;
  private live = 0;
  private away = 0;

  constructor(private readonly options: SimClockOptions) {}

  /** Adds the real time since the previous call to what is owed. */
  advance(nowMs: number): void {
    if (this.lastMs === null) {
      // The first call only sets the baseline: there is nothing to be owed for
      // time before the clock existed.
      this.lastMs = nowMs;
      return;
    }

    // Time must not run backwards, however the caller sourced it.
    if (nowMs <= this.lastMs) return;
    const gap = (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;

    const { awayThresholdSeconds, awayCapSeconds, liveCapSeconds } = this.options;
    if (gap > awayThresholdSeconds) {
      this.away = Math.min(awayCapSeconds, this.away + gap);
    } else {
      this.live = Math.min(liveCapSeconds, this.live + gap);
    }
  }

  /** Whether at least one whole tick is owed. */
  hasTick(): boolean {
    return this.live + this.away >= this.options.tickSeconds - EPSILON;
  }

  /** Marks one tick as run. Live time is spent first, so a cap on it cannot strand away time. */
  consume(): void {
    const tick = this.options.tickSeconds;
    if (this.live >= tick - EPSILON) this.live = Math.max(0, this.live - tick);
    else this.away = Math.max(0, this.away - tick);
  }

  /** Real time owed, in seconds. Large only while catching up after being away. */
  get owedSeconds(): number {
    return this.live + this.away;
  }

  /** Away time still to be caught up, in seconds. */
  get awaySeconds(): number {
    return this.away;
  }

  /**
   * How far through the next tick the clock is, for drawing between ticks. Zero
   * while behind, since interpolating toward a state that is more than one tick
   * ahead would draw something that never existed.
   */
  get alpha(): number {
    const owed = this.owedSeconds;
    const tick = this.options.tickSeconds;
    return owed >= tick ? 0 : owed / tick;
  }
}
