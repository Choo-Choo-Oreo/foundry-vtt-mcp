/**
 * delete-compendium-pack tests.
 *
 * This tool is a thin forwarder — the pack resolution, the world-only refusal and the
 * count check all live Foundry-side in `data-access.ts`, which has no test harness in
 * this repo (only `packages/mcp-server` runs vitest). Those three are verified live
 * against a real world instead.
 *
 * What IS testable here is the part that would be catastrophic and silent: the default.
 * `dryRun` defaults to true, so a first call reports and deletes nothing. If that
 * default ever inverted — a flipped comparison, a `?? true` becoming `?? false`, a
 * refactor that drops the flag from the payload so the Foundry side sees `undefined` —
 * the tool would typecheck, every existing call would still "work", and the first
 * person to ask what is inside a pack would destroy it. Nothing else in the suite
 * would notice. So these tests assert the wire payload, not just the return value.
 */

import { describe, it, expect, vi } from 'vitest';
import { CompendiumDeleteTools } from './compendium-delete.js';

function makeLogger(): any {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  return logger;
}

function makeTools(reply: any = { success: true, dryRun: true, deleted: false, entryCount: 3 }) {
  const query = vi.fn(async () => reply);
  const tools = new CompendiumDeleteTools({
    foundryClient: { query } as any,
    logger: makeLogger(),
  });
  return { tools, query };
}

/** The payload the Foundry side actually received. */
function sentPayload(query: any): any {
  return query.mock.calls[0][1];
}

describe('delete-compendium-pack — the default deletes nothing', () => {
  it('sends dryRun: true when the caller omits it', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteCompendiumPack({ pack: 'world.scratch' });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteCompendiumPack', {
      pack: 'world.scratch',
      dryRun: true,
    });
  });

  it('sends dryRun explicitly rather than leaving it undefined', async () => {
    // An omitted flag would be read as "not a dry run" by any code that checks
    // `=== false` on the far side. It must be on the wire, not implied.
    const { tools, query } = makeTools();
    await tools.handleDeleteCompendiumPack({ pack: 'world.scratch' });

    expect(Object.keys(sentPayload(query))).toContain('dryRun');
    expect(sentPayload(query).dryRun).toBe(true);
  });

  it('treats any value other than false as a dry run', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteCompendiumPack({ pack: 'world.scratch', dryRun: true });

    expect(sentPayload(query).dryRun).toBe(true);
  });

  it('does not smuggle expectedEntryCount into a dry run it was not given', async () => {
    const { tools, query } = makeTools();
    await tools.handleDeleteCompendiumPack({ pack: 'world.scratch' });

    expect(sentPayload(query)).not.toHaveProperty('expectedEntryCount');
  });
});

describe('delete-compendium-pack — deleting for real', () => {
  it('forwards dryRun: false with the expected count', async () => {
    const { tools, query } = makeTools({ success: true, deleted: true, entriesDeleted: 3 });
    await tools.handleDeleteCompendiumPack({
      pack: 'world.scratch',
      dryRun: false,
      expectedEntryCount: 3,
    });

    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteCompendiumPack', {
      pack: 'world.scratch',
      dryRun: false,
      expectedEntryCount: 3,
    });
  });

  it('passes a zero count through instead of dropping it as falsy', async () => {
    // An empty pack is a legitimate delete. `if (count)` would silently turn this
    // into "no count supplied", which the Foundry side rejects — a confusing failure
    // on the one case where the user is most obviously right.
    const { tools, query } = makeTools({ success: true, deleted: true, entriesDeleted: 0 });
    await tools.handleDeleteCompendiumPack({
      pack: 'world.empty',
      dryRun: false,
      expectedEntryCount: 0,
    });

    expect(sentPayload(query).expectedEntryCount).toBe(0);
  });

  it('rejects a fractional count before it reaches Foundry', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleDeleteCompendiumPack({
        pack: 'world.scratch',
        dryRun: false,
        expectedEntryCount: 2.5,
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a negative count before it reaches Foundry', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleDeleteCompendiumPack({
        pack: 'world.scratch',
        dryRun: false,
        expectedEntryCount: -1,
      })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('delete-compendium-pack — input handling', () => {
  it('requires a pack', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleDeleteCompendiumPack({})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an empty pack name rather than resolving it to something', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleDeleteCompendiumPack({ pack: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a Foundry-side refusal as an error, not a quiet success', async () => {
    const query = vi.fn(async () => {
      throw new Error('Refusing to delete "pf2e.classes": it belongs to the system "pf2e"');
    });
    const tools = new CompendiumDeleteTools({
      foundryClient: { query } as any,
      logger: makeLogger(),
    });

    await expect(tools.handleDeleteCompendiumPack({ pack: 'pf2e.classes' })).rejects.toThrow(
      /belongs to the system/
    );
  });
});

describe('delete-compendium-pack — the tool description carries the contract', () => {
  const def = new CompendiumDeleteTools({
    foundryClient: { query: vi.fn() } as any,
    logger: makeLogger(),
  }).getToolDefinitions()[0]!;

  it('is the only tool this file exposes', () => {
    expect(def.name).toBe('delete-compendium-pack');
  });

  it('states that the default is a dry run', () => {
    // The description is the only thing a model reads before calling. If it stops
    // saying this, the tool is a loaded gun with no label on it.
    expect(def.description).toMatch(/DEFAULT IS A DRY RUN/);
  });

  it('states that there is no undo and no backup', () => {
    expect(def.description).toMatch(/no undo/i);
    expect(def.description).toMatch(/no automatic backup/i);
  });

  it('tells the caller to ask the user first', () => {
    expect(def.description).toMatch(/Ask the user/i);
  });

  it('names the world-only limit', () => {
    expect(def.description).toMatch(/world\.\*/);
  });

  it('points at the editing path so delete is not the default answer', () => {
    expect(def.description).toMatch(/foundry-docs recipes/);
  });

  it('takes pack as the only required argument, so the safe call is the short one', () => {
    expect((def.inputSchema as any).required).toEqual(['pack']);
  });
});
