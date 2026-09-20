import { describe, expect, it } from 'vitest';
import { SimClock, type SimClockOptions } from '../src/core/clock';

const TICK = 1 / 30;

const OPTIONS: SimClockOptions = {
  tickSeconds: TICK,
  liveCapSeconds: 1,
  awayCapSeconds: 30 * 60,
  awayThresholdSeconds: 0.5,
};

/** Runs every tick that is currently owed, the way a caller with no time limit would. */
function drain(clock: SimClock): number {
  let ticks = 0;
  while (clock.hasTick()) {
    clock.consume();
    ticks++;
  }
  return ticks;
}

/** Calls `advance` every `stepMs` for `totalMs`, draining each time. Returns total ticks. */
function run(clock: SimClock, startMs: number, totalMs: number, stepMs: number): number {
  let ticks = 0;
  for (let t = startMs; t <= startMs + totalMs + 1e-6; t += stepMs) {
    clock.advance(t);
    ticks += drain(clock);
  }
  return ticks;
}

describe('SimClock', () => {
  it('owes nothing for the time before its first call', () => {
    const clock = new SimClock(OPTIONS);
    clock.advance(123456);
    expect(clock.hasTick()).toBe(false);
    expect(clock.owedSeconds).toBe(0);
  });

  describe('running at the same speed however it is driven', () => {
    // The point of the whole class: the factory's speed is set by the clock on the
    // wall, not by how often something calls in.
    const SECONDS = 10;

    it.each([
      ['60 Hz animation frames', 1000 / 60],
      ['144 Hz animation frames', 1000 / 144],
      ['30 Hz worker heartbeat', 1000 / 30],
      ['a throttled 1 Hz timer', 1000],
    ])('%s', (_name, stepMs) => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      const ticks = run(clock, stepMs, SECONDS * 1000 - stepMs, stepMs);

      // 30 ticks per second, give or take the tick still in progress.
      expect(Math.abs(ticks - SECONDS * 30)).toBeLessThanOrEqual(1);
    });

    it('is unaffected by irregular timing', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      let now = 0;
      let ticks = 0;
      // Deterministic but uneven gaps between 1 ms and 90 ms, like a busy page.
      for (let i = 0; now < 20000; i++) {
        now += 1 + ((i * 37) % 90);
        clock.advance(now);
        ticks += drain(clock);
      }
      expect(Math.abs(ticks - (now / 1000) * 30)).toBeLessThanOrEqual(2);
    });

    it('gives the same total whether called often or rarely', () => {
      const often = new SimClock(OPTIONS);
      const rarely = new SimClock(OPTIONS);
      often.advance(0);
      rarely.advance(0);

      const a = run(often, 16, 9984, 16);
      const b = run(rarely, 1000, 9000, 1000);
      expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
    });
  });

  describe('time away', () => {
    it('is caught up in full: a hidden tab that was throttled to once a minute', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(60_000); // one call, a minute later

      // The factory should have run for that whole minute.
      expect(drain(clock)).toBe(60 * 30);
    });

    it('is still caught up after several long gaps', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      let ticks = 0;
      for (let i = 1; i <= 5; i++) {
        clock.advance(i * 20_000);
        ticks += drain(clock);
      }
      expect(ticks).toBe(100 * 30);
    });

    it('is capped, so a machine asleep overnight does not owe hours', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(8 * 3600 * 1000);

      expect(clock.owedSeconds).toBe(OPTIONS.awayCapSeconds);
      expect(clock.awaySeconds).toBe(OPTIONS.awayCapSeconds);
    });

    it('can be worked off in slices without losing any of it', () => {
      // Catching up is time-sliced by the caller, so what is left after one slice
      // must still be owed for the next.
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(10_000);

      let ticks = 0;
      while (clock.hasTick()) {
        for (let i = 0; i < 50 && clock.hasTick(); i++) {
          clock.consume();
          ticks++;
        }
        // Real time keeps passing between slices, in short live gaps.
      }
      expect(ticks).toBe(300);
      expect(clock.owedSeconds).toBeLessThan(TICK);
    });

    it('treats a gap just under the threshold as live, and just over as away', () => {
      const live = new SimClock(OPTIONS);
      live.advance(0);
      live.advance(499);
      expect(live.awaySeconds).toBe(0);

      const away = new SimClock(OPTIONS);
      away.advance(0);
      away.advance(501);
      expect(away.awaySeconds).toBeCloseTo(0.501, 6);
    });
  });

  describe('overload', () => {
    it('drops live time beyond its cap instead of chasing it forever', () => {
      // A machine too slow to run the simulation: time accrues in frame-sized gaps
      // and is never consumed. The game should run slow, not owe minutes of ticks.
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      for (let t = 16; t <= 60_000; t += 16) clock.advance(t);

      expect(clock.owedSeconds).toBe(OPTIONS.liveCapSeconds);
    });

    it('does not let a live cap swallow away time', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(10_000); // away
      for (let t = 10_016; t <= 20_000; t += 16) clock.advance(t); // live pile-up

      expect(clock.awaySeconds).toBe(10);
      expect(clock.owedSeconds).toBeCloseTo(10 + OPTIONS.liveCapSeconds, 6);
    });

    it('spends live time first, leaving away time for last', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(5_000);
      clock.advance(5_100);
      const away = clock.awaySeconds;

      clock.consume();
      // One tick consumed from the live 0.1 s, so the away bucket is untouched.
      expect(clock.awaySeconds).toBe(away);
    });
  });

  describe('robustness', () => {
    it('ignores time going backwards', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(1000);
      clock.advance(1100);
      const owed = clock.owedSeconds;

      clock.advance(900);
      expect(clock.owedSeconds).toBe(owed);

      // And it keeps counting from the latest time it saw, not the earlier one.
      clock.advance(1200);
      expect(clock.owedSeconds).toBeCloseTo(owed + 0.1, 6);
    });

    it('ignores a repeated timestamp', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(50);
      const owed = clock.owedSeconds;
      clock.advance(50);
      expect(clock.owedSeconds).toBe(owed);
    });

    it('never goes negative when consumed past what is owed', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.consume();
      clock.consume();
      expect(clock.owedSeconds).toBe(0);
    });
  });

  describe('interpolation', () => {
    it('is the fraction of a tick that has elapsed', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(TICK * 1000 * 0.4);
      expect(clock.alpha).toBeCloseTo(0.4, 6);
    });

    it('is zero while behind, rather than interpolating past a tick', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      clock.advance(400);
      expect(clock.hasTick()).toBe(true);
      expect(clock.alpha).toBe(0);
    });

    it('stays within [0, 1)', () => {
      const clock = new SimClock(OPTIONS);
      clock.advance(0);
      for (let t = 7; t < 5000; t += 7) {
        clock.advance(t);
        drain(clock);
        expect(clock.alpha).toBeGreaterThanOrEqual(0);
        expect(clock.alpha).toBeLessThan(1);
      }
    });
  });
});
