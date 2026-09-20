/**
 * The chevron that shows which way a conveyor carries items.
 *
 * Shared by the built belts and the placement ghost so they can never disagree
 * about what "pointing east" looks like.
 */

import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three';
import { DX, DY } from '../core/dir';

const UP = new Vector3(0, 1, 0);

/** A flat arrowhead in the XZ plane pointing along local +X, with a notched tail. */
export function createArrowGeometry(): BufferGeometry {
  const tip = [0.3, 0, 0];
  const left = [-0.2, 0, 0.24];
  const notch = [-0.05, 0, 0];
  const right = [-0.2, 0, -0.24];

  // Counter-clockwise as seen from above, so the front face points up. This is not
  // cosmetic: a double-sided material flips the lighting normal on a back face, so
  // a clockwise triangle renders as if lit from underneath and comes out dark.
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute([...tip, ...notch, ...left, ...tip, ...right, ...notch], 3),
  );
  geometry.setAttribute(
    'normal',
    new Float32BufferAttribute(Array.from({ length: 6 }, () => [0, 1, 0]).flat(), 3),
  );
  return geometry;
}

/**
 * Rotation about Y that turns local +X onto grid direction `dir`.
 *
 * Tile Y is world Z, and a rotation by theta about Y sends +X to (cos t, 0, -sin t),
 * so the angle for a direction (dx, dz) is atan2(-dz, dx).
 */
export function arrowRotation(dir: number, out: Quaternion = new Quaternion()): Quaternion {
  return out.setFromAxisAngle(UP, Math.atan2(-DY[dir]!, DX[dir]!));
}
