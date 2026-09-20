import { describe, expect, it } from 'vitest';
import { HUB_STOCK_CAP } from '../src/config';
import { Sieve } from '../src/sim/sieve';
import { Ore } from '../src/sim/types';

describe('Sieve', () => {
  it('adds every received item to both stock and the delivered total', () => {
    const sieve = new Sieve();
    for (let i = 0; i < 7; i++) sieve.receive(Ore.Iron);
    sieve.receive(Ore.Copper);

    expect(sieve.stock[Ore.Iron]).toBe(7);
    expect(sieve.delivered[Ore.Iron]).toBe(7);
    expect(sieve.stock[Ore.Copper]).toBe(1);
    expect(sieve.delivered[Ore.Coal]).toBe(0);
  });

  it('never refuses an item, so a belt feeding it can never back up', () => {
    const sieve = new Sieve();
    const beyond = HUB_STOCK_CAP + 50;
    for (let i = 0; i < beyond; i++) sieve.receive(Ore.Stone);

    // Stock stops at the cap, but every item is still counted as delivered.
    expect(sieve.stock[Ore.Stone]).toBe(HUB_STOCK_CAP);
    expect(sieve.delivered[Ore.Stone]).toBe(beyond);
  });

  describe('per-minute rate', () => {
    it('reads zero before any history exists', () => {
      const sieve = new Sieve();
      sieve.receive(Ore.Iron);
      expect(sieve.perMinute(Ore.Iron)).toBe(0);
    });

    it('needs two snapshots to have measured anything', () => {
      const sieve = new Sieve();
      sieve.receive(Ore.Iron);
      sieve.recordSecond();
      expect(sieve.perMinute(Ore.Iron)).toBe(0);
    });

    it('does not jitter with deliveries that have not been recorded yet', () => {
      const sieve = new Sieve();
      for (let s = 0; s < 10; s++) {
        for (let i = 0; i < 3; i++) sieve.receive(Ore.Iron);
        sieve.recordSecond();
      }
      const steady = sieve.perMinute(Ore.Iron);

      // Part of the next second arrives; the figure must not move until it is recorded.
      sieve.receive(Ore.Iron);
      expect(sieve.perMinute(Ore.Iron)).toBe(steady);
    });

    it('uses a window of exactly one minute', () => {
      const sieve = new Sieve();
      // 2/s for two minutes, then nothing for 30 s: half the last minute was quiet.
      for (let s = 0; s < 120; s++) {
        sieve.receive(Ore.Iron);
        sieve.receive(Ore.Iron);
        sieve.recordSecond();
      }
      for (let s = 0; s < 30; s++) sieve.recordSecond();
      expect(sieve.perMinute(Ore.Iron)).toBeCloseTo(60, 6);
    });

    it('measures the recent delivery rate', () => {
      const sieve = new Sieve();
      // 3 items every second for 10 seconds.
      for (let s = 0; s < 10; s++) {
        for (let i = 0; i < 3; i++) sieve.receive(Ore.Iron);
        sieve.recordSecond();
      }
      expect(sieve.perMinute(Ore.Iron)).toBeCloseTo(180, 6);
    });

    it('forgets deliveries older than a minute', () => {
      const sieve = new Sieve();
      // A burst, then two quiet minutes.
      for (let i = 0; i < 600; i++) sieve.receive(Ore.Iron);
      sieve.recordSecond();
      for (let s = 0; s < 120; s++) sieve.recordSecond();

      expect(sieve.perMinute(Ore.Iron)).toBe(0);
    });

    it('is per item', () => {
      const sieve = new Sieve();
      for (let s = 0; s < 20; s++) {
        sieve.receive(Ore.Iron);
        sieve.recordSecond();
      }
      expect(sieve.perMinute(Ore.Iron)).toBeGreaterThan(0);
      expect(sieve.perMinute(Ore.Copper)).toBe(0);
    });
  });
});
