// @vitest-environment jsdom

/**
 * Input mapping tests (GDD 12.1).
 *
 * Each mouse button owns exactly one meaning, so these pin which is which and,
 * just as importantly, that a drag never also fires the click action.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { InputAdapter, type InputHandlers } from '../src/input/InputAdapter';

/** Every handler as a spy that still carries its real signature. */
type MockedHandlers = { [K in keyof InputHandlers]: Mock<InputHandlers[K]> };

function makeHandlers(): MockedHandlers {
  return {
    onPan: vi.fn<InputHandlers['onPan']>(),
    onOrbit: vi.fn<InputHandlers['onOrbit']>(),
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
    onUndo: vi.fn<InputHandlers['onUndo']>(),
    onRedo: vi.fn<InputHandlers['onRedo']>(),
    onCancel: vi.fn<InputHandlers['onCancel']>(),
  };
}

/** jsdom has no PointerEvent, so synthesise one with just the fields we read. */
function pointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  props: { x: number; y: number; button?: number; id?: number },
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: props.id ?? 1,
    pointerType: 'mouse',
    clientX: props.x,
    clientY: props.y,
    button: props.button ?? 0,
  });
  element.dispatchEvent(event);
}

describe('InputAdapter', () => {
  let element: HTMLElement;
  let handlers: MockedHandlers;
  let toolActive: boolean;
  let adapter: InputAdapter;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    handlers = makeHandlers();
    toolActive = false;
    adapter = new InputAdapter({ element, handlers, isToolActive: () => toolActive });
  });

  afterEach(() => {
    adapter.destroy();
    element.remove();
  });

  describe('left button', () => {
    it('builds when a tool is held', () => {
      toolActive = true;
      pointer(element, 'pointerdown', { x: 100, y: 100 });
      pointer(element, 'pointermove', { x: 140, y: 120 });
      pointer(element, 'pointerup', { x: 140, y: 120 });

      expect(handlers.onPrimaryStart).toHaveBeenCalledTimes(1);
      expect(handlers.onPrimaryDrag).toHaveBeenCalledWith({ x: 140, y: 120 });
      expect(handlers.onPrimaryEnd).toHaveBeenCalledWith(false);
      expect(handlers.onPan).not.toHaveBeenCalled();
    });

    it('pans when no tool is held', () => {
      pointer(element, 'pointerdown', { x: 100, y: 100 });
      pointer(element, 'pointermove', { x: 130, y: 90 });

      expect(handlers.onPan).toHaveBeenCalledWith(30, -10);
      expect(handlers.onPrimaryStart).not.toHaveBeenCalled();
    });

    it('inspects on a click that did not drag', () => {
      pointer(element, 'pointerdown', { x: 100, y: 100 });
      pointer(element, 'pointerup', { x: 102, y: 101 });

      expect(handlers.onTap).toHaveBeenCalledWith({ x: 102, y: 101 });
    });

    it('does not inspect after a pan', () => {
      pointer(element, 'pointerdown', { x: 100, y: 100 });
      pointer(element, 'pointermove', { x: 160, y: 100 });
      pointer(element, 'pointerup', { x: 160, y: 100 });

      expect(handlers.onTap).not.toHaveBeenCalled();
    });
  });

  describe('middle button', () => {
    it('orbits the camera on drag, and never pans', () => {
      pointer(element, 'pointerdown', { x: 40, y: 50, button: 1 });
      pointer(element, 'pointermove', { x: 70, y: 40 });

      expect(handlers.onOrbit).toHaveBeenCalledWith(30, -10);
      expect(handlers.onPan).not.toHaveBeenCalled();
    });

    it('orbits even while a tool is held', () => {
      toolActive = true;
      pointer(element, 'pointerdown', { x: 40, y: 50, button: 1 });
      pointer(element, 'pointermove', { x: 70, y: 50 });

      expect(handlers.onOrbit).toHaveBeenCalled();
      expect(handlers.onPrimaryStart).not.toHaveBeenCalled();
    });

    it('picks on a click that did not drag', () => {
      pointer(element, 'pointerdown', { x: 40, y: 50, button: 1 });
      pointer(element, 'pointerup', { x: 40, y: 50, button: 1 });

      expect(handlers.onPick).toHaveBeenCalledWith({ x: 40, y: 50 });
      expect(handlers.onTap).not.toHaveBeenCalled();
    });

    it('does not pick after orbiting', () => {
      pointer(element, 'pointerdown', { x: 40, y: 50, button: 1 });
      pointer(element, 'pointermove', { x: 120, y: 50 });
      pointer(element, 'pointerup', { x: 120, y: 50, button: 1 });

      expect(handlers.onPick).not.toHaveBeenCalled();
    });
  });

  describe('right button', () => {
    it('erases on drag', () => {
      pointer(element, 'pointerdown', { x: 10, y: 10, button: 2 });
      pointer(element, 'pointermove', { x: 40, y: 10 });
      pointer(element, 'pointerup', { x: 40, y: 10, button: 2 });

      expect(handlers.onSecondaryStart).toHaveBeenCalledTimes(1);
      expect(handlers.onSecondaryDrag).toHaveBeenCalledTimes(1);
      expect(handlers.onSecondaryEnd).toHaveBeenCalledWith(false);
    });
  });

  describe('hover', () => {
    it('reports the cursor only when no button is down', () => {
      pointer(element, 'pointermove', { x: 50, y: 60 });
      expect(handlers.onHover).toHaveBeenCalledWith({ x: 50, y: 60 });

      handlers.onHover.mockClear();
      pointer(element, 'pointerdown', { x: 50, y: 60 });
      pointer(element, 'pointermove', { x: 80, y: 60 });
      expect(handlers.onHover).not.toHaveBeenCalled();
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

    it('turns the view while Q or E is held, and stops on release', () => {
      // Polled rather than dispatched: 3D allows a smooth turn, so the camera
      // follows the held key instead of jumping a quarter turn per press.
      expect(adapter.keyboardYaw()).toBe(0);

      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      expect(adapter.keyboardYaw()).toBe(-1);

      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      expect(adapter.keyboardYaw()).toBe(1);

      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      expect(adapter.keyboardYaw()).toBe(0);
    });

    it('cancels out when both turn keys are held', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
      expect(adapter.keyboardYaw()).toBe(0);
    });

    it('keeps R on the building, not the camera', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR' }));
      expect(handlers.onRotate).toHaveBeenCalledTimes(1);
      expect(adapter.keyboardYaw()).toBe(0);
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
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' }));
      window.dispatchEvent(new Event('blur'));

      expect(adapter.keyboardPan()).toEqual({ x: 0, y: 0 });
      expect(adapter.keyboardYaw()).toBe(0);
    });

    it('rolls back an in-progress stroke when focus is lost', () => {
      toolActive = true;
      pointer(element, 'pointerdown', { x: 10, y: 10 });
      window.dispatchEvent(new Event('blur'));

      expect(handlers.onPrimaryEnd).toHaveBeenCalledWith(true);
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
