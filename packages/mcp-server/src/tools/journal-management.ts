/**
 * Journal Management Tools
 *
 * Delete JournalEntry documents, or individual pages inside one.
 *
 * Journal creation/reading/appending already live in the quest-creation tools
 * (`create-quest-journal`, `update-quest-journal`, `list-journals`,
 * `search-journals`); this covers the deletes those never had. The common case
 * is removing the "Adventure Hook / Quest Objectives" boilerplate page that
 * `create-quest-journal` always injects.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface JournalManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class JournalManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: JournalManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'JournalManagementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-journals',
        description:
          'Delete Foundry journal entries or individual journal pages. GM-only.\n' +
          '- "delete": permanently delete whole JournalEntry documents by `ids`.\n' +
          '- "delete-page": delete page(s) inside one journal — pass `journalId` plus `pageIds`. ' +
          'Use this to remove the boilerplate "Adventure Hook / Quest Objectives" page that ' +
          'create-quest-journal always adds.\n' +
          'Get ids from list-journals (it returns each journal\'s pages with their ids). ' +
          'All ids are validated before anything is deleted: if any is unknown the whole call ' +
          'fails and nothing is removed.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['delete', 'delete-page'],
              description:
                'Operation: "delete" whole journals by ids, or "delete-page" to remove pages from one journal.',
            },
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for "delete". JournalEntry ids to permanently delete.',
            },
            journalId: {
              type: 'string',
              description:
                'Required for "delete-page". The journal (id or name) containing the pages.',
            },
            pageIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required for "delete-page". Ids of the pages to delete.',
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageJournals(args: any): Promise<any> {
    const schema = z
      .object({
        action: z.enum(['delete', 'delete-page']),
        ids: z.array(z.string().min(1)).optional(),
        journalId: z.string().min(1).optional(),
        pageIds: z.array(z.string().min(1)).optional(),
      })
      .refine(v => v.action !== 'delete' || (v.ids?.length ?? 0) > 0, {
        message: 'action "delete" requires a non-empty "ids" array of JournalEntry ids',
      })
      .refine(
        v => v.action !== 'delete-page' || (!!v.journalId && (v.pageIds?.length ?? 0) > 0),
        {
          message: 'action "delete-page" requires "journalId" and a non-empty "pageIds" array',
        }
      );

    const params = schema.parse(args);

    this.logger.info('manage-journals', {
      action: params.action,
      journals: params.ids?.length ?? 0,
      pages: params.pageIds?.length ?? 0,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageJournals', params);
    } catch (error) {
      this.logger.error('Failed to manage journals', error);
      throw new Error(
        `Failed to ${params.action}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
