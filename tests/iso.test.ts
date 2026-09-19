import { describe, expect, it } from 'vitest';
import { TILE_H, TILE_W } from '../src/config';
import { tileDepth, tileToWorld, visibleTiles, worldToTile } from '../src/core/iso';

describe('isometric projection', () => {
  it('places the origin tile at the world origin', () => {
    expect(tileToWorld(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('moves +x to screen-right and +y to screen-left', () => {
    expect(tileToWorld(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(tileToWorld(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it('round-trips every tile in a sample grid', () => {
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const world = tileToWorld(x, y);
        expect(worldToTile(world.x, world.y)).toEqual({ x, y });
      }
    }
  });

  it('picks the tile whose diamond contains the point, not the bounding box', () => {
    // Just inside tile (0,0)'s right vertex.
    expect(worldToTile(TILE_W / 2 - 1, 0)).toEqual({ x: 0, y: 0 });
    // Just past it, which belongs to the tile diagonally up-right.
    expect(worldToTile(TILE_W / 2 + 1, 0)).toEqual({ x: 1, y: -1 });
    // Near the top vertex, still tile (0,0).
    expect(worldToTile(0, -TILE_H / 2 + 1)).toEqual({ x: 0, y: 0 });
  });

  it('treats fractional tile coordinates as diamond corners', () => {
    // The top vertex of tile (0,0) sits half a tile above its centre.
    expect(tileToWorld(-0.5, -0.5)).toEqual({ x: 0, y: -TILE_H / 2 });
    expect(tileToWorld(0.5, -0.5)).toEqual({ x: TILE_W / 2, y: 0 });
  });

  it('sorts render order along the x + y diagonal', () => {
    expect(tileDepth(3, 4)).toBeGreaterThan(tileDepth(3, 3));
    expect(tileDepth(3, 4)).toBe(tileDepth(4, 3));
  });

  describe('visibleTiles', () => {
    it('covers every tile whose centre lies in the rectangle', () => {
      const bounds = visibleTiles(-200, -100, 200, 100);

      for (let y = -10; y <= 10; y++) {
        for (let x = -10; x <= 10; x++) {
          const world = tileToWorld(x, y);
          const inside =
            world.x >= -200 && world.x <= 200 && world.y >= -100 && world.y <= 100;
          if (!inside) continue;
          expect(x).toBeGreaterThanOrEqual(bounds.minX);
          expect(x).toBeLessThanOrEqual(bounds.maxX);
          expect(y).toBeGreaterThanOrEqual(bounds.minY);
          expect(y).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    });

    it('grows with the viewport', () => {
      const small = visibleTiles(0, 0, 100, 100);
      const large = visibleTiles(0, 0, 400, 400);
      expect(large.maxX - large.minX).toBeGreaterThan(small.maxX - small.minX);
    });
  });
});
