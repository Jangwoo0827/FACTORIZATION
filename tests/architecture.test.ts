/**
 * Guards the layering rule from GDD 14.2: the simulation stays renderer-agnostic.
 *
 * This is the cheapest possible enforcement, and it matters because the whole
 * "swap Phaser out later" plan rests on the boundary holding.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('architecture boundaries', () => {
  it('keeps the renderer out of sim, core, data, input and factor', () => {
    // This boundary is not theoretical: it is what let the renderer change from
    // Phaser to three.js without touching the simulation.
    const offenders: string[] = [];
    for (const layer of ['sim', 'core', 'data', 'input', 'factor']) {
      for (const file of filesUnder(join(SRC, layer))) {
        const source = readFileSync(file, 'utf8');
        if (/from\s+['"](three|phaser)['"]/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the DOM out of sim, core and factor', () => {
    const offenders: string[] = [];
    for (const layer of ['sim', 'core', 'factor']) {
      for (const file of filesUnder(join(SRC, layer))) {
        const source = readFileSync(file, 'utf8');
        if (/\b(document|window)\./.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
