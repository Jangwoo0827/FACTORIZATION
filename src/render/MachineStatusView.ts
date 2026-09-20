/**
 * A small light on top of every crafting machine showing what it is doing (GDD 6.2).
 *
 * The diagnostic that matters most in a factory game is "why is that machine not
 * working?" Green is crafting, amber is waiting for an ingredient, red is blocked
 * with nowhere to put its product, and grey has no recipe. A whole factory reads at a
 * glance, and the amber and red ones are where the problem is.
 */

import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  Scene,
} from 'three';
import { footprintCenter } from '../core/grid';
import type { MachineStatus } from '../sim/machines';
import type { Simulation } from '../sim/simulation';
import { rotatedSize } from '../sim/types';

const CAPACITY = 4096;
const LIGHT_SIZE = 0.34;

const STATUS_COLOUR: Readonly<Record<MachineStatus, number>> = {
  working: 0x5dd67a,
  waiting: 0xe8c34a,
  blocked: 0xe4635c,
  'no-recipe': 0x7d8794,
};

interface Light {
  readonly id: number;
}

export class MachineStatusView {
  private readonly mesh: InstancedMesh;
  private readonly colours: Float32Array;
  private readonly palette: Readonly<Record<MachineStatus, [number, number, number]>>;
  private lights: Light[] = [];
  private revision = -1;

  constructor(
    scene: Scene,
    private readonly sim: Simulation,
  ) {
    // Unlit, so a light stays the colour it says regardless of where the sun is.
    this.mesh = new InstancedMesh(
      new BoxGeometry(LIGHT_SIZE, LIGHT_SIZE, LIGHT_SIZE),
      new MeshBasicMaterial({ color: 0xffffff }),
      CAPACITY,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new Color());
    const attribute = this.mesh.instanceColor as InstancedBufferAttribute;
    attribute.setUsage(DynamicDrawUsage);
    this.colours = attribute.array as Float32Array;

    const colour = new Color();
    const entries = Object.entries(STATUS_COLOUR).map(([status, hex]) => {
      colour.setHex(hex);
      return [status, [colour.r, colour.g, colour.b] as [number, number, number]] as const;
    });
    this.palette = Object.fromEntries(entries) as Record<MachineStatus, [number, number, number]>;

    scene.add(this.mesh);
  }

  get count(): number {
    return this.mesh.count;
  }

  /** Repositions lights when the map changed, and recolours them every call. */
  update(): void {
    const world = this.sim.world;
    if (world.revision !== this.revision) {
      this.rebuild();
      this.revision = world.revision;
    }

    for (let i = 0; i < this.lights.length; i++) {
      const status = this.sim.machines.info(this.lights[i]!.id)?.status ?? 'no-recipe';
      const c = this.palette[status];
      const o = i * 3;
      this.colours[o] = c[0];
      this.colours[o + 1] = c[1];
      this.colours[o + 2] = c[2];
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
    this.mesh.removeFromParent();
  }

  private rebuild(): void {
    const world = this.sim.world;
    this.lights = [];
    const matrices = this.mesh.instanceMatrix.array as Float32Array;

    for (const building of world.buildings()) {
      const def = world.defOf(building);
      if (!def || def.kind !== 'machine') continue;
      if (this.lights.length >= CAPACITY) break;

      const { w, h } = rotatedSize(def, building.rot);
      const centre = footprintCenter(building.x, building.y, w, h);
      const o = this.lights.length * 16;

      // Identity rotation, translated to just above the machine's roof.
      matrices.fill(0, o, o + 16);
      matrices[o] = 1;
      matrices[o + 5] = 1;
      matrices[o + 10] = 1;
      matrices[o + 12] = centre.x;
      matrices[o + 13] = def.height + LIGHT_SIZE * 0.75;
      matrices[o + 14] = centre.z;
      matrices[o + 15] = 1;

      this.lights.push({ id: building.id });
    }

    this.mesh.count = this.lights.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
