/**
 * The production statistics panel (GDD 11.2).
 *
 * One row per item the factory has made or used: made per minute, used per minute,
 * and the difference, over a chosen window (1 minute, 10 minutes, an hour), with a
 * small graph of the making rate across that window. A negative difference is the
 * useful signal — something is being used faster than it is made — so it is red.
 *
 * The window buttons are built once; only the table is redrawn, so a click is never
 * lost to a redraw.
 */

import { ITEM_MAP, itemName } from '../data/items';
import type { ProductionStats } from '../sim/stats';

const WINDOWS = [
  { seconds: 60, label: '1분' },
  { seconds: 600, label: '10분' },
  { seconds: 3600, label: '1시간' },
] as const;

const SPARK_BUCKETS = 30;
const SPARK_W = 64;
const SPARK_H = 16;

export class StatsPanel {
  private window: number = WINDOWS[0].seconds;
  private readonly body: HTMLElement;
  private readonly tabs = new Map<number, HTMLButtonElement>();

  constructor(private readonly root: HTMLElement) {
    root.replaceChildren();

    const head = document.createElement('div');
    head.className = 'panel__head';
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = '생산 통계';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '×';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => this.hide());
    head.append(title, close);

    const tabs = document.createElement('div');
    tabs.className = 'stats__tabs';
    for (const w of WINDOWS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stats__tab';
      b.textContent = w.label;
      b.addEventListener('click', () => {
        this.window = w.seconds;
        this.markTab();
        this.dirty = true;
      });
      this.tabs.set(w.seconds, b);
      tabs.appendChild(b);
    }

    this.body = document.createElement('div');
    root.append(head, tabs, this.body);
    this.markTab();
  }

  /** Set when the window changes, so the next update redraws even between refreshes. */
  private dirty = true;

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    this.dirty = true;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Redraws the table if the panel is open. */
  update(stats: ProductionStats): void {
    if (this.root.hidden) return;
    this.dirty = false;

    const items = stats.activeItems();
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'stock__empty';
      empty.textContent = '아직 만들거나 쓴 것이 없습니다. 채굴기나 기계가 돌기 시작하면 여기에 쌓여요.';
      this.body.replaceChildren(empty);
      return;
    }

    const span = Math.min(this.window, stats.seconds);
    const note = document.createElement('div');
    note.className = 'section-label';
    note.textContent =
      span < this.window ? `지난 ${formatSpan(span)} 기준 (기록이 아직 짧아요)` : `지난 ${formatSpan(span)} 기준 · 개/분`;

    const table = document.createElement('table');
    table.className = 'req-table stats__table';
    const headRow = table.createTHead().insertRow();
    for (const text of ['품목', '생산', '소비', '순', '']) {
      const th = document.createElement('th');
      th.textContent = text;
      headRow.appendChild(th);
    }

    const tbody = table.createTBody();
    for (const item of items) {
      const made = stats.producedPerMinute(item, this.window);
      const used = stats.consumedPerMinute(item, this.window);
      const net = made - used;
      const tr = tbody.insertRow();

      const name = tr.insertCell();
      const swatch = document.createElement('span');
      swatch.className = 'recipe__swatch stats__swatch';
      swatch.style.background = `#${(ITEM_MAP.get(item)?.color ?? 0x888888).toString(16).padStart(6, '0')}`;
      name.append(swatch, itemName(item));

      tr.insertCell().textContent = formatRate(made);
      tr.insertCell().textContent = formatRate(used);
      const netCell = tr.insertCell();
      netCell.textContent = (net > 0 ? '+' : '') + formatRate(net);
      if (net < -0.05) netCell.className = 'stats__net--short';

      tr.insertCell().appendChild(sparkline(stats.producedSeries(item, this.window, SPARK_BUCKETS)));
    }
    this.body.replaceChildren(note, table);
  }

  /** Whether a redraw is owed outside the usual refresh (the window was just changed). */
  get needsRedraw(): boolean {
    return this.dirty;
  }

  private markTab(): void {
    for (const [seconds, button] of this.tabs) {
      const on = seconds === this.window;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }
}

function sparkline(values: readonly number[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(SPARK_W));
  svg.setAttribute('height', String(SPARK_H));
  svg.setAttribute('class', 'stats__spark');
  const max = Math.max(...values, 1e-9);
  const points = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (SPARK_W - 2) + 1;
      const y = SPARK_H - 1 - (v / max) * (SPARK_H - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const line = document.createElementNS(ns, 'polyline');
  line.setAttribute('points', points);
  svg.appendChild(line);
  return svg;
}

function formatRate(perMinute: number): string {
  const a = Math.abs(perMinute);
  if (a < 0.05) return '0';
  return a >= 100 ? perMinute.toFixed(0) : perMinute.toFixed(1).replace(/\.0$/, '');
}

function formatSpan(seconds: number): string {
  if (seconds >= 3600) return '1시간';
  if (seconds >= 60) return `${Math.round(seconds / 60)}분`;
  return `${seconds}초`;
}
