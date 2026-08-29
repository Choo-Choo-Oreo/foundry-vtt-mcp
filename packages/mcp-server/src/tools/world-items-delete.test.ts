/**
 * manage-world-items "delete" action tests.
 *
 * The deletion itself runs browser-side (data-access.deleteWorldItems), so these
 * cover the MCP tool layer: the action is advertised, a valid call forwards to
 * the GM-gated deleteWorldItems bridge query, and an empty/missing id list is
 * rejected before any query goes out.
 *
 * Deleting a standalone world Item was previously impossible via any tool —
 * "remove-from-actor" only detaches items already embedded on an actor — so the
 * separation between those two actions is asserted here explicitly.
 */

import { describe, it, expect, vi } from 'vitest';
import { CharacterTools } from './character.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async () => ({
        deleted: [{ id: 'i1', name: 'Junk Item', type: 'feat' }],
        total: 1,
      }))
  );
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  const tools = new CharacterTools({ foundryClient, logger });
  return { tools, query };
}

function worldItemsDef(tools: CharacterTools): any {
  return tools.getToolDefinitions().find((d: any) => d.name === 'manage-world-items');
}

describe('manage-world-items delete action', () => {
  it('advertises "delete" in the action enum', () => {
    const { tools } = makeTools();
    expect(worldItemsDef(tools).inputSchema.properties.action.enum).toContain('delete');
  });

  it('exposes an "ids" parameter for the delete action', () => {
    const { tools } = makeTools();
    const props = worldItemsDef(tools).inputSchema.properties;
    expect(props.ids).toBeDefined();
    expect(props.ids.type).toBe('array');
  });

  it('forwards a valid delete to the deleteWorldItems bridge query', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageWorldItems({
      action: 'delete',
      ids: ['i1', 'i2'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.deleteWorldItems', {
      ids: ['i1', 'i2'],
    });
    expect(result.total).toBe(1);
  });

  it('rejects an empty ids array without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'delete', ids: [] })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a delete with no ids at all without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageWorldItems({ action: 'delete' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a bridge-side "not found" as a failure rather than a silent success', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('Not found in the world Items directory: bogus. Nothing was deleted.');
    });
    await expect(
      tools.handleManageWorldItems({ action: 'delete', ids: ['bogus'] })
    ).rejects.toThrow(/Nothing was deleted/);
  });

  it('does not route delete through the actor-scoped removeActorItems query', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageWorldItems({ action: 'delete', ids: ['i1'] });
    const methods = query.mock.calls.map(c => c[0]);
    expect(methods).toContain('foundry-mcp-bridge.deleteWorldItems');
    expect(methods).not.toContain('foundry-mcp-bridge.removeActorItems');
  });
});
