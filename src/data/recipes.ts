/**
 * Every recipe (GDD 5.5), and the recipe book built from them.
 *
 * Each item has exactly one recipe, so the item a machine is set to make is enough
 * to identify the recipe: there is no separate recipe id.
 *
 * Rule R1 applies to every entry: one craft makes one item. That is why copper wire
 * is one plate for one wire rather than one plate for two, and why the machines that
 * make short-lived intermediates are quick (GDD 5.2).
 */

import { RecipeBook, type MachineClass, type RecipeDef } from '../factor/recipeBook';
import { Item } from './items';

const { IronOre, CopperOre, Coal, Stone, Sand, Quartz } = Item;

export const RECIPES: readonly RecipeDef[] = [
  { output: Item.IronPlate, inputs: [{ item: IronOre, count: 1 }], seconds: 1.6, machine: 'smelter', tier: 1 },
  { output: Item.CopperPlate, inputs: [{ item: CopperOre, count: 1 }], seconds: 1.6, machine: 'smelter', tier: 1 },
  { output: Item.CopperWire, inputs: [{ item: Item.CopperPlate, count: 1 }], seconds: 0.5, machine: 'assembler', tier: 1 },
  { output: Item.Gear, inputs: [{ item: Item.IronPlate, count: 2 }], seconds: 1.0, machine: 'assembler', tier: 1 },
  { output: Item.StoneBrick, inputs: [{ item: Stone, count: 2 }], seconds: 2.0, machine: 'smelter', tier: 1 },
  {
    output: Item.Circuit,
    inputs: [
      { item: Item.IronPlate, count: 1 },
      { item: Item.CopperWire, count: 2 },
    ],
    seconds: 2.0,
    machine: 'assembler',
    tier: 1,
  },
  {
    output: Item.Steel,
    inputs: [
      { item: Item.IronPlate, count: 2 },
      { item: Coal, count: 1 },
    ],
    seconds: 4.0,
    machine: 'smelter',
    tier: 2,
  },
  {
    output: Item.Silicon,
    inputs: [
      { item: Sand, count: 2 },
      { item: Coal, count: 1 },
    ],
    seconds: 3.0,
    machine: 'smelter',
    tier: 2,
  },
  {
    output: Item.Motor,
    inputs: [
      { item: Item.Steel, count: 1 },
      { item: Item.Gear, count: 2 },
      { item: Item.CopperWire, count: 2 },
    ],
    seconds: 3.0,
    machine: 'assembler',
    tier: 1,
  },
  {
    output: Item.MachineFrame,
    inputs: [
      { item: Item.Steel, count: 2 },
      { item: Item.StoneBrick, count: 4 },
    ],
    seconds: 4.0,
    machine: 'assembler',
    tier: 1,
  },
  {
    output: Item.Battery,
    inputs: [
      { item: Item.CopperPlate, count: 3 },
      { item: Item.Silicon, count: 2 },
    ],
    seconds: 4.0,
    machine: 'assembler',
    tier: 1,
  },
  {
    output: Item.AdvancedCircuit,
    inputs: [
      { item: Item.Circuit, count: 2 },
      { item: Item.Silicon, count: 2 },
      { item: Item.CopperWire, count: 2 },
    ],
    seconds: 5.0,
    machine: 'assembler',
    tier: 1,
  },
  { output: Item.OpticLens, inputs: [{ item: Quartz, count: 2 }], seconds: 3.0, machine: 'smelter', tier: 2 },
  {
    output: Item.Processor,
    inputs: [
      { item: Item.AdvancedCircuit, count: 2 },
      { item: Item.Silicon, count: 2 },
      { item: Item.CopperWire, count: 2 },
    ],
    seconds: 8.0,
    machine: 'assembler',
    tier: 2,
  },
  {
    output: Item.PowerCore,
    inputs: [
      { item: Item.Battery, count: 4 },
      { item: Item.Motor, count: 2 },
      { item: Item.Steel, count: 2 },
    ],
    seconds: 10,
    machine: 'assembler',
    tier: 2,
  },
  {
    output: Item.LogicCore,
    inputs: [
      { item: Item.Processor, count: 4 },
      { item: Item.OpticLens, count: 2 },
    ],
    seconds: 12,
    machine: 'assembler',
    tier: 2,
  },
  {
    output: Item.GateComponent,
    inputs: [
      { item: Item.PowerCore, count: 1 },
      { item: Item.LogicCore, count: 1 },
      { item: Item.MachineFrame, count: 2 },
    ],
    seconds: 20,
    machine: 'assembler',
    tier: 2,
  },
];

/** Which prime each raw material is (GDD 5.1), as an index into `PRIMES`. */
export const RAW_PRIME_INDEX: ReadonlyMap<number, number> = new Map([
  [IronOre, 0], // 2
  [CopperOre, 1], // 3
  [Coal, 2], // 5
  [Stone, 3], // 7
  [Sand, 4], // 11
  [Quartz, 5], // 13
]);

/** Machine speed multipliers by class and tier (GDD 6.1). */
export function machineSpeed(machine: MachineClass, tier: 1 | 2): number {
  if (machine === 'smelter') return tier === 1 ? 1 : 2;
  return tier === 1 ? 1 : 1.5;
}

/**
 * Built at load. A recipe that breaks the signature rules throws here, at import,
 * rather than surfacing later as a wrong number somewhere in the UI.
 */
export const RECIPE_BOOK = new RecipeBook(RECIPES, RAW_PRIME_INDEX, machineSpeed);
