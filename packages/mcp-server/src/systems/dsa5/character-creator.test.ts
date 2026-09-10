/**
 * create-dsa5-character-from-archetype system-guard test, added by audit
 * round 11 (2026-09-10).
 *
 * Round 10 found this was the one actor-mutating, system-specific tool in the
 * codebase with no active-system check - every dnd5e- and wfrp4e-prefixed
 * counterpart (dnd5e-create-npc, dnd5e-add-features-from-compendium, etc.) calls
 * detectGameSystem() and refuses on a mismatch before writing. Unlike those,
 * this tool has no dsa5-specific bridge handler to fall back on - it calls
 * the generic, system-agnostic foundry-mcp-bridge.createActorFromCompendium
 * query, so calling it against a pf2e/dnd5e world would create an actor from
 * dsa5-shaped source data the active system's data model was never meant to
 * prepare. Round 11 added the same detectGameSystem() guard used by every
 * sibling tool. This file did not exist before round 11 - the class had zero
 * test coverage.
 *
 * list-dsa5-archetypes is deliberately NOT guarded: it only reads compendium
 * pack indexes already filtered to `pack.system === 'dsa5'` (character-
 * creator.ts handleListArchetypes()) and never touches actor data, so there
 * is no incorrect-write risk to gate against regardless of the active world's
 * system.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DSA5CharacterCreator } from './character-creator.js';
import { clearSystemCache } from '../../utils/system-detection.js';

function makeCreator(opts?: { system?: string; queryImpl?: (method: string, data: any) => any }) {
  const system = opts?.system ?? 'dsa5';
  const query = vi.fn(async (method: string, data: any) => {
    if (opts?.queryImpl) {
      const result = opts.queryImpl(method, data);
      if (result !== undefined) return result;
    }
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: { id: system }, id: 'w', title: 'W' };
    }
    if (method === 'foundry-mcp-bridge.getCompendiumDocumentFull') {
      return { name: 'Allacaya', pack: data.packId };
    }
    if (method === 'foundry-mcp-bridge.createActorFromCompendium') {
      return { success: true, actors: [{ id: 'a1', name: data.customNames?.[0] }] };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { creator: new DSA5CharacterCreator({ foundryClient, logger }), query };
}

const validArgs = {
  archetypePackId: 'dsa5-core.corecharacters',
  archetypeId: 'archetype1',
  characterName: 'Ericsson',
};

beforeEach(() => clearSystemCache());

describe('DSA5CharacterCreator.handleCreateCharacterFromArchetype', () => {
  it('forwards a valid call to createActorFromCompendium on a dsa5 world', async () => {
    const { creator, query } = makeCreator({ system: 'dsa5' });
    const result = await creator.handleCreateCharacterFromArchetype(validArgs);

    expect(result.success).toBe(true);
    const createCalled = query.mock.calls.some(
      c => c[0] === 'foundry-mcp-bridge.createActorFromCompendium'
    );
    expect(createCalled).toBe(true);
  });

  it('refuses on a non-dsa5 world without calling createActorFromCompendium', async () => {
    const { creator, query } = makeCreator({ system: 'pf2e' });

    await expect(creator.handleCreateCharacterFromArchetype(validArgs)).rejects.toThrow(/DSA5/);

    const createCalled = query.mock.calls.some(
      c => c[0] === 'foundry-mcp-bridge.createActorFromCompendium'
    );
    expect(createCalled).toBe(false);
    const readArchetypeCalled = query.mock.calls.some(
      c => c[0] === 'foundry-mcp-bridge.getCompendiumDocumentFull'
    );
    expect(readArchetypeCalled).toBe(false);
  });
});

describe('DSA5CharacterCreator.handleListArchetypes', () => {
  it('is not gated by active system - runs against a non-dsa5 world without throwing', async () => {
    const { creator, query } = makeCreator({
      system: 'pf2e',
      queryImpl: (method: string) => {
        if (method === 'foundry-mcp-bridge.getAvailablePacks') {
          return [
            {
              id: 'dsa5-core.corecharacters',
              label: 'Core Characters',
              type: 'Actor',
              system: 'dsa5',
            },
          ];
        }
        if (method === 'foundry-mcp-bridge.getPackIndex') {
          return [{ id: 'archetype1', name: 'Allacaya', type: 'character', system: {} }];
        }
        return undefined;
      },
    });

    const result = await creator.handleListArchetypes({});

    expect(result.count).toBe(1);
    expect(query.mock.calls.some(c => c[0] === 'foundry-mcp-bridge.getWorldInfo')).toBe(false);
  });
});
