/**
 * pf2e-create-npc tool tests.
 *
 * The stat-block assembly runs browser-side (in the Foundry module); these
 * cover the MCP tool layer: schema validation, the pf2e system gate, and that
 * a valid call is forwarded to the `createPf2eNpcActor` bridge query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PF2eNpcTools } from './npc.js';
import { clearSystemCache } from '../../utils/system-detection.js';

function makeTools(opts?: { system?: string; createImpl?: (data: any) => unknown }) {
  const system = opts?.system ?? 'pf2e';
  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: { id: system }, id: 'w', title: 'W' };
    }
    if (method === 'foundry-mcp-bridge.createPf2eNpcActor') {
      return opts?.createImpl
        ? opts.createImpl(data)
        : { success: true, actor: { id: 'a1', name: data.name, type: 'npc' } };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new PF2eNpcTools({ foundryClient, logger }), query };
}

const validArgs = {
  name: 'Ash-Choked Revenant',
  level: 3,
  abilities: { str: 4, dex: 2, con: 3, int: -1, wis: 1, cha: 0 },
  hp: 45,
  ac: 19,
  saves: { fortitude: 9, reflex: 5, will: 7 },
  perception: 8,
  traits: ['undead'],
  skills: { athletics: 12, intimidation: 9 },
  immunities: ['bleed', 'poison'],
  weaknesses: [{ type: 'positive', value: 5 }],
  strikes: [{ name: 'Slam', bonus: 14, damage: '2d8+7 bludgeoning' }],
};

beforeEach(() => clearSystemCache());

describe('PF2eNpcTools.getToolDefinitions', () => {
  it('exposes pf2e-create-npc with the core required fields', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('pf2e-create-npc');
    expect(def.inputSchema.required).toEqual([
      'name',
      'level',
      'abilities',
      'hp',
      'ac',
      'saves',
      'perception',
    ]);
  });
});

describe('PF2eNpcTools.handleCreateNpc', () => {
  it('forwards a valid call to the createPf2eNpcActor bridge query with defaults applied', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateNpc(validArgs);

    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eNpcActor');
    expect(call).toBeTruthy();
    const payload = call![1];
    expect(payload.name).toBe('Ash-Choked Revenant');
    expect(payload.size).toBe('med'); // schema default
    expect(payload.rarity).toBe('common'); // schema default
    expect(payload.speed).toBe(25); // schema default
    expect(payload.resistances).toEqual([]); // schema default
    expect(payload.addToScene).toBe(false); // schema default
  });

  it('refuses on a non-pf2e world without calling create', async () => {
    const { tools, query } = makeTools({ system: 'dnd5e' });
    const result = await tools.handleCreateNpc(validArgs);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Pathfinder 2e');
    const createCalled = query.mock.calls.some(
      c => c[0] === 'foundry-mcp-bridge.createPf2eNpcActor'
    );
    expect(createCalled).toBe(false);
  });

  it('rejects a missing required field', async () => {
    const { tools, query } = makeTools();
    const noPerception: Record<string, unknown> = { ...validArgs };
    delete noPerception.perception;
    const result = await tools.handleCreateNpc(noPerception);
    expect(result.success).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unknown top-level key (strict schema)', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateNpc({ ...validArgs, challengeRating: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown skill slug', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateNpc({
      ...validArgs,
      skills: { athleticsss: 12 },
    });
    expect(result.success).toBe(false);
  });

  it('surfaces bridge errors as a failed result', async () => {
    const { tools } = makeTools({
      createImpl: () => {
        throw new Error('An NPC named "Ash-Choked Revenant" already exists');
      },
    });
    const result = await tools.handleCreateNpc(validArgs);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already exists');
  });
});
