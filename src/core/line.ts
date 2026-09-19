/**
 * Tile rasterisation for drag strokes.
 *
 * A pointer drag only reports samples, and the gap between two samples can span
 * many tiles when the pointer moves fast or the device reports at a low rate.
 * Belts laid from a drag must be contiguous, so the stroke walks every tile
 * between consecutive samples instead of only the sampled ones.
 */

import type { Vec2 } from './grid';

/** Safety valve for a pathological jump (e.g. a pointer warp across the map). */
const MAX_LINE_TILES = 512;

/** Bresenham line from (x0, y0) to (x1, y1), both endpoints included. */
export function tileLine(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  const points: Vec2[] = [];

  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;

  let err = dx + dy;
  let x = x0;
  let y = y0;

  for (;;) {
    points.push({ x, y });
    if ((x === x1 && y === y1) || points.length >= MAX_LINE_TILES) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }

  return points;
}
