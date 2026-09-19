// @vitest-environment jsdom

/**
 * Gesture mapping tests (GDD 12.1).
 *
 * These exist because touch is the part of M0 that cannot be checked by hand in a
 * desktop browser: a mouse cannot produce a second finger. The pan-vs-build rule
 * is the whole reason the game is playable on a phone, so it is pinned here.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { InputAdapter, type InputHandlers } from '../src/input/InputAdapter';

/**
 * Every handler as a spy that still carries its real signature, so the mocks stay
 * assignable to InputHandlers and `mock.calls` keeps its argument types.
 */
type MockedHandlers = { [K in keyof InputHandlers]: Mock<InputHandlers[K]> };

function makeHandlers(): MockedHandlers {
  return {
    onPan: vi.fn<InputHandlers['onPan']>(),
    onZoom: vi.fn<InputHandlers['onZoom']>(),
    onHover: vi.fn<InputHandlers['onHover']>(),
    onPrimaryStart: vi.fn<InputHandlers['onPrimaryStart']>(),
    onPrimaryDrag: vi.fn<InputHandlers['onPrimaryDrag']>(),
    onPrimaryEnd: vi.fn<InputHandlers['onPrimaryEnd']>(),
    onSecondaryStart: vi.fn<InputHandlers['onSecondaryStart']>(),
    onSecondaryDrag: vi.fn<InputHandlers['onSecondaryDrag']>(),
    onSecondaryEnd: vi.fn<InputHandlers['onSecondaryEnd']>(),
    onTap: vi.fn<InputHandlers['onTap']>(),
    onPick: vi.fn<InputHandlers['onPick']>(),
    onRotate: vi.fn<InputHandlers['onRotate']>(),
    onRotateView: vi.fn<InputHandlers['onRotateView']>(),
    onUndo: vi.fn<InputHandlers['onUndo']>(),
    onRedo: vi.fn<InputHandlers['onRedo']>(),
    onCancel: vi.fn<InputHandlers['onCancel']>(),
  };
}

/** jsdom has no PointerEvent, so synthesise one with just the fields we read. */
function pointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  props: { id: number; x: number; y: number; touch?: boolean; button?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: props.id,
    pointerType: props.touch === false ? 'mouse' : 'touch',
    clientX: props.x,
    clientY: props.y,
    button: props.button ?? 0,
  });
  element.dispatchEvent(event);
}

describe('InputAdapter gestures', () => {
  let element: HTMLElement;
  let handlers: ReturnType<typeof makeHandlers>;
  let toolActive: boolean;
  let adapter: InputAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('div');
    document.body.appendChild(element);
    handlers = makeHandlers();
    toolActive = false;
    adapter = new InputAdapter({
      element,
      handlers,
      isToolActive: () => toolActive,
    });
  });

  afterEach(() => {
    adapter.destroy();
    element.remove();
    vi.useRealTimers();
  });

  describe('with a tool held', () => {
    beforeEach(() => {
      toolActive = true;
    });

    it('builds with one finger instead of panning', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointermove', { id: 1, x: 140, y: 120 });
      pointer(element, 'pointerup', { id: 1, x: 140, y: 120 });

      expect(handlers.onPrimaryStart).toHaveBeenCalledTimes(1);
      expect(handlers.onPrimaryDrag).toHaveBeenCalledWith({ x: 140, y: 120 });
      expect(handlers.onPrimaryEnd).toHaveBeenCalledWith(false);
      expect(handlers.onPan).not.toHaveBeenCalled();
    });

    it('pans and zooms with two fingers, cancelling the build it interrupted', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      expect(handlers.onPrimaryStart).toHaveBeenCalledTimes(1);

      // Second finger arrives: the stroke must be rolled back, not committed.
      pointer(element, 'pointerdown', { id: 2, x: 200, y: 100 });
      expect(handlers.onPrimaryEnd).toHaveBeenCalledWith(true);

      // Spread the fingers: zoom in, and the midpoint shift pans.
      pointer(element, 'pointermove', { id: 2, x: 300, y: 100 });
      expect(handlers.onZoom).toHaveBeenCalled();
      expect(handlers.onZoom.mock.calls[0]![0]).toBeGreaterThan(1);
      expect(handlers.onPan).toHaveBeenCalled();

      // Nothing further may be built by the fingers already down.
      expect(handlers.onPrimaryStart).toHaveBeenCalledTimes(1);
    });

    it('does not resume building when one finger lifts after a pinch', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointerdown', { id: 2, x: 200, y: 100 });
      pointer(element, 'pointerup', { id: 2, x: 200, y: 100 });
      handlers.onPrimaryStart.mockClear();

      pointer(element, 'pointermove', { id: 1, x: 160, y: 160 });

      expect(handlers.onPrimaryStart).not.toHaveBeenCalled();
      expect(handlers.onPrimaryDrag).not.toHaveBeenCalled();
    });
  });

  describe('with no tool held', () => {
    it('pans with one finger', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointermove', { id: 1, x: 130, y: 90 });

      expect(handlers.onPan).toHaveBeenCalledWith(30, -10);
      expect(handlers.onPrimaryStart).not.toHaveBeenCalled();
    });

    it('treats a press and release without movement as a tap', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointerup', { id: 1, x: 102, y: 101 });

      expect(handlers.onTap).toHaveBeenCalledWith({ x: 102, y: 101 });
    });

    it('does not tap after the pointer has been dragged', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointermove', { id: 1, x: 160, y: 100 });
      pointer(element, 'pointerup', { id: 1, x: 160, y: 100 });

      expect(handlers.onTap).not.toHaveBeenCalled();
    });

    it('fires the eyedropper on a long press, and suppresses the tap', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      vi.advanceTimersByTime(500);
      expect(handlers.onPick).toHaveBeenCalledWith({ x: 100, y: 100 });

      pointer(element, 'pointerup', { id: 1, x: 100, y: 100 });
      expect(handlers.onTap).not.toHaveBeenCalled();
    });

    it('cancels the long press once the finger moves', () => {
      pointer(element, 'pointerdown', { id: 1, x: 100, y: 100 });
      pointer(element, 'pointermove', { id: 1, x: 140, y: 100 });
      vi.advanceTimersByTime(500);

      expect(handlers.onPick).not.toHaveBeenCalled();
    });
  });

  describe('mouse', () => {
    it('erases with the right button', () => {
      pointer(element, 'pointerdown', { id: 1, x: 10, y: 10, touch: false, button: 2 });
      pointer(element, 'pointermove', { id: 1, x: 40, y: 10, touch: false });
      pointer(element, 'pointerup', { id: 1, x: 40, y: 10, touch: false, button: 2 });

      expect(handlers.onSecondaryStart).toHaveBeenCalledTimes(1);
      expect(handlers.onSecondaryDrag).toHaveBeenCalledTimes(1);
      expect(handlers.onSecondaryEnd).toHaveBeenCalledWith(false);
    });

    it('pans with the middle button even while a tool is held', () => {
      toolActive = true;
      pointer(element, 'pointerdown', { id: 1, x: 10, y: 10, touch: false, button: 1 });
      pointer(element, 'pointermove', { id: 1, x: 30, y: 10, touch: false });

      expect(handlers.onPan).toHaveBeenCalledWith(20, 0);
      expect(handlers.onPrimaryStart).not.toHaveBeenCalled();
    });

    it('picks on a middle click that did not drag', () => {
      pointer(element, 'pointerdown', { id: 1, x: 40, y: 50, touch: false, button: 1 });
      pointer(element, 'pointerup', { id: 1, x: 41, y: 50, touch: false, button: 1 });

      expect(handlers.onPick).toHaveBeenCalledWith({ x: 41, y: 50 });
      expect(handlers.onTap).not.toHaveBeenCalled();
    });

    it('does not pick when the middle button was used to pan', () => {
      pointer(element, 'pointerdown', { id: 1, x: 40, y: 50, touch: false, button: 1 });
      pointer(element, 'pointermove', { id: 1, x: 120, y: 50, touch: false });
      pointer(element, 'pointerup', { id: 1, x: 120, y: 50, touch: false, button: 1 });

      expect(handlers.onPick).not.toHaveBeenCalled();
    });

    it('reports hover only when no button is down', () => {
      pointer(element, 'pointermove', { id: 1, x: 50, y: 60, touch: false });
      expect(handlers.onHover).toHaveBeenCalledWith({ x: 50, y: 60 });
    });
  });

  describe('keyboard', () => {
    it('maps undo and redo, including the shift variant', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true }));
      expect(handlers.onUndo).toHaveBeenCalledTimes(1);

      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyZ', ctrlKey: true, shiftKey: true }),
      );
      expect(handlers.onRedo).toHaveBeenCalledTimes(1);
    });

    it('turns the view with Q and E, and the building with R', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      expect(handlers.onRotateView).toHaveBeenCalledWith(-1);

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      expect(handlers.onRotateView).toHaveBeenCalledWith(1);

      // R must stay on the building, not the camera.
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
      expect(handlers.onRotate).toHaveBeenCalledTimes(1);
      expect(handlers.onRotateView).toHaveBeenCalledTimes(2);
    });

    it('produces a normalised pan vector from held keys', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
      expect(adapter.keyboardPan()).toEqual({ x: 1, y: 0 });

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      const diagonal = adapter.keyboardPan();
      expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);

      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      expect(adapter.keyboardPan()).toEqual({ x: 0, y: 0 });
    });

    it('releases held keys when the window loses focus', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
      window.dispatchEvent(new Event('blur'));
      expect(adapter.keyboardPan()).toEqual({ x: 0, y: 0 });
    });

    it('ignores shortcuts while typing in a field', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));

      expect(handlers.onRotate).not.toHaveBeenCalled();
      input.remove();
    });
  });
});
