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
 *
 * Round 12 (2026-09-10) found round 11's dsa5 REMOVE fix was itself
 * incomplete: `actor.removeCondition(id)` defaults to decrementing a leveled
 * condition by one level (dsa5.js `removeEffect`: `auto: Math.max(0,
 * current.auto - 1)`), only deleting the ActiveEffect once both its `auto`
 * and `manual` stacks reach zero - so removing a condition currently above
 * level 1 left it partially active while the tool still reported
 * `isActive: false`. Fixed by looking the effect up via `hasCondition()` and
 * deleting it outright (mirroring pf2e's own `{forceRemove: true}` on
 * toggle-off, pf2e.mjs ~32165), instead of asking removeCondition to
 * decrement it to zero one call at a time. The ADD side (`addCondition`) is
 * unchanged - it was already correct.
 *
 * Round 13 (2026-09-10) found the mcp-server tool's own documented contract
 * was unreachable: the 'toggle-token-condition' description promises "If not
 * specified, will toggle the current state" for `active`, but
 * queries.ts's handleToggleTokenCondition() unconditionally threw
 * `active must be a boolean` for a missing `active`, before this method ever
 * ran - no code anywhere computed a current-state flip. Fixed by relaxing
 * that guard to allow an omitted `active` and resolving it here: pf2e/dsa5
 * both expose a public `actor.hasCondition(id)` (used to detect current
 * state), everything else reuses the same effects-array scan the generic
 * remove branch already does.
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
    let hasCondition: ReturnType<typeof vi.fn>;
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
      // Real ActorPF2e#hasCondition (pf2e.mjs ~1160115:
      // `hasCondition(...e){return e.some(e=>this.conditions.hasType(e))}`) -
      // used by round 13's toggle-if-`active`-omitted resolution, not by any
      // apply/remove branch itself. Defaults to "not currently active".
      hasCondition = vi.fn(() => false);
      actor = {
        toggleCondition,
        toggleStatusEffect,
        hasCondition,
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

    it('with `active` omitted, applies the condition when actor.hasCondition() says it is not currently active (round 13)', async () => {
      hasCondition.mockReturnValue(false);

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
      });

      expect(hasCondition).toHaveBeenCalledWith('prone');
      expect(toggleStatusEffect).toHaveBeenCalledWith('prone', { active: true });
      expect(result.isActive).toBe(true);
      expect(result.active).toBe(true);
    });

    it('with `active` omitted, removes the condition when actor.hasCondition() says it is currently active (round 13)', async () => {
      hasCondition.mockReturnValue(true);

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
      });

      expect(hasCondition).toHaveBeenCalledWith('prone');
      expect(toggleStatusEffect).toHaveBeenCalledWith('prone', { active: false });
      expect(result.isActive).toBe(false);
      expect(result.active).toBe(false);
    });
  });

  describe('dsa5', () => {
    let addCondition: ReturnType<typeof vi.fn>;
    let removeCondition: ReturnType<typeof vi.fn>;
    let actor: any;
    let token: any;

    let hasCondition: ReturnType<typeof vi.fn>;
    let deleteEmbeddedDocuments: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // dsa5's CONFIG.statusEffects is a plain array, like core Foundry/D&D5e.
      stubGame('dsa5', [{ id: 'stunned', name: 'CONDITION.stunned', icon: 'stunned.webp' }]);
      addCondition = vi.fn(async () => [{}]);
      removeCondition = vi.fn(async () => [{}]);
      hasCondition = vi.fn(() => false);
      deleteEmbeddedDocuments = vi.fn();
      actor = {
        addCondition,
        removeCondition,
        hasCondition,
        createEmbeddedDocuments: vi.fn(),
        deleteEmbeddedDocuments,
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

    it('removes a boolean condition by deleting the ActiveEffect hasCondition finds, not via removeCondition', async () => {
      // hasCondition() found nothing (default stub) - no effect to delete,
      // and removeCondition (a decrement, not a clear) must not be called.
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
        active: false,
      });

      expect(hasCondition).toHaveBeenCalledWith('stunned');
      expect(removeCondition).not.toHaveBeenCalled();
      expect(deleteEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(false);
    });

    it('fully removes a LEVELED condition in one call, instead of decrementing it by one level (round 12 regression)', async () => {
      // dsa5's own Actor#removeCondition(id) defaults to level=1 and only
      // decrements a leveled condition's stack (dsa5.js removeEffect:
      // `auto: Math.max(0, current.auto - 1)`), leaving e.g. Fear at level 2
      // still active after one call while the tool claims `isActive: false`.
      // hasCondition() returns the actual ActiveEffect document (with an id)
      // when a leveled condition - currently at any stack above zero - is
      // present; the fix must delete it outright rather than decrementing.
      hasCondition.mockReturnValue({ id: 'eff-fear-lvl2', system: { condition: { value: 2 } } });

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
        active: false,
      });

      expect(hasCondition).toHaveBeenCalledWith('stunned');
      expect(removeCondition).not.toHaveBeenCalled();
      expect(deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff-fear-lvl2']);
      expect(result.success).toBe(true);
      expect(result.isActive).toBe(false);
    });

    it('with `active` omitted, applies via addCondition when actor.hasCondition() says it is not currently active (round 13)', async () => {
      hasCondition.mockReturnValue(false);

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
      });

      expect(hasCondition).toHaveBeenCalledWith('stunned');
      expect(addCondition).toHaveBeenCalledWith('stunned');
      expect(result.isActive).toBe(true);
    });

    it('with `active` omitted, removes via the hasCondition()+delete path when currently active (round 13)', async () => {
      hasCondition.mockReturnValue({ id: 'eff-stunned' });

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'stunned',
      });

      expect(deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff-stunned']);
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

    it('with `active` omitted, removes the condition by scanning actor.effects when it is already present (round 13)', async () => {
      // The beforeEach effects.contents already carries a matching 'prone'
      // ActiveEffect - the generic branch has no hasCondition() to call, so
      // round 13's toggle-resolution must fall back to the same
      // effects-array scan the existing remove branch already uses.
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
      });

      expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff1']);
      expect(result.isActive).toBe(false);
    });

    it('with `active` omitted, applies the condition via ActiveEffect when not present in actor.effects (round 13)', async () => {
      actor.effects.contents = [];

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
      });

      expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', [
        expect.objectContaining({ statuses: ['prone'] }),
      ]);
      expect(result.isActive).toBe(true);
    });
  });
});
