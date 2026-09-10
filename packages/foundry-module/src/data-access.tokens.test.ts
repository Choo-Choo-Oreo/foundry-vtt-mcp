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
 *
 * Updated by audit round 11 (2026-09-10): round 10's fix called
 * `actor.toggleCondition(id, ...)` directly. That throws
 * `ErrorPF2e("Unrecognized condition: dead")` for any status slug outside the
 * 44-entry set ActorPF2e#toggleCondition validates against (pf2e.mjs ~2895,
 * ~32160-32164) - which excludes "dead", a status pf2e itself adds to
 * CONFIG.statusEffects (pf2e.mjs #updateStatusIcons) and that
 * getAvailableConditions() (this same file) offers back to a caller as a
 * normal condition id for a pf2e world. Fixed by calling
 * `actor.toggleStatusEffect(id, ...)` instead - ActorPF2e's own override of
 * that method (pf2e.mjs ~32166-32168) already dispatches real conditions to
 * `toggleCondition` and anything else (namely "dead") to core Foundry's
 * generic Actor#toggleStatusEffect (client/documents/actor.mjs:552), so no
 * special-casing is needed at the call site.
 *
 * Round 11 also found the identical bug class in the dsa5 branch, previously
 * assumed correct: dsa5 (now installed locally, unlike prior rounds) also
 * manages conditions through its own Actor#addCondition/removeCondition/
 * hasCondition API (system/bundle/modules/dsa5.js), not a hand-built
 * ActiveEffect - many dsa5 conditions are leveled/stacking and get a computed
 * `system.condition = {max, auto, manual, value}` block that the old
 * hand-built effect never set. Fixed the same way as pf2e: route dsa5 through
 * its own actor methods instead of reimplementing them.
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
    let toggleStatusEffect: ReturnType<typeof vi.fn>;
    let actor: any;
    let token: any;

    beforeEach(() => {
      // pf2e's real CONFIG.statusEffects is a slug-keyed object, not an array
      // (pf2e.mjs #updateStatusIcons, ~line 110174), and includes "dead" - a
      // status pf2e adds by hand that is NOT a real toggleCondition-able
      // condition (pf2e.mjs ~2895's `un` set has no "dead" entry).
      stubGame('pf2e', {
        prone: { id: 'prone', name: 'PF2E.condition.prone.name', img: 'prone.webp' },
        dead: { id: 'dead', name: 'PF2E.Actor.Dead', img: 'dead.webp' },
      });
      // toggleCondition exists only so the bridge's isPf2e guard
      // (`typeof actor.toggleCondition === 'function'`) is satisfied, matching
      // a real ActorPF2e instance. The bridge must not call it directly -
      // only toggleStatusEffect, which is what ActorPF2e's own dispatch uses.
      toggleCondition = vi.fn(async () => true);
      toggleStatusEffect = vi.fn(async () => true);
      actor = {
        toggleCondition,
        toggleStatusEffect,
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

    it('applies a condition via actor.toggleStatusEffect, not an ActiveEffect or toggleCondition directly', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: true,
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('prone', { active: true });
      expect(toggleCondition).not.toHaveBeenCalled();
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('removes a condition via actor.toggleStatusEffect, not by scanning ActiveEffects', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: false,
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('prone', { active: false });
      expect(toggleCondition).not.toHaveBeenCalled();
      expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(false);
    });

    it('toggles "dead" via toggleStatusEffect without throwing (regression: direct toggleCondition("dead") throws ErrorPF2e)', async () => {
      // getAvailableConditions() offers "dead" back as a normal condition id
      // for a pf2e world (it lists every CONFIG.statusEffects entry with no
      // filter), so a caller following that workflow can reach this. Calling
      // actor.toggleCondition('dead', ...) directly throws
      // `ErrorPF2e("Unrecognized condition: dead")` per pf2e.mjs
      // ~32160-32164; toggleStatusEffect must be used instead so pf2e's own
      // dispatch (pf2e.mjs ~32166-32168) can fall through to core Foundry's
      // generic status-effect handling for it.
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'dead',
        active: true,
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('dead', { active: true });
      expect(toggleCondition).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });
  });

  describe('dsa5', () => {
    let addCondition: ReturnType<typeof vi.fn>;
    let removeCondition: ReturnType<typeof vi.fn>;
    let actor: any;
    let token: any;

    beforeEach(() => {
      // dsa5's CONFIG.statusEffects is a plain array, like core Foundry/D&D5e.
      stubGame('dsa5', [{ id: 'stunned', name: 'CONDITION.stunned', icon: 'stunned.webp' }]);
      addCondition = vi.fn(async () => [{}]);
      removeCondition = vi.fn(async () => [{}]);
      actor = {
        addCondition,
        removeCondition,
        createEmbeddedDocuments: vi.fn(),
        deleteEmbeddedDocuments: vi.fn(),
        effects: { contents: [] },
      };
      token = { id: 'tok1', name: 'Held', actor };
      (globalThis as any).game.scenes = {
        current: { tokens: { get: () => token } },
      };
      dataAccess = new FoundryDataAccess();
    });

    it('applies a condition via actor.addCondition, not a hand-built ActiveEffect', async () => {
      // dsa5's own Actor#addCondition (delegating to its condition-manager
      // module) computes leveled/stacking system.condition data
      // (system/bundle/modules/dsa5.js createEffect()) that a hand-built
      // ActiveEffect never set - see the fix comment in data-access.ts
      // toggleTokenCondition() for the full citation.
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
        active: true,
      });

      expect(addCondition).toHaveBeenCalledWith('stunned');
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(true);
    });

    it('removes a condition via actor.removeCondition, not by scanning ActiveEffects', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
        active: false,
      });

      expect(removeCondition).toHaveBeenCalledWith('stunned');
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
