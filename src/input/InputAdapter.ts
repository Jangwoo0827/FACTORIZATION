/**
 * Unified pointer input (GDD 12.1).
 *
 * Translates raw mouse / touch / pen events into a small set of semantic gestures
 * so the rest of the game never branches on input device. Built in M0 on purpose:
 * retrofitting touch onto a mouse-only codebase is the expensive path.
 *
 * The central rule that resolves the pan-vs-build conflict on a touchscreen:
 *
 *   tool held  -> one finger builds, two fingers pan/zoom
 *   no tool    -> one finger pans, a tap inspects, a long press picks
 *
 * Emits SCREEN-space coordinates only. Converting to world/tile space needs the
 * camera, which belongs to the renderer — keeping that out means this file has no
 * Phaser dependency and survives a renderer swap (GDD 14.1).
 */

import type { Vec2 } from '../core/iso';

export interface InputHandlers {
  /** Drag the view by a screen-space delta. */
  onPan(dx: number, dy: number): void;
  /** Multiply the zoom, keeping `focus` (screen space) pinned to the same world point. */
  onZoom(factor: number, focus: Vec2): void;
  /** Mouse cursor moved with no button held; null when it leaves the surface. */
  onHover(screen: Vec2 | null): void;
  onPrimaryStart(screen: Vec2): void;
  onPrimaryDrag(screen: Vec2): void;
  /** `cancelled` is true when a second finger interrupted the drag — roll the stroke back. */
  onPrimaryEnd(cancelled: boolean): void;
  onSecondaryStart(screen: Vec2): void;
  onSecondaryDrag(screen: Vec2): void;
  onSecondaryEnd(cancelled: boolean): void;
  /** Press and release without dragging, while no tool is held: inspect. */
  onTap(screen: Vec2): void;
  /** Touch long press: eyedropper. */
  onLongPress(screen: Vec2): void;
  onRotate(): void;
  onUndo(): void;
  onRedo(): void;
  /** Escape / right-click with no tool: clear the current selection. */
  onCancel(): void;
}

export interface InputAdapterOptions {
  element: HTMLElement;
  handlers: InputHandlers;
  /** Whether a build or erase tool is currently selected. Decides the touch gesture mapping. */
  isToolActive(): boolean;
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; id: number; start: Vec2; last: Vec2; moved: boolean; canTap: boolean }
  | { kind: 'primary'; id: number; start: Vec2 }
  | { kind: 'secondary'; id: number; start: Vec2 }
  | { kind: 'pinch'; idA: number; idB: number; lastDist: number; lastMid: Vec2 };

/** Movement past this many pixels turns a tap into a drag. */
const TAP_SLOP = 8;
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

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

export class InputAdapter {
  private readonly element: HTMLElement;
  private readonly handlers: InputHandlers;
  private readonly isToolActive: () => boolean;

  private readonly pointers = new Map<number, Vec2>();
  private readonly heldKeys = new Set<string>();
  private gesture: Gesture = { kind: 'none' };

  private longPressTimer: number | null = null;
  private longPressOrigin: Vec2 | null = null;

  private lastHover: Vec2 | null = null;
  /**
   * Last device that produced input, so the HUD can adapt its affordances.
   *
   * Seeded from the media query rather than defaulting to mouse: on a phone the
   * first frame is drawn before anything is touched, and guessing wrong there
   * means the opening hint tells the player about right-click and the scroll wheel.
   */
  private lastPointerType: 'mouse' | 'touch' = prefersCoarsePointer() ? 'touch' : 'mouse';

  constructor(options: InputAdapterOptions) {
    this.element = options.element;
    this.handlers = options.handlers;
    this.isToolActive = options.isToolActive;
    this.attach();
  }

  get pointerType(): 'mouse' | 'touch' {
    return this.lastPointerType;
  }

  get hoverPoint(): Vec2 | null {
    return this.lastHover;
  }

  /** Normalised keyboard pan direction, polled by the scene each frame. */
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
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
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
    this.clearLongPress();
  }

  private attach(): void {
    const el = this.element;
    // touch-action is also set in CSS; setting it here keeps the guarantee local
    // to the adapter, since without it the browser scrolls instead of panning.
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
    this.lastPointerType = e.pointerType === 'mouse' ? 'mouse' : 'touch';
    const point = this.localPoint(e);
    this.pointers.set(e.pointerId, point);
    this.element.setPointerCapture?.(e.pointerId);

    // Second finger: abandon whatever the first one was doing and pinch instead.
    if (this.pointers.size === 2 && this.lastPointerType === 'touch') {
      this.beginPinch();
      return;
    }
    if (this.pointers.size > 1) return;

    this.clearLongPress();

    if (this.lastPointerType === 'mouse') {
      this.beginMouseGesture(e, point);
    } else {
      this.beginTouchGesture(point);
    }
  };

  private beginMouseGesture(e: PointerEvent, point: Vec2): void {
    if (e.button === 2) {
      this.gesture = { kind: 'secondary', id: e.pointerId, start: point };
      this.handlers.onSecondaryStart(point);
      return;
    }
    if (e.button === 1) {
      this.gesture = { kind: 'pan', id: e.pointerId, start: point, last: point, moved: false, canTap: false };
      return;
    }
    if (e.button !== 0) return;

    if (this.isToolActive()) {
      this.gesture = { kind: 'primary', id: e.pointerId, start: point };
      this.handlers.onPrimaryStart(point);
    } else {
      this.gesture = { kind: 'pan', id: e.pointerId, start: point, last: point, moved: false, canTap: true };
    }
  }

  private beginTouchGesture(point: Vec2): void {
    const id = [...this.pointers.keys()][0]!;
    if (this.isToolActive()) {
      this.gesture = { kind: 'primary', id, start: point };
      this.handlers.onPrimaryStart(point);
      // No long press while a tool is held: it would fight with starting a drag.
      return;
    }
    this.gesture = { kind: 'pan', id, start: point, last: point, moved: false, canTap: true };
    this.startLongPress(point);
  }

  private beginPinch(): void {
    this.cancelActiveGesture();
    this.clearLongPress();
    const ids = [...this.pointers.keys()];
    const idA = ids[0]!;
    const idB = ids[1]!;
    const a = this.pointers.get(idA)!;
    const b = this.pointers.get(idB)!;
    this.gesture = {
      kind: 'pinch',
      idA,
      idB,
      lastDist: Math.hypot(a.x - b.x, a.y - b.y),
      lastMid: midpoint(a, b),
    };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const point = this.localPoint(e);
    const tracked = this.pointers.get(e.pointerId);

    if (!tracked) {
      // No button held: hover. Only mice produce this.
      if (e.pointerType === 'mouse') {
        this.lastHover = point;
        this.handlers.onHover(point);
      }
      return;
    }

    this.pointers.set(e.pointerId, point);
    this.lastHover = point;

    if (this.longPressOrigin && dist(point, this.longPressOrigin) > LONG_PRESS_SLOP) {
      this.clearLongPress();
    }

    const g = this.gesture;
    switch (g.kind) {
      case 'pinch': {
        if (e.pointerId !== g.idA && e.pointerId !== g.idB) return;
        const a = this.pointers.get(g.idA);
        const b = this.pointers.get(g.idB);
        if (!a || !b) return;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = midpoint(a, b);
        if (g.lastDist > 0 && distance > 0) {
          this.handlers.onZoom(distance / g.lastDist, mid);
        }
        this.handlers.onPan(mid.x - g.lastMid.x, mid.y - g.lastMid.y);
        g.lastDist = distance;
        g.lastMid = mid;
        return;
      }
      case 'pan': {
        if (e.pointerId !== g.id) return;
        this.handlers.onPan(point.x - g.last.x, point.y - g.last.y);
        g.last = point;
        if (!g.moved && dist(point, g.start) > TAP_SLOP) g.moved = true;
        return;
      }
      case 'primary': {
        if (e.pointerId !== g.id) return;
        this.handlers.onPrimaryDrag(point);
        return;
      }
      case 'secondary': {
        if (e.pointerId !== g.id) return;
        this.handlers.onSecondaryDrag(point);
        return;
      }
      case 'none':
        return;
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const point = this.localPoint(e);
    this.pointers.delete(e.pointerId);
    this.element.releasePointerCapture?.(e.pointerId);
    this.clearLongPress();

    const g = this.gesture;
    switch (g.kind) {
      case 'pinch':
        if (e.pointerId === g.idA || e.pointerId === g.idB) {
          // A finger remains down, but it must not silently become a pan —
          // gestures only start on pointerdown, so it stays inert until lifted.
          this.gesture = { kind: 'none' };
        }
        return;
      case 'pan':
        if (e.pointerId !== g.id) return;
        if (g.canTap && !g.moved) this.handlers.onTap(point);
        this.gesture = { kind: 'none' };
        return;
      case 'primary':
        if (e.pointerId !== g.id) return;
        this.handlers.onPrimaryEnd(false);
        this.gesture = { kind: 'none' };
        return;
      case 'secondary':
        if (e.pointerId !== g.id) return;
        this.handlers.onSecondaryEnd(false);
        this.gesture = { kind: 'none' };
        return;
      case 'none':
        return;
    }
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') return;
    if (this.pointers.has(e.pointerId)) return;
    this.lastHover = null;
    this.handlers.onHover(null);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // deltaMode: 0 pixels, 1 lines, 2 pages. Normalise to pixels so trackpads and
    // wheels feel alike.
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const factor = clamp(Math.exp(-e.deltaY * unit * 0.0015), 0.2, 5);
    this.handlers.onZoom(factor, this.localPoint(e));
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTextEntry(e.target)) return;

    if (PAN_KEYS[e.code]) {
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
      case 'KeyQ':
        if (this.lastHover) {
          e.preventDefault();
          this.handlers.onLongPress(this.lastHover);
        }
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
    // Without this, a key held while the window loses focus pans forever.
    this.heldKeys.clear();
    this.cancelActiveGesture();
    this.pointers.clear();
    this.gesture = { kind: 'none' };
    this.clearLongPress();
  };

  private cancelActiveGesture(): void {
    const g = this.gesture;
    if (g.kind === 'primary') this.handlers.onPrimaryEnd(true);
    else if (g.kind === 'secondary') this.handlers.onSecondaryEnd(true);
    this.gesture = { kind: 'none' };
  }

  private startLongPress(point: Vec2): void {
    this.longPressOrigin = point;
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressOrigin = null;
      // Swallow the release so the long press does not also register as a tap.
      if (this.gesture.kind === 'pan') this.gesture.canTap = false;
      this.handlers.onLongPress(point);
    }, LONG_PRESS_MS);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) window.clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
    this.longPressOrigin = null;
  }

  private localPoint(e: { clientX: number; clientY: number }): Vec2 {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}

/** Guarded: matchMedia is absent in jsdom and in some embedded webviews. */
function prefersCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a: Vec2, b: Vec2): number {
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
