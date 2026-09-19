/**
 * Core simulation types. No Phaser, no DOM (GDD 14.2) — enforced by
 * `tests/architecture.test.ts`.
 */

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

/** Quarter turns clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

export interface BuildingDef {
  readonly id: string;
  readonly name: string;
  /** Footprint at rotation 0, in tiles. */
  readonly w: number;
  readonly h: number;
  readonly color: number;
  /** Height in world units (1 unit = 1 tile), for the placeholder box mesh. */
  readonly height: number;
  /** Miners must sit on ore (GDD 6.1). */
  readonly needsOre: boolean;
}

export interface PlacedBuilding {
  readonly id: number;
  readonly defId: string;
  /** Minimum-corner tile of the footprint. */
  readonly x: number;
  readonly y: number;
  readonly rot: Rotation;
}

export type PlacementError = 'out-of-bounds' | 'terrain' | 'occupied' | 'needs-ore' | 'unknown-def';

export type PlacementResult = { ok: true } | { ok: false; reason: PlacementError };

export const PLACEMENT_MESSAGE: Readonly<Record<PlacementError, string>> = {
  'out-of-bounds': '맵 밖입니다',
  terrain: '건설할 수 없는 지형입니다',
  occupied: '이미 건물이 있습니다',
  'needs-ore': '광석 위에만 지을 수 있습니다',
  'unknown-def': '알 수 없는 건물입니다',
};

/** Footprint size after rotation. Odd quarter turns swap the axes. */
export function rotatedSize(def: BuildingDef, rot: Rotation): { w: number; h: number } {
  return rot % 2 === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
}
