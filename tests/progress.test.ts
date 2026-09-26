import { describe, expect, it } from 'vitest';
import { Item } from '../src/data/items';
import { SEALS } from '../src/data/seals';
import { STARTING_STOCK } from '../src/data/economy';
import { Builder } from '../src/sim/builder';
import { SetRecipeCommand, History } from '../src/input/commands';
import { Progress } from '../src/sim/progress';
import { Sieve } from '../src/sim/sieve';
import { Simulation } from '../src/sim/simulation';
import { Ore, type SealDef } from '../src/sim/types';
import { makeWorld, place, run, stepN } from './helpers';

/** A tiny two-seal table, so tests are not coupled to the real game's numbers. */
const TEST_SEALS: readonly SealDef[] = [
  {
    level: 1,
    requires: [{ kind: 'deliver', item: Item.IronOre, count: 10 }],
    unlocks: { buildings: ['smelter'], recipes: [Item.IronPlate] },
  },
  {
    level: 2,
    requires: [
      { kind: 'deliver', item: Item.IronOre, count: 10 },
      { kind: 'deliver', item: Item.CopperOre, count: 5 },
    ],
    unlocks: { buildings: ['assembler'], recipes: [Item.Gear] },
  },
];
const TEST_START = { buildings: ['conveyor', 'miner'], recipes: [] };

describe('Progress', () => {
  it('starts with nothing beyond the start unlocks, working on the first seal', () => {
    const progress = new Progress(new Sieve(), TEST_SEALS, TEST_START);

    expect(progress.level).toBe(0);
    expect(progress.active).toBe(TEST_SEALS[0]);
    expect(progress.finished).toBe(false);
    expect(progress.buildingUnlocked('conveyor')).toBe(true);
    expect(progress.buildingUnlocked('smelter')).toBe(false);
    expect(progress.recipeUnlocked(Item.IronPlate)).toBe(false);
  });

  it('reports something no seal ever unlocks as not unlocked, not an error', () => {
    const progress = new Progress(new Sieve(), TEST_SEALS, TEST_START);
    expect(progress.buildingUnlockLevel('hub')).toBeUndefined();
    expect(progress.buildingUnlocked('hub')).toBe(false);
  });

  it('opens a seal the instant its last requirement is met, and unlocks with it', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, TEST_SEALS, TEST_START);
    const opened: number[] = [];
    progress.onComplete = (seal) => opened.push(seal.level);

    for (let i = 0; i < 9; i++) sieve.receive(Item.IronOre);
    progress.step(false);
    expect(progress.level).toBe(0);
    expect(progress.buildingUnlocked('smelter')).toBe(false);

    sieve.receive(Item.IronOre); // the tenth
    progress.step(false);
    expect(progress.level).toBe(1);
    expect(opened).toEqual([1]);
    expect(progress.buildingUnlocked('smelter')).toBe(true);
    expect(progress.recipeUnlocked(Item.IronPlate)).toBe(true);
    expect(progress.active).toBe(TEST_SEALS[1]);
  });

  it('opens more than one seal in the same call when deliveries already cover them', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, TEST_SEALS, TEST_START);
    const opened: number[] = [];
    progress.onComplete = (seal) => opened.push(seal.level);

    for (let i = 0; i < 10; i++) sieve.receive(Item.IronOre);
    for (let i = 0; i < 5; i++) sieve.receive(Item.CopperOre);
    progress.step(false);

    expect(opened).toEqual([1, 2]);
    expect(progress.finished).toBe(true);
    expect(progress.active).toBeNull();
  });

  it('counts deliveries toward every seal that asks for that item, not just the active one', () => {
    // Seal 2 also wants iron ore, and the seal-1 delivery already covers it.
    const sieve = new Sieve();
    const progress = new Progress(sieve, TEST_SEALS, TEST_START);
    for (let i = 0; i < 10; i++) sieve.receive(Item.IronOre);
    progress.step(false);
    expect(progress.level).toBe(1);

    for (let i = 0; i < 5; i++) sieve.receive(Item.CopperOre);
    progress.step(false);
    expect(progress.level).toBe(2); // did not need another 10 iron ore
  });

  it('never goes backward: spending stock does not touch delivered, so progress cannot un-complete', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, TEST_SEALS, TEST_START);
    for (let i = 0; i < 10; i++) sieve.receive(Item.IronOre);
    progress.step(false);
    expect(progress.level).toBe(1);

    sieve.spend([{ item: Item.IronOre, count: 10 }]); // as building would
    progress.step(false);
    expect(progress.level).toBe(1);
    expect(progress.buildingUnlocked('smelter')).toBe(true);
  });

  it('reports requirement progress capped at the need, for a progress bar', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, TEST_SEALS, TEST_START);
    for (let i = 0; i < 4; i++) sieve.receive(Item.IronOre);

    const [line] = progress.progressOf(TEST_SEALS[0]!);
    expect(line).toMatchObject({ have: 4, need: 10, met: false });

    for (let i = 0; i < 20; i++) sieve.receive(Item.IronOre); // well past 10
    const [after] = progress.progressOf(TEST_SEALS[0]!);
    expect(after).toMatchObject({ have: 10, need: 10, met: true });
  });
});

describe('Progress: sustained requirements', () => {
  const SUSTAIN_SEALS: readonly SealDef[] = [
    { level: 1, requires: [{ kind: 'sustain', item: Item.IronOre, perMinute: 60, minutes: 1 }], unlocks: { buildings: [], recipes: [] } },
  ];

  it('counts nothing until a full minute of history exists', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, SUSTAIN_SEALS, TEST_START);
    for (let s = 0; s < 30; s++) {
      for (let i = 0; i < 60; i++) sieve.receive(Item.IronOre);
      sieve.recordSecond();
      progress.step(true);
    }
    expect(progress.level).toBe(0);
    expect(progress.sustainedSeconds).toBe(0);
  });

  it('completes after sustaining the rate for the full window, second by second', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, SUSTAIN_SEALS, TEST_START);
    // A 61st snapshot is what makes a 60-second window readable at all (history.test
    // covers that in isolation), and the requirement then needs 60 further seconds all
    // meeting it: 120 seconds of feeding the exact rate is enough, with room to spare.
    for (let s = 0; s < 130 && progress.level === 0; s++) {
      for (let i = 0; i < 60; i++) sieve.receive(Item.IronOre);
      sieve.recordSecond();
      progress.step(true);
    }
    expect(progress.level).toBe(1);
  });

  it('resets the count on a single dip below the rate, so it must be unbroken', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, SUSTAIN_SEALS, TEST_START);
    // Deliver exactly the threshold rate (60 items/minute = 1/s), so the trailing
    // 60-second window sits right at "met" and a single quiet second tips it under.
    for (let s = 0; s < 90; s++) {
      sieve.receive(Item.IronOre);
      sieve.recordSecond();
      progress.step(true);
    }
    const before = progress.sustainedSeconds;
    expect(before).toBeGreaterThan(0);

    sieve.recordSecond(); // nothing delivered this second
    progress.step(true);
    expect(progress.sustainedSeconds).toBe(0);
  });

  it('only samples the rate on the tick a second ends', () => {
    const sieve = new Sieve();
    const progress = new Progress(sieve, SUSTAIN_SEALS, TEST_START);
    for (let s = 0; s < 61; s++) {
      for (let i = 0; i < 60; i++) sieve.receive(Item.IronOre);
      sieve.recordSecond();
      progress.step(false); // not end-of-second: must not sample
    }
    expect(progress.sustainedSeconds).toBe(0);
  });
});

describe('unlocks gate the Builder', () => {
  function setup(seals: readonly SealDef[] = TEST_SEALS) {
    const world = makeWorld(32);
    const sieve = new Sieve();
    const progress = new Progress(sieve, seals, TEST_START);
    const builder = new Builder(world, sieve, progress);
    return { world, sieve, progress, builder };
  }

  it('refuses to place a building before its seal, with reason "locked"', () => {
    const { builder } = setup();
    expect(builder.checkPlacement('smelter', 5, 5, 0)).toEqual({ ok: false, reason: 'locked' });
    expect(builder.place('smelter', 5, 5, 0)).toBeNull();
  });

  it('allows it the moment the unlocking seal opens, spending stock as usual', () => {
    const { sieve, progress, builder } = setup();
    sieve.addStock(Item.IronPlate, 100);
    sieve.addStock(Item.Stone, 100);
    for (let i = 0; i < 10; i++) sieve.receive(Item.IronOre);
    progress.step(false);

    const before = sieve.stock[Item.IronPlate]!;
    expect(builder.place('smelter', 5, 5, 0)).not.toBeNull();
    expect(sieve.stock[Item.IronPlate]).toBeLessThan(before);
  });

  it('never blocks placing something that costs nothing to unlock, like the conveyor', () => {
    const { sieve, builder } = setup();
    sieve.addStock(Item.IronPlate, 10);
    expect(builder.checkPlacement('conveyor', 5, 5, 0)).toEqual({ ok: true });
  });

  it('refuses to set a locked recipe, changing nothing, but always allows clearing one', () => {
    const world = makeWorld(32);
    const sieve = new Sieve();
    sieve.addStock(Item.IronPlate, 100);
    sieve.addStock(Item.Stone, 100);
    // Unlock the smelter building at seal 1 but its recipe only at seal 2, so the two
    // can be told apart: the building must accept placement while the recipe still refuses.
    const split: readonly SealDef[] = [
      { level: 1, requires: [{ kind: 'deliver', item: Item.IronOre, count: 1 }], unlocks: { buildings: ['smelter'], recipes: [] } },
      { level: 2, requires: [{ kind: 'deliver', item: Item.IronOre, count: 2 }], unlocks: { buildings: [], recipes: [Item.IronPlate] } },
    ];
    const progress = new Progress(sieve, split, TEST_START);
    const builder = new Builder(world, sieve, progress);
    sieve.receive(Item.IronOre);
    progress.step(false);
    expect(progress.buildingUnlocked('smelter')).toBe(true);
    expect(progress.recipeUnlocked(Item.IronPlate)).toBe(false);

    const smelter = builder.place('smelter', 5, 5, 0)!;
    expect(smelter).not.toBeNull();

    expect(builder.setRecipe(smelter.id, Item.IronPlate)).toBe(false);
    expect(world.recipeOf(smelter.id)).toBe(0);
    expect(builder.setRecipe(smelter.id, 0)).toBe(true); // clearing is always fine, even though it does nothing here
  });

  it('refuses a SetRecipeCommand for a locked recipe through History, leaving nothing on the undo stack', () => {
    const { world, sieve, progress, builder } = setup();
    sieve.addStock(Item.IronPlate, 100);
    sieve.addStock(Item.Stone, 100);
    const smelter = world.place('smelter', 5, 5, 0)!; // placed directly: only the recipe lock is under test here
    const history = new History();

    const cmd = new SetRecipeCommand(smelter.id, Item.IronPlate, 0);
    expect(history.execute(cmd, builder)).toBe(false);
    expect(world.recipeOf(smelter.id)).toBe(0);

    for (let i = 0; i < 10; i++) sieve.receive(Item.IronOre);
    progress.step(false);
    expect(history.execute(cmd, builder)).toBe(true);
    expect(world.recipeOf(smelter.id)).toBe(Item.IronPlate);
  });
});

describe('the real seal table end to end', () => {
  it('opens the first seal from an ordinary mined-and-delivered iron chain, and unlocks the smelter with it', () => {
    const world = makeWorld(48);
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) world.setOre(x, y, Ore.Iron);
    place(world, 'miner', 10, 10);
    run(world, 12, 10, 8, 0);
    place(world, 'hub', 20, 9);
    const sim = new Simulation(world);
    for (const { item, count } of STARTING_STOCK) sim.sieve.addStock(item, count);
    const builder = new Builder(world, sim.sieve, sim.progress);

    expect(builder.checkPlacement('smelter', 30, 30, 0)).toEqual({ ok: false, reason: 'locked' });

    // 30 iron ore at 0.5/s (four tiles) takes 60s, plus belt travel; run generously long.
    stepN(sim, 90 * 30);

    expect(sim.sieve.delivered[Item.IronOre]).toBeGreaterThanOrEqual(30);
    expect(sim.progress.level).toBeGreaterThanOrEqual(1);
    expect(builder.checkPlacement('smelter', 30, 30, 0)).toEqual({ ok: true });
  });

  it('never opens a seal before its requirement is actually met', () => {
    const world = makeWorld(48);
    const sim = new Simulation(world);
    stepN(sim, 5 * 30);
    expect(sim.progress.level).toBe(0);
    expect(sim.progress.active).toBe(SEALS[0]);
  });
});
