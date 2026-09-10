/**
 * GM-gating coverage for get-module-diagnostics, added after audit round 2
 * found it was the only manageCombat/listChatLog/chat-adjacent handler
 * missing the validateGMAccess() check every sibling uses.
 */

import { describe, it, expect, vi } from 'vitest';
import { QueryHandlers } from './queries.js';

function stubGame(isGM: boolean) {
  // PersistentCreatureIndex registers Hooks.on(...) at construction time
  // (data-access.ts:491), so Hooks must exist before `new QueryHandlers()`.
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: isGM ? 'gm1' : 'p1', name: isGM ? 'GM' : 'Player', isGM },
    modules: { values: () => [] },
    version: '14.0.0',
    system: { id: 'pf2e', version: '8.5.0' },
  };
}

describe('QueryHandlers.handleGetModuleDiagnostics gating', () => {
  let handlers: QueryHandlers;

  it('denies a non-GM user without calling dataAccess', async () => {
    stubGame(false);
    handlers = new QueryHandlers();
    const spy = vi.spyOn(handlers.dataAccess, 'getModuleDiagnostics');

    const result = await (handlers as any).handleGetModuleDiagnostics({});

    expect(result).toEqual({ error: 'Access denied', success: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('serves a GM user', async () => {
    stubGame(true);
    handlers = new QueryHandlers();
    const spy = vi.spyOn(handlers.dataAccess, 'getModuleDiagnostics').mockResolvedValue({
      foundryVersion: '14.0.0',
      system: { id: 'pf2e', version: '8.5.0' },
      modules: [],
      recentErrors: [],
    });

    const result = await (handlers as any).handleGetModuleDiagnostics({ limit: 10 });

    expect(spy).toHaveBeenCalledWith({ limit: 10 });
    expect(result.foundryVersion).toBe('14.0.0');
  });
});
