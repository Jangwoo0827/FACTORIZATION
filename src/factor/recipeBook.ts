/**
 * The recipe graph, and everything that can be derived from it (GDD 5).
 *
 * Built once from a list of recipes. Construction checks the rules the prime
 * signature system depends on, so a recipe that would break them cannot be loaded:
 *
 *  - **R1: every recipe makes exactly one item.** There is no output-count field at
 *    all, so a recipe that makes two is not merely rejected but unwritable. If
 *    outputs could be greater than one, exponents would become fractions and the
 *    factorisation would stop being a factorisation.
 *  - each item has one recipe, and no item is both raw and crafted
 *  - every ingredient is a raw material or something with a recipe
 *  - amounts are positive whole numbers
 *  - nothing is made from itself, directly or through a chain
 *
 * Pure: no renderer, no DOM.
 */

import {
  PRIME_COUNT,
  multiply,
  power,
  primeSignature,
  totalExponent,
  type Signature,
} from './signature';

export type ItemId = number;

export type MachineClass = 'smelter' | 'assembler';

export interface Ingredient {
  readonly item: ItemId;
  readonly count: number;
}

/**
 * How one item is made.
 *
 * Deliberately has no `outputCount`: making exactly one item per craft is rule R1.
 */
export interface RecipeDef {
  readonly output: ItemId;
  readonly inputs: readonly Ingredient[];
  /** Craft time in seconds at machine speed 1. */
  readonly seconds: number;
  readonly machine: MachineClass;
  /** Lowest machine tier that can make it (GDD 6.1: Mk1, Mk2). */
  readonly tier: 1 | 2;
}

/** A node in the expanded ingredient tree of an item. */
export interface FactorNode {
  readonly item: ItemId;
  /** How many of this are used per single craft of its parent. 1 for the root. */
  readonly count: number;
  readonly recipe: RecipeDef | null;
  readonly children: readonly FactorNode[];
}

/** What it takes to make an item at a given rate. One row per distinct item in its tree. */
export interface Requirement {
  readonly item: ItemId;
  /** Items per second the whole chain needs of this item. */
  readonly perSecond: number;
  /** The recipe that makes it, or null for a raw material. */
  readonly recipe: RecipeDef | null;
  /** Exact number of machines needed (fractional), or 0 for a raw material. */
  readonly machines: number;
}

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeError';
  }
}

export class RecipeBook {
  private readonly recipes = new Map<ItemId, RecipeDef>();
  private readonly signatures = new Map<ItemId, Signature>();
  private readonly rawItems: ReadonlySet<ItemId>;
  private readonly order: ItemId[] = [];

  /**
   * @param recipes every recipe
   * @param rawPrimeIndex for each raw material, which prime (index into `PRIMES`) it is
   * @param speed machine speed multiplier by class and tier, for machine counts
   */
  constructor(
    recipes: readonly RecipeDef[],
    private readonly rawPrimeIndex: ReadonlyMap<ItemId, number>,
    private readonly speed: (machine: MachineClass, tier: 1 | 2) => number = () => 1,
  ) {
    this.rawItems = new Set(rawPrimeIndex.keys());

    const seenPrimes = new Set<number>();
    for (const [item, index] of rawPrimeIndex) {
      if (!Number.isInteger(index) || index < 0 || index >= PRIME_COUNT) {
        throw new RecipeError(`raw item ${item} has prime index ${index}, outside 0..${PRIME_COUNT - 1}`);
      }
      if (seenPrimes.has(index)) {
        throw new RecipeError(`prime index ${index} is assigned to more than one raw material`);
      }
      seenPrimes.add(index);
    }

    for (const recipe of recipes) {
      if (this.rawItems.has(recipe.output)) {
        throw new RecipeError(`item ${recipe.output} is both a raw material and crafted`);
      }
      if (this.recipes.has(recipe.output)) {
        throw new RecipeError(`item ${recipe.output} has more than one recipe`);
      }
      if (!(recipe.seconds > 0)) {
        throw new RecipeError(`recipe for ${recipe.output} must take positive time`);
      }
      if (recipe.inputs.length === 0) {
        throw new RecipeError(`recipe for ${recipe.output} has no ingredients`);
      }
      const used = new Set<ItemId>();
      for (const { item, count } of recipe.inputs) {
        if (!Number.isInteger(count) || count < 1) {
          throw new RecipeError(`recipe for ${recipe.output} uses ${count} of item ${item}`);
        }
        if (used.has(item)) {
          throw new RecipeError(`recipe for ${recipe.output} lists item ${item} twice`);
        }
        used.add(item);
      }
      this.recipes.set(recipe.output, recipe);
    }

    for (const recipe of this.recipes.values()) {
      for (const { item } of recipe.inputs) {
        if (!this.rawItems.has(item) && !this.recipes.has(item)) {
          throw new RecipeError(`recipe for ${recipe.output} needs item ${item}, which nothing makes`);
        }
      }
    }

    this.computeSignatures();
  }

  /** Every craftable item, ingredients before the things made from them. */
  get craftable(): readonly ItemId[] {
    return this.order;
  }

  isRaw(item: ItemId): boolean {
    return this.rawItems.has(item);
  }

  /** The raw material that is the prime at `index`, or undefined if none is. */
  rawItemOf(primeIndex: number): ItemId | undefined {
    for (const [item, index] of this.rawPrimeIndex) if (index === primeIndex) return item;
    return undefined;
  }

  recipe(item: ItemId): RecipeDef | undefined {
    return this.recipes.get(item);
  }

  /** Every recipe a given machine class and tier can run. */
  recipesFor(machine: MachineClass, tier: number): RecipeDef[] {
    return this.order
      .map((item) => this.recipes.get(item)!)
      .filter((r) => r.machine === machine && r.tier <= tier);
  }

  signature(item: ItemId): Signature {
    const sig = this.signatures.get(item);
    if (!sig) throw new RecipeError(`item ${item} is not in the recipe book`);
    return sig;
  }

  /** Raw materials in one item, read from its signature. */
  rawCost(item: ItemId): Map<ItemId, number> {
    const sig = this.signature(item);
    const out = new Map<ItemId, number>();
    for (const [rawItem, index] of this.rawPrimeIndex) {
      if (sig[index]! > 0) out.set(rawItem, sig[index]!);
    }
    return out;
  }

  /** Total raw materials in one item: the sum of its exponents. */
  rawTotal(item: ItemId): number {
    return totalExponent(this.signature(item));
  }

  /** The ingredient tree of an item, expanded all the way down to raw materials. */
  expand(item: ItemId): FactorNode {
    return this.expandNode(item, 1);
  }

  /**
   * Everything needed to make `perMinute` of an item, per distinct item in its tree.
   *
   * An item that appears in several places in the tree is summed into one row, since
   * one set of machines can serve every place that needs it. Rows come back
   * ingredient-first, raw materials before crafted items.
   */
  requirements(item: ItemId, perMinute: number): Requirement[] {
    if (!(perMinute > 0)) throw new RangeError('rate must be positive');

    const rates = new Map<ItemId, number>();
    const visit = (id: ItemId, perSecond: number): void => {
      rates.set(id, (rates.get(id) ?? 0) + perSecond);
      const recipe = this.recipes.get(id);
      if (!recipe) return;
      // One craft makes one item (R1), so crafts per second equals items per second.
      for (const { item: input, count } of recipe.inputs) visit(input, perSecond * count);
    };
    visit(item, perMinute / 60);

    const rows: Requirement[] = [];
    for (const [id, perSecond] of rates) {
      const recipe = this.recipes.get(id) ?? null;
      const machines = recipe ? (perSecond * recipe.seconds) / this.speed(recipe.machine, recipe.tier) : 0;
      rows.push({ item: id, perSecond, recipe, machines });
    }

    const position = new Map(this.order.map((id, i) => [id, i]));
    rows.sort((a, b) => {
      const ra = a.recipe ? 1 : 0;
      const rb = b.recipe ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return (position.get(a.item) ?? a.item) - (position.get(b.item) ?? b.item);
    });
    return rows;
  }

  private expandNode(item: ItemId, count: number): FactorNode {
    const recipe = this.recipes.get(item) ?? null;
    return {
      item,
      count,
      recipe,
      children: recipe ? recipe.inputs.map((i) => this.expandNode(i.item, i.count)) : [],
    };
  }

  /**
   * Fills in every signature, ingredients first. Doubles as the cycle check: an item
   * that is still waiting when no more can be resolved is part of a loop.
   */
  private computeSignatures(): void {
    for (const [item, index] of this.rawPrimeIndex) {
      this.signatures.set(item, primeSignature(index));
    }

    const pending = new Set(this.recipes.keys());
    while (pending.size > 0) {
      let progressed = false;
      // Iterated in insertion order so the resulting order is stable and readable.
      for (const item of [...pending]) {
        const recipe = this.recipes.get(item)!;
        if (!recipe.inputs.every((i) => this.signatures.has(i.item))) continue;

        let sig: Signature = new Int32Array(PRIME_COUNT);
        for (const { item: input, count } of recipe.inputs) {
          sig = multiply(sig, power(this.signatures.get(input)!, count));
        }
        this.signatures.set(item, sig);
        this.order.push(item);
        pending.delete(item);
        progressed = true;
      }
      if (!progressed) {
        throw new RecipeError(
          `recipes form a loop; involved: ${[...pending].join(', ')}`,
        );
      }
    }
  }
}
