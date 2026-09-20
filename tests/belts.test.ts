import { describe, expect, it } from 'vitest';
import { opposite } from '../src/core/dir';
import { SLOTS, SPACING, STRAIGHT } from '../src/sim/belts';
import { buildRings, createBenchWorld, fillBelts } from '../src/sim/bench';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import { allItems, belt, makeWorld, place, run, stepN, tileOf, violations } from './helpers';

const IRON = Ore.Iron;
const COPPER = Ore.Copper;

/** Distance travelled along a straight east-west line, in tiles from its first tile. */
function distanceAlong(sim: Simulation, firstTile: number): number {
  const items = allItems(sim.belts);
  expect(items).toHaveLength(1);
  return items[0]!.tile - firstTile + items[0]!.p;
}

describe('belt movement', () => {
  it('carries an item at 1.5 tiles per second', () => {
    const world = makeWorld();
    run(world, 0, 5, 12, 0);
    const sim = new Simulation(world);
    sim.sync();

    sim.belts.debugPush(tileOf(world, 0, 5), IRON, 0);
    stepN(sim, 30); // one second

    expect(distanceAlong(sim, tileOf(world, 0, 5))).toBeCloseTo(1.5, 2);
  });

  it('carries the overshoot across a tile boundary instead of losing it', () => {
    const world = makeWorld();
    run(world, 0, 5, 12, 0);
    const sim = new Simulation(world);
    sim.sync();

    sim.belts.debugPush(tileOf(world, 0, 5), IRON, 0);
    // Two seconds is exactly three tiles. If each hop dropped its overshoot the
    // item would fall measurably short.
    stepN(sim, 60);

    expect(distanceAlong(sim, tileOf(world, 0, 5))).toBeCloseTo(3.0, 2);
  });

  it('stops at the end of a belt that leads nowhere', () => {
    const world = makeWorld();
    run(world, 0, 5, 3, 0);
    const sim = new Simulation(world);
    sim.sync();

    sim.belts.debugPush(tileOf(world, 0, 5), IRON, 0);
    stepN(sim, 300);

    const [only] = allItems(sim.belts);
    expect(only!.tile).toBe(tileOf(world, 2, 5));
    expect(only!.p).toBeCloseTo(1, 4);
  });

  it('does not exchange items between two belts facing each other', () => {
    const world = makeWorld();
    belt(world, 4, 4, 0);
    belt(world, 5, 4, 2);
    const sim = new Simulation(world);
    sim.sync();

    sim.belts.debugPush(tileOf(world, 4, 4), IRON, 0);
    stepN(sim, 120);

    const [only] = allItems(sim.belts);
    expect(only!.tile).toBe(tileOf(world, 4, 4));
    expect(only!.p).toBeCloseTo(1, 4);
  });
});

describe('jams', () => {
  it('compresses a blocked line to four items per tile, spaced 0.25 apart', () => {
    const world = makeWorld();
    run(world, 0, 5, 3, 0);
    const sim = new Simulation(world);
    sim.sync();
    const start = tileOf(world, 0, 5);

    let accepted = 0;
    for (let t = 0; t < 900; t++) {
      if (sim.belts.tryEnter(start, IRON, STRAIGHT)) accepted++;
      sim.step();
      expect(violations(sim.belts)).toEqual([]);
    }

    expect(accepted).toBe(3 * SLOTS);
    // The last tile is full and packed against its exit edge.
    const last = tileOf(world, 2, 5);
    expect(sim.belts.count[last]).toBe(SLOTS);
    expect(sim.belts.pos[last * SLOTS]).toBeCloseTo(1, 3);
    expect(sim.belts.pos[last * SLOTS + 3]).toBeCloseTo(1 - 3 * SPACING, 3);
  });

  it('clears from the front, so a released jam flows at full rate at once', () => {
    // A blocked line is packed solid. Opening the exit should let items leave one
    // per 1/6 s straight away, which only happens if the front-to-back update order
    // frees each slot for the item behind it within the same tick.
    const world = makeWorld();
    run(world, 0, 5, 10, 0);
    const sim = new Simulation(world);
    sim.sync();
    const start = tileOf(world, 0, 5);

    for (let t = 0; t < 900; t++) {
      sim.belts.tryEnter(start, IRON, STRAIGHT);
      sim.step();
    }
    const packed = sim.belts.totalItems();
    expect(packed).toBe(10 * SLOTS);

    // Open the exit by dropping a hub at the end of the line.
    place(world, 'hub', 10, 4);
    stepN(sim, 30 * 10);

    // Delivered is roughly 6/s from the first tick: 10 s should clear 40 items
    // (which takes ~6.7 s at 6/s plus the ~1.7 s the tail needs to reach the hub).
    expect(sim.sieve.delivered[IRON]).toBe(packed);
    expect(sim.belts.totalItems()).toBe(0);
  });
});

describe('throughput', () => {
  it('delivers 6 items per second on a saturated Mk1 belt', () => {
    const world = makeWorld(48);
    const length = 12;
    run(world, 0, 6, length, 0);
    place(world, 'hub', length, 5);
    const sim = new Simulation(world);
    sim.sync();
    const start = tileOf(world, 0, 6);

    // Saturate the belt from the source and warm up for longer than an item takes to
    // cross it (12 tiles at 1.5/s = 8 s), or the window would catch the belt still
    // filling and read low.
    for (let t = 0; t < 30 * 15; t++) {
      sim.belts.tryEnter(start, IRON, STRAIGHT);
      sim.step();
    }
    const before = sim.sieve.delivered[IRON]!;
    for (let t = 0; t < 30 * 20; t++) {
      sim.belts.tryEnter(start, IRON, STRAIGHT);
      sim.step();
    }
    const perSecond = (sim.sieve.delivered[IRON]! - before) / 20;

    expect(perSecond).toBeGreaterThan(5.7);
    expect(perSecond).toBeLessThan(6.3);
  });

  it('never breaks the spacing or capacity rules while saturated', () => {
    const world = makeWorld(48);
    run(world, 0, 6, 30, 0);
    place(world, 'hub', 30, 5);
    const sim = new Simulation(world);
    sim.sync();
    const start = tileOf(world, 0, 6);

    for (let t = 0; t < 30 * 20; t++) {
      sim.belts.tryEnter(start, IRON, STRAIGHT);
      sim.step();
      const problems = violations(sim.belts);
      if (problems.length > 0) throw new Error(`tick ${t}: ${problems.slice(0, 3).join('; ')}`);
    }
  });
});

describe('turns and merges', () => {
  it('turns a corner and enters the new belt from its side', () => {
    const world = makeWorld();
    run(world, 0, 0, 3, 0); //  (0,0) (1,0) (2,0) heading east
    run(world, 3, 0, 3, 1); //  (3,0) (3,1) (3,2) heading south, fed from the west side
    place(world, 'hub', 3, 3);
    const sim = new Simulation(world);
    sim.sync();

    sim.belts.debugPush(tileOf(world, 0, 0), IRON, 0);

    // Watch for the item arriving on the corner tile and check how it got in.
    const corner = tileOf(world, 3, 0);
    let sawCorner = false;
    for (let t = 0; t < 300 && !sawCorner; t++) {
      sim.step();
      if (sim.belts.count[corner] === 1) {
        sawCorner = true;
        // Came in from the west, i.e. the direction opposite to the way it was moving.
        expect(sim.belts.lat[corner * SLOTS]).toBe(opposite(0));
      }
    }
    expect(sawCorner).toBe(true);

    stepN(sim, 300);
    expect(sim.sieve.delivered[IRON]).toBe(1);
    expect(sim.belts.totalItems()).toBe(0);
  });

  it('gives a straight feeder priority and lets a side feeder fill the gaps', () => {
    // Main line east along y=6 into the hub. A side belt drops in at x=10.
    const world = makeWorld(48);
    run(world, 0, 6, 12, 0);
    run(world, 6, 9, 3, 3); // heading north (-y) into (6,6) from the south
    place(world, 'hub', 12, 5);
    const sim = new Simulation(world);
    sim.sync();
    const main = tileOf(world, 0, 6);
    const side = tileOf(world, 6, 9);

    // Straight feeder supplies iron at half capacity (every 10 ticks = 3/s); the
    // side feeder is saturated with copper and wants every gap it can get.
    const drive = (ticks: number): void => {
      for (let t = 0; t < ticks; t++) {
        if (sim.tick % 10 === 0) sim.belts.tryEnter(main, IRON, STRAIGHT);
        sim.belts.tryEnter(side, COPPER, STRAIGHT);
        sim.step();
        const problems = violations(sim.belts);
        if (problems.length > 0) {
          throw new Error(`tick ${sim.tick}: ${problems.slice(0, 3).join('; ')}`);
        }
      }
    };

    // Warm past the 8 s transit, then measure a window in steady state.
    drive(30 * 20);
    const iron0 = sim.sieve.delivered[IRON]!;
    const copper0 = sim.sieve.delivered[COPPER]!;
    drive(30 * 20);
    const iron = (sim.sieve.delivered[IRON]! - iron0) / 20;
    const copper = (sim.sieve.delivered[COPPER]! - copper0) / 20;

    // The straight feeder is never starved by the side one...
    expect(iron).toBeGreaterThan(2.9);
    expect(iron).toBeLessThan(3.1);
    // ...the side feeder still gets through in the gaps...
    expect(copper).toBeGreaterThan(1);
    // ...and together they never exceed what one belt can carry.
    expect(iron + copper).toBeLessThan(6.3);
  });
});

describe('update order', () => {
  it('steps every belt after the belt it feeds', () => {
    const world = makeWorld(48);
    run(world, 0, 6, 30, 0);
    run(world, 10, 9, 3, 3);
    run(world, 20, 2, 4, 1);
    const sim = new Simulation(world);
    sim.sync();

    const order = [...sim.belts.orderedTiles()];
    const at = new Map(order.map((tile, i) => [tile, i]));

    // Every belt's downstream neighbour must appear earlier in the order.
    for (const tile of order) {
      const d = sim.belts.dir[tile]!;
      const x = tile % world.size;
      const y = (tile - x) / world.size;
      const dx = [1, 0, -1, 0][d]!;
      const dy = [0, 1, 0, -1][d]!;
      const next = (y + dy) * world.size + (x + dx);
      if (sim.belts.dir[next]! < 0 || sim.belts.dir[next] === opposite(d)) continue;
      expect(at.get(next)!).toBeLessThan(at.get(tile)!);
    }
  });

  it('includes belts on a closed loop', () => {
    const world = makeWorld();
    belt(world, 5, 5, 0);
    belt(world, 6, 5, 1);
    belt(world, 6, 6, 2);
    belt(world, 5, 6, 3);
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.belts.orderedTiles()).toHaveLength(4);
  });
});

describe('loops', () => {
  it('conserve every item while circulating', () => {
    const world = createBenchWorld(64);
    const belts = buildRings(world, 600);
    expect(belts).toBeGreaterThanOrEqual(600);

    const sim = new Simulation(world);
    const filled = fillBelts(sim, 2);
    expect(sim.belts.totalItems()).toBe(filled);

    for (let t = 0; t < 600; t++) {
      sim.step();
      if (t % 50 === 0) expect(violations(sim.belts, false)).toEqual([]);
    }

    expect(sim.belts.totalItems()).toBe(filled);
    // Nothing on a loop is ever delivered.
    expect(sim.sieve.delivered[IRON]).toBe(0);
  });

  it('keep items moving rather than freezing', () => {
    const world = createBenchWorld(64);
    buildRings(world, 200);
    const sim = new Simulation(world);
    fillBelts(sim, 1);

    const snapshot = (): string => allItems(sim.belts).map((i) => `${i.tile}:${i.p.toFixed(3)}`).join(',');
    const before = snapshot();
    stepN(sim, 45);
    expect(snapshot()).not.toBe(before);
  });
});

describe('editing a running factory', () => {
  it('picks up a belt placed after the simulation started', () => {
    const world = makeWorld();
    const sim = new Simulation(world);
    stepN(sim, 5);

    belt(world, 3, 3, 0);
    sim.step();

    expect(sim.belts.isBelt(tileOf(world, 3, 3))).toBe(true);
  });

  it('discards the items on a belt that is removed', () => {
    const world = makeWorld();
    run(world, 0, 5, 4, 0);
    const sim = new Simulation(world);
    sim.sync();
    sim.belts.debugPush(tileOf(world, 1, 5), IRON, 0.5);
    expect(sim.belts.totalItems()).toBe(1);

    world.removeAt(1, 5);
    sim.step();

    expect(sim.belts.totalItems()).toBe(0);
    expect(sim.belts.isBelt(tileOf(world, 1, 5))).toBe(false);
  });

  it('keeps the items on a belt that was rebuilt by undo with the same id', () => {
    const world = makeWorld();
    run(world, 0, 5, 4, 0);
    const sim = new Simulation(world);
    sim.sync();
    sim.belts.debugPush(tileOf(world, 1, 5), IRON, 0.5);

    // Removed and restored between two ticks: the simulation never sees it missing.
    const removed = world.removeAt(1, 5)!;
    world.insert(removed);
    sim.step();

    expect(sim.belts.totalItems()).toBe(1);
  });

  it('follows a rebuilt belt to its new direction', () => {
    const world = makeWorld();
    belt(world, 5, 5, 0);
    const sim = new Simulation(world);
    sim.sync();
    expect(sim.belts.dir[tileOf(world, 5, 5)]).toBe(0);

    world.removeAt(5, 5);
    belt(world, 5, 5, 2);
    sim.step();

    expect(sim.belts.dir[tileOf(world, 5, 5)]).toBe(2);
  });
});
