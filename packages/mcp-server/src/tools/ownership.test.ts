/**
 * assign-actor-ownership / remove-actor-ownership tests.
 *
 * Round 18 finding: passing a GM's own name (or any identifier that matches
 * nothing) as `playerIdentifier` silently returned `{ success: false,
 * message: "0 ownership assignments completed" }` with no indication of why —
 * indistinguishable from every write having failed. The root cause is that
 * `findPlayers` (packages/foundry-module/src/data-access.ts, `if (user.isGM)
 * continue;`) unconditionally excludes GM users from matching, by design: a
 * GM already owns everything and cannot be assigned ownership through this
 * permission map. That exclusion is correct, but the tool layer never said so
 * — it just fell through the empty `players` array to a 0/0 bulk-op summary.
 *
 * These tests pin the fix: an empty actor or player resolution is now reported
 * as its own explicit `error`, before the bulk-operation and write-loop logic
 * ever runs, and the write loop never runs when nothing was found.
 */

import { describe, it, expect, vi } from 'vitest';
import { OwnershipTools } from './ownership.js';

function makeLogger(): any {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  return logger;
}

/** A query stub that resolves per-method, so resolveActors/resolvePlayers behave realistically. */
function makeQuery(responses: Record<string, any>) {
  return vi.fn(async (method: string) => {
    if (method in responses) return responses[method];
    throw new Error(`unexpected query: ${method}`);
  });
}

function makeTools(responses: Record<string, any>) {
  const query = makeQuery(responses);
  const tools = new OwnershipTools({ foundryClient: { query } as any, logger: makeLogger() });
  return { tools, query };
}

describe('assign-actor-ownership — nothing matched is reported, not silently swallowed', () => {
  it('errors when the player identifier matches no one (e.g. it names the GM)', async () => {
    const { tools, query } = makeTools({
      'foundry-mcp-bridge.findActor': { id: 'actor1', name: 'Aragorn' },
      // findPlayers excludes GMs unconditionally — a GM's own name matches nothing.
      'foundry-mcp-bridge.findPlayers': [],
    });

    const result: any = await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'Oreodaphne', // the GM's own account name
      permissionLevel: 'OWNER',
    });

    expect(result.success).toBe(false);
    expect(result.actorsFound).toBe(1);
    expect(result.playersFound).toBe(0);
    expect(result.error).toMatch(/no player matched "Oreodaphne"/);
    expect(result.error).toMatch(/GM/i);

    // The write path must never have been reached.
    const wrote = query.mock.calls.some(
      ([method]) => method === 'foundry-mcp-bridge.setActorOwnership'
    );
    expect(wrote).toBe(false);
  });

  it('errors when the actor identifier matches no one', async () => {
    const { tools, query } = makeTools({
      'foundry-mcp-bridge.findActor': null,
      'foundry-mcp-bridge.findPlayers': [{ id: 'user1', name: 'John' }],
    });

    const result: any = await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Nobody',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    expect(result.success).toBe(false);
    expect(result.actorsFound).toBe(0);
    expect(result.playersFound).toBe(1);
    expect(result.error).toMatch(/no actor matched "Nobody"/);

    const wrote = query.mock.calls.some(
      ([method]) => method === 'foundry-mcp-bridge.setActorOwnership'
    );
    expect(wrote).toBe(false);
  });

  it('reports both missing sides at once when neither resolves', async () => {
    const { tools } = makeTools({
      'foundry-mcp-bridge.findActor': null,
      'foundry-mcp-bridge.findPlayers': [],
    });

    const result: any = await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Nobody',
      playerIdentifier: 'Oreodaphne',
      permissionLevel: 'OWNER',
    });

    expect(result.error).toMatch(/no actor matched "Nobody"/);
    expect(result.error).toMatch(/no player matched "Oreodaphne"/);
  });

  it('still performs the write when both sides resolve to exactly one match', async () => {
    const { tools, query } = makeTools({
      'foundry-mcp-bridge.findActor': { id: 'actor1', name: 'Aragorn' },
      'foundry-mcp-bridge.findPlayers': [{ id: 'user1', name: 'John' }],
      'foundry-mcp-bridge.setActorOwnership': { success: true, message: 'ok' },
    });

    const result: any = await tools.handleToolCall('assign-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'John',
      permissionLevel: 'OWNER',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('1 ownership assignments completed');
    const wrote = query.mock.calls.some(
      ([method]) => method === 'foundry-mcp-bridge.setActorOwnership'
    );
    expect(wrote).toBe(true);
  });
});

describe('remove-actor-ownership — inherits the same not-found reporting', () => {
  it('errors instead of reporting "0 completed" when the player cannot be found', async () => {
    const { tools, query } = makeTools({
      'foundry-mcp-bridge.findActor': { id: 'actor1', name: 'Aragorn' },
      'foundry-mcp-bridge.findPlayers': [],
    });

    const result: any = await tools.handleToolCall('remove-actor-ownership', {
      actorIdentifier: 'Aragorn',
      playerIdentifier: 'Oreodaphne',
      confirmRemoval: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no player matched "Oreodaphne"/);
    const wrote = query.mock.calls.some(
      ([method]) => method === 'foundry-mcp-bridge.setActorOwnership'
    );
    expect(wrote).toBe(false);
  });
});
