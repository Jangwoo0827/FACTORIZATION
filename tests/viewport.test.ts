import { describe, expect, it } from 'vitest';
import { MAX_PIXEL_RATIO, fitRenderer, type SizableRenderer } from '../src/render/viewport';

/** A renderer that records what it was told, standing in for WebGLRenderer. */
function fake() {
  const calls = { ratio: [] as number[], size: [] as [number, number, boolean | undefined][] };
  const renderer: SizableRenderer = {
    setPixelRatio: (r) => calls.ratio.push(r),
    setSize: (w, h, updateStyle) => calls.size.push([w, h, updateStyle]),
  };
  return { renderer, calls };
}

describe('fitRenderer', () => {
  it('lets the renderer size the canvas style, so it displays at the container size', () => {
    // Regression. Passing `false` here left the canvas displayed at its backing-store
    // size, width * pixelRatio, so on a 150% display the picture was 1.5x the window
    // and the mouse and the buildings disagreed by more the further from the top-left.
    const { renderer, calls } = fake();
    fitRenderer(renderer, 1280, 720, 1.5);

    expect(calls.size).toHaveLength(1);
    const [w, h, updateStyle] = calls.size[0]!;
    expect([w, h]).toEqual([1280, 720]);
    expect(updateStyle).not.toBe(false);
  });

  it('passes the container size in CSS pixels, not scaled by the pixel ratio', () => {
    // The renderer multiplies by the ratio itself; doing it here too would double it.
    const { renderer, calls } = fake();
    fitRenderer(renderer, 800, 600, 2);
    expect(calls.size[0]!.slice(0, 2)).toEqual([800, 600]);
  });

  it('follows the device pixel ratio', () => {
    const { renderer, calls } = fake();
    fitRenderer(renderer, 800, 600, 1.25);
    expect(calls.ratio).toEqual([1.25]);
  });

  it('caps the pixel ratio', () => {
    const { renderer, calls } = fake();
    fitRenderer(renderer, 800, 600, 3.5);
    expect(calls.ratio).toEqual([MAX_PIXEL_RATIO]);
  });

  it('re-reads the ratio every call, so browser zoom and monitor changes take effect', () => {
    const { renderer, calls } = fake();
    fitRenderer(renderer, 800, 600, 1);
    fitRenderer(renderer, 800, 600, 1.5);
    expect(calls.ratio).toEqual([1, 1.5]);
  });
});
