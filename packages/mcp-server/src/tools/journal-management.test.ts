/**
 * manage-journals tool tests.
 *
 * Deletion runs browser-side, so these cover the MCP tool layer: the actions are
 * advertised, valid calls forward to the manageJournals bridge query, and each
 * action's required arguments are enforced before any query goes out (a
 * delete-page missing its journalId must not reach Foundry as a whole-journal
 * delete).
 */

import { describe, it, expect, vi } from 'vitest';
import { JournalManagementTools } from './journal-management.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(queryImpl ?? (async () => ({ action: 'delete', deleted: [], total: 0 })));
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new JournalManagementTools({ foundryClient, logger }), query };
}

describe('manage-journals', () => {
  it('advertises delete and delete-page', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('manage-journals');
    expect(def.inputSchema.properties.action.enum).toEqual(['delete', 'delete-page']);
  });

  it('forwards a journal delete to the bridge', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageJournals({ action: 'delete', ids: ['j1', 'j2'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageJournals', {
      action: 'delete',
      ids: ['j1', 'j2'],
    });
  });

  it('forwards a page delete with its journalId', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageJournals({
      action: 'delete-page',
      journalId: 'j1',
      pageIds: ['p1'],
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageJournals', {
      action: 'delete-page',
      journalId: 'j1',
      pageIds: ['p1'],
    });
  });

  it('rejects delete with no ids', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageJournals({ action: 'delete' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects delete-page without a journalId', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageJournals({ action: 'delete-page', pageIds: ['p1'] })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects delete-page without pageIds', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleManageJournals({ action: 'delete-page', journalId: 'j1' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a bridge-side "not found" rather than reporting success', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('Journal(s) not found: bogus. Nothing was deleted.');
    });
    await expect(
      tools.handleManageJournals({ action: 'delete', ids: ['bogus'] })
    ).rejects.toThrow(/Nothing was deleted/);
  });
});
