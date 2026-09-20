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

/**
 * 4-connected path from (x0, y0) to (x1, y1), both endpoints included: every step
 * changes exactly one coordinate by one.
 *
 * Bresenham (below) may step diagonally, which is fine for stamping buildings but
 * wrong for belts — a belt can only hand items to an edge-adjacent tile, so a
 * diagonal step would leave a gap in the line that items cannot cross.
 *
 * This is the grid walk from Red Blob Games' line-drawing notes: at each step it
 * advances whichever axis is proportionally further behind, which keeps the path
 * hugging the ideal straight line.
 */
export function walkGrid(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  const points: Vec2[] = [{ x: x0, y: y0 }];

  const nx = Math.abs(x1 - x0);
  const ny = Math.abs(y1 - y0);
  const sx = x1 > x0 ? 1 : -1;
  const sy = y1 > y0 ? 1 : -1;

  let x = x0;
  let y = y0;
  let ix = 0;
  let iy = 0;

  while ((ix < nx || iy < ny) && points.length < MAX_LINE_TILES) {
    // Finished one axis: the remaining steps are forced onto the other. Checked
    // first because the ratio below divides by the axis length, which is zero for
    // a perfectly straight line.
    let stepX: boolean;
    if (ix >= nx) stepX = false;
    else if (iy >= ny) stepX = true;
    else stepX = (0.5 + ix) / nx < (0.5 + iy) / ny;

    if (stepX) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    points.push({ x, y });
  }

  return points;
}

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
