/**
 * pf2e-create-abc-item tool tests.
 *
 * The item assembly runs browser-side (in the Foundry module); these cover the
 * MCP tool layer: the itemType discriminator, per-mode schema validation, the
 * name-or-basedOn rule, the pf2e system gate, and that a valid call forwards to
 * the `createPf2eAbcItem` bridge query.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PF2eAbcItemTools } from './abc.js';
import { clearSystemCache } from '../../utils/system-detection.js';

function makeTools(opts?: { system?: string; createImpl?: (data: any) => unknown }) {
  const system = opts?.system ?? 'pf2e';
  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.getWorldInfo') {
      return { system: { id: system }, id: 'w', title: 'W' };
    }
    if (method === 'foundry-mcp-bridge.createPf2eAbcItem') {
      return opts?.createImpl
        ? opts.createImpl(data)
        : { success: true, item: { id: 'i1', name: data.name ?? 'Cloned', type: data.itemType } };
    }
    throw new Error(`unexpected query ${method}`);
  });
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new PF2eAbcItemTools({ foundryClient, logger }), query };
}

beforeEach(() => clearSystemCache());

describe('PF2eAbcItemTools.getToolDefinitions', () => {
  it('exposes pf2e-create-abc-item requiring only itemType', () => {
    const [def] = makeTools().tools.getToolDefinitions();
    expect(def.name).toBe('pf2e-create-abc-item');
    expect(def.inputSchema.required).toEqual(['itemType']);
    expect(def.inputSchema.properties.itemType.enum).toEqual([
      'ancestry',
      'heritage',
      'background',
      'class',
      'deity',
      'feat',
      'action',
      'effect',
      'spell',
    ]);
  });
});

describe('PF2eAbcItemTools content item types (action / effect / spell)', () => {
  it('forwards a scratch-built action', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'action',
      name: 'Squirt Flower',
      actionType: 'action',
      actions: 1,
      category: 'offensive',
    });
    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem');
    expect(call![1].itemType).toBe('action');
    expect(call![1].category).toBe('offensive');
  });

  it('rejects an action category outside PF2e\'s closed set', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'action',
      name: 'Bad',
      category: 'hilarious',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a null action category (uncategorised)', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'action',
      name: 'Plain Action',
      category: null,
    });
    expect(result.success).toBe(true);
  });

  it('forwards an effect with a structured duration', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'effect',
      name: 'Clown Shame',
      duration: { value: 3, unit: 'rounds', sustained: false },
      tokenIcon: true,
    });
    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem');
    expect(call![1].duration.unit).toBe('rounds');
  });

  it('rejects an unknown effect duration unit', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'effect',
      name: 'Bad Effect',
      duration: { value: 3, unit: 'fortnights' },
    });
    expect(result.success).toBe(false);
  });

  it('forwards a spell with traditions and casting details', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'spell',
      name: 'Pie Barrage',
      level: 3,
      traditions: ['occult', 'primal'],
      time: '2',
      range: '30 feet',
    });
    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem');
    expect(call![1].traditions).toEqual(['occult', 'primal']);
    expect(call![1].level).toBe(3);
  });

  it('rejects an invalid spell tradition', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'spell',
      name: 'Bad Spell',
      traditions: ['clownish'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a spell rank above 10', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'spell',
      name: 'Too Big',
      level: 11,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a cross-mode field (spell param on an action)', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'action',
      name: 'Confused',
      traditions: ['arcane'],
    });
    expect(result.success).toBe(false);
  });
});

describe('PF2eAbcItemTools.handleCreateAbcItem', () => {
  it('forwards a valid scratch-built ancestry to the bridge query', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'ancestry',
      name: 'Clownkin',
      hp: 8,
      size: 'med',
      speed: 25,
      boosts: [['cha'], []],
      flaws: [['wis']],
      traits: ['humanoid', 'clownkin'],
    });
    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem');
    expect(call).toBeTruthy();
    expect(call![1].itemType).toBe('ancestry');
    expect(call![1].name).toBe('Clownkin');
  });

  it('forwards a clone-from-compendium call with no name', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'heritage',
      basedOn: 'pf2e.heritages.Skilled Human',
      description: 'Rubber-boned.',
    });
    expect(result.success).toBe(true);
    const call = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem');
    expect(call![1].basedOn).toBe('pf2e.heritages.Skilled Human');
  });

  it('rejects when neither name nor basedOn is given', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleCreateAbcItem({ itemType: 'feat' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/name.*basedOn|basedOn.*name/);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unsupported itemType', async () => {
    const { tools } = makeTools();
    // 'weapon' is a real PF2e item type but not one this tool builds — those go
    // through manage-world-items. ('spell' used to serve as this example, until
    // it became a supported mode.)
    const result = await tools.handleCreateAbcItem({ itemType: 'weapon', name: 'X' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('itemType');
  });

  it('rejects an unknown key for the chosen mode (strict schema)', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'deity',
      name: 'The Laughing Mask',
      hp: 8, // hp is an ancestry/class field, not a deity field
    });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range proficiency rank on a class', async () => {
    const { tools } = makeTools();
    const result = await tools.handleCreateAbcItem({
      itemType: 'class',
      name: 'Jester',
      perception: 9,
    });
    expect(result.success).toBe(false);
  });

  it('refuses on a non-pf2e world without calling create', async () => {
    const { tools, query } = makeTools({ system: 'dnd5e' });
    const result = await tools.handleCreateAbcItem({
      itemType: 'background',
      name: 'Circus Runaway',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Pathfinder 2e');
    const createCalled = query.mock.calls.some(
      c => c[0] === 'foundry-mcp-bridge.createPf2eAbcItem'
    );
    expect(createCalled).toBe(false);
  });

  it('surfaces bridge errors as a failed result', async () => {
    const { tools } = makeTools({
      createImpl: () => {
        throw new Error('basedOn "pf2e.ancestries.Nope" is a "ancestry", but itemType is "class".');
      },
    });
    const result = await tools.handleCreateAbcItem({
      itemType: 'class',
      basedOn: 'pf2e.ancestries.Nope',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('itemType');
  });
});
