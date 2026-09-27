/**
 * The power overlay (GDD 8, 11.1): which grid everything is on, and what is not on one.
 *
 * Each grid gets its own colour. Its poles' reach is a tinted square on the ground,
 * its wires are lines, and a building that needs power but that no pole reaches gets
 * a red outline — the one thing the player most needs to find. Lines ignore depth so
 * a wire is never hidden behind the machine it feeds.
 *
 * Shown while the player holds anything to do with power (a pole, a generator, a Mk2
 * machine) and whenever P is toggled on. The geometry only changes when the map does.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Scene,
} from 'three';
import type { PowerSystem } from '../sim/power';
import type { World } from '../sim/world';

/** Grid colours, cycled. Chosen apart from the machine status-light colours. */
export const GRID_COLOURS = [0x4fc3f7, 0xba68c8, 0xffb74d, 0x81c784, 0xf06292, 0xfff176] as const;
const STRANDED_COLOUR = 0xff3b30;
const PREVIEW_COLOUR = 0xffffff;

const LINE_Y = 0.06;
/** Wires hang above the ground so they read as wires rather than markings. */
const WIRE_Y = 1.2;

/** One line segment in world units, with its colour. `y` is tile Z. */
export interface Segment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly h: number;
  readonly colour: number;
}

export function gridColour(grid: number): number {
  return grid < 0 ? STRANDED_COLOUR : GRID_COLOURS[grid % GRID_COLOURS.length]!;
}

/** The four sides of a rectangle of tiles as segments. */
function rect(x0: number, y0: number, x1: number, y1: number, h: number, colour: number): Segment[] {
  return [
    { ax: x0, ay: y0, bx: x1, by: y0, h, colour },
    { ax: x1, ay: y0, bx: x1, by: y1, h, colour },
    { ax: x1, ay: y1, bx: x0, by: y1, h, colour },
    { ax: x0, ay: y1, bx: x0, by: y0, h, colour },
  ];
}

/**
 * Everything the overlay draws, as plain segments. Pure, so the rules (which colour,
 * which outline) are testable without a renderer.
 *
 * A pole at tile (x, y) with range r reaches tiles x-r .. x+r, so its outline runs
 * from x-r to x+r+1 in world units.
 */
export function overlaySegments(power: PowerSystem, world: World): Segment[] {
  const out: Segment[] = [];
  for (const p of power.poles) {
    const x0 = Math.max(0, p.x - p.range);
    const y0 = Math.max(0, p.y - p.range);
    const x1 = Math.min(world.size, p.x + p.range + 1);
    const y1 = Math.min(world.size, p.y + p.range + 1);
    out.push(...rect(x0, y0, x1, y1, LINE_Y, gridColour(p.grid)));
  }
  for (const w of power.wires) {
    out.push({ ax: w.ax, ay: w.ay, bx: w.bx, by: w.by, h: WIRE_Y, colour: gridColour(w.grid) });
  }
  for (const s of power.stranded) {
    // Slightly outside the footprint, so it is not lost inside the box's own edges.
    out.push(...rect(s.x - 0.1, s.y - 0.1, s.x + s.w + 0.1, s.y + s.h + 0.1, LINE_Y, STRANDED_COLOUR));
  }
  return out;
}

export class PowerOverlayView {
  private readonly lines: LineSegments;
  private readonly preview: LineSegments;
  private revision = -1;
  private visible = false;

  constructor(
    scene: Scene,
    private readonly world: World,
    private readonly power: PowerSystem,
  ) {
    const material = new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    this.lines = new LineSegments(new BufferGeometry(), material);
    this.lines.renderOrder = 10;
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);

    this.preview = new LineSegments(new BufferGeometry(), material);
    this.preview.renderOrder = 10;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    scene.add(this.preview);
  }

  /** How many segments are drawn now; for the debug hook. */
  get segmentCount(): number {
    return this.lines.visible ? (this.lines.geometry.getAttribute('position')?.count ?? 0) / 2 : 0;
  }

  setVisible(visible: boolean): void {
    if (visible && !this.visible) this.revision = -1; // hidden updates were skipped
    this.visible = visible;
    this.lines.visible = visible;
    if (!visible) this.preview.visible = false;
  }

  /** Outlines the reach a pole would have if placed at (x, y), or clears it. */
  setPreview(x: number, y: number, range: number): void;
  setPreview(none: null): void;
  setPreview(x: number | null, y?: number, range?: number): void {
    if (x === null || y === undefined || range === undefined || !this.visible) {
      this.preview.visible = false;
      return;
    }
    const s = this.world.size;
    const segs = rect(
      Math.max(0, x - range),
      Math.max(0, y - range),
      Math.min(s, x + range + 1),
      Math.min(s, y + range + 1),
      LINE_Y,
      PREVIEW_COLOUR,
    );
    this.fill(this.preview.geometry, segs);
    this.preview.visible = true;
  }

  /** Rebuilds when the grids changed. Cheap to call every frame. */
  update(): void {
    // Follows the power system's own rebuilds, not the world's revision: the world
    // changes the instant something is placed, but the grids are only re-derived on the
    // simulation's next tick, and drawing in between would show the old wiring.
    if (!this.visible || this.power.rebuilds === this.revision) return;
    this.revision = this.power.rebuilds;
    this.fill(this.lines.geometry, overlaySegments(this.power, this.world));
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.preview.geometry.dispose();
    (this.lines.material as LineBasicMaterial).dispose();
    this.lines.removeFromParent();
    this.preview.removeFromParent();
  }

  private fill(geometry: BufferGeometry, segs: readonly Segment[]): void {
    const positions = new Float32Array(segs.length * 6);
    const colours = new Float32Array(segs.length * 6);
    const c = new Color();
    segs.forEach((seg, i) => {
      const o = i * 6;
      positions.set([seg.ax, seg.h, seg.ay, seg.bx, seg.h, seg.by], o);
      c.setHex(seg.colour);
      colours.set([c.r, c.g, c.b, c.r, c.g, c.b], o);
    });
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colours, 3));
    geometry.computeBoundingSphere();
  }
}
