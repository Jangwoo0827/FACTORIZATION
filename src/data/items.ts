/**
 * Every item in the game.
 *
 * Raw materials keep the id of the `Ore` they are mined from, so an ore and the item
 * it produces are the same number with no translation in between. Crafted items
 * follow, numbered in the order they are introduced (GDD 9).
 */

export const Item = {
  IronOre: 1,
  CopperOre: 2,
  Coal: 3,
  Stone: 4,
  Sand: 5,
  Quartz: 6,

  IronPlate: 7,
  CopperPlate: 8,
  CopperWire: 9,
  Gear: 10,
  StoneBrick: 11,
  Circuit: 12,
  Steel: 13,
  Silicon: 14,
  Motor: 15,
  MachineFrame: 16,
  Battery: 17,
  AdvancedCircuit: 18,
  OpticLens: 19,
  Processor: 20,
  PowerCore: 21,
  LogicCore: 22,
  GateComponent: 23,
} as const;

export type ItemName = keyof typeof Item;

export interface ItemDef {
  readonly id: number;
  readonly name: string;
  /** Packed RGB. Chosen to stay distinguishable from its neighbours on a belt. */
  readonly color: number;
  readonly raw: boolean;
}

export const ITEM_DEFS: readonly ItemDef[] = [
  { id: Item.IronOre, name: '철광석', color: 0xb6603f, raw: true },
  { id: Item.CopperOre, name: '구리광석', color: 0xd98b4a, raw: true },
  { id: Item.Coal, name: '석탄', color: 0x39404a, raw: true },
  { id: Item.Stone, name: '돌', color: 0x8d8b82, raw: true },
  { id: Item.Sand, name: '모래', color: 0xc9bd8a, raw: true },
  { id: Item.Quartz, name: '석영', color: 0x9fd0d6, raw: true },

  { id: Item.IronPlate, name: '철판', color: 0xc9d3dc, raw: false },
  { id: Item.CopperPlate, name: '구리판', color: 0xe8925c, raw: false },
  { id: Item.CopperWire, name: '구리전선', color: 0xf0b35a, raw: false },
  { id: Item.Gear, name: '기어', color: 0x9aa6b2, raw: false },
  { id: Item.StoneBrick, name: '돌 벽돌', color: 0xb85c48, raw: false },
  { id: Item.Circuit, name: '회로', color: 0x3fbf6f, raw: false },
  { id: Item.Steel, name: '강철', color: 0x6f86a6, raw: false },
  { id: Item.Silicon, name: '실리콘', color: 0x7a6ad8, raw: false },
  { id: Item.Motor, name: '모터', color: 0xd9c04a, raw: false },
  { id: Item.MachineFrame, name: '기계 프레임', color: 0x8f8f8f, raw: false },
  { id: Item.Battery, name: '배터리', color: 0xe6e08a, raw: false },
  { id: Item.AdvancedCircuit, name: '고급 회로', color: 0x26a69a, raw: false },
  { id: Item.OpticLens, name: '광학 렌즈', color: 0x7fe3e8, raw: false },
  { id: Item.Processor, name: '프로세서', color: 0xc65bd6, raw: false },
  { id: Item.PowerCore, name: '파워 코어', color: 0xf06a3c, raw: false },
  { id: Item.LogicCore, name: '로직 코어', color: 0x4a7bdc, raw: false },
  { id: Item.GateComponent, name: '게이트 부품', color: 0xffd54a, raw: false },
];

export const ITEM_MAP: ReadonlyMap<number, ItemDef> = new Map(ITEM_DEFS.map((d) => [d.id, d]));

export function itemName(id: number): string {
  return ITEM_MAP.get(id)?.name ?? `#${id}`;
}
