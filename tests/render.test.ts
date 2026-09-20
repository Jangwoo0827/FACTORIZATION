/**
 * Render maths that can be checked without a GPU.
 *
 * three.js scene objects are plain data until something draws them, so the parts of
 * the renderer that decide *where* things go can be pinned here. What cannot be
 * checked this way is how any of it looks.
 */

import { InstancedMesh, Quaternion, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DX, DY, opposite } from '../src/core/dir';
import { ItemView } from '../src/render/ItemView';
import { arrowRotation, createArrowGeometry } from '../src/render/arrow';
import { SLOTS } from '../src/sim/belts';
import { Simulation } from '../src/sim/simulation';
import { Ore } from '../src/sim/types';
import { belt, makeWorld, run, tileOf } from './helpers';

/** Where each drawn item is, read back out of the instance buffer. */
function drawnPositions(scene: Scene): { x: number; y: number; z: number }[] {
  const mesh = scene.children.find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
  const out = [];
  for (let i = 0; i < mesh.count; i++) {
    const m = mesh.instanceMatrix.array;
    out.push({ x: m[i * 16 + 12]!, y: m[i * 16 + 13]!, z: m[i * 16 + 14]! });
  }
  return out;
}

function setup(build: (world: ReturnType<typeof makeWorld>) => void) {
  const world = makeWorld();
  build(world);
  const sim = new Simulation(world);
  sim.sync();
  const scene = new Scene();
  const view = new ItemView(scene, sim);
  return { world, sim, scene, view };
}

describe('belt direction arrow', () => {
  it.each([0, 1, 2, 3] as const)('points along the way direction %i carries items', (dir) => {
    const forward = new Vector3(1, 0, 0).applyQuaternion(arrowRotation(dir, new Quaternion()));

    // Tile Y is world Z, so grid direction (dx, dy) is world direction (dx, 0, dy).
    expect(forward.x).toBeCloseTo(DX[dir]!, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(DY[dir]!, 6);
  });

  it('never tilts the arrow off the ground plane', () => {
    for (const dir of [0, 1, 2, 3]) {
      const up = new Vector3(0, 1, 0).applyQuaternion(arrowRotation(dir, new Quaternion()));
      expect(up.y).toBeCloseTo(1, 6);
    }
  });
});

describe('belt direction arrow geometry', () => {
  /** Normal of each triangle from its winding, as three.js decides which side is the front. */
  function faceNormalsY(): number[] {
    const position = createArrowGeometry().attributes['position']!;
    const out: number[] = [];
    for (let t = 0; t < position.count; t += 3) {
      const a = new Vector3().fromBufferAttribute(position, t);
      const b = new Vector3().fromBufferAttribute(position, t + 1);
      const c = new Vector3().fromBufferAttribute(position, t + 2);
      out.push(new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).y);
    }
    return out;
  }

  it('has its front faces pointing up, so a double-sided material lights it from above', () => {
    // A clockwise triangle is a back face: three.js flips its lighting normal, and
    // the arrow renders dark instead of bright. This was a real bug.
    const normals = faceNormalsY();
    expect(normals).toHaveLength(2);
    for (const y of normals) expect(y).toBeGreaterThan(0);
  });

  it('lies flat in the ground plane', () => {
    const position = createArrowGeometry().attributes['position']!;
    for (let i = 0; i < position.count; i++) expect(position.getY(i)).toBe(0);
  });

  it('points toward +X, with its tip the furthest forward vertex', () => {
    const position = createArrowGeometry().attributes['position']!;
    let maxX = -Infinity;
    for (let i = 0; i < position.count; i++) maxX = Math.max(maxX, position.getX(i));
    expect(maxX).toBeGreaterThan(0.25);
  });
});

describe('item placement', () => {
  it('draws an item at the centre of a straight belt when p is 0.5', () => {
    const { world, sim, scene, view } = setup((w) => run(w, 0, 5, 5, 0));
    sim.belts.debugPush(tileOf(world, 1, 5), Ore.Iron, 0.5);

    view.update(0);
    const [item] = drawnPositions(scene);

    expect(view.drawn).toBe(1);
    expect(item!.x).toBeCloseTo(1.5, 5);
    expect(item!.z).toBeCloseTo(5.5, 5);
  });

  it('moves along the belt direction as p increases', () => {
    const { world, sim, scene, view } = setup((w) => run(w, 0, 5, 5, 0));
    sim.belts.debugPush(tileOf(world, 1, 5), Ore.Iron, 0.75);

    view.update(0);
    const [item] = drawnPositions(scene);

    // A quarter of a tile past the centre of tile 1, heading +x.
    expect(item!.x).toBeCloseTo(1.75, 5);
    expect(item!.z).toBeCloseTo(5.5, 5);
  });

  it('follows a belt heading the other way', () => {
    // Five belts starting at x=5 and carrying west occupy x = 5, 4, 3, 2, 1.
    const { world, sim, scene, view } = setup((w) => run(w, 5, 5, 5, 2));
    sim.belts.debugPush(tileOf(world, 3, 5), Ore.Iron, 0.75);

    view.update(0);
    const [item] = drawnPositions(scene);

    // Heading -x: a quarter past the centre of tile 3 (x = 3.5) is toward smaller x.
    expect(item!.x).toBeCloseTo(3.25, 5);
  });

  it('sits on top of the belt, not inside it', () => {
    const { world, sim, scene, view } = setup((w) => run(w, 0, 5, 3, 0));
    sim.belts.debugPush(tileOf(world, 1, 5), Ore.Iron, 0.5);

    view.update(0);
    // The belt slab is 0.14 high; the item's centre must clear its top face.
    expect(drawnPositions(scene)[0]!.y).toBeGreaterThan(0.14);
  });

  it('interpolates between the start and end of a tick', () => {
    const { world, sim, scene, view } = setup((w) => run(w, 0, 5, 5, 0));
    const tile = tileOf(world, 1, 5);
    sim.belts.debugPush(tile, Ore.Iron, 0.4);
    // debugPush sets prev = pos; move only the current position, as a tick would.
    sim.belts.pos[tile * SLOTS] = 0.6;

    view.update(0);
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(1.4, 5);
    view.update(0.5);
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(1.5, 5);
    view.update(1);
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(1.6, 5);
  });

  it('counts every item on every belt', () => {
    const { world, sim, view } = setup((w) => run(w, 0, 5, 5, 0));
    for (const x of [0, 1, 2]) {
      sim.belts.debugPush(tileOf(world, x, 5), Ore.Iron, 0.75);
      sim.belts.debugPush(tileOf(world, x, 5), Ore.Iron, 0.25);
    }
    view.update(0);
    expect(view.drawn).toBe(6);
  });
});

describe('item path around a corner', () => {
  // East along y=5, then a belt at x=2 heading south (+y), so items enter it from the west.
  const corner = (w: ReturnType<typeof makeWorld>) => {
    belt(w, 0, 5, 0);
    belt(w, 1, 5, 0);
    belt(w, 2, 5, 1);
    belt(w, 2, 6, 1);
  };

  it('enters from the west edge of the corner tile at p = 0', () => {
    const { world, sim, scene, view } = setup(corner);
    sim.belts.debugPush(tileOf(world, 2, 5), Ore.Iron, 0, opposite(0));

    view.update(0);
    const [item] = drawnPositions(scene);

    // The west edge of tile (2,5) is x = 2, exactly where the previous belt ends.
    expect(item!.x).toBeCloseTo(2.0, 5);
    expect(item!.z).toBeCloseTo(5.5, 5);
  });

  it('reaches the centre at p = 0.5 and then turns south', () => {
    const { world, sim, scene, view } = setup(corner);
    const tile = tileOf(world, 2, 5);

    sim.belts.debugPush(tile, Ore.Iron, 0.5, opposite(0));
    view.update(0);
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(2.5, 5);
    expect(drawnPositions(scene)[0]!.z).toBeCloseTo(5.5, 5);

    sim.belts.pos[tile * SLOTS] = 0.75;
    sim.belts.prev[tile * SLOTS] = 0.75;
    view.update(0);
    // Past the centre it is heading south: x stays put, z increases.
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(2.5, 5);
    expect(drawnPositions(scene)[0]!.z).toBeCloseTo(5.75, 5);
  });

  it('continues in the direction it was already travelling if p goes negative', () => {
    // Interpolation can put an item slightly behind the tile it just entered. It
    // should be drawn back along the previous belt, not jump sideways.
    const { world, sim, scene, view } = setup(corner);
    const tile = tileOf(world, 2, 5);
    sim.belts.debugPush(tile, Ore.Iron, 0, opposite(0));
    sim.belts.prev[tile * SLOTS] = -0.2;

    view.update(0);
    expect(drawnPositions(scene)[0]!.x).toBeCloseTo(1.8, 5);
    expect(drawnPositions(scene)[0]!.z).toBeCloseTo(5.5, 5);
  });

  it('draws a straight-through item on the same tile along the belt axis', () => {
    const { world, sim, scene, view } = setup((w) => run(w, 0, 5, 3, 1));
    sim.belts.debugPush(tileOf(world, 0, 5), Ore.Iron, 0.25);

    view.update(0);
    const [item] = drawnPositions(scene);
    // Heading south: a quarter of the way in, so a quarter before the centre.
    expect(item!.x).toBeCloseTo(0.5, 5);
    expect(item!.z).toBeCloseTo(5.25, 5);
  });
});
