/**
 * Wires the simulation, the renderer and the HUD together, and owns the frame loop.
 *
 * three.js is a renderer rather than an engine, so the loop, resize handling and
 * input wiring live here explicitly. The simulation advances in fixed 30 Hz ticks
 * decoupled from the display rate; the renderer interpolates between ticks.
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
  DEFAULT_VIEW_SIZE,
  KEYBOARD_PAN_TILES_PER_SEC,
  MAP_SIZE,
  MAX_SIM_STEPS_PER_FRAME,
  MINER_BUFFER,
  SIM_TPS,
  YAW_SPEED,
  YAW_STEP,
} from '../config';
import { dirFromStep } from '../core/dir';
import { worldToTile, type Vec2 } from '../core/grid';
import { tileLine, walkGrid } from '../core/line';
import { BUILDABLE_DEFS, DEF_MAP } from '../data/buildings';
import { CompositeCommand, History, PlaceCommand, RemoveCommand, type Command } from '../input/commands';
import { InputAdapter } from '../input/InputAdapter';
import { buildRings, createBenchWorld, fillBelts } from '../sim/bench';
import { Simulation, placeHub } from '../sim/simulation';
import {
  ITEM_COUNT,
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
import { Hud, type StockRow } from '../ui/Hud';
import { CameraRig } from './CameraRig';
import { GhostView } from './GhostView';
import { ItemView } from './ItemView';
import { WorldView } from './WorldView';

const BACKGROUND = 0x11161b;
/** Below this zoom the grid is denser than the pixels available to draw it. */
const GRID_MAX_VIEW_SIZE = 70;
/** How often the inventory panel and hover text are refreshed, in milliseconds. */
const HUD_REFRESH_MS = 250;
/** How often the frame-rate readout is recomputed, in milliseconds. */
const PERF_REFRESH_MS = 500;
const SIM_DT = 1 / SIM_TPS;

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly world: World;
  private readonly sim: Simulation;
  private readonly worldView: WorldView;
  private readonly itemView: ItemView;
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
  /** Belts laid by the current drag, by tile, so a belt can be turned toward the next one. */
  private strokeBelts = new Map<number, number>();

  private lastFrame = performance.now();
  private disposed = false;

  /** Unspent real time, in seconds, waiting to become simulation ticks. */
  private accumulator = 0;
  /** World revision the meshes were last built from. */
  private viewRevision = -1;

  private readonly debug: boolean;
  private lastHudRefresh = 0;
  private perfSince = performance.now();
  private perfFrames = 0;
  private perfSimMs = 0;
  private perfSimSteps = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(BACKGROUND);
    // No fog: an orthographic camera sits a fixed CAMERA_DISTANCE from its target,
    // so any fog range expressed in map units swallows the whole scene. A distance
    // fade, if wanted later, has to be written relative to CAMERA_DISTANCE.
    this.addLights();

    // ?bench builds the M1 benchmark scene: a blank map crowded with looping belts.
    // ?debug shows frame and tick timings without changing the map.
    const params = new URLSearchParams(window.location.search);
    const bench = params.has('bench');
    this.debug = bench || params.has('debug');

    this.world = bench ? createBenchWorld(MAP_SIZE) : generateWorld(MAP_SIZE, DEFAULT_SEED, DEF_MAP);
    placeHub(this.world);
    this.sim = new Simulation(this.world);
    if (bench) {
      buildRings(this.world, 5000);
      fillBelts(this.sim, 2);
    }

    this.worldView = new WorldView(this.scene, this.world);
    this.itemView = new ItemView(this.scene, this.sim);
    this.ghost = new GhostView(this.scene);

    this.rig.lookAtTile(MAP_SIZE / 2, MAP_SIZE / 2);

    this.hud = new Hud(BUILDABLE_DEFS, {
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
          this.rig.orbit(dx, dy);
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

    if (this.debug) this.exposeDebugHook();

    this.hud.setHint(
      bench
        ? '벤치마크 장면 — 순환 벨트 위를 아이템이 돌고 있습니다.'
        : '채굴기를 광석 위에 놓고 컨베이어를 시브까지 드래그해 이으세요. R 방향, 우클릭 철거, Q/E 시점.',
    );
    this.refreshStock();
    this.refreshHud();

    this.renderer.setAnimationLoop(this.frame);
  }

  /**
   * `?debug` only. Lets a script advance the factory and read its state without
   * waiting for animation frames, which a hidden or backgrounded tab never
   * delivers. Not part of the game; it exists so integration behaviour can be
   * checked when nothing is watching the canvas.
   */
  private exposeDebugHook(): void {
    const hook = {
      /** Runs `seconds` of simulation, then refreshes what the player would see. */
      advance: (seconds: number): void => {
        const ticks = Math.round(seconds * SIM_TPS);
        for (let i = 0; i < ticks; i++) this.sim.step();
        if (this.world.revision !== this.viewRevision) {
          this.worldView.refreshBuildings();
          this.viewRevision = this.world.revision;
        }
        this.itemView.update(0);
        this.refreshStock();
        this.refreshHud();
      },
      /** Belts with their direction, as `[x, y, dir]`. */
      belts: (): [number, number, number][] => {
        const out: [number, number, number][] = [];
        for (const b of this.world.buildings()) {
          if (b.defId === 'conveyor') out.push([b.x, b.y, b.rot]);
        }
        return out;
      },
      delivered: (item: number): number => this.sim.sieve.delivered[item]!,
      itemsOnBelts: (): number => this.sim.belts.totalItems(),
      itemsDrawn: (): number => this.itemView.drawn,
      /** Instanced layers in the scene: what each is, how many it draws, and its bounds. */
      layers: (): { type: string; count: number; vertices: number; y: number }[] =>
        this.scene.children
          .filter((c) => c.type === 'Mesh' || (c as { isInstancedMesh?: boolean }).isInstancedMesh)
          .map((c) => {
            const mesh = c as unknown as {
              type: string;
              count?: number;
              geometry: { attributes: { position: { count: number } } };
              position: { y: number };
            };
            return {
              type: c.type,
              count: mesh.count ?? 1,
              vertices: mesh.geometry.attributes.position.count,
              y: mesh.position.y,
            };
          }),
    };
    (window as unknown as { __factorization: typeof hook }).__factorization = hook;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.onResize);
    this.adapter.destroy();
    this.hud.destroy();
    this.itemView.dispose();
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
      // Scaled by zoom so a key press crosses the same fraction of the screen
      // whether the view is close or far. W is "forward", which is up the screen,
      // and the adapter reports up as -y.
      const step = KEYBOARD_PAN_TILES_PER_SEC * delta * (this.rig.zoom / DEFAULT_VIEW_SIZE);
      this.rig.panGround(pan.x * step, -pan.y * step);
    }

    const yaw = this.adapter.keyboardYaw();
    if (yaw !== 0) {
      this.rig.rotateYaw(yaw * YAW_SPEED * delta);
      this.refreshHud();
    }

    this.advanceSimulation(delta);

    // Rebuild the building meshes once per frame if anything changed, rather than
    // on every tile of a drag.
    if (this.world.revision !== this.viewRevision) {
      this.worldView.refreshBuildings();
      this.viewRevision = this.world.revision;
    }
    this.itemView.update(this.accumulator / SIM_DT);

    this.worldView.setGridVisible(this.toolActive() && this.rig.zoom <= GRID_MAX_VIEW_SIZE);
    this.renderer.render(this.scene, this.rig.camera);

    this.updateReadouts(now);
  };

  /**
   * Fixed-timestep loop: real time piles up in the accumulator and is spent in whole
   * ticks, so the factory runs at the same speed on a 30 Hz and a 144 Hz display.
   * The leftover fraction becomes the interpolation factor for drawing.
   */
  private advanceSimulation(delta: number): void {
    this.accumulator += delta;

    const start = performance.now();
    let steps = 0;
    while (this.accumulator >= SIM_DT && steps < MAX_SIM_STEPS_PER_FRAME) {
      this.sim.step();
      this.accumulator -= SIM_DT;
      steps++;
    }
    // Still behind after the cap: the machine cannot keep up. Drop the backlog and
    // run slow rather than spend every later frame trying to catch up.
    if (this.accumulator >= SIM_DT) this.accumulator = 0;

    this.perfSimMs += performance.now() - start;
    this.perfSimSteps += steps;
  }

  private updateReadouts(now: number): void {
    this.perfFrames++;

    if (now - this.lastHudRefresh >= HUD_REFRESH_MS) {
      this.lastHudRefresh = now;
      this.refreshStock();
      // Hover text shows live values (a miner's buffer, say), so it needs re-reading
      // even when the cursor has not moved.
      this.refreshHud();
    }

    const elapsed = now - this.perfSince;
    if (elapsed >= PERF_REFRESH_MS) {
      if (this.debug) {
        const fps = (this.perfFrames * 1000) / elapsed;
        const tickMs = this.perfSimSteps > 0 ? this.perfSimMs / this.perfSimSteps : 0;
        this.hud.setPerf(
          `FPS ${fps.toFixed(0)} · 틱 ${tickMs.toFixed(2)}ms · ` +
            `벨트 ${this.sim.belts.orderedTiles().length} · 아이템 ${this.itemView.drawn}`,
        );
      }
      this.perfSince = now;
      this.perfFrames = 0;
      this.perfSimMs = 0;
      this.perfSimSteps = 0;
    }
  }

  private refreshStock(): void {
    const rows: StockRow[] = [];
    for (let item = 1; item < ITEM_COUNT; item++) {
      const info = ORE_INFO[item as Exclude<Ore, 0>];
      if (!info || this.sim.sieve.delivered[item] === 0) continue;
      rows.push({
        name: info.name,
        prime: info.prime,
        color: info.color,
        stock: this.sim.sieve.stock[item]!,
        perMinute: this.sim.sieve.perMinute(item),
      });
    }
    this.hud.setStock(rows);
  }

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
    // The hub is placed by the game, so there is nothing to pick up.
    if (DEF_MAP.get(building.defId)?.buildable === false) return;
    this.selectedDefId = building.defId;
    this.eraseMode = false;
    this.rotation = building.rot;
    this.refreshGhost();
    this.refreshHud();
  }

  private inspect(tile: Vec2): void {
    this.setHover(tile);
    this.hud.setHint(this.describeTile(tile));
  }

  // ---------------------------------------------------------------- strokes

  private startStroke(screen: Vec2, erasing: boolean): void {
    this.stroke = [];
    this.strokeTiles.clear();
    this.strokeBelts.clear();
    const tile = this.tileAt(screen);
    this.lastStrokeTile = tile;
    if (erasing) this.applyErase(tile);
    else this.applyPlace(tile);
  }

  /** Fills the tiles between pointer samples so a fast drag lays an unbroken run. */
  private extendStroke(screen: Vec2, erasing: boolean): void {
    const tile = this.tileAt(screen);
    this.setHover(tile);

    const from = this.lastStrokeTile;
    if (!from) {
      if (erasing) this.applyErase(tile);
      else this.applyPlace(tile);
    } else if (erasing) {
      for (const step of tileLine(from.x, from.y, tile.x, tile.y)) this.applyErase(step);
    } else if (this.beltToolActive()) {
      this.extendBelts(from, tile);
    } else {
      for (const step of tileLine(from.x, from.y, tile.x, tile.y)) this.applyPlace(step);
    }
    this.lastStrokeTile = tile;
  }

  /**
   * Lays belts along a drag so that each one faces the next.
   *
   * Belts can only hand items to an edge-adjacent tile, so the path is 4-connected
   * (a diagonal step would leave a gap items cannot cross). Each new belt takes the
   * direction of travel, and the belt before it is turned to face it - which is
   * what makes a drag that bends produce a working corner without any extra input.
   */
  private extendBelts(from: Vec2, to: Vec2): void {
    const path = walkGrid(from.x, from.y, to.x, to.y);
    for (let i = 1; i < path.length; i++) {
      const before = path[i - 1]!;
      const here = path[i]!;
      const dir = dirFromStep(here.x - before.x, here.y - before.y);
      if (dir === -1) continue;

      if (this.placeBelt(here, dir as Rotation)) {
        this.turnBelt(before, dir as Rotation);
        // Carry the heading forward so the next click continues the same way.
        this.rotation = dir as Rotation;
      }
    }
  }

  private placeBelt(tile: Vec2, dir: Rotation): boolean {
    const key = this.tileKey(tile.x, tile.y);
    if (this.strokeTiles.has(key)) return false;
    this.strokeTiles.add(key);

    if (!this.world.checkPlacement('conveyor', tile.x, tile.y, dir).ok) return false;

    const command = new PlaceCommand('conveyor', tile.x, tile.y, dir);
    command.redo(this.world);
    this.strokeBelts.set(key, this.stroke.length);
    this.stroke.push(command);
    return true;
  }

  /** Re-lays a belt from this stroke facing a new way. Belts from earlier strokes are left alone. */
  private turnBelt(tile: Vec2, dir: Rotation): void {
    const index = this.strokeBelts.get(this.tileKey(tile.x, tile.y));
    if (index === undefined) return;

    const old = this.stroke[index] as PlaceCommand;
    if (old.building?.rot === dir) return;

    old.undo(this.world);
    const turned = new PlaceCommand('conveyor', tile.x, tile.y, dir);
    turned.redo(this.world);
    this.stroke[index] = turned;
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
    this.strokeBelts.clear();
    this.lastStrokeTile = null;
    this.refreshGhost();
    this.refreshHud();
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
    if (def.kind === 'belt') this.strokeBelts.set(key, this.stroke.length);
    this.stroke.push(command);
  }

  private applyErase(tile: Vec2): void {
    const key = this.tileKey(tile.x, tile.y);
    if (this.strokeTiles.has(key)) return;
    this.strokeTiles.add(key);

    const building = this.world.buildingAt(tile.x, tile.y);
    if (!building) return;
    // The hub cannot be removed: without it nothing has anywhere to go.
    if (DEF_MAP.get(building.defId)?.removable === false) return;

    const command = new RemoveCommand(building);
    command.redo(this.world);
    this.stroke.push(command);
  }

  private beltToolActive(): boolean {
    if (this.eraseMode || !this.selectedDefId) return false;
    return DEF_MAP.get(this.selectedDefId)?.kind === 'belt';
  }

  private undo(): void {
    if (!this.history.undo(this.world)) return;
    this.refreshGhost();
    this.refreshHud();
  }

  private redo(): void {
    if (!this.history.redo(this.world)) return;
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
      const def = building ? DEF_MAP.get(building.defId) : undefined;
      // Nothing to show over the hub: hovering it must not promise a removal that
      // will not happen.
      if (def?.removable === false) {
        this.ghost.hide();
        return;
      }
      const target = building ? this.footprintOf(building) : { x: hover.x, y: hover.y, w: 1, h: 1 };
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
    this.ghost.showBuilding(
      origin.x,
      origin.y,
      w,
      h,
      def.height,
      def.color,
      valid,
      def.kind === 'belt' ? this.rotation : null,
    );
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

    const building = this.world.buildingAt(tile.x, tile.y);
    if (building) return this.describeBuilding(building);

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

  /** Live status for a building. This is the diagnostic surface for GDD pillar 3. */
  private describeBuilding(building: PlacedBuilding): string {
    const def = DEF_MAP.get(building.defId);
    if (!def) return '알 수 없는 건물';

    if (def.kind === 'miner') {
      const info = this.sim.miners.info(building.id);
      // Not derived until the simulation's first tick after placement.
      if (!info) return def.name;
      const ore = ORE_INFO[info.item as Exclude<Ore, 0>];
      const summary = `${ore.name} ${def.name} · ${info.rate.toFixed(3)}/s (광석 ${info.oreTiles}/${def.w * def.h}칸)`;
      if (info.outputs.length === 0) return `${summary} — ⛔ 연결된 컨베이어 없음`;
      if (info.stored >= MINER_BUFFER) return `${summary} — ⛔ 출력 막힘`;
      return `${summary} — ▶ 작동`;
    }
    if (def.kind === 'hub') return '시브 — 컨베이어로 납품한 자원이 재고가 됩니다';
    if (def.kind === 'belt') return `${def.name} · 6개/초`;
    return `${def.name} · ${def.w}×${def.h}`;
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
