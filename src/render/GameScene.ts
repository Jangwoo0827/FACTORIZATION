/**
 * M0 playable shell: isometric ground, camera, tile picking, ghost placement.
 *
 * Rendering is deliberately procedural (GDD 13.1) — no art assets yet. Ground is a
 * single polygon, special tiles are culled Images, and buildings/ghost are drawn
 * into Graphics objects that only rebuild when something changes.
 */

import Phaser from 'phaser';
import {
  DEFAULT_SEED,
  DEFAULT_ZOOM,
  GRID_HALO_RADIUS,
  KEYBOARD_PAN_TILES_PER_SEC,
  MAP_SIZE,
  TILE_H,
  TILE_W,
} from '../config';
import { tileToWorld, worldToTile, type Vec2 } from '../core/iso';
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
import { CameraController } from './CameraController';

const GROUND_COLOR = 0x272d26;
const GRID_COLOR = 0x5d6f7a;
const TERRAIN_COLOR: Readonly<Record<Terrain, number>> = {
  [Terrain.Plain]: GROUND_COLOR,
  [Terrain.Water]: 0x1f3d52,
  [Terrain.Rock]: 0x4a4a4a,
};

const DEPTH = {
  ground: 0,
  tiles: 1,
  grid: 2,
  buildings: 10,
  ghost: 20,
} as const;

export class GameScene extends Phaser.Scene {
  private world!: World;
  private view!: CameraController;
  private adapter!: InputAdapter;
  private hud!: Hud;
  private readonly history = new History();

  private gridGfx!: Phaser.GameObjects.Graphics;
  private buildingGfx!: Phaser.GameObjects.Graphics;
  private ghostGfx!: Phaser.GameObjects.Graphics;

  private selectedDefId: string | null = null;
  private eraseMode = false;
  private rotation: Rotation = 0;
  private hoverTile: Vec2 | null = null;

  /** Commands applied during the current drag, promoted to one history entry on release. */
  private stroke: Command[] = [];
  /** Tiles already visited this stroke, so a wobbling finger does not retry them. */
  private strokeTiles = new Set<number>();
  /** Previous drag sample, used to fill in the tiles the pointer skipped over. */
  private lastStrokeTile: Vec2 | null = null;

  private buildingsDirty = true;
  private gridDirty = true;

  constructor() {
    super('game');
  }

  create(): void {
    this.world = generateWorld(MAP_SIZE, DEFAULT_SEED, DEF_MAP);

    this.createTileTextures();
    this.drawGround();
    this.createTileSprites();

    this.gridGfx = this.add.graphics().setDepth(DEPTH.grid);
    this.buildingGfx = this.add.graphics().setDepth(DEPTH.buildings);
    this.ghostGfx = this.add.graphics().setDepth(DEPTH.ghost);

    this.view = new CameraController(this.cameras.main);
    this.setupCamera();

    this.hud = new Hud(BUILDING_DEFS, {
      onSelectBuilding: (id) => this.selectBuilding(id),
      onSelectErase: () => this.toggleErase(),
      onRotate: () => this.rotate(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
    });

    this.adapter = new InputAdapter({
      element: this.game.canvas,
      isToolActive: () => this.toolActive(),
      handlers: {
        onPan: (dx, dy) => this.view.panScreen(dx, dy),
        onZoom: (factor, focus) => this.view.zoomAt(factor, focus),
        onHover: (screen) => this.setHover(screen ? this.tileAt(screen) : null),
        onPrimaryStart: (screen) => this.beginStroke(screen),
        onPrimaryDrag: (screen) => this.continueStroke(screen),
        onPrimaryEnd: (cancelled) => this.endStroke(cancelled),
        onSecondaryStart: (screen) => this.beginErase(screen),
        onSecondaryDrag: (screen) => this.continueErase(screen),
        onSecondaryEnd: (cancelled) => this.endStroke(cancelled),
        onTap: (screen) => this.inspect(this.tileAt(screen)),
        onLongPress: (screen) => this.eyedropper(this.tileAt(screen)),
        onRotate: () => this.rotate(),
        onUndo: () => this.undo(),
        onRedo: () => this.redo(),
        onCancel: () => this.clearTool(),
      },
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.adapter.destroy();
      this.hud.destroy();
    });

    this.hud.setHint(
      this.adapter.pointerType === 'touch'
        ? '건물을 고르고 화면을 드래그해 지으세요. 두 손가락으로 이동/확대.'
        : '건물을 고르고 드래그해 지으세요. 우클릭 철거, 휠 확대, R 회전.',
    );
    this.refreshHud();
  }

  override update(_time: number, delta: number): void {
    const pan = this.adapter.keyboardPan();
    if (pan.x !== 0 || pan.y !== 0) {
      const speed = (KEYBOARD_PAN_TILES_PER_SEC * TILE_W * (delta / 1000)) / this.view.zoom;
      this.view.panWorld(pan.x * speed, pan.y * speed);
    }

    if (this.buildingsDirty) {
      this.redrawBuildings();
      this.buildingsDirty = false;
    }
    if (this.gridDirty) {
      this.redrawGrid();
      this.redrawGhost();
      this.gridDirty = false;
    }
  }

  // ---------------------------------------------------------------- setup

  private setupCamera(): void {
    const camera = this.cameras.main;
    const n = this.world.size;
    const halfW = (n * TILE_W) / 2;
    const height = n * TILE_H;
    const margin = 400;

    camera.setBounds(-halfW - margin, -TILE_H - margin, halfW * 2 + margin * 2, height + margin * 2);
    camera.setZoom(DEFAULT_ZOOM);

    const centre = tileToWorld(n / 2, n / 2);
    camera.centerOn(centre.x, centre.y);
  }

  /** One 64x32 diamond texture per ground type, baked once at boot. */
  private createTileTextures(): void {
    for (const [ore, info] of Object.entries(ORE_INFO)) {
      // Ore in the ground is muted toward the terrain; the saturated colour is
      // reserved for items and machines so those stay the eye-catching layer
      // (GDD 13.1).
      this.bakeDiamond(`tile-ore-${ore}`, mix(GROUND_COLOR, info.color, 0.55), 0x1a1d18);
    }
    this.bakeDiamond(`tile-terrain-${Terrain.Water}`, TERRAIN_COLOR[Terrain.Water], 0x0d2436);
    this.bakeDiamond(`tile-terrain-${Terrain.Rock}`, TERRAIN_COLOR[Terrain.Rock], 0x2b2b2b);
  }

  private bakeDiamond(key: string, fill: number, stroke: number): void {
    const g = this.add.graphics();
    // Inset by half a pixel so the stroke is not clipped by the texture bounds.
    const w = TILE_W - 1;
    const h = TILE_H - 1;
    g.fillStyle(fill, 1);
    g.lineStyle(1, stroke, 0.35);
    g.beginPath();
    g.moveTo(w / 2 + 0.5, 0.5);
    g.lineTo(w + 0.5, h / 2 + 0.5);
    g.lineTo(w / 2 + 0.5, h + 0.5);
    g.lineTo(0.5, h / 2 + 0.5);
    g.closePath();
    g.fillPath();
    g.strokePath();
    g.generateTexture(key, TILE_W, TILE_H);
    g.destroy();
  }

  /**
   * The buildable plain is flat and uniform, so it is one polygon rather than
   * 16,384 tiles — the single biggest win for zoomed-out performance.
   */
  private drawGround(): void {
    const n = this.world.size;
    const top = tileToWorld(-0.5, -0.5);
    const right = tileToWorld(n - 0.5, -0.5);
    const bottom = tileToWorld(n - 0.5, n - 0.5);
    const left = tileToWorld(-0.5, n - 0.5);

    const g = this.add.graphics().setDepth(DEPTH.ground);
    g.fillStyle(GROUND_COLOR, 1);
    g.beginPath();
    g.moveTo(top.x, top.y);
    g.lineTo(right.x, right.y);
    g.lineTo(bottom.x, bottom.y);
    g.lineTo(left.x, left.y);
    g.closePath();
    g.fillPath();
  }

  /**
   * Only non-plain tiles get a sprite. They are sparse, and individual Images let
   * Phaser cull them per camera.
   *
   * M1 note: once belt items push the object count up, this should move to Phaser
   * 4's SpriteGPULayer.
   */
  private createTileSprites(): void {
    const n = this.world.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const terrain = this.world.terrainAt(x, y);
        const ore = this.world.oreAt(x, y);
        let key: string | null = null;
        if (terrain !== Terrain.Plain) key = `tile-terrain-${terrain}`;
        else if (ore !== Ore.None) key = `tile-ore-${ore}`;
        if (!key) continue;

        const pos = tileToWorld(x, y);
        this.add.image(pos.x, pos.y, key).setDepth(DEPTH.tiles);
      }
    }
  }

  // ---------------------------------------------------------------- tools

  private toolActive(): boolean {
    return this.eraseMode || this.selectedDefId !== null;
  }

  private selectBuilding(defId: string | null): void {
    this.selectedDefId = defId;
    this.eraseMode = false;
    this.gridDirty = true;
    this.refreshHud();
  }

  private toggleErase(): void {
    this.eraseMode = !this.eraseMode;
    if (this.eraseMode) this.selectedDefId = null;
    this.gridDirty = true;
    this.refreshHud();
  }

  private clearTool(): void {
    this.selectedDefId = null;
    this.eraseMode = false;
    this.gridDirty = true;
    this.refreshHud();
  }

  private rotate(): void {
    this.rotation = ((this.rotation + 1) % 4) as Rotation;
    this.gridDirty = true;
    this.refreshHud();
  }

  private eyedropper(tile: Vec2): void {
    const building = this.world.buildingAt(tile.x, tile.y);
    if (!building) return;
    this.selectedDefId = building.defId;
    this.eraseMode = false;
    this.rotation = building.rot;
    this.gridDirty = true;
    this.refreshHud();
  }

  private inspect(tile: Vec2): void {
    this.setHover(tile);
    const building = this.world.buildingAt(tile.x, tile.y);
    const def = building ? DEF_MAP.get(building.defId) : undefined;
    this.hud.setHint(def ? `${def.name} · ${def.w}x${def.h}` : this.describeTile(tile));
  }

  // ---------------------------------------------------------------- strokes

  private beginStroke(screen: Vec2): void {
    this.startStroke(screen, this.eraseMode);
  }

  private continueStroke(screen: Vec2): void {
    this.extendStroke(screen, this.eraseMode);
  }

  private beginErase(screen: Vec2): void {
    this.startStroke(screen, true);
  }

  private continueErase(screen: Vec2): void {
    this.extendStroke(screen, true);
  }

  private startStroke(screen: Vec2, erasing: boolean): void {
    this.stroke = [];
    this.strokeTiles.clear();
    const tile = this.tileAt(screen);
    this.lastStrokeTile = tile;
    this.applyAt(tile, erasing);
  }

  /**
   * Walks every tile between the previous sample and this one, so a fast drag
   * still lays an unbroken run instead of dotting the sampled positions.
   */
  private extendStroke(screen: Vec2, erasing: boolean): void {
    const tile = this.tileAt(screen);
    this.setHover(tile);

    const from = this.lastStrokeTile;
    if (from) {
      for (const step of tileLine(from.x, from.y, tile.x, tile.y)) {
        this.applyAt(step, erasing);
      }
    } else {
      this.applyAt(tile, erasing);
    }
    this.lastStrokeTile = tile;
  }

  private applyAt(tile: Vec2, erasing: boolean): void {
    if (erasing) this.applyErase(tile);
    else this.applyPlace(tile);
  }

  private endStroke(cancelled: boolean): void {
    if (cancelled) {
      // A second finger arrived mid-drag: undo what the stroke applied so the
      // gesture reads as pan, not as an accidental row of buildings.
      for (let i = this.stroke.length - 1; i >= 0; i--) this.stroke[i]!.undo(this.world);
    } else if (this.stroke.length > 0) {
      this.history.record(
        this.stroke.length === 1 ? this.stroke[0]! : new CompositeCommand(this.stroke),
      );
    }
    this.stroke = [];
    this.strokeTiles.clear();
    this.lastStrokeTile = null;
    this.buildingsDirty = true;
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
    this.stroke.push(command);
    this.buildingsDirty = true;
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
    this.buildingsDirty = true;
  }

  private undo(): void {
    if (this.history.undo(this.world)) {
      this.buildingsDirty = true;
      this.gridDirty = true;
      this.refreshHud();
    }
  }

  private redo(): void {
    if (this.history.redo(this.world)) {
      this.buildingsDirty = true;
      this.gridDirty = true;
      this.refreshHud();
    }
  }

  // ---------------------------------------------------------------- drawing

  private setHover(tile: Vec2 | null): void {
    if (tile && !this.world.inBounds(tile.x, tile.y)) tile = null;
    if (tile && this.hoverTile && tile.x === this.hoverTile.x && tile.y === this.hoverTile.y) return;
    if (!tile && !this.hoverTile) return;
    this.hoverTile = tile;
    this.gridDirty = true;
    this.refreshHud();
  }

  /** Larger footprints centre on the pointer rather than hanging off it. */
  private originFor(def: BuildingDef, tile: Vec2): Vec2 {
    const { w, h } = rotatedSize(def, this.rotation);
    return {
      x: tile.x - Math.floor((w - 1) / 2),
      y: tile.y - Math.floor((h - 1) / 2),
    };
  }

  private redrawGrid(): void {
    this.gridGfx.clear();
    const hover = this.hoverTile;
    if (!hover || !this.toolActive()) return;

    // A halo, not a full-map grid: bounded cost and less visual noise.
    this.gridGfx.lineStyle(1, GRID_COLOR, 0.22);
    const r = GRID_HALO_RADIUS;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = hover.x + dx;
        const y = hover.y + dy;
        if (!this.world.inBounds(x, y)) continue;
        this.strokeDiamond(this.gridGfx, x, y, 1, 1);
      }
    }
  }

  private redrawGhost(): void {
    this.ghostGfx.clear();
    const hover = this.hoverTile;
    if (!hover) return;

    if (this.eraseMode) {
      const building = this.world.buildingAt(hover.x, hover.y);
      const target = building ? this.footprintOf(building) : { x: hover.x, y: hover.y, w: 1, h: 1 };
      this.ghostGfx.fillStyle(0xd94a4a, 0.35);
      this.fillDiamond(this.ghostGfx, target.x, target.y, target.w, target.h);
      return;
    }

    const defId = this.selectedDefId;
    if (!defId) return;
    const def = DEF_MAP.get(defId);
    if (!def) return;

    const origin = this.originFor(def, hover);
    const { w, h } = rotatedSize(def, this.rotation);
    const valid = this.world.checkPlacement(defId, origin.x, origin.y, this.rotation).ok;
    const tint = valid ? def.color : 0xd94a4a;

    this.drawIsoBox(this.ghostGfx, origin.x, origin.y, w, h, tint, def.lift, 0.55);
  }

  private redrawBuildings(): void {
    this.buildingGfx.clear();
    // Painter's algorithm on x + y (GDD 4.1).
    const sorted = [...this.world.buildings()].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const building of sorted) {
      const def = DEF_MAP.get(building.defId);
      if (!def) continue;
      const { w, h } = rotatedSize(def, building.rot);
      this.drawIsoBox(this.buildingGfx, building.x, building.y, w, h, def.color, def.lift, 1);
    }
  }

  private footprintOf(building: PlacedBuilding): { x: number; y: number; w: number; h: number } {
    const def = DEF_MAP.get(building.defId);
    if (!def) return { x: building.x, y: building.y, w: 1, h: 1 };
    const { w, h } = rotatedSize(def, building.rot);
    return { x: building.x, y: building.y, w, h };
  }

  /**
   * A footprint as a flat diamond plus a lifted top face and two side faces —
   * enough to read as a solid object without any art.
   */
  private drawIsoBox(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    lift: number,
    alpha: number,
  ): void {
    const top = tileToWorld(x - 0.5, y - 0.5);
    const right = tileToWorld(x + w - 0.5, y - 0.5);
    const bottom = tileToWorld(x + w - 0.5, y + h - 0.5);
    const left = tileToWorld(x - 0.5, y + h - 0.5);

    // Left face.
    g.fillStyle(shade(color, 0.55), alpha);
    g.beginPath();
    g.moveTo(left.x, left.y);
    g.lineTo(bottom.x, bottom.y);
    g.lineTo(bottom.x, bottom.y - lift);
    g.lineTo(left.x, left.y - lift);
    g.closePath();
    g.fillPath();

    // Right face.
    g.fillStyle(shade(color, 0.75), alpha);
    g.beginPath();
    g.moveTo(bottom.x, bottom.y);
    g.lineTo(right.x, right.y);
    g.lineTo(right.x, right.y - lift);
    g.lineTo(bottom.x, bottom.y - lift);
    g.closePath();
    g.fillPath();

    // Top face.
    g.fillStyle(color, alpha);
    g.lineStyle(1, shade(color, 1.35), alpha);
    g.beginPath();
    g.moveTo(top.x, top.y - lift);
    g.lineTo(right.x, right.y - lift);
    g.lineTo(bottom.x, bottom.y - lift);
    g.lineTo(left.x, left.y - lift);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  private strokeDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    this.tracePath(g, x, y, w, h);
    g.strokePath();
  }

  private fillDiamond(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    this.tracePath(g, x, y, w, h);
    g.fillPath();
  }

  private tracePath(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const top = tileToWorld(x - 0.5, y - 0.5);
    const right = tileToWorld(x + w - 0.5, y - 0.5);
    const bottom = tileToWorld(x + w - 0.5, y + h - 0.5);
    const left = tileToWorld(x - 0.5, y + h - 0.5);
    g.beginPath();
    g.moveTo(top.x, top.y);
    g.lineTo(right.x, right.y);
    g.lineTo(bottom.x, bottom.y);
    g.lineTo(left.x, left.y);
    g.closePath();
  }

  // ---------------------------------------------------------------- helpers

  private tileAt(screen: Vec2): Vec2 {
    const world = this.view.screenToWorld(screen);
    return worldToTile(world.x, world.y);
  }

  private tileKey(x: number, y: number): number {
    return y * this.world.size + x;
  }

  private describeTile(tile: Vec2): string {
    if (!this.world.inBounds(tile.x, tile.y)) return '맵 밖';
    const ore = this.world.oreAt(tile.x, tile.y);
    if (ore !== Ore.None) {
      const info = ORE_INFO[ore as Exclude<Ore, 0>];
      // The prime is the theme's hook (GDD 5.1) — surface it everywhere ore appears.
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
      buildings: this.world.buildingCount,
      zoom: this.view ? this.view.zoom : 1,
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

/** Linear blend between two packed RGB colours. */
function mix(a: number, b: number, t: number): number {
  const lerp = (shift: number): number =>
    Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
  return (lerp(16) << 16) | (lerp(8) << 8) | lerp(0);
}

/** Multiplies a packed RGB colour's channels, for cheap face shading. */
function shade(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
