import { describe, expect, it } from 'vitest';
import { MINER_BUFFER } from '../src/config';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { belt, makeWorld, place, run, stepN, tileOf } from './helpers';

const SECOND = 30;

/** Paints an ore over a rectangle of tiles. */
function paint(world: World, ore: Ore, x: number, y: number, w: number, h: number): void {
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) world.setOre(tx, ty, ore);
}

/** Every item a miner has made: delivered, still on belts, or waiting in its buffer. */
function produced(sim: Simulation, minerId: number): number {
  const stored = sim.miners.info(minerId)?.stored ?? 0;
  let delivered = 0;
  for (let i = 0; i < sim.sieve.delivered.length; i++) delivered += sim.sieve.delivered[i]!;
  return delivered + sim.belts.totalItems() + stored;
}

/** A miner at (2,2) with a belt east to a hub, on whatever ore the caller painted. */
function outpost(world: World): number {
  const id = place(world, 'miner', 2, 2);
  run(world, 4, 2, 10, 0);
  place(world, 'hub', 14, 1);
  return id;
}

describe('miner output rate', () => {
  it.each([
    [4, 0.5],
    [3, 0.375],
    [2, 0.25],
    [1, 0.125],
  ])('makes ore at 0.125/s per covered tile — %i tiles gives %f/s', (tiles, perSecond) => {
    const world = makeWorld();
    const cells: [number, number][] = [
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ];
    for (const [x, y] of cells.slice(0, tiles)) world.setOre(x, y, Ore.Iron);
    const id = outpost(world);
    const sim = new Simulation(world);

    expect(sim.miners.info(id)).toBeNull(); // nothing derived until the first step
    sim.step();
    expect(sim.miners.info(id)!.rate).toBeCloseTo(perSecond, 6);

    stepN(sim, 40 * SECOND);
    // Allow one item of slack for where in the production cycle the run ended.
    expect(Math.abs(produced(sim, id) - perSecond * 40)).toBeLessThan(1.5);
  });

  it('delivers what it mines all the way to the hub', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = outpost(world);
    const sim = new Simulation(world);

    stepN(sim, 60 * SECOND);

    // 0.5/s for 60 s is 30 items; a few are always still in transit or in the buffer.
    expect(sim.sieve.delivered[Ore.Iron]).toBeGreaterThan(25);
    expect(produced(sim, id)).toBeGreaterThanOrEqual(29);
  });
});

describe('what a miner mines', () => {
  it('takes the ore that covers most of its footprint and ignores the rest', () => {
    const world = makeWorld();
    paint(world, Ore.Copper, 2, 2, 2, 2);
    world.setOre(3, 3, Ore.Iron); // 3 copper, 1 iron
    const id = outpost(world);
    const sim = new Simulation(world);
    sim.step();

    const info = sim.miners.info(id)!;
    expect(info.item).toBe(Ore.Copper);
    expect(info.oreTiles).toBe(3);
    expect(info.rate).toBeCloseTo(0.375, 6);
  });

  it('breaks a tie toward the lower ore id, deterministically', () => {
    const world = makeWorld();
    world.setOre(2, 2, Ore.Coal);
    world.setOre(3, 2, Ore.Coal);
    world.setOre(2, 3, Ore.Copper);
    world.setOre(3, 3, Ore.Copper);
    const id = outpost(world);
    const sim = new Simulation(world);
    sim.step();

    expect(sim.miners.info(id)!.item).toBe(Ore.Copper);
  });

  it('is not simulated at all if placed without ore, which placement rules prevent', () => {
    const world = makeWorld();
    // needsOre is enforced by the world; a miner cannot be placed on bare ground.
    expect(world.place('miner', 2, 2, 0)).toBeNull();
    const sim = new Simulation(world);
    sim.step();
    expect(sim.miners.count).toBe(0);
  });
});

describe('where a miner puts its ore', () => {
  it('will not drop onto a belt that points back into it', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    belt(world, 4, 2, 2); // faces west, straight at the miner
    const sim = new Simulation(world);

    stepN(sim, 30 * SECOND);

    expect(sim.miners.info(id)!.outputs).toHaveLength(0);
    expect(sim.belts.totalItems()).toBe(0);
    expect(sim.miners.info(id)!.stored).toBe(MINER_BUFFER);
  });

  it('accepts a belt running alongside it, entering from the side', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    belt(world, 4, 2, 1); // beside the miner, carrying south
    const sim = new Simulation(world);
    sim.step();

    const [out] = sim.miners.info(id)!.outputs;
    expect(out!.tile).toBe(tileOf(world, 4, 2));
    // Entering a south-facing belt from its west side: not straight through.
    expect(out!.lat).toBe(2);
  });

  it('enters a belt that carries away from it straight through the back', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    belt(world, 4, 2, 0); // directly east of the miner, carrying east
    const sim = new Simulation(world);
    sim.step();

    const [out] = sim.miners.info(id)!.outputs;
    expect(out!.lat).toBe(4);
  });

  it('shares its output evenly between two belts', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    // Two dead-end belts, each holding at most four items, so nothing drains.
    belt(world, 4, 2, 0);
    belt(world, 4, 3, 0);
    const sim = new Simulation(world);

    // 0.5/s: the first four items arrive within 8 s, two per belt if shared evenly.
    stepN(sim, 8 * SECOND + 5);

    const a = sim.belts.count[tileOf(world, 4, 2)]!;
    const b = sim.belts.count[tileOf(world, 4, 3)]!;
    expect(a + b).toBe(4);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
    expect(sim.miners.info(id)!.outputs).toHaveLength(2);
  });

  it('skips a full belt and uses the other', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    place(world, 'miner', 2, 2);
    belt(world, 4, 2, 0); // dead end: fills to four and stays full
    run(world, 4, 3, 8, 0);
    place(world, 'hub', 12, 2);
    const sim = new Simulation(world);

    stepN(sim, 60 * SECOND);

    expect(sim.belts.count[tileOf(world, 4, 2)]).toBe(4);
    // The open belt kept flowing to the hub the whole time.
    expect(sim.sieve.delivered[Ore.Iron]).toBeGreaterThan(10);
  });
});

describe('a blocked miner', () => {
  it('stops at its buffer size instead of producing without limit', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2); // no belt at all
    const sim = new Simulation(world);

    stepN(sim, 5 * 60 * SECOND);

    expect(sim.miners.info(id)!.stored).toBe(MINER_BUFFER);
    expect(sim.miners.info(id)!.progress).toBe(0);
  });

  it('does not bank production while blocked, then resume at its normal rate', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    const sim = new Simulation(world);

    stepN(sim, 10 * 60 * SECOND); // blocked for ten minutes
    run(world, 4, 2, 10, 0);
    place(world, 'hub', 14, 1);

    stepN(sim, 30 * SECOND);
    // Buffer of 5 plus 30 s at 0.5/s: not ten minutes' worth of backlog.
    expect(produced(sim, id)).toBeLessThanOrEqual(MINER_BUFFER + 15 + 1);
  });
});

describe('editing around a working miner', () => {
  it('keeps the miner\'s buffer when a belt is added beside it', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    const sim = new Simulation(world);
    stepN(sim, 30 * SECOND);
    const before = sim.miners.info(id)!.stored;
    expect(before).toBe(MINER_BUFFER);

    belt(world, 8, 8, 0); // unrelated edit forces a rebuild
    sim.step();

    // Rebuilding must not reset what the miner was holding.
    expect(sim.miners.info(id)!.stored).toBeGreaterThanOrEqual(before - 1);
  });

  it('stops tracking a miner that was removed', () => {
    const world = makeWorld();
    paint(world, Ore.Iron, 2, 2, 2, 2);
    const id = place(world, 'miner', 2, 2);
    const sim = new Simulation(world);
    sim.step();
    expect(sim.miners.count).toBe(1);

    world.removeById(id);
    sim.step();

    expect(sim.miners.count).toBe(0);
    expect(sim.miners.info(id)).toBeNull();
  });
});
