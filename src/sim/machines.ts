/**
 * Crafting machines: smelters and assemblers (GDD 6.1, 6.2).
 *
 * A machine takes ingredients from belts that point into it, holds a small buffer of
 * each, crafts one item at a time, and pushes the result onto any adjacent belt that
 * is not pointing back at it. There are no inserters: the belt hands the machine an
 * item directly, or the machine refuses it and the belt waits.
 *
 * Refusing is what makes the design a puzzle rather than a chore. A machine takes
 * only what its recipe needs and only up to twice that, so a belt carrying the wrong
 * item, or too much of the right one, stops at the machine's door and jams everything
 * behind it. Sorting and balancing a mixed belt is left to the player.
 *
 * Crafting is counted in whole ticks. A time in seconds accumulated as a float would
 * drift by a tick here and there, and over a minute that shows up as a machine
 * quietly running a few percent slow.
 */

import { MACHINE_INPUT_MULTIPLE, MACHINE_OUTPUT_CAP, SIM_TPS } from '../config';
import { machineSpeed } from '../data/recipes';
import type { RecipeBook, RecipeDef } from '../factor/recipeBook';
import type { BeltGrid } from './belts';
import { emitToPorts, findPorts, type Port } from './ports';
import { POWER_FULL, type PowerSystem } from './power';
import { ITEM_COUNT, type ItemId, type MachineSpec } from './types';
import type { World } from './world';

/**
 * What a machine is doing, for the player (GDD 6.2).
 *
 *  - `no-recipe`: not set to make anything
 *  - `working`: crafting
 *  - `waiting`: idle for want of an ingredient
 *  - `blocked`: finished goods have nowhere to go
 *  - `no-power`: draws power and is getting none, so it is not doing anything at all.
 *    A brownout that is only slowing it down still reads `working`.
 */
export type MachineStatus = 'no-recipe' | 'working' | 'waiting' | 'blocked' | 'no-power';

export interface MachineState {
  readonly id: number;
  readonly spec: MachineSpec;
  readonly recipe: RecipeDef | null;
  /** Ingredients held, by item id. */
  readonly inputs: Int32Array;
  /** How many of each item one craft uses; zero for anything that is not an ingredient. */
  readonly needs: Int32Array;
  /** Ticks one craft takes at this machine's speed. */
  readonly totalTicks: number;
  crafting: boolean;
  /** Ticks into the current craft. */
  progress: number;
  /** How much of the power it asks for it is getting, 0..POWER_FULL. Always full for Mk1. */
  level: number;
  /**
   * Power earned toward the next tick of work. Each tick adds `level`; a full
   * `POWER_FULL` buys a tick. At full power that is exactly one tick of work per tick,
   * and at 60% it is three ticks of work in every five, with no float to drift.
   */
  credit: number;
  /** Finished items waiting for a belt with room. */
  output: number;
  status: MachineStatus;
  /** Which port goes first next time, so belts share the output evenly. */
  next: number;
  ports: Port[];
}

export class MachineSystem {
  private machines = new Map<number, MachineState>();

  constructor(
    private readonly world: World,
    private readonly belts: BeltGrid,
    private readonly recipes: RecipeBook,
    private readonly power: PowerSystem,
  ) {}

  get count(): number {
    return this.machines.size;
  }

  info(id: number): Readonly<MachineState> | null {
    return this.machines.get(id) ?? null;
  }

  /**
   * Re-derives every machine from the world. A machine whose recipe has not changed
   * keeps its buffers and progress, so editing belts around a working machine does not
   * empty it. Changing the recipe starts it fresh: what it was holding was for
   * something else.
   */
  rebuild(): void {
    const next = new Map<number, MachineState>();

    for (const building of this.world.buildings()) {
      const def = this.world.defOf(building);
      if (!def || def.kind !== 'machine' || !def.machine) continue;

      const recipe = this.usableRecipe(this.world.recipeOf(building.id), def.machine);
      const ports = findPorts(this.world, this.belts, building);
      const old = this.machines.get(building.id);

      if (old && old.recipe?.output === recipe?.output) {
        // `readonly` fields cannot be reassigned, so carry the live counters across.
        const kept = this.create(building.id, def.machine, recipe, ports);
        kept.inputs.set(old.inputs);
        kept.crafting = old.crafting;
        kept.progress = old.progress;
        kept.credit = old.credit;
        kept.output = old.output;
        kept.next = old.next;
        next.set(building.id, kept);
      } else {
        next.set(building.id, this.create(building.id, def.machine, recipe, ports));
      }
    }

    this.machines = next;
  }

  /**
   * Whether a machine takes an item handed to it by a belt.
   *
   * It takes an ingredient of its recipe, and only while it holds less than twice
   * what one craft needs. Anything else is refused and stays on the belt.
   */
  accept(id: number, item: ItemId): boolean {
    const m = this.machines.get(id);
    if (!m || !m.recipe) return false;
    const need = m.needs[item]!;
    if (need === 0) return false;
    if (m.inputs[item]! >= need * MACHINE_INPUT_MULTIPLE) return false;
    m.inputs[item]!++;
    return true;
  }

  step(): void {
    for (const m of this.machines.values()) {
      const recipe = m.recipe;

      m.level = this.power.levelOf(m.id);
      m.credit += m.level;
      // Whether this tick is one the machine gets to work in. Unpowered, no credit
      // arrives; slowed, a tick's worth arrives only some of the time.
      const works = m.credit >= POWER_FULL;
      if (works) m.credit -= POWER_FULL;

      if (recipe && works) {
        if (m.crafting) {
          m.progress++;
          if (m.progress >= m.totalTicks) {
            m.crafting = false;
            m.output++;
          }
        }
        // Checked in the same tick a craft finishes, so back-to-back crafts run
        // exactly `totalTicks` apart with no idle tick between them.
        if (!m.crafting && m.output < MACHINE_OUTPUT_CAP && this.hasIngredients(m)) {
          for (let i = 0; i < ITEM_COUNT; i++) m.inputs[i]! -= m.needs[i]!;
          m.crafting = true;
          m.progress = 0;
        }
      }

      // Goods can still leave after the recipe was cleared, so this is not gated on it.
      if (m.output > 0 && m.ports.length > 0) this.emit(m);

      m.status = !recipe
        ? 'no-recipe'
        : m.level === 0
          ? 'no-power'
          : m.crafting
            ? 'working'
            : m.output >= MACHINE_OUTPUT_CAP
              ? 'blocked'
              : 'waiting';
    }
  }

  private emit(m: MachineState): void {
    // With a recipe cleared mid-run the item's identity is the old recipe's output;
    // `create` resets state on a recipe change, so a live recipe is what made it.
    const item = m.recipe?.output;
    if (item === undefined) return;
    const next = emitToPorts(this.belts, m.ports, m.next, item);
    if (next === -1) return;
    m.output--;
    m.next = next;
  }

  private hasIngredients(m: MachineState): boolean {
    for (let i = 0; i < ITEM_COUNT; i++) {
      if (m.inputs[i]! < m.needs[i]!) return false;
    }
    return true;
  }

  /** A recipe this machine can actually run, or null if it is unset or out of its class or tier. */
  private usableRecipe(item: ItemId, spec: MachineSpec): RecipeDef | null {
    if (item === 0) return null;
    const recipe = this.recipes.recipe(item);
    if (!recipe) return null;
    if (recipe.machine !== spec.class || recipe.tier > spec.tier) return null;
    return recipe;
  }

  private create(id: number, spec: MachineSpec, recipe: RecipeDef | null, ports: Port[]): MachineState {
    const needs = new Int32Array(ITEM_COUNT);
    if (recipe) for (const { item, count } of recipe.inputs) needs[item] = count;

    const speed = machineSpeed(spec.class, spec.tier);
    return {
      id,
      spec,
      recipe,
      inputs: new Int32Array(ITEM_COUNT),
      needs,
      totalTicks: recipe ? Math.max(1, Math.round((recipe.seconds * SIM_TPS) / speed)) : 0,
      crafting: false,
      progress: 0,
      level: POWER_FULL,
      credit: 0,
      output: 0,
      status: recipe ? 'waiting' : 'no-recipe',
      next: 0,
      ports,
    };
  }
}
