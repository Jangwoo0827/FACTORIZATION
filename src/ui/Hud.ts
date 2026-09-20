/**
 * DOM HUD overlay (GDD 11.1, 12.2).
 *
 * DOM rather than in-canvas UI so that responsive layout, safe-area insets, font
 * scaling and eventual i18n come from the platform instead of being reimplemented.
 * Every control here is also reachable by keyboard on desktop — the buttons exist
 * so touch has a path to actions that otherwise live on keys.
 */

import type { Vec2 } from '../core/grid';
import type { BuildingDef, Rotation } from '../sim/types';

export interface HudCallbacks {
  onSelectBuilding(defId: string | null): void;
  onSelectErase(): void;
  onRotate(): void;
  onRotateView(delta: -1 | 1): void;
  onUndo(): void;
  onRedo(): void;
}

export interface StockRow {
  name: string;
  /** The raw material's prime (GDD 5.1). */
  prime: number;
  color: number;
  stock: number;
  perMinute: number;
}

export interface HudStatus {
  tile: Vec2 | null;
  rotation: Rotation;
  /** Camera yaw in radians. Continuous now, not four fixed steps. */
  yaw: number;
  buildings: number;
  /** Vertical extent of the view in tiles. */
  zoom: number;
  detail: string;
  problem: string | null;
}

/** Grid axes, matching `core/dir.ts`. The arrow on a belt is the readable cue; this is exact. */
const ROTATION_LABEL = ['+X', '+Z', '-X', '-Z'] as const;

export class Hud {
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private readonly statusEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly problemEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly buildBar: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly stockEl: HTMLElement;
  private readonly perfEl: HTMLElement;

  constructor(defs: readonly BuildingDef[], private readonly callbacks: HudCallbacks) {
    this.statusEl = requireElement('hud-status');
    this.detailEl = requireElement('hud-detail');
    this.problemEl = requireElement('hud-problem');
    this.hintEl = requireElement('hud-hint');
    this.buildBar = requireElement('hud-buildbar');
    this.controls = requireElement('hud-controls');
    this.stockEl = requireElement('hud-stock');
    this.perfEl = requireElement('hud-perf');

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
    const yawDegrees = Math.round((((status.yaw * 180) / Math.PI) % 360 + 360) % 360);
    this.statusEl.textContent =
      `타일 ${tile} · 방향 ${ROTATION_LABEL[status.rotation]} · ` +
      `시점 ${yawDegrees}° · ` +
      `건물 ${status.buildings} · 시야 ${status.zoom.toFixed(0)}타일`;
    this.detailEl.textContent = status.detail;
    this.problemEl.textContent = status.problem ?? '';
    this.problemEl.classList.toggle('is-visible', status.problem !== null);
  }

  setHint(text: string): void {
    this.hintEl.textContent = text;
  }

  /**
   * The hub's inventory. Only items that have ever arrived are listed, so the panel
   * starts nearly empty and grows as new materials reach the hub — each new row is
   * a new prime turning up (GDD 3).
   */
  setStock(rows: readonly StockRow[]): void {
    this.stockEl.replaceChildren();

    const title = document.createElement('div');
    title.className = 'stock__title';
    title.textContent = '시브 재고';
    this.stockEl.appendChild(title);

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stock__empty';
      empty.textContent = '채굴기를 광석 위에 놓고, 컨베이어로 시브까지 이으세요.';
      this.stockEl.appendChild(empty);
      return;
    }

    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'stock__row';

      const swatch = document.createElement('span');
      swatch.className = 'stock__swatch';
      swatch.style.background = hex(row.color);

      const name = document.createElement('span');
      name.className = 'stock__name';
      name.textContent = row.name;

      const prime = document.createElement('span');
      prime.className = 'stock__prime';
      prime.textContent = `소수 ${row.prime}`;

      const count = document.createElement('span');
      count.className = 'stock__count';
      count.textContent = row.stock.toLocaleString('ko-KR');

      const rate = document.createElement('span');
      rate.className = 'stock__rate';
      rate.textContent = `${Math.round(row.perMinute)}/분`;

      line.append(swatch, name, prime, count, rate);
      this.stockEl.appendChild(line);
    }
  }

  /** Frame and tick timings. Empty text hides the readout. */
  setPerf(text: string): void {
    this.perfEl.textContent = text;
    this.perfEl.classList.toggle('is-visible', text !== '');
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
      case 'view-left':
        this.callbacks.onRotateView(-1);
        return;
      case 'view-right':
        this.callbacks.onRotateView(1);
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
