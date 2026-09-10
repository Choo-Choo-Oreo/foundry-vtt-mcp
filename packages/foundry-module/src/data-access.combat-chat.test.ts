/**
 * Real-logic coverage for listChatLog/manageCombat, added after three audit
 * rounds (2026-09-10) found the same sinceId-paging bug shipped twice in a
 * row while packages/mcp-server's "301/301 tests" stayed green throughout -
 * those tests only check that a tool forwards its params to the bridge query,
 * never that the bridge's actual Foundry-facing logic (here) is correct. This
 * file exercises that logic directly against a synthetic `game` global,
 * instead of a live Foundry world.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function makeMessage(id: string, timestamp: number) {
  return { id, timestamp, content: `msg ${id}`, rolls: [], whisper: [] };
}

function stubGame(overrides: Record<string, any> = {}) {
  // PersistentCreatureIndex registers Hooks.on(...) at construction time
  // (data-access.ts:491), so Hooks must exist before `new FoundryDataAccess()`.
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { specialStatusEffects: { DEFEATED: 'dead' } };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    ...overrides,
  };
}

function makeCombatant(id: string, hidden: boolean, defeated: boolean) {
  const c: any = { id, hidden, defeated, isDefeated: defeated };
  c.update = vi.fn(async (changes: any) => {
    Object.assign(c, changes);
    // Mirror Foundry's real Combatant#isDefeated getter tracking the raw field, so a
    // second toggle-defeated call in the same test sees the updated state instead of
    // the stale value this plain mock would otherwise keep forever.
    if ('defeated' in changes) c.isDefeated = changes.defeated;
    return c;
  });
  return c;
}

describe('FoundryDataAccess.listChatLog', () => {
  let dataAccess: FoundryDataAccess;
  const messages = Array.from({ length: 25 }, (_, i) => makeMessage(`m${i + 1}`, 1000 + i));

  beforeEach(() => {
    stubGame({ messages: { contents: messages }, users: { get: () => undefined } });
    dataAccess = new FoundryDataAccess();
  });

  it('with no sinceId, returns the most recent `limit` entries', async () => {
    const result = await dataAccess.listChatLog({ limit: 5 });
    expect(result.entries.map(e => e.id)).toEqual(['m21', 'm22', 'm23', 'm24', 'm25']);
    expect(result.total).toBe(25);
  });

  it('with sinceId, returns the OLDEST `limit` entries after it, not the newest', async () => {
    const result = await dataAccess.listChatLog({ sinceId: 'm20', limit: 3 });
    // Oldest-first so paging forward never skips a message in between.
    expect(result.entries.map(e => e.id)).toEqual(['m21', 'm22', 'm23']);
    expect(result.total).toBe(5); // m21..m25
  });

  it('pages forward through a backlog with no gap and no duplicate', async () => {
    const page1 = await dataAccess.listChatLog({ sinceId: 'm20', limit: 2 });
    expect(page1.entries.map(e => e.id)).toEqual(['m21', 'm22']);

    const page2 = await dataAccess.listChatLog({
      sinceId: page1.entries[page1.entries.length - 1]!.id,
      limit: 2,
    });
    expect(page2.entries.map(e => e.id)).toEqual(['m23', 'm24']);

    const page3 = await dataAccess.listChatLog({
      sinceId: page2.entries[page2.entries.length - 1]!.id,
      limit: 2,
    });
    expect(page3.entries.map(e => e.id)).toEqual(['m25']);
    // total < limit signals nothing left to fetch.
    expect(page3.total).toBe(1);
  });

  it('an unknown/stale sinceId returns nothing missed rather than the whole log', async () => {
    const result = await dataAccess.listChatLog({ sinceId: 'not-a-real-id' });
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe('FoundryDataAccess.listChatLog speaker resolution', () => {
  let dataAccess: FoundryDataAccess;

  it('an OOC-styled message reports the posting user, not an impersonated token alias', async () => {
    // Foundry's real ChatMessage#alias getter always returns the author's name for an
    // OOC-styled message (style 1) even when speaker.alias is populated - audit round 8
    // found the bridge ignored `style` entirely and would report the token/actor name.
    const oocMessage = {
      id: 'm1',
      timestamp: 1000,
      content: 'hello out of character',
      rolls: [],
      whisper: [],
      style: 1,
      author: { name: 'Real Player' },
      speaker: { alias: 'Some Impersonated Token' },
    };
    stubGame({ messages: { contents: [oocMessage] }, users: { get: () => undefined } });
    dataAccess = new FoundryDataAccess();

    const result = await dataAccess.listChatLog({ limit: 5 });
    expect(result.entries[0]!.speaker).toBe('Real Player');
  });

  it('a normal (non-OOC) message still prefers the speaker alias over the author name', async () => {
    const inCharacterMessage = {
      id: 'm1',
      timestamp: 1000,
      content: 'hello in character',
      rolls: [],
      whisper: [],
      style: 0,
      author: { name: 'Real Player' },
      speaker: { alias: 'Some Impersonated Token' },
    };
    stubGame({ messages: { contents: [inCharacterMessage] }, users: { get: () => undefined } });
    dataAccess = new FoundryDataAccess();

    const result = await dataAccess.listChatLog({ limit: 5 });
    expect(result.entries[0]!.speaker).toBe('Some Impersonated Token');
  });
});

describe('FoundryDataAccess.manageCombat', () => {
  let dataAccess: FoundryDataAccess;

  beforeEach(() => {
    stubGame({});
    dataAccess = new FoundryDataAccess();
  });

  it('toggle-hidden flips hidden on each combatant independently in both directions', async () => {
    const hiddenOne = makeCombatant('c1', true, false);
    const shownOne = makeCombatant('c2', false, false);
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: (id: string) => ({ c1: hiddenOne, c2: shownOne })[id] },
    };
    (globalThis as any).game.combat = combat;

    await dataAccess.manageCombat({ action: 'toggle-hidden', combatantIds: ['c1', 'c2'] });

    expect(hiddenOne.update).toHaveBeenCalledWith({ hidden: false });
    expect(shownOne.update).toHaveBeenCalledWith({ hidden: true });
  });

  it('toggle-defeated flips defeated on each combatant independently in both directions', async () => {
    const deadOne = makeCombatant('c1', false, true);
    const aliveOne = makeCombatant('c2', false, false);
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: (id: string) => ({ c1: deadOne, c2: aliveOne })[id] },
    };
    (globalThis as any).game.combat = combat;

    await dataAccess.manageCombat({ action: 'toggle-defeated', combatantIds: ['c1', 'c2'] });

    expect(deadOne.update).toHaveBeenCalledWith({ defeated: false });
    expect(aliveOne.update).toHaveBeenCalledWith({ defeated: true });
  });

  it('toggle-defeated also syncs the token dead-overlay via actor.toggleStatusEffect', async () => {
    // Foundry's own tracker skull-icon handler does both the raw field update AND
    // actor.toggleStatusEffect(CONFIG.specialStatusEffects.DEFEATED, {overlay:true,...}) -
    // audit round 7 found the bridge only did the first, so the field flipped but the
    // token's canvas overlay never changed.
    const c1 = makeCombatant('c1', false, false);
    const toggleStatusEffect = vi.fn().mockResolvedValue(true);
    c1.actor = { toggleStatusEffect };
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    await dataAccess.manageCombat({ action: 'toggle-defeated', combatantIds: ['c1'] });

    expect(c1.update).toHaveBeenCalledWith({ defeated: true });
    expect(toggleStatusEffect).toHaveBeenCalledWith('dead', { overlay: true, active: true });

    await dataAccess.manageCombat({ action: 'toggle-defeated', combatantIds: ['c1'] });

    expect(c1.update).toHaveBeenCalledWith({ defeated: false });
    expect(toggleStatusEffect).toHaveBeenCalledWith('dead', { overlay: true, active: false });
  });

  it('toggle-defeated does not throw when the combatant has no actor to sync an overlay onto', async () => {
    const c1 = makeCombatant('c1', false, false);
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    await expect(
      dataAccess.manageCombat({ action: 'toggle-defeated', combatantIds: ['c1'] })
    ).resolves.toBeDefined();
    expect(c1.update).toHaveBeenCalledWith({ defeated: true });
  });

  it('end calls delete() and never the confirmation-dialog endCombat()', async () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const endCombatFn = vi.fn().mockResolvedValue(undefined);
    const combat: any = { id: 'combat1', turns: [], delete: deleteFn, endCombat: endCombatFn };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'end' });

    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(endCombatFn).not.toHaveBeenCalled();
    expect(result).toEqual({ ended: true, combatId: 'combat1' });
  });

  it('get reports hidden/defeated/HP for every combatant without mutating anything', async () => {
    const c1 = makeCombatant('c1', true, false);
    c1.name = 'Ambusher';
    c1.actor = {
      name: 'Ambusher',
      hasPlayerOwner: false,
      system: { attributes: { hp: { value: 5, max: 10 } } },
    };
    const combat: any = {
      id: 'combat1',
      started: true,
      round: 2,
      turn: 0,
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.active).toBe(true);
    expect(result.round).toBe(2);
    expect(result.combatants).toEqual([
      {
        id: 'c1',
        name: 'Ambusher',
        actorId: null,
        tokenId: null,
        initiative: null,
        hidden: true,
        defeated: false,
        isNPC: true,
        hp: { value: 5, max: 10 },
      },
    ]);
    expect(c1.update).not.toHaveBeenCalled();
  });

  it('get reports isNPC: true for a combatant with no linked actor at all', async () => {
    // Foundry's own Combatant#isNPC getter treats an actor-less combatant (deleted
    // actor, orphaned token) as NPC, not unknown - audit round 6 found the prior
    // actor-only fallback returned null for this case instead.
    const c1 = makeCombatant('c1', false, false);
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].isNPC).toBe(true);
  });

  it("get prefers Foundry's own Combatant#isNPC getter over the hasPlayerOwner fallback", async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.isNPC = false;
    c1.actor = { name: 'Hireling', hasPlayerOwner: false };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].isNPC).toBe(false);
  });

  it('get reads HP from WFRP4e-shaped actors (system.status.wounds)', async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.actor = { name: 'Bandit', system: { status: { wounds: { value: 3, max: 12 } } } };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 3, max: 12 });
  });

  it('get reads HP from Cosmere RPG-shaped actors (system.resources.hea, DerivedValueField max)', async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.actor = {
      name: 'Windrunner',
      system: { resources: { hea: { value: 14, max: { value: 20, derived: 20 } } } },
    };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 14, max: 20 });
  });

  it('get reads HP from MGT2e-shaped actors (system.hits object)', async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.actor = { name: 'Scout', system: { hits: { value: 5, max: 8 } } };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 5, max: 8 });
  });

  it('get reads HP from MGT2e-shaped actors with a bare-number system.hits (both value and max)', async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.actor = { name: 'Scout', system: { hits: 8 } };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 8, max: 8 });
  });

  it('get reads the resolved `value` on a Cosmere DerivedValueField, not the raw override', async () => {
    // On a live, prepared Cosmere actor `value` is already the system's own computed
    // (useOverride ? override : derived) + bonus - here that's override(25) + bonus(2).
    // resolveDerived must trust that resolved number rather than re-deriving from
    // override/derived itself (audit round 6: the old override-before-value order
    // would have silently returned 25, dropping the +2 bonus).
    const c1 = makeCombatant('c1', false, false);
    c1.actor = {
      name: 'Windrunner',
      system: {
        resources: {
          hea: {
            value: 14,
            max: { value: 27, derived: 20, useOverride: true, override: 25, bonus: 2 },
          },
        },
      },
    };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 14, max: 27 });
  });

  it('get falls back to override/derived on a hand-built Cosmere field with no `value`', async () => {
    // A legacy/hand-built DerivedValueField that never went through the system's
    // own prepareData getter has no `value` at all - resolveDerived must still
    // resolve override-over-derived in that case.
    const c1 = makeCombatant('c1', false, false);
    c1.actor = {
      name: 'Windrunner',
      system: {
        resources: {
          hea: { value: 14, max: { derived: 20, useOverride: true, override: 25 } },
        },
      },
    };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 14, max: 25 });
  });

  it("get returns hp: null rather than guessing when an actor's HP shape is unrecognized", async () => {
    const c1 = makeCombatant('c1', false, false);
    c1.actor = { name: 'Mystery', system: { somethingElse: { totally: 'unrelated' } } };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toBeNull();
  });

  it('get reads HP from DSA5-shaped actors (system.status.wounds, same shape as WFRP4e)', async () => {
    // Audit round 5 wrongly logged DSA5 as an unhandled HP gap; round 6 confirmed
    // via DSA5's own upstream source that it uses the exact same system.status.wounds
    // shape as WFRP4e, so it's already covered by that branch - this test locks it in.
    const c1 = makeCombatant('c1', false, false);
    c1.actor = { name: 'Praios Acolyte', system: { status: { wounds: { value: 9, max: 30 } } } };
    const combat: any = {
      id: 'combat1',
      turns: [c1],
      combatants: { get: (id: string) => (id === 'c1' ? c1 : undefined) },
    };
    (globalThis as any).game.combat = combat;

    const result = await dataAccess.manageCombat({ action: 'get' });

    expect(result.combatants[0].hp).toEqual({ value: 9, max: 30 });
  });

  it("add-combatants resolves tokens from the target combat's own scene, not the viewed scene", async () => {
    // The viewed scene and the combat's own scene can differ when combatId targets a
    // combat other than the one on screen - audit round 6 found the prior code always
    // used the viewed scene regardless, which would silently miss tokens (or attach the
    // wrong scene id) for a non-viewed combat.
    const targetToken = { id: 'tok1' };
    const targetScene = {
      id: 'scene-target',
      tokens: { get: (id: string) => (id === 'tok1' ? targetToken : undefined) },
    };
    const viewedScene = { id: 'scene-viewed', tokens: { get: () => undefined } };

    const createEmbeddedDocuments = vi.fn().mockResolvedValue(undefined);
    const combat: any = {
      id: 'combat-other',
      turns: [],
      scene: targetScene,
      combatants: { get: () => undefined },
      createEmbeddedDocuments,
    };

    stubGame({
      combat: { id: 'combat-viewed', turns: [], combatants: { get: () => undefined } },
      combats: { get: (id: string) => (id === 'combat-other' ? combat : undefined) },
      scenes: { current: viewedScene },
    });
    dataAccess = new FoundryDataAccess();

    await dataAccess.manageCombat({
      action: 'add-combatants',
      combatId: 'combat-other',
      tokenIds: ['tok1'],
    });

    expect(createEmbeddedDocuments).toHaveBeenCalledWith('Combatant', [
      { tokenId: 'tok1', sceneId: 'scene-target', hidden: false },
    ]);
  });

  it("add-combatants carries over a hidden token's hidden state instead of defaulting to visible", async () => {
    // Mirrors Foundry's own TokenDocument#createCombatants, which sets hidden: token.hidden -
    // audit round 7 found the bridge dropped this, so a hidden ambusher token would show up
    // on the tracker visible by default.
    const ambusher = { id: 'tok1', hidden: true };
    const scene = {
      id: 'scene1',
      tokens: { get: (id: string) => (id === 'tok1' ? ambusher : undefined) },
    };
    const createEmbeddedDocuments = vi.fn().mockResolvedValue(undefined);
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: () => undefined },
      createEmbeddedDocuments,
    };
    stubGame({ combat, scenes: { current: scene } });
    dataAccess = new FoundryDataAccess();

    await dataAccess.manageCombat({ action: 'add-combatants', tokenIds: ['tok1'] });

    expect(createEmbeddedDocuments).toHaveBeenCalledWith('Combatant', [
      { tokenId: 'tok1', sceneId: 'scene1', hidden: true },
    ]);
  });

  it('add-combatants skips a token already in this combat instead of creating a duplicate', async () => {
    const alreadyIn = { id: 'tok1', hidden: false, inCombat: true };
    const fresh = { id: 'tok2', hidden: false, inCombat: false };
    const scene = {
      id: 'scene1',
      tokens: { get: (id: string) => ({ tok1: alreadyIn, tok2: fresh })[id] },
    };
    const createEmbeddedDocuments = vi.fn().mockResolvedValue(undefined);
    const combat: any = {
      id: 'combat1',
      turns: [],
      combatants: { get: () => undefined },
      createEmbeddedDocuments,
    };
    stubGame({ combat, scenes: { current: scene } });
    dataAccess = new FoundryDataAccess();

    const result = await dataAccess.manageCombat({
      action: 'add-combatants',
      tokenIds: ['tok1', 'tok2'],
    });

    expect(createEmbeddedDocuments).toHaveBeenCalledWith('Combatant', [
      { tokenId: 'tok2', sceneId: 'scene1', hidden: false },
    ]);
    expect(result.alreadyInCombat).toEqual(['tok1']);
  });
});
