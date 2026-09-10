/**
 * Coverage for FoundryDataAccess.useItem's target-resolution path, added by
 * audit round 16 (2026-09-10) after a live stress-test call
 * (`use-item` with `targets: ["self"]`) crashed with
 * "game.user.updateTokenTargets is not a function".
 *
 * Root cause, confirmed against the actually-installed Foundry v14.361.0
 * client source: `User#updateTokenTargets` does not exist anywhere in the
 * real client. `client/documents/user.mjs` only defines the private
 * `_onUpdateTokenTargets`, which `TokenLayer#setTargets`
 * (client/canvas/layers/tokens.mjs ~335-351) calls internally after
 * resolving each id against its own placeables and broadcasting the change.
 * The real public entry point - the same one `Token#setTarget` itself
 * delegates to (client/canvas/placeables/token.mjs ~3780-3784) - is
 * `canvas.tokens.setTargets(ids, {mode})`, a synchronous call with no
 * Promise. Fixed by calling that instead of the nonexistent method.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { specialStatusEffects: { DEFEATED: 'dead' }, statusEffects: {} };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    system: { id: 'pf2e' },
    settings: { get: () => true },
    ...overrides,
  };
}

describe('FoundryDataAccess.useItem targeting', () => {
  let dataAccess: FoundryDataAccess;
  let selfToken: any;
  let actor: any;
  let item: any;
  let setTargets: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    item = { id: 'item1', name: 'Bone Saw', type: 'weapon', roll: vi.fn(async () => undefined) };
    actor = { id: 'actor1', name: 'The Butcher', items: { find: (fn: any) => [item].find(fn) } };
    selfToken = { id: 'tok-self', name: 'The Butcher', actor, actorId: 'actor1' };

    stubGame({
      actors: {
        get: () => undefined,
        getName: () => actor,
        [Symbol.iterator]: [actor][Symbol.iterator],
      },
      scenes: {
        active: { tokens: [selfToken] },
      },
    });

    setTargets = vi.fn();
    (globalThis as any).canvas = { tokens: { setTargets } };

    dataAccess = new FoundryDataAccess();
  });

  it('resolves "self" to the caster token and calls canvas.tokens.setTargets, not the nonexistent game.user.updateTokenTargets', async () => {
    const result = await dataAccess.useItem({
      actorIdentifier: 'The Butcher',
      itemIdentifier: 'Bone Saw',
      targets: ['self'],
    });

    expect(setTargets).toHaveBeenCalledWith(['tok-self'], { mode: 'replace' });
    expect((globalThis as any).game.user.updateTokenTargets).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.targets).toEqual(['The Butcher']);
  });

  it('throws a clear error instead of crashing when the canvas token layer is unavailable', async () => {
    (globalThis as any).canvas = {};

    await expect(
      dataAccess.useItem({
        actorIdentifier: 'The Butcher',
        itemIdentifier: 'Bone Saw',
        targets: ['self'],
      })
    ).rejects.toThrow('Canvas token layer is not available to set targets');

    expect(setTargets).not.toHaveBeenCalled();
  });

  it('does not touch canvas.tokens at all when no targets are given', async () => {
    const result = await dataAccess.useItem({
      actorIdentifier: 'The Butcher',
      itemIdentifier: 'Bone Saw',
    });

    expect(setTargets).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.targets).toBeUndefined();
  });
});
