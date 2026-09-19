import { describe, expect, it } from 'vitest';
import {
  rotateFootprint,
  rotateTile,
  unrotateTile,
  type ViewRotation,
} from '../src/core/iso';

const SIZE = 8;
const ROTATIONS: ViewRotation[] = [0, 1, 2, 3];

describe('view rotation', () => {
  it('leaves everything alone at rotation 0', () => {
    expect(rotateTile(3, 5, 0, SIZE)).toEqual({ x: 3, y: 5 });
  });

  it('round-trips every tile at every rotation', () => {
    for (const rot of ROTATIONS) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const rotated = rotateTile(x, y, rot, SIZE);
          expect(unrotateTile(rotated.x, rotated.y, rot, SIZE)).toEqual({ x, y });
        }
      }
    }
  });

  it('keeps every tile inside the map', () => {
    for (const rot of ROTATIONS) {
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const r = rotateTile(x, y, rot, SIZE);
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x).toBeLessThan(SIZE);
          expect(r.y).toBeLessThan(SIZE);
        }
      }
    }
  });

  it('is a bijection, so no two tiles collapse onto one', () => {
    for (const rot of ROTATIONS) {
      const seen = new Set<string>();
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const r = rotateTile(x, y, rot, SIZE);
          seen.add(`${r.x},${r.y}`);
        }
      }
      expect(seen.size).toBe(SIZE * SIZE);
    }
  });

  it('returns to the start after four quarter turns', () => {
    let point = { x: 2, y: 6 };
    for (let i = 0; i < 4; i++) point = rotateTile(point.x, point.y, 1, SIZE);
    expect(point).toEqual({ x: 2, y: 6 });
  });

  it('moves each corner to the next one, turning a consistent way', () => {
    const max = SIZE - 1;
    expect(rotateTile(0, 0, 1, SIZE)).toEqual({ x: max, y: 0 });
    expect(rotateTile(max, 0, 1, SIZE)).toEqual({ x: max, y: max });
    expect(rotateTile(max, max, 1, SIZE)).toEqual({ x: 0, y: max });
    expect(rotateTile(0, max, 1, SIZE)).toEqual({ x: 0, y: 0 });
  });

  describe('rotateFootprint', () => {
    it('preserves the footprint at rotation 0', () => {
      expect(rotateFootprint(1, 2, 3, 2, 0, SIZE)).toEqual({ x: 1, y: 2, w: 3, h: 2 });
    });

    it('swaps the axes on a quarter turn', () => {
      const r = rotateFootprint(1, 2, 3, 2, 1, SIZE);
      expect(r.w).toBe(2);
      expect(r.h).toBe(3);
    });

    it('covers exactly the rotated tiles, with no drift', () => {
      for (const rot of ROTATIONS) {
        const [x, y, w, h] = [1, 2, 3, 2];
        const rect = rotateFootprint(x, y, w, h, rot, SIZE);

        const expected = new Set<string>();
        for (let ty = y; ty < y + h; ty++) {
          for (let tx = x; tx < x + w; tx++) {
            const r = rotateTile(tx, ty, rot, SIZE);
            expected.add(`${r.x},${r.y}`);
          }
        }

        const covered = new Set<string>();
        for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
          for (let tx = rect.x; tx < rect.x + rect.w; tx++) {
            covered.add(`${tx},${ty}`);
          }
        }

        expect(covered).toEqual(expected);
      }
    });

    it('keeps a square footprint square', () => {
      for (const rot of ROTATIONS) {
        const r = rotateFootprint(4, 4, 2, 2, rot, SIZE);
        expect([r.w, r.h]).toEqual([2, 2]);
      }
    });
  });
});
