/**
 * DOM HUD overlay (GDD 11.1, 12.2).
 *
 * DOM rather than in-canvas UI so that responsive layout, safe-area insets, font
 * scaling and eventual i18n come from the platform instead of being reimplemented.
 * Every control here is also reachable by keyboard on desktop — the buttons exist
 * so touch has a path to actions that otherwise live on keys.
 */

import type { Vec2 } from '../core/grid';
import { displayName } from '../data/buildings';
import { itemName } from '../data/items';
import type { BuildingDef, Rotation } from '../sim/types';

/** One recipe a machine could be set to. */
export interface RecipeChoice {
  item: number;
  name: string;
  color: number;
  signature: string;
  ingredients: string;
  seconds: number;
}

export interface InspectorOptions {
  title: string;
  recipes: readonly RecipeChoice[];
  /** Called with the chosen item, or 0 when the current recipe is clicked again to clear it. */
  onPick(item: number): void;
}

export type StatusKind = 'working' | 'waiting' | 'blocked' | 'idle';

/** What changes from moment to moment while a machine is selected. */
export interface InspectorLive {
  statusText: string;
  statusKind: StatusKind;
  /** The item currently set, or 0. */
  recipe: number;
  buffers: readonly { name: string; have: number; cap: number }[];
  /** 0..1 through the current craft. */
  progress: number;
  output: number;
}

export interface HudCallbacks {
  onSelectBuilding(defId: string | null): void;
  onToggleFactor(): void;
  onSelectErase(): void;
  onRotate(): void;
  onRotateView(delta: -1 | 1): void;
  onUndo(): void;
  onRedo(): void;
}

export interface StockRow {
  name: string;
  /** The item's prime factorisation, already formatted (GDD 5). */
  signature: string;
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
  private readonly inspectorEl: HTMLElement;
  private inspector: {
    dot: HTMLElement;
    status: HTMLElement;
    recipes: Map<number, HTMLElement>;
    buffers: HTMLElement;
    bar: HTMLElement;
    output: HTMLElement;
  } | null = null;

  constructor(defs: readonly BuildingDef[], private readonly callbacks: HudCallbacks) {
    this.statusEl = requireElement('hud-status');
    this.detailEl = requireElement('hud-detail');
    this.problemEl = requireElement('hud-problem');
    this.hintEl = requireElement('hud-hint');
    this.buildBar = requireElement('hud-buildbar');
    this.controls = requireElement('hud-controls');
    this.stockEl = requireElement('hud-stock');
    this.perfEl = requireElement('hud-perf');
    this.inspectorEl = requireElement('hud-inspector');

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
      prime.textContent = `서명 ${row.signature}`;

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

  get inspectorOpen(): boolean {
    return !this.inspectorEl.hidden;
  }

  /**
   * Opens the machine panel. The parts that do not change while it is open (the
   * recipe list) are built once here, so a click is never lost to a redraw between
   * the press and the release; the live parts are updated in place.
   */
  openInspector(options: InspectorOptions): void {
    const root = this.inspectorEl;
    root.replaceChildren();

    const head = document.createElement('div');
    head.className = 'panel__head';
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = options.title;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '×';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => this.closeInspector());
    head.append(title, close);

    const statusRow = document.createElement('div');
    statusRow.className = 'inspector__status';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    const status = document.createElement('span');
    statusRow.append(dot, status);

    const recipeLabel = document.createElement('div');
    recipeLabel.className = 'section-label';
    recipeLabel.textContent = '레시피';

    const list = document.createElement('div');
    list.className = 'recipe-list';
    const recipes = new Map<number, HTMLElement>();
    for (const recipe of options.recipes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recipe';

      const swatch = document.createElement('span');
      swatch.className = 'recipe__swatch';
      swatch.style.background = hex(recipe.color);
      const name = document.createElement('span');
      name.className = 'recipe__name';
      name.textContent = `${recipe.name}  ${recipe.signature}`;
      const time = document.createElement('span');
      time.className = 'recipe__time';
      time.textContent = `${recipe.seconds}초`;
      const detail = document.createElement('span');
      detail.className = 'recipe__detail';
      detail.textContent = recipe.ingredients;
      button.append(swatch, name, time, detail);

      button.addEventListener('click', () =>
        options.onPick(button.classList.contains('is-active') ? 0 : recipe.item),
      );
      recipes.set(recipe.item, button);
      list.appendChild(button);
    }

    const bufferLabel = document.createElement('div');
    bufferLabel.className = 'section-label';
    bufferLabel.textContent = '재료 버퍼';
    const buffers = document.createElement('div');

    const progress = document.createElement('div');
    progress.className = 'progress';
    const bar = document.createElement('div');
    bar.className = 'progress__bar';
    progress.appendChild(bar);

    const output = document.createElement('div');
    output.className = 'section-label';

    root.append(head, statusRow, recipeLabel, list, bufferLabel, buffers, progress, output);
    root.hidden = false;
    this.inspector = { dot, status, recipes, buffers, bar, output };
  }

  updateInspector(live: InspectorLive): void {
    const ui = this.inspector;
    if (!ui) return;

    ui.dot.className = `status-dot status-dot--${live.statusKind}`;
    ui.status.textContent = live.statusText;

    for (const [item, button] of ui.recipes) {
      const active = item === live.recipe;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    ui.buffers.replaceChildren();
    if (live.buffers.length === 0) {
      const none = document.createElement('div');
      none.className = 'stock__empty';
      none.textContent = '레시피를 고르세요.';
      ui.buffers.appendChild(none);
    }
    for (const buffer of live.buffers) {
      const row = document.createElement('div');
      row.className = buffer.have >= buffer.cap ? 'buffer-row buffer-row--full' : 'buffer-row';
      const name = document.createElement('span');
      name.textContent = buffer.name;
      const count = document.createElement('span');
      count.textContent = `${buffer.have} / ${buffer.cap}`;
      row.append(name, count);
      ui.buffers.appendChild(row);
    }

    ui.bar.style.width = `${Math.round(Math.min(1, Math.max(0, live.progress)) * 100)}%`;
    ui.output.textContent = `출력 대기 ${live.output}`;
  }

  closeInspector(): void {
    this.inspectorEl.hidden = true;
    this.inspectorEl.replaceChildren();
    this.inspector = null;
  }

  /** Marks the build buttons the current stock cannot pay for. */
  setAffordable(affordable: ReadonlySet<string>): void {
    for (const [id, button] of this.buttons) {
      if (id === 'erase') continue;
      button.classList.toggle('tool--poor', !affordable.has(id));
    }
  }

  /**
   * Marks the build buttons no seal has unlocked yet. They stay selectable — placing
   * one still shows why it is refused, the same as an unaffordable one — but shown
   * clearly out of reach so the panel does not silently invite an action that fails.
   */
  setUnlocked(unlocked: ReadonlySet<string>): void {
    for (const [id, button] of this.buttons) {
      if (id === 'erase') continue;
      button.classList.toggle('tool--locked', !unlocked.has(id));
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
    button.querySelector('.tool__name')!.textContent = displayName(def);
    const price = (def.cost ?? []).map((c) => `${itemName(c.item)} ${c.count}`).join(' · ');
    button.querySelector('.tool__size')!.textContent = price ? `${def.w}×${def.h} · ${price}` : `${def.w}×${def.h}`;
    button.title = price ? `건설비: ${price}` : '무료';
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
      case 'factor':
        this.callbacks.onToggleFactor();
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
