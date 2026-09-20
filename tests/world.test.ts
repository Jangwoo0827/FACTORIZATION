import { beforeEach, describe, expect, it } from 'vitest';
import { CompositeCommand, History, PlaceCommand, RemoveCommand } from '../src/input/commands';
import { Ore, Terrain, type BuildingDef } from '../src/sim/types';
import { World } from '../src/sim/world';

const DEFS: BuildingDef[] = [
  { id: 'belt', name: 'belt', kind: 'belt', w: 1, h: 1, color: 0, height: 0, needsOre: false },
  { id: 'big', name: 'big', kind: 'passive', w: 3, h: 2, color: 0, height: 0, needsOre: false },
  { id: 'miner', name: 'miner', kind: 'miner', w: 2, h: 2, color: 0, height: 0, needsOre: true },
];
const DEF_MAP = new Map(DEFS.map((d) => [d.id, d]));

function makeWorld(): World {
  return new World(16, DEF_MAP);
}

describe('World placement', () => {
  let world: World;

  beforeEach(() => {
    world = makeWorld();
  });

  it('places a building and marks its whole footprint occupied', () => {
    const placed = world.place('big', 4, 4, 0);
    expect(placed).not.toBeNull();

    for (let y = 4; y < 6; y++) {
      for (let x = 4; x < 7; x++) {
        expect(world.buildingAt(x, y)?.id).toBe(placed!.id);
      }
    }
    expect(world.buildingAt(7, 4)).toBeNull();
    expect(world.buildingCount).toBe(1);
  });

  it('swaps the footprint axes on odd quarter turns', () => {
    world.place('big', 4, 4, 1);
    // 3x2 rotated becomes 2x3.
    expect(world.buildingAt(5, 6)).not.toBeNull();
    expect(world.buildingAt(6, 4)).toBeNull();
  });

  it('rejects overlapping placements', () => {
    world.place('big', 4, 4, 0);
    expect(world.checkPlacement('belt', 5, 5, 0)).toEqual({ ok: false, reason: 'occupied' });
    expect(world.place('belt', 5, 5, 0)).toBeNull();
    expect(world.buildingCount).toBe(1);
  });

  it('rejects placements that leave the map, including partly', () => {
    expect(world.checkPlacement('belt', -1, 0, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
    // Origin is inside, but the 3-wide footprint runs off the east edge.
    expect(world.checkPlacement('big', 14, 0, 0)).toEqual({ ok: false, reason: 'out-of-bounds' });
  });

  it('rejects non-plain terrain', () => {
    world.setTerrain(5, 5, Terrain.Water);
    expect(world.checkPlacement('belt', 5, 5, 0)).toEqual({ ok: false, reason: 'terrain' });
  });

  it('requires miners to cover at least one ore tile', () => {
    expect(world.checkPlacement('miner', 2, 2, 0)).toEqual({ ok: false, reason: 'needs-ore' });
    world.setOre(3, 3, Ore.Iron);
    expect(world.checkPlacement('miner', 2, 2, 0)).toEqual({ ok: true });
  });

  it('frees the footprint on removal', () => {
    const placed = world.place('big', 4, 4, 0)!;
    expect(world.removeAt(6, 5)?.id).toBe(placed.id);
    expect(world.buildingAt(4, 4)).toBeNull();
    expect(world.buildingCount).toBe(0);
    expect(world.checkPlacement('big', 4, 4, 0)).toEqual({ ok: true });
  });
});

describe('command history', () => {
  let world: World;
  let history: History;

  beforeEach(() => {
    world = makeWorld();
    history = new History();
  });

  it('undoes and redoes a placement, preserving the building id', () => {
    const command = new PlaceCommand('belt', 2, 2, 0);
    history.execute(command, world);
    const originalId = world.buildingAt(2, 2)!.id;

    expect(history.undo(world)).toBe(true);
    expect(world.buildingAt(2, 2)).toBeNull();

    expect(history.redo(world)).toBe(true);
    expect(world.buildingAt(2, 2)!.id).toBe(originalId);
  });

  it('restores a removed building with its original identity', () => {
    const placed = world.place('big', 4, 4, 0)!;
    history.execute(new RemoveCommand(placed), world);
    expect(world.buildingCount).toBe(0);

    history.undo(world);
    expect(world.buildingAt(5, 5)!.id).toBe(placed.id);
    expect(world.buildingAt(5, 5)!.rot).toBe(placed.rot);
  });

  it('treats a drag stroke as one undo step', () => {
    const commands = [0, 1, 2, 3].map((i) => new PlaceCommand('belt', i, 0, 0));
    for (const c of commands) c.redo(world);
    history.record(new CompositeCommand(commands));
    expect(world.buildingCount).toBe(4);

    history.undo(world);
    expect(world.buildingCount).toBe(0);

    history.redo(world);
    expect(world.buildingCount).toBe(4);
  });

  it('drops the redo branch once new work is recorded', () => {
    history.execute(new PlaceCommand('belt', 1, 1, 0), world);
    history.undo(world);
    expect(history.canRedo).toBe(true);

    history.execute(new PlaceCommand('belt', 2, 2, 0), world);
    expect(history.canRedo).toBe(false);
  });

  it('reports nothing to undo on an empty history', () => {
    expect(history.canUndo).toBe(false);
    expect(history.undo(world)).toBe(false);
  });
});
