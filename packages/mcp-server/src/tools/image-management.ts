/**
 * Image Management Tools
 *
 * Work with the Foundry server's image files: search the data directory (the
 * world's "image database", plus system/module art like the PF2e icon set),
 * assign an image to an actor portrait / prototype token / item, and rasterise
 * SVG markup to a PNG uploaded into the data directory.
 *
 * The svg-to-png path is what lets Claude draw art for a homebrew NPC or item:
 * generate SVG markup, convert + upload it server-side, then assign the
 * resulting PNG — one call with `assignTo`, no manual file wrangling.
 */

import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface ImageManagementToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ACTIONS = ['search', 'assign', 'svg-to-png'] as const;
const SOURCES = ['data', 'public'] as const;
const SCOPES = ['portrait', 'token', 'both'] as const;

const assignTargetShape = {
  targetType: z.enum(['actor', 'item']),
  actorIdentifier: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  scope: z.enum(SCOPES).optional(),
};

const ASSIGN_TARGET_PROPERTIES = {
  targetType: {
    type: 'string',
    enum: ['actor', 'item'],
    description: '"actor" (portrait and/or token) or "item" (item art).',
  },
  actorIdentifier: {
    type: 'string',
    description:
      'Actor name or id. Required for targetType "actor"; for "item" it means the item lives ' +
      'ON this actor rather than in the world Items sidebar.',
  },
  itemId: {
    type: 'string',
    description: 'Item id or exact name. Required for targetType "item".',
  },
  scope: {
    type: 'string',
    enum: [...SCOPES],
    description: 'For actors: "portrait", "token", or "both" (default "both").',
  },
} as const;

export class ImageManagementTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: ImageManagementToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'ImageManagementTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'manage-images',
        description:
          "Search the Foundry server's image files, assign images to actors/items, and convert " +
          'SVG markup to an uploaded PNG. GM-only.\n' +
          '- "search": find image files by name under `path` (recursive). Searches the user data ' +
          'directory by default — set `path` to e.g. "systems/pf2e/icons" for the PF2e icon set, ' +
          'or `source`:"public" for core Foundry icons ("icons/svg/..."). Returns file paths ' +
          'usable directly as `imagePath`.\n' +
          '- "assign": point an actor portrait / prototype token / item at `imagePath`. The file ' +
          'is verified to exist first (URLs are accepted as-is).\n' +
          '- "svg-to-png": rasterise `svg` markup (or an existing `svgPath` file) to a PNG, upload ' +
          'it to `destination`, and optionally assign it in the same call via `assignTo`. This is ' +
          'the way to give Claude-drawn art to an NPC or item.',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: [...ACTIONS], description: 'Operation to perform.' },
            query: {
              type: 'string',
              description:
                'For "search": case-insensitive filename substring, e.g. "goblin". Required when ' +
                'searching from the data-directory root.',
            },
            path: {
              type: 'string',
              description:
                'For "search": directory to search under, e.g. "assets", "systems/pf2e/icons". ' +
                'Default: the data-directory root.',
            },
            source: {
              type: 'string',
              enum: [...SOURCES],
              description:
                'For "search": "data" (user data, default) or "public" (core Foundry files like "icons/svg").',
            },
            extensions: {
              type: 'array',
              items: { type: 'string' },
              description:
                'For "search": file extensions to match. Default ["webp","png","jpg","jpeg","svg","gif"].',
            },
            maxResults: {
              type: 'number',
              description: 'For "search": result cap, default 50, max 200.',
            },
            imagePath: {
              type: 'string',
              description: 'For "assign": the image to assign (a path from "search", or a URL).',
            },
            ...ASSIGN_TARGET_PROPERTIES,
            svg: {
              type: 'string',
              description: 'For "svg-to-png": raw SVG markup ("<svg ...>...</svg>").',
            },
            svgPath: {
              type: 'string',
              description:
                'For "svg-to-png": path of an existing .svg in the data directory (alternative to `svg`).',
            },
            filename: {
              type: 'string',
              description: 'For "svg-to-png": output filename, e.g. "clownkin-jester.png".',
            },
            destination: {
              type: 'string',
              description:
                'For "svg-to-png": data-directory folder to upload into (created if missing). ' +
                'Default "foundry-mcp-assets".',
            },
            width: {
              type: 'number',
              description: 'For "svg-to-png": output width px (default from the SVG, else 512).',
            },
            height: { type: 'number', description: 'For "svg-to-png": output height px.' },
            assignTo: {
              type: 'object',
              description:
                'For "svg-to-png": assign the uploaded PNG immediately. Same fields as "assign": ' +
                '{ targetType, actorIdentifier?, itemId?, scope? }.',
              properties: { ...ASSIGN_TARGET_PROPERTIES },
              required: ['targetType'],
            },
          },
          required: ['action'],
        },
      },
    ];
  }

  async handleManageImages(args: any): Promise<any> {
    const schema = z
      .object({
        action: z.enum(ACTIONS),
        query: z.string().min(1).optional(),
        path: z.string().optional(),
        source: z.enum(SOURCES).optional(),
        extensions: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
        imagePath: z.string().min(1).optional(),
        // Same fields as assignTo, but targetType only becomes required for
        // action "assign" (enforced by the refine below).
        ...assignTargetShape,
        targetType: assignTargetShape.targetType.optional(),
        svg: z.string().min(1).optional(),
        svgPath: z.string().min(1).optional(),
        filename: z.string().min(1).optional(),
        destination: z.string().min(1).optional(),
        width: z.number().int().min(1).max(4096).optional(),
        height: z.number().int().min(1).max(4096).optional(),
        assignTo: z.object(assignTargetShape).optional(),
      })
      .refine(v => v.action !== 'search' || !!v.query || !!v.path?.trim(), {
        message: 'action "search" requires "query" and/or a "path" to search under',
      })
      .refine(v => v.action !== 'assign' || (!!v.imagePath && !!v.targetType), {
        message: 'action "assign" requires "imagePath" and "targetType"',
      })
      .refine(v => v.action !== 'svg-to-png' || !!v.svg !== !!v.svgPath, {
        message: 'action "svg-to-png" requires exactly one of "svg" (markup) or "svgPath"',
      })
      .refine(v => v.action !== 'svg-to-png' || !!v.filename, {
        message: 'action "svg-to-png" requires "filename"',
      });

    const params = schema.parse(args);

    this.logger.info('manage-images', {
      action: params.action,
      query: params.query ?? null,
      filename: params.filename ?? null,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.manageImages', params);
    } catch (error) {
      this.logger.error('Failed to manage images', error);
      throw new Error(
        `Failed to ${params.action}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
