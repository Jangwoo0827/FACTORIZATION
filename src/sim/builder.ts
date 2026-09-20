/**
 * Building and demolishing, with what it costs (GDD 6.1, 6.3).
 *
 * Sits between the player's commands and the world so that the hub's stock and the
 * buildings on the map cannot drift apart. Every way of adding a building takes its
 * price, every way of removing one gives it back, and either can be refused.
 *
 * The rule that keeps the economy honest: **nothing here can be undone for free.**
 * Removing a building refunds it in full, so putting it back must cost the same
 * again. If undo were free, "remove, then undo" would print money. If the stock has
 * been spent in between, putting it back fails and the undo fails with it.
 */

import type { Sieve } from './sieve';
import type { Cost, PlacedBuilding, PlacementResult, Rotation } from './types';
import type { World } from './world';

export class Builder {
  constructor(
    readonly world: World,
    private readonly sieve: Sieve,
  ) {}

  /** What a building costs. Free (empty) for anything without a price, such as the hub. */
  costOf(defId: string): readonly Cost[] {
    return this.world.defById(defId)?.cost ?? NO_COST;
  }

  /**
   * Whether a building could be placed here: the world's rules first, then whether
   * the stock covers it. Reports the first thing wrong, which is what the player
   * needs to fix first.
   */
  checkPlacement(defId: string, x: number, y: number, rot: Rotation): PlacementResult {
    const result = this.world.checkPlacement(defId, x, y, rot);
    if (!result.ok) return result;
    if (!this.sieve.canAfford(this.costOf(defId))) return { ok: false, reason: 'cannot-afford' };
    return { ok: true };
  }

  /** What is missing to afford a building, or null if nothing is. */
  shortfall(defId: string): { item: number; need: number; have: number } | null {
    return this.sieve.shortfall(this.costOf(defId));
  }

  canAfford(defId: string): boolean {
    return this.sieve.canAfford(this.costOf(defId));
  }

  /** Places and pays for a new building, or does neither and returns null. */
  place(defId: string, x: number, y: number, rot: Rotation): PlacedBuilding | null {
    if (!this.checkPlacement(defId, x, y, rot).ok) return null;
    const placed = this.world.place(defId, x, y, rot);
    if (placed) this.sieve.spend(this.costOf(defId));
    return placed;
  }

  /**
   * Puts back a building that was removed, keeping its id, and charges for it again.
   * Returns false, changing nothing, if it no longer fits or can no longer be afforded.
   */
  insert(building: PlacedBuilding): boolean {
    const cost = this.costOf(building.defId);
    if (!this.sieve.canAfford(cost)) return false;
    if (!this.world.insert(building)) return false;
    this.sieve.spend(cost);
    return true;
  }

  /** Removes a building and refunds its full price. Returns it, or null if it cannot be removed. */
  remove(id: number): PlacedBuilding | null {
    const building = this.world.buildingById(id);
    if (!building) return null;
    if (this.world.defOf(building)?.removable === false) return null;

    const removed = this.world.removeById(id);
    if (removed) this.sieve.refund(this.costOf(removed.defId));
    return removed;
  }
}

const NO_COST: readonly Cost[] = [];
