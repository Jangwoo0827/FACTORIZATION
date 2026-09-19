/**
 * Placeholder building definitions (GDD 6.1).
 *
 * M0 only needs footprints, colours and the ore constraint so that placement,
 * rotation and validity feedback can be exercised. Costs, power draw and
 * throughput arrive with M1-M3.
 */

import type { BuildingDef } from '../sim/types';

export const BUILDING_DEFS: readonly BuildingDef[] = [
  { id: 'conveyor', name: '컨베이어', w: 1, h: 1, color: 0x8a97a5, lift: 6, needsOre: false },
  { id: 'miner', name: '채굴기', w: 2, h: 2, color: 0xe0a63c, lift: 22, needsOre: true },
  { id: 'smelter', name: '제련로', w: 2, h: 2, color: 0xd9603b, lift: 26, needsOre: false },
  { id: 'assembler', name: '조립기', w: 3, h: 3, color: 0x4a8fd4, lift: 30, needsOre: false },
  { id: 'pole', name: '전력 기둥', w: 1, h: 1, color: 0x8fbf6a, lift: 34, needsOre: false },
];

export const DEF_MAP: ReadonlyMap<string, BuildingDef> = new Map(
  BUILDING_DEFS.map((def) => [def.id, def]),
);
