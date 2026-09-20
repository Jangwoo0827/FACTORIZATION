import { describe, expect, it } from 'vitest';
import { tileLine, walkGrid } from '../src/core/line';

describe('tileLine', () => {
  it('returns a single tile when the endpoints match', () => {
    expect(tileLine(3, 3, 3, 3)).toEqual([{ x: 3, y: 3 }]);
  });

  it('includes both endpoints', () => {
    const line = tileLine(0, 0, 4, 0);
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line.at(-1)).toEqual({ x: 4, y: 0 });
  });

  it('fills a straight run with no gaps', () => {
    expect(tileLine(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('keeps every step edge- or corner-adjacent, so a belt run is unbroken', () => {
    const line = tileLine(-6, 2, 9, -11);
    for (let i = 1; i < line.length; i++) {
      const dx = Math.abs(line[i]!.x - line[i - 1]!.x);
      const dy = Math.abs(line[i]!.y - line[i - 1]!.y);
      expect(Math.max(dx, dy)).toBe(1);
    }
  });

  it('works in every direction', () => {
    for (const [dx, dy] of [
      [5, 3],
      [-5, 3],
      [5, -3],
      [-5, -3],
      [0, -7],
      [7, 0],
    ]) {
      const line = tileLine(10, 10, 10 + dx, 10 + dy);
      expect(line[0]).toEqual({ x: 10, y: 10 });
      expect(line.at(-1)).toEqual({ x: 10 + dx, y: 10 + dy });
    }
  });

  it('caps a pathological jump instead of allocating without bound', () => {
    expect(tileLine(0, 0, 100000, 0).length).toBeLessThanOrEqual(512);
  });
});

describe('walkGrid', () => {
  it('returns a single tile when the endpoints match', () => {
    expect(walkGrid(4, 4, 4, 4)).toEqual([{ x: 4, y: 4 }]);
  });

  it('includes both endpoints', () => {
    const path = walkGrid(2, 3, 9, -4);
    expect(path[0]).toEqual({ x: 2, y: 3 });
    expect(path.at(-1)).toEqual({ x: 9, y: -4 });
  });

  it('never steps diagonally — every step changes exactly one coordinate by one', () => {
    // The whole reason this exists: a belt cannot hand items across a diagonal.
    const cases: [number, number, number, number][] = [
      [0, 0, 12, 5],
      [0, 0, -12, 5],
      [10, 10, 3, -6],
      [0, 0, 5, 12],
      [7, 7, 7, 20],
      [7, 7, 20, 7],
      [0, 0, 1, 1],
    ];
    for (const [x0, y0, x1, y1] of cases) {
      const path = walkGrid(x0, y0, x1, y1);
      for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i]!.x - path[i - 1]!.x);
        const dy = Math.abs(path[i]!.y - path[i - 1]!.y);
        expect(dx + dy).toBe(1);
      }
    }
  });

  it('takes the minimum number of steps', () => {
    const path = walkGrid(0, 0, 9, 4);
    expect(path.length).toBe(9 + 4 + 1);
  });

  it('walks a perfectly straight line without dividing by zero', () => {
    expect(walkGrid(0, 0, 3, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(walkGrid(5, 5, 5, 2).map((p) => p.y)).toEqual([5, 4, 3, 2]);
  });

  it('hugs the ideal line instead of taking an L-shaped detour', () => {
    // A 2:1 line should alternate roughly 2 x-steps per y-step, not run all of x first.
    const path = walkGrid(0, 0, 8, 4);
    const midpoint = path[Math.floor(path.length / 2)]!;
    expect(midpoint.x).toBeGreaterThan(2);
    expect(midpoint.y).toBeGreaterThan(1);
  });

  it('caps a pathological jump instead of allocating without bound', () => {
    expect(walkGrid(0, 0, 100000, 0).length).toBeLessThanOrEqual(512);
  });
});
