/**
 * Isometric projection (GDD 4.1).
 *
 * Pure maths: no Phaser, no DOM. Lives in `core/` rather than `render/` because
 * `input/` needs it too, and input must not depend on the renderer.
 *
 * Convention: `tileToWorld(tx, ty)` returns the CENTRE of tile (tx, ty), and the
 * map origin tile (0, 0) sits at world (0, 0). Fractional tile coordinates are
 * valid and are used to address tile corners (e.g. `tileToWorld(x - 0.5, y - 0.5)`
 * is the top vertex of tile (x, y)), which works because the transform is linear.
 */

import { TILE_H, TILE_W } from '../config';

export interface Vec2 {
  x: number;
  y: number;
}

export interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function tileToWorld(tx: number, ty: number): Vec2 {
  return {
    x: (tx - ty) * (TILE_W / 2),
    y: (tx + ty) * (TILE_H / 2),
  };
}

/** Inverse projection, keeping fractional precision. Tile centres land on integers. */
export function worldToTileExact(wx: number, wy: number): Vec2 {
  return {
    x: wx / TILE_W + wy / TILE_H,
    y: wy / TILE_H - wx / TILE_W,
  };
}

/**
 * Screen-space picking (GDD 4.1): resolve a world point to the tile whose diamond
 * contains it. Rounding — not flooring — is correct here, because a tile's diamond
 * maps to the unit square centred on its integer coordinate.
 */
export function worldToTile(wx: number, wy: number): Vec2 {
  const exact = worldToTileExact(wx, wy);
  // `+ 0` normalises Math.round's -0 to +0. Harmless arithmetically, but -0 would
  // split string keys ("-0,5" vs "0,5") the moment a coordinate is used as one.
  return { x: Math.round(exact.x) + 0, y: Math.round(exact.y) + 0 };
}

/** Render order for overlapping objects on the ground plane. */
export function tileDepth(tx: number, ty: number): number {
  return tx + ty;
}

/** Which map corner is currently drawn at the top of the screen. */
export type ViewRotation = 0 | 1 | 2 | 3;

/**
 * Turns the view by 90 degrees a time.
 *
 * The camera itself never rotates — rotating a 2:1 diamond by 90 degrees would
 * squash it into a 1:2 one and break the projection. Instead the tile grid is
 * remapped before projection, so diamonds keep their shape and only the map's
 * orientation changes.
 *
 * Depth ordering must use the ROTATED coordinates: `x + y` only describes
 * back-to-front from one viewing angle.
 */
export function rotateTile(x: number, y: number, rot: ViewRotation, size: number): Vec2 {
  const max = size - 1;
  switch (rot) {
    case 1:
      return { x: max - y, y: x };
    case 2:
      return { x: max - x, y: max - y };
    case 3:
      return { x: y, y: max - x };
    default:
      return { x, y };
  }
}

/** Inverse of `rotateTile`: takes a picked view-space tile back to world space. */
export function unrotateTile(x: number, y: number, rot: ViewRotation, size: number): Vec2 {
  return rotateTile(x, y, ((4 - rot) % 4) as ViewRotation, size);
}

/**
 * View-space bounding rectangle of a world-space footprint.
 *
 * A rotated rectangle is still a rectangle, so rotating two opposite corners and
 * taking the extremes is enough — and it handles the axis swap on odd turns.
 */
export function rotateFootprint(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: ViewRotation,
  size: number,
): { x: number; y: number; w: number; h: number } {
  const a = rotateTile(x, y, rot, size);
  const b = rotateTile(x + w - 1, y + h - 1, rot, size);
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  return {
    x: minX,
    y: minY,
    w: Math.abs(b.x - a.x) + 1,
    h: Math.abs(b.y - a.y) + 1,
  };
}

/**
 * Tile range covering an axis-aligned world-space rectangle. The four screen
 * corners map to the four extremes in tile space, so min/max over them bounds the
 * visible set. The result is conservative: it includes tiles that are only partly
 * on screen.
 */
export function visibleTiles(left: number, top: number, right: number, bottom: number): TileRect {
  const corners = [
    worldToTileExact(left, top),
    worldToTileExact(right, top),
    worldToTileExact(left, bottom),
    worldToTileExact(right, bottom),
  ];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const c of corners) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }

  return {
    minX: Math.floor(minX),
    minY: Math.floor(minY),
    maxX: Math.ceil(maxX),
    maxY: Math.ceil(maxY),
  };
}
