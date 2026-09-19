/**
 * Placeholder map generation (GDD 4.2/4.3).
 *
 * M0 scope: enough terrain to exercise picking, culling and placement rules.
 * Proper noise-based generation with finite deposits lands in M5.
 */

import { mulberry32, randInt, randRange, type Rng } from '../core/rng';
import { Ore, Terrain, type BuildingDef } from './types';
import { World } from './world';

/** Tiles around the hub kept free of obstacles (GDD 4.2). */
const CLEAR_RADIUS = 12;
/** Ore is pushed at least this far out so the hub itself stays buildable. */
const ORE_CLEAR_RADIUS = 6;

interface PatchSpec {
  readonly ore: Ore;
  readonly patches: number;
  readonly minDist: number;
  readonly maxDist: number;
  /** Tiles painted per patch. */
  readonly size: number;
}

/** Distances follow GDD 4.3 — larger primes sit further out. */
const PATCH_SPECS: readonly PatchSpec[] = [
  { ore: Ore.Iron, patches: 5, minDist: 8, maxDist: 20, size: 95 },
  { ore: Ore.Copper, patches: 5, minDist: 10, maxDist: 22, size: 95 },
  { ore: Ore.Stone, patches: 4, minDist: 12, maxDist: 26, size: 90 },
  { ore: Ore.Coal, patches: 4, minDist: 14, maxDist: 28, size: 70 },
  { ore: Ore.Sand, patches: 3, minDist: 28, maxDist: 46, size: 70 },
  { ore: Ore.Quartz, patches: 2, minDist: 45, maxDist: 60, size: 40 },
];

export function generateWorld(
  size: number,
  seed: number,
  defs: ReadonlyMap<string, BuildingDef>,
): World {
  const world = new World(size, defs);
  const rng = mulberry32(seed);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);

  for (const spec of PATCH_SPECS) {
    for (let i = 0; i < spec.patches; i++) {
      const centre = pickCentre(rng, cx, cy, spec.minDist, spec.maxDist, size);
      paintBlob(world, rng, centre.x, centre.y, spec.size, (w, x, y) => {
        if (distance(x, y, cx, cy) < ORE_CLEAR_RADIUS) return;
        if (w.terrainAt(x, y) !== Terrain.Plain) return;
        w.setOre(x, y, spec.ore);
      });
    }
  }

  // Scenery: impassable blobs that force the player to route belts around them.
  for (let i = 0; i < 26; i++) {
    const centre = pickCentre(rng, cx, cy, CLEAR_RADIUS + 4, size / 2 - 4, size);
    const terrain = rng() < 0.35 ? Terrain.Water : Terrain.Rock;
    paintBlob(world, rng, centre.x, centre.y, randInt(rng, 14, 48), (w, x, y) => {
      if (distance(x, y, cx, cy) < CLEAR_RADIUS) return;
      if (w.oreAt(x, y) !== Ore.None) return;
      w.setTerrain(x, y, terrain);
    });
  }

  return world;
}

function pickCentre(
  rng: Rng,
  cx: number,
  cy: number,
  minDist: number,
  maxDist: number,
  size: number,
): { x: number; y: number } {
  const angle = randRange(rng, 0, Math.PI * 2);
  const dist = randRange(rng, minDist, maxDist);
  return {
    x: clamp(Math.round(cx + Math.cos(angle) * dist), 2, size - 3),
    y: clamp(Math.round(cy + Math.sin(angle) * dist), 2, size - 3),
  };
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Eden-style cluster growth: repeatedly claim a random tile adjacent to the blob.
 *
 * Grows to a bounded, predictable size — unlike a random walk, where the painted
 * area depends on how often the walk revisits itself. Shapes come out organic
 * enough that belts have to route around them.
 */
function paintBlob(
  world: World,
  rng: Rng,
  startX: number,
  startY: number,
  tiles: number,
  paint: (world: World, x: number, y: number) => void,
): void {
  const seen = new Set<number>([startY * world.size + startX]);
  const frontier: { x: number; y: number }[] = [{ x: startX, y: startY }];

  for (let claimed = 0; claimed < tiles && frontier.length > 0; claimed++) {
    const pick = Math.floor(rng() * frontier.length);
    const cell = frontier.splice(pick, 1)[0]!;
    paint(world, cell.x, cell.y);

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const key = ny * world.size + nx;
      if (seen.has(key)) continue;
      seen.add(key);
      frontier.push({ x: nx, y: ny });
    }
  }
}

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
