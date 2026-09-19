/**
 * Camera panning and focus-preserving zoom (GDD 4.1).
 *
 * No rotation: the projection assumes a fixed viewing angle, which is what lets a
 * building ship with one sprite instead of four.
 */

import type Phaser from 'phaser';
import { MAX_ZOOM, MIN_ZOOM } from '../config';
import type { Vec2 } from '../core/iso';

export class CameraController {
  constructor(private readonly camera: Phaser.Cameras.Scene2D.Camera) {}

  get zoom(): number {
    return this.camera.zoom;
  }

  /** Moves the view by a screen-space delta, so panning feels 1:1 at any zoom. */
  panScreen(dx: number, dy: number): void {
    this.camera.scrollX -= dx / this.camera.zoom;
    this.camera.scrollY -= dy / this.camera.zoom;
  }

  panWorld(dx: number, dy: number): void {
    this.camera.scrollX += dx;
    this.camera.scrollY += dy;
  }

  /**
   * Scales the zoom while keeping the world point under `focus` stationary — the
   * behaviour both a scroll wheel and a pinch need.
   */
  zoomAt(factor: number, focus: Vec2): void {
    const target = clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (target === this.camera.zoom) return;

    const before = this.camera.getWorldPoint(focus.x, focus.y);
    const beforeX = before.x;
    const beforeY = before.y;

    this.camera.setZoom(target);

    const after = this.camera.getWorldPoint(focus.x, focus.y);
    this.camera.scrollX += beforeX - after.x;
    this.camera.scrollY += beforeY - after.y;
  }

  screenToWorld(screen: Vec2): Vec2 {
    const p = this.camera.getWorldPoint(screen.x, screen.y);
    return { x: p.x, y: p.y };
  }

  /** World-space rectangle currently on screen, for culling. */
  viewBounds(): { left: number; top: number; right: number; bottom: number } {
    const view = this.camera.worldView;
    return {
      left: view.x,
      top: view.y,
      right: view.x + view.width,
      bottom: view.y + view.height,
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
