/**
 * Sizing the canvas to its container.
 *
 * Split out because getting it wrong is invisible on a display at 100% scale and
 * badly wrong everywhere else, so it needs a test that does not depend on the
 * machine it runs on.
 */

export interface SizableRenderer {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

/** Beyond this the extra pixels cost fill rate and are not visible. */
export const MAX_PIXEL_RATIO = 2;

export function fitRenderer(
  renderer: SizableRenderer,
  width: number,
  height: number,
  devicePixelRatio: number,
): void {
  // Read again on every resize rather than once at start-up: browser zoom and
  // dragging the window onto another monitor both change it without a reload, and
  // both fire a resize event.
  renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));

  // The style must be updated (the default), so the canvas is displayed at the
  // container's CSS size. Passing `false` leaves it at its backing-store size,
  // which is `width * pixelRatio`. On any display scaled above 100% the picture is
  // then bigger than the window while the camera still projects against the
  // window's size, so what is drawn under the cursor is not what the cursor picks:
  // the mismatch is zero at the top-left corner and grows toward the bottom-right.
  renderer.setSize(width, height);
}
