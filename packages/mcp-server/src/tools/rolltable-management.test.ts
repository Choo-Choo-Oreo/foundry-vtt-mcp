/**
 * manage-rolltables tool tests.
 *
 * The RollTable work happens browser-side (in the Foundry module); these cover
 * the MCP tool layer: per-action schema validation and forwarding to the
 * `manageRollTables` bridge query.
 */

import { describe, it, expect, vi } from 'vitest';
import { RollTableManagementTools } from './rolltable-management.js';

function makeTools(impl?: (data: any) => unknown) {
  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.manageRollTables') {
      return impl ? impl(data) : { ok: true, echo: data };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return {
    tools: new RollTableManagementTools({ foundryClient: { query } as any, logger }),
    query,
  };
}

describe('RollTableManagementTools', () => {
  it('exposes manage-rolltables with the full action set', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('manage-rolltables');
    expect(def.inputSchema.properties.action.enum).toEqual([
      'create',
      'list',
      'get',
      'update',
      'move',
      'delete',
      'roll',
    ]);
  });

  it('forwards a valid create with results', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageRollTables({
      action: 'create',
      name: 'Circus Mishaps',
      results: [{ text: 'A juggling pin goes wide' }, { text: 'The tent collapses', weight: 2 }],
    });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.manageRollTables',
      expect.objectContaining({ action: 'create', name: 'Circus Mishaps' })
    );
  });

  it('rejects create without results', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageRollTables({ action: 'create', name: 'Empty' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects get without an id', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageRollTables({ action: 'get' })).rejects.toThrow();
  });

  it('rejects delete without ids', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageRollTables({ action: 'delete', ids: [] })).rejects.toThrow();
  });

  it('rejects move without a folder', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageRollTables({ action: 'move', id: 'abc' })).rejects.toThrow();
  });

  it('rejects an unknown result-row key (strict rows)', async () => {
    const { tools } = makeTools();
    await expect(
      tools.handleManageRollTables({
        action: 'create',
        name: 'T',
        results: [{ text: 'x', chance: 5 }],
      })
    ).rejects.toThrow();
  });

  it('forwards roll with count and surfaces bridge errors', async () => {
    const { tools } = makeTools(() => {
      throw new Error('table exhausted');
    });
    await expect(
      tools.handleManageRollTables({ action: 'roll', id: 'abc', count: 3 })
    ).rejects.toThrow(/table exhausted/);
  });
});
