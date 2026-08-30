/**
 * Roll Table Management Tools
 *
 * Full lifecycle for RollTable documents: create, list, get, update, move,
 * delete, and roll (draw). The bridge previously had no roll-table surface at
 * all — manage-folders could file them but nothing could make one.
 *
 * Follows the manage-journals convention: one tool, an `action` discriminator,
 * one bridge query (`manageRollTables`) that switches browser-side.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface RollTableManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ACTIONS = ['create', 'list', 'get', 'update', 'move', 'delete', 'roll'] as const;

const resultSchema = z
  .object({
    text: z.string().min(1).describe('Result text shown when drawn.'),
    weight: z.number().int().min(1).optional(),
    range: z.tuple([z.number().int(), z.number().int()]).optional(),
    img: z.string().min(1).optional(),
    documentUuid: z
      .string()
      .min(1)
      .optional()
      .describe('Optional UUID of a linked document (Actor/Item/JournalEntry/...).'),
  })
  .strict();

export class RollTableManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: RollTableManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'RollTableManagementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-rolltables',
        description:
          'Create, list, inspect, edit, move, delete, and roll on Foundry roll tables. GM-only.\n' +
          '- "create": new table from `name` + `results` (rows of { text, weight?, range?, ' +
          'documentUuid? }). If no row has a `range`, rows are auto-numbered 1..N and the formula ' +
          'defaults to 1dN.\n' +
          '- "list": all world roll tables with id, formula, result count, and folder.\n' +
          '- "get": one table (by `id` or name) with every result row.\n' +
          '- "update": change name/description/formula/replacement/displayRoll/img by `id`; ' +
          'passing `results` REPLACES the whole result set.\n' +
          '- "move": refile a table into `folder` (name, id, or "/"-separated path; created if missing).\n' +
          '- "delete": permanently delete tables by `ids`. All ids are validated first — one unknown ' +
          'id fails the whole call and nothing is deleted.\n' +
          '- "roll": draw from a table (`id` or name), optionally `count` times, posting to chat ' +
          'unless `displayChat` is false. Returns the drawn rows so the outcome is verifiable here.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...ACTIONS], description: 'Operation to perform.' },
            id: {
              type: 'string',
              description: 'Table id (or exact name) for get/update/move/roll.',
            },
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for "delete": RollTable ids to permanently delete.',
            },
            name: { type: 'string', description: 'Table name (create) or new name (update).' },
            description: { type: 'string', description: 'Table description (HTML allowed).' },
            formula: {
              type: 'string',
              description: 'Dice formula that indexes the ranges, e.g. "1d20". Default 1dN.',
            },
            replacement: {
              type: 'boolean',
              description: 'Draw with replacement (default true). False = results are used up.',
            },
            displayRoll: {
              type: 'boolean',
              description: 'Show the dice roll to players when the table is rolled (default true).',
            },
            img: { type: 'string', description: 'Table image path.' },
            folder: {
              type: 'string',
              description:
                'Folder name, id, or "/"-separated path. Used by create and move; created if missing.',
            },
            results: {
              type: 'array',
              description:
                'Result rows: [{ "text": "A goblin ambush!", "weight": 2, "range": [1, 5], ' +
                '"documentUuid": "Actor.abc..." }]. Only `text` is required per row.',
              items: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  weight: { type: 'number' },
                  range: { type: 'array', items: { type: 'number' } },
                  img: { type: 'string' },
                  documentUuid: { type: 'string' },
                },
                required: ['text'],
              },
            },
            count: {
              type: 'number',
              description: 'For "roll": number of draws (default 1).',
            },
            displayChat: {
              type: 'boolean',
              description: 'For "roll": post the draw to chat (default true).',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageRollTables(args: any): Promise<any> {
    const schema = z
      .object({
        action: z.enum(ACTIONS),
        id: z.string().min(1).optional(),
        ids: z.array(z.string().min(1)).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        formula: z.string().min(1).optional(),
        replacement: z.boolean().optional(),
        displayRoll: z.boolean().optional(),
        img: z.string().min(1).optional(),
        folder: z.string().min(1).optional(),
        results: z.array(resultSchema).optional(),
        count: z.number().int().min(1).max(100).optional(),
        displayChat: z.boolean().optional(),
      })
      .refine(v => v.action !== 'create' || (!!v.name && (v.results?.length ?? 0) > 0), {
        message: 'action "create" requires "name" and a non-empty "results" array',
      })
      .refine(v => !['get', 'update', 'move', 'roll'].includes(v.action) || !!v.id, {
        message: 'this action requires "id" (a table id or exact name)',
      })
      .refine(v => v.action !== 'delete' || (v.ids?.length ?? 0) > 0, {
        message: 'action "delete" requires a non-empty "ids" array',
      })
      .refine(v => v.action !== 'move' || !!v.folder, {
        message: 'action "move" requires "folder"',
      });

    const params = schema.parse(args);

    this.logger.info('manage-rolltables', {
      action: params.action,
      id: params.id ?? null,
      results: params.results?.length ?? 0,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageRollTables', params);
    } catch (error) {
      this.logger.error('Failed to manage roll tables', error);
      throw new Error(
        `Failed to ${params.action} roll table: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
