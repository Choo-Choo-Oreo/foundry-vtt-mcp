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
 *
 * Round 14 (2026-09-10) found the generic/D&D5e branch built above (a
 * hand-built ActiveEffect, matched by an unbounded `effect.statuses?.has(id)`
 * scan with no size check) was a real, destructive divergence from core
 * Foundry's own generic Actor#toggleStatusEffect (client/documents/
 * actor.mjs:552-584, actually-installed v14.361.0 client): D&D5e's
 * paralyzed/petrified/stunned status configs each declare an implicit
 * companion status (`statuses: ["incapacitated"]`, dnd5e.mjs ~47242-47279)
 * that a real effect's `.statuses` Set carries alongside the primary id
 * (active-effect.mjs ~127-138) - so the old unbounded scan, asked to remove
 * "incapacitated" while the actor was actually "paralyzed", matched the
 * paralyzed effect's `.statuses` Set (which contains "incapacitated" too)
 * and deleted the WHOLE paralyzed effect, silently un-paralyzing the actor
 * as a side effect of a call that only asked to clear "incapacitated" -
 * while the response still unconditionally claimed only "incapacitated" was
 * removed. Core Foundry's real method avoids this by looking the effect up
 * via the status's own static `_id` first (D&D5e sets one on every entry,
 * dnd5e.mjs ~82738) and restricting its no-`_id` fallback scan to
 * `statuses.size === 1` (actor.mjs:557-568) - a compound effect is never a
 * match for one of its component statuses. Fixed by delegating the
 * generic/D&D5e ADD and REMOVE branches to `actor.toggleStatusEffect(id,
 * {active})` itself, and by resolving the omitted-`active` current-state
 * check via the real aggregate `Actor#statuses` Set (actor.mjs ~94-97,260)
 * instead of the same unbounded scan, falling back to the old hand-rolled
 * behavior only for an Actor with no `toggleStatusEffect`/`.statuses` at
 * all (not expected on any v11+ system).
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

  describe('generic system with no actor.toggleStatusEffect (last-resort fallback, not expected on any real v11+ system)', () => {
    let actor: any;
    let token: any;

    beforeEach(() => {
      // Core Foundry / D&D5e's CONFIG.statusEffects is an array. This mock
      // actor deliberately omits toggleStatusEffect to exercise the
      // last-resort hand-built-ActiveEffect branch - round 14 found real
      // D&D5e actors always have toggleStatusEffect (dnd5e.mjs ~39476, an
      // override of the core method), so this path is a defensive fallback
      // only, not what a real D&D5e/dnd5e-like actor hits. See the
      // "dnd5e (round 14" describe block below for the realistic case.
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

    it('applies the condition as a hand-built ActiveEffect when actor.toggleStatusEffect is unavailable', async () => {
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

    it('removes the condition by scanning+deleting the matching ActiveEffect when actor.toggleStatusEffect is unavailable', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'prone',
        active: false,
      });

      expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith('ActiveEffect', ['eff1']);
      expect(result.success).toBe(true);
    });

    it('with `active` omitted, removes the condition by scanning actor.effects when no actor.statuses Set exists (round 13)', async () => {
      // No actor.statuses Set on this mock either, so round 14's preferred
      // resolution path also falls back to the same effects-array scan the
      // existing remove branch already uses.
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

  describe('dnd5e (round 14: real actor.toggleStatusEffect delegation)', () => {
    let toggleStatusEffect: ReturnType<typeof vi.fn>;
    let actor: any;
    let token: any;

    beforeEach(() => {
      // A realistic D&D5e-like actor: toggleStatusEffect exists (every real
      // Actor inherits or overrides it, dnd5e.mjs ~39476-39486), so this must
      // be preferred over the last-resort hand-built-ActiveEffect branch.
      stubGame('dnd5e', [
        { id: 'incapacitated', name: 'Incapacitated', icon: 'incapacitated.webp' },
      ]);
      toggleStatusEffect = vi.fn(async () => true);
      actor = {
        toggleStatusEffect,
        createEmbeddedDocuments: vi.fn(),
        deleteEmbeddedDocuments: vi.fn(),
        // A real "paralyzed" ActiveEffect's .statuses Set also carries its
        // implicit companion status "incapacitated" (dnd5e.mjs
        // ~47242-47279 declares `statuses: ["incapacitated"]` on the
        // paralyzed/petrified/stunned configs; ActiveEffect.fromStatusEffect
        // folds it in, active-effect.mjs ~127-138) - present here purely to
        // prove the fix never reaches the old unbounded scan that would have
        // matched and deleted this whole compound effect.
        effects: {
          contents: [{ id: 'eff-paralyzed', statuses: new Set(['paralyzed', 'incapacitated']) }],
        },
      };
      token = { id: 'tok1', name: 'Fighter', actor };
      (globalThis as any).game.scenes = {
        current: { tokens: { get: () => token } },
      };
      dataAccess = new FoundryDataAccess();
    });

    it('applies a condition via actor.toggleStatusEffect, not a hand-built ActiveEffect', async () => {
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'incapacitated',
        active: true,
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('incapacitated', { active: true });
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('removes a condition via actor.toggleStatusEffect, never by scanning+deleting a compound effect it belongs to (round 14 regression)', async () => {
      // Before the fix: the old unbounded `effect.statuses?.has(id)` scan
      // would match this "paralyzed" effect (its Set contains
      // "incapacitated" too) and delete the WHOLE effect, silently
      // un-paralyzing the actor for a call that only asked to clear
      // "incapacitated". The fix must delegate to toggleStatusEffect and
      // never call deleteEmbeddedDocuments directly here.
      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'incapacitated',
        active: false,
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('incapacitated', { active: false });
      expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
    });

    it('with `active` omitted, resolves current state via the real aggregate actor.statuses Set, not the unbounded effects scan (round 14)', async () => {
      // actor.statuses (client/documents/actor.mjs ~94-97,260) is the real
      // "is this status currently in effect, from any source" answer -
      // populated from every effect's own .statuses during
      // applyActiveEffects. Here it says "incapacitated" is NOT active even
      // though a compound effect's .statuses Set contains it, which is
      // exactly the case the old unbounded scan would have gotten wrong.
      actor.statuses = new Set(['paralyzed']);

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'incapacitated',
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('incapacitated', { active: true });
      expect(result.isActive).toBe(true);
    });

    it('with `active` omitted and actor.statuses showing the condition active, toggles it off via toggleStatusEffect (round 14)', async () => {
      actor.statuses = new Set(['paralyzed', 'incapacitated']);

      const result = await dataAccess.toggleTokenCondition({
        tokenId: 'tok1',
        conditionId: 'incapacitated',
      });

      expect(toggleStatusEffect).toHaveBeenCalledWith('incapacitated', { active: false });
      expect(result.isActive).toBe(false);
    });
  });
});
