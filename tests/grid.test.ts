import { describe, expect, it } from 'vitest';
import { footprintCenter, tileCenter, worldToTile } from '../src/core/grid';

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
