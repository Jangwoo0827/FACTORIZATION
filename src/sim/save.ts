/**
 * Saving and loading a game (GDD 12.3, 14.4).
 *
 * A save holds what the player built and everything in motion: buildings in the
 * order they were placed, recipes, the hub's stock and deliveries, seal progress,
 * production history, and the exact contents of every belt, machine, miner and
 * generator. Terrain and ore are not saved; they come back from the map seed.
 * Signatures are not saved either; they are recomputed from the recipes (GDD 14.4),
 * so a rebalanced recipe applies to old saves automatically.
 *
 * The test the format has to pass: a factory saved and loaded runs on exactly as it
 * would have without the round trip. That is why build order and float positions are
 * kept exactly, and why the tick counter is saved (the hub snapshots on whole seconds).
 *
 * `saveVersion` and a migration chain keep old saves loading when the format changes:
 * each step upgrades a save by one version. A save from a newer game is refused rather
 * than half-read.
 *
 * Pure: no DOM, no storage. `runtime/storage.ts` puts these in IndexedDB.
 */

import type { BeltTileState } from './belts';
import type { MachineSave } from './machines';
import type { SieveState } from './sieve';
import { Simulation } from './simulation';
import type { StatsState } from './stats';
import type { BuildingDef } from './types';
import type { World, WorldState } from './world';

export const SAVE_VERSION = 1;

export interface SaveData {
  readonly saveVersion: number;
  /** When it was written, in ms since the epoch. For showing "saved 2 minutes ago". */
  readonly savedAt: number;
  readonly mapSize: number;
  readonly seed: number;
  readonly tick: number;
  readonly world: WorldState;
  readonly belts: readonly BeltTileState[];
  readonly miners: readonly (readonly number[])[];
  readonly machines: readonly MachineSave[];
  readonly generators: readonly (readonly [number, number, number, boolean])[];
  readonly sieve: SieveState;
  readonly stats: StatsState;
  readonly progress: { readonly level: number; readonly sustainedSeconds: number };
  /** Player conveniences that are not simulation, owned by the game shell. */
  readonly ui?: { readonly lastRecipe?: readonly (readonly [string, number])[] };
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Everything about a running game, as plain data. */
export function createSave(sim: Simulation, seed: number, ui?: SaveData['ui'], now = Date.now()): SaveData {
  return {
    saveVersion: SAVE_VERSION,
    savedAt: now,
    mapSize: sim.world.size,
    seed,
    tick: sim.tick,
    world: sim.world.exportState(),
    belts: sim.belts.exportState(),
    miners: sim.miners.exportState(),
    machines: sim.machines.exportState(),
    generators: sim.power.exportState(),
    sieve: sim.sieve.exportState(),
    stats: sim.stats.exportState(),
    progress: sim.progress.exportState(),
    ...(ui ? { ui } : {}),
  };
}

/**
 * Rebuilds a running game from a save.
 *
 * @param generate makes the empty map for a seed, the same way a new game does
 * @returns the simulation, and how many buildings no longer fit (0 unless map
 *   generation changed since the save was made)
 */
export function restoreSave(
  save: SaveData,
  generate: (size: number, seed: number, defs: ReadonlyMap<string, BuildingDef>) => World,
  defs: ReadonlyMap<string, BuildingDef>,
): { sim: Simulation; lostBuildings: number } {
  const world = generate(save.mapSize, save.seed, defs);
  const lostBuildings = world.importState(save.world);

  const sim = new Simulation(world);
  // Topology first (belts, machines' recipes, grids), then what was moving through it.
  sim.sync();
  sim.belts.importState(save.belts);
  sim.miners.importState(save.miners);
  sim.machines.importState(save.machines);
  sim.power.importState(save.generators);
  sim.sieve.importState(save.sieve);
  sim.stats.importState(save.stats);
  sim.progress.importState(save.progress);
  sim.tick = save.tick;
  return { sim, lostBuildings };
}

/**
 * Upgrades from each version to the next. Empty while there is only version 1; the
 * first format change adds `1: (s) => ({ ...s, saveVersion: 2, newField: default })`.
 */
const MIGRATIONS: Readonly<Record<number, (save: Record<string, unknown>) => Record<string, unknown>>> = {};

/**
 * Checks that a parsed JSON value is a save this game can load, upgrading it from an
 * older version if needed. Throws `SaveError` with a reason the player can read.
 */
export function migrate(raw: unknown, migrations = MIGRATIONS, current = SAVE_VERSION): SaveData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SaveError('세이브 파일이 아닙니다');
  }
  let save = raw as Record<string, unknown>;
  const version = save['saveVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new SaveError('세이브 버전을 알 수 없습니다');
  }
  if (version > current) {
    throw new SaveError(`더 새로운 버전(${version})의 세이브입니다. 게임을 업데이트하세요`);
  }
  for (let v = version; v < current; v++) {
    const step = migrations[v];
    if (!step) throw new SaveError(`버전 ${v}의 세이브를 올릴 방법이 없습니다`);
    save = step(save);
  }

  const world = save['world'] as Record<string, unknown> | undefined;
  if (
    typeof save['seed'] !== 'number' ||
    typeof save['mapSize'] !== 'number' ||
    typeof save['tick'] !== 'number' ||
    !world ||
    !Array.isArray(world['buildings']) ||
    typeof save['sieve'] !== 'object' ||
    typeof save['progress'] !== 'object'
  ) {
    throw new SaveError('세이브 파일이 손상되었습니다');
  }
  return save as unknown as SaveData;
}

/** Parses a save from text, as read from a file or storage. */
export function parseSave(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('세이브 파일을 읽을 수 없습니다 (JSON이 아닙니다)');
  }
  return migrate(raw);
}
