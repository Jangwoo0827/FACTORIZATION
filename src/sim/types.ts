/**
 * Core simulation types. No Phaser, no DOM (GDD 14.2) — enforced by
 * `tests/architecture.test.ts`.
 */

import type { MachineClass } from '../factor/recipeBook';

export const Terrain = {
  Plain: 0,
  Water: 1,
  Rock: 2,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const Ore = {
  None: 0,
  Iron: 1,
  Copper: 2,
  Coal: 3,
  Stone: 4,
  Sand: 5,
  Quartz: 6,
} as const;
export type Ore = (typeof Ore)[keyof typeof Ore];

export interface OreInfo {
  readonly name: string;
  /** The raw material's prime (GDD 5.1). Ordered so scarcer resources get larger primes. */
  readonly prime: number;
  readonly color: number;
}

export const ORE_INFO: Readonly<Record<Exclude<Ore, 0>, OreInfo>> = {
  [Ore.Iron]: { name: '철광석', prime: 2, color: 0xb6603f },
  [Ore.Copper]: { name: '구리광석', prime: 3, color: 0xd98b4a },
  [Ore.Coal]: { name: '석탄', prime: 5, color: 0x39404a },
  [Ore.Stone]: { name: '돌', prime: 7, color: 0x8d8b82 },
  [Ore.Sand]: { name: '모래', prime: 11, color: 0xc9bd8a },
  [Ore.Quartz]: { name: '석영', prime: 13, color: 0x9fd0d6 },
};

/**
 * Items are small integers. Raw materials reuse their `Ore` value, so an item id and
 * the ore it was mined from are the same number until processed goods arrive in M2.
 */
export type ItemId = number;

/**
 * Highest item id + 1: the size of any per-item lookup table. Raw materials are ids
 * 1-6 (the `Ore` values) and crafted items run 7-23; `data/items.ts` lists them and
 * a test keeps this in step.
 */
export const ITEM_COUNT = 24;

/** Quarter turns. See `core/dir.ts` for what each value points at. */
export type Rotation = 0 | 1 | 2 | 3;

/** What a building does in the simulation. Rendering and rules key off this, not the id. */
export type BuildingKind =
  | 'hub'
  | 'belt'
  | 'splitter'
  | 'tunnel-in'
  | 'tunnel-out'
  | 'miner'
  | 'machine'
  | 'generator'
  | 'pole'
  | 'passive';

/** An amount of one item: a price, or one line of a recipe. */
export interface Cost {
  readonly item: ItemId;
  readonly count: number;
}

/** Kinds that carry items along a direction the way a conveyor does. */
export function isBeltKind(kind: BuildingKind): boolean {
  return kind === 'belt' || kind === 'tunnel-in' || kind === 'tunnel-out';
}

/** What a crafting machine is: which recipes it can run, and how fast. */
export interface MachineSpec {
  readonly class: MachineClass;
  readonly tier: 1 | 2;
}

/** How a miner digs: which tier it is and how much ore each tile under it yields per second. */
export interface MinerSpec {
  readonly tier: 1 | 2;
  readonly ratePerTile: number;
}

/** A generator burns one fuel item at a time and gives `output` power while it burns (GDD 8). */
export interface GeneratorSpec {
  readonly output: number;
  readonly fuel: ItemId;
  readonly burnSeconds: number;
}

/** A power pole joins everything within `range` tiles to one grid (GDD 8). */
export interface PoleSpec {
  readonly range: number;
}

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  readonly kind: BuildingKind;
  /** Present on `machine` buildings. */
  readonly machine?: MachineSpec;
  /** Present on `miner` buildings. */
  readonly miner?: MinerSpec;
  /** Present on `generator` buildings. */
  readonly generator?: GeneratorSpec;
  /** Present on `pole` buildings. */
  readonly pole?: PoleSpec;
  /**
   * Power this building consumes while placed, in PU. Absent means it needs none, which
   * is every Mk1 building (GDD 8: physics first, power as the upgrade).
   */
  readonly draw?: number;
  /** What it costs to build, taken from the hub's stock. Free when absent. */
  readonly cost?: readonly Cost[];
  /** Footprint at rotation 0, in tiles. */
  readonly w: number;
  readonly h: number;
  readonly color: number;
  /** Height in world units (1 unit = 1 tile), for the placeholder box mesh. */
  readonly height: number;
  /** Miners must sit on ore (GDD 6.1). */
  readonly needsOre: boolean;
  /** Offered in the build bar. Defaults to true; the hub is placed by the game, not the player. */
  readonly buildable?: boolean;
  /** Can be erased. Defaults to true. */
  readonly removable?: boolean;
}

export interface PlacedBuilding {
  readonly id: number;
  readonly defId: string;
  /** Minimum-corner tile of the footprint. */
  readonly x: number;
  readonly y: number;
  readonly rot: Rotation;
}

export type PlacementError =
  | 'out-of-bounds'
  | 'terrain'
  | 'occupied'
  | 'needs-ore'
  | 'unknown-def'
  | 'locked'
  | 'cannot-afford';

export type PlacementResult = { ok: true } | { ok: false; reason: PlacementError };

export const PLACEMENT_MESSAGE: Readonly<Record<PlacementError, string>> = {
  'out-of-bounds': '맵 밖입니다',
  terrain: '건설할 수 없는 지형입니다',
  occupied: '이미 건물이 있습니다',
  'needs-ore': '광석 위에만 지을 수 있습니다',
  'unknown-def': '알 수 없는 건물입니다',
  locked: '아직 해금되지 않았습니다',
  'cannot-afford': '재고가 부족합니다',
};

/**
 * What a seal asks for (GDD 9).
 *
 *  - `deliver`: this many of an item delivered to the hub in total. Cumulative, and
 *    never reduced by spending stock, so building cannot set progress back.
 *  - `sustain`: keep delivering at least `perMinute` of an item, every minute, for
 *    `minutes` minutes running. A dip resets the count.
 */
export type SealRequirement =
  | { readonly kind: 'deliver'; readonly item: ItemId; readonly count: number }
  | { readonly kind: 'sustain'; readonly item: ItemId; readonly perMinute: number; readonly minutes: number };

/** What completing a seal makes available. Buildings by id, recipes by the item they make. */
export interface Unlocks {
  readonly buildings: readonly string[];
  readonly recipes: readonly ItemId[];
}

export interface SealDef {
  /** 1-based; a seal opens only once the one before it has. */
  readonly level: number;
  /** All of these must be met. */
  readonly requires: readonly SealRequirement[];
  readonly unlocks: Unlocks;
}

/** What the player may build and which recipes they may set. */
export interface Availability {
  buildingUnlocked(defId: string): boolean;
  recipeUnlocked(item: ItemId): boolean;
}

/** Everything available: for tests and tools that are not playing the progression. */
export const EVERYTHING_UNLOCKED: Availability = {
  buildingUnlocked: () => true,
  recipeUnlocked: () => true,
};

/** Footprint size after rotation. Odd quarter turns swap the axes. */
export function rotatedSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  return rot % 2 === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}
