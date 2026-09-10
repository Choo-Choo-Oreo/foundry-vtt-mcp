/**
 * Real-logic coverage for toggleTokenCondition, added by audit round 10
 * (2026-09-10) after finding it routed PF2e through a generic ActiveEffect
 * write instead of PF2e's real condition API - a condition Item document
 * managed by game.pf2e.ConditionManager / Actor#toggleCondition, not an
 * ActiveEffect (confirmed against the actually-installed pf2e system source,
 * pf2e.mjs ~32100-32168: `increaseCondition`/`decreaseCondition` call
 * `createEmbeddedDocuments("Item", ...)` / `deleteEmbeddedDocuments("Item", ...)`).
 * The old code's ActiveEffect write would report success while leaving the
 * condition functionally absent for pf2e - the pf2e half of the
 * long-suspected token-condition-noops gap. See data-access.ts
 * toggleTokenCondition().
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(systemId: string, statusEffects: any, overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = {
    specialStatusEffects: { DEFEATED: 'dead' },
    statusEffects,
  };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    system: { id: systemId },
    settings: { get: () => true },
    ...overrides,
  };
}

describe('FoundryDataAccess.toggleTokenCondition', () => {
  let dataAccess: FoundryDataAccess;

  describe('pf2e', () => {
    let toggleCondition: ReturnType<typeof vi.fn>;
    let actor: any;
    let token: any;

    beforeEach(() => {
      // pf2e's real CONFIG.statusEffects is a slug-keyed object, not an array
      // (pf2e.mjs #updateStatusIcons, ~line 110174).
      stubGame('pf2e', {
        prone: { id: 'prone', name: 'PF2E.condition.prone.name', img: 'prone.webp' },
      });
      toggleCondition = vi.fn(async () => true);
      actor = {
        toggleCondition,
        createEmbeddedDocuments: vi.fn(),
        deleteEmbeddedDocuments: vi.fn(),
        effects: { contents: [] },
      };
      token = { id: 'tok1', name: 'Goblin', actor };
      (globalThis as any).game.scenes = {
        current: { tokens: { get: () => token } },
      };
      dataAccess = new FoundryDataAccess();
    });

    it('applies a condition via actor.toggleCondition, not an ActiveEffect', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: true,
      });

      expect(toggleCondition).toHaveBeenCalledWith('prone', { active: true });
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('removes a condition via actor.toggleCondition, not by scanning ActiveEffects', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: false,
      });

      expect(toggleCondition).toHaveBeenCalledWith('prone', { active: false });
      expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(false);
    });
  });

  describe('dnd5e (unaffected by the pf2e fix)', () => {
    let actor: any;
    let token: any;

    beforeEach(() => {
      // Core Foundry / D&D5e's CONFIG.statusEffects is an array.
      stubGame('dnd5e', [{ id: 'prone', name: 'Prone', icon: 'prone.webp' }]);
      actor = {
        createEmbeddedDocuments: vi.fn(async () => [{}]),
        deleteEmbeddedDocuments: vi.fn(async () => []),
        effects: {
          contents: [{ id: 'eff1', statuses: new Set(['prone']), name: 'Prone' }],
        },
      };
      token = { id: 'tok1', name: 'Fighter', actor };
      (globalThis as any).game.scenes = {
        current: { tokens: { get: () => token } },
      };
      dataAccess = new FoundryDataAccess();
    });

    it('still applies the condition as an ActiveEffect', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: true,
      });

      expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', [
        expect.objectContaining({ statuses: ['prone'] }),
      ]);
      expect(result.success).toBe(true);
    });

    it('still removes the condition by deleting the matching ActiveEffect', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: false,
      });

      expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff1']);
      expect(result.success).toBe(true);
    });
  });
});
