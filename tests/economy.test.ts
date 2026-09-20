import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/core/rng';
import { BUILDING_DEFS, BUILDABLE_DEFS } from '../src/data/buildings';
import { STARTING_STOCK } from '../src/data/economy';
import { ITEM_MAP, Item } from '../src/data/items';
import {
  CompositeCommand,
  History,
  PlaceCommand,
  RemoveCommand,
  SetRecipeCommand,
} from '../src/input/commands';
import { Builder } from '../src/sim/builder';
import { Sieve } from '../src/sim/sieve';
import { ITEM_COUNT, Ore } from '../src/sim/types';
import { HUB_STOCK_CAP } from '../src/config';
import { makeWorld, place } from './helpers';

/** A builder over an empty map, with the starting stock and nothing else. */
function setup(stock: readonly { item: number; count: number }[] = STARTING_STOCK) {
  const world = makeWorld(24);
  const sieve = new Sieve();
  for (const { item, count } of stock) sieve.addStock(item, count);
  const builder = new Builder(world, sieve);
  const history = new History();
  return { world, sieve, builder, history };
}

const plates = (sieve: Sieve) => sieve.stock[Item.IronPlate]!;

describe('what things cost', () => {
  it('prices everything the player can build', () => {
    for (const def of BUILDABLE_DEFS) {
      expect(def.cost, def.id).toBeDefined();
      expect(def.cost!.length, def.id).toBeGreaterThan(0);
    }
  });

  it('gives every price line a real item and a positive whole amount', () => {
    for (const def of BUILDING_DEFS) {
      for (const { item, count } of def.cost ?? []) {
        expect(ITEM_MAP.has(item), `${def.id}: item ${item}`).toBe(true);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the hub free, since the game places it', () => {
    expect(BUILDING_DEFS.find((d) => d.id === 'hub')!.cost).toBeUndefined();
  });

  it('matches the design document', () => {
    const cost = (id: string) =>
      Object.fromEntries((BUILDING_DEFS.find((d) => d.id === id)!.cost ?? []).map((c) => [c.item, c.count]));

    expect(cost('miner')).toEqual({ [Item.IronPlate]: 8 });
    expect(cost('smelter')).toEqual({ [Item.IronPlate]: 10, [Item.Stone]: 5 });
    expect(cost('assembler')).toEqual({ [Item.IronPlate]: 15, [Item.CopperPlate]: 10 });
    expect(cost('splitter')).toEqual({ [Item.IronPlate]: 3 });
    expect(cost('tunnel-in')).toEqual({ [Item.IronPlate]: 4 });
    expect(cost('tunnel-out')).toEqual({ [Item.IronPlate]: 4 });
  });

  it('starts the player with 100 iron plates, 20 copper plates and 20 stone', () => {
    const { sieve } = setup();
    expect(sieve.stock[Item.IronPlate]).toBe(100);
    expect(sieve.stock[Item.CopperPlate]).toBe(20);
    expect(sieve.stock[Item.Stone]).toBe(20);
  });

  it('is enough to get going: a miner, a smelter and a run of belts', () => {
    const { sieve } = setup();
    const need = (id: string) => BUILDING_DEFS.find((d) => d.id === id)!.cost!;
    const afford = [...need('miner'), ...need('smelter')];
    expect(sieve.canAfford(afford)).toBe(true);
  });

  it('only asks for things the player can get without already having them', () => {
    // Plates cannot be mined; if a starting building cost something outside the
    // starting stock and not obtainable early, the game could not begin.
    const obtainable = new Set<number>([Item.IronPlate, Item.CopperPlate, Item.Stone]);
    for (const def of BUILDABLE_DEFS) {
      for (const { item } of def.cost!) expect(obtainable.has(item), `${def.id} needs ${item}`).toBe(true);
    }
  });
});

describe('building costs stock', () => {
  it('takes the price from stock when something is placed', () => {
    const { world, sieve, builder } = setup();
    expect(builder.place('miner', 3, 3, 0)).toBeNull(); // no ore here
    world.setOre(3, 3, Ore.Iron);

    const before = plates(sieve);
    const placed = builder.place('miner', 3, 3, 0);

    expect(placed).not.toBeNull();
    expect(plates(sieve)).toBe(before - 8);
  });

  it('never touches the delivered total, so building cannot set mission progress back', () => {
    const { sieve, builder } = setup();
    sieve.receive(Item.IronPlate);
    sieve.receive(Item.IronPlate);
    const delivered = sieve.delivered[Item.IronPlate];

    builder.place('conveyor', 1, 1, 0);
    builder.place('conveyor', 2, 1, 0);

    expect(sieve.delivered[Item.IronPlate]).toBe(delivered);
  });

  it('refuses when the stock is short, and changes nothing', () => {
    const { world, sieve, builder } = setup([{ item: Item.IronPlate, count: 5 }]);
    const stockBefore = plates(sieve);

    expect(builder.place('smelter', 5, 5, 0)).toBeNull(); // needs 10 plates and 5 stone
    expect(world.buildingCount).toBe(0);
    expect(plates(sieve)).toBe(stockBefore);
  });

  it('reports what is missing', () => {
    const { builder } = setup([{ item: Item.IronPlate, count: 5 }]);
    expect(builder.shortfall('smelter')).toEqual({ item: Item.IronPlate, need: 10, have: 5 });
    expect(builder.shortfall('conveyor')).toBeNull();
  });

  it('checks the map before the stock, so the first fix the player needs is the one shown', () => {
    const { world, builder } = setup([]); // nothing in stock at all
    const first = builder.checkPlacement('conveyor', 4, 4, 0);
    expect(first).toEqual({ ok: false, reason: 'cannot-afford' });

    // Once the tile is also blocked, that is what is reported.
    place(world, 'conveyor', 4, 4, 0);
    expect(builder.checkPlacement('conveyor', 4, 4, 0)).toEqual({ ok: false, reason: 'occupied' });
  });

  it('does not charge for a placement the map rejects', () => {
    const { sieve, builder } = setup();
    const before = plates(sieve);
    expect(builder.place('conveyor', -5, 3, 0)).toBeNull(); // off the map
    expect(plates(sieve)).toBe(before);
  });

  it('lets the starting plates buy exactly one belt each', () => {
    const { sieve, builder } = setup([{ item: Item.IronPlate, count: 100 }]);
    let placed = 0;
    for (let i = 0; i < 200; i++) {
      if (builder.place('conveyor', i % 24, Math.floor(i / 24), 0)) placed++;
    }
    expect(placed).toBe(100);
    expect(plates(sieve)).toBe(0);
  });
});

describe('demolishing refunds in full', () => {
  it('gives back the whole price', () => {
    const { sieve, builder } = setup();
    const before = plates(sieve);
    const placed = builder.place('conveyor', 2, 2, 0)!;
    expect(plates(sieve)).toBe(before - 1);

    builder.remove(placed.id);
    expect(plates(sieve)).toBe(before);
  });

  it('refunds a multi-item price in every item', () => {
    const { sieve, builder } = setup();
    const before = { plates: plates(sieve), stone: sieve.stock[Item.Stone]! };
    const smelter = builder.place('smelter', 5, 5, 0)!;
    expect(plates(sieve)).toBe(before.plates - 10);
    expect(sieve.stock[Item.Stone]).toBe(before.stone - 5);

    builder.remove(smelter.id);
    expect(plates(sieve)).toBe(before.plates);
    expect(sieve.stock[Item.Stone]).toBe(before.stone);
  });

  it('cannot remove the hub', () => {
    const { world, sieve, builder } = setup();
    const hub = world.place('hub', 10, 10, 0)!;
    const before = plates(sieve);

    expect(builder.remove(hub.id)).toBeNull();
    expect(world.buildingById(hub.id)).not.toBeNull();
    expect(plates(sieve)).toBe(before);
  });

  it('caps a refund at the stock ceiling instead of overflowing it', () => {
    const { sieve, builder } = setup([{ item: Item.IronPlate, count: 10 }]);
    const placed = builder.place('miner', 3, 3, 0);
    expect(placed).toBeNull(); // no ore; place something else
    const belt = builder.place('conveyor', 3, 3, 0)!;

    sieve.addStock(Item.IronPlate, HUB_STOCK_CAP); // now at the ceiling
    builder.remove(belt.id);

    expect(plates(sieve)).toBe(HUB_STOCK_CAP);
  });

  it('returns null for something that is not there', () => {
    const { builder } = setup();
    expect(builder.remove(9999)).toBeNull();
  });
});

describe('undo and redo cost like any other build', () => {
  it('gives back the price on undoing a placement and takes it again on redo', () => {
    const { sieve, builder, history } = setup();
    const before = plates(sieve);

    history.execute(new PlaceCommand('conveyor', 2, 2, 0), builder);
    expect(plates(sieve)).toBe(before - 1);

    expect(history.undo(builder)).toBe('done');
    expect(plates(sieve)).toBe(before);

    expect(history.redo(builder)).toBe('done');
    expect(plates(sieve)).toBe(before - 1);
  });

  it('charges again on undoing a demolition', () => {
    const { sieve, builder, history } = setup();
    const belt = builder.place('conveyor', 2, 2, 0)!;
    const withBelt = plates(sieve);

    history.execute(new RemoveCommand(belt), builder);
    expect(plates(sieve)).toBe(withBelt + 1);

    history.undo(builder);
    expect(plates(sieve)).toBe(withBelt);
  });

  it('cannot print money: remove, spend the refund, then undo must fail', () => {
    // The exploit this rules out: demolish for a full refund, spend it, undo the
    // demolition for free. Undo would then be a way to keep both.
    const { world, sieve, builder, history } = setup([{ item: Item.IronPlate, count: 4 }]);
    const smelterCost = 0; // conveyors only, to keep the arithmetic plain
    void smelterCost;
    const belts = [0, 1, 2, 3].map((i) => builder.place('conveyor', i, 0, 0)!);
    expect(plates(sieve)).toBe(0);

    history.execute(new RemoveCommand(belts[0]!), builder); // refund 1 plate
    expect(plates(sieve)).toBe(1);
    builder.place('conveyor', 10, 10, 0); // spend it somewhere else
    expect(plates(sieve)).toBe(0);

    expect(history.undo(builder)).toBe('blocked');
    // Nothing changed: the belt stays removed and no plate appeared from nowhere.
    expect(world.buildingAt(0, 0)).toBeNull();
    expect(plates(sieve)).toBe(0);
    expect(history.canUndo).toBe(true);
  });

  it('succeeds on a later try once the stock is back', () => {
    const { world, sieve, builder, history } = setup([{ item: Item.IronPlate, count: 2 }]);
    const a = builder.place('conveyor', 0, 0, 0)!;
    builder.place('conveyor', 1, 0, 0);
    history.execute(new RemoveCommand(a), builder);
    const other = builder.place('conveyor', 5, 5, 0)!; // spend the refund
    expect(history.undo(builder)).toBe('blocked');

    builder.remove(other.id); // refund it
    expect(history.undo(builder)).toBe('done');
    expect(world.buildingAt(0, 0)).not.toBeNull();
    expect(plates(sieve)).toBe(0);
  });

  it('blocks a redo that has become unaffordable, and keeps it available', () => {
    const { world, sieve, builder, history } = setup([{ item: Item.IronPlate, count: 2 }]);
    history.execute(new PlaceCommand('conveyor', 0, 0, 0), builder);
    history.undo(builder);
    expect(plates(sieve)).toBe(2);

    builder.place('conveyor', 8, 8, 0);
    builder.place('conveyor', 9, 8, 0); // stock now 0

    expect(history.redo(builder)).toBe('blocked');
    expect(world.buildingAt(0, 0)).toBeNull();
    expect(history.canRedo).toBe(true);
  });

  it('undoes a whole stroke, or none of it', () => {
    const { world, sieve, builder, history } = setup([{ item: Item.IronPlate, count: 5 }]);
    const stroke = [0, 1, 2, 3, 4].map((i) => new PlaceCommand('conveyor', i, 0, 0));
    for (const c of stroke) c.redo(builder);
    history.record(new CompositeCommand(stroke));
    history.undo(builder);
    expect(world.buildingCount).toBe(0);
    expect(plates(sieve)).toBe(5);

    // Spend enough that the stroke no longer fits: 5 belts need 5 plates, 4 remain.
    builder.place('conveyor', 10, 10, 0);
    expect(plates(sieve)).toBe(4);

    expect(history.redo(builder)).toBe('blocked');
    // None of the five went down, and nothing was charged for them.
    expect(world.buildingCount).toBe(1);
    expect(plates(sieve)).toBe(4);
  });

  it('puts back what a stroke had already reversed when the rest cannot be', () => {
    const { world, sieve, builder, history } = setup([{ item: Item.IronPlate, count: 6 }]);
    const [a, b, c] = [0, 1, 2].map((i) => builder.place('conveyor', i, 0, 0)!);
    history.execute(new CompositeCommand([new RemoveCommand(a!), new RemoveCommand(b!), new RemoveCommand(c!)]), builder);
    expect(world.buildingCount).toBe(0);
    expect(plates(sieve)).toBe(6);

    // Undoing needs 3 plates back; leave only 2.
    builder.place('conveyor', 10, 10, 0);
    builder.place('conveyor', 11, 10, 0);
    builder.place('conveyor', 12, 10, 0);
    builder.place('conveyor', 13, 10, 0);
    expect(plates(sieve)).toBe(2);

    expect(history.undo(builder)).toBe('blocked');
    // All-or-nothing: none of the three came back, and the stock is untouched.
    expect(world.buildingAt(0, 0)).toBeNull();
    expect(world.buildingAt(1, 0)).toBeNull();
    expect(world.buildingAt(2, 0)).toBeNull();
    expect(plates(sieve)).toBe(2);
  });

  it('changes a recipe for free and can undo it', () => {
    const { world, builder, history } = setup();
    const smelter = builder.place('smelter', 5, 5, 0)!;
    expect(world.recipeOf(smelter.id)).toBe(0);

    history.execute(new SetRecipeCommand(smelter.id, Item.IronPlate, 0), builder);
    expect(world.recipeOf(smelter.id)).toBe(Item.IronPlate);

    history.undo(builder);
    expect(world.recipeOf(smelter.id)).toBe(0);
  });
});

describe('hand mining', () => {
  it('adds to stock without counting as delivered', () => {
    // It is not production, so it must not advance a mission (GDD 6.3).
    const sieve = new Sieve();
    sieve.addStock(Item.Stone, 3);
    expect(sieve.stock[Item.Stone]).toBe(3);
    expect(sieve.delivered[Item.Stone]).toBe(0);
  });

  it('respects the stock ceiling', () => {
    const sieve = new Sieve();
    sieve.addStock(Item.Stone, HUB_STOCK_CAP + 10);
    expect(sieve.stock[Item.Stone]).toBe(HUB_STOCK_CAP);
  });
});

describe('conservation of materials', () => {
  // Whatever mix of building, demolishing, undoing and redoing the player does, the
  // stock plus the price of everything standing on the map must equal what they
  // started with. If materials could appear or vanish anywhere in that machinery,
  // this is where it would show.
  it('holds through thousands of random operations', () => {
    const rng = mulberry32(20260919);
    const { world, sieve, builder, history } = setup();
    const start = Int32Array.from(sieve.stock);
    for (let x = 0; x < 24; x++) for (let y = 0; y < 24; y++) world.setOre(x, y, Ore.Iron);

    const defs = ['conveyor', 'splitter', 'tunnel-in', 'miner', 'smelter', 'assembler'];

    const standing = (): Int32Array => {
      const total = new Int32Array(ITEM_COUNT);
      for (const b of world.buildings()) {
        for (const { item, count } of builder.costOf(b.defId)) total[item]! += count;
      }
      return total;
    };

    const check = (label: string): void => {
      const held = standing();
      for (let item = 0; item < ITEM_COUNT; item++) {
        expect(sieve.stock[item], `${label}: stock of ${item} went negative`).toBeGreaterThanOrEqual(0);
        expect(sieve.stock[item]! + held[item]!, `${label}: item ${item} not conserved`).toBe(start[item]);
      }
    };

    const tally = { placed: 0, removed: 0, undone: 0, redone: 0, blocked: 0, refused: 0 };
    for (let step = 0; step < 4000; step++) {
      const roll = rng();
      if (roll < 0.45) {
        const id = defs[Math.floor(rng() * defs.length)]!;
        const cmd = new PlaceCommand(id, Math.floor(rng() * 22), Math.floor(rng() * 22), 0);
        if (history.execute(cmd, builder)) tally.placed++;
        else tally.refused++;
      } else if (roll < 0.65) {
        const all = [...world.buildings()];
        if (all.length > 0) {
          const victim = all[Math.floor(rng() * all.length)]!;
          if (history.execute(new RemoveCommand(victim), builder)) tally.removed++;
        }
      } else if (roll < 0.8) {
        const r = history.undo(builder);
        if (r === 'done') tally.undone++;
        if (r === 'blocked') tally.blocked++;
      } else if (roll < 0.86) {
        // A build that bypasses history, so it can spend stock or take a tile that a
        // later undo or redo needs. Strict undo order restores stock exactly, so this
        // is the only way to make one of those blocked.
        const id = defs[Math.floor(rng() * defs.length)]!;
        builder.place(id, Math.floor(rng() * 22), Math.floor(rng() * 22), 0);
      } else {
        const r = history.redo(builder);
        if (r === 'done') tally.redone++;
        if (r === 'blocked') tally.blocked++;
      }
      check(`step ${step}`);
    }

    // A run that never exercised the interesting paths would prove nothing.
    expect(tally.placed).toBeGreaterThan(200);
    expect(tally.removed).toBeGreaterThan(100);
    expect(tally.undone).toBeGreaterThan(100);
    expect(tally.redone).toBeGreaterThan(50);
    expect(tally.refused).toBeGreaterThan(20);
    expect(tally.blocked).toBeGreaterThan(0);
  });
});
