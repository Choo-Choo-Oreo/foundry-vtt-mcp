/**
 * Combat Tracker Tools
 *
 * The bridge could post to chat and roll dice, but had no idea whose turn it was —
 * every "what's happening in combat" question depended on the GM narrating it by
 * hand. This is a *pull*, not a push: there is no channel from Foundry to an MCP
 * client that isn't a tool result, so "get pushed what a player did" becomes
 * "call get before acting, and again after the player's turn resolves."
 *
 * One action-based tool, matching the shape of manage-folders/manage-journals,
 * rather than one tool per verb — the actions share a single target (the active
 * combat) and a caller doing several of them back to back would otherwise have to
 * juggle N tool names for one concept.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

const COMBAT_ACTIONS = [
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
] as const;

export interface CombatToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class CombatTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: CombatToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CombatTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-combat',
        description:
          "Read or drive Foundry's combat tracker: whose turn it is, round/turn number, " +
          'initiative order, HP/defeated state, and advancing the encounter. GM-only.\n' +
          '- "get" (default): current state of the active combat — round, whose turn, and ' +
          'every combatant with initiative/HP/defeated. Call this instead of asking the GM to ' +
          'narrate positions and turn order.\n' +
          '- "start": begin combat (creating one on the current scene first if none exists).\n' +
          '- "end": end and remove the active combat encounter.\n' +
          '- "next-turn" / "previous-turn": advance or rewind one combatant.\n' +
          '- "next-round" / "previous-round": advance or rewind a full round.\n' +
          '- "roll-initiative": roll for `combatantIds`, or for every NPC (`npcsOnly`:true), or ' +
          'for everyone without initiative yet (neither given). Optional `formula` overrides ' +
          "the system's default.\n" +
          '- "set-initiative": manually set `initiative` on `combatantIds[0]` (e.g. a player ' +
          'reported their own roll from a physical table).\n' +
          '- "add-combatants": join tokens from the current scene (`tokenIds`) to the encounter.\n' +
          '- "remove-combatants": drop `combatantIds` from the encounter (does not delete the ' +
          'tokens/actors — only their combat-tracker entry).\n' +
          '- "toggle-defeated": flip the defeated marker on `combatantIds`.\n' +
          'There is no push channel from Foundry — call "get" again after a player acts to see ' +
          'what changed; it is not delivered automatically.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [...COMBAT_ACTIONS],
              description: 'Operation to perform. Defaults to "get".',
            },
            combatId: {
              type: 'string',
              description:
                'Target a specific combat by id instead of the currently active/viewed one. ' +
                'Optional — almost always omitted; most tables run one encounter at a time.',
            },
            combatantIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Combatant ids (from "get") — used by roll-initiative, set-initiative (first ' +
                'entry only), remove-combatants, and toggle-defeated.',
            },
            tokenIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Token ids on the current scene to add to the encounter (add-combatants).',
            },
            initiative: {
              type: 'number',
              description: 'The value to set (set-initiative).',
            },
            formula: {
              type: 'string',
              description:
                'Dice formula override for roll-initiative, e.g. "1d20+@dex". Omit to use the ' +
                "system's configured initiative formula.",
            },
            npcsOnly: {
              type: 'boolean',
              description:
                'roll-initiative: roll for every NPC combatant instead of everyone/one target. ' +
                'Ignored if combatantIds is given.',
            },
          },
        },
      },
    ];
  }

  async handleManageCombat(args: any): Promise<any> {
    const schema = z.object({
      action: z.enum(COMBAT_ACTIONS).optional(),
      combatId: z.string().min(1).optional(),
      combatantIds: z.array(z.string().min(1)).optional(),
      tokenIds: z.array(z.string().min(1)).optional(),
      initiative: z.number().optional(),
      formula: z.string().min(1).optional(),
      npcsOnly: z.boolean().optional(),
    });

    const params = schema.parse(args ?? {});
    const action = params.action ?? 'get';

    this.logger.info('manage-combat', { action, combatId: params.combatId });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageCombat', {
        ...params,
        action,
      });
    } catch (error) {
      this.logger.error('manage-combat failed', error);
      throw new Error(
        `manage-combat "${action}" failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
