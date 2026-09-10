/**
 * get-module-diagnostics tool tests.
 *
 * The capture itself lives browser-side (diagnostics.ts in the Foundry module);
 * this covers the MCP tool layer only — advertised, forwards limit, and surfaces
 * a bridge failure.
 */

import { describe, it, expect, vi } from 'vitest';
import { DiagnosticsTools } from './diagnostics.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async () => ({
        foundryVersion: '14.365',
        system: { id: 'pf2e', version: '8.5.0' },
        modules: [
          { id: 'foundry-mcp-bridge', title: 'Foundry MCP Bridge', version: '0.8.3', active: true },
        ],
        recentErrors: [],
      }))
  );
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new DiagnosticsTools({ foundryClient, logger }), query };
}

describe('DiagnosticsTools.getToolDefinitions', () => {
  it('advertises get-module-diagnostics', () => {
    const names = makeTools()
      .tools.getToolDefinitions()
      .map((d: any) => d.name);
    expect(names).toEqual(['get-module-diagnostics']);
  });
});

describe('get-module-diagnostics', () => {
  it('forwards limit to the bridge', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetModuleDiagnostics({ limit: 10 });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleDiagnostics', { limit: 10 });
  });

  it('defaults to an empty args object', async () => {
    const { tools, query } = makeTools();
    await tools.handleGetModuleDiagnostics({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getModuleDiagnostics', {});
  });

  it('rejects a limit over 200 without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleGetModuleDiagnostics({ limit: 999 })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a bridge failure', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('boom');
    });
    await expect(tools.handleGetModuleDiagnostics({})).rejects.toThrow(
      /Failed to get module diagnostics/
    );
  });
});
