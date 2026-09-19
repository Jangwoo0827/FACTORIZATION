/**
 * Wires the simulation, the renderer and the HUD together, and owns the frame loop.
 *
 * Replaces the Phaser scene. three.js is a renderer rather than an engine, so the
 * loop, resize handling and input wiring live here explicitly.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  DEFAULT_SEED,
  KEYBOARD_PAN_TILES_PER_SEC,
  MAP_SIZE,
  YAW_SPEED,
  YAW_STEP,
} from '../config';
import { worldToTile, type Vec2 } from '../core/grid';
import { tileLine } from '../core/line';
import { BUILDING_DEFS, DEF_MAP } from '../data/buildings';
import { CompositeCommand, History, PlaceCommand, RemoveCommand, type Command } from '../input/commands';
import { InputAdapter } from '../input/InputAdapter';
import {
  ORE_INFO,
  Ore,
  PLACEMENT_MESSAGE,
  Terrain,
  rotatedSize,
  type BuildingDef,
  type PlacedBuilding,
  type Rotation,
} from '../sim/types';
import type { World } from '../sim/world';
import { generateWorld } from '../sim/worldgen';
import { Hud } from '../ui/Hud';
import { CameraRig } from './CameraRig';
import { GhostView } from './GhostView';
import { WorldView } from './WorldView';

const BACKGROUND = 0x11161b;
/** Below this zoom the grid is denser than the pixels available to draw it. */
const GRID_MAX_VIEW_SIZE = 70;

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly world: World;
  private readonly worldView: WorldView;
  private readonly ghost: GhostView;
  private readonly adapter: InputAdapter;
  private readonly hud: Hud;
  private readonly history = new History();

  private selectedDefId: string | null = null;
  private eraseMode = false;
  private rotation: Rotation = 0;
  private hoverTile: Vec2 | null = null;

  private stroke: Command[] = [];
  private strokeTiles = new Set<number>();
  private lastStrokeTile: Vec2 | null = null;

  private lastFrame = performance.now();
  private disposed = false;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(BACKGROUND);
    // No fog: an orthographic camera sits a fixed CAMERA_DISTANCE from its target,
    // so any fog range expressed in map units swallows the whole scene. A distance
    // fade, if wanted later, has to be written relative to CAMERA_DISTANCE.
    this.addLights();

    this.world = generateWorld(MAP_SIZE, DEFAULT_SEED, DEF_MAP);
    this.worldView = new WorldView(this.scene, this.world);
    this.ghost = new GhostView(this.scene);
    this.worldView.refreshBuildings();

    this.rig.lookAtTile(MAP_SIZE / 2, MAP_SIZE / 2);

    this.hud = new Hud(BUILDING_DEFS, {
      onSelectBuilding: (id) => this.selectBuilding(id),
      onSelectErase: () => this.toggleErase(),
      onRotate: () => this.rotateBuilding(),
      onRotateView: (delta) => {
        this.rig.rotateYaw(delta * YAW_STEP);
        this.refreshHud();
      },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });

    this.adapter = new InputAdapter({
      element: this.renderer.domElement,
      isToolActive: () => this.toolActive(),
      handlers: {
        onPan: (dx, dy) => this.rig.panScreen(dx, dy),
        onOrbit: (dx, dy) => {
          this.rig.orbit(-dx * 0.006, -dy * 0.006);
          this.refreshHud();
        },
        onZoom: (factor, focus) => {
          this.rig.zoomAt(factor, focus);
          this.refreshHud();
        },
        onHover: (screen) => this.setHover(screen ? this.tileAt(screen) : null),
        onPrimaryStart: (screen) => this.startStroke(screen, this.eraseMode),
        onPrimaryDrag: (screen) => this.extendStroke(screen, this.eraseMode),
        onPrimaryEnd: (cancelled) => this.endStroke(cancelled),
        onSecondaryStart: (screen) => this.startStroke(screen, true),
        onSecondaryDrag: (screen) => this.extendStroke(screen, true),
        onSecondaryEnd: (cancelled) => this.endStroke(cancelled),
        onTap: (screen) => this.inspect(this.tileAt(screen)),
        onPick: (screen) => this.eyedropper(this.tileAt(screen)),
        onRotate: () => this.rotateBuilding(),
        onUndo: () => this.undo(),
        onRedo: () => this.redo(),
        onCancel: () => this.clearTool(),
      },
    });

    window.addEventListener('resize', this.onResize);
    this.onResize();

    this.hud.setHint(
      '건물을 고르고 드래그해 지으세요. 우클릭 철거, 휠 확대, R 건물 회전, Q/E 시점 회전, 가운데 드래그로 각도.',
    );
    this.refreshHud();

    this.renderer.setAnimationLoop(this.frame);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.adapter.destroy();
    this.hud.destroy();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- loop

  private frame = (): void => {
    const now = performance.now();
    const delta = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    const pan = this.adapter.keyboardPan();
    if (pan.x !== 0 || pan.y !== 0) {
      const speed = KEYBOARD_PAN_TILES_PER_SEC * delta * (this.rig.zoom / 44);
      // Keyboard pan is expressed in screen space too, so it agrees with dragging.
      this.rig.panScreen(-pan.x * speed * 20, -pan.y * speed * 20);
    }

    const yaw = this.adapter.keyboardYaw();
    if (yaw !== 0) {
      this.rig.rotateYaw(yaw * YAW_SPEED * delta);
      this.refreshHud();
    }

    this.worldView.setGridVisible(this.toolActive() && this.rig.zoom <= GRID_MAX_VIEW_SIZE);
    this.renderer.render(this.scene, this.rig.camera);
  };

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height, false);
    this.rig.setViewport(width, height);
  };

  private addLights(): void {
    // Sky/ground bounce keeps shaded faces from going flat black, then a single
    // key light gives each box face a distinct value so silhouettes read.
    this.scene.add(new HemisphereLight(0x9fb8c8, 0x2b2f26, 1.1));
    this.scene.add(new AmbientLight(0xffffff, 0.35));

    const key = new DirectionalLight(0xfff2dd, 1.5);
    key.position.set(-0.6, 1, 0.45);
    this.scene.add(key);

    const fill = new DirectionalLight(0x93b4d6, 0.4);
    fill.position.set(0.7, 0.4, -0.5);
    this.scene.add(fill);
  }

  // ---------------------------------------------------------------- tools

  private toolActive(): boolean {
    return this.eraseMode || this.selectedDefId !== null;
  }

  private selectBuilding(defId: string | null): void {
    this.selectedDefId = defId;
    this.eraseMode = false;
    this.refreshGhost();
    this.refreshHud();
  }

  private toggleErase(): void {
    this.eraseMode = !this.eraseMode;
    if (this.eraseMode) this.selectedDefId = null;
    this.refreshGhost();
    this.refreshHud();
  }

  private clearTool(): void {
    this.selectedDefId = null;
    this.eraseMode = false;
    this.refreshGhost();
    this.refreshHud();
  }

  private rotateBuilding(): void {
    this.rotation = ((this.rotation + 1) % 4) as Rotation;
    this.refreshGhost();
    this.refreshHud();
  }

  private eyedropper(tile: Vec2): void {
    const building = this.world.buildingAt(tile.x, tile.y);
    if (!building) return;
    this.selectedDefId = building.defId;
    this.eraseMode = false;
    this.rotation = building.rot;
    this.refreshGhost();
    this.refreshHud();
  }

  private inspect(tile: Vec2): void {
    this.setHover(tile);
    const building = this.world.buildingAt(tile.x, tile.y);
    const def = building ? DEF_MAP.get(building.defId) : undefined;
    this.hud.setHint(def ? `${def.name} · ${def.w}x${def.h}` : this.describeTile(tile));
  }

  // ---------------------------------------------------------------- strokes

  private startStroke(screen: Vec2, erasing: boolean): void {
    this.stroke = [];
    this.strokeTiles.clear();
    const tile = this.tileAt(screen);
    this.lastStrokeTile = tile;
    this.applyAt(tile, erasing);
  }

  /** Fills the tiles between pointer samples so a fast drag lays an unbroken run. */
  private extendStroke(screen: Vec2, erasing: boolean): void {
    const tile = this.tileAt(screen);
    this.setHover(tile);

    const from = this.lastStrokeTile;
    if (from) {
      for (const step of tileLine(from.x, from.y, tile.x, tile.y)) this.applyAt(step, erasing);
    } else {
      this.applyAt(tile, erasing);
    }
    this.lastStrokeTile = tile;
  }

  private endStroke(cancelled: boolean): void {
    if (cancelled) {
      for (let i = this.stroke.length - 1; i >= 0; i--) this.stroke[i]!.undo(this.world);
    } else if (this.stroke.length > 0) {
      this.history.record(
        this.stroke.length === 1 ? this.stroke[0]! : new CompositeCommand(this.stroke),
      );
    }
    this.stroke = [];
    this.strokeTiles.clear();
    this.lastStrokeTile = null;
    this.worldView.refreshBuildings();
    this.refreshGhost();
    this.refreshHud();
  }

  private applyAt(tile: Vec2, erasing: boolean): void {
    if (erasing) this.applyErase(tile);
    else this.applyPlace(tile);
  }

  private applyPlace(tile: Vec2): void {
    const defId = this.selectedDefId;
    if (!defId) return;
    const def = DEF_MAP.get(defId);
    if (!def) return;

    const origin = this.originFor(def, tile);
    const key = this.tileKey(origin.x, origin.y);
    if (this.strokeTiles.has(key)) return;
    this.strokeTiles.add(key);

    if (!this.world.checkPlacement(defId, origin.x, origin.y, this.rotation).ok) return;

    const command = new PlaceCommand(defId, origin.x, origin.y, this.rotation);
    command.redo(this.world);
    this.stroke.push(command);
    this.worldView.refreshBuildings();
  }

  private applyErase(tile: Vec2): void {
    const key = this.tileKey(tile.x, tile.y);
    if (this.strokeTiles.has(key)) return;
    this.strokeTiles.add(key);

    const building = this.world.buildingAt(tile.x, tile.y);
    if (!building) return;

    const command = new RemoveCommand(building);
    command.redo(this.world);
    this.stroke.push(command);
    this.worldView.refreshBuildings();
  }

  private undo(): void {
    if (!this.history.undo(this.world)) return;
    this.worldView.refreshBuildings();
    this.refreshGhost();
    this.refreshHud();
  }

  private redo(): void {
    if (!this.history.redo(this.world)) return;
    this.worldView.refreshBuildings();
    this.refreshGhost();
    this.refreshHud();
  }

  // ---------------------------------------------------------------- view

  private setHover(tile: Vec2 | null): void {
    if (tile && !this.world.inBounds(tile.x, tile.y)) tile = null;
    if (tile && this.hoverTile && tile.x === this.hoverTile.x && tile.y === this.hoverTile.y) return;
    if (!tile && !this.hoverTile) return;
    this.hoverTile = tile;
    this.refreshGhost();
    this.refreshHud();
  }

  private refreshGhost(): void {
    const hover = this.hoverTile;
    if (!hover) {
      this.ghost.hide();
      return;
    }

    if (this.eraseMode) {
      const building = this.world.buildingAt(hover.x, hover.y);
      const target = building ? this.footprintOf(building) : { x: hover.x, y: hover.y, w: 1, h: 1 };
      const def = building ? DEF_MAP.get(building.defId) : undefined;
      this.ghost.showErase(target.x, target.y, target.w, target.h, def?.height ?? 0.35);
      return;
    }

    const defId = this.selectedDefId;
    if (!defId) {
      this.ghost.hide();
      return;
    }
    const def = DEF_MAP.get(defId);
    if (!def) {
      this.ghost.hide();
      return;
    }

    const origin = this.originFor(def, hover);
    const { w, h } = rotatedSize(def, this.rotation);
    const valid = this.world.checkPlacement(defId, origin.x, origin.y, this.rotation).ok;
    this.ghost.showBuilding(origin.x, origin.y, w, h, def.height, def.color, valid);
  }

  /** Larger footprints centre on the pointer rather than hanging off it. */
  private originFor(def: BuildingDef, tile: Vec2): Vec2 {
    const { w, h } = rotatedSize(def, this.rotation);
    return {
      x: tile.x - Math.floor((w - 1) / 2),
      y: tile.y - Math.floor((h - 1) / 2),
    };
  }

  private footprintOf(building: PlacedBuilding): { x: number; y: number; w: number; h: number } {
    const def = DEF_MAP.get(building.defId);
    if (!def) return { x: building.x, y: building.y, w: 1, h: 1 };
    const { w, h } = rotatedSize(def, building.rot);
    return { x: building.x, y: building.y, w, h };
  }

  /** Screen point -> tile, by raycasting the ground plane. */
  private tileAt(screen: Vec2): Vec2 {
    const ground = this.rig.groundAt(screen);
    if (!ground) return { x: -1, y: -1 };
    return worldToTile(ground.x, ground.z);
  }

  private tileKey(x: number, y: number): number {
    return y * this.world.size + x;
  }

  private describeTile(tile: Vec2): string {
    if (!this.world.inBounds(tile.x, tile.y)) return '맵 밖';
    const ore = this.world.oreAt(tile.x, tile.y);
    if (ore !== Ore.None) {
      const info = ORE_INFO[ore as Exclude<Ore, 0>];
      // The prime is the theme's hook (GDD 5.1) — surface it wherever ore appears.
      return `${info.name} · 소수 ${info.prime}`;
    }
    const terrain = this.world.terrainAt(tile.x, tile.y);
    if (terrain === Terrain.Water) return '물 — 건설 불가';
    if (terrain === Terrain.Rock) return '암석 — 건설 불가';
    return '평지';
  }

  private refreshHud(): void {
    const tile = this.hoverTile;
    this.hud.setSelection(this.eraseMode ? 'erase' : this.selectedDefId);
    this.hud.setStatus({
      tile,
      rotation: this.rotation,
      yaw: this.rig.yaw,
      buildings: this.world.buildingCount,
      zoom: this.rig.zoom,
      detail: tile ? this.describeTile(tile) : '—',
      problem: this.placementProblem(),
    });
  }

  private placementProblem(): string | null {
    const tile = this.hoverTile;
    const defId = this.selectedDefId;
    if (!tile || !defId || this.eraseMode) return null;
    const def = DEF_MAP.get(defId);
    if (!def) return null;
    const origin = this.originFor(def, tile);
    const result = this.world.checkPlacement(defId, origin.x, origin.y, this.rotation);
    return result.ok ? null : PLACEMENT_MESSAGE[result.reason];
  }
}
