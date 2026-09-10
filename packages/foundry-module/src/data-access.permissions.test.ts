/**
 * Audit round 15 (2026-09-10): permissions.ts (round 13's finding that
 * `requiresConfirmation` is computed but never enforced) led to checking
 * every real write handler for whether the underlying `.allowed` boolean is
 * even consulted, not just the unused confirmation tier. Four permanent-
 * delete methods in data-access.ts turned out to skip `permissionManager`
 * entirely: `deleteWorldItems`, `deleteCompendiumPack`, `deleteActorItems`,
 * and `deleteActors` (the last two had no `validateFoundryState()` either).
 *
 * This matters concretely, not just as a design gap: the module's own
 * "Allow Write Operations" setting (settings.ts ~243-250, hint: "Let AI
 * model create actors, NPCs, and modify world content. Reading is always
 * allowed.") is the one switch a GM would flip to stop the AI from writing
 * to the world, and `ModuleSettings.isWriteOperationAllowed()`'s own doc
 * comment (settings.ts ~552-557) claims "single permission covers all write
 * operations." That claim was false for these four: a GM turning the
 * setting off did not stop a permanent actor delete, actor-item delete,
 * world-item delete, or (per queries.ts's own comment) "the only
 * irreversible call in the bridge," compendium pack deletion. Every other
 * write path already goes through `checkWritePermission` (createActor,
 * modifyScene, and modifyScene's `deleteTokens`) and was unaffected.
 *
 * Fixed by gating all four on `checkWritePermission('deleteData', ...)` —
 * the HIGH_RISK/`requiresGM: true` tier already defined in permissions.ts
 * but, before this fix, never called by any real code path (grepped: zero
 * matches). See data-access.ts deleteWorldItems()/deleteCompendiumPack()/
 * deleteActorItems()/deleteActors() for the full citation.
 */

import { describe, it, expect, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { statusEffects: [] };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world', setFlag: undefined, getFlag: undefined },
    user: { id: 'gm1', name: 'GM', isGM: true },
    system: { id: 'pf2e' },
    settings: {
      get: (_module: string, key: string) => {
        if (key === 'allowWriteOperations') return (overrides as any).__allowWrites ?? true;
        if (key === 'maxActorsPerRequest') return 10;
        return true;
      },
    },
    ...overrides,
  };
}

describe('FoundryDataAccess permanent-delete permission gating (audit round 15)', () => {
  describe('deleteWorldItems', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteDocuments = vi.fn();
      (globalThis as any).Item = { deleteDocuments };
      stubGame({
        __allowWrites: false,
        items: {
          get: (id: string) => (id === 'item1' ? { id, name: 'Sword', type: 'weapon' } : undefined),
        },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.deleteWorldItems({ ids: ['item1'] })).rejects.toThrow(
        /Access denied/i
      );
      expect(deleteDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      const item = { id: 'item1', name: 'Sword', type: 'weapon' };
      const deleteDocuments = vi.fn(async () => undefined);
      (globalThis as any).Item = { deleteDocuments };
      let deleted = false;
      stubGame({
        __allowWrites: true,
        items: { get: (id: string) => (deleted ? undefined : id === 'item1' ? item : undefined) },
      });
      deleteDocuments.mockImplementation(async () => {
        deleted = true;
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.deleteWorldItems({ ids: ['item1'] });
      expect(deleteDocuments).toHaveBeenCalledWith(['item1']);
      expect(result.total).toBe(1);
    });
  });

  describe('deleteCompendiumPack', () => {
    function stubPack(overrides: Record<string, any> = {}) {
      return {
        collection: 'world.test-pack',
        metadata: { packageType: 'world', packageName: 'test-world', label: 'Test Pack' },
        locked: false,
        documentName: 'Item',
        index: [],
        getIndex: vi.fn(async () => undefined),
        deleteCompendium: vi.fn(async () => undefined),
        ...overrides,
      };
    }

    it('refuses (even the dry-run preview) when Allow Write Operations is off', async () => {
      const pack = stubPack();
      stubGame({
        __allowWrites: false,
        packs: {
          get: (id: string) => (id === 'world.test-pack' ? pack : undefined),
          [Symbol.iterator]: [][Symbol.iterator],
        },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.deleteCompendiumPack({ pack: 'world.test-pack' })).rejects.toThrow(
        /Access denied/i
      );
      expect(pack.getIndex).not.toHaveBeenCalled();
      expect(pack.deleteCompendium).not.toHaveBeenCalled();
    });

    it('still runs the dry-run preview when Allow Write Operations is on (no regression)', async () => {
      const pack = stubPack();
      stubGame({
        __allowWrites: true,
        packs: {
          get: (id: string) => (id === 'world.test-pack' ? pack : undefined),
          [Symbol.iterator]: [][Symbol.iterator],
        },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.deleteCompendiumPack({ pack: 'world.test-pack' });
      expect(result.dryRun).toBe(true);
      expect(result.deleted).toBe(false);
      expect(pack.deleteCompendium).not.toHaveBeenCalled();
    });
  });

  describe('deleteActorItems', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteEmbeddedDocuments = vi.fn();
      const actor = {
        id: 'actor1',
        name: 'Goblin',
        items: { get: (id: string) => (id === 'item1' ? { id } : undefined) },
        deleteEmbeddedDocuments,
      };
      stubGame({
        __allowWrites: false,
        actors: {
          get: (id: string) => (id === 'actor1' ? actor : undefined),
          find: () => undefined,
        },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.deleteActorItems('actor1', ['item1'])).rejects.toThrow(
        /Access denied/i
      );
      expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      let itemDeleted = false;
      const actor = {
        id: 'actor1',
        name: 'Goblin',
        items: { get: (id: string) => (!itemDeleted && id === 'item1' ? { id } : undefined) },
        deleteEmbeddedDocuments: vi.fn(async () => {
          itemDeleted = true;
        }),
        reset: vi.fn(),
      };
      stubGame({
        __allowWrites: true,
        actors: {
          get: (id: string) => (id === 'actor1' ? actor : undefined),
          find: () => undefined,
        },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.deleteActorItems('actor1', ['item1']);
      expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('Item', ['item1']);
      expect(result.total).toBe(1);
    });
  });

  describe('deleteActors', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteDocuments = vi.fn();
      (globalThis as any).Actor = { deleteDocuments };
      stubGame({
        __allowWrites: false,
        actors: { get: (id: string) => (id === 'actor1' ? { id } : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.deleteActors(['actor1'])).rejects.toThrow(/Access denied/i);
      expect(deleteDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      const deleteDocuments = vi.fn(async () => undefined);
      (globalThis as any).Actor = { deleteDocuments };
      stubGame({
        __allowWrites: true,
        actors: { get: (id: string) => (id === 'actor1' ? { id } : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.deleteActors(['actor1']);
      expect(deleteDocuments).toHaveBeenCalledWith(['actor1']);
      expect(result.total).toBe(1);
    });
  });
});
