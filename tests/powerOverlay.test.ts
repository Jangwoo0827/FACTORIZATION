import { describe, expect, it } from 'vitest';
import { GRID_COLOURS, gridColour, overlaySegments, type Segment } from '../src/render/PowerOverlayView';
import { Simulation } from '../src/sim/simulation';
import { makeWorld, place } from './helpers';

const RED = 0xff3b30;

/** Segments lying on the ground (reach squares and stranded outlines), not hanging wires. */
const groundSegs = (segs: Segment[]) => segs.filter((s) => s.h < 0.5);
const wireSegs = (segs: Segment[]) => segs.filter((s) => s.h >= 0.5);

/** The bounding box of a set of segments. */
function bounds(segs: Segment[]) {
  const xs = segs.flatMap((s) => [s.ax, s.bx]);
  const ys = segs.flatMap((s) => [s.ay, s.by]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

describe('power overlay data', () => {
  it('outlines exactly the tiles a pole reaches', () => {
    const world = makeWorld(64);
    place(world, 'pole', 20, 20);
    const sim = new Simulation(world);
    sim.sync();

    const segs = overlaySegments(sim.power, world);
    expect(segs).toHaveLength(4);
    // Range 5 around tile 20 covers tiles 15..25, i.e. world units 15..26.
    expect(bounds(segs)).toEqual({ x0: 15, y0: 15, x1: 26, y1: 26 });
  });

  it('clips a reach square at the map edge', () => {
    const world = makeWorld(32);
    place(world, 'pole', 1, 30);
    const sim = new Simulation(world);
    sim.sync();

    expect(bounds(overlaySegments(sim.power, world))).toEqual({ x0: 0, y0: 25, x1: 7, y1: 32 });
  });

  it('colours each grid differently, and everything on one grid the same', () => {
    const world = makeWorld(64);
    place(world, 'pole', 10, 10);
    place(world, 'smelter-mk2', 12, 10);
    place(world, 'pole', 40, 40);
    place(world, 'smelter-mk2', 42, 40);
    const sim = new Simulation(world);
    sim.sync();

    const segs = overlaySegments(sim.power, world);
    const colours = new Set(segs.map((s) => s.colour));
    expect(colours).toEqual(new Set([GRID_COLOURS[0], GRID_COLOURS[1]]));
    // One wire per consumer, in its grid's colour.
    expect(wireSegs(segs).map((s) => s.colour).sort()).toEqual([GRID_COLOURS[0], GRID_COLOURS[1]].sort());
  });

  it('marks a building that needs power but that no pole reaches in red, around its footprint', () => {
    const world = makeWorld(64);
    place(world, 'pole', 10, 10);
    place(world, 'assembler-mk2', 40, 40); // 3x3, far from the pole
    const sim = new Simulation(world);
    sim.sync();

    const red = groundSegs(overlaySegments(sim.power, world)).filter((s) => s.colour === RED);
    expect(red).toHaveLength(4);
    const b = bounds(red);
    // Just outside the 3x3 footprint at 40..43.
    expect(b.x0).toBeLessThan(40);
    expect(b.x1).toBeGreaterThan(43);
    expect(b.x1 - b.x0).toBeLessThan(3.5);
    expect(sim.power.stranded.map((s) => s.id)).toHaveLength(1);
  });

  it('marks a stranded generator too, but never a Mk1 machine, which needs no power', () => {
    const world = makeWorld(64);
    place(world, 'generator', 30, 30);
    place(world, 'smelter', 10, 10);
    const sim = new Simulation(world);
    sim.sync();

    expect(sim.power.stranded).toHaveLength(1);
    expect(groundSegs(overlaySegments(sim.power, world)).every((s) => s.colour === RED)).toBe(true);
  });

  it('stops marking a building as stranded once a pole reaches it', () => {
    const world = makeWorld(64);
    place(world, 'smelter-mk2', 20, 20);
    const sim = new Simulation(world);
    sim.sync();
    expect(sim.power.stranded).toHaveLength(1);

    place(world, 'pole', 23, 20);
    sim.step();
    expect(sim.power.stranded).toHaveLength(0);
  });

  it('counts its rebuilds, so a view knows the wiring changed only after the simulation caught up', () => {
    const world = makeWorld(64);
    const sim = new Simulation(world);
    sim.sync();
    const before = sim.power.rebuilds;

    place(world, 'pole', 10, 10);
    // The world changed, but nothing has re-derived the grids yet.
    expect(sim.power.rebuilds).toBe(before);
    expect(sim.power.poles).toHaveLength(0);

    sim.step();
    expect(sim.power.rebuilds).toBe(before + 1);
    expect(sim.power.poles).toHaveLength(1);
  });

  it('cycles colours past the palette, and reserves red for "unreached"', () => {
    expect(gridColour(GRID_COLOURS.length)).toBe(GRID_COLOURS[0]);
    expect(gridColour(-1)).toBe(RED);
    expect(GRID_COLOURS).not.toContain(RED);
  });
});
