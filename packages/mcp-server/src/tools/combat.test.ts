/**
 * manage-combat tool tests.
 *
 * Combat state lives entirely browser-side, so these cover the MCP tool layer:
 * the tool is advertised, "action" defaults to "get", valid calls forward the
 * right shape to the bridge query, and a bridge failure surfaces with the
 * action named in the message.
 */

import { describe, it, expect, vi } from 'vitest';
import { CombatTools } from './combat.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async () => ({
        active: true,
        combatId: 'c1',
        round: 1,
        turn: 0,
        current: { id: 'k1', name: 'Vex' },
        combatants: [],
      }))
  );
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new CombatTools({ foundryClient, logger }), query };
}

describe('CombatTools.getToolDefinitions', () => {
  it('advertises manage-combat with every action', () => {
    const defs = makeTools().tools.getToolDefinitions();
    expect(defs.map((d: any) => d.name)).toEqual(['manage-combat']);
    expect((defs[0] as any).inputSchema.properties.action.enum).toEqual([
      'get',
      'start',
      'end',
      'next-turn',
      'previous-turn',
      'next-round',
      'previous-round',
      'roll-initiative',
      'set-initiative',
      'add-combatants',
      'remove-combatants',
      'toggle-defeated',
      'toggle-hidden',
    ]);
  });
});

describe('manage-combat', () => {
  it('defaults action to "get" and forwards no other args', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageCombat({});
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCombat', { action: 'get' });
  });

  it('forwards combatantIds and initiative for set-initiative', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageCombat({
      action: 'set-initiative',
      combatantIds: ['k1'],
      initiative: 18,
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCombat', {
      action: 'set-initiative',
      combatantIds: ['k1'],
      initiative: 18,
    });
  });

  it('forwards tokenIds for add-combatants', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageCombat({ action: 'add-combatants', tokenIds: ['t1', 't2'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCombat', {
      action: 'add-combatants',
      tokenIds: ['t1', 't2'],
    });
  });

  it('rejects an unknown action without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleManageCombat({ action: 'skip-turn' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('names the action in a surfaced bridge failure', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('No active combat.');
    });
    await expect(tools.handleManageCombat({ action: 'next-turn' })).rejects.toThrow(
      /manage-combat "next-turn" failed/
    );
  });

  it('forwards combatantIds for toggle-hidden', async () => {
    const { tools, query } = makeTools();
    await tools.handleManageCombat({ action: 'toggle-hidden', combatantIds: ['k1'] });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.manageCombat', {
      action: 'toggle-hidden',
      combatantIds: ['k1'],
    });
  });
});
