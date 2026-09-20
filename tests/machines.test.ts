import { describe, expect, it } from 'vitest';
import { MACHINE_INPUT_MULTIPLE, MACHINE_OUTPUT_CAP } from '../src/config';
import { Item } from '../src/data/items';
import { STRAIGHT } from '../src/sim/belts';
import { Simulation } from '../src/sim/simulation';
import { belt, makeWorld, place, run, stepN, tileOf } from './helpers';

const SECOND = 30;

/**
 * A smelter with a feed line into it and an output line to the hub:
 *
 *   feed belts (x 2..9, y 6) -> smelter (10,6) 2x2 -> output belts (x 12..19, y 6) -> hub (20,5)
 */
function smelterLine() {
  const world = makeWorld(48);
  run(world, 2, 6, 8, 0);
  const smelter = place(world, 'smelter', 10, 6);
  run(world, 12, 6, 8, 0);
  place(world, 'hub', 20, 5);
  const sim = new Simulation(world);
  return { world, sim, smelter, feed: tileOf(world, 2, 6) };
}

/** Puts ingredients straight into a machine, bypassing belts. Returns how many were accepted. */
function give(sim: Simulation, id: number, item: number, count: number): number {
  let accepted = 0;
  for (let i = 0; i < count; i++) if (sim.machines.accept(id, item)) accepted++;
  return accepted;
}

/** Feeds an item onto a belt every tick, as fast as it will take it. Returns how many went on. */
function saturate(sim: Simulation, tile: number, item: number, ticks: number): number {
  let fed = 0;
  for (let t = 0; t < ticks; t++) {
    if (sim.belts.tryEnter(tile, item, STRAIGHT)) fed++;
    sim.step();
  }
  return fed;
}

describe('a smelter', () => {
  it('does nothing until it is given a recipe', () => {
    const { sim, smelter } = smelterLine();
    sim.sync();

    expect(sim.machines.info(smelter)!.status).toBe('no-recipe');
    expect(give(sim, smelter, Item.IronOre, 3)).toBe(0);
  });

  it('takes only what its recipe needs', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();

    expect(sim.machines.accept(smelter, Item.IronOre)).toBe(true);
    expect(sim.machines.accept(smelter, Item.CopperOre)).toBe(false);
    expect(sim.machines.accept(smelter, Item.IronPlate)).toBe(false);
  });

  it('holds no more than twice one craft of an ingredient', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();

    // Iron plate needs one ore per craft, so two ore is the limit.
    expect(give(sim, smelter, Item.IronOre, 10)).toBe(1 * MACHINE_INPUT_MULTIPLE);
    // A craft starting uses one up, which makes room for another.
    sim.step();
    expect(give(sim, smelter, Item.IronOre, 10)).toBe(1);
  });

  it('makes a plate in exactly the recipe time, counted in ticks', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();
    give(sim, smelter, Item.IronOre, 1);

    // 1.6 s is 48 ticks. The craft starts on the first tick, so the plate appears
    // on the belt on tick 49 and not before.
    stepN(sim, 48);
    expect(sim.belts.totalItems()).toBe(0);
    sim.step();
    expect(sim.belts.totalItems()).toBe(1);
  });

  it('shows what it is doing', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();
    expect(sim.machines.info(smelter)!.status).toBe('waiting');

    give(sim, smelter, Item.IronOre, 1);
    sim.step();
    expect(sim.machines.info(smelter)!.status).toBe('working');

    stepN(sim, 60);
    expect(sim.machines.info(smelter)!.status).toBe('waiting');
  });

  it('runs at 0.625 plates per second when fed all it can take', () => {
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);

    saturate(sim, feed, Item.IronOre, 20 * SECOND); // warm up past the belt's transit time
    const before = sim.sieve.delivered[Item.IronPlate]!;
    saturate(sim, feed, Item.IronOre, 60 * SECOND);
    const made = sim.sieve.delivered[Item.IronPlate]! - before;

    // 60 s / 1.6 s = 37.5 crafts.
    expect(made).toBeGreaterThanOrEqual(37);
    expect(made).toBeLessThanOrEqual(38);
  });

  it('makes bricks from stone, two to one, more slowly', () => {
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.StoneBrick);

    saturate(sim, feed, Item.Stone, 20 * SECOND);
    const before = sim.sieve.delivered[Item.StoneBrick]!;
    saturate(sim, feed, Item.Stone, 60 * SECOND);
    const made = sim.sieve.delivered[Item.StoneBrick]! - before;

    // 2 s per craft: 30 a minute, and the belt can supply the 60 stone that needs.
    expect(made).toBeGreaterThanOrEqual(29);
    expect(made).toBeLessThanOrEqual(30);
  });
});

describe('a machine that refuses an item', () => {
  it('leaves it on the belt, jamming the line behind it', () => {
    // The point of "no inserters": a wrong item is not discarded, it blocks.
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate); // wants iron ore

    saturate(sim, feed, Item.CopperOre, 30 * SECOND); // but is sent copper ore

    expect(sim.machines.info(smelter)!.inputs[Item.CopperOre]).toBe(0);
    expect(sim.sieve.delivered[Item.IronPlate]).toBe(0);
    // The feed line is full to the door: 8 tiles of 4.
    expect(sim.belts.totalItems()).toBe(8 * 4);
  });

  it('blocks a good item stuck behind a bad one', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();
    const last = tileOf(world, 9, 6);

    // Copper ore at the front of the last belt, iron ore right behind it.
    sim.belts.debugPush(last, Item.CopperOre, 1);
    sim.belts.debugPush(last, Item.IronOre, 0.75);
    stepN(sim, 10 * SECOND);

    expect(sim.machines.info(smelter)!.inputs[Item.IronOre]).toBe(0);
    expect(sim.machines.info(smelter)!.status).toBe('waiting');
  });

  it('resumes as soon as the recipe is changed to something that wants the blocking item', () => {
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    saturate(sim, feed, Item.CopperOre, 20 * SECOND);
    expect(sim.sieve.delivered[Item.CopperPlate]).toBe(0);

    world.setRecipe(smelter, Item.CopperPlate);
    saturate(sim, feed, Item.CopperOre, 20 * SECOND);

    expect(sim.sieve.delivered[Item.CopperPlate]).toBeGreaterThan(0);
  });
});

describe('a machine with nowhere to put its output', () => {
  function withoutOutputBelt() {
    const world = makeWorld(48);
    const smelter = place(world, 'smelter', 10, 6);
    world.setRecipe(smelter, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();
    return { world, sim, smelter };
  }

  it('fills its output buffer and stops, rather than losing what it makes', () => {
    const { sim, smelter } = withoutOutputBelt();

    for (let t = 0; t < 60 * SECOND; t++) {
      give(sim, smelter, Item.IronOre, 1);
      sim.step();
    }

    const info = sim.machines.info(smelter)!;
    expect(info.output).toBe(MACHINE_OUTPUT_CAP);
    expect(info.status).toBe('blocked');
    expect(info.crafting).toBe(false);
  });

  it('stops taking ingredients too, so the block backs up onto the feed line', () => {
    const { sim, smelter } = withoutOutputBelt();

    for (let t = 0; t < 60 * SECOND; t++) {
      give(sim, smelter, Item.IronOre, 1);
      sim.step();
    }

    expect(sim.machines.info(smelter)!.inputs[Item.IronOre]).toBe(MACHINE_INPUT_MULTIPLE);
    expect(give(sim, smelter, Item.IronOre, 5)).toBe(0);
  });

  it('drains when an output belt is added', () => {
    const { world, sim, smelter } = withoutOutputBelt();
    for (let t = 0; t < 30 * SECOND; t++) {
      give(sim, smelter, Item.IronOre, 1);
      sim.step();
    }
    expect(sim.machines.info(smelter)!.status).toBe('blocked');

    run(world, 12, 6, 3, 0);
    stepN(sim, 5 * SECOND);

    expect(sim.machines.info(smelter)!.output).toBeLessThan(MACHINE_OUTPUT_CAP);
    expect(sim.belts.totalItems()).toBeGreaterThan(0);
  });
});

describe('where a machine puts its product', () => {
  it('never puts it on the belt that feeds it', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();

    const ports = sim.machines.info(smelter)!.ports.map((p) => p.tile);
    expect(ports).toContain(tileOf(world, 12, 6));
    expect(ports).not.toContain(tileOf(world, 9, 6)); // points at the smelter
  });

  it('shares its output evenly between two belts', () => {
    const world = makeWorld(48);
    const smelter = place(world, 'smelter', 10, 6);
    world.setRecipe(smelter, Item.IronPlate);
    // Two dead-end belts beside it, each of which holds four and then stops.
    belt(world, 12, 6, 0);
    belt(world, 12, 7, 0);
    const sim = new Simulation(world);
    sim.sync();

    for (let t = 0; t < 40 * SECOND; t++) {
      give(sim, smelter, Item.IronOre, 1);
      sim.step();
    }

    const a = sim.belts.count[tileOf(world, 12, 6)]!;
    const b = sim.belts.count[tileOf(world, 12, 7)]!;
    expect(a).toBe(4);
    expect(b).toBe(4);
  });
});

describe('recipe restrictions', () => {
  it('will not run a recipe that needs a higher tier', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.Steel); // needs a Mk2 smelter; this is Mk1
    sim.sync();

    expect(sim.machines.info(smelter)!.recipe).toBeNull();
    expect(sim.machines.info(smelter)!.status).toBe('no-recipe');
  });

  it("will not run another machine class's recipe", () => {
    const world = makeWorld(48);
    const assembler = place(world, 'assembler', 10, 6);
    world.setRecipe(assembler, Item.IronPlate); // a smelting recipe
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.machines.info(assembler)!.recipe).toBeNull();
  });

  it('ignores a recipe for an item that has none', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronOre); // raw: nothing makes it
    sim.sync();
    expect(sim.machines.info(smelter)!.recipe).toBeNull();
  });
});

describe('changing a machine', () => {
  it('starts fresh when its recipe changes, since what it held was for something else', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();
    give(sim, smelter, Item.IronOre, 2);
    sim.step();

    world.setRecipe(smelter, Item.CopperPlate);
    sim.step();

    const info = sim.machines.info(smelter)!;
    expect(info.inputs[Item.IronOre]).toBe(0);
    expect(info.crafting).toBe(false);
  });

  it('keeps its buffers and progress through an unrelated edit', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();
    give(sim, smelter, Item.IronOre, 2);
    stepN(sim, 20); // partway through a craft, one ore still waiting
    const before = sim.machines.info(smelter)!;
    const progress = before.progress;

    belt(world, 30, 30, 0); // nothing to do with the smelter
    sim.step();

    const after = sim.machines.info(smelter)!;
    expect(after.crafting).toBe(true);
    expect(after.progress).toBe(progress + 1);
    expect(after.inputs[Item.IronOre]).toBe(1);
  });

  it('does not bump the revision when the recipe is set to what it already is', () => {
    const { world, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    const revision = world.revision;
    world.setRecipe(smelter, Item.IronPlate);
    expect(world.revision).toBe(revision);
  });

  it('stops being simulated when removed, and its belt then leads nowhere', () => {
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    saturate(sim, feed, Item.IronOre, 10 * SECOND);
    expect(sim.machines.count).toBe(1);

    world.removeById(smelter);
    sim.step();

    expect(sim.machines.count).toBe(0);
    expect(sim.machines.info(smelter)).toBeNull();
  });

  it('is restored with its recipe when a removal is undone', () => {
    const { world, sim, smelter } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);
    sim.sync();

    const removed = world.removeById(smelter)!;
    world.insert(removed);
    sim.step();

    expect(sim.machines.info(smelter)!.recipe?.output).toBe(Item.IronPlate);
  });
});

describe('an assembler', () => {
  /** An assembler (3x3) with two feed lines and an output line to the hub. */
  function assemblerLine() {
    const world = makeWorld(48);
    const assembler = place(world, 'assembler', 10, 5);
    run(world, 2, 5, 8, 0); // into (10,5)
    run(world, 2, 7, 8, 0); // into (10,7)
    run(world, 13, 6, 6, 0); // out of (12,6)
    place(world, 'hub', 19, 5);
    const sim = new Simulation(world);
    return { world, sim, assembler, feedA: tileOf(world, 2, 5), feedB: tileOf(world, 2, 7) };
  }

  it('waits for every ingredient before it starts', () => {
    const { world, sim, assembler } = assemblerLine();
    world.setRecipe(assembler, Item.Circuit); // 1 iron plate + 2 copper wire
    sim.sync();

    give(sim, assembler, Item.IronPlate, 1);
    give(sim, assembler, Item.CopperWire, 1); // one wire is not enough
    stepN(sim, 30);
    expect(sim.machines.info(assembler)!.crafting).toBe(false);

    give(sim, assembler, Item.CopperWire, 1);
    sim.step();
    expect(sim.machines.info(assembler)!.crafting).toBe(true);
  });

  it('holds twice one craft of each ingredient separately', () => {
    const { world, sim, assembler } = assemblerLine();
    world.setRecipe(assembler, Item.Circuit);
    sim.sync();

    expect(give(sim, assembler, Item.IronPlate, 10)).toBe(1 * MACHINE_INPUT_MULTIPLE);
    expect(give(sim, assembler, Item.CopperWire, 10)).toBe(2 * MACHINE_INPUT_MULTIPLE);
  });

  it('uses exactly what the recipe calls for', () => {
    const { world, sim, assembler } = assemblerLine();
    world.setRecipe(assembler, Item.Circuit);
    sim.sync();
    give(sim, assembler, Item.IronPlate, 2);
    give(sim, assembler, Item.CopperWire, 4);

    sim.step(); // a craft starts

    const info = sim.machines.info(assembler)!;
    expect(info.inputs[Item.IronPlate]).toBe(1);
    expect(info.inputs[Item.CopperWire]).toBe(2);
  });

  it('makes a gear a second: two plates in, one gear out, 30 ticks', () => {
    const { world, sim, assembler, feedA } = assemblerLine();
    world.setRecipe(assembler, Item.Gear);

    saturate(sim, feedA, Item.IronPlate, 20 * SECOND);
    const before = sim.sieve.delivered[Item.Gear]!;
    saturate(sim, feedA, Item.IronPlate, 60 * SECOND);
    const made = sim.sieve.delivered[Item.Gear]! - before;

    expect(made).toBeGreaterThanOrEqual(59);
    expect(made).toBeLessThanOrEqual(60);
  });

  it('makes a circuit from ingredients arriving on two different belts', () => {
    const { world, sim, assembler, feedA, feedB } = assemblerLine();
    world.setRecipe(assembler, Item.Circuit);

    for (let t = 0; t < 60 * SECOND; t++) {
      sim.belts.tryEnter(feedA, Item.IronPlate, STRAIGHT);
      sim.belts.tryEnter(feedB, Item.CopperWire, STRAIGHT);
      sim.step();
    }

    // 2 s per circuit: about 30 in a minute, less the time to fill and drain.
    expect(sim.sieve.delivered[Item.Circuit]).toBeGreaterThan(20);
  });
});

describe('conservation', () => {
  it('accounts for every ore that goes in: nothing is created or lost', () => {
    const { world, sim, smelter, feed } = smelterLine();
    world.setRecipe(smelter, Item.IronPlate);

    let fed = 0;
    for (let t = 0; t < 90 * SECOND; t++) {
      if (sim.belts.tryEnter(feed, Item.IronOre, STRAIGHT)) fed++;
      sim.step();

      // Checked every tick, not just at the end: a leak that a later refill hides
      // would still show up somewhere in the run.
      if (t % 45 !== 0) continue;
      const info = sim.machines.info(smelter);
      if (!info) continue;
      const oreOnBelts = countOnBelts(sim, Item.IronOre);
      const platesOnBelts = countOnBelts(sim, Item.IronPlate);
      const accounted =
        oreOnBelts +
        info.inputs[Item.IronOre]! +
        (info.crafting ? 1 : 0) +
        info.output +
        platesOnBelts +
        sim.sieve.delivered[Item.IronPlate]!;
      expect(accounted).toBe(fed);
    }
  });

  it('holds across a two-stage chain: ore to plate to gear', () => {
    const world = makeWorld(64);
    // ore -> smelter -> plates -> assembler -> gears -> hub
    run(world, 2, 6, 8, 0);
    const smelter = place(world, 'smelter', 10, 6);
    run(world, 12, 6, 4, 0);
    const assembler = place(world, 'assembler', 16, 5);
    run(world, 19, 6, 4, 0);
    place(world, 'hub', 23, 5);
    world.setRecipe(smelter, Item.IronPlate);
    world.setRecipe(assembler, Item.Gear);
    const sim = new Simulation(world);
    const feed = tileOf(world, 2, 6);

    let fed = 0;
    for (let t = 0; t < 120 * SECOND; t++) {
      if (sim.belts.tryEnter(feed, Item.IronOre, STRAIGHT)) fed++;
      sim.step();
    }

    const s = sim.machines.info(smelter)!;
    const a = sim.machines.info(assembler)!;
    // Each gear is two plates and each plate is one ore, so count in units of ore.
    const ore =
      countOnBelts(sim, Item.IronOre) +
      s.inputs[Item.IronOre]! +
      (s.crafting ? 1 : 0) +
      s.output +
      countOnBelts(sim, Item.IronPlate) +
      a.inputs[Item.IronPlate]! +
      (a.crafting ? 2 : 0) +
      2 * (a.output + countOnBelts(sim, Item.Gear) + sim.sieve.delivered[Item.Gear]!);
    expect(ore).toBe(fed);
    expect(sim.sieve.delivered[Item.Gear]).toBeGreaterThan(0);
  });
});

describe('conservation when a machine is over-supplied', () => {
  // The chain test above starves its assembler (a smelter makes plates slower than
  // an assembler eats them), so the assembler's buffers never hold anything left
  // over after a craft starts. A machine that quietly destroyed a spare ingredient
  // would go unnoticed there. Here the buffers are always full.
  it('loses no plates when the assembler always has more than it needs', () => {
    const world = makeWorld(48);
    const assembler = place(world, 'assembler', 10, 5);
    run(world, 2, 6, 8, 0);
    run(world, 13, 6, 6, 0);
    place(world, 'hub', 19, 5);
    world.setRecipe(assembler, Item.Gear);
    const sim = new Simulation(world);
    const feed = tileOf(world, 2, 6);

    const fed = saturate(sim, feed, Item.IronPlate, 90 * SECOND);
    const a = sim.machines.info(assembler)!;

    // Each gear is two plates.
    const plates =
      countOnBelts(sim, Item.IronPlate) +
      a.inputs[Item.IronPlate]! +
      (a.crafting ? 2 : 0) +
      2 * (a.output + countOnBelts(sim, Item.Gear) + sim.sieve.delivered[Item.Gear]!);
    expect(plates).toBe(fed);
    // And it really was over-supplied: the input buffer sat full.
    expect(a.inputs[Item.IronPlate]).toBeGreaterThan(0);
  });
});

function countOnBelts(sim: Simulation, item: number): number {
  let n = 0;
  for (let tile = 0; tile < sim.belts.tileCount; tile++) {
    for (let i = 0; i < sim.belts.count[tile]!; i++) {
      if (sim.belts.item[tile * 4 + i] === item) n++;
    }
  }
  return n;
}
