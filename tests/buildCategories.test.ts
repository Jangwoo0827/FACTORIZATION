import { describe, expect, it } from 'vitest';
import { BUILD_CATEGORIES, BUILDABLE_DEFS, DEF_MAP, categoryOf } from '../src/data/buildings';

describe('build bar tabs', () => {
  it('puts every buildable building in exactly one tab, so none goes missing from the bar', () => {
    for (const def of BUILDABLE_DEFS) {
      const tabs = BUILD_CATEGORIES.filter((c) => c.defs.includes(def.id));
      expect(tabs.map((c) => c.id), def.id).toHaveLength(1);
    }
  });

  it('lists only buildings that exist and that the player may build', () => {
    for (const category of BUILD_CATEGORIES) {
      for (const id of category.defs) {
        expect(DEF_MAP.get(id), `${category.id}: ${id}`).toBeDefined();
        expect(DEF_MAP.get(id)!.buildable, `${category.id}: ${id}`).not.toBe(false);
      }
    }
  });

  it('keeps the hub out, since the game places it', () => {
    expect(categoryOf('hub')).toBeUndefined();
  });

  it('has distinct tab ids and no empty tabs', () => {
    const ids = BUILD_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of BUILD_CATEGORIES) expect(c.defs.length, c.id).toBeGreaterThan(0);
  });
});
