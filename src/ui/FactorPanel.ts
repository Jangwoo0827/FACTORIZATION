/**
 * The factorisation view (GDD 5.4).
 *
 * Pick an item and a rate; it shows the item's signature, the recipe tree down to
 * raw materials, and how many of each machine the chain needs. All the arithmetic is
 * in `factor/view.ts`; this only draws it, so there is nothing here to get wrong
 * that a test could not catch there.
 */

import { MINER_MK1_RATE_PER_TILE } from '../config';
import { ITEM_MAP, itemName } from '../data/items';
import { MACHINE_LABEL, RECIPE_BOOK } from '../data/recipes';
import { superscript } from '../factor/signature';
import { buildFactorModel, type FactorModel } from '../factor/view';

/** A Mk1 miner with all four tiles on ore. */
const MINER_FULL_RATE = MINER_MK1_RATE_PER_TILE * 4;

export class FactorPanel {
  private item: number;
  private perMinute = 6;
  private readonly body: HTMLElement;
  private readonly select: HTMLSelectElement;

  constructor(
    private readonly root: HTMLElement,
    initialItem: number,
  ) {
    this.item = initialItem;
    this.root.replaceChildren();

    const head = document.createElement('div');
    head.className = 'panel__head';
    const title = document.createElement('span');
    title.className = 'panel__title';
    title.textContent = '인수분해 뷰';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel__close';
    close.textContent = '×';
    close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => this.hide());
    head.append(title, close);

    const controls = document.createElement('div');
    controls.className = 'factor__controls';

    this.select = document.createElement('select');
    for (const id of RECIPE_BOOK.craftable) {
      const option = document.createElement('option');
      option.value = String(id);
      option.textContent = itemName(id);
      option.selected = id === this.item;
      this.select.appendChild(option);
    }
    this.select.addEventListener('change', () => {
      this.item = Number(this.select.value);
      this.render();
    });

    const rate = document.createElement('input');
    rate.type = 'number';
    rate.min = '1';
    rate.step = '1';
    rate.value = String(this.perMinute);
    rate.setAttribute('aria-label', '분당 개수');
    rate.addEventListener('input', () => {
      const value = Number(rate.value);
      // Ignore an empty or nonsensical field rather than throwing on it mid-typing.
      if (Number.isFinite(value) && value > 0) {
        this.perMinute = value;
        this.render();
      }
    });

    const unit = document.createElement('span');
    unit.textContent = '개/분';
    unit.style.alignSelf = 'center';
    unit.style.color = 'var(--text-dim)';

    controls.append(this.select, rate, unit);

    this.body = document.createElement('div');
    this.root.append(head, controls, this.body);
    this.render();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private render(): void {
    const model = buildFactorModel(RECIPE_BOOK, this.item, this.perMinute, itemName, MINER_FULL_RATE);
    this.body.replaceChildren(
      this.signatureSection(model),
      this.treeSection(model),
      this.requirementSection(model),
    );
  }

  private signatureSection(model: FactorModel): HTMLElement {
    const section = document.createElement('div');

    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `서명 — 원자재 ${model.rawTotal}개`;

    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const chip of model.chips) {
      const el = document.createElement('span');
      el.className = 'chip';
      const def = ITEM_MAP.get(chip.rawItem);
      el.style.setProperty('--chip', `#${(def?.color ?? 0x888888).toString(16).padStart(6, '0')}`);
      el.textContent = chip.exponent === 1 ? `${chip.prime}` : `${chip.prime}${superscript(chip.exponent)}`;
      const name = document.createElement('span');
      name.className = 'chip__name';
      name.textContent = def?.name ?? '';
      el.appendChild(name);
      chips.appendChild(el);
    }

    const equation = document.createElement('div');
    equation.className = 'factor__equation';
    equation.textContent = model.equation;

    section.append(label, chips, equation);
    return section;
  }

  private treeSection(model: FactorModel): HTMLElement {
    const section = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = '재료 트리';
    section.appendChild(label);

    for (const line of model.tree) {
      const el = document.createElement('div');
      el.className = line.craftable ? 'tree__line' : 'tree__line tree__line--raw';
      el.style.paddingLeft = `${line.depth * 14}px`;
      const count = document.createElement('span');
      count.className = 'tree__count';
      count.textContent = line.depth === 0 ? '' : `${line.count}×`;
      const name = document.createElement('span');
      name.textContent = itemName(line.item);
      el.append(count, name);
      section.appendChild(el);
    }
    return section;
  }

  private requirementSection(model: FactorModel): HTMLElement {
    const section = document.createElement('div');
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `${this.perMinute}개/분을 만들려면`;
    section.appendChild(label);

    const table = document.createElement('table');
    table.className = 'req-table';
    const head = table.createTHead().insertRow();
    for (const text of ['품목', '/분', '필요']) {
      const th = document.createElement('th');
      th.textContent = text;
      head.appendChild(th);
    }

    const tbody = table.createTBody();
    for (const row of model.rows) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = itemName(row.item);
      tr.insertCell().textContent = formatRate(row.perMinute);

      const need = tr.insertCell();
      if (row.machine) {
        need.textContent = `${MACHINE_LABEL[row.machine.class]} Mk${row.machine.tier} ×${row.machinesWhole}`;
        need.title = `정확히 ${row.machines.toFixed(2)}대`;
      } else {
        need.textContent = `채굴기 ×${Math.ceil(row.miners - 1e-9)}`;
        need.title = `정확히 ${row.miners.toFixed(2)}기 (광석 4칸 기준)`;
      }
    }
    section.appendChild(table);
    return section;
  }
}

function formatRate(perMinute: number): string {
  return perMinute >= 100 ? perMinute.toFixed(0) : perMinute.toFixed(1).replace(/\.0$/, '');
}
