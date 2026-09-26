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
  GENERATOR_FUEL_BUFFER,
  KEYBOARD_PAN_TILES_PER_SEC,
  MACHINE_INPUT_MULTIPLE,
  MAP_SIZE,
  MINER_BUFFER,
  SIM_AWAY_CATCHUP_SECONDS,
  SIM_AWAY_THRESHOLD_SECONDS,
  SIM_BUDGET_FOREGROUND_MS,
  SIM_BUDGET_HIDDEN_MS,
  SIM_CATCHUP_NOTICE_SECONDS,
  SIM_LIVE_BACKLOG_SECONDS,
  SIM_TPS,
  TUNNEL_RANGE,
  YAW_SPEED,
  YAW_STEP,
} from '../config';
import { SimClock } from '../core/clock';
import { dirFromStep } from '../core/dir';
import { footprintOrigin, worldToTile, type Vec2 } from '../core/grid';
import { tileLine, walkGrid } from '../core/line';
import { BUILDABLE_DEFS, DEF_MAP, displayName } from '../data/buildings';
import { STARTING_STOCK } from '../data/economy';
import { ITEM_DEFS, ITEM_MAP, Item, itemName } from '../data/items';
import { RECIPE_BOOK, ingredientsText } from '../data/recipes';
import { newPrimesOf } from '../data/seals';
import { formatSignature, PRIMES } from '../factor/signature';
import {
  CompositeCommand,
  History,
  PlaceCommand,
  RemoveCommand,
  SetRecipeCommand,
  type Command,
} from '../input/commands';
import { Builder } from '../sim/builder';
import { POWER_FULL } from '../sim/power';
import { InputAdapter } from '../input/InputAdapter';
import { buildRings, createBenchWorld, fillBelts } from '../sim/bench';
import { Simulation, placeHub } from '../sim/simulation';
import type { MachineClass } from '../factor/recipeBook';
import type { MachineStatus } from '../sim/machines';
import {
  ORE_INFO,
  Ore,
  PLACEMENT_MESSAGE,
  isBeltKind,
  Terrain,
  rotatedSize,
  type BuildingDef,
  type PlacedBuilding,
  type Rotation,
  type SealDef,
} from '../sim/types';
import type { World } from '../sim/world';
import { generateWorld } from '../sim/worldgen';
import { Heartbeat } from '../runtime/heartbeat';
import { FactorPanel } from '../ui/FactorPanel';
import { Hud, type InspectorLive, type RecipeChoice, type StockRow } from '../ui/Hud';
import { SealPanel } from '../ui/SealPanel';
import { CameraRig } from './CameraRig';
import { GhostView } from './GhostView';
import { ItemView } from './ItemView';
import { MachineStatusView } from './MachineStatusView';
import { fitRenderer } from './viewport';
import { WorldView } from './WorldView';

const BACKGROUND = 0x11161b;
/** Below this zoom the grid is denser than the pixels available to draw it. */
const GRID_MAX_VIEW_SIZE = 70;
/** How often the inventory panel and hover text are refreshed, in milliseconds. */
const HUD_REFRESH_MS = 250;
/** How often the frame-rate readout is recomputed, in milliseconds. */
const PERF_REFRESH_MS = 500;
const SIM_DT = 1 / SIM_TPS;

const MACHINE_STATUS_TEXT: Readonly<Record<MachineStatus, string>> = {
  'no-recipe': '레시피 없음',
  working: '▶ 작동',
  waiting: '⏸ 재료 대기',
  blocked: '⛔ 출력 막힘',
  'no-power': '⚡ 전력 없음',
};

export class Game {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly world: World;
  private readonly sim: Simulation;
  /** Every change the player makes goes through this, so stock and buildings stay in step. */
  private readonly builder: Builder;
  private readonly worldView: WorldView;
  private readonly itemView: ItemView;
  private readonly machineStatus: MachineStatusView;
  private readonly factorPanel: FactorPanel;
  private readonly sealPanel: SealPanel;
  private readonly ghost: GhostView;
  private readonly adapter: InputAdapter;
  private readonly hud: Hud;
  private readonly history = new History();

  private selectedDefId: string | null = null;
  private eraseMode = false;
  private rotation: Rotation = 0;
  /** Tile under the cursor: what erase, inspect and the HUD talk about. */
  private hoverTile: Vec2 | null = null;
  /** Exact ground point under the cursor. Placement is centred on this, not on the tile. */
  private hoverPoint: Vec2 | null = null;
  /** Where the current preview footprint starts, to skip redraws that would change nothing. */
  private hoverOrigin: Vec2 | null = null;

  private stroke: Command[] = [];
  private strokeTiles = new Set<number>();
  private lastStrokeTile: Vec2 | null = null;
  /** Belts laid by the current drag, by tile, so a belt can be turned toward the next one. */
  private strokeBelts = new Map<number, number>();

  private lastFrame = performance.now();
  private disposed = false;

  /**
   * Decides how many ticks are owed from the real clock, so the factory runs at the
   * same speed however often (or rarely) anything calls in.
   */
  private readonly clock = new SimClock({
    tickSeconds: SIM_DT,
    liveCapSeconds: SIM_LIVE_BACKLOG_SECONDS,
    awayCapSeconds: SIM_AWAY_CATCHUP_SECONDS,
    awayThresholdSeconds: SIM_AWAY_THRESHOLD_SECONDS,
  });
  /**
   * Keeps the simulation running while the page is hidden. Animation frames stop for
   * a hidden tab and timers on the page slow to once a second or worse; a worker's
   * timer does neither.
   */
  private readonly heartbeat = new Heartbeat(1000 / SIM_TPS, () => this.pump(performance.now()));
  /** World revision the meshes were last built from. */
  private viewRevision = -1;

  /** The machine whose panel is open, if any. */
  private selectedMachineId: number | null = null;
  /** What each kind of machine was last set to, so a new one starts with the same recipe. */
  private readonly lastRecipe = new Map<MachineClass, number>();

  private readonly debug: boolean;
  private lastHudRefresh = 0;
  private perfSince = performance.now();
  private perfFrames = 0;
  private perfSimMs = 0;
  private perfSimSteps = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
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
    this.builder = new Builder(this.world, this.sim.sieve, this.sim.progress);
    if (!bench) {
      for (const { item, count } of STARTING_STOCK) this.sim.sieve.addStock(item, count);
    }
    if (bench) {
      buildRings(this.world, 5000);
      fillBelts(this.sim, 2);
    }

    this.worldView = new WorldView(this.scene, this.world);
    this.itemView = new ItemView(this.scene, this.sim);
    this.machineStatus = new MachineStatusView(this.scene, this.sim);
    this.factorPanel = new FactorPanel(document.getElementById('hud-factor')!, Item.GateComponent);
    this.sealPanel = new SealPanel(document.getElementById('hud-seal')!);
    this.ghost = new GhostView(this.scene);
    this.sim.progress.onComplete = (seal) => this.announceSeal(seal);

    this.rig.lookAtTile(MAP_SIZE / 2, MAP_SIZE / 2);

    this.hud = new Hud(BUILDABLE_DEFS, {
      onSelectBuilding: (id) => this.selectBuilding(id),
      onSelectErase: () => this.toggleErase(),
      onToggleFactor: () => this.factorPanel.toggle(),
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
        onHover: (screen) => this.setHover(screen ? this.groundPointAt(screen) : null),
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
        onToggleFactor: () => this.factorPanel.toggle(),
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

    this.clock.advance(performance.now());
    this.heartbeat.start();
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
        this.machineStatus.update();
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
      /** Simulation ticks run so far. Advances 30 per second when the game is running. */
      tick: (): number => this.sim.tick,
      /** Builds through the same path as the mouse, so costs apply. Returns the id, or -1. */
      place: (defId: string, x: number, y: number, rot = 0): number =>
        this.builder.place(defId, x, y, rot as Rotation)?.id ?? -1,
      setRecipe: (id: number, item: number): void => this.world.setRecipe(id, item),
      stock: (item: number): number => this.sim.sieve.stock[item]!,
      /** Adds to the hub's stock without counting as delivered, like the starting supplies. */
      give: (item: number, count: number): void => this.sim.sieve.addStock(item, count),
      /** Delivers to the hub as a belt would, counting toward seals. Unlike `give`. */
      deliver: (item: number, count: number): void => {
        for (let i = 0; i < count; i++) this.sim.sieve.receive(item);
      },
      /** Seal progress: level, whether it is finished, and the active seal's level. */
      seals: (): { level: number; finished: boolean; active: number | null } => ({
        level: this.sim.progress.level,
        finished: this.sim.progress.finished,
        active: this.sim.progress.active?.level ?? null,
      }),
      /** Hands a generator one fuel item, as a belt would. Returns whether it was taken. */
      fuel: (id: number, item: number): boolean => this.sim.power.accept(id, item),
      /** Power totals across every grid. */
      power: () => this.sim.power.summary(),
      /** What hovering a building would say. */
      describe: (id: number): string => {
        const b = this.world.buildingById(id);
        return b ? this.describeBuilding(b) : '';
      },
      machineStatus: (id: number): string | null => this.sim.machines.info(id)?.status ?? null,
      /** Opens the panel as a click on the machine would. */
      selectMachine: (id: number): void => this.selectMachine(id),
      panelText: (which: 'inspector' | 'factor'): string =>
        document.getElementById(`hud-${which}`)?.innerText.replace(/\n+/g, ' | ') ?? '',
      lights: (): number => this.machineStatus.count,
      /** Whether the background timer is a worker (survives a hidden tab) or the fallback. */
      heartbeatUsesWorker: (): boolean => this.heartbeat.usesWorker,
      /** Real time still owed to the simulation, in seconds. */
      owedSeconds: (): number => this.clock.owedSeconds,
      /** The placement preview: its centre and footprint in world units, or null. */
      ghost: () => this.ghost.describe(),
      /** Exact ground point under a screen position, as the game itself computes it. */
      groundAt: (x: number, y: number): { x: number; z: number } | null => {
        const p = this.groundPointAt({ x, y });
        return p.x < 0 ? null : { x: p.x, z: p.y };
      },
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
    this.heartbeat.stop();
    window.removeEventListener('resize', this.onResize);
    this.adapter.destroy();
    this.hud.destroy();
    this.itemView.dispose();
    this.machineStatus.dispose();
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

    this.pump(now);

    // Rebuild the building meshes once per frame if anything changed, rather than
    // on every tile of a drag.
    if (this.world.revision !== this.viewRevision) {
      this.worldView.refreshBuildings();
      this.viewRevision = this.world.revision;
    }
    this.itemView.update(this.clock.alpha);
    this.machineStatus.update();

    this.worldView.setGridVisible(this.toolActive() && this.rig.zoom <= GRID_MAX_VIEW_SIZE);
    this.renderer.render(this.scene, this.rig.camera);

    this.updateReadouts(now);
  };

  /**
   * Runs however many ticks the real clock says are owed.
   *
   * Called from two places: every animation frame while the game is on screen, and
   * from the worker heartbeat all the time, which is what keeps the factory running
   * behind other windows. Either can arrive first; both just read the clock, so
   * whichever does the work, the same ticks run exactly once.
   *
   * The time spent is capped by a budget. On screen that keeps simulating from
   * starving the next frame; anything left over stays owed. Hidden, nothing is being
   * drawn, so a larger budget lets a backlog (a throttled or frozen tab coming back)
   * be worked off quickly without freezing the page.
   */
  private pump(now: number): void {
    this.clock.advance(now);

    const budget = document.hidden ? SIM_BUDGET_HIDDEN_MS : SIM_BUDGET_FOREGROUND_MS;
    const start = performance.now();
    let steps = 0;
    while (this.clock.hasTick()) {
      this.sim.step();
      this.clock.consume();
      steps++;
      if (performance.now() - start >= budget) break;
    }

    this.perfSimMs += performance.now() - start;
    this.perfSimSteps += steps;
  }

  private updateReadouts(now: number): void {
    this.perfFrames++;

    if (now - this.lastHudRefresh >= HUD_REFRESH_MS) {
      this.lastHudRefresh = now;
      this.refreshStock();
      this.refreshInspector();
      // Hover text shows live values (a miner's buffer, say), so it needs re-reading
      // even when the cursor has not moved.
      this.refreshHud();
    }

    const elapsed = now - this.perfSince;
    if (elapsed >= PERF_REFRESH_MS) {
      const owed = this.clock.owedSeconds;
      if (owed >= SIM_CATCHUP_NOTICE_SECONDS) {
        // Shown to everyone, not just in debug: this is the game telling the player
        // why the factory is briefly running fast after they come back.
        this.hud.setPerf(`⏩ 자리를 비운 시간을 따라잡는 중 · ${Math.ceil(owed)}초 남음`);
      } else if (this.debug) {
        const fps = (this.perfFrames * 1000) / elapsed;
        const tickMs = this.perfSimSteps > 0 ? this.perfSimMs / this.perfSimSteps : 0;
        this.hud.setPerf(
          `FPS ${fps.toFixed(0)} · 틱 ${tickMs.toFixed(2)}ms · ` +
            `벨트 ${this.sim.belts.orderedTiles().length} · 아이템 ${this.itemView.drawn}`,
        );
      } else {
        this.hud.setPerf('');
      }
      this.perfSince = now;
      this.perfFrames = 0;
      this.perfSimMs = 0;
      this.perfSimSteps = 0;
    }
  }

  private refreshStock(): void {
    const sieve = this.sim.sieve;
    const rows: StockRow[] = [];
    for (const def of ITEM_DEFS) {
      // Anything the player holds or has ever delivered. Held alone counts: the
      // starting plates are usable long before the first delivery.
      if (sieve.stock[def.id] === 0 && sieve.delivered[def.id] === 0) continue;
      rows.push({
        name: def.name,
        signature: formatSignature(RECIPE_BOOK.signature(def.id)),
        color: def.color,
        stock: sieve.stock[def.id]!,
        perMinute: sieve.perMinute(def.id),
      });
    }
    this.hud.setStock(rows);
    this.hud.setAffordable(new Set(BUILDABLE_DEFS.filter((d) => this.builder.canAfford(d.id)).map((d) => d.id)));
    this.hud.setUnlocked(new Set(BUILDABLE_DEFS.filter((d) => this.builder.buildingUnlocked(d.id)).map((d) => d.id)));
    this.sealPanel.update(this.sim.progress);
  }

  /**
   * The onboarding beat from GDD 11.3: a completed seal gets a one-line hint naming
   * what it unlocked, plus a new-prime callout the first time a seal's requirements
   * touch a raw material nothing has asked for yet.
   */
  private announceSeal(seal: SealDef): void {
    const primes = newPrimesOf(seal.level).map((i) => PRIMES[i]);
    const unlocked = [
      ...seal.unlocks.buildings.map((id) => DEF_MAP.get(id)).filter((d): d is BuildingDef => !!d).map(displayName),
      ...seal.unlocks.recipes.map((item) => itemName(item)),
    ];
    const primeText = primes.length > 0 ? `새로운 소수: ${primes.join(', ')} · ` : '';
    const unlockText = unlocked.length > 0 ? `해금: ${unlocked.join(', ')}` : '';
    this.hud.setHint(`🔓 봉인 ${seal.level} 달성 — ${primeText}${unlockText}`.trimEnd());
  }

  private onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    fitRenderer(this.renderer, width, height, window.devicePixelRatio);
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
    this.deselectMachine();
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
    this.setHover({ x: tile.x + 0.5, y: tile.y + 0.5 });

    // A machine opens its panel, where the recipe is chosen.
    const building = this.world.inBounds(tile.x, tile.y) ? this.world.buildingAt(tile.x, tile.y) : null;
    const def = building ? DEF_MAP.get(building.defId) : undefined;
    if (building && def?.kind === 'machine' && def.machine) {
      this.selectMachine(building.id);
      this.hud.setHint(this.describeTile(tile));
      return;
    }
    this.deselectMachine();

    // Clicking bare ore with no tool held mines it by hand (GDD 6.3). This is what
    // keeps a player who has spent their stone from being stuck: stone is used
    // directly to build smelters.
    if (
      this.world.inBounds(tile.x, tile.y) &&
      !this.world.buildingAt(tile.x, tile.y) &&
      this.world.oreAt(tile.x, tile.y) !== Ore.None
    ) {
      const ore = this.world.oreAt(tile.x, tile.y);
      this.sim.sieve.addStock(ore, 1);
      this.hud.setHint(`${itemName(ore)} +1 (직접 채굴)`);
      this.refreshStock();
      return;
    }
    this.hud.setHint(this.describeTile(tile));
  }

  // ---------------------------------------------------------------- machine panel

  private selectMachine(id: number): void {
    const building = this.world.buildingById(id);
    const def = building ? DEF_MAP.get(building.defId) : undefined;
    if (!building || !def?.machine) return;

    const spec = def.machine;
    this.selectedMachineId = id;

    // Locked recipes are left off rather than shown disabled: the build bar can afford
    // to tease what is coming because a locked building still says why when placed, but
    // a machine already on the map has no such fallback surface for a recipe click.
    const recipes: RecipeChoice[] = RECIPE_BOOK.recipesFor(spec.class, spec.tier)
      .filter((r) => this.builder.recipeUnlocked(r.output))
      .map((r) => ({
        item: r.output,
        name: itemName(r.output),
        color: ITEM_MAP.get(r.output)?.color ?? 0xffffff,
        signature: formatSignature(RECIPE_BOOK.signature(r.output)),
        ingredients: ingredientsText(r, itemName),
        seconds: r.seconds,
      }));

    this.hud.openInspector({
      title: displayName(def),
      recipes,
      onPick: (item) => this.pickRecipe(id, item),
    });
    this.refreshInspector();
  }

  private deselectMachine(): void {
    if (this.selectedMachineId === null) return;
    this.selectedMachineId = null;
    this.hud.closeInspector();
  }

  /** Sets what a machine makes, as an undoable step. Picking the current recipe again clears it. */
  private pickRecipe(id: number, item: number): void {
    const previous = this.world.recipeOf(id);
    if (previous === item) return;
    // Refused for a recipe no seal has unlocked; the panel only ever offers unlocked
    // ones, so this is a backstop, not something the player can normally hit.
    if (!this.history.execute(new SetRecipeCommand(id, item, previous), this.builder)) return;

    const spec = DEF_MAP.get(this.world.buildingById(id)?.defId ?? '')?.machine;
    if (item !== 0 && spec) this.lastRecipe.set(spec.class, item);

    this.refreshInspector();
    this.refreshHud();
  }

  /** Brings the open machine panel up to date, or closes it if its machine is gone. */
  private refreshInspector(): void {
    const id = this.selectedMachineId;
    if (id === null) return;

    const building = this.world.buildingById(id);
    if (!building || this.world.buildingAt(building.x, building.y)?.id !== id) {
      this.deselectMachine();
      return;
    }

    // The recipe is read from the world so a pick shows at once; the counters come
    // from the simulation, which catches up on its next tick. Until then they still
    // describe the old recipe, so they are left out rather than shown wrong.
    const recipeItem = this.world.recipeOf(id);
    const info = this.sim.machines.info(id);
    const current = info && (info.recipe?.output ?? 0) === recipeItem ? info : null;

    let statusKind: InspectorLive['statusKind'] = 'idle';
    let statusText = recipeItem === 0 ? '레시피를 고르세요' : '적용 중…';
    if (current) {
      statusText = MACHINE_STATUS_TEXT[current.status];
      const power = this.powerNote(id);
      if (current.status === 'no-power') {
        statusKind = 'blocked';
        statusText = power;
      } else if (power) {
        statusText = `${statusText} · ${power}`;
      }
      if (current.status === 'working') statusKind = 'working';
      else if (current.status === 'waiting') statusKind = 'waiting';
      else if (current.status === 'blocked') {
        statusKind = 'blocked';
        if (current.ports.length === 0) statusText = '⛔ 연결된 출력 벨트 없음';
      }
    }

    const buffers = current?.recipe
      ? current.recipe.inputs.map((input) => ({
          name: itemName(input.item),
          have: current.inputs[input.item]!,
          cap: input.count * MACHINE_INPUT_MULTIPLE,
        }))
      : [];

    this.hud.updateInspector({
      statusText,
      statusKind,
      recipe: recipeItem,
      buffers,
      progress: current && current.crafting ? current.progress / current.totalTicks : 0,
      output: current?.output ?? 0,
    });
  }

  // ---------------------------------------------------------------- strokes

  private startStroke(screen: Vec2, erasing: boolean): void {
    this.stroke = [];
    this.strokeTiles.clear();
    this.strokeBelts.clear();
    const point = this.groundPointAt(screen);
    const tile = worldToTile(point.x, point.y);
    this.lastStrokeTile = tile;
    if (erasing) this.applyErase(tile);
    else this.applyPlace(tile, point);
  }

  /** Fills the tiles between pointer samples so a fast drag lays an unbroken run. */
  private extendStroke(screen: Vec2, erasing: boolean): void {
    const point = this.groundPointAt(screen);
    const tile = worldToTile(point.x, point.y);
    this.setHover(point);

    const from = this.lastStrokeTile;
    if (!from) {
      if (erasing) this.applyErase(tile);
      else this.applyPlace(tile, point);
    } else if (erasing) {
      for (const step of tileLine(from.x, from.y, tile.x, tile.y)) this.applyErase(step);
    } else if (this.beltToolActive()) {
      this.extendBelts(from, tile);
    } else {
      // Tiles the pointer skipped over have no exact point of their own; the last
      // one is where the cursor actually is, so it gets the real position.
      const steps = tileLine(from.x, from.y, tile.x, tile.y);
      steps.forEach((step, i) => this.applyPlace(step, i === steps.length - 1 ? point : undefined));
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

    if (!this.builder.checkPlacement('conveyor', tile.x, tile.y, dir).ok) return false;

    const command = new PlaceCommand('conveyor', tile.x, tile.y, dir);
    if (!command.redo(this.builder)) return false;
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

    old.undo(this.builder);
    const turned = new PlaceCommand('conveyor', tile.x, tile.y, dir);
    turned.redo(this.builder);
    this.stroke[index] = turned;
  }

  private endStroke(cancelled: boolean): void {
    if (cancelled) {
      for (let i = this.stroke.length - 1; i >= 0; i--) this.stroke[i]!.undo(this.builder);
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

  /**
   * `point` is the exact ground position when there is one. Without it the tile's
   * centre stands in, which for a footprint of one tile is identical and for larger
   * ones lands where the old tile-based rule did.
   */
  private applyPlace(tile: Vec2, point?: Vec2): void {
    const defId = this.selectedDefId;
    if (!defId) return;
    const def = DEF_MAP.get(defId);
    if (!def) return;

    const origin = this.originFor(def, point ?? { x: tile.x + 0.5, y: tile.y + 0.5 });
    const key = this.tileKey(origin.x, origin.y);
    if (this.strokeTiles.has(key)) return;
    this.strokeTiles.add(key);

    if (!this.builder.checkPlacement(defId, origin.x, origin.y, this.rotation).ok) return;

    const command = new PlaceCommand(defId, origin.x, origin.y, this.rotation);
    if (!command.redo(this.builder)) return;
    if (def.kind === 'belt') this.strokeBelts.set(key, this.stroke.length);
    this.stroke.push(command);

    // A new machine starts on whatever that kind was last set to, so laying down a
    // row of smelters does not mean setting each one by hand. It is part of the same
    // undo step as the placement.
    if (def.kind === 'machine' && def.machine && command.building) {
      const last = this.lastRecipe.get(def.machine.class);
      const recipe = last ? RECIPE_BOOK.recipe(last) : undefined;
      if (last && recipe && recipe.tier <= def.machine.tier) {
        const set = new SetRecipeCommand(command.building.id, last, 0);
        set.redo(this.builder);
        this.stroke.push(set);
      }
    }
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
    if (!command.redo(this.builder)) return;
    this.stroke.push(command);
  }

  private beltToolActive(): boolean {
    if (this.eraseMode || !this.selectedDefId) return false;
    return DEF_MAP.get(this.selectedDefId)?.kind === 'belt';
  }

  private undo(): void {
    const result = this.history.undo(this.builder);
    if (result === 'blocked') this.hud.setHint('재고가 부족해 되돌릴 수 없습니다.');
    if (result !== 'done') return;
    this.refreshGhost();
    this.refreshHud();
  }

  private redo(): void {
    const result = this.history.redo(this.builder);
    if (result === 'blocked') this.hud.setHint('재고가 부족해 다시 실행할 수 없습니다.');
    if (result !== 'done') return;
    this.refreshGhost();
    this.refreshHud();
  }

  // ---------------------------------------------------------------- view

  private setHover(point: Vec2 | null): void {
    let tile = point ? worldToTile(point.x, point.y) : null;
    if (tile && !this.world.inBounds(tile.x, tile.y)) {
      tile = null;
      point = null;
    }
    this.hoverPoint = point;

    // A mouse move that changes neither the tile nor where the footprint would
    // start changes nothing on screen; skip the redraw and the DOM writes.
    const def = this.selectedDefId ? DEF_MAP.get(this.selectedDefId) : undefined;
    const origin = point && def ? this.originFor(def, point) : null;
    const sameTile =
      tile && this.hoverTile
        ? tile.x === this.hoverTile.x && tile.y === this.hoverTile.y
        : tile === this.hoverTile;
    const sameOrigin =
      origin && this.hoverOrigin
        ? origin.x === this.hoverOrigin.x && origin.y === this.hoverOrigin.y
        : origin === this.hoverOrigin;
    if (sameTile && sameOrigin) return;

    this.hoverTile = tile;
    this.refreshGhost();
    this.refreshHud();
  }

  private refreshGhost(): void {
    // Recorded here, where the preview is actually drawn, rather than only when the
    // mouse moves. Rotating or switching tools redraws it without a mouse move, and
    // a stale record would make the next move look like "nothing changed".
    this.hoverOrigin = null;

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

    const origin = this.originFor(def, this.hoverPoint ?? { x: hover.x + 0.5, y: hover.y + 0.5 });
    this.hoverOrigin = origin;
    const { w, h } = rotatedSize(def, this.rotation);
    const valid = this.builder.checkPlacement(defId, origin.x, origin.y, this.rotation).ok;
    this.ghost.showBuilding(
      origin.x,
      origin.y,
      w,
      h,
      def.height,
      def.color,
      valid,
      isBeltKind(def.kind) ? this.rotation : null,
    );
  }

  /**
   * Footprint start for a building whose centre should sit under `point`.
   *
   * Works from the exact ground point, not the tile it is in, so an even-sized
   * building settles on the tile corner nearest the cursor instead of using the
   * cursor's tile as its corner, which left it half a tile off in both axes.
   */
  private originFor(def: BuildingDef, point: Vec2): Vec2 {
    const { w, h } = rotatedSize(def, this.rotation);
    return footprintOrigin(point.x, point.y, w, h);
  }

  private footprintOf(building: PlacedBuilding): { x: number; y: number; w: number; h: number } {
    const def = DEF_MAP.get(building.defId);
    if (!def) return { x: building.x, y: building.y, w: 1, h: 1 };
    const { w, h } = rotatedSize(def, building.rot);
    return { x: building.x, y: building.y, w, h };
  }

  /**
   * Screen point -> exact ground position, by raycasting the ground plane.
   * `y` holds world Z, matching how tile coordinates are named everywhere else.
   */
  private groundPointAt(screen: Vec2): Vec2 {
    const ground = this.rig.groundAt(screen);
    if (!ground) return { x: -1, y: -1 };
    return { x: ground.x, y: ground.z };
  }

  /** Screen point -> the tile under it. */
  private tileAt(screen: Vec2): Vec2 {
    const point = this.groundPointAt(screen);
    return worldToTile(point.x, point.y);
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
      const rate = (info.rate * info.level) / POWER_FULL;
      const summary = `${ore.name} ${displayName(def)} · ${rate.toFixed(3)}/s (광석 ${info.oreTiles}/${def.w * def.h}칸)`;
      const power = this.powerNote(building.id);
      if (info.level === 0) return `${summary} — ${power}`;
      if (power) return `${summary} — ${power}`;
      if (info.outputs.length === 0) return `${summary} — ⛔ 연결된 컨베이어 없음`;
      if (info.stored >= MINER_BUFFER) return `${summary} — ⛔ 출력 막힘`;
      return `${summary} — ▶ 작동`;
    }
    if (def.kind === 'machine' && def.machine) {
      const info = this.sim.machines.info(building.id);
      const label = displayName(def);
      if (!info?.recipe) return `${label} — 레시피 없음 (클릭해서 고르기)`;
      const power = this.powerNote(building.id);
      const status = info.status === 'no-power' ? power : MACHINE_STATUS_TEXT[info.status];
      return `${label} · ${itemName(info.recipe.output)} — ${status}${power && info.status !== 'no-power' ? ` · ${power}` : ''}`;
    }
    if (def.kind === 'generator' && def.generator) {
      const gen = this.sim.power.generator(building.id);
      const head = `${def.name} · +${def.generator.output} PU (${itemName(def.generator.fuel)} ${def.generator.burnSeconds}초에 1개)`;
      if (!gen) return head;
      // Only "not wired" matters here: a grid that is short of power is the generator's
      // doing, not its problem.
      if (this.sim.power.infoOf(building.id)?.connected === false) {
        return `${head} — ⚡ 전력망에 연결되지 않음 (기둥 범위 밖)`;
      }
      if (gen.burning) return `${head} — 🔥 발전 중 (연료 ${gen.stored}/${GENERATOR_FUEL_BUFFER})`;
      return `${head} — ⛔ 연료(${itemName(def.generator.fuel)}) 없음`;
    }
    if (def.kind === 'pole' && def.pole) {
      const grid = this.sim.power.gridOfPole(building.id);
      const head = `${def.name} · 범위 ${def.pole.range}칸`;
      if (!grid) return head;
      return `${head} — 전력망: 공급 ${grid.supply} / 수요 ${grid.demand} PU (${Math.round(grid.level / 10)}%)`;
    }
    if (def.kind === 'hub') return '시브 — 컨베이어로 납품한 자원이 재고가 됩니다';
    if (def.kind === 'splitter') return `${def.name} — 세 방향으로 번갈아 내보냅니다`;
    if (def.kind === 'tunnel-in') return `${def.name} — 앞쪽 ${TUNNEL_RANGE}칸 안의 출구로 이어집니다`;
    if (def.kind === 'tunnel-out') return `${def.name} — 뒤쪽 입구와 이어집니다`;
    if (def.kind === 'belt') return `${def.name} · 6개/초`;
    return `${def.name} · ${def.w}×${def.h}`;
  }

  /**
   * Why a power-drawing building is not getting all it asks for, or an empty string if
   * it is (or needs none). Machines, miners and generators all read this the same way.
   */
  private powerNote(id: number): string {
    const power = this.sim.power.infoOf(id);
    if (!power) return '';
    if (!power.connected) return '⚡ 전력망에 연결되지 않음 (기둥 범위 밖)';
    if (power.level === 0) return '⚡ 전력 없음 (발전량 0)';
    if (power.level < POWER_FULL) return `⚡ 전력 부족 ${Math.round(power.level / 10)}%`;
    return '';
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
    const origin = this.originFor(def, this.hoverPoint ?? { x: tile.x + 0.5, y: tile.y + 0.5 });
    const result = this.builder.checkPlacement(defId, origin.x, origin.y, this.rotation);
    if (result.ok) return null;
    if (result.reason === 'cannot-afford') {
      const missing = this.builder.shortfall(defId);
      if (missing) return `재고 부족 — ${itemName(missing.item)} ${missing.need} 필요 (보유 ${missing.have})`;
    }
    return PLACEMENT_MESSAGE[result.reason];
  }
}
