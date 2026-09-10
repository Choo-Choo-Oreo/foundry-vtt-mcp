/**
 * Module Diagnostics Tool
 *
 * For developing modules against this bridge — or anything else running in the
 * same Foundry tab, since a captured console.error does not know which module
 * threw it. When something goes wrong inside Foundry, the only place it showed
 * up before this was the browser's DevTools console, which someone had to open
 * and paste back by hand. This reads it back directly: Foundry/system versions,
 * every installed module with its version and active state (for "which module
 * is actually loaded" version-drift questions), and recent captured
 * errors/warnings/uncaught exceptions.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface DiagnosticsToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class DiagnosticsTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: DiagnosticsToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DiagnosticsTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-module-diagnostics',
        description:
          'Foundry and system versions, every installed module (id/title/version/active), and ' +
          'recent captured console errors/warnings/uncaught exceptions from the GM browser tab ' +
          'running this bridge. Use this instead of asking the user to open DevTools and paste ' +
          'an error while developing or debugging a Foundry module. The error buffer starts ' +
          'empty on every world (re)load — it is not a persistent log, and it only captures ' +
          'error/warn-level output plus uncaught exceptions, not routine console.log noise.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Most recent N captured errors/warnings. Default all captured (≤200).',
            },
          },
        },
      },
    ];
  }

  async handleGetModuleDiagnostics(args: any): Promise<any> {
    const schema = z.object({
      limit: z.number().int().min(1).max(200).optional(),
    });

    const params = schema.parse(args ?? {});

    this.logger.info('get-module-diagnostics', { limit: params.limit });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.getModuleDiagnostics', params);
    } catch (error) {
      this.logger.error('Failed to get module diagnostics', error);
      throw new Error(
        `Failed to get module diagnostics: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
