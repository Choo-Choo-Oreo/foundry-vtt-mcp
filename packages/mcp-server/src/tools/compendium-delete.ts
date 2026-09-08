/**
 * Compendium Pack Deletion
 *
 * The one irreversible tool in this server, so it is shaped the opposite way round
 * from every other one: the default call deletes nothing.
 *
 * `dryRun` defaults to true. The first call is always a report — what the pack is,
 * how many entries it holds, and their names. Deleting takes a second call carrying
 * `dryRun: false` plus `expectedEntryCount` set to the number the first call
 * returned. A mismatch aborts and deletes nothing.
 *
 * Why a speed bump and not a lock. A guard that cannot be satisfied gets routed
 * around — somebody deletes the pack from the Foundry sidebar instead, where nothing
 * is recorded at all. Everything here is satisfiable by a caller who has actually
 * looked at the pack, and unsatisfiable by one who has not. That is the whole design.
 * A bare `confirm: true` flag would not be: the model sets it, so it protects nobody.
 *
 * The one absolute refusal is system and module packs, and it is not this server's
 * rule — `deleteCompendium` belongs to the owning package and Foundry rejects it for
 * anything but `world.*`. Refusing here turns an exception into a sentence.
 *
 * What this does NOT do is back the pack up. Reading a large pack's full documents
 * would blow the 10s query ceiling, so a backup step would fail on exactly the packs
 * big enough to need one. The entry list is returned instead: a receipt of what was
 * destroyed, not a copy of it. Export first if the content matters.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface CompendiumDeleteToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class CompendiumDeleteTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: CompendiumDeleteToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'CompendiumDeleteTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'delete-compendium-pack',
        description:
          'PERMANENTLY delete a world compendium pack and every entry in it. GM-only. ' +
          'There is no undo, no trash, and no automatic backup.\n' +
          'DEFAULT IS A DRY RUN. Called with just `pack`, this deletes nothing and returns ' +
          'what the pack is and what is in it. Deleting takes a second call with ' +
          '`dryRun: false` and `expectedEntryCount` set to the count the dry run reported; ' +
          'if the count does not match, nothing is deleted.\n' +
          'Ask the user before the second call, naming the pack and the entry count, and ' +
          'only delete a pack the user has actually named. Do not delete one on your own ' +
          'initiative because it looks like scratch or test data.\n' +
          'Only `world.*` packs can be deleted. System and module packs (pf2e.*, any ' +
          'module) are refused — Foundry rejects those too; disable the module instead.\n' +
          'To keep the content, run export-world-data or export-to-compendium FIRST. To ' +
          'change entries rather than remove them, this is the wrong tool: see ' +
          '`foundry-docs recipes`.',
        inputSchema: {
          type: 'object',
          properties: {
            pack: {
              type: 'string',
              description:
                'The pack to delete: a full collection id ("world.my-pack") or a bare name ' +
                '("my-pack", read as "world.my-pack"). list-compendium-packs shows the ids.',
            },
            dryRun: {
              type: 'boolean',
              description:
                'Defaults to TRUE — nothing is deleted and the pack is reported instead. ' +
                'Pass false to actually delete, which also requires expectedEntryCount.',
            },
            expectedEntryCount: {
              type: 'number',
              description:
                'Required when dryRun is false: the number of entries you expect the pack ' +
                'to hold, from the dry run. A mismatch aborts — it means this is not the ' +
                'pack you think it is, or it changed since you looked.',
            },
          },
          required: ['pack'],
        },
      },
    ];
  }

  async handleDeleteCompendiumPack(args: any): Promise<any> {
    const schema = z.object({
      pack: z.string().min(1, 'pack is required'),
      dryRun: z.boolean().optional(),
      expectedEntryCount: z.number().int().min(0).optional(),
    });

    const params = schema.parse(args);
    const dryRun = params.dryRun !== false;

    // Log the real intent, not the requested one: a destructive call should be
    // findable in the log by what it was going to do.
    this.logger.info(dryRun ? 'delete-compendium-pack (dry run)' : 'delete-compendium-pack', {
      pack: params.pack,
      dryRun,
      expectedEntryCount: params.expectedEntryCount ?? null,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.deleteCompendiumPack', {
        pack: params.pack,
        dryRun,
        ...(params.expectedEntryCount !== undefined
          ? { expectedEntryCount: params.expectedEntryCount }
          : {}),
      });
    } catch (error) {
      this.logger.error('Failed to delete compendium pack', error);
      throw new Error(
        `Failed to delete compendium pack: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
