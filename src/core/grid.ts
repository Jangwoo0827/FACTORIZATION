/**
 * Tile grid <-> 3D world space.
 *
 * Replaces the isometric projection maths: in 3D the camera handles the viewing
 * angle, so the grid is simply axis-aligned on the XZ plane with Y up. Tile
 * (x, y) covers world X in [x, x+1) and world Z in [y, y+1).
 *
 * Note the change of rounding from the isometric version. There, a tile's diamond
 * mapped to the unit square *centred* on its coordinate, so picking rounded.
 * Here a tile owns the square starting at its coordinate, so picking floors.
 *
 * Pure maths: no three.js, no DOM.
 */

/** A tile coordinate. `y` is the grid's second axis, which is world Z. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Centre of a tile, on the ground plane. */
export function tileCenter(tx: number, ty: number): Vec3 {
  return { x: tx + 0.5, y: 0, z: ty + 0.5 };
}

/** Ground point -> the tile containing it. */
export function worldToTile(wx: number, wz: number): Vec2 {
  return { x: Math.floor(wx), y: Math.floor(wz) };
}

/** Centre of a w x h footprint whose minimum corner is tile (tx, ty). */
export function footprintCenter(tx: number, ty: number, w: number, h: number): Vec3 {
  return { x: tx + w / 2, y: 0, z: ty + h / 2 };
}

/**
 * Where a w x h footprint should sit so that its centre is as close as it can get
 * to a ground point (`gx`, `gz`), returned as the footprint's minimum-corner tile.
 *
 * A footprint's centre can only land on a tile centre when a side is odd, or on a
 * tile corner when it is even. Rounding `g - size/2` picks the nearest of those,
 * which is what makes a 2x2 building sit on the corner nearest the cursor instead
 * of hanging half a tile off it (the old rule took the cursor's tile as the corner,
 * which was always half a tile toward +x,+z).
 *
 * For a 1x1 this reduces to `floor`, so single tiles behave exactly as before.
 */
export function footprintOrigin(gx: number, gz: number, w: number, h: number): Vec2 {
  // `+ 0` normalises -0 to +0, so an origin can be used as a string key safely.
  return { x: Math.round(gx - w / 2) + 0, y: Math.round(gz - h / 2) + 0 };
}
