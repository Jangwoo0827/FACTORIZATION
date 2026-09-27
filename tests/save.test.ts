import { describe, expect, it } from 'vitest';
import { DEF_MAP } from '../src/data/buildings';
import { Item } from '../src/data/items';
import { createSave, migrate, parseSave, restoreSave, SAVE_VERSION, SaveError, type SaveData } from '../src/sim/save';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import { World } from '../src/sim/world';
import { stepN } from './helpers';

const SIZE = 64;
const SEED = 1234;

/** The empty map for a seed: here, two ore fields. Stands in for world generation. */
function generate(size: number, _seed: number): World {
  const world = new World(size, DEF_MAP);
  for (let y = 10; y < 12; y++) for (let x = 4; x < 6; x++) world.setOre(x, y, Ore.Iron);
  for (let y = 30; y < 32; y++) for (let x = 4; x < 6; x++) world.setOre(x, y, Ore.Iron);
  for (let y = 40; y < 42; y++) for (let x = 4; x < 6; x++) world.setOre(x, y, Ore.Coal);
  return world;
}

function placeOrThrow(world: World, defId: string, x: number, y: number, rot: 0 | 1 | 2 | 3 = 0): number {
  const b = world.place(defId, x, y, rot);
  if (!b) throw new Error(`could not place ${defId} at ${x},${y}`);
  return b.id;
}

function line(world: World, x0: number, y: number, x1: number): void {
  for (let x = x0; x <= x1; x++) placeOrThrow(world, 'conveyor', x, y, 0);
}

/**
 * A factory touching every kind of saved state:
 *
 *   row 10: iron miner -> belts -> Mk1 smelter (plates) -> belts -> splitter -> belts -> hub (40,9)
 *   row 30: iron miner -> belts -> underpass -> (gap) -> exit -> belts, north, east -> hub (40,21)
 *   row 40: coal miner -> belts -> generator; pole; Mk2 machines on that grid, browning out
 */
function build(): Simulation {
  const world = generate(SIZE, SEED);
  // Two hubs: one where each line ends. (40,9) covers row 10; (40,21) covers row 22.
  placeOrThrow(world, 'hub', 40, 9);
  placeOrThrow(world, 'hub', 40, 21);

  placeOrThrow(world, 'miner', 4, 10);
  line(world, 6, 10, 9);
  const smelter = placeOrThrow(world, 'smelter', 10, 10);
  world.setRecipe(smelter, Item.IronPlate);
  line(world, 12, 10, 19);
  placeOrThrow(world, 'splitter', 20, 10);
  line(world, 21, 10, 39);
  // The splitter's other exits: a short spur that fills up and backs off.
  placeOrThrow(world, 'conveyor', 20, 11, 1);

  placeOrThrow(world, 'miner', 4, 30);
  line(world, 6, 30, 14);
  placeOrThrow(world, 'tunnel-in', 15, 30, 0);
  placeOrThrow(world, 'tunnel-out', 19, 30, 0);
  line(world, 20, 30, 29);
  for (let y = 30; y >= 23; y--) placeOrThrow(world, 'conveyor', 30, y, 3);
  line(world, 31, 22, 39);
  placeOrThrow(world, 'conveyor', 30, 22, 0);

  placeOrThrow(world, 'miner', 4, 40);
  line(world, 6, 40, 9);
  placeOrThrow(world, 'generator', 10, 40);
  placeOrThrow(world, 'pole', 12, 43);
  const mk2 = placeOrThrow(world, 'smelter-mk2', 14, 43);
  world.setRecipe(mk2, Item.IronPlate);
  // Two more Mk2 machines take demand to 2 + 4 + 4 + 2 = 12 PU against 10: a brownout,
  // so machines carry a fractional power credit from tick to tick.
  placeOrThrow(world, 'assembler-mk2', 8, 44);
  placeOrThrow(world, 'assembler-mk2', 14, 46);
  placeOrThrow(world, 'smelter-mk2', 11, 45);

  return new Simulation(world);
}

/** A save as it would come back from storage: through JSON text. */
function roundTrip(sim: Simulation): SaveData {
  return parseSave(JSON.stringify(createSave(sim, SEED, undefined, 0)));
}

function load(save: SaveData): Simulation {
  return restoreSave(save, generate, DEF_MAP).sim;
}

/** Everything the save format captures, for comparing two games. */
function snapshot(sim: Simulation): string {
  return JSON.stringify(createSave(sim, SEED, undefined, 0));
}

describe('saving and loading', () => {
  it('runs on exactly as it would have: a loaded factory matches the original tick for tick', () => {
    const original = build();
    stepN(original, 95 * 30 + 7); // mid-second, with things in motion everywhere

    const loaded = load(roundTrip(original));
    expect(snapshot(loaded)).toBe(snapshot(original));

    // Now run both on. Any state the save missed shows up as a divergence.
    for (let t = 0; t < 60 * 30; t++) {
      original.step();
      loaded.step();
    }
    expect(snapshot(loaded)).toBe(snapshot(original));
    expect(loaded.sieve.delivered[Item.IronPlate]).toBe(original.sieve.delivered[Item.IronPlate]);
    // Both lines really deliver, so the comparison covers a working factory.
    expect(loaded.sieve.delivered[Item.IronPlate]).toBeGreaterThan(0);
    expect(loaded.sieve.delivered[Item.IronOre]).toBeGreaterThan(0);
  });

  it('actually has things in motion when it saves, so the test above means something', () => {
    const sim = build();
    stepN(sim, 95 * 30 + 7);
    const save = createSave(sim, SEED);

    expect(save.belts.length).toBeGreaterThan(10);
    expect(save.belts.some((b) => b.s && b.s[0] !== 0) || save.belts.some((b) => b.s)).toBe(true);
    expect(save.machines.some((m) => m.crafting || m.inputs.length > 0)).toBe(true);
    expect(save.generators.some(([, stored, burnLeft]) => stored > 0 || burnLeft > 0)).toBe(true);
    expect(save.miners.some(([, progress]) => progress! > 0)).toBe(true);
    expect(save.machines.some((m) => m.credit > 0)).toBe(true);
  });

  it('keeps building ids, order and the next id, so undo history and build-order rules survive', () => {
    const original = build();
    // Remove something so the next id is past the highest standing one.
    const last = [...original.world.buildings()].at(-1)!;
    original.world.removeById(last.id);
    stepN(original, 30);

    const loaded = load(roundTrip(original));
    expect([...loaded.world.buildings()].map((b) => b.id)).toEqual([...original.world.buildings()].map((b) => b.id));
    const next = loaded.world.place('conveyor', 60, 60, 0)!;
    expect(next.id).toBe(last.id + 1);
  });

  it('keeps seal progress, and does not announce the seals again on load', () => {
    const original = build();
    for (let i = 0; i < 30; i++) original.sieve.receive(Item.IronOre);
    original.step();
    expect(original.progress.level).toBe(1);

    const announced: number[] = [];
    const restored = restoreSave(roundTrip(original), generate, DEF_MAP).sim;
    restored.progress.onComplete = (s) => announced.push(s.level);
    restored.step();
    expect(restored.progress.level).toBe(1);
    expect(announced).toEqual([]);
  });

  it('keeps production history, so the statistics carry on across a load', () => {
    const original = build();
    stepN(original, 120 * 30);
    const loaded = load(roundTrip(original));

    expect(loaded.stats.seconds).toBe(original.stats.seconds);
    expect(loaded.stats.producedPerMinute(Item.IronOre, 60)).toBe(original.stats.producedPerMinute(Item.IronOre, 60));
    expect(loaded.sieve.perMinute(Item.IronPlate)).toBe(original.sieve.perMinute(Item.IronPlate));
  });

  it('keeps a full hour of statistics after the history ring has wrapped', () => {
    const original = build();
    for (let s = 0; s < 3700; s++) {
      original.stats.produce(Item.Gear, s % 7);
      original.stats.recordSecond();
    }
    const loaded = load(roundTrip(original));
    for (const w of [60, 600, 3600]) {
      expect(loaded.stats.producedPerMinute(Item.Gear, w)).toBe(original.stats.producedPerMinute(Item.Gear, w));
    }
    expect(loaded.stats.producedSeries(Item.Gear, 3600, 30)).toEqual(original.stats.producedSeries(Item.Gear, 3600, 30));
  });

  it('reports buildings that no longer fit the regenerated map instead of failing', () => {
    const original = build();
    const save = roundTrip(original);
    // A map where the ore moved: the miners on row 10 no longer have ore under them.
    const moved = (size: number) => {
      const w = new World(size, DEF_MAP);
      for (let y = 30; y < 32; y++) for (let x = 4; x < 6; x++) w.setOre(x, y, Ore.Iron);
      for (let y = 40; y < 42; y++) for (let x = 4; x < 6; x++) w.setOre(x, y, Ore.Coal);
      return w;
    };
    const { lostBuildings } = restoreSave(save, moved, DEF_MAP);
    expect(lostBuildings).toBe(1);
  });
});

describe('the save format', () => {
  it('is stamped with the current version', () => {
    expect(createSave(build(), SEED).saveVersion).toBe(SAVE_VERSION);
  });

  it('refuses things that are not saves, with a readable reason', () => {
    expect(() => parseSave('not json')).toThrow(SaveError);
    expect(() => parseSave('[]')).toThrow(SaveError);
    expect(() => parseSave('{"saveVersion": "one"}')).toThrow(SaveError);
    expect(() => parseSave('{"saveVersion": 1}')).toThrow(/손상/);
  });

  it('refuses a save from a newer version instead of half-reading it', () => {
    const save = { ...createSave(build(), SEED), saveVersion: SAVE_VERSION + 1 };
    expect(() => migrate(save)).toThrow(/더 새로운 버전/);
  });

  it('upgrades an old save one version at a time through the migration chain', () => {
    const v1 = { ...createSave(build(), SEED), saveVersion: 1 } as unknown as Record<string, unknown>;
    const seen: number[] = [];
    const migrations = {
      1: (s: Record<string, unknown>) => (seen.push(1), { ...s, saveVersion: 2 }),
      2: (s: Record<string, unknown>) => (seen.push(2), { ...s, saveVersion: 3, extra: true }),
    };
    const upgraded = migrate(v1, migrations, 3) as unknown as Record<string, unknown>;
    expect(seen).toEqual([1, 2]);
    expect(upgraded['saveVersion']).toBe(3);
    expect(upgraded['extra']).toBe(true);
  });

  it('refuses an old save when a step of the chain is missing', () => {
    const v1 = { ...createSave(build(), SEED), saveVersion: 1 };
    expect(() => migrate(v1, {}, 2)).toThrow(SaveError);
  });

  it('does not store terrain or ore: a whole factory saves small', () => {
    const sim = build();
    stepN(sim, 60 * 30);
    const bytes = JSON.stringify(createSave(sim, SEED)).length;
    expect(bytes).toBeLessThan(60_000);
  });
});
