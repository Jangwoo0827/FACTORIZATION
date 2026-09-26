/**
 * The seal panel (GDD 9, 11.1).
 *
 * Progress reads as an ordinary checklist — "철광석 12 / 30" with a bar — and the
 * lock number sits underneath as a secondary line, never in place of the plain
 * request (GDD 9's own rule: the theme must not cost readability). What the seal
 * unlocks is shown too, so the checklist has a visible payoff.
 */

import { displayName, DEF_MAP } from '../data/buildings';
import { itemName } from '../data/items';
import { lockOf } from '../data/seals';
import { formatSignature } from '../factor/signature';
import type { Progress, RequirementProgress } from '../sim/progress';
import type { SealDef } from '../sim/types';

export class SealPanel {
  constructor(private readonly root: HTMLElement) {}

  update(progress: Progress): void {
    this.root.replaceChildren();

    if (progress.finished) {
      const done = document.createElement('div');
      done.className = 'seal__done';
      done.textContent = '🎉 모든 봉인을 달성했습니다';
      this.root.appendChild(done);
      return;
    }

    const seal = progress.active!;
    const title = document.createElement('div');
    title.className = 'stock__title';
    title.textContent = `봉인 ${seal.level} / ${progress.seals.length}`;
    this.root.appendChild(title);

    for (const line of progress.progressOf(seal)) this.root.appendChild(this.requirementRow(line));

    const unlockText = describeUnlocks(seal);
    if (unlockText) {
      const unlocks = document.createElement('div');
      unlocks.className = 'seal__unlocks';
      unlocks.textContent = `해금: ${unlockText}`;
      this.root.appendChild(unlocks);
    }

    const lock = document.createElement('div');
    lock.className = 'seal__lock';
    lock.textContent = `잠금 수 ${formatSignature(lockOf(seal))}`;
    this.root.appendChild(lock);
  }

  private requirementRow(line: RequirementProgress): HTMLElement {
    const row = document.createElement('div');
    row.className = 'seal__req';

    const label = document.createElement('div');
    label.className = 'seal__req-label';
    label.textContent =
      line.requirement.kind === 'deliver'
        ? `${itemName(line.requirement.item)} ${Math.floor(line.have)} / ${line.need}`
        : `${itemName(line.requirement.item)} 분당 ${line.requirement.perMinute}개를 ${line.requirement.minutes}분간 유지 · ${Math.floor(line.have)} / ${line.need}초`;
    if (line.met) label.classList.add('seal__req-label--met');

    const bar = document.createElement('div');
    bar.className = 'progress';
    const fill = document.createElement('div');
    fill.className = 'progress__bar';
    fill.style.width = `${Math.round((Math.min(line.have, line.need) / line.need) * 100)}%`;
    bar.appendChild(fill);

    row.append(label, bar);
    return row;
  }
}

/** "제련로, 철판" — buildings by their display name, recipes by the item they make. */
function describeUnlocks(seal: SealDef): string {
  const parts: string[] = [];
  for (const id of seal.unlocks.buildings) {
    const def = DEF_MAP.get(id);
    parts.push(def ? displayName(def) : id);
  }
  for (const item of seal.unlocks.recipes) parts.push(itemName(item));
  return parts.join(', ');
}
