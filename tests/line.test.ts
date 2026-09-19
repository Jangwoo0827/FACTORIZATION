import { describe, expect, it } from 'vitest';
import { tileLine } from '../src/core/line';

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
