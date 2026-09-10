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
});
