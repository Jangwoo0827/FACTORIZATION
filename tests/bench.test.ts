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

    const start = performance.now();
    const rebuilds = 50;
    for (let i = 0; i < rebuilds; i++) {
      // Any world change invalidates the derived structures.
      world.place('conveyor', 63, 60 + (i % 3), 0);
      world.removeAt(63, 60 + (i % 3));
      sim.step();
    }
    const perRebuild = (performance.now() - start) / rebuilds;

    console.info(`[bench] full rebuild + step on 5,000 belts: ${perRebuild.toFixed(3)} ms`);
    expect(perRebuild).toBeLessThan(10);
  });
});
