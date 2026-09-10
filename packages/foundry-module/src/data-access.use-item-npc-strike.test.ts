/**
 * Live-verified bug fix (2026-09-10, discovered during a post-round-20 live
 * re-test of round 16's use-item targeting fix): calling use-item on a PF2e
 * NPC "melee"-type attack item (e.g. "The Butcher"'s "Bone Saw") reported
 * `success: true` but never posted anything to chat, and Foundry logged
 * "This actor no longer exists!" in its place.
 *
 * Root cause, confirmed against the actually-installed pf2e system source
 * (pf2e.mjs, minified but line-stable for this install): `MeleePF2e#toMessage`
 * (~52386-52393) does NOT post a chat card the way the base `ItemPF2e#toMessage`
 * (~45006, used by weapons/armor/equipment/etc.) does. Whenever the item backs
 * a strike in the actor's derived `system.actions`, it instead calls
 * `game.pf2e.rollActionMacro({ itemId, slug })` with no `actorUUID`.
 * `rollActionMacro`'s `resolveMacroActor(undefined)` (~25435-25441) then falls
 * back to `ChatMessage.getSpeaker()`, which needs a *controlled/selected*
 * token on canvas - a different concept from the `canvas.tokens.setTargets`
 * targeting round 16 added, and not something use-item has ever set. With
 * nothing controlled, no actor resolves and pf2e shows "This actor no longer
 * exists!" instead of using the item.
 *
 * Fixed by detecting a strike-backed item (`actor.system.actions.find(a =>
 * a.item === item)`) for pf2e and calling `game.pf2e.rollActionMacro`
 * ourselves with an explicit `actorUUID`, bypassing the broken zero-arg
 * `toMessage()` call. Non-strike pf2e items (equipment, consumables, etc.)
 * are unaffected and keep using the working base `toMessage()`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { specialStatusEffects: { DEFEATED: 'dead' }, statusEffects: {} };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    settings: { get: () => true },
    ...overrides,
  };
}

describe('FoundryDataAccess.useItem PF2e NPC strike (melee-type item) targeting', () => {
  let dataAccess: FoundryDataAccess;
  let actor: any;
  let item: any;
  let rollActionMacro: ReturnType<typeof vi.fn>;
  let toMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    toMessage = vi.fn(async () => undefined);
    item = {
      id: 'item1',
      name: 'Bone Saw',
      type: 'melee',
      toChat: vi.fn(async () => undefined),
      toMessage,
    };
    actor = {
      id: 'actor1',
      uuid: 'Actor.actor1',
      name: 'The Butcher',
      items: { find: (fn: any) => [item].find(fn) },
      system: { actions: [{ item, slug: 'bone-saw', type: 'strike' }] },
    };

    rollActionMacro = vi.fn(async () => undefined);
    stubGame({
      system: { id: 'pf2e' },
      pf2e: { rollActionMacro },
      actors: {
        get: () => undefined,
        getName: () => actor,
        [Symbol.iterator]: [actor][Symbol.iterator],
      },
      scenes: { active: { tokens: [] } },
    });
    (globalThis as any).canvas = { tokens: { setTargets: vi.fn() } };

    dataAccess = new FoundryDataAccess();
  });

  it('calls game.pf2e.rollActionMacro with an explicit actorUUID instead of the broken zero-arg toMessage()', async () => {
    const result = await dataAccess.useItem({
      actorIdentifier: 'The Butcher',
      itemIdentifier: 'Bone Saw',
    });

    expect(rollActionMacro).toHaveBeenCalledWith({
      actorUUID: 'Actor.actor1',
      itemId: 'item1',
      slug: 'bone-saw',
      type: 'strike',
    });
    expect(toMessage).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('still uses toMessage() for a pf2e item with no matching strike action (no regression)', async () => {
    const equipment = {
      id: 'item2',
      name: 'Grappling Hook',
      type: 'equipment',
      toChat: vi.fn(async () => undefined),
      toMessage: vi.fn(async () => undefined),
    };
    actor.items = { find: (fn: any) => [item, equipment].find(fn) };
    // actor.system.actions only has an entry for `item` (Bone Saw), not `equipment`.

    const result = await dataAccess.useItem({
      actorIdentifier: 'The Butcher',
      itemIdentifier: 'Grappling Hook',
    });

    expect(equipment.toMessage).toHaveBeenCalledWith(undefined, { create: true });
    expect(rollActionMacro).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('does not consult actor.system.actions for a non-pf2e system, even if a matching shape exists', async () => {
    (globalThis as any).game.system = { id: 'dsa5' };

    const result = await dataAccess.useItem({
      actorIdentifier: 'The Butcher',
      itemIdentifier: 'Bone Saw',
    });

    expect(rollActionMacro).not.toHaveBeenCalled();
    expect(toMessage).toHaveBeenCalledWith(undefined, { create: true });
    expect(result.success).toBe(true);
  });
});
