/**
 * The M1 benchmark: the simulation budget from GDD 14.5 at full scale.
 *
 * The threshold is the GDD's own 10 ms tick budget. It is loose on purpose — a
 * test that fails on a busy machine teaches people to ignore it — so this guards
 * against an order-of-magnitude regression, not against noise.
 */

import { describe, expect, it } from 'vitest';
import { violations } from './helpers';
import { buildRings, createBenchWorld, fillBelts } from '../src/sim/bench';
import { Simulation } from '../src/sim/simulation';

describe('benchmark scene', () => {
  it('steps 5,000 belts and 10,000 items inside the tick budget', () => {
    const world = createBenchWorld(128);
    const belts = buildRings(world, 5000);
    const sim = new Simulation(world);
    const items = fillBelts(sim, 2);

    expect(belts).toBeGreaterThanOrEqual(5000);
    expect(items).toBeGreaterThanOrEqual(10000);

    // Warm up so the JIT is not part of what is measured.
    for (let i = 0; i < 60; i++) sim.step();

    const ticks = 300;
    const start = performance.now();
    for (let i = 0; i < ticks; i++) sim.step();
    const perTick = (performance.now() - start) / ticks;

    console.info(
      `[bench] ${belts} belts, ${items} items: ${perTick.toFixed(3)} ms/tick ` +
        `(budget 10 ms, ${((perTick / 10) * 100).toFixed(1)}% used)`,
    );

    expect(perTick).toBeLessThan(10);
    // The scene is still intact and still legal after all that stepping.
    expect(sim.belts.totalItems()).toBe(items);
    expect(violations(sim.belts, false)).toEqual([]);
  });

  it('rebuilds after an edit fast enough to do it every frame during a drag', () => {
    const world = createBenchWorld(128);
    buildRings(world, 5000);
    const sim = new Simulation(world);
    sim.sync();

    const rebuild = (i: number): number => {
      const start = performance.now();
      // Any world change invalidates the derived structures.
      world.place('conveyor', 63, 60 + (i % 3), 0);
      world.removeAt(63, 60 + (i % 3));
      sim.step();
      return performance.now() - start;
    };

    const plainTick = (): number => {
      const start = performance.now();
      sim.step();
      return performance.now() - start;
    };
    const median = (xs: number[]): number => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

    // Warm up first, as the tick benchmark does, so JIT compilation is not measured.
    for (let i = 0; i < 10; i++) {
      rebuild(i);
      plainTick();
    }
    // Interleaved, so both see the same machine load, and medians so a few samples that
    // lose the CPU to another test file do not decide the result.
    const rebuilds: number[] = [];
    const ticks: number[] = [];
    for (let i = 0; i < 50; i++) {
      rebuilds.push(rebuild(i));
      ticks.push(plainTick());
    }
    const perRebuild = median(rebuilds);
    const perTick = median(ticks);

    console.info(
      `[bench] full rebuild + step on 5,000 belts: ${perRebuild.toFixed(3)} ms ` +
        `(${(perRebuild / perTick).toFixed(1)}x a plain tick)`,
    );
    // The whole suite runs in parallel across every core, so an absolute time measured
    // here can be several times what the game sees. The budget is therefore checked
    // against the plain tick measured alongside it, which slows by the same factor: a
    // real regression grows the ratio, contention does not. Alone this reads about 5x;
    // the GDD's 10 ms stays as a floor for a quiet machine.
    expect(perRebuild).toBeLessThan(Math.max(10, 25 * perTick));
  });
});
