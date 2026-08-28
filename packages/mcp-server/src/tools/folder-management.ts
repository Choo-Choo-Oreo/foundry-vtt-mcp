/**
 * Folder Management Tools
 *
 * List / delete / rename / move Foundry Folder documents of any type
 * (Actor, Item, JournalEntry, Scene, RollTable, ...). Folder *creation* is
 * handled implicitly by the content tools' "/"-separated `folder` argument.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface FolderManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class FolderManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: FolderManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'FolderManagementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-folders',
        description:
          'List, delete, rename, or move Foundry Folder documents of any type ' +
          '(Actor, Item, JournalEntry, Scene, RollTable, ...). Creating folders is done ' +
          'implicitly by passing a "/"-separated `folder` to the content tools.\n' +
          '- "list": folders, optionally filtered by `type` and/or `path` prefix. Returns ' +
          'id, name, type, full path, depth, parentId, and contents/subfolders counts.\n' +
          '- "delete": remove folder(s) by `id`/`ids` or `path`/`paths`. By default subfolders ' +
          'are removed and loose contents move up to the parent; set `deleteContents: true` to ' +
          'also delete the documents inside, `deleteSubfolders: false` to keep child folders.\n' +
          '- "rename": set a folder\'s `newName` (target by `id` or `path`).\n' +
          '- "move": reparent a folder to `newParent` (id or "/"-path; "" = root).',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'delete', 'rename', 'move'],
              description: 'Operation to perform.',
            },
            type: {
              type: 'string',
              description:
                'Folder document type: "Actor" | "Item" | "JournalEntry" | "Scene" | "RollTable" | ... ' +
                'For "list" it filters; for the others it disambiguates a path lookup. Optional.',
            },
            id: { type: 'string', description: 'Target folder id (delete/rename/move).' },
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple target folder ids (delete).',
            },
            path: {
              type: 'string',
              description:
                'Target folder as a "/"-separated path (delete/rename/move); for "list", a path ' +
                'prefix filter.',
            },
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'Multiple target folder paths (delete).',
            },
            newName: { type: 'string', description: 'New folder name (rename).' },
            newParent: {
              type: 'string',
              description: 'Destination parent folder id or "/"-path (move). "" moves to root.',
            },
            deleteContents: {
              type: 'boolean',
              description:
                'delete: also permanently delete the documents inside the folder(s). Default false ' +
                '(loose contents move up to the parent).',
            },
            deleteSubfolders: {
              type: 'boolean',
              description: 'delete: also remove child folders. Default true.',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageFolders(args: any): Promise<any> {
    const schema = z.object({
      action: z.enum(['list', 'delete', 'rename', 'move']),
      type: z.string().optional(),
      id: z.string().optional(),
      ids: z.array(z.string()).optional(),
      path: z.string().optional(),
      paths: z.array(z.string()).optional(),
      newName: z.string().optional(),
      newParent: z.string().optional(),
      deleteContents: z.boolean().optional(),
      deleteSubfolders: z.boolean().optional(),
    });
    const params = schema.parse(args);

    this.logger.info('manage-folders', { action: params.action, type: params.type });

    return this.foundryClient.query('foundry-mcp-bridge.manageFolders', params);
  }
}
