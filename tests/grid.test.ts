import { describe, expect, it } from 'vitest';
import { footprintCenter, footprintOrigin, tileCenter, worldToTile } from '../src/core/grid';

describe('tile grid', () => {
  it('puts a tile centre half a unit inside its own square', () => {
    expect(tileCenter(0, 0)).toEqual({ x: 0.5, y: 0, z: 0.5 });
    expect(tileCenter(3, 7)).toEqual({ x: 3.5, y: 0, z: 7.5 });
  });

  it('round-trips a tile through its centre', () => {
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 30; x++) {
        const centre = tileCenter(x, y);
        expect(worldToTile(centre.x, centre.z)).toEqual({ x, y });
      }
    }
  });

  it('gives a tile the square that starts at its coordinate', () => {
    // Anywhere inside [4,5) x [9,10) belongs to tile (4, 9).
    expect(worldToTile(4.0, 9.0)).toEqual({ x: 4, y: 9 });
    expect(worldToTile(4.999, 9.999)).toEqual({ x: 4, y: 9 });
    expect(worldToTile(5.0, 9.0)).toEqual({ x: 5, y: 9 });
  });

  it('floors rather than rounds, unlike the isometric version it replaced', () => {
    // Under the old diamond convention this point rounded to tile 5.
    expect(worldToTile(4.6, 4.6)).toEqual({ x: 4, y: 4 });
  });

  it('handles negative ground coordinates off the map edge', () => {
    expect(worldToTile(-0.1, -0.1)).toEqual({ x: -1, y: -1 });
    expect(worldToTile(-1.0, 0.5)).toEqual({ x: -1, y: 0 });
  });

  describe('footprintCenter', () => {
    it('matches the tile centre for a 1x1 footprint', () => {
      expect(footprintCenter(2, 3, 1, 1)).toEqual(tileCenter(2, 3));
    });

    it('lands on the shared corner for an even footprint', () => {
      expect(footprintCenter(4, 4, 2, 2)).toEqual({ x: 5, y: 0, z: 5 });
    });

    it('lands on a tile centre for an odd footprint', () => {
      expect(footprintCenter(4, 4, 3, 3)).toEqual({ x: 5.5, y: 0, z: 5.5 });
    });

    it('handles a non-square footprint on both axes', () => {
      expect(footprintCenter(0, 0, 3, 2)).toEqual({ x: 1.5, y: 0, z: 1 });
    });
  });
});

describe('footprintOrigin', () => {
  it('is exactly the tile under the cursor for a 1x1', () => {
    // Single tiles must not change behaviour: same answer as floor, everywhere.
    for (let gx = -3; gx < 12; gx += 0.137) {
      for (let gz = -3; gz < 12; gz += 0.211) {
        expect(footprintOrigin(gx, gz, 1, 1)).toEqual(worldToTile(gx, gz));
      }
    }
  });

  it('centres an odd footprint on the tile under the cursor', () => {
    // A 3x3 centred on tile (5,5) starts at (4,4). Anywhere inside tile 5 must agree.
    for (const g of [5.0, 5.2, 5.5, 5.8, 5.999]) {
      expect(footprintOrigin(g, g, 3, 3)).toEqual({ x: 4, y: 4 });
    }
    expect(footprintOrigin(6.0, 6.0, 3, 3)).toEqual({ x: 5, y: 5 });
  });

  it('puts an even footprint on the tile corner nearest the cursor', () => {
    // 2x2 covering tiles 4..5 has its centre at 5.0, the corner between tiles 4 and 5.
    expect(footprintOrigin(5.0, 5.0, 2, 2)).toEqual({ x: 4, y: 4 });
    expect(footprintOrigin(5.3, 5.3, 2, 2)).toEqual({ x: 4, y: 4 });
    expect(footprintOrigin(4.7, 4.7, 2, 2)).toEqual({ x: 4, y: 4 });
    // Past the halfway point to the next corner it moves over.
    expect(footprintOrigin(5.6, 5.6, 2, 2)).toEqual({ x: 5, y: 5 });
  });

  it('keeps the footprint centre within half a tile of the cursor, for every size', () => {
    // The property the old rule violated: for a 2x2 the centre was routinely a full
    // half tile on each axis from where the cursor was.
    for (const [w, h] of [[1, 1], [2, 2], [3, 3], [3, 2], [2, 3], [1, 3]] as const) {
      for (let gx = 0; gx < 10; gx += 0.173) {
        for (let gz = 0; gz < 10; gz += 0.291) {
          const o = footprintOrigin(gx, gz, w, h);
          const c = footprintCenter(o.x, o.y, w, h);
          expect(Math.abs(c.x - gx)).toBeLessThanOrEqual(0.5 + 1e-9);
          expect(Math.abs(c.z - gz)).toBeLessThanOrEqual(0.5 + 1e-9);
        }
      }
    }
  });

  it('never returns negative zero', () => {
    const o = footprintOrigin(0.4, 0.4, 1, 1);
    expect(Object.is(o.x, 0)).toBe(true);
    expect(Object.is(o.y, 0)).toBe(true);
  });

  it('handles a non-square footprint on each axis independently', () => {
    // 3 wide, 2 deep: odd on x (tile centre), even on z (tile corner).
    const o = footprintOrigin(5.4, 5.4, 3, 2);
    expect(o).toEqual({ x: 4, y: 4 });
    const c = footprintCenter(o.x, o.y, 3, 2);
    expect(c.x).toBe(5.5);
    expect(c.z).toBe(5);
  });
});
