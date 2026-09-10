/**
 * Coverage for FoundryDataAccess.addAttackToActor / addAttackWithSaveToActor's
 * melee range object, added by audit round 17 (2026-09-10).
 *
 * Root cause, confirmed against the actually-installed dnd5e 5.3.3 system
 * source (extracted from dnd5e-compiled.mjs.map's embedded sourcesContent):
 * `WeaponData.defineSchema()` (module/data/item/weapon.mjs) declares
 * `system.range` as `{ value, long, reach, units }` — `value`/`long` are the
 * ranged weapon's normal/long distances, and `reach` is a *separate* field
 * dedicated to melee reach (confirmed live in the item sheet template,
 * templates/items/details/details-weapon.hbs:83-90, which binds
 * `fields.range.fields.reach` / `system.range.reach` for melee weapons).
 *
 * Both `addAttackToActor` and `addAttackWithSaveToActor` built their melee
 * `rangeObj` as `{ value: data.reachFt ?? 5, long: null, units: 'ft' }` —
 * writing the caller's reach into `value` and never touching `reach` at all.
 * `WeaponData#prepareDerivedData` (same file, ~line 488-491) only fills
 * `range.reach` from a hardcoded 5ft/10ft default when it is still `null`,
 * so a custom `reachFt` (e.g. 10 ft for a large creature's natural attack)
 * was silently discarded in favor of that default, while the caller's
 * number leaked into the "Range" display instead of "Reach"
 * (WeaponData#prepareFinalData, same file, ~line 502-507).
 *
 * Fixed by writing `reachFt` into `system.range.reach` and leaving
 * `value`/`long` null for melee attacks, matching the real schema.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { specialStatusEffects: { DEFEATED: 'dead' }, statusEffects: {} };
  (globalThis as any).foundry = {
    utils: { randomID: (n?: number) => `id-${n ?? ''}-${Math.random()}` },
  };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    system: { id: 'dnd5e' },
    settings: { get: () => true },
    scenes: [],
    ...overrides,
  };
}

describe('FoundryDataAccess dnd5e melee attack range/reach', () => {
  let dataAccess: FoundryDataAccess;
  let actor: any;
  let createEmbeddedDocuments: ReturnType<typeof vi.fn>;
  let createdItemData: any;

  beforeEach(() => {
    createdItemData = undefined;
    createEmbeddedDocuments = vi.fn(async (_type: string, docs: any[]) => {
      createdItemData = docs[0];
      return [{ id: 'item1', name: docs[0].name }];
    });
    actor = {
      id: 'actor1',
      name: 'Gorewood Ent',
      items: { find: () => undefined },
      createEmbeddedDocuments,
    };

    stubGame({
      actors: {
        get: () => undefined,
        getName: () => actor,
        [Symbol.iterator]: [actor][Symbol.iterator],
      },
    });

    dataAccess = new FoundryDataAccess();
  });

  it('addAttackToActor writes a custom melee reachFt into system.range.reach, not range.value', async () => {
    await dataAccess.addAttackToActor({
      actorIdentifier: 'Gorewood Ent',
      featureName: 'Slam',
      attackType: 'melee',
      reachFt: 10,
      attackBonus: 8,
      properties: [],
      damageParts: [{ number: 3, denomination: 8, type: 'bludgeoning' }],
    });

    expect(createdItemData.system.range).toEqual({
      value: null,
      long: null,
      reach: 10,
      units: 'ft',
    });
  });

  it('addAttackToActor defaults melee reach to 5 ft in system.range.reach when reachFt is omitted', async () => {
    await dataAccess.addAttackToActor({
      actorIdentifier: 'Gorewood Ent',
      featureName: 'Bite',
      attackType: 'melee',
      attackBonus: 5,
      properties: [],
      damageParts: [{ number: 1, denomination: 6, type: 'piercing' }],
    });

    expect(createdItemData.system.range).toEqual({
      value: null,
      long: null,
      reach: 5,
      units: 'ft',
    });
  });

  it('addAttackToActor leaves the ranged branch (value/long) untouched', async () => {
    await dataAccess.addAttackToActor({
      actorIdentifier: 'Gorewood Ent',
      featureName: 'Longbow',
      attackType: 'ranged',
      rangeFt: 150,
      longRangeFt: 600,
      attackBonus: 5,
      properties: [],
      damageParts: [{ number: 1, denomination: 8, type: 'piercing' }],
    });

    expect(createdItemData.system.range).toEqual({
      value: 150,
      long: 600,
      units: 'ft',
    });
  });

  it('addAttackWithSaveToActor writes a custom melee reachFt into system.range.reach, not range.value', async () => {
    await dataAccess.addAttackWithSaveToActor({
      actorIdentifier: 'Gorewood Ent',
      featureName: 'Poison Thorns',
      attackType: 'melee',
      reachFt: 15,
      attackBonus: 8,
      properties: [],
      damageParts: [{ number: 2, denomination: 6, type: 'piercing' }],
      saveDamageParts: [{ number: 2, denomination: 6, type: 'poison' }],
      saveAbility: 'con',
      saveDC: 15,
    });

    expect(createdItemData.system.range).toEqual({
      value: null,
      long: null,
      reach: 15,
      units: 'ft',
    });
  });
});
