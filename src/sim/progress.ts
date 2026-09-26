/**
 * Seal progress and what it unlocks (GDD 9).
 *
 * `level` is how many seals are open. The seal after it is the active one, and it
 * opens the moment every requirement is met. Requirements read the hub's *delivered*
 * counters, which are cumulative and which spending stock never lowers (GDD 6.3), so
 * building can never set progress back.
 *
 * Because they are cumulative, an item asked for by two seals is not asked for twice:
 * seal 3 wants iron plates again, but the plates delivered for seal 2 already count.
 * Finishing one seal can therefore finish the next in the same tick.
 */

import { SEALS, START_UNLOCKS } from '../data/seals';
import type { Sieve } from './sieve';
import type { Availability, ItemId, SealDef, SealRequirement, Unlocks } from './types';

/** How far along one requirement is, for the panel. */
export interface RequirementProgress {
  readonly requirement: SealRequirement;
  /** Items delivered (capped at the need), or seconds sustained. */
  readonly have: number;
  /** Items wanted, or seconds to sustain. */
  readonly need: number;
  readonly met: boolean;
}

export class Progress implements Availability {
  /** Seals opened so far, 0..seals.length. */
  level = 0;
  /** Consecutive seconds the active seal's sustained requirement has held. */
  sustainedSeconds = 0;

  /** Called once for each seal as it opens. */
  onComplete: (seal: SealDef) => void = () => {};

  private readonly buildingLevel = new Map<string, number>();
  private readonly recipeLevel = new Map<ItemId, number>();

  constructor(
    private readonly sieve: Sieve,
    readonly seals: readonly SealDef[] = SEALS,
    start: Unlocks = START_UNLOCKS,
  ) {
    for (const id of start.buildings) this.buildingLevel.set(id, 0);
    for (const item of start.recipes) this.recipeLevel.set(item, 0);
    for (const seal of seals) {
      for (const id of seal.unlocks.buildings) this.buildingLevel.set(id, seal.level);
      for (const item of seal.unlocks.recipes) this.recipeLevel.set(item, seal.level);
    }
  }

  /** The seal being worked on, or null once every seal is open. */
  get active(): SealDef | null {
    return this.seals[this.level] ?? null;
  }

  /** Every seal is open. */
  get finished(): boolean {
    return this.level >= this.seals.length;
  }

  /**
   * The seal level at which something unlocks: 0 for what the game starts with, or
   * undefined for something no seal ever unlocks (which nothing may build).
   */
  buildingUnlockLevel(defId: string): number | undefined {
    return this.buildingLevel.get(defId);
  }

  recipeUnlockLevel(item: ItemId): number | undefined {
    return this.recipeLevel.get(item);
  }

  buildingUnlocked(defId: string): boolean {
    const at = this.buildingLevel.get(defId);
    return at !== undefined && at <= this.level;
  }

  recipeUnlocked(item: ItemId): boolean {
    const at = this.recipeLevel.get(item);
    return at !== undefined && at <= this.level;
  }

  /** How far along each requirement of a seal is. */
  progressOf(seal: SealDef): RequirementProgress[] {
    return seal.requires.map((requirement) => {
      if (requirement.kind === 'deliver') {
        const delivered = this.sieve.delivered[requirement.item]!;
        return {
          requirement,
          have: Math.min(delivered, requirement.count),
          need: requirement.count,
          met: delivered >= requirement.count,
        };
      }
      const need = requirement.minutes * 60;
      // Only the seal being worked on has a running count; a later one has not begun.
      const have = seal === this.active ? this.sustainedSeconds : 0;
      return { requirement, have, need, met: have >= need };
    });
  }

  /**
   * Called once per tick, after the hub has taken this tick's deliveries. `atSecond`
   * is true on the tick that ends a whole simulated second, when the sustained rate
   * is sampled.
   */
  step(atSecond: boolean): void {
    if (atSecond) this.sampleSustained();
    // A loop, not an if: a seal already covered by earlier deliveries opens at once.
    while (this.active && this.complete(this.active)) {
      const seal = this.active;
      this.level++;
      this.sustainedSeconds = 0;
      this.onComplete(seal);
    }
  }

  private complete(seal: SealDef): boolean {
    return this.progressOf(seal).every((p) => p.met);
  }

  /**
   * Counts a second toward a sustained requirement if the last full minute met its
   * rate, and starts over if it did not. Nothing counts until a whole minute has been
   * recorded, so the first seconds of a game cannot look like a steady rate.
   *
   * Does nothing when the active seal has no sustained requirement, and does not need
   * to reset `sustainedSeconds` in that case either: `step` already zeroes it the
   * moment any seal opens, and it is otherwise only ever written here, so it cannot
   * be carrying a stale count left over from a different seal.
   */
  private sampleSustained(): void {
    const sustain = this.active?.requires.find(
      (r): r is Extract<SealRequirement, { kind: 'sustain' }> => r.kind === 'sustain',
    );
    if (!sustain) return;
    const lastMinute = this.sieve.deliveredInLastMinute(sustain.item);
    this.sustainedSeconds = lastMinute !== null && lastMinute >= sustain.perMinute ? this.sustainedSeconds + 1 : 0;
  }
}
