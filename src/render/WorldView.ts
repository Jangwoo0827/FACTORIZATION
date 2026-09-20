/**
 * Draws the world (GDD 13.1 — procedural placeholders, no art assets yet).
 *
 * Everything repeated is an InstancedMesh, so a map full of ore and a factory full
 * of machines each cost a handful of draw calls. That matters more here than it
 * did in 2D, because M1 puts thousands of items on belts.
 *
 * There is no depth sorting anywhere in this file. The z-buffer does it now, which
 * is the single largest simplification the move to 3D bought.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  GridHelper,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { MAP_SIZE } from '../config';
import { footprintCenter } from '../core/grid';
import { arrowRotation, createArrowGeometry } from './arrow';
import { DEF_MAP } from '../data/buildings';
import { ORE_INFO, Ore, Terrain, isBeltKind, rotatedSize, type BuildingDef } from '../sim/types';
import type { World } from '../sim/world';

const GROUND_COLOR = 0x2f362c;
const TERRAIN_COLOR: Readonly<Record<Terrain, number>> = {
  [Terrain.Plain]: GROUND_COLOR,
  [Terrain.Water]: 0x1f4a63,
  [Terrain.Rock]: 0x50524e,
};

/** Lifts decals clear of the ground plane so they do not z-fight with it. */
const DECAL_Y = 0.012;
const GRID_Y = 0.02;

const ARROW_COLOR = 0xdbe6ee;
const ARROW_LIFT = 0.006;

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

export class WorldView {
  private readonly buildingLayers = new Map<string, InstancedMesh>();
  private readonly grid: GridHelper;

  private readonly scratchObject = new Object3D();
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly identityRotation = new Quaternion();
  private readonly scratchRotation = new Quaternion();

  constructor(
    private readonly scene: Scene,
    private readonly world: World,
  ) {
    this.buildGround();
    this.buildDecals();

    this.grid = new GridHelper(MAP_SIZE, MAP_SIZE, 0x5d6f7a, 0x44525c);
    this.grid.position.set(MAP_SIZE / 2, GRID_Y, MAP_SIZE / 2);
    this.grid.visible = false;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.25;
    this.scene.add(this.grid);
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  /** Rebuilds every building instance. Cheap enough to run on any world change. */
  refreshBuildings(): void {
    const grouped = new Map<string, Placed[]>();

    for (const building of this.world.buildings()) {
      const def = DEF_MAP.get(building.defId);
      if (!def) continue;
      const { w, h } = rotatedSize(def, building.rot);
      const list = grouped.get(def.id) ?? [];
      list.push({ x: building.x, y: building.y, w, h, rot: building.rot });
      grouped.set(def.id, list);
    }

    for (const def of DEF_MAP.values()) {
      const items = grouped.get(def.id) ?? [];
      this.writeSlabs(def, items);
      // A belt is a slab plus an arrow on top of it: without the arrow there is no
      // way to tell which way a line of belts carries anything.
      if (isBeltKind(def.kind)) this.writeArrows(def, items);
    }
  }

  private writeSlabs(def: BuildingDef, items: readonly Placed[]): void {
    const mesh = this.layerFor(`${def.id}:slab`, items.length, () => ({
      geometry: unitBox(),
      material: new MeshLambertMaterial({ color: def.color }),
    }));

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const centre = footprintCenter(item.x, item.y, item.w, item.h);
      this.scratchPosition.set(centre.x, 0, centre.z);
      this.scratchScale.set(item.w * 0.92, def.height, item.h * 0.92);
      this.scratchMatrix.compose(this.scratchPosition, this.identityRotation, this.scratchScale);
      mesh.setMatrixAt(i, this.scratchMatrix);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private writeArrows(def: BuildingDef, items: readonly Placed[]): void {
    const mesh = this.layerFor(`${def.id}:arrow`, items.length, () => ({
      geometry: sharedArrow(),
      material: new MeshLambertMaterial({
        color: ARROW_COLOR,
        side: DoubleSide,
        // Lies a hair above the slab's top face; the bias settles the depth test at
        // shallow camera angles, as it does for the ore decals.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    }));

    this.scratchScale.set(1, 1, 1);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const centre = footprintCenter(item.x, item.y, item.w, item.h);
      this.scratchPosition.set(centre.x, def.height + ARROW_LIFT, centre.z);
      arrowRotation(item.rot, this.scratchRotation);
      this.scratchMatrix.compose(this.scratchPosition, this.scratchRotation, this.scratchScale);
      mesh.setMatrixAt(i, this.scratchMatrix);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private layerFor(
    key: string,
    needed: number,
    make: () => { geometry: BufferGeometry; material: MeshLambertMaterial },
  ): InstancedMesh {
    const existing = this.buildingLayers.get(key);
    if (existing && existing.instanceMatrix.count >= needed) return existing;

    // InstancedMesh capacity is fixed at construction, so grow by replacing.
    // Doubling keeps this rare as a factory expands. The material is reused so a
    // resize does not recompile shaders or leak the old one.
    let parts: { geometry: BufferGeometry; material: MeshLambertMaterial };
    if (existing) {
      parts = { geometry: existing.geometry, material: existing.material as MeshLambertMaterial };
      this.scene.remove(existing);
      existing.dispose();
    } else {
      parts = make();
    }

    const capacity = Math.max(64, nextPowerOfTwo(needed));
    const mesh = new InstancedMesh(parts.geometry, parts.material, capacity);
    mesh.count = 0;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.buildingLayers.set(key, mesh);
    return mesh;
  }

  private buildGround(): void {
    const geometry = new PlaneGeometry(MAP_SIZE, MAP_SIZE);
    geometry.rotateX(-Math.PI / 2);
    const ground = new Mesh(geometry, new MeshLambertMaterial({ color: GROUND_COLOR }));
    ground.position.set(MAP_SIZE / 2, 0, MAP_SIZE / 2);
    this.scene.add(ground);
  }

  /**
   * Ore and impassable terrain as flat decals on the ground — one instanced mesh
   * for all of them, tinted per instance.
   */
  private buildDecals(): void {
    const tiles: { x: number; y: number; color: number }[] = [];

    for (let y = 0; y < this.world.size; y++) {
      for (let x = 0; x < this.world.size; x++) {
        const terrain = this.world.terrainAt(x, y);
        const ore = this.world.oreAt(x, y);

        if (terrain !== Terrain.Plain) {
          tiles.push({ x, y, color: TERRAIN_COLOR[terrain] });
        } else if (ore !== Ore.None) {
          // Muted toward the ground: saturated colour is reserved for items and
          // machines so those stay the layer the eye goes to (GDD 13.1).
          const info = ORE_INFO[ore as Exclude<Ore, 0>];
          tiles.push({ x, y, color: mix(GROUND_COLOR, info.color, 0.6) });
        }
      }
    }

    if (tiles.length === 0) return;

    const geometry = new PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({
        color: 0xffffff,
        // Decals sit a hair above the ground, which is not enough separation at
        // shallow camera angles. Biasing them toward the camera in the depth test
        // settles it regardless of angle or depth-buffer precision.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
      tiles.length,
    );
    mesh.frustumCulled = false;

    const colour = new Color();
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i]!;
      this.scratchObject.position.set(tile.x + 0.5, DECAL_Y, tile.y + 0.5);
      this.scratchObject.scale.set(1, 1, 1);
      this.scratchObject.rotation.set(0, 0, 0);
      this.scratchObject.updateMatrix();
      mesh.setMatrixAt(i, this.scratchObject.matrix);
      mesh.setColorAt(i, colour.setHex(tile.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.scene.add(mesh);
  }
}

let sharedBox: BoxGeometry | null = null;

/** A 1x1x1 box whose origin sits at its base, so instance scale grows upward. */
function unitBox(): BoxGeometry {
  if (!sharedBox) {
    sharedBox = new BoxGeometry(1, 1, 1);
    sharedBox.translate(0, 0.5, 0);
  }
  return sharedBox;
}

let arrowGeometry: BufferGeometry | null = null;

function sharedArrow(): BufferGeometry {
  if (!arrowGeometry) arrowGeometry = createArrowGeometry();
  return arrowGeometry;
}

function nextPowerOfTwo(value: number): number {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

/** Linear blend between two packed RGB colours. */
function mix(a: number, b: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
