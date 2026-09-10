/**
 * Chat & Dice Tools
 *
 * Post messages to Foundry's chat log, evaluate dice GM-side, and read the log back.
 *
 * Sending and rolling were previously listed as things the bridge could not do. In
 * fact the module already used ChatMessage.create() and Roll().toMessage() internally
 * for the roll-request flow — only the tool surface was missing.
 *
 * `roll-dice` complements the existing `request-player-rolls` rather than
 * replacing it: request a roll when the player should make it (player agency at
 * a real table), roll directly for GM/NPC actions.
 *
 * `list-chat-log` closes the other half of the gap: this bridge could write to
 * chat but never read it back, so "what did the player just do" depended on the
 * GM typing it out. There is no push from Foundry to an MCP client — this is a
 * pull, called again after a player's turn to see what landed in the log.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

const ROLL_MODES = ['publicroll', 'gmroll', 'blindroll', 'selfroll'] as const;

export interface ChatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class ChatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: ChatToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'ChatTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'send-chat-message',
        description:
          "Post a message to Foundry's chat log, optionally spoken as an actor (NPC dialogue, " +
          'narration, GM notes). Supports whispering to specific players. GM-only.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Message body. HTML is allowed (e.g. "<em>The door creaks open.</em>").',
            },
            speakerActor: {
              type: 'string',
              description:
                'Optional actor name or ID to speak as, for proper NPC attribution. Omit to post as the GM.',
            },
            whisperTo: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional player user names or IDs to whisper to. Omit for a public message. ' +
                'An unresolvable name fails the call rather than silently posting publicly.',
            },
            flavor: {
              type: 'string',
              description: 'Optional flavor/subtitle line shown above the message.',
            },
            rollMode: {
              type: 'string',
              enum: [...ROLL_MODES],
              description:
                'Visibility: "publicroll" (default, everyone), "gmroll" (GMs only), "blindroll", "selfroll".',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'roll-dice',
        description:
          'Evaluate a dice formula and post the result to Foundry chat, rolled by the GM. ' +
          'Returns the total and individual dice so the result is verifiable here, not just ' +
          'visible in Foundry. For rolls a PLAYER should make, use request-player-rolls instead. GM-only.',
        inputSchema: {
          type: 'object',
          properties: {
            formula: {
              type: 'string',
              description:
                'Foundry dice formula, e.g. "1d20+5", "2d6+3", "4d6kh3" (keep highest 3).',
            },
            flavor: {
              type: 'string',
              description: 'Optional label for the roll, e.g. "Goblin longbow attack".',
            },
            speakerActor: {
              type: 'string',
              description: 'Optional actor name or ID to attribute the roll to.',
            },
            rollMode: {
              type: 'string',
              enum: [...ROLL_MODES],
              description:
                'Visibility: "publicroll" (default), "gmroll" (GMs only), "blindroll", "selfroll".',
            },
          },
          required: ['formula'],
        },
      },
      {
        name: 'list-chat-log',
        description:
          "Read recent entries from Foundry's chat log — messages, rolls, damage, whatever the " +
          'table has posted. Use this after a player takes a turn instead of asking the GM to ' +
          'describe what happened: it is a pull, not a push, so nothing arrives here on its ' +
          'own. Each entry includes id, timestamp, speaker (actor/token/user), content/flavor, ' +
          'and, for rolls, the formula/total/individual dice.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Most recent N entries. Default 20, max 200.',
            },
            sinceId: {
              type: 'string',
              description:
                'Only entries posted after this message id (from a previous call), instead of ' +
                'a flat count — the way to catch up on everything missed since last checking, ' +
                'without re-reading old messages.',
            },
            rollsOnly: {
              type: 'boolean',
              description: 'Only entries that contain a dice roll. Default false.',
            },
          },
        },
      },
    ];
  }

  async handleSendChatMessage(args: any): Promise<any> {
    const schema = z.object({
      content: z.string().trim().min(1, 'content cannot be empty'),
      speakerActor: z.string().min(1).optional(),
      whisperTo: z.array(z.string().min(1)).optional(),
      flavor: z.string().optional(),
      rollMode: z.enum(ROLL_MODES).optional(),
    });

    const params = schema.parse(args);

    this.logger.info('send-chat-message', {
      speaker: params.speakerActor ?? null,
      whispers: params.whisperTo?.length ?? 0,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.sendChatMessage', params);
    } catch (error) {
      this.logger.error('Failed to send chat message', error);
      throw new Error(
        `Failed to send chat message: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleRollDice(args: any): Promise<any> {
    const schema = z.object({
      formula: z.string().trim().min(1, 'formula cannot be empty'),
      flavor: z.string().optional(),
      speakerActor: z.string().min(1).optional(),
      rollMode: z.enum(ROLL_MODES).optional(),
    });

    const params = schema.parse(args);

    this.logger.info('roll-dice', { formula: params.formula });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.rollDice', params);
    } catch (error) {
      this.logger.error('Failed to roll dice', error);
      throw new Error(
        `Failed to roll "${params.formula}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleListChatLog(args: any): Promise<any> {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
      sinceId: z.string().min(1).optional(),
      rollsOnly: z.boolean().optional(),
    });

    const params = schema.parse(args ?? {});

    this.logger.info('list-chat-log', { limit: params.limit, rollsOnly: params.rollsOnly });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.listChatLog', params);
    } catch (error) {
      this.logger.error('Failed to list chat log', error);
      throw new Error(
        `Failed to list chat log: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
