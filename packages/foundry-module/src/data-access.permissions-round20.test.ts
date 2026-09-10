/**
 * Audit round 20 (2026-09-10): same class of bug rounds 15/19 found in
 * deleteWorldItems/deleteCompendiumPack/deleteActorItems/deleteActors and
 * manageFolders/manageRollTables/manageMacros — `manageJournals`'s `delete`
 * (whole JournalEntry) and `delete-page` (embedded JournalEntryPage) actions
 * also skipped `permissionManager` entirely.
 *
 * These are dispatched from queries.ts's `handleManageJournals`
 * (queries.ts:2401-2423), which calls `validateGMAccess()` (queries.ts:2408)
 * before delegating to data-access.ts — but that check is `game.user?.isGM`,
 * a check of *who* is issuing the query, not of the module's "Allow Write
 * Operations" setting (settings.ts ~243-250, ~552-557: "Let AI model create
 * actors, NPCs, and modify world content... single permission covers all
 * write operations"). A GM who flips that setting off, expecting it to stop
 * the AI from writing to the world per that doc comment, could still have
 * whole journals — and individual pages inside them — permanently deleted by
 * these two actions before this fix, because
 * `permissionManager.checkWritePermission` was never called on either.
 *
 * Fixed by gating both branches on `checkWritePermission('deleteData', ...)`,
 * the same HIGH_RISK/`requiresGM: true` tier rounds 15/19 used. See
 * data-access.ts `manageJournals()` `delete` and `delete-page` branches for
 * the full citation.
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
    folders: [],
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

describe('FoundryDataAccess.manageJournals permission gating (audit round 20)', () => {
  describe('delete (whole JournalEntry)', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteDocuments = vi.fn();
      (globalThis as any).JournalEntry = { deleteDocuments };
      const journalEntry = { id: 'journal1', name: 'Old Quest Log' };
      stubGame({
        __allowWrites: false,
        journal: { get: (id: string) => (id === 'journal1' ? journalEntry : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(
        dataAccess.manageJournals({ action: 'delete', ids: ['journal1'] })
      ).rejects.toThrow(/Access denied/i);
      expect(deleteDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      let deleted = false;
      const deleteDocuments = vi.fn(async () => {
        deleted = true;
      });
      (globalThis as any).JournalEntry = { deleteDocuments };
      const journalEntry = { id: 'journal1', name: 'Old Quest Log' };
      stubGame({
        __allowWrites: true,
        journal: {
          get: (id: string) => (deleted ? undefined : id === 'journal1' ? journalEntry : undefined),
        },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.manageJournals({ action: 'delete', ids: ['journal1'] });
      expect(deleteDocuments).toHaveBeenCalledWith(['journal1']);
      expect(result.total).toBe(1);
    });
  });

  describe('delete-page (embedded JournalEntryPage)', () => {
    function stubJournal(overrides: Record<string, any> = {}) {
      const page = { id: 'page1', name: 'Adventure Hook / Quest Objectives' };
      let deleted = false;
      const deleteEmbeddedDocuments = vi.fn(async () => {
        deleted = true;
      });
      return {
        id: 'journal1',
        name: 'Quest Log',
        pages: {
          get: (id: string) => (deleted ? undefined : id === 'page1' ? page : undefined),
          size: 1,
        },
        deleteEmbeddedDocuments,
        ...overrides,
      };
    }

    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const journalEntry = stubJournal();
      stubGame({
        __allowWrites: false,
        journal: { get: (id: string) => (id === 'journal1' ? journalEntry : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(
        dataAccess.manageJournals({
          action: 'delete-page',
          journalId: 'journal1',
          pageIds: ['page1'],
        })
      ).rejects.toThrow(/Access denied/i);
      expect(journalEntry.deleteEmbeddedDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      const journalEntry = stubJournal();
      stubGame({
        __allowWrites: true,
        journal: { get: (id: string) => (id === 'journal1' ? journalEntry : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.manageJournals({
        action: 'delete-page',
        journalId: 'journal1',
        pageIds: ['page1'],
      });
      expect(journalEntry.deleteEmbeddedDocuments).toHaveBeenCalledWith('JournalEntryPage', [
        'page1',
      ]);
      expect(result.total).toBe(1);
    });
  });
});
