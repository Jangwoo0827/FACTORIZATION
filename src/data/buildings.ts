/**
 * Building definitions (GDD 6.1). Meshes are box placeholders until the art milestone.
 *
 * Mk1 buildings draw no power; Mk2 ones do (GDD 8), so power arrives as an upgrade
 * after logistics has been learned rather than as a gate in front of it.
 */

import { MINER_MK1_RATE_PER_TILE, MINER_MK2_RATE_PER_TILE } from '../config';
import type { BuildingDef, Cost } from '../sim/types';
import { Item } from './items';

const plates = (count: number): Cost => ({ item: Item.IronPlate, count });
const copper = (count: number): Cost => ({ item: Item.CopperPlate, count });
const stone = (count: number): Cost => ({ item: Item.Stone, count });
const circuits = (count: number): Cost => ({ item: Item.Circuit, count });
const gears = (count: number): Cost => ({ item: Item.Gear, count });
const bricks = (count: number): Cost => ({ item: Item.StoneBrick, count });
const motors = (count: number): Cost => ({ item: Item.Motor, count });
const steel = (count: number): Cost => ({ item: Item.Steel, count });

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
  { id: 'conveyor', name: '컨베이어', kind: 'belt', cost: [plates(1)], w: 1, h: 1, color: 0x6f7d8b, height: 0.14, needsOre: false },
  { id: 'splitter', name: '분배기', kind: 'splitter', cost: [plates(3)], w: 1, h: 1, color: 0x58c2c8, height: 0.34, needsOre: false },
  { id: 'tunnel-in', name: '언더패스 입구', kind: 'tunnel-in', cost: [plates(4)], w: 1, h: 1, color: 0x4a5561, height: 0.14, needsOre: false },
  { id: 'tunnel-out', name: '언더패스 출구', kind: 'tunnel-out', cost: [plates(4)], w: 1, h: 1, color: 0x4a5561, height: 0.14, needsOre: false },
  {
    id: 'miner',
    name: '채굴기',
    kind: 'miner',
    miner: { tier: 1, ratePerTile: MINER_MK1_RATE_PER_TILE },
    cost: [plates(8)],
    w: 2,
    h: 2,
    color: 0xe0a63c,
    height: 1.3,
    needsOre: true,
  },
  {
    id: 'miner-mk2',
    name: '채굴기',
    kind: 'miner',
    miner: { tier: 2, ratePerTile: MINER_MK2_RATE_PER_TILE },
    draw: 2,
    cost: [circuits(5), plates(15), gears(5)],
    w: 2,
    h: 2,
    color: 0xf2c14e,
    height: 1.5,
    needsOre: true,
  },
  {
    id: 'smelter',
    cost: [plates(10), stone(5)],
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
    cost: [plates(15), copper(10)],
    name: '조립기',
    kind: 'machine',
    machine: { class: 'assembler', tier: 1 },
    w: 3,
    h: 3,
    color: 0x4a8fd4,
    height: 1.9,
    needsOre: false,
  },
  {
    id: 'smelter-mk2',
    name: '제련로',
    kind: 'machine',
    machine: { class: 'smelter', tier: 2 },
    draw: 2,
    cost: [circuits(5), bricks(10), plates(10)],
    w: 2,
    h: 2,
    color: 0xef7a52,
    height: 1.8,
    needsOre: false,
  },
  {
    id: 'assembler-mk2',
    name: '조립기',
    kind: 'machine',
    machine: { class: 'assembler', tier: 2 },
    draw: 4,
    cost: [circuits(10), motors(2), steel(5)],
    w: 3,
    h: 3,
    color: 0x6aa8ec,
    height: 2.1,
    needsOre: false,
  },
  {
    id: 'generator',
    name: '연소 발전기',
    kind: 'generator',
    generator: { output: 10, fuel: Item.Coal, burnSeconds: 6 },
    cost: [plates(20), copper(15), circuits(5)],
    w: 2,
    h: 2,
    color: 0xb5533c,
    height: 1.7,
    needsOre: false,
  },
  {
    id: 'pole',
    name: '전력 기둥',
    kind: 'pole',
    pole: { range: 5 },
    cost: [copper(1), plates(1)],
    w: 1,
    h: 1,
    color: 0x8fbf6a,
    height: 2.6,
    needsOre: false,
  },
  {
    id: 'pole-long',
    name: '장거리 전력 기둥',
    kind: 'pole',
    pole: { range: 12 },
    cost: [steel(2), circuits(3)],
    w: 1,
    h: 1,
    color: 0x6ad0b0,
    height: 3.4,
    needsOre: false,
  },
];

export const DEF_MAP: ReadonlyMap<string, BuildingDef> = new Map(
  BUILDING_DEFS.map((def) => [def.id, def]),
);

/**
 * How a building is named on screen. Tiers of the same machine share a name, so the
 * tier is what tells them apart.
 */
export function displayName(def: BuildingDef): string {
  const tier = def.machine?.tier ?? def.miner?.tier;
  return tier === undefined ? def.name : `${def.name} Mk${tier}`;
}

/** What the build bar offers: everything except things the game places itself. */
export const BUILDABLE_DEFS: readonly BuildingDef[] = BUILDING_DEFS.filter(
  (def) => def.buildable !== false,
);
