/**
 * Macro Management Tools
 *
 * Full lifecycle for Macro documents: create, list, get, update, move, delete,
 * and execute. The bridge previously had no macro surface at all.
 *
 * Script macros run arbitrary JavaScript in the GM's Foundry client — that is
 * what a Foundry macro *is*, and the bridge is already GM-gated, but execute
 * remains the sharpest tool here: the command is echoed back in the result so
 * what ran is always visible on the MCP side.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface MacroManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ACTIONS = ['create', 'list', 'get', 'update', 'move', 'delete', 'execute'] as const;
const MACRO_TYPES = ['script', 'chat'] as const;

export class MacroManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: MacroManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'MacroManagementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-macros',
        description:
          'Create, list, inspect, edit, move, delete, and execute Foundry macros. GM-only.\n' +
          '- "create": new macro from `name`, `type` ("script" = JavaScript, "chat" = chat text), ' +
          'and `command` (the JS source or chat message).\n' +
          '- "list": all world macros with id, type, folder path, and a command preview. ' +
          'Pass `full`:true to get the complete command for every macro in this one call, ' +
          'instead of one "get" per macro — that is how to export a whole world of macros. ' +
          'The response can be large; to dump to disk instead, use export-world-data.\n' +
          '- "get": one macro (by `id` or exact name) including its full command.\n' +
          '- "update": change name/type/command/img by `id`.\n' +
          '- "move": refile a macro into `folder` (name, id, or "/"-separated path; created if missing).\n' +
          '- "delete": permanently delete macros by `ids`. All ids are validated first — one unknown ' +
          'id fails the whole call and nothing is deleted.\n' +
          '- "execute": run a macro (by `id` or exact name). Script macros return their result ' +
          'value; the executed command is echoed back so what ran is verifiable here.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...ACTIONS], description: 'Operation to perform.' },
            id: {
              type: 'string',
              description: 'Macro id (or exact name) for get/update/move/execute.',
            },
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for "delete": Macro ids to permanently delete.',
            },
            name: { type: 'string', description: 'Macro name (create) or new name (update).' },
            type: {
              type: 'string',
              enum: [...MACRO_TYPES],
              description:
                '"script" (JavaScript) or "chat" (posts its command as chat). Default "script".',
            },
            command: {
              type: 'string',
              description:
                'The macro body: JavaScript source for "script", message text for "chat".',
            },
            img: { type: 'string', description: 'Macro icon image path.' },
            full: {
              type: 'boolean',
              description:
                'For "list" only: return the full `command` and img for each macro rather ' +
                'than a 120-character preview. Use when exporting; omit when browsing.',
            },
            folder: {
              type: 'string',
              description:
                'Folder name, id, or "/"-separated path. Used by create and move; created if missing.',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageMacros(args: any): Promise<any> {
    const schema = z
      .object({
        action: z.enum(ACTIONS),
        id: z.string().min(1).optional(),
        ids: z.array(z.string().min(1)).optional(),
        name: z.string().min(1).optional(),
        type: z.enum(MACRO_TYPES).optional(),
        command: z.string().min(1).optional(),
        img: z.string().min(1).optional(),
        folder: z.string().min(1).optional(),
        full: z.boolean().optional(),
      })
      .refine(v => v.action !== 'create' || (!!v.name && !!v.command), {
        message: 'action "create" requires "name" and "command"',
      })
      .refine(v => !['get', 'update', 'move', 'execute'].includes(v.action) || !!v.id, {
        message: 'this action requires "id" (a macro id or exact name)',
      })
      .refine(v => v.action !== 'delete' || (v.ids?.length ?? 0) > 0, {
        message: 'action "delete" requires a non-empty "ids" array',
      })
      .refine(v => v.action !== 'move' || !!v.folder, {
        message: 'action "move" requires "folder"',
      });

    const params = schema.parse(args);

    this.logger.info('manage-macros', {
      action: params.action,
      id: params.id ?? null,
      full: params.full ?? false,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageMacros', params);
    } catch (error) {
      this.logger.error('Failed to manage macros', error);
      throw new Error(
        `Failed to ${params.action} macro: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
