/**
 * Draws every item on every belt as one instanced mesh.
 *
 * Reads the belt buffers directly and writes instance matrices straight into the
 * GPU-bound array, with no per-item objects, so 10,000+ items cost one draw call
 * and no allocation per frame.
 *
 * The simulation ticks at 30 Hz but the screen runs faster, so each item is drawn
 * between where it was at the start of the tick and where it is now, by how far
 * through the tick the frame lands (`alpha`).
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshLambertMaterial,
  Scene,
} from 'three';
import { DX, DY } from '../core/dir';
import { SLOTS, STRAIGHT } from '../sim/belts';
import type { Simulation } from '../sim/simulation';
import { DEF_MAP } from '../data/buildings';
import { ITEM_DEFS } from '../data/items';
import { ITEM_COUNT } from '../sim/types';

/** Comfortably above what fits on the map: 128x128 tiles x 4 slots is 65,536. */
const CAPACITY = 40000;
const ITEM_SIZE = 0.2;
/** Belt slab height, so items sit on top of it rather than inside it. */
const BELT_TOP = 0.14;
const ITEM_Y = BELT_TOP + ITEM_SIZE / 2;
/** A splitter is taller than a belt; the item it holds rides on top of it. */
const SPLITTER_Y = (DEF_MAP.get('splitter')?.height ?? 0.34) + ITEM_SIZE / 2;

export class ItemView {
  private readonly mesh: InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly colours: Float32Array;
  /** Linear RGB per item id, precomputed so a frame does no colour conversion. */
  private readonly palette = new Float32Array(ITEM_COUNT * 3);

  constructor(
    scene: Scene,
    private readonly sim: Simulation,
  ) {
    this.mesh = new InstancedMesh(
      new BoxGeometry(ITEM_SIZE, ITEM_SIZE, ITEM_SIZE),
      new MeshLambertMaterial({ color: 0xffffff }),
      CAPACITY,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // Creates the colour attribute, which is then written to directly.
    this.mesh.setColorAt(0, new Color());
    const colourAttribute = this.mesh.instanceColor as InstancedBufferAttribute;
    colourAttribute.setUsage(DynamicDrawUsage);

    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.colours = colourAttribute.array as Float32Array;

    const colour = new Color();
    for (const def of ITEM_DEFS) {
      colour.setHex(def.color);
      this.palette.set([colour.r, colour.g, colour.b], def.id * 3);
    }

    // Identity rotation and a fixed scale never change, so write them once.
    for (let i = 0; i < CAPACITY; i++) {
      const o = i * 16;
      this.matrices[o] = 1;
      this.matrices[o + 5] = 1;
      this.matrices[o + 10] = 1;
      this.matrices[o + 15] = 1;
    }

    scene.add(this.mesh);
  }

  get drawn(): number {
    return this.mesh.count;
  }

  update(alpha: number): void {
    const belts = this.sim.belts;
    const size = belts.size;
    const matrices = this.matrices;
    const colours = this.colours;
    const palette = this.palette;

    let n = 0;
    const tiles = belts.orderedTiles();

    outer: for (let t = 0; t < tiles.length; t++) {
      const tile = tiles[t]!;
      const count = belts.count[tile]!;
      if (count === 0) {
        // A splitter holds its one item in a separate slot, and would otherwise be
        // invisible while everything behind it waited.
        const held = belts.splitterItem[tile]!;
        if (held !== 0 && n < CAPACITY) {
          const tx = tile % size;
          const m = n * 16;
          matrices[m + 12] = tx + 0.5;
          matrices[m + 13] = SPLITTER_Y;
          matrices[m + 14] = (tile - tx) / size + 0.5;
          const c = n * 3;
          colours[c] = palette[held * 3]!;
          colours[c + 1] = palette[held * 3 + 1]!;
          colours[c + 2] = palette[held * 3 + 2]!;
          n++;
        }
        continue;
      }

      const d = belts.dir[tile]!;
      const x = tile % size;
      const cx = x + 0.5;
      const cz = (tile - x) / size + 0.5;
      const base = tile * SLOTS;

      for (let i = 0; i < count; i++) {
        if (n >= CAPACITY) break outer;
        const slot = base + i;
        const prev = belts.prev[slot]!;
        const p = prev + (belts.pos[slot]! - prev) * alpha;
        const side = belts.lat[slot]!;

        let wx: number;
        let wz: number;
        if (side === STRAIGHT || p >= 0.5) {
          // Along the belt: the centre is p = 0.5.
          const along = p - 0.5;
          wx = cx + DX[d]! * along;
          wz = cz + DY[d]! * along;
        } else {
          // Still on the approach from a side edge toward the centre. Continuing
          // past p = 0 keeps going the way the item was already heading, so the
          // path stays smooth as an item crosses in from the previous tile.
          const across = 0.5 - p;
          wx = cx + DX[side]! * across;
          wz = cz + DY[side]! * across;
        }

        const m = n * 16;
        matrices[m + 12] = wx;
        matrices[m + 13] = ITEM_Y;
        matrices[m + 14] = wz;

        const item = belts.item[slot]! * 3;
        const c = n * 3;
        colours[c] = palette[item]!;
        colours[c + 1] = palette[item + 1]!;
        colours[c + 2] = palette[item + 2]!;
        n++;
      }
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }
}
