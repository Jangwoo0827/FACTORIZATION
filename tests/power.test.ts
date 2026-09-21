import { describe, expect, it } from 'vitest';
import { GENERATOR_FUEL_BUFFER, SIM_TPS } from '../src/config';
import { Item } from '../src/data/items';
import { POWER_FULL } from '../src/sim/power';
import { STRAIGHT } from '../src/sim/belts';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import { makeWorld, place, run, stepN, tileOf } from './helpers';

const SECOND = SIM_TPS;

/** Ticks one Mk2 smelter craft takes: 1.6 s at double speed. */
const CRAFT_TICKS = 24;

/** Keeps a generator topped up, the way a coal belt would, for as long as a test runs. */
function fuelled(sim: Simulation, generator: number, ticks: number, each?: () => void): void {
  for (let t = 0; t < ticks; t++) {
    sim.power.accept(generator, Item.Coal);
    sim.step();
    each?.();
  }
}

/** Every plate a smelter has made: delivered, still on a belt, or waiting in its output. */
function platesMade(sim: Simulation, smelter: number): number {
  return sim.sieve.delivered[Item.IronPlate]! + sim.belts.totalItems() + sim.machines.info(smelter)!.output;
}

/**
 * A Mk2 smelter making iron plates, feeding a hub, with a pole beside it and a
 * generator beside the pole:
 *
 *   feed (x 2..9, y 6) -> smelter (10,6) -> output (x 12..19, y 6) -> hub (20,5)
 *   pole (12,8), generator (14,8)
 */
function powered(defId = 'smelter-mk2') {
  const world = makeWorld(48);
  run(world, 2, 6, 8, 0);
  const smelter = place(world, defId, 10, 6);
  run(world, 12, 6, 8, 0);
  place(world, 'hub', 20, 5);
  const pole = place(world, 'pole', 12, 8);
  const generator = place(world, 'generator', 14, 8);
  world.setRecipe(smelter, Item.IronPlate);
  const sim = new Simulation(world);
  sim.sync();
  return { world, sim, smelter, pole, generator };
}

describe('power grids', () => {
  it('connects a building to a pole within reach and not beyond it', () => {
    const world = makeWorld(64);
    place(world, 'pole', 20, 20);
    const near = place(world, 'smelter-mk2', 25, 20); // its nearest tile is 5 away
    const far = place(world, 'smelter-mk2', 27, 30); // 7 away
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.infoOf(near)!.connected).toBe(true);
    expect(sim.power.infoOf(far)!.connected).toBe(false);
  });

  it('measures reach to the nearest tile of a large building, not its corner', () => {
    const world = makeWorld(64);
    place(world, 'pole', 20, 20);
    // A 3x3 assembler whose near edge is exactly 5 away connects; one tile further does not.
    const edge = place(world, 'assembler-mk2', 25, 20);
    const beyond = place(world, 'assembler-mk2', 26, 26);
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.infoOf(edge)!.connected).toBe(true);
    expect(sim.power.infoOf(beyond)!.connected).toBe(false);
  });

  it('reaches a diagonal corner by the same distance as straight along an axis', () => {
    const world = makeWorld(64);
    place(world, 'pole', 20, 20);
    const diagonal = place(world, 'smelter-mk2', 25, 25);
    const sim = new Simulation(world);
    sim.sync();

    // 5 across and 5 down: reach is square, so this is still in.
    expect(sim.power.infoOf(diagonal)!.connected).toBe(true);
  });

  it('joins poles within reach of each other into one grid, and chains of them', () => {
    const world = makeWorld(64);
    place(world, 'pole', 10, 10);
    place(world, 'pole', 15, 10); // 5 from the first
    place(world, 'pole', 20, 10); // 5 from the second, 10 from the first
    place(world, 'pole', 40, 40); // on its own
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.gridList).toHaveLength(2);
    expect(sim.power.gridList[0]!.poles).toHaveLength(3);
    expect(sim.power.gridList[1]!.poles).toHaveLength(1);
  });

  it('wires a long pole to a short one only across the shorter reach', () => {
    const world = makeWorld(64);
    place(world, 'pole-long', 10, 10);
    place(world, 'pole', 18, 10); // 8 away: inside the long pole's 12, outside the short one's 5
    const sim = new Simulation(world);
    sim.sync();
    expect(sim.power.gridList).toHaveLength(2);

    place(world, 'pole', 14, 10); // 4 from each, so it bridges them
    sim.sync();
    expect(sim.power.gridList).toHaveLength(1);
  });

  it('gives a long pole a reach of twelve to what it powers', () => {
    const world = makeWorld(64);
    place(world, 'pole-long', 10, 10);
    const inside = place(world, 'smelter-mk2', 22, 10); // nearest tile is 12 away
    const outside = place(world, 'smelter-mk2', 24, 20);
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.infoOf(inside)!.connected).toBe(true);
    expect(sim.power.infoOf(outside)!.connected).toBe(false);
  });

  it('puts a building in reach of two grids on the nearer one', () => {
    const world = makeWorld(64);
    const west = place(world, 'pole', 10, 20);
    const east = place(world, 'pole', 18, 20); // 8 apart: separate grids
    const nearWest = place(world, 'smelter-mk2', 12, 20); // 2 from west, 5 from east
    const nearEast = place(world, 'smelter-mk2', 15, 20); // 5 from west, 2 from east
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.infoOf(nearWest)!.grid).toBe(sim.power.gridOfPole(west)!.index);
    expect(sim.power.infoOf(nearEast)!.grid).toBe(sim.power.gridOfPole(east)!.index);
  });

  it('breaks a tie between two grids toward the lower pole id, wherever that pole stands', () => {
    // A 3x3 assembler at x 14..16 is exactly 4 from a pole at x=10 and 4 from one at x=20.
    for (const lowerOnWest of [true, false]) {
      const world = makeWorld(64);
      const first = place(world, 'pole', lowerOnWest ? 10 : 20, 20);
      place(world, 'pole', lowerOnWest ? 20 : 10, 20);
      const middle = place(world, 'assembler-mk2', 14, 20);
      const sim = new Simulation(world);
      sim.sync();

      expect(sim.power.gridList).toHaveLength(2);
      expect(sim.power.infoOf(middle)!.grid).toBe(sim.power.gridOfPole(first)!.index);
    }
  });

  it('comes out the same whichever order the world lists its buildings in', () => {
    const world = makeWorld(64);
    const a = place(world, 'pole', 10, 10);
    place(world, 'pole', 40, 10);
    const c = place(world, 'smelter-mk2', 13, 10);
    const sim = new Simulation(world);
    sim.sync();
    const shape = () => JSON.stringify(sim.power.gridList.map((g) => [g.poles, g.demand]));
    const before = shape();

    // Undo re-inserts a building at the end of the world's list.
    world.insert(world.removeById(a)!);
    sim.sync();

    expect(shape()).toBe(before);
    expect(sim.power.infoOf(c)!.connected).toBe(true);
  });

  it('draws a wire from a pole to each thing it feeds', () => {
    const { sim } = powered();
    // pole -> smelter and pole -> generator. There is only one pole, so no pole-to-pole wire.
    expect(sim.power.wires).toHaveLength(2);
  });

  it('loses power to a machine when its pole is removed, and gets it back with the pole', () => {
    const { world, sim, smelter, pole, generator } = powered();
    fuelled(sim, generator, 10);
    expect(sim.machines.info(smelter)!.level).toBe(POWER_FULL);

    const removed = world.removeById(pole)!;
    fuelled(sim, generator, 10);
    expect(sim.machines.info(smelter)!.level).toBe(0);

    world.insert(removed);
    fuelled(sim, generator, 10);
    expect(sim.machines.info(smelter)!.level).toBe(POWER_FULL);
  });
});

describe('a generator', () => {
  it('burns one fuel item per burn time, exactly, with no gap while it is fed', () => {
    const { sim, generator } = powered();
    const burnt: number[] = [];
    sim.power.onFuelBurnt = (item) => burnt.push(item);

    let producing = 0;
    // Six seconds of coal is 180 ticks, so ten of them is 1800.
    fuelled(sim, generator, 10 * 6 * SECOND, () => {
      if (sim.power.generator(generator)!.burning) producing++;
    });

    expect(burnt).toHaveLength(10);
    expect(burnt.every((item) => item === Item.Coal)).toBe(true);
    expect(producing).toBe(10 * 6 * SECOND);
  });

  it('takes only its fuel, and only up to its buffer', () => {
    const { sim, generator } = powered();

    expect(sim.power.accept(generator, Item.IronOre)).toBe(false);
    expect(sim.power.accept(generator, Item.IronPlate)).toBe(false);

    let taken = 0;
    for (let i = 0; i < 10; i++) if (sim.power.accept(generator, Item.Coal)) taken++;
    expect(taken).toBe(GENERATOR_FUEL_BUFFER);
  });

  it('gives power for exactly the burn time of one item, then stops', () => {
    const { sim, generator } = powered();
    sim.power.accept(generator, Item.Coal);

    stepN(sim, 180);
    expect(sim.power.summary().supply).toBe(10);
    stepN(sim, 1);
    expect(sim.power.summary().supply).toBe(0);
    expect(sim.power.generator(generator)!.burning).toBe(false);
  });

  it('gives nothing to a grid it is not wired to, even while burning', () => {
    const world = makeWorld(48);
    const generator = place(world, 'generator', 30, 30);
    place(world, 'pole', 5, 5);
    const smelter = place(world, 'smelter-mk2', 7, 5);
    const sim = new Simulation(world);
    sim.sync();

    fuelled(sim, generator, 30);
    expect(sim.power.generator(generator)!.burning).toBe(true);
    expect(sim.power.infoOf(generator)!.connected).toBe(false);
    expect(sim.power.levelOf(smelter)).toBe(0);
  });

  it('accounts for every fuel item it was given', () => {
    const { sim, generator } = powered();
    let burnt = 0;
    sim.power.onFuelBurnt = () => burnt++;

    let given = 0;
    for (let t = 0; t < 1000; t++) {
      if (sim.power.accept(generator, Item.Coal)) given++;
      sim.step();
    }
    // Every coal is either used up, being burnt right now, or waiting in the buffer.
    expect(given).toBe(burnt + sim.power.generator(generator)!.stored);
  });

  it('is fed by a belt, and a belt of anything else jams at its door', () => {
    const build = () => {
      const world = makeWorld(48);
      run(world, 2, 10, 8, 0); // ends at a 2x2 generator at (10,10)
      const generator = place(world, 'generator', 10, 10);
      place(world, 'pole', 12, 12);
      const sim = new Simulation(world);
      sim.sync();
      return { sim, generator, feed: tileOf(world, 2, 10) };
    };

    // Iron ore is refused, so it waits at the end of the belt and blocks what is behind.
    const wrong = build();
    wrong.sim.belts.tryEnter(wrong.feed, Item.IronOre, STRAIGHT);
    stepN(wrong.sim, 300);
    expect(wrong.sim.power.generator(wrong.generator)!.stored).toBe(0);
    expect(wrong.sim.power.generator(wrong.generator)!.burning).toBe(false);
    expect(wrong.sim.belts.totalItems()).toBe(1);

    // Coal goes in and lights it. The belt is 8 tiles at 1.5 tiles/s, so it arrives after ~160 ticks.
    const right = build();
    right.sim.belts.tryEnter(right.feed, Item.Coal, STRAIGHT);
    stepN(right.sim, 200);
    expect(right.sim.power.generator(right.generator)!.burning).toBe(true);
    expect(right.sim.belts.totalItems()).toBe(0);
  });

  it('keeps its fuel and burn state when the map around it is edited', () => {
    const { world, sim, generator } = powered();
    sim.power.accept(generator, Item.Coal);
    sim.power.accept(generator, Item.Coal);
    stepN(sim, 60);
    const before = { ...sim.power.generator(generator)! };

    place(world, 'pole', 30, 30); // any edit makes the simulation rebuild
    sim.sync();

    const after = sim.power.generator(generator)!;
    expect(before.burnLeft).toBeGreaterThan(0);
    expect(after.stored).toBe(before.stored);
    expect(after.burnLeft).toBe(before.burnLeft);
  });
});

describe('a Mk2 machine on power', () => {
  it('runs at its tier speed: a Mk2 smelter makes a plate every 24 ticks', () => {
    const { sim, smelter, generator } = powered();
    // Ore is offered after each tick, so the first craft starts on tick 2.
    fuelled(sim, generator, 20 * SECOND, () => sim.machines.accept(smelter, Item.IronOre));

    // Crafts finish on working ticks 25, 49, 73...: 599 working ticks make 24 plates.
    expect(platesMade(sim, smelter)).toBe(Math.floor((20 * SECOND - 1 - 1) / CRAFT_TICKS));
    expect(sim.machines.info(smelter)!.level).toBe(POWER_FULL);
  });

  it('works in the very tick its generator lights, not one later', () => {
    const { sim, smelter, generator } = powered();
    sim.machines.accept(smelter, Item.IronOre);
    sim.power.accept(generator, Item.Coal);

    sim.step();
    expect(sim.machines.info(smelter)!.crafting).toBe(true);
  });

  it('does nothing without power, says so, and still takes ingredients', () => {
    const { sim, smelter } = powered();
    stepN(sim, 2 * SECOND); // the generator has no fuel

    expect(sim.machines.accept(smelter, Item.IronOre)).toBe(true);
    stepN(sim, 5 * SECOND);

    const info = sim.machines.info(smelter)!;
    expect(info.status).toBe('no-power');
    expect(info.crafting).toBe(false);
    expect(info.progress).toBe(0);
    expect(sim.sieve.delivered[Item.IronPlate]).toBe(0);
  });

  it('says it has no recipe before it says it has no power', () => {
    const { world, sim, smelter } = powered();
    world.setRecipe(smelter, 0);
    stepN(sim, 5);

    expect(sim.machines.info(smelter)!.status).toBe('no-recipe');
  });

  it('is unpowered when no pole reaches it, even with a running generator elsewhere', () => {
    const world = makeWorld(48);
    place(world, 'pole', 5, 5);
    const generator = place(world, 'generator', 7, 5);
    const stranded = place(world, 'smelter-mk2', 30, 30);
    world.setRecipe(stranded, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();

    fuelled(sim, generator, 60);
    expect(sim.machines.info(stranded)!.status).toBe('no-power');
    expect(sim.power.infoOf(stranded)!.connected).toBe(false);
  });

  it('needs no power when it is a Mk1', () => {
    const world = makeWorld(48);
    const smelter = place(world, 'smelter', 10, 6);
    world.setRecipe(smelter, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.infoOf(smelter)).toBeNull();
    expect(sim.power.levelOf(smelter)).toBe(POWER_FULL);
    sim.machines.accept(smelter, Item.IronOre);
    sim.step();
    expect(sim.machines.info(smelter)!.status).toBe('working');
  });
});

describe('brownouts', () => {
  /**
   * One generator (10 PU) and `n` Mk2 smelters at 2 PU each, so demand is 2n. The first
   * smelter makes plates into a hub; the rest only draw power.
   *
   *   pole (20,20), generator (22,20), first smelter (20,14) -> belt (22..29, 14) -> hub (30,13)
   */
  function crowded(n: number) {
    const world = makeWorld(64);
    place(world, 'pole', 20, 20);
    const generator = place(world, 'generator', 22, 20);
    const first = place(world, 'smelter-mk2', 20, 14);
    run(world, 22, 14, 8, 0);
    place(world, 'hub', 30, 13);
    const others = [
      [15, 20],
      [15, 23],
      [18, 23],
      [21, 23],
      [24, 23],
    ];
    const smelters = [first];
    for (let i = 0; i < n - 1; i++) smelters.push(place(world, 'smelter-mk2', others[i]![0]!, others[i]![1]!));
    for (const id of smelters) world.setRecipe(id, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();
    return { world, sim, generator, smelters, first };
  }

  it('meets demand in full while supply covers it', () => {
    const { sim, generator, smelters } = crowded(5); // 10 PU asked, 10 given
    fuelled(sim, generator, 10);

    expect(sim.power.summary()).toMatchObject({ supply: 10, demand: 10, level: POWER_FULL });
    for (const id of smelters) expect(sim.machines.info(id)!.level).toBe(POWER_FULL);
  });

  it('slows every machine on the grid by the same fraction when supply falls short', () => {
    const { sim, generator, smelters } = crowded(6); // 12 PU asked, 10 given: 10/12 = 833 thousandths
    fuelled(sim, generator, 10);

    expect(sim.power.summary().level).toBe(833);
    for (const id of smelters) expect(sim.machines.info(id)!.level).toBe(833);
  });

  it('does exactly floor(ticks x level) ticks of work, not an approximation', () => {
    const { sim, generator, first } = crowded(6);
    const ticks = 4800;
    fuelled(sim, generator, ticks, () => sim.machines.accept(first, Item.IronOre));

    // Ore is offered after each tick, so the first working tick is one later than
    // the first tick: work ticks = floor(4799 x 833 / 1000) = 3997, and crafts finish on
    // working ticks 25, 49, ...: floor((3997 - 1) / 24) = 166.
    expect(platesMade(sim, first)).toBe(166);
  });

  it('stops everything on a grid whose generator has run dry', () => {
    const { sim, generator, smelters } = crowded(3);
    sim.power.accept(generator, Item.Coal);
    stepN(sim, 181); // burns the one coal, then nothing

    for (const id of smelters) expect(sim.machines.info(id)!.status).toBe('no-power');
  });

  it('resumes when fuel returns, picking up the craft where it stopped', () => {
    const { sim, generator, first } = crowded(1);
    sim.machines.accept(first, Item.IronOre);
    stepN(sim, 60); // no fuel
    expect(sim.machines.info(first)!.crafting).toBe(false);

    fuelled(sim, generator, 10);
    expect(sim.machines.info(first)!.crafting).toBe(true);
    expect(sim.machines.info(first)!.status).toBe('working');
  });

  it('keeps separate grids separate: one browning out does not slow the other', () => {
    const world = makeWorld(96);
    // Grid A: one generator, six smelters (12 PU asked of 10). Grid B: one generator, one smelter.
    place(world, 'pole', 20, 20);
    const genA = place(world, 'generator', 22, 21);
    const busy: number[] = [];
    for (let i = 0; i < 6; i++) {
      busy.push(place(world, 'smelter-mk2', 14 + (i % 3) * 3, 14 + Math.floor(i / 3) * 3));
    }
    place(world, 'pole', 70, 70);
    const genB = place(world, 'generator', 72, 71);
    const alone = place(world, 'smelter-mk2', 66, 66);
    for (const id of [...busy, alone]) world.setRecipe(id, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();

    sim.power.accept(genA, Item.Coal);
    sim.power.accept(genB, Item.Coal);
    stepN(sim, 5);

    expect(sim.machines.info(busy[0]!)!.level).toBe(833);
    expect(sim.machines.info(alone)!.level).toBe(POWER_FULL);
  });

  it('does not lose the fraction of a tick when the map is edited around a slowed machine', () => {
    /** Total ticks of work a machine has done, from crafts finished and the craft under way. */
    const drive = (edit: boolean): number => {
      const { world, sim, generator, first } = crowded(6);
      let edits = 0;
      for (let t = 0; t < 900; t++) {
        sim.power.accept(generator, Item.Coal);
        sim.machines.accept(first, Item.IronOre);
        if (edit && t % 10 === 5) {
          // A fresh tile each time, so every one really changes the world and forces a rebuild.
          world.place('conveyor', 30 + (edits % 30), 40 + Math.floor(edits / 30), 0);
          edits++;
        }
        sim.step();
      }
      const info = sim.machines.info(first)!;
      return platesMade(sim, first) * CRAFT_TICKS + (info.crafting ? info.progress + 1 : 0);
    };

    expect(drive(true)).toBe(drive(false));
  });

  it('reports the worst grid on the HUD summary', () => {
    const { sim, generator } = crowded(6);
    fuelled(sim, generator, 5);

    const summary = sim.power.summary();
    expect(summary.grids).toBe(1);
    expect(summary.level).toBe(833);
  });
});

describe('a Mk2 miner', () => {
  function minerOnIron(): { sim: Simulation; miner: number; generator: number } {
    const world = makeWorld(48);
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) world.setOre(x, y, Ore.Iron);
    const miner = place(world, 'miner-mk2', 10, 10);
    run(world, 12, 10, 8, 0);
    place(world, 'hub', 20, 9);
    place(world, 'pole', 12, 12);
    const generator = place(world, 'generator', 14, 12);
    const sim = new Simulation(world);
    sim.sync();
    return { sim, miner, generator };
  }

  it('digs one ore a second from four ore tiles at full power, twice a Mk1', () => {
    const { sim, miner, generator } = minerOnIron();
    expect(sim.miners.info(miner)!.rate).toBeCloseTo(1.0, 10);

    fuelled(sim, generator, 10 * SECOND);
    const early = sim.sieve.delivered[Item.IronOre]!;
    fuelled(sim, generator, 10 * SECOND);

    // Past the belt's travel time the hub gets one a second.
    expect(sim.sieve.delivered[Item.IronOre]! - early).toBeGreaterThanOrEqual(9);
    expect(sim.sieve.delivered[Item.IronOre]! - early).toBeLessThanOrEqual(11);
    expect(sim.miners.info(miner)!.level).toBe(POWER_FULL);
  });

  it('digs nothing without power', () => {
    const { sim, miner } = minerOnIron();
    stepN(sim, 20 * SECOND);

    expect(sim.miners.info(miner)!.level).toBe(0);
    expect(sim.miners.info(miner)!.stored).toBe(0);
    expect(sim.sieve.delivered[Item.IronOre]).toBe(0);
  });

  it('digs in proportion during a brownout', () => {
    const world = makeWorld(64);
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) world.setOre(x, y, Ore.Iron);
    const miner = place(world, 'miner-mk2', 10, 10);
    run(world, 12, 10, 8, 0);
    place(world, 'hub', 20, 9);
    place(world, 'pole', 12, 12);
    const generator = place(world, 'generator', 14, 12);
    // Three more Mk2 machines that only draw power: 2 + 4 + 4 + 2 = 12 PU asked of 10.
    place(world, 'assembler-mk2', 15, 15);
    place(world, 'assembler-mk2', 12, 15);
    place(world, 'smelter-mk2', 9, 13);
    const sim = new Simulation(world);
    sim.sync();

    fuelled(sim, generator, 10 * SECOND); // fill the belt
    expect(sim.power.summary().demand).toBe(12);
    expect(sim.miners.info(miner)!.level).toBe(833);

    const before = sim.sieve.delivered[Item.IronOre]!;
    fuelled(sim, generator, 30 * SECOND);
    // 0.833 a second for 30 seconds is 25.
    const got = sim.sieve.delivered[Item.IronOre]! - before;
    expect(got).toBeGreaterThanOrEqual(24);
    expect(got).toBeLessThanOrEqual(26);
  });
});
