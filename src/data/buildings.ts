/**
 * Building definitions (GDD 6.1).
 *
 * Costs, power draw and throughput per tier arrive with M2-M3 — construction costs
 * need plates to exist first, and M1 has only raw ore. Meshes are box placeholders
 * until the art milestone.
 */

import type { BuildingDef } from '../sim/types';

export const BUILDING_DEFS: readonly BuildingDef[] = [
  {
    id: 'hub',
    name: '시브',
    kind: 'hub',
    w: 3,
    h: 3,
    color: 0xd8c98a,
    height: 1.1,
    needsOre: false,
    buildable: false,
    removable: false,
  },
  { id: 'conveyor', name: '컨베이어', kind: 'belt', w: 1, h: 1, color: 0x6f7d8b, height: 0.14, needsOre: false },
  { id: 'miner', name: '채굴기', kind: 'miner', w: 2, h: 2, color: 0xe0a63c, height: 1.3, needsOre: true },
  {
    id: 'smelter',
    name: '제련로',
    kind: 'machine',
    machine: { class: 'smelter', tier: 1 },
    w: 2,
    h: 2,
    color: 0xd9603b,
    height: 1.6,
    needsOre: false,
  },
  {
    id: 'assembler',
    name: '조립기',
    kind: 'machine',
    machine: { class: 'assembler', tier: 1 },
    w: 3,
    h: 3,
    color: 0x4a8fd4,
    height: 1.9,
    needsOre: false,
  },
  { id: 'pole', name: '전력 기둥', kind: 'passive', w: 1, h: 1, color: 0x8fbf6a, height: 2.6, needsOre: false },
];

export const DEF_MAP: ReadonlyMap<string, BuildingDef> = new Map(
  BUILDING_DEFS.map((def) => [def.id, def]),
);

/** What the build bar offers: everything except things the game places itself. */
export const BUILDABLE_DEFS: readonly BuildingDef[] = BUILDING_DEFS.filter(
  (def) => def.buildable !== false,
);
