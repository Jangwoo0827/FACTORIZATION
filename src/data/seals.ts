/**
 * The twenty seals (GDD 9) and what each one unlocks.
 *
 * Progression is by delivery to the hub, not a tech tree. A seal asks for items in
 * plain terms ("50 iron plates") and carries a lock number, the product of every
 * requested item's signature raised to how many are wanted. The lock number is
 * computed from the requirements below rather than stored, so retuning a quantity
 * keeps it right.
 *
 * Differences from the GDD table, all forced by one rule the table did not keep: **a
 * seal must be completable with what the seals before it unlock.** The GDD asked for
 * stone bricks at seal 6 but did not unlock their recipe anywhere earlier, and the
 * same for motors, machine frames, batteries, lenses, processors and power cores. Each
 * of those recipes now unlocks one seal before the seal that asks for it. `seals.test`
 * checks the rule for every seal, so a retune cannot quietly break it.
 *
 * Not built yet, so not listed: the crossing junction, the sorter, conveyor Mk2 and
 * Mk3, miner Mk3, solar panel and battery bank. They join the seals that named them
 * when they exist.
 */

import type { SealDef, SealRequirement, Unlocks } from '../sim/types';
import { multiply, power, unit, PRIMES, type Signature } from '../factor/signature';
import { Item } from './items';
import { RECIPE_BOOK } from './recipes';

/** Available from the first second. Everything else waits behind a seal. */
export const START_UNLOCKS: Unlocks = {
  buildings: ['conveyor', 'miner'],
  recipes: [],
};

const deliver = (item: number, count: number): SealRequirement => ({ kind: 'deliver', item, count });

export const SEALS: readonly SealDef[] = [
  // Phase 1: getting started.
  { level: 1, requires: [deliver(Item.IronOre, 30)], unlocks: { buildings: ['smelter'], recipes: [Item.IronPlate, Item.CopperPlate] } },
  { level: 2, requires: [deliver(Item.IronPlate, 50)], unlocks: { buildings: ['splitter'], recipes: [] } },
  {
    level: 3,
    requires: [deliver(Item.IronPlate, 50), deliver(Item.CopperPlate, 50)],
    unlocks: { buildings: ['assembler'], recipes: [Item.CopperWire, Item.Gear] },
  },
  {
    level: 4,
    requires: [deliver(Item.Gear, 30), deliver(Item.CopperWire, 60)],
    unlocks: { buildings: ['tunnel-in', 'tunnel-out'], recipes: [Item.Circuit] },
  },

  // Phase 2: power.
  {
    level: 5,
    requires: [deliver(Item.Circuit, 30), deliver(Item.Coal, 100)],
    unlocks: { buildings: ['generator', 'pole'], recipes: [Item.StoneBrick] },
  },
  {
    level: 6,
    requires: [deliver(Item.StoneBrick, 50)],
    unlocks: { buildings: ['miner-mk2', 'smelter-mk2'], recipes: [Item.Steel] },
  },
  { level: 7, requires: [deliver(Item.Steel, 40)], unlocks: { buildings: ['assembler-mk2'], recipes: [Item.Motor] } },
  { level: 8, requires: [deliver(Item.Motor, 20)], unlocks: { buildings: [], recipes: [Item.MachineFrame] } },

  // Phase 3: industry.
  {
    level: 9,
    requires: [deliver(Item.MachineFrame, 15), deliver(Item.Sand, 100)],
    unlocks: { buildings: [], recipes: [Item.Silicon] },
  },
  { level: 10, requires: [deliver(Item.Silicon, 60)], unlocks: { buildings: [], recipes: [Item.AdvancedCircuit] } },
  {
    level: 11,
    requires: [deliver(Item.AdvancedCircuit, 30), deliver(Item.Motor, 30)],
    unlocks: { buildings: [], recipes: [Item.Battery] },
  },
  { level: 12, requires: [deliver(Item.Battery, 20)], unlocks: { buildings: [], recipes: [] } },

  // Phase 4: high tech.
  {
    level: 13,
    requires: [deliver(Item.Quartz, 100)],
    unlocks: { buildings: ['pole-long'], recipes: [Item.OpticLens, Item.Processor] },
  },
  { level: 14, requires: [deliver(Item.Processor, 20)], unlocks: { buildings: [], recipes: [] } },
  {
    level: 15,
    requires: [deliver(Item.OpticLens, 30), deliver(Item.Processor, 30)],
    unlocks: { buildings: [], recipes: [Item.PowerCore] },
  },
  { level: 16, requires: [deliver(Item.PowerCore, 5)], unlocks: { buildings: [], recipes: [Item.LogicCore] } },

  // Phase 5: the gate.
  { level: 17, requires: [deliver(Item.LogicCore, 5)], unlocks: { buildings: [], recipes: [Item.GateComponent] } },
  { level: 18, requires: [deliver(Item.GateComponent, 5)], unlocks: { buildings: [], recipes: [] } },
  { level: 19, requires: [deliver(Item.GateComponent, 20)], unlocks: { buildings: [], recipes: [] } },
  {
    level: 20,
    requires: [{ kind: 'sustain', item: Item.GateComponent, perMinute: 6, minutes: 5 }],
    unlocks: { buildings: [], recipes: [] },
  },
];

/** How many items a requirement stands for in the lock number. */
export function requirementQuantity(req: SealRequirement): number {
  return req.kind === 'deliver' ? req.count : req.perMinute * req.minutes;
}

/** The seal's lock number: every requested item's signature to the power of how many. */
export function lockOf(seal: SealDef): Signature {
  let lock: Signature = unit();
  for (const req of seal.requires) {
    lock = multiply(lock, power(RECIPE_BOOK.signature(req.item), requirementQuantity(req)));
  }
  return lock;
}

/**
 * The primes a seal is the first to ask about, as indices into `PRIMES`.
 *
 * This is how the game teaches the theme: a seal that brings in a prime nobody has
 * asked for yet announces it ("a new prime: 5"). Worked out from the requirements, so
 * it matches the GDD's phase table without a second copy of it to keep in step.
 */
export function newPrimesOf(level: number, seals: readonly SealDef[] = SEALS): number[] {
  const seen = new Set<number>();
  const primesOf = (seal: SealDef): number[] => {
    const out = new Set<number>();
    for (const req of seal.requires) {
      const sig = RECIPE_BOOK.signature(req.item);
      for (let i = 0; i < PRIMES.length; i++) if (sig[i]! > 0) out.add(i);
    }
    return [...out];
  };

  for (const seal of seals) {
    if (seal.level >= level) break;
    for (const p of primesOf(seal)) seen.add(p);
  }
  const here = seals.find((s) => s.level === level);
  return here ? primesOf(here).filter((p) => !seen.has(p)).sort((a, b) => a - b) : [];
}
