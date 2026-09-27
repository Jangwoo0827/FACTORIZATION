import { describe, expect, it } from 'vitest';
import { Item, ITEM_DEFS, itemName } from '../src/data/items';
import { RECIPE_BOOK } from '../src/data/recipes';
import { buildFactorModel, compareWithActual, equationOf } from '../src/factor/view';

const MINER = 0.5;
const model = (item: number, perMinute = 6) => buildFactorModel(RECIPE_BOOK, item, perMinute, itemName, MINER);

describe('the factorisation view model', () => {
  it('spells out a gate component as an equation, with repeated parts as powers', () => {
    expect(model(Item.GateComponent).equation).toBe('게이트 부품 = 파워 코어 × 로직 코어 × 기계 프레임²');
  });

  it('writes a raw material as its prime', () => {
    expect(equationOf(RECIPE_BOOK, Item.IronOre, itemName)).toBe('철광석 = 소수 2');
    expect(equationOf(RECIPE_BOOK, Item.Quartz, itemName)).toBe('석영 = 소수 13');
  });

  it('shows the signature the design states for the gate component', () => {
    expect(model(Item.GateComponent).signatureText).toBe('2⁴⁰ · 3⁷² · 5⁴⁰ · 7¹⁶ · 11⁶⁴ · 13⁴');
  });

  it('breaks the signature into one chip per prime, each tied to its raw material', () => {
    const chips = model(Item.GateComponent).chips;
    expect(chips.map((c) => [c.prime, c.exponent, c.rawItem])).toEqual([
      [2, 40, Item.IronOre],
      [3, 72, Item.CopperOre],
      [5, 40, Item.Coal],
      [7, 16, Item.Stone],
      [11, 64, Item.Sand],
      [13, 4, Item.Quartz],
    ]);
  });

  it('gives a chip only for the primes an item actually contains', () => {
    expect(model(Item.Gear).chips).toHaveLength(1);
    expect(model(Item.Circuit).chips).toHaveLength(2);
  });

  it('reports the raw total as the sum of the exponents', () => {
    expect(model(Item.GateComponent).rawTotal).toBe(236);
    expect(model(Item.Gear).rawTotal).toBe(2);
  });

  it('lists the ingredient tree depth first, starting at the item itself', () => {
    const tree = model(Item.Gear).tree;
    expect(tree.map((l) => [l.depth, l.item, l.count])).toEqual([
      [0, Item.Gear, 1],
      [1, Item.IronPlate, 2],
      [2, Item.IronOre, 1],
    ]);
  });

  it('marks which tree lines are crafted and which are raw', () => {
    const tree = model(Item.Gear).tree;
    expect(tree.map((l) => l.craftable)).toEqual([true, true, false]);
  });

  it('ends every branch of the gate component tree at a raw material', () => {
    const tree = model(Item.GateComponent).tree;
    for (let i = 0; i < tree.length; i++) {
      const line = tree[i]!;
      const next = tree[i + 1];
      const isLeaf = !next || next.depth <= line.depth;
      if (isLeaf) expect(line.craftable).toBe(false);
    }
  });

  it('lists every distinct item once in the requirements', () => {
    const items = model(Item.GateComponent).rows.map((r) => r.item);
    expect(new Set(items).size).toBe(items.length);
  });

  it('turns a raw rate into miners at the given miner speed', () => {
    // 6 gate components a minute need 4 iron ore a second; one miner makes 0.5.
    const iron = model(Item.GateComponent).rows.find((r) => r.item === Item.IronOre)!;
    expect(iron.perSecond).toBeCloseTo(4, 9);
    expect(iron.miners).toBeCloseTo(8, 9);
    expect(iron.machine).toBeNull();
  });

  it('rounds machine counts up but not on rounding noise', () => {
    // 2 machines exactly must read as 2, never 3.
    const steel = model(Item.Steel, 60).rows.find((r) => r.item === Item.Steel)!;
    expect(steel.machines).toBeCloseTo(2, 9);
    expect(steel.machinesWhole).toBe(2);

    // 1.6 machines needs 2.
    const plate = model(Item.IronPlate, 60).rows.find((r) => r.item === Item.IronPlate)!;
    expect(plate.machinesWhole).toBe(2);
  });

  it('names the class and tier of machine each crafted row needs', () => {
    const rows = model(Item.Circuit, 30).rows;
    expect(rows.find((r) => r.item === Item.IronPlate)!.machine).toEqual({ class: 'smelter', tier: 1 });
    expect(rows.find((r) => r.item === Item.Circuit)!.machine).toEqual({ class: 'assembler', tier: 1 });
    expect(rows.find((r) => r.item === Item.Steel)).toBeUndefined();
  });

  it('carries the rate it was asked for', () => {
    expect(model(Item.Gear, 45).perMinute).toBe(45);
    expect(model(Item.Gear, 60).rows.find((r) => r.item === Item.Gear)!.perMinute).toBeCloseTo(60, 9);
  });

  it('builds a model for every crafted item without error', () => {
    for (const def of ITEM_DEFS.filter((d) => !d.raw)) {
      const m = model(def.id, 12);
      expect(m.tree.length).toBeGreaterThan(1);
      expect(m.chips.length).toBeGreaterThan(0);
      expect(m.signatureText).not.toBe('1');
    }
  });
});

describe('comparing the chain with what the factory makes', () => {
  // Circuits at 30/min: 30 iron plate, 60 copper wire, 60 copper plate, 30 iron ore, 60 copper ore.
  const circuits = model(Item.Circuit, 30);
  const need = new Map(circuits.rows.map((r) => [r.item, r.perMinute]));
  const compare = (overrides: Record<number, number>) =>
    compareWithActual(circuits, RECIPE_BOOK, (item) => overrides[item] ?? need.get(item) ?? 0);
  const statuses = (overrides: Record<number, number>) =>
    Object.fromEntries([...compare(overrides)].map(([item, c]) => [itemName(item), c.status]));

  it('calls every stage fine when each makes what the target needs', () => {
    expect(new Set(Object.values(statuses({})))).toEqual(new Set(['ok']));
  });

  it('names the raw material as the cause when too little is mined, and everything above it as short', () => {
    const s = statuses({
      [Item.CopperOre]: 30,
      [Item.CopperPlate]: 30,
      [Item.CopperWire]: 30,
      [Item.Circuit]: 15,
    });
    expect(s[itemName(Item.CopperOre)]).toBe('bottleneck');
    expect(s[itemName(Item.CopperPlate)]).toBe('short');
    expect(s[itemName(Item.CopperWire)]).toBe('short');
    expect(s[itemName(Item.Circuit)]).toBe('short');
    // The iron side is untouched.
    expect(s[itemName(Item.IronOre)]).toBe('ok');
    expect(s[itemName(Item.IronPlate)]).toBe('ok');
  });

  it('names a middle stage as the cause when its inputs are plentiful but it makes too little', () => {
    const s = statuses({ [Item.CopperPlate]: 20, [Item.CopperWire]: 20, [Item.Circuit]: 10 });
    expect(s[itemName(Item.CopperOre)]).toBe('ok');
    expect(s[itemName(Item.CopperPlate)]).toBe('bottleneck');
    expect(s[itemName(Item.CopperWire)]).toBe('short');
  });

  it('can name two separate causes at once', () => {
    const s = statuses({ [Item.IronOre]: 5, [Item.IronPlate]: 5, [Item.CopperWire]: 10, [Item.Circuit]: 5 });
    expect(s[itemName(Item.IronOre)]).toBe('bottleneck');
    expect(s[itemName(Item.CopperWire)]).toBe('bottleneck');
    expect(s[itemName(Item.Circuit)]).toBe('short');
  });

  it('forgives a reading a whisker under the target, but not a real shortfall', () => {
    const plates = model(Item.IronPlate, 37.5);
    const at = (rate: number) =>
      compareWithActual(plates, RECIPE_BOOK, (item) => (item === Item.IronPlate ? rate : 100)).get(Item.IronPlate)!.status;
    expect(at(37)).toBe('ok');
    expect(at(35)).toBe('bottleneck');
  });

  it('reports the need and the actual rate alongside the verdict', () => {
    const c = compare({ [Item.CopperOre]: 12 }).get(Item.CopperOre)!;
    expect(c).toMatchObject({ need: 60, actual: 12, status: 'bottleneck' });
  });

  it('with nothing built, blames only the raw materials', () => {
    const nothing = compareWithActual(circuits, RECIPE_BOOK, () => 0);
    for (const [item, c] of nothing) {
      expect(c.status, itemName(item)).toBe(RECIPE_BOOK.isRaw(item) ? 'bottleneck' : 'short');
    }
  });
});
