/**
 * manage-images tool tests.
 *
 * The file browsing / canvas rasterising happens browser-side; these cover the
 * MCP tool layer: per-action schema validation and forwarding to the
 * `manageImages` bridge query.
 */

import { describe, it, expect, vi } from 'vitest';
import { ImageManagementTools } from './image-management.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect/></svg>';

function makeTools(impl?: (data: any) => unknown) {
  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.manageImages') {
      return impl ? impl(data) : { ok: true, echo: data };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  return { tools: new ImageManagementTools({ foundryClient: { query } as any, logger }), query };
}

describe('ImageManagementTools', () => {
  it('exposes manage-images with the three actions', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('manage-images');
    expect(def.inputSchema.properties.action.enum).toEqual(['search', 'assign', 'svg-to-png']);
  });

  it('forwards a search with a query', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageImages({ action: 'search', query: 'goblin' });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.manageImages',
      expect.objectContaining({ action: 'search', query: 'goblin' })
    );
  });

  it('allows a path-only search but rejects a bare root search', async () => {
    const { tools } = makeTools();
    const ok = await tools.handleManageImages({ action: 'search', path: 'systems/pf2e/icons' });
    expect(ok.ok).toBe(true);
    await expect(tools.handleManageImages({ action: 'search' })).rejects.toThrow();
  });

  it('rejects assign without imagePath or targetType', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageImages({ action: 'assign', imagePath: 'assets/x.png' })
    ).rejects.toThrow();
    await expect(
      tools.handleManageImages({ action: 'assign', targetType: 'actor' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('forwards a valid actor assign', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageImages({
      action: 'assign',
      imagePath: 'assets/jester.png',
      targetType: 'actor',
      actorIdentifier: 'Mr. Party Chad',
      scope: 'both',
    });
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.manageImages',
      expect.objectContaining({ targetType: 'actor', scope: 'both' })
    );
  });

  it('requires exactly one of svg / svgPath for svg-to-png', async () => {
    const { tools } = makeTools();
    await expect(
      tools.handleManageImages({ action: 'svg-to-png', filename: 'x.png' })
    ).rejects.toThrow();
    await expect(
      tools.handleManageImages({
        action: 'svg-to-png',
        svg: SVG,
        svgPath: 'assets/a.svg',
        filename: 'x.png',
      })
    ).rejects.toThrow();
  });

  it('forwards svg-to-png with an inline assignTo', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleManageImages({
      action: 'svg-to-png',
      svg: SVG,
      filename: 'clownkin-jester',
      assignTo: { targetType: 'actor', actorIdentifier: 'Mr. Party Chad' },
    });
    expect(result.ok).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'foundry-mcp-bridge.manageImages',
      expect.objectContaining({
        action: 'svg-to-png',
        assignTo: expect.objectContaining({ targetType: 'actor' }),
      })
    );
  });

  it('rejects svg-to-png without a filename', async () => {
    const { tools } = makeTools();
    await expect(tools.handleManageImages({ action: 'svg-to-png', svg: SVG })).rejects.toThrow();
  });
});
