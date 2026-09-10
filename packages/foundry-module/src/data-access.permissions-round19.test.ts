/**
 * Audit round 19 (2026-09-10): same class of bug round 15 found in
 * deleteWorldItems/deleteCompendiumPack/deleteActorItems/deleteActors —
 * three more permanent-delete paths in data-access.ts turned out to skip
 * `permissionManager` entirely: `manageFolders` (action:"delete"),
 * `manageRollTables` (action:"delete"), and `manageMacros` (action:"delete").
 *
 * These three are dispatched from queries.ts's handleManageFolders/
 * handleManageRollTables/handleManageMacros, which each call
 * `validateGMAccess()` (queries.ts:17-23) before delegating to data-access.ts
 * — but that check is `game.user?.isGM`, a check of *who* is issuing the
 * query, not of the module's "Allow Write Operations" setting
 * (settings.ts ~243-250, ~552-557: "Let AI model create actors, NPCs, and
 * modify world content... single permission covers all write operations").
 * A GM who flips that setting off, expecting it to stop the AI from writing
 * to the world per that doc comment, could still have folders (and, with
 * deleteContents:true, everything inside them), roll tables, and macros
 * permanently deleted by these three actions before this fix — because
 * `permissionManager.checkWritePermission` was never called on any of them.
 *
 * Fixed by gating all three on `checkWritePermission('deleteData', ...)`,
 * the same HIGH_RISK/`requiresGM: true` tier round 15 used. See
 * data-access.ts manageFolders()/manageRollTables()/manageMacros() `delete`
 * branches for the full citation.
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

describe('FoundryDataAccess permanent-delete permission gating (audit round 19)', () => {
  describe('manageFolders delete', () => {
    function stubFolder(overrides: Record<string, any> = {}) {
      return {
        id: 'folder1',
        name: 'Test Folder',
        type: 'RollTable',
        folder: null,
        contents: [],
        delete: vi.fn(async () => undefined),
        ...overrides,
      };
    }

    function stubFolders(folders: any[]) {
      return {
        [Symbol.iterator]: folders[Symbol.iterator].bind(folders),
        get: (id: string) => folders.find(f => f.id === id),
        find: (fn: any) => folders.find(fn),
      };
    }

    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const folder = stubFolder();
      stubGame({ __allowWrites: false, folders: stubFolders([folder]) });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.manageFolders({ action: 'delete', id: 'folder1' })).rejects.toThrow(
        /Access denied/i
      );
      expect(folder.delete).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      const folder = stubFolder();
      stubGame({ __allowWrites: true, folders: stubFolders([folder]) });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.manageFolders({ action: 'delete', id: 'folder1' });
      expect(folder.delete).toHaveBeenCalled();
      expect(result.deleted).toHaveLength(1);
    });
  });

  describe('manageRollTables delete', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteDocuments = vi.fn();
      (globalThis as any).RollTable = { deleteDocuments };
      const table = { id: 'table1', name: 'Loot Table' };
      stubGame({
        __allowWrites: false,
        tables: { get: (id: string) => (id === 'table1' ? table : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(
        dataAccess.manageRollTables({ action: 'delete', ids: ['table1'] })
      ).rejects.toThrow(/Access denied/i);
      expect(deleteDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      let deleted = false;
      const deleteDocuments = vi.fn(async () => {
        deleted = true;
      });
      (globalThis as any).RollTable = { deleteDocuments };
      const table = { id: 'table1', name: 'Loot Table' };
      stubGame({
        __allowWrites: true,
        tables: {
          get: (id: string) => (deleted ? undefined : id === 'table1' ? table : undefined),
        },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.manageRollTables({ action: 'delete', ids: ['table1'] });
      expect(deleteDocuments).toHaveBeenCalledWith(['table1']);
      expect(result.total).toBe(1);
    });
  });

  describe('manageMacros delete', () => {
    it('refuses and deletes nothing when Allow Write Operations is off', async () => {
      const deleteDocuments = vi.fn();
      (globalThis as any).Macro = { deleteDocuments };
      const macro = { id: 'macro1', name: 'Nuke Button' };
      stubGame({
        __allowWrites: false,
        macros: { get: (id: string) => (id === 'macro1' ? macro : undefined) },
      });
      const dataAccess = new FoundryDataAccess();

      await expect(dataAccess.manageMacros({ action: 'delete', ids: ['macro1'] })).rejects.toThrow(
        /Access denied/i
      );
      expect(deleteDocuments).not.toHaveBeenCalled();
    });

    it('still deletes when Allow Write Operations is on (no regression)', async () => {
      let deleted = false;
      const deleteDocuments = vi.fn(async () => {
        deleted = true;
      });
      (globalThis as any).Macro = { deleteDocuments };
      const macro = { id: 'macro1', name: 'Nuke Button' };
      stubGame({
        __allowWrites: true,
        macros: {
          get: (id: string) => (deleted ? undefined : id === 'macro1' ? macro : undefined),
        },
      });
      const dataAccess = new FoundryDataAccess();

      const result = await dataAccess.manageMacros({ action: 'delete', ids: ['macro1'] });
      expect(deleteDocuments).toHaveBeenCalledWith(['macro1']);
      expect(result.total).toBe(1);
    });
  });
});
