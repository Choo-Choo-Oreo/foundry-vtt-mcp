/**
 * send-chat-message / roll-dice tool tests.
 *
 * The message creation and dice evaluation run browser-side, so these cover the
 * MCP tool layer: both tools are advertised, valid calls forward to their bridge
 * queries, rollMode is constrained to Foundry's four modes, and empty
 * content/formula is rejected before any query goes out.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatTools } from './chat.js';

function makeTools(queryImpl?: (method: string, data: any) => unknown) {
  const query = vi.fn(
    queryImpl ??
      (async (method: string) =>
        method === 'foundry-mcp-bridge.rollDice'
          ? { formula: '2d6+3', total: 11, result: '5 + 3 + 3', dice: [] }
          : { id: 'm1', content: 'hi', speaker: null, whisperedTo: [] })
  );
  const logger: any = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), child: () => logger };
  const foundryClient: any = { query };
  return { tools: new ChatTools({ foundryClient, logger }), query };
}

describe('ChatTools.getToolDefinitions', () => {
  it('advertises send-chat-message and roll-dice', () => {
    const names = makeTools().tools.getToolDefinitions().map((d: any) => d.name);
    expect(names).toEqual(['send-chat-message', 'roll-dice']);
  });

  it('constrains rollMode to Foundry\'s four modes on both tools', () => {
    const defs = makeTools().tools.getToolDefinitions();
    for (const def of defs) {
      expect((def as any).inputSchema.properties.rollMode.enum).toEqual([
        'publicroll',
        'gmroll',
        'blindroll',
        'selfroll',
      ]);
    }
  });
});

describe('send-chat-message', () => {
  it('forwards content, speaker and whisper targets to the bridge', async () => {
    const { tools, query } = makeTools();
    await tools.handleSendChatMessage({
      content: 'The door creaks open.',
      speakerActor: 'Mr. Clown',
      whisperTo: ['Hamster'],
      flavor: 'Narration',
    });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.sendChatMessage', {
      content: 'The door creaks open.',
      speakerActor: 'Mr. Clown',
      whisperTo: ['Hamster'],
      flavor: 'Narration',
    });
  });

  it('rejects empty content without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleSendChatMessage({ content: '' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an invalid rollMode without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(
      tools.handleSendChatMessage({ content: 'hi', rollMode: 'shoutroll' })
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces an unresolvable whisper target as a failure', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('Could not resolve these whisper target(s) to a Foundry user: Nobody.');
    });
    await expect(
      tools.handleSendChatMessage({ content: 'psst', whisperTo: ['Nobody'] })
    ).rejects.toThrow(/whisper target/);
  });
});

describe('roll-dice', () => {
  it('forwards the formula and returns the evaluated total', async () => {
    const { tools, query } = makeTools();
    const result = await tools.handleRollDice({ formula: '2d6+3', flavor: 'Bonk' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.rollDice', {
      formula: '2d6+3',
      flavor: 'Bonk',
    });
    expect(result.total).toBe(11);
  });

  it('rejects an empty formula without calling the bridge', async () => {
    const { tools, query } = makeTools();
    await expect(tools.handleRollDice({ formula: '   ' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('surfaces a bad formula from the bridge as a failure', async () => {
    const { tools } = makeTools(async () => {
      throw new Error('Could not evaluate dice formula "2dd6"');
    });
    await expect(tools.handleRollDice({ formula: '2dd6' })).rejects.toThrow(/2dd6/);
  });
});
