/**
 * Mouse and keyboard input, translated into semantic actions.
 *
 * Emits SCREEN-space coordinates only. Turning those into world or tile space
 * needs the camera, which belongs to the renderer — keeping that out means this
 * file has no three.js dependency and survives a renderer swap (GDD 14.1). That
 * boundary already paid for itself once, when the renderer changed from Phaser.
 *
 * Touch support was removed when the project committed to desktop-only. The
 * gesture layer stays because it is what keeps the raw event handling in one place.
 */

import type { Vec2 } from '../core/grid';

export interface InputHandlers {
  /** Drag the view across the ground by a screen-space delta. */
  onPan(dx: number, dy: number): void;
  /** Turn the camera around its focus point by a screen-space drag. */
  onOrbit(dx: number, dy: number): void;
  /** Multiply the zoom, keeping `focus` (screen space) over the same ground point. */
  onZoom(factor: number, focus: Vec2): void;
  /** Cursor moved with no button held; null when it leaves the surface. */
  onHover(screen: Vec2 | null): void;
  onPrimaryStart(screen: Vec2): void;
  onPrimaryDrag(screen: Vec2): void;
  /** `cancelled` is true when the stroke was abandoned — roll it back. */
  onPrimaryEnd(cancelled: boolean): void;
  onSecondaryStart(screen: Vec2): void;
  onSecondaryDrag(screen: Vec2): void;
  onSecondaryEnd(cancelled: boolean): void;
  /** Left click that never dragged, with no tool held: inspect. */
  onTap(screen: Vec2): void;
  /** Middle click that never dragged: eyedropper. */
  onPick(screen: Vec2): void;
  /** Rotate the building being placed. */
  onRotate(): void;
  onUndo(): void;
  onRedo(): void;
  /** Show or hide the factorisation view. */
  onToggleFactor(): void;
  /** Escape: clear the current selection. */
  onCancel(): void;
}

export interface InputAdapterOptions {
  element: HTMLElement;
  handlers: InputHandlers;
  /** Whether a build or erase tool is selected. Decides what the left button does. */
  isToolActive(): boolean;
}

/** What a press that never turned into a drag should do on release. */
type TapAction = 'none' | 'inspect' | 'pick';

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; id: number; start: Vec2; last: Vec2; moved: boolean; tap: TapAction }
  | { kind: 'orbit'; id: number; last: Vec2; tap: TapAction; moved: boolean }
  | { kind: 'primary'; id: number }
  | { kind: 'secondary'; id: number };

/** Movement past this many pixels turns a click into a drag. */
const TAP_SLOP = 6;

const PAN_KEYS: Readonly<Record<string, Vec2>> = {
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

/** Held, not tapped: 3D allows a smooth turn rather than 90-degree jumps. */
const YAW_KEYS: Readonly<Record<string, number>> = {
  KeyQ: -1,
  KeyE: 1,
};

export class InputAdapter {
  private readonly element: HTMLElement;
  private readonly handlers: InputHandlers;
  private readonly isToolActive: () => boolean;

  private readonly heldKeys = new Set<string>();
  private gesture: Gesture = { kind: 'none' };
  private pointerDown = false;
  private lastHover: Vec2 | null = null;

  constructor(options: InputAdapterOptions) {
    this.element = options.element;
    this.handlers = options.handlers;
    this.isToolActive = options.isToolActive;
    this.attach();
  }

  get hoverPoint(): Vec2 | null {
    return this.lastHover;
  }

  /** Normalised keyboard pan direction, polled each frame. */
  keyboardPan(): Vec2 {
    let x = 0;
    let y = 0;
    for (const code of this.heldKeys) {
      const dir = PAN_KEYS[code];
      if (dir) {
        x += dir.x;
        y += dir.y;
      }
    }
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const length = Math.hypot(x, y);
    return { x: x / length, y: y / length };
  }

  /** -1, 0 or 1: which way the view is being turned this frame. */
  keyboardYaw(): number {
    let yaw = 0;
    for (const code of this.heldKeys) yaw += YAW_KEYS[code] ?? 0;
    return Math.sign(yaw);
  }

  destroy(): void {
    const el = this.element;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private attach(): void {
    const el = this.element;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerDown) return;
    const point = this.localPoint(e);
    this.element.setPointerCapture?.(e.pointerId);
    this.pointerDown = true;

    switch (e.button) {
      case 2:
        this.gesture = { kind: 'secondary', id: e.pointerId };
        this.handlers.onSecondaryStart(point);
        return;
      case 1:
        // Middle drag turns the camera; middle click picks, as block games bind it.
        this.gesture = { kind: 'orbit', id: e.pointerId, last: point, tap: 'pick', moved: false };
        return;
      case 0:
        if (this.isToolActive()) {
          this.gesture = { kind: 'primary', id: e.pointerId };
          this.handlers.onPrimaryStart(point);
        } else {
          this.gesture = {
            kind: 'pan',
            id: e.pointerId,
            start: point,
            last: point,
            moved: false,
            tap: 'inspect',
          };
        }
        return;
      default:
        this.pointerDown = false;
        this.gesture = { kind: 'none' };
        return;
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const point = this.localPoint(e);
    this.lastHover = point;

    const g = this.gesture;
    if (g.kind === 'none') {
      this.handlers.onHover(point);
      return;
    }
    if (e.pointerId !== g.id) return;

    switch (g.kind) {
      case 'pan':
        this.handlers.onPan(point.x - g.last.x, point.y - g.last.y);
        g.last = point;
        if (!g.moved && distance(point, g.start) > TAP_SLOP) {
          g.moved = true;
          g.tap = 'none';
        }
        return;
      case 'orbit':
        this.handlers.onOrbit(point.x - g.last.x, point.y - g.last.y);
        if (!g.moved && distance(point, g.last) > 0) g.moved = true;
        g.last = point;
        if (g.moved) g.tap = 'none';
        return;
      case 'primary':
        this.handlers.onPrimaryDrag(point);
        return;
      case 'secondary':
        this.handlers.onSecondaryDrag(point);
        return;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const point = this.localPoint(e);
    const g = this.gesture;
    if (g.kind === 'none' || e.pointerId !== g.id) return;

    this.element.releasePointerCapture?.(e.pointerId);
    this.pointerDown = false;
    this.gesture = { kind: 'none' };

    switch (g.kind) {
      case 'pan':
      case 'orbit':
        if (g.tap === 'inspect') this.handlers.onTap(point);
        else if (g.tap === 'pick') this.handlers.onPick(point);
        return;
      case 'primary':
        this.handlers.onPrimaryEnd(false);
        return;
      case 'secondary':
        this.handlers.onSecondaryEnd(false);
        return;
    }
  };

  private onPointerLeave = (): void => {
    if (this.pointerDown) return;
    this.lastHover = null;
    this.handlers.onHover(null);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode: 0 pixels, 1 lines, 2 pages. Normalise so trackpads and wheels match.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = clamp(Math.exp(-e.deltaY * unit * 0.0015), 0.2, 5);
    this.handlers.onZoom(factor, this.localPoint(e));
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target)) return;

    if (PAN_KEYS[e.code] || YAW_KEYS[e.code]) {
      this.heldKeys.add(e.code);
      e.preventDefault();
      return;
    }
    if (e.repeat) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.handlers.onRedo();
      else this.handlers.onUndo();
      return;
    }
    if (ctrl && e.code === 'KeyY') {
      e.preventDefault();
      this.handlers.onRedo();
      return;
    }
    if (ctrl) return;

    switch (e.code) {
      case 'KeyR':
        e.preventDefault();
        this.handlers.onRotate();
        return;
      case 'KeyT':
        e.preventDefault();
        this.handlers.onToggleFactor();
        return;
      case 'Escape':
        e.preventDefault();
        this.handlers.onCancel();
        return;
      default:
        return;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  private onBlur = (): void => {
    // Without this, a key held while the window loses focus pans or spins forever.
    this.heldKeys.clear();
    if (this.gesture.kind === 'primary') this.handlers.onPrimaryEnd(true);
    else if (this.gesture.kind === 'secondary') this.handlers.onSecondaryEnd(true);
    this.gesture = { kind: 'none' };
    this.pointerDown = false;
  };

  private localPoint(e: { clientX: number; clientY: number }): Vec2 {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
