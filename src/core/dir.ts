/**
 * Grid directions.
 *
 * A building's `rot` doubles as the direction a conveyor carries items, so this is
 * the single source of truth for what each value means. Tile `y` is world Z.
 *
 *   0 = +x    1 = +y (world +Z)    2 = -x    3 = -y (world -Z)
 *
 * Successive values turn the same way, so `(d + 1) % 4` is a quarter turn and
 * `(d + 2) % 4` is the opposite direction.
 */

export type Dir = 0 | 1 | 2 | 3;

export const DX: readonly number[] = [1, 0, -1, 0];
export const DY: readonly number[] = [0, 1, 0, -1];

export function opposite(d: number): Dir {
  return ((d + 2) % 4) as Dir;
}

/** Direction of a unit axis-aligned step, or -1 when the step is not one tile along an axis. */
export function dirFromStep(dx: number, dy: number): Dir | -1 {
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  return -1;
}
