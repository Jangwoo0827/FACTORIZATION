import { describe, expect, it } from 'vitest';
import { SIM_TPS } from '../src/config';
import { Item } from '../src/data/items';
import { Simulation } from '../src/sim/simulation';
import { ProductionStats, STATS_HISTORY } from '../src/sim/stats';
import { Ore } from '../src/sim/types';
import { makeWorld, place, run, stepN } from './helpers';

const SECOND = SIM_TPS;

/** Records `seconds` seconds, producing `perSecond` of an item in each. */
function feed(stats: ProductionStats, item: number, perSecond: number, seconds: number): void {
  for (let s = 0; s < seconds; s++) {
    stats.produce(item, perSecond);
    stats.recordSecond();
  }
}

describe('ProductionStats', () => {
  it('reads zero until two snapshots exist', () => {
    const stats = new ProductionStats();
    stats.produce(Item.Gear, 10);
    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(0);
    stats.recordSecond();
    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(0);
  });

  it('turns a steady rate into items per minute, over whole seconds only', () => {
    const stats = new ProductionStats();
    stats.recordSecond(); // the starting point
    feed(stats, Item.Gear, 2, 60);
    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(120);

    // Made since the last snapshot but not yet recorded: not counted.
    stats.produce(Item.Gear, 100);
    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(120);
  });

  it('uses what history there is when the window is longer than the game so far', () => {
    const stats = new ProductionStats();
    stats.recordSecond();
    feed(stats, Item.Gear, 1, 10);
    expect(stats.seconds).toBe(10);
    expect(stats.producedPerMinute(Item.Gear, 3600)).toBe(60);
  });

  it('gives each window its own rate', () => {
    const stats = new ProductionStats();
    stats.recordSecond();
    feed(stats, Item.Gear, 1, 540); // nine slow minutes
    feed(stats, Item.Gear, 3, 60); // then one fast one

    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(180);
    expect(stats.producedPerMinute(Item.Gear, 600)).toBe((540 + 180) / 10);
  });

  it('keeps an hour and no more, still reading correctly after the ring wraps', () => {
    const stats = new ProductionStats();
    feed(stats, Item.Gear, 5, STATS_HISTORY + 500); // well past one lap
    expect(stats.seconds).toBe(STATS_HISTORY - 1);
    expect(stats.producedPerMinute(Item.Gear, 3600)).toBe(300);
    expect(stats.producedPerMinute(Item.Gear, 60)).toBe(300);
  });

  it('keeps produced and consumed apart, and items apart', () => {
    const stats = new ProductionStats();
    stats.recordSecond();
    for (let s = 0; s < 60; s++) {
      stats.produce(Item.IronPlate, 3);
      stats.consume(Item.IronPlate, 2);
      stats.produce(Item.Gear, 1);
      stats.recordSecond();
    }
    expect(stats.producedPerMinute(Item.IronPlate, 60)).toBe(180);
    expect(stats.consumedPerMinute(Item.IronPlate, 60)).toBe(120);
    expect(stats.consumedPerMinute(Item.Gear, 60)).toBe(0);
    expect(stats.activeItems()).toEqual([Item.IronPlate, Item.Gear]);
  });

  it('draws a series oldest first that shows a change in rate', () => {
    const stats = new ProductionStats();
    stats.recordSecond();
    feed(stats, Item.Gear, 1, 30);
    feed(stats, Item.Gear, 4, 30);

    const series = stats.producedSeries(Item.Gear, 60, 2);
    expect(series).toEqual([60, 240]);
  });

  it('leaves the part of a series older than the history at zero', () => {
    const stats = new ProductionStats();
    stats.recordSecond();
    feed(stats, Item.Gear, 1, 30);
    expect(stats.producedSeries(Item.Gear, 60, 2)).toEqual([0, 60]);
  });
});

describe('what the simulation counts', () => {
  it('counts ore a miner digs at its real rate: four iron tiles are 30 a minute', () => {
    const world = makeWorld(48);
    for (let y = 10; y < 12; y++) for (let x = 10; x < 12; x++) world.setOre(x, y, Ore.Iron);
    place(world, 'miner', 10, 10);
    run(world, 12, 10, 8, 0);
    place(world, 'hub', 20, 9);
    const sim = new Simulation(world);

    stepN(sim, 120 * SECOND);
    expect(sim.stats.producedPerMinute(Item.IronOre, 60)).toBe(30);
  });

  it('counts a smelter making plates and using ore, 37.5 a minute each', () => {
    const world = makeWorld(48);
    const smelter = place(world, 'smelter', 10, 6);
    run(world, 12, 6, 8, 0);
    place(world, 'hub', 20, 5);
    world.setRecipe(smelter, Item.IronPlate);
    const sim = new Simulation(world);
    sim.sync();

    for (let t = 0; t < 660 * SECOND; t++) {
      sim.machines.accept(smelter, Item.IronOre);
      sim.step();
    }
    // 1.6 s a plate: 37.5 a minute, and one ore used per plate. Plates come whole, so a
    // one-minute window reads 37 or 38; ten minutes pins the average to within 0.1.
    expect(Math.abs(sim.stats.producedPerMinute(Item.IronPlate, 600) - 37.5)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(sim.stats.consumedPerMinute(Item.IronOre, 600) - 37.5)).toBeLessThanOrEqual(0.1);
    expect([37, 38]).toContain(sim.stats.producedPerMinute(Item.IronPlate, 60));
    // Over a long window the two agree exactly, plus or minus the craft in progress.
    const made = sim.stats.produced[Item.IronPlate]!;
    const used = sim.stats.consumed[Item.IronOre]!;
    expect(used - made).toBeGreaterThanOrEqual(0);
    expect(used - made).toBeLessThanOrEqual(1);
  });

  it('counts every ingredient of a multi-input recipe by its amount', () => {
    const world = makeWorld(48);
    const assembler = place(world, 'assembler', 10, 6);
    world.setRecipe(assembler, Item.Circuit); // 1 iron plate + 2 copper wire
    const sim = new Simulation(world);
    sim.sync();

    sim.machines.accept(assembler, Item.IronPlate);
    sim.machines.accept(assembler, Item.CopperWire);
    sim.machines.accept(assembler, Item.CopperWire);
    sim.step();

    expect(sim.stats.consumed[Item.IronPlate]).toBe(1);
    expect(sim.stats.consumed[Item.CopperWire]).toBe(2);
  });

  it('counts coal a generator burns as consumed', () => {
    const world = makeWorld(48);
    const generator = place(world, 'generator', 10, 10);
    const sim = new Simulation(world);
    sim.sync();

    sim.power.accept(generator, Item.Coal);
    sim.power.accept(generator, Item.Coal);
    stepN(sim, 7 * SECOND); // the first burns at once, the second after 6 s

    expect(sim.stats.consumed[Item.Coal]).toBe(2);
  });

  it('does not count building from stock or deliveries to the hub as production', () => {
    const world = makeWorld(48);
    const sim = new Simulation(world);
    sim.sieve.receive(Item.IronPlate);
    sim.sieve.addStock(Item.IronPlate, 50);
    sim.sieve.spend([{ item: Item.IronPlate, count: 10 }]);
    stepN(sim, 2 * SECOND);

    expect(sim.stats.activeItems()).toEqual([]);
  });
});
