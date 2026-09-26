import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/data/buildings';
import { Item } from '../src/data/items';
import { RECIPE_BOOK } from '../src/data/recipes';
import { lockOf, newPrimesOf, requirementQuantity, SEALS, START_UNLOCKS } from '../src/data/seals';
import { equals, PRIMES, power, primeSignature } from '../src/factor/signature';
import { Progress } from '../src/sim/progress';
import { Sieve } from '../src/sim/sieve';

/**
 * Everything a seal's requirements or unlocks could name, so a typo (an item id, a
 * building id) fails loudly here instead of quietly doing nothing in the game.
 */
const KNOWN_BUILDINGS = new Set(BUILDING_DEFS.map((d) => d.id));

describe('the seal table', () => {
  it('is numbered 1..N with no gaps, duplicates, or wrong order', () => {
    expect(SEALS.map((s) => s.level)).toEqual(SEALS.map((_, i) => i + 1));
  });

  it('asks for a positive amount of a real item in every requirement', () => {
    for (const seal of SEALS) {
      expect(seal.requires.length, `seal ${seal.level} has no requirements`).toBeGreaterThan(0);
      for (const req of seal.requires) {
        expect(() => RECIPE_BOOK.signature(req.item), `seal ${seal.level}: item ${req.item}`).not.toThrow();
        if (req.kind === 'deliver') {
          expect(Number.isInteger(req.count), `seal ${seal.level}`).toBe(true);
          expect(req.count).toBeGreaterThan(0);
        } else {
          expect(req.perMinute).toBeGreaterThan(0);
          expect(req.minutes).toBeGreaterThan(0);
        }
      }
    }
  });

  it('unlocks only buildings that exist', () => {
    for (const id of START_UNLOCKS.buildings) expect(KNOWN_BUILDINGS.has(id), id).toBe(true);
    for (const seal of SEALS) {
      for (const id of seal.unlocks.buildings) expect(KNOWN_BUILDINGS.has(id), `seal ${seal.level}: ${id}`).toBe(true);
    }
  });

  it('unlocks only recipes that exist, and never a raw material (which needs none)', () => {
    for (const seal of SEALS) {
      for (const item of seal.unlocks.recipes) {
        expect(RECIPE_BOOK.recipe(item), `seal ${seal.level}: item ${item}`).toBeDefined();
      }
    }
  });

  it('unlocks each building and each recipe at most once', () => {
    const buildings = new Map<string, number>();
    const recipes = new Map<number, number>();
    for (const id of START_UNLOCKS.buildings) buildings.set(id, 0);
    for (const item of START_UNLOCKS.recipes) recipes.set(item, 0);

    for (const seal of SEALS) {
      for (const id of seal.unlocks.buildings) {
        expect(buildings.has(id), `${id} unlocked twice: level ${buildings.get(id)} and ${seal.level}`).toBe(false);
        buildings.set(id, seal.level);
      }
      for (const item of seal.unlocks.recipes) {
        expect(recipes.has(item), `item ${item} unlocked twice: level ${recipes.get(item)} and ${seal.level}`).toBe(
          false,
        );
        recipes.set(item, seal.level);
      }
    }
  });

  it('starts with a miner and a conveyor, since nothing else can produce the first delivery', () => {
    expect(START_UNLOCKS.buildings).toContain('miner');
    expect(START_UNLOCKS.buildings).toContain('conveyor');
  });

  /**
   * The rule that forced most of the deviations from the GDD's own table (see the
   * header comment in `data/seals.ts`): everything a seal asks for must be gettable
   * with only what unlocked *before* that seal became active — the recipe, and a
   * machine of high enough tier to run it, recursively down to raw materials. A raw
   * material is always gettable: mining needs only the miner, which is unlocked from
   * the start.
   */
  function producible(item: number, level: number, progress: Progress, memo: Map<number, boolean>): boolean {
    const cached = memo.get(item);
    if (cached !== undefined) return cached;
    memo.set(item, false); // breaks a cycle as "not producible" rather than looping; recipeBook forbids cycles anyway

    let ok: boolean;
    if (RECIPE_BOOK.isRaw(item)) {
      ok = true;
    } else {
      const recipe = RECIPE_BOOK.recipe(item);
      const recipeLevel = progress.recipeUnlockLevel(item);
      const hasRecipe = recipe !== undefined && recipeLevel !== undefined && recipeLevel <= level;
      const hasMachine =
        hasRecipe &&
        BUILDING_DEFS.some((d) => {
          if (d.machine?.class !== recipe!.machine || d.machine.tier < recipe!.tier) return false;
          const unlockedAt = progress.buildingUnlockLevel(d.id);
          return unlockedAt !== undefined && unlockedAt <= level;
        });
      ok = hasRecipe && hasMachine && recipe!.inputs.every((i) => producible(i.item, level, progress, memo));
    }
    memo.set(item, ok);
    return ok;
  }

  it('is completable at every level using only what unlocked strictly before it', () => {
    // A structural proof, not a playthrough: whatever unlocked at level <= seal.level-1
    // must be enough to obtain every item the seal asks for. `Progress` built with an
    // empty sieve is used only for its unlock-level tables, never advanced.
    const progress = new Progress(new Sieve());
    const failures: string[] = [];

    for (const seal of SEALS) {
      const level = seal.level - 1;
      const memo = new Map<number, boolean>();
      for (const req of seal.requires) {
        if (!producible(req.item, level, progress, memo)) {
          failures.push(`seal ${seal.level} needs item ${req.item}, not producible with what unlocks by ${level}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('leaves the recipe-tier building unlocked no later than the recipe itself needs it', () => {
    // A narrower, more direct version of the completability check, for the case that
    // most easily slips through by hand: a recipe unlocked before the machine that can
    // run it. (A recipe and its machine unlocking at the very same seal is fine.)
    const progress = new Progress(new Sieve());
    for (const item of RECIPE_BOOK.craftable) {
      const recipe = RECIPE_BOOK.recipe(item)!;
      const recipeLevel = progress.recipeUnlockLevel(item);
      if (recipeLevel === undefined) continue; // never offered to the player; not this test's concern
      const machineLevel = Math.min(
        ...BUILDING_DEFS.filter((d) => d.machine?.class === recipe.machine && d.machine.tier >= recipe.tier)
          .map((d) => progress.buildingUnlockLevel(d.id))
          .filter((l): l is number => l !== undefined),
      );
      expect(machineLevel, `item ${item}: recipe unlocks at ${recipeLevel}`).toBeLessThanOrEqual(recipeLevel);
    }
  });
});

describe('lock numbers', () => {
  it('is the raw material prime to the count for a single-item, single-material seal', () => {
    const seal = SEALS.find((s) => s.level === 1)!;
    expect(seal.requires).toEqual([{ kind: 'deliver', item: Item.IronOre, count: 30 }]);
    expect(equals(lockOf(seal), power(primeSignature(0), 30))).toBe(true); // prime 2 (iron) ^ 30
  });

  it('multiplies across every requirement line', () => {
    const seal = SEALS.find((s) => s.level === 5)!;
    expect(seal.requires).toEqual([
      { kind: 'deliver', item: Item.Circuit, count: 30 },
      { kind: 'deliver', item: Item.Coal, count: 100 },
    ]);
    const circuitPart = power(RECIPE_BOOK.signature(Item.Circuit), 30);
    const coalPart = power(primeSignature(2), 100); // prime 5 (coal)
    const combined = circuitPart.map((v, i) => v + coalPart[i]!);
    expect(equals(lockOf(seal), combined)).toBe(true);
  });

  it('is exactly the sustained item signature to the power of total items delivered over the window', () => {
    const seal = SEALS.find((s) => s.level === 20)!;
    const req = seal.requires[0]!;
    expect(req.kind).toBe('sustain');
    expect(requirementQuantity(req)).toBe(6 * 5); // 6/min for 5 min
    expect(equals(lockOf(seal), power(RECIPE_BOOK.signature(Item.GateComponent), 30))).toBe(true);
  });

  it('changes when a quantity changes, and nothing else does', () => {
    const seal = SEALS.find((s) => s.level === 2)!;
    const doubled = { ...seal, requires: [{ kind: 'deliver' as const, item: Item.IronPlate, count: 100 }] };
    expect(equals(lockOf(seal), lockOf(doubled))).toBe(false);
    expect(equals(lockOf(doubled), power(RECIPE_BOOK.signature(Item.IronPlate), 100))).toBe(true);
  });
});

describe('new-prime announcements', () => {
  it('introduces the primes in the order the GDD phases promise: 2,3 then 5,7 then 11 then 13', () => {
    const primeAt = (level: number) => newPrimesOf(level).map((i) => PRIMES[i]!);

    expect(primeAt(1)).toEqual([2]); // iron ore
    expect(primeAt(3)).toEqual([3]); // copper plate, first requirement touching copper
    expect(primeAt(5)).toEqual([5]); // coal
    expect(primeAt(6)).toEqual([7]); // stone brick
    expect(primeAt(9)).toEqual([11]); // sand
    expect(primeAt(13)).toEqual([13]); // quartz
  });

  it('never announces the same prime twice', () => {
    const seen = new Map<number, number>();
    for (const seal of SEALS) {
      for (const p of newPrimesOf(seal.level)) {
        expect(seen.has(p), `prime ${PRIMES[p]} announced again at level ${seal.level}`).toBe(false);
        seen.set(p, seal.level);
      }
    }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual(PRIMES.map((_, i) => i));
  });

  it('says nothing at a level that asks for nothing new', () => {
    expect(newPrimesOf(2)).toEqual([]); // iron plate: same prime as level 1
  });
});
