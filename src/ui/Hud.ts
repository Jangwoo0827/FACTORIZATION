/**
 * DOM HUD overlay (GDD 11.1, 12.2).
 *
 * DOM rather than in-canvas UI so that responsive layout, safe-area insets, font
 * scaling and eventual i18n come from the platform instead of being reimplemented.
 * Every control here is also reachable by keyboard on desktop — the buttons exist
 * so touch has a path to actions that otherwise live on keys.
 */

import type { Vec2 } from '../core/iso';
import type { BuildingDef, Rotation } from '../sim/types';

export interface HudCallbacks {
  onSelectBuilding(defId: string | null): void;
  onSelectErase(): void;
  onRotate(): void;
  onUndo(): void;
  onRedo(): void;
}

export interface HudStatus {
  tile: Vec2 | null;
  rotation: Rotation;
  buildings: number;
  zoom: number;
  detail: string;
  problem: string | null;
}

const ROTATION_LABEL = ['N', 'E', 'S', 'W'] as const;

export class Hud {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly statusEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly problemEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly buildBar: HTMLElement;
  private readonly controls: HTMLElement;

  constructor(defs: readonly BuildingDef[], private readonly callbacks: HudCallbacks) {
    this.statusEl = requireElement('hud-status');
    this.detailEl = requireElement('hud-detail');
    this.problemEl = requireElement('hud-problem');
    this.hintEl = requireElement('hud-hint');
    this.buildBar = requireElement('hud-buildbar');
    this.controls = requireElement('hud-controls');

    this.buildBar.replaceChildren();
    for (const def of defs) {
      this.buildBar.appendChild(this.createBuildButton(def));
    }
    this.buildBar.appendChild(this.createEraseButton());

    this.controls.addEventListener('click', this.onControlClick);
  }

  destroy(): void {
    this.controls.removeEventListener('click', this.onControlClick);
    this.buildBar.replaceChildren();
    this.buttons.clear();
  }

  setSelection(selected: string | 'erase' | null): void {
    for (const [id, button] of this.buttons) {
      const active = id === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  setStatus(status: HudStatus): void {
    const tile = status.tile ? `${status.tile.x}, ${status.tile.y}` : '—';
    this.statusEl.textContent =
      `타일 ${tile} · 방향 ${ROTATION_LABEL[status.rotation]} · ` +
      `건물 ${status.buildings} · 줌 ${status.zoom.toFixed(2)}x`;
    this.detailEl.textContent = status.detail;
    this.problemEl.textContent = status.problem ?? '';
    this.problemEl.classList.toggle('is-visible', status.problem !== null);
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
  }

  private createBuildButton(def: BuildingDef): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool';
    button.dataset['defId'] = def.id;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML =
      `<span class="tool__swatch" style="background:${hex(def.color)}"></span>` +
      `<span class="tool__name"></span>` +
      `<span class="tool__size"></span>`;
    button.querySelector('.tool__name')!.textContent = def.name;
    button.querySelector('.tool__size')!.textContent = `${def.w}×${def.h}`;
    button.addEventListener('click', () => {
      const next = this.buttons.get(def.id)?.classList.contains('is-active') ? null : def.id;
      this.callbacks.onSelectBuilding(next);
    });
    this.buttons.set(def.id, button);
    return button;
  }

  private createEraseButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tool tool--erase';
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML =
      `<span class="tool__swatch tool__swatch--erase"></span>` +
      `<span class="tool__name">철거</span>` +
      `<span class="tool__size">드래그</span>`;
    button.addEventListener('click', () => this.callbacks.onSelectErase());
    this.buttons.set('erase', button);
    return button;
  }

  private onControlClick = (event: Event): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target) return;
    switch (target.dataset['action']) {
      case 'rotate':
        this.callbacks.onRotate();
        return;
      case 'undo':
        this.callbacks.onUndo();
        return;
      case 'redo':
        this.callbacks.onRedo();
        return;
      default:
        return;
    }
  };
}

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`HUD element #${id} is missing from index.html`);
  return el;
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
