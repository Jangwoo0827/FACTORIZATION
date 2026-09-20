/**
 * Starting supplies (GDD 6.1).
 *
 * Enough for a first miner, a smelter and a run of belts, so the opening minutes are
 * about building and not about waiting. Plates cannot be mined, only made, so without
 * a starting supply nothing could ever be built.
 */

import { Item } from './items';
import type { Cost } from '../sim/types';

export const STARTING_STOCK: readonly Cost[] = [
  { item: Item.IronPlate, count: 100 },
  { item: Item.CopperPlate, count: 20 },
  { item: Item.Stone, count: 20 },
];
