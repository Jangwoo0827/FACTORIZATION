import { describe, expect, it } from 'vitest';
import { ITEM_DEFS, ITEM_MAP, Item } from '../src/data/items';
import { RAW_PRIME_INDEX, RECIPES, RECIPE_BOOK } from '../src/data/recipes';
import {
  PRIMES,
  equals,
  factors,
  formatSignature,
  multiply,
  power,
  primeSignature,
  superscript,
  totalExponent,
  unit,
} from '../src/factor/signature';
import {
  RecipeBook,
  RecipeError,
  type FactorNode,
  type RecipeDef,
} from '../src/factor/recipeBook';
import { ITEM_COUNT, ORE_INFO, Ore } from '../src/sim/types';

/** `[2, 3, 5, 7, 11, 13]` exponents, written the way GDD 5.5 writes them. */
type Exps = [number, number, number, number, number, number];

/**
 * The signature table from GDD 5.5, transcribed independently of the code that
 * computes it. If the recipes and this table ever disagree, one of them is wrong,
 * and either way it needs a human to look.
 */
const GDD_TABLE: Readonly<Record<number, { exponents: Exps; raw: number }>> = {
  [Item.IronPlate]: { exponents: [1, 0, 0, 0, 0, 0], raw: 1 },
  [Item.CopperPlate]: { exponents: [0, 1, 0, 0, 0, 0], raw: 1 },
  [Item.CopperWire]: { exponents: [0, 1, 0, 0, 0, 0], raw: 1 },
  [Item.Gear]: { exponents: [2, 0, 0, 0, 0, 0], raw: 2 },
  [Item.StoneBrick]: { exponents: [0, 0, 0, 2, 0, 0], raw: 2 },
  [Item.Circuit]: { exponents: [1, 2, 0, 0, 0, 0], raw: 3 },
  [Item.Steel]: { exponents: [2, 0, 1, 0, 0, 0], raw: 3 },
  [Item.Silicon]: { exponents: [0, 0, 1, 0, 2, 0], raw: 3 },
  [Item.Motor]: { exponents: [6, 2, 1, 0, 0, 0], raw: 9 },
  [Item.MachineFrame]: { exponents: [4, 0, 2, 8, 0, 0], raw: 14 },
  [Item.Battery]: { exponents: [0, 3, 2, 0, 4, 0], raw: 9 },
  [Item.AdvancedCircuit]: { exponents: [2, 6, 2, 0, 4, 0], raw: 14 },
  [Item.OpticLens]: { exponents: [0, 0, 0, 0, 0, 2], raw: 2 },
  [Item.Processor]: { exponents: [4, 14, 6, 0, 12, 0], raw: 36 },
  [Item.PowerCore]: { exponents: [16, 16, 12, 0, 16, 0], raw: 60 },
  [Item.LogicCore]: { exponents: [16, 56, 24, 0, 48, 4], raw: 148 },
  [Item.GateComponent]: { exponents: [40, 72, 40, 16, 64, 4], raw: 236 },
};

describe('signature arithmetic', () => {
  it('has the primes 2, 3, 5, 7, 11, 13', () => {
    expect([...PRIMES]).toEqual([2, 3, 5, 7, 11, 13]);
  });

  it('makes a prime a unit vector', () => {
    expect([...primeSignature(2)]).toEqual([0, 0, 1, 0, 0, 0]);
  });

  it('multiplies by adding exponents', () => {
    // 2 * 2 * 3 = 2^2 * 3
    const twoTwoThree = multiply(multiply(primeSignature(0), primeSignature(0)), primeSignature(1));
    expect([...twoTwoThree]).toEqual([2, 1, 0, 0, 0, 0]);
  });

  it('raises to a power by scaling exponents', () => {
    const cubed = power(multiply(primeSignature(0), primeSignature(1)), 3); // (2*3)^3
    expect([...cubed]).toEqual([3, 3, 0, 0, 0, 0]);
  });

  it('treats the zeroth power as the number 1', () => {
    expect(equals(power(primeSignature(4), 0), unit())).toBe(true);
  });

  it('is commutative and associative, as multiplication is', () => {
    const a = multiply(primeSignature(0), power(primeSignature(1), 2));
    const b = power(primeSignature(2), 3);
    const c = primeSignature(4);
    expect(equals(multiply(a, b), multiply(b, a))).toBe(true);
    expect(equals(multiply(multiply(a, b), c), multiply(a, multiply(b, c)))).toBe(true);
  });

  it('distributes: (a * b)^n equals a^n * b^n', () => {
    const a = multiply(primeSignature(0), primeSignature(3));
    const b = power(primeSignature(1), 2);
    expect(equals(power(multiply(a, b), 5), multiply(power(a, 5), power(b, 5)))).toBe(true);
  });

  it('adds up exponents for the total', () => {
    expect(totalExponent(multiply(power(primeSignature(0), 4), power(primeSignature(5), 3)))).toBe(7);
  });

  it('rejects things that are not signatures', () => {
    expect(() => primeSignature(-1)).toThrow(RangeError);
    expect(() => primeSignature(6)).toThrow(RangeError);
    expect(() => primeSignature(1.5)).toThrow(RangeError);
    expect(() => power(unit(), -1)).toThrow(RangeError);
    expect(() => power(unit(), 0.5)).toThrow(RangeError);
  });

  it('does not mutate its inputs', () => {
    const a = primeSignature(0);
    const b = primeSignature(1);
    multiply(a, b);
    power(a, 9);
    expect([...a]).toEqual([1, 0, 0, 0, 0, 0]);
    expect([...b]).toEqual([0, 1, 0, 0, 0, 0]);
  });
});

describe('signature formatting', () => {
  it('writes superscript digits', () => {
    expect(superscript(2)).toBe('²');
    expect(superscript(40)).toBe('⁴⁰');
    expect(superscript(1234567890)).toBe('¹²³⁴⁵⁶⁷⁸⁹⁰');
  });

  it('leaves off an exponent of one', () => {
    expect(formatSignature(multiply(primeSignature(0), power(primeSignature(1), 2)))).toBe('2 · 3²');
  });

  it('writes the empty signature as 1', () => {
    expect(formatSignature(unit())).toBe('1');
  });

  it('formats the gate component the way the design document does', () => {
    expect(formatSignature(RECIPE_BOOK.signature(Item.GateComponent))).toBe(
      '2⁴⁰ · 3⁷² · 5⁴⁰ · 7¹⁶ · 11⁶⁴ · 13⁴',
    );
  });

  it('lists the non-zero factors with their primes', () => {
    const list = factors(RECIPE_BOOK.signature(Item.Circuit));
    expect(list).toEqual([
      { prime: 2, index: 0, exponent: 1 },
      { prime: 3, index: 1, exponent: 2 },
    ]);
  });
});

describe('item data', () => {
  it('gives every item a unique id, and none outside the lookup tables', () => {
    const ids = ITEM_DEFS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThan(ITEM_COUNT);
    }
  });

  it('numbers items contiguously, so ITEM_COUNT is exactly one more than the highest id', () => {
    expect(Math.max(...ITEM_DEFS.map((d) => d.id)) + 1).toBe(ITEM_COUNT);
    expect(ITEM_DEFS).toHaveLength(ITEM_COUNT - 1);
  });

  it('keeps raw materials on the same ids as the ores they are mined from', () => {
    expect(Item.IronOre).toBe(Ore.Iron);
    expect(Item.CopperOre).toBe(Ore.Copper);
    expect(Item.Coal).toBe(Ore.Coal);
    expect(Item.Stone).toBe(Ore.Stone);
    expect(Item.Sand).toBe(Ore.Sand);
    expect(Item.Quartz).toBe(Ore.Quartz);
  });

  it('agrees with the ore table on names and primes', () => {
    for (const [ore, info] of Object.entries(ORE_INFO)) {
      const item = ITEM_MAP.get(Number(ore))!;
      expect(item.name).toBe(info.name);
      expect(item.raw).toBe(true);
      expect(PRIMES[RAW_PRIME_INDEX.get(item.id)!]).toBe(info.prime);
    }
  });

  it('marks exactly the raw materials as raw', () => {
    for (const def of ITEM_DEFS) expect(def.raw).toBe(RECIPE_BOOK.isRaw(def.id));
  });

  it('gives every item a distinct colour, so two never look the same on a belt', () => {
    const colours = ITEM_DEFS.map((d) => d.color);
    expect(new Set(colours).size).toBe(colours.length);
  });
});

describe('recipe data', () => {
  it('has a recipe for every crafted item and none for a raw one', () => {
    for (const def of ITEM_DEFS) {
      expect(RECIPE_BOOK.recipe(def.id) !== undefined).toBe(!def.raw);
    }
  });

  it('never lists an item twice in one recipe', () => {
    for (const r of RECIPES) {
      const items = r.inputs.map((i) => i.item);
      expect(new Set(items).size).toBe(items.length);
    }
  });

  it('only asks for whole, positive amounts', () => {
    for (const r of RECIPES) {
      for (const i of r.inputs) {
        expect(Number.isInteger(i.count)).toBe(true);
        expect(i.count).toBeGreaterThan(0);
      }
    }
  });

  it('takes a sensible, positive time to craft', () => {
    for (const r of RECIPES) {
      expect(r.seconds).toBeGreaterThan(0);
      // Crafting is counted in whole ticks, so a time that is not a multiple of a
      // tick would silently round.
      expect(r.seconds * 30).toBeCloseTo(Math.round(r.seconds * 30), 9);
    }
  });
});

describe('the design-document signature table', () => {
  for (const [id, expected] of Object.entries(GDD_TABLE)) {
    const item = Number(id);
    const name = ITEM_MAP.get(item)!.name;

    it(`${name}: exponents match`, () => {
      expect([...RECIPE_BOOK.signature(item)]).toEqual(expected.exponents);
    });

    it(`${name}: costs ${expected.raw} raw materials`, () => {
      expect(RECIPE_BOOK.rawTotal(item)).toBe(expected.raw);
    });
  }

  it('covers every crafted item, so the table cannot silently fall behind', () => {
    const crafted = ITEM_DEFS.filter((d) => !d.raw).map((d) => d.id);
    expect(Object.keys(GDD_TABLE).map(Number).sort((a, b) => a - b)).toEqual(
      crafted.sort((a, b) => a - b),
    );
  });

  it('gives each raw material its prime', () => {
    expect([...RECIPE_BOOK.signature(Item.IronOre)]).toEqual([1, 0, 0, 0, 0, 0]);
    expect([...RECIPE_BOOK.signature(Item.Quartz)]).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

/** Raw materials in an item, counted by walking the ingredient tree. No signatures involved. */
function rawByWalking(node: FactorNode): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (n: FactorNode, multiplier: number): void => {
    if (n.children.length === 0) {
      out.set(n.item, (out.get(n.item) ?? 0) + multiplier);
      return;
    }
    for (const child of n.children) walk(child, multiplier * child.count);
  };
  walk(node, 1);
  return out;
}

describe('the central theorem: exponents are raw material counts', () => {
  // The whole design rests on this. Signatures are computed by multiplying, raw
  // counts here are computed by walking the recipe tree and counting leaves; they
  // are two unrelated procedures and must agree for every item.
  for (const def of ITEM_DEFS.filter((d) => !d.raw)) {
    it(`${def.name}`, () => {
      const walked = rawByWalking(RECIPE_BOOK.expand(def.id));
      const fromSignature = RECIPE_BOOK.rawCost(def.id);

      expect([...fromSignature.entries()].sort()).toEqual([...walked.entries()].sort());
    });
  }

  it('gives a gate component that costs 236 raw materials in the amounts the design states', () => {
    const cost = RECIPE_BOOK.rawCost(Item.GateComponent);
    expect(Object.fromEntries(cost)).toEqual({
      [Item.IronOre]: 40,
      [Item.CopperOre]: 72,
      [Item.Coal]: 40,
      [Item.Stone]: 16,
      [Item.Sand]: 64,
      [Item.Quartz]: 4,
    });
  });
});

describe('rule R1: every recipe makes exactly one item', () => {
  it('is enforced by the type: a recipe has no output count to get wrong', () => {
    // A recipe that made two of something would need somewhere to say so. Here it
    // has nowhere, and this would not compile if it did:
    const recipe: RecipeDef = RECIPES[0]!;
    expect(Object.keys(recipe).sort()).toEqual(['inputs', 'machine', 'output', 'seconds', 'tier']);
  });

  it('gives each item one recipe, so an item and its recipe are the same thing', () => {
    const outputs = RECIPES.map((r) => r.output);
    expect(new Set(outputs).size).toBe(outputs.length);
  });

  it('keeps every exponent a whole number, which is what R1 protects', () => {
    for (const def of ITEM_DEFS) {
      for (const e of RECIPE_BOOK.signature(def.id)) {
        expect(Number.isInteger(e)).toBe(true);
        expect(e).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('RecipeBook validation', () => {
  const raw = new Map([
    [1, 0],
    [2, 1],
  ]);
  const good: RecipeDef = {
    output: 10,
    inputs: [{ item: 1, count: 2 }],
    seconds: 1,
    machine: 'assembler',
    tier: 1,
  };

  it('accepts a well-formed set', () => {
    expect(() => new RecipeBook([good], raw)).not.toThrow();
  });

  it('rejects two recipes for one item', () => {
    expect(() => new RecipeBook([good, { ...good, seconds: 2 }], raw)).toThrow(/more than one recipe/);
  });

  it('rejects crafting a raw material', () => {
    expect(() => new RecipeBook([{ ...good, output: 1 }], raw)).toThrow(/both a raw material and crafted/);
  });

  it('rejects an ingredient that nothing makes', () => {
    expect(
      () => new RecipeBook([{ ...good, inputs: [{ item: 99, count: 1 }] }], raw),
    ).toThrow(/nothing makes/);
  });

  it('rejects a zero, negative or fractional amount', () => {
    for (const count of [0, -1, 1.5]) {
      expect(
        () => new RecipeBook([{ ...good, inputs: [{ item: 1, count }] }], raw),
      ).toThrow(RecipeError);
    }
  });

  it('rejects a recipe with no ingredients, which would make something from nothing', () => {
    expect(() => new RecipeBook([{ ...good, inputs: [] }], raw)).toThrow(/no ingredients/);
  });

  it('rejects listing an ingredient twice', () => {
    expect(
      () =>
        new RecipeBook(
          [{ ...good, inputs: [{ item: 1, count: 1 }, { item: 1, count: 1 }] }],
          raw,
        ),
    ).toThrow(/twice/);
  });

  it('rejects a recipe that takes no time', () => {
    expect(() => new RecipeBook([{ ...good, seconds: 0 }], raw)).toThrow(/positive time/);
  });

  it('rejects a recipe that makes something out of itself', () => {
    expect(
      () => new RecipeBook([{ ...good, inputs: [{ item: 10, count: 1 }] }], raw),
    ).toThrow(RecipeError);
  });

  it('rejects a loop through several recipes', () => {
    const a: RecipeDef = { ...good, output: 10, inputs: [{ item: 11, count: 1 }] };
    const b: RecipeDef = { ...good, output: 11, inputs: [{ item: 10, count: 1 }] };
    expect(() => new RecipeBook([a, b], raw)).toThrow(/loop/);
  });

  it('rejects two raw materials sharing a prime', () => {
    expect(
      () =>
        new RecipeBook(
          [good],
          new Map([
            [1, 0],
            [2, 0],
          ]),
        ),
    ).toThrow(/more than one raw material/);
  });

  it('rejects a prime that does not exist', () => {
    expect(() => new RecipeBook([good], new Map([[1, 6]]))).toThrow(RecipeError);
  });

  it('orders ingredients before what is made from them, regardless of listing order', () => {
    const top: RecipeDef = { ...good, output: 12, inputs: [{ item: 11, count: 1 }] };
    const mid: RecipeDef = { ...good, output: 11, inputs: [{ item: 10, count: 1 }] };
    const base: RecipeDef = { ...good, output: 10, inputs: [{ item: 1, count: 1 }] };
    const book = new RecipeBook([top, mid, base], raw);
    expect(book.craftable).toEqual([10, 11, 12]);
  });
});

describe('the ingredient tree', () => {
  it('expands a gate component into its three parts, with the frame twice', () => {
    const root = RECIPE_BOOK.expand(Item.GateComponent);
    expect(root.item).toBe(Item.GateComponent);
    expect(root.children.map((c) => [c.item, c.count])).toEqual([
      [Item.PowerCore, 1],
      [Item.LogicCore, 1],
      [Item.MachineFrame, 2],
    ]);
  });

  it('ends every branch at a raw material', () => {
    const check = (n: FactorNode): void => {
      if (n.children.length === 0) expect(RECIPE_BOOK.isRaw(n.item)).toBe(true);
      else n.children.forEach(check);
    };
    check(RECIPE_BOOK.expand(Item.GateComponent));
  });

  it('is a single leaf for a raw material', () => {
    const node = RECIPE_BOOK.expand(Item.Coal);
    expect(node.children).toHaveLength(0);
    expect(node.recipe).toBeNull();
  });
});

describe('production requirements', () => {
  const rate = (rows: ReturnType<typeof RECIPE_BOOK.requirements>, item: number) =>
    rows.find((r) => r.item === item)!.perSecond;

  it('asks for the raw materials the design states for the final target', () => {
    // GDD 5.5: 6 gate components a minute is 1,416 raw materials a minute, 23.6 a second.
    const rows = RECIPE_BOOK.requirements(Item.GateComponent, 6);

    expect(rate(rows, Item.IronOre)).toBeCloseTo(4, 9);
    expect(rate(rows, Item.CopperOre)).toBeCloseTo(7.2, 9);
    expect(rate(rows, Item.Coal)).toBeCloseTo(4, 9);
    expect(rate(rows, Item.Stone)).toBeCloseTo(1.6, 9);
    expect(rate(rows, Item.Sand)).toBeCloseTo(6.4, 9);
    expect(rate(rows, Item.Quartz)).toBeCloseTo(0.4, 9);

    const rawTotal = rows.filter((r) => r.recipe === null).reduce((a, r) => a + r.perSecond, 0);
    expect(rawTotal).toBeCloseTo(23.6, 9);
  });

  it('agrees with the signature for any item and any rate', () => {
    // Requirements are computed by walking the tree; the signature by multiplying.
    for (const def of ITEM_DEFS.filter((d) => !d.raw)) {
      const rows = RECIPE_BOOK.requirements(def.id, 30);
      const sig = RECIPE_BOOK.signature(def.id);
      for (const [rawItem, index] of RAW_PRIME_INDEX) {
        const expected = (sig[index]! * 30) / 60;
        const got = rows.find((r) => r.item === rawItem)?.perSecond ?? 0;
        expect(got).toBeCloseTo(expected, 9);
      }
    }
  });

  it('scales linearly with the target rate', () => {
    const one = RECIPE_BOOK.requirements(Item.Motor, 10);
    const three = RECIPE_BOOK.requirements(Item.Motor, 30);
    for (const row of one) expect(rate(three, row.item)).toBeCloseTo(row.perSecond * 3, 9);
  });

  it('sums an item used in several places into one row', () => {
    const rows = RECIPE_BOOK.requirements(Item.GateComponent, 6);
    const items = rows.map((r) => r.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it('counts machines from craft time, since one craft makes one item', () => {
    // 60 iron plates a minute is 1 a second; each takes 1.6 s, so 1.6 smelters.
    const rows = RECIPE_BOOK.requirements(Item.IronPlate, 60);
    expect(rows.find((r) => r.item === Item.IronPlate)!.machines).toBeCloseTo(1.6, 9);
  });

  it('needs fewer machines when they are faster', () => {
    // Steel needs a Mk2 smelter, which runs at double speed: 4 s / 2 = 2 s per plate.
    const rows = RECIPE_BOOK.requirements(Item.Steel, 60);
    expect(rows.find((r) => r.item === Item.Steel)!.machines).toBeCloseTo(2, 9);
  });

  it('lists raw materials first, then crafted items in the order they are made', () => {
    const rows = RECIPE_BOOK.requirements(Item.Circuit, 60);
    const firstCrafted = rows.findIndex((r) => r.recipe !== null);
    expect(rows.slice(0, firstCrafted).every((r) => r.recipe === null)).toBe(true);
    expect(rows.slice(firstCrafted).every((r) => r.recipe !== null)).toBe(true);
    // Wire is made before the circuit that uses it.
    const order = rows.map((r) => r.item);
    expect(order.indexOf(Item.CopperWire)).toBeLessThan(order.indexOf(Item.Circuit));
  });

  it('rejects a rate that is not positive', () => {
    expect(() => RECIPE_BOOK.requirements(Item.Gear, 0)).toThrow(RangeError);
    expect(() => RECIPE_BOOK.requirements(Item.Gear, -5)).toThrow(RangeError);
  });
});

describe('what each machine can make', () => {
  it('offers a Mk1 smelter the recipes it can run and not the Mk2 ones', () => {
    const items = RECIPE_BOOK.recipesFor('smelter', 1).map((r) => r.output);
    expect(items).toEqual([Item.IronPlate, Item.CopperPlate, Item.StoneBrick]);
  });

  it('offers a Mk2 smelter everything a Mk1 can plus steel, silicon and lenses', () => {
    const items = RECIPE_BOOK.recipesFor('smelter', 2).map((r) => r.output);
    expect(items).toEqual(
      expect.arrayContaining([Item.IronPlate, Item.Steel, Item.Silicon, Item.OpticLens]),
    );
  });

  it('never offers a smelter an assembler recipe, or the reverse', () => {
    for (const r of RECIPE_BOOK.recipesFor('smelter', 2)) expect(r.machine).toBe('smelter');
    for (const r of RECIPE_BOOK.recipesFor('assembler', 2)) expect(r.machine).toBe('assembler');
  });

  it('offers a Mk1 assembler the early recipes only', () => {
    const items = RECIPE_BOOK.recipesFor('assembler', 1).map((r) => r.output);
    expect(items).toContain(Item.Gear);
    expect(items).toContain(Item.Circuit);
    expect(items).not.toContain(Item.Processor);
    expect(items).not.toContain(Item.GateComponent);
  });
});
