/**
 * What the factorisation view shows, as plain data (GDD 5.4).
 *
 * The view answers one question: what does it take to make this, at this rate? It
 * shows the item's signature, the recipe tree spelled out down to raw materials, and
 * how many machines each stage needs. Everything is computed here so it can be
 * tested; the panel that draws it has nothing to decide.
 *
 * Pure: no renderer, no DOM.
 */

import { PRIMES, factors, formatSignature, superscript } from './signature';
import type { ItemId, MachineClass, RecipeBook, RecipeDef } from './recipeBook';

/** One prime factor of the signature, with the raw material it stands for. */
export interface FactorChip {
  readonly prime: number;
  readonly exponent: number;
  readonly rawItem: ItemId;
}

/** One line of the ingredient tree, flattened so it can be drawn as an indented list. */
export interface TreeLine {
  readonly depth: number;
  readonly item: ItemId;
  /** How many of it one craft of its parent uses. */
  readonly count: number;
  readonly craftable: boolean;
}

export interface RequirementRow {
  readonly item: ItemId;
  readonly perSecond: number;
  readonly perMinute: number;
  readonly recipe: RecipeDef | null;
  readonly machine: { class: MachineClass; tier: 1 | 2 } | null;
  /** Machines needed, exactly, and rounded up to a whole number. */
  readonly machines: number;
  readonly machinesWhole: number;
  /** For a raw material, miners needed at full coverage; 0 for anything crafted. */
  readonly miners: number;
}

export interface FactorModel {
  readonly item: ItemId;
  readonly perMinute: number;
  readonly signatureText: string;
  readonly chips: readonly FactorChip[];
  /** Raw materials in one item: the sum of the exponents. */
  readonly rawTotal: number;
  /** One level of the recipe as an equation, e.g. `A = B × C × D²`. */
  readonly equation: string;
  readonly tree: readonly TreeLine[];
  readonly rows: readonly RequirementRow[];
}

/**
 * @param nameOf how an item is called on screen
 * @param minerRate items per second one miner makes with its footprint fully on ore
 */
export function buildFactorModel(
  book: RecipeBook,
  item: ItemId,
  perMinute: number,
  nameOf: (item: ItemId) => string,
  minerRate: number,
): FactorModel {
  const signature = book.signature(item);

  const chips: FactorChip[] = [];
  for (const f of factors(signature)) {
    const rawItem = book.rawItemOf(f.index);
    if (rawItem !== undefined) chips.push({ prime: f.prime, exponent: f.exponent, rawItem });
  }

  const tree: TreeLine[] = [];
  const walk = (node: ReturnType<RecipeBook['expand']>, depth: number): void => {
    tree.push({ depth, item: node.item, count: node.count, craftable: node.recipe !== null });
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(book.expand(item), 0);

  const rows: RequirementRow[] = book.requirements(item, perMinute).map((r) => ({
    item: r.item,
    perSecond: r.perSecond,
    perMinute: r.perSecond * 60,
    recipe: r.recipe,
    machine: r.recipe ? { class: r.recipe.machine, tier: r.recipe.tier } : null,
    machines: r.machines,
    // A tiny tolerance so 2.0000000000000004 machines is not rounded up to 3.
    machinesWhole: r.recipe ? Math.ceil(r.machines - 1e-9) : 0,
    miners: r.recipe ? 0 : r.perSecond / minerRate,
  }));

  return {
    item,
    perMinute,
    signatureText: formatSignature(signature),
    chips,
    rawTotal: book.rawTotal(item),
    equation: equationOf(book, item, nameOf),
    tree,
    rows,
  };
}

/** `Gate component = Power core × Logic core × Machine frame²` for the recipe one level down. */
export function equationOf(
  book: RecipeBook,
  item: ItemId,
  nameOf: (item: ItemId) => string,
): string {
  const recipe = book.recipe(item);
  if (!recipe) return `${nameOf(item)} = 소수 ${PRIMES[book.signature(item).findIndex((e) => e > 0)]}`;
  const parts = recipe.inputs.map((i) =>
    i.count === 1 ? nameOf(i.item) : `${nameOf(i.item)}${superscript(i.count)}`,
  );
  return `${nameOf(item)} = ${parts.join(' × ')}`;
}
