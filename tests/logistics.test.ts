import { describe, expect, it } from 'vitest';
import { TUNNEL_RANGE } from '../src/config';
import { Item } from '../src/data/items';
import { STRAIGHT } from '../src/sim/belts';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { allItems, belt, makeWorld, place, run, stepN, tileOf, violations } from './helpers';

const SECOND = 30;
const IRON = Ore.Iron;
const COPPER = Ore.Copper;

/** Feeds an item onto a belt every tick, as fast as it will take it. Returns how many went on. */
function saturate(sim: Simulation, tile: number, item: number, ticks: number): number {
  let fed = 0;
  for (let t = 0; t < ticks; t++) {
    if (sim.belts.tryEnter(tile, item, STRAIGHT)) fed++;
    sim.step();
  }
  return fed;
}

/** Items sitting in splitters, which `allItems` (belts only) does not see. */
function inSplitters(sim: Simulation): number {
  let n = 0;
  for (let t = 0; t < sim.belts.tileCount; t++) if (sim.belts.splitterContents(t) !== 0) n++;
  return n;
}

describe('a splitter', () => {
  /** Feed line into a splitter at (10,10), with a dead-end belt on each of the other three sides. */
  function threeWay() {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0); // feed, ends at (9,10)
    const splitter = place(world, 'splitter', 10, 10);
    belt(world, 11, 10, 0); // east
    belt(world, 10, 9, 3); // north
    belt(world, 10, 11, 1); // south
    const sim = new Simulation(world);
    sim.sync();
    return { world, sim, splitter, feed: tileOf(world, 2, 10) };
  }

  it('shares items evenly between its outputs', () => {
    const { world, sim, feed } = threeWay();
    // Each output is a single belt tile that holds four and then stops: 12 in all.
    const fed = saturate(sim, feed, IRON, 60 * SECOND);

    expect(sim.belts.count[tileOf(world, 11, 10)]).toBe(4);
    expect(sim.belts.count[tileOf(world, 10, 9)]).toBe(4);
    expect(sim.belts.count[tileOf(world, 10, 11)]).toBe(4);
    expect(fed).toBeGreaterThanOrEqual(12);
  });

  it('never sends an item back the way it came, even to another splitter', () => {
    // A belt feeding a splitter is never a candidate output anyway, because it points
    // at the splitter. The rule that matters is between splitters, which accept from
    // any side: without it two adjacent splitters would pass one item back and forth
    // forever.
    const world = makeWorld(48);
    const a = place(world, 'splitter', 10, 10);
    const b = place(world, 'splitter', 11, 10); // no other output: a dead end
    const sim = new Simulation(world);
    sim.sync();
    const tileA = tileOf(world, 10, 10);
    const tileB = tileOf(world, 11, 10);

    // Hand the first splitter one item, from the west.
    expect(sim.belts.tryEnter(tileA, IRON, 2)).toBe(true);
    stepN(sim, 20);

    // It has moved on to the second and must now stay there, since the only place
    // left to send it is back where it came from.
    for (let t = 0; t < 30; t++) {
      sim.step();
      expect(sim.belts.splitterContents(tileB)).toBe(IRON);
      expect(sim.belts.splitterContents(tileA)).toBe(0);
    }
    void a;
    void b;
  });

  it('keeps the spacing and capacity rules on the lines around it', () => {
    const { sim, feed } = threeWay();
    for (let t = 0; t < 60 * SECOND; t++) {
      sim.belts.tryEnter(feed, IRON, STRAIGHT);
      sim.step();
      expect(violations(sim.belts)).toEqual([]);
    }
  });

  it('carries on through an output that is blocked', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    belt(world, 10, 9, 3); // dead end: fills to four and stays full
    belt(world, 10, 11, 1); // dead end
    run(world, 11, 10, 8, 0); // open: leads to the hub
    place(world, 'hub', 19, 9);
    const sim = new Simulation(world);
    const feed = tileOf(world, 2, 10);

    saturate(sim, feed, IRON, 40 * SECOND); // fill the dead ends
    const before = sim.sieve.delivered[IRON]!;
    saturate(sim, feed, IRON, 20 * SECOND);
    const perSecond = (sim.sieve.delivered[IRON]! - before) / 20;

    // With both side outputs full, everything goes east, at the belt's full rate.
    expect(sim.belts.count[tileOf(world, 10, 9)]).toBe(4);
    expect(sim.belts.count[tileOf(world, 10, 11)]).toBe(4);
    expect(perSecond).toBeGreaterThan(5.5);
  });

  it('holds an item and backs up its feed when every output is blocked, losing nothing', () => {
    const { world, sim, feed } = threeWay();
    const fed = saturate(sim, feed, IRON, 90 * SECOND);

    // Feed line (8 tiles x 4) + three dead ends (3 x 4) + the one in the splitter.
    expect(fed).toBe(8 * 4 + 3 * 4 + 1);
    expect(sim.belts.totalItems()).toBe(fed);
    expect(inSplitters(sim)).toBe(1);
    void world;
  });

  it('is not a bottleneck: a saturated belt through it still delivers 6 a second', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    run(world, 11, 10, 8, 0);
    place(world, 'hub', 19, 9);
    const sim = new Simulation(world);
    const feed = tileOf(world, 2, 10);

    saturate(sim, feed, IRON, 20 * SECOND);
    const before = sim.sieve.delivered[IRON]!;
    saturate(sim, feed, IRON, 20 * SECOND);
    const perSecond = (sim.sieve.delivered[IRON]! - before) / 20;

    expect(perSecond).toBeGreaterThan(5.7);
    expect(perSecond).toBeLessThan(6.3);
  });

  it('does not send items onto a belt that points back at it', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    belt(world, 11, 10, 2); // faces west, straight at the splitter
    belt(world, 10, 9, 3);
    const sim = new Simulation(world);
    sim.sync();
    saturate(sim, tileOf(world, 2, 10), IRON, 30 * SECOND);

    expect(sim.belts.count[tileOf(world, 11, 10)]).toBe(0);
    expect(sim.belts.count[tileOf(world, 10, 9)]).toBe(4);
  });

  it('feeds a machine and refuses nothing it is not asked to', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    const smelter = place(world, 'smelter', 11, 10);
    world.setRecipe(smelter, Item.IronPlate);
    run(world, 13, 10, 4, 0);
    place(world, 'hub', 17, 9);
    const sim = new Simulation(world);

    saturate(sim, tileOf(world, 2, 10), IRON, 30 * SECOND);

    expect(sim.machines.info(smelter)!.status).not.toBe('no-recipe');
    expect(sim.sieve.delivered[Item.IronPlate]).toBeGreaterThan(0);
  });

  it('takes ore straight from a miner', () => {
    const world = makeWorld(48);
    for (const [x, y] of [[4, 10], [5, 10], [4, 11], [5, 11]] as const) world.setOre(x, y, Ore.Iron);
    place(world, 'miner', 4, 10);
    place(world, 'splitter', 6, 10); // touching the miner's east edge
    run(world, 7, 10, 8, 0);
    place(world, 'hub', 15, 9);
    const sim = new Simulation(world);

    stepN(sim, 60 * SECOND);

    // 0.5/s, less the time to cross the belt.
    expect(sim.sieve.delivered[IRON]).toBeGreaterThan(20);
  });

  it('passes an item through a chain of splitters', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    place(world, 'splitter', 11, 10);
    place(world, 'splitter', 12, 10);
    run(world, 13, 10, 5, 0);
    place(world, 'hub', 18, 9);
    const sim = new Simulation(world);

    saturate(sim, tileOf(world, 2, 10), IRON, 30 * SECOND);
    expect(sim.sieve.delivered[IRON]).toBeGreaterThan(50);
  });

  it('is stepped before the belts that feed it, so a jam clears from the front', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    const splitter = place(world, 'splitter', 10, 10);
    run(world, 11, 10, 3, 0);
    const sim = new Simulation(world);
    sim.sync();

    const order = [...sim.belts.orderedTiles()];
    const at = new Map(order.map((t, i) => [t, i]));
    const splitterTile = tileOf(world, 10, 10);
    const feeder = tileOf(world, 9, 10);

    expect(order).toContain(splitterTile);
    expect(at.get(splitterTile)!).toBeLessThan(at.get(feeder)!);
    void splitter;
  });

  it('conserves every item across a busy network', () => {
    // Three ways out: one open to the hub, two dead ends that fill and then block.
    const world = makeWorld(48);
    run(world, 2, 10, 8, 0);
    place(world, 'splitter', 10, 10);
    run(world, 11, 10, 8, 0); // east to the hub
    place(world, 'hub', 19, 9);
    belt(world, 10, 9, 3); // north dead end
    belt(world, 10, 11, 1); // south dead end
    const sim = new Simulation(world);

    let fed = 0;
    for (let t = 0; t < 90 * SECOND; t++) {
      if (sim.belts.tryEnter(tileOf(world, 2, 10), IRON, STRAIGHT)) fed++;
      sim.step();
      if (t % 60 === 0) {
        // Belts plus the one item a splitter can hold, plus everything delivered.
        expect(sim.belts.totalItems() + sim.sieve.delivered[IRON]!).toBe(fed);
      }
    }

    expect(sim.belts.totalItems() + sim.sieve.delivered[IRON]!).toBe(fed);
    expect(sim.sieve.delivered[IRON]).toBeGreaterThan(100);
  });
});

describe('an underpass', () => {
  /**
   * An east-west line that dips under a north-south one:
   *
   *   east:  belts (2..7,10) -> entrance (8,10) ... exit (12,10) -> belts (13..18,10) -> hub
   *   south: belts (10,4..15) crossing between the two, -> hub
   */
  function crossing(exitX = 12) {
    const world = makeWorld(48);
    run(world, 2, 10, 6, 0);
    place(world, 'tunnel-in', 8, 10, 0);
    place(world, 'tunnel-out', exitX, 10, 0);
    run(world, exitX + 1, 10, 6, 0);
    place(world, 'hub', exitX + 7, 9);
    run(world, 10, 4, 12, 1);
    place(world, 'hub', 9, 16);
    const sim = new Simulation(world);
    sim.sync();
    return { world, sim, east: tileOf(world, 2, 10), south: tileOf(world, 10, 4) };
  }

  it('joins an entrance to the exit ahead of it', () => {
    const { world, sim } = crossing();
    expect(sim.belts.linkOf(tileOf(world, 8, 10))).toBe(tileOf(world, 12, 10));
    expect(sim.belts.isLinkedExit(tileOf(world, 12, 10))).toBe(true);
  });

  it(`reaches ${TUNNEL_RANGE} tiles and no further`, () => {
    const inRange = crossing(8 + TUNNEL_RANGE);
    expect(inRange.sim.belts.linkOf(tileOf(inRange.world, 8, 10))).toBe(
      tileOf(inRange.world, 8 + TUNNEL_RANGE, 10),
    );

    const tooFar = crossing(8 + TUNNEL_RANGE + 1);
    expect(tooFar.sim.belts.linkOf(tileOf(tooFar.world, 8, 10))).toBe(-1);
  });

  it('will not join an exit that faces another way', () => {
    const world = makeWorld(48);
    place(world, 'tunnel-in', 8, 10, 0);
    place(world, 'tunnel-out', 12, 10, 1); // faces south, not east
    const sim = new Simulation(world);
    sim.sync();
    expect(sim.belts.linkOf(tileOf(world, 8, 10))).toBe(-1);
  });

  it('will not join an exit behind it', () => {
    const world = makeWorld(48);
    place(world, 'tunnel-in', 12, 10, 0);
    place(world, 'tunnel-out', 8, 10, 0); // west of the entrance, which faces east
    const sim = new Simulation(world);
    sim.sync();
    expect(sim.belts.linkOf(tileOf(world, 12, 10))).toBe(-1);
  });

  it('lets an exit serve only one entrance', () => {
    const world = makeWorld(48);
    place(world, 'tunnel-in', 6, 10, 0);
    place(world, 'tunnel-in', 8, 10, 0);
    place(world, 'tunnel-out', 12, 10, 0);
    const sim = new Simulation(world);
    sim.sync();

    const linked = [6, 8].filter((x) => sim.belts.linkOf(tileOf(world, x, 10)) !== -1);
    expect(linked).toHaveLength(1);
  });

  it('carries items under a crossing belt without either line touching the other', () => {
    const { world, sim, east, south } = crossing();

    for (let t = 0; t < 60 * SECOND; t++) {
      sim.belts.tryEnter(east, IRON, STRAIGHT);
      sim.belts.tryEnter(south, COPPER, STRAIGHT);
      sim.step();
    }

    // Both lines got through...
    expect(sim.sieve.delivered[IRON]).toBeGreaterThan(50);
    expect(sim.sieve.delivered[COPPER]).toBeGreaterThan(50);

    // ...and nothing ever crossed onto the wrong line.
    for (const it of allItems(sim.belts)) {
      const x = it.tile % world.size;
      const y = (it.tile - x) / world.size;
      // The north-south line owns every tile of column 10, including the one where it
      // crosses row 10. The east-west line owns the rest of row 10.
      if (x === 10) expect(it.item).toBe(COPPER);
      else if (y === 10) expect(it.item).toBe(IRON);
    }
  });

  it('is not a bottleneck: a saturated belt through it still delivers 6 a second', () => {
    const { sim, east } = crossing();

    saturate(sim, east, IRON, 20 * SECOND);
    const before = sim.sieve.delivered[IRON]!;
    saturate(sim, east, IRON, 20 * SECOND);
    const perSecond = (sim.sieve.delivered[IRON]! - before) / 20;

    expect(perSecond).toBeGreaterThan(5.7);
    expect(perSecond).toBeLessThan(6.3);
  });

  it('keeps the spacing and capacity rules through the jump', () => {
    const { sim, east } = crossing();
    for (let t = 0; t < 30 * SECOND; t++) {
      sim.belts.tryEnter(east, IRON, STRAIGHT);
      sim.step();
      // Not across the gap: the entrance and exit are not neighbours, so there is no
      // straight-through boundary to check there.
      expect(violations(sim.belts, false)).toEqual([]);
    }
  });

  it('conserves every item', () => {
    const { sim, east, south } = crossing();
    let fed = 0;
    for (let t = 0; t < 90 * SECOND; t++) {
      if (sim.belts.tryEnter(east, IRON, STRAIGHT)) fed++;
      if (sim.belts.tryEnter(south, COPPER, STRAIGHT)) fed++;
      sim.step();
    }
    expect(sim.belts.totalItems() + sim.sieve.delivered[IRON]! + sim.sieve.delivered[COPPER]!).toBe(fed);
  });

  it('holds items at the entrance while the exit is blocked, losing none', () => {
    // Exit leads to a dead end: it fills, then the entrance must hold what is left.
    const world = makeWorld(48);
    run(world, 2, 10, 6, 0);
    place(world, 'tunnel-in', 8, 10, 0);
    place(world, 'tunnel-out', 12, 10, 0);
    belt(world, 13, 10, 0);
    const sim = new Simulation(world);
    sim.sync();

    const fed = saturate(sim, tileOf(world, 2, 10), IRON, 60 * SECOND);
    expect(sim.belts.totalItems()).toBe(fed);
    // 6 feed belts + entrance + exit + 1 dead-end belt, four each.
    expect(fed).toBe((6 + 1 + 1 + 1) * 4);
  });

  it('behaves as an ordinary belt while it has no exit', () => {
    const world = makeWorld(48);
    run(world, 2, 10, 6, 0);
    place(world, 'tunnel-in', 8, 10, 0);
    run(world, 9, 10, 6, 0); // the belts just carry on past it
    place(world, 'hub', 15, 9);
    const sim = new Simulation(world);

    saturate(sim, tileOf(world, 2, 10), IRON, 30 * SECOND);
    expect(sim.belts.linkOf(tileOf(world, 8, 10))).toBe(-1);
    expect(sim.sieve.delivered[IRON]).toBeGreaterThan(50);
  });

  it('is unlinked when its exit is removed, and relinked when it is put back', () => {
    const { world, sim } = crossing();
    const entrance = tileOf(world, 8, 10);
    expect(sim.belts.linkOf(entrance)).not.toBe(-1);

    const removed = world.removeAt(12, 10)!;
    sim.step();
    expect(sim.belts.linkOf(entrance)).toBe(-1);

    world.insert(removed);
    sim.step();
    expect(sim.belts.linkOf(entrance)).toBe(tileOf(world, 12, 10));
  });

  it('is stepped downstream-first all the way back along the line that feeds it', () => {
    // exit, then entrance, then the belts that feed the entrance from nearest to
    // furthest. The entrance is not next to its exit, so ordinary neighbour-following
    // cannot find it; if it is left out it falls into the tail of the ordering with
    // the belts behind it, in tile order, which steps them upstream-first.
    const { world, sim } = crossing();
    const order = [...sim.belts.orderedTiles()];
    const at = new Map(order.map((t, i) => [t, i]));

    const chain = [12, 8, 7, 6, 5, 4, 3, 2].map((x) => at.get(tileOf(world, x, 10))!);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i]!).toBeGreaterThan(chain[i - 1]!);
    }
  });
});

/** A small helper kept next to its only users. */
void (null as unknown as World);
