// @vitest-environment jsdom

/**
 * Build bar tab behaviour (GDD 11.1). The HUD is refreshed several times a second,
 * which is exactly what made the first version snap the bar back to the selected
 * building's tab while the player browsed another one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDABLE_DEFS } from '../src/data/buildings';
import { Hud, type HudCallbacks } from '../src/ui/Hud';

const IDS = ['status', 'detail', 'problem', 'hint', 'buildbar', 'controls', 'stock', 'perf', 'inspector', 'power'];

function callbacks(): HudCallbacks {
  return {
    onSelectBuilding: vi.fn(),
    onToggleFactor: vi.fn(),
    onTogglePower: vi.fn(),
    onToggleStats: vi.fn(),
    onToggleSave: vi.fn(),
    onSelectErase: vi.fn(),
    onRotate: vi.fn(),
    onRotateView: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
}

const tabButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.buildbar__tab')].find((t) => t.textContent!.includes(label))!;

describe('build bar tabs', () => {
  let hud: Hud;
  let cb: HudCallbacks;

  beforeEach(() => {
    document.body.innerHTML = IDS.map((id) => `<div id="hud-${id}"></div>`).join('');
    // jsdom has no layout, so scrolling calls are stubs.
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollBy = vi.fn() as unknown as Element['scrollBy'];
    cb = callbacks();
    hud = new Hud(BUILDABLE_DEFS, cb);
  });

  afterEach(() => hud.destroy());

  it('starts on the first tab', () => {
    expect(hud.currentTab).toBe('logistics');
  });

  it('stays on the tab the player opened while the HUD keeps refreshing the same selection', () => {
    hud.setSelection('conveyor');
    tabButton('전력').click();
    expect(hud.currentTab).toBe('power');

    // What Game does on every refresh: report the unchanged selection again.
    for (let i = 0; i < 10; i++) hud.setSelection('conveyor');
    expect(hud.currentTab).toBe('power');
  });

  it('still jumps to the tab of a building picked some other way, like the eyedropper', () => {
    hud.setSelection('conveyor');
    tabButton('전력').click();
    hud.setSelection('miner');
    expect(hud.currentTab).toBe('mining');
  });

  it('leaves the tab alone when the selection is cleared or is the demolish tool', () => {
    tabButton('생산').click();
    hud.setSelection(null);
    hud.setSelection('erase');
    expect(hud.currentTab).toBe('production');
  });

  it('shows only the cards of the open tab, and selects a building when its card is clicked', () => {
    tabButton('채굴').click();
    const visible = [...document.querySelectorAll('.buildbar__page:not([hidden]) .tool')];
    expect(visible).toHaveLength(2);
    (visible[0] as HTMLButtonElement).click();
    expect(cb.onSelectBuilding).toHaveBeenCalledWith('miner');
  });

  it('marks tabs with how many of their buildings are unlocked, and a lock when none are', () => {
    hud.setUnlocked(new Set(['conveyor', 'miner']));
    expect(tabButton('물류').querySelector('.buildbar__tab-count')!.textContent).toBe('1/4');
    expect(tabButton('전력').querySelector('.buildbar__tab-count')!.textContent).toBe('🔒');
    expect(tabButton('전력').classList.contains('buildbar__tab--locked')).toBe(true);
  });
});
