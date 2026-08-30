/**
 * manage-macros tool tests.
 *
 * Execution happens browser-side; these cover the MCP tool layer: per-action
 * schema validation and forwarding to the `manageMacros` bridge query.
 */

import { describe, it, expect, vi } from 'vitest';
import { MacroManagementTools } from './macro-management.js';

function makeTools(impl?: (data: any) => unknown) {
  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.manageMacros') {
      return impl ? impl(data) : { ok: true, echo: data };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { tools: new MacroManagementTools({ foundryClient: { query } as any, logger }), query };
}

describe('MacroManagementTools', () => {
  it('exposes manage-macros with the full action set', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('manage-macros');
    expect(def.inputSchema.properties.action.enum).toEqual([
      'create',
      'list',
      'get',
      'update',
      'move',
      'delete',
      'execute',
    ]);
  });

  it('forwards a valid script-macro create', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageMacros({
      action: 'create',
      name: 'Heal Party',
      type: 'script',
      command: 'console.log("heal")',
    });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.manageMacros',
      expect.objectContaining({ action: 'create', name: 'Heal Party', type: 'script' })
    );
  });

  it('rejects create without a command', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageMacros({ action: 'create', name: 'Empty' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an invalid macro type', async () => {
    const { tools } = makeTools();
    await expect(
      tools.handleManageMacros({ action: 'create', name: 'X', type: 'python', command: 'x' })
    ).rejects.toThrow();
  });

  it('rejects execute without an id', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageMacros({ action: 'execute' })).rejects.toThrow();
  });

  it('rejects delete without ids', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageMacros({ action: 'delete' })).rejects.toThrow();
  });

  it('surfaces bridge errors with the action named', async () => {
    const { tools } = makeTools(() => {
      throw new Error('Macro "Nope" threw while executing: boom');
    });
    await expect(tools.handleManageMacros({ action: 'execute', id: 'Nope' })).rejects.toThrow(
      /execute macro.*boom/
    );
  });
});
