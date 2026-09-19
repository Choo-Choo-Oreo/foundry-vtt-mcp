/**
 * Scene Map Image Tools
 *
 * Render the active scene's background map with a labeled grid overlay (plus
 * optionally existing walls and the playable-rect boundary) as one or more PNG
 * tiles written to local disk, for tracing real wall/light/sound geometry
 * precisely instead of guessing from a downscaled screenshot.
 *
 * Why this exists: tracing a scene's map by hand-writing a one-off image
 * script every session and reading a downscaled crop through the Read tool
 * loses exactly the precision that matters (grid-cell boundaries, wall
 * lines), and re-deriving the pixel<->scene-coordinate offset by hand each
 * time is a repeated source of error. This tool does that arithmetic once,
 * server-side, and labels every major gridline intersection with the real
 * scene coordinate - not a grid index - so a wall's `c` array can be copied
 * straight off the image.
 *
 * The rendering itself happens in the Foundry module (browser canvas - see
 * `data-access.ts` `getSceneMapImage`), since that is where the background
 * image and existing Wall documents actually live; this tool's own job is
 * just to take the base64 PNG tiles the module returns and write them to
 * local disk (the mcp-server's machine, which is what Claude Code's Read
 * tool can actually see), returning file paths instead of a large base64
 * blob in the tool result.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';
import { getAppDataDir } from '../utils/platform.js';

export interface SceneMapImageToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const regionSchema = z.object({
  colStart: z.number().int().min(0),
  rowStart: z.number().int().min(0),
  colEnd: z.number().int().min(1),
  rowEnd: z.number().int().min(1),
});

export class SceneMapImageTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneMapImageToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneMapImageTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'get-scene-map-image',
        description:
          "Render the current scene's background map as one or more labeled-grid-overlay PNG " +
          'tiles, written to local disk and returned as file paths (Read each path to view it). ' +
          'Every major gridline intersection is labeled with the real scene coordinate (not a ' +
          'grid index), so a wall segment traced off the image can be used directly in ' +
          '`manage-macros`/wall-creation code with no manual offset math. Existing walls (cyan) ' +
          'and the playable rect boundary (green) are overlaid by default so placed geometry can ' +
          "be checked against the art. `region` is in grid cells relative to the playable rect's " +
          "origin (col 0/row 0 = the rect's top-left corner) - omit it to cover the whole scene, " +
          'or pass it to zoom into one area at a time. Bounded by `maxTiles` per call (the ' +
          "underlying query has a fixed 10s timeout) - a region that's too large to render in " +
          'time fails fast with a message telling you to shrink it, rather than timing out.',
        inputSchema: {
          type: 'object',
          properties: {
            region: {
              type: 'object',
              description:
                'Grid-cell bounds relative to the playable rect origin. Omit for the whole scene.',
              properties: {
                colStart: { type: 'number', description: 'First column (inclusive), 0-based.' },
                rowStart: { type: 'number', description: 'First row (inclusive), 0-based.' },
                colEnd: { type: 'number', description: 'Last column (exclusive).' },
                rowEnd: { type: 'number', description: 'Last row (exclusive).' },
              },
              required: ['colStart', 'rowStart', 'colEnd', 'rowEnd'],
            },
            tileSize: {
              type: 'number',
              description: 'Max pixel dimension per output tile. Default 1200, min 400, max 2000.',
            },
            maxTiles: {
              type: 'number',
              description:
                'Safety cap on tiles generated in one call (default 6, max 9) - the call fails ' +
                'with a clear error instead of risking the 10s query timeout if the region would ' +
                'need more than this at the given tileSize.',
            },
            gridLabelInterval: {
              type: 'number',
              description: 'Cells between labeled major gridlines. Default 5.',
            },
            showWalls: {
              type: 'boolean',
              description: 'Overlay existing Wall documents in cyan. Default true.',
            },
            showRect: {
              type: 'boolean',
              description: "Overlay the scene's playable-rect boundary in green. Default true.",
            },
            outputDir: {
              type: 'string',
              description:
                'Absolute local directory to write tile PNGs into. Default: a per-scene folder ' +
                "under the mcp-server's own app-data directory. Pass your own scratch directory " +
                'to keep tiles there instead.',
            },
          },
        },
      },
    ];
  }

  async handleGetSceneMapImage(args: any): Promise<any> {
    const schema = z.object({
      region: regionSchema.optional(),
      tileSize: z.number().int().min(400).max(2000).optional(),
      maxTiles: z.number().int().min(1).max(9).optional(),
      gridLabelInterval: z.number().int().min(1).optional(),
      showWalls: z.boolean().optional(),
      showRect: z.boolean().optional(),
      outputDir: z.string().min(1).optional(),
    });

    const params = schema.parse(args);

    this.logger.info('get-scene-map-image', {
      region: params.region ?? null,
      tileSize: params.tileSize ?? null,
    });

    try {
      const result = await this.foundryClient.query('foundry-mcp-bridge.get-scene-map-image', {
        region: params.region,
        tileSize: params.tileSize,
        maxTiles: params.maxTiles,
        gridLabelInterval: params.gridLabelInterval,
        showWalls: params.showWalls,
        showRect: params.showRect,
      });

      const outputDir = path.resolve(
        params.outputDir ?? path.join(getAppDataDir(), 'map-tiles', result.sceneId)
      );
      await fs.mkdir(outputDir, { recursive: true });

      const tiles = [];
      for (let i = 0; i < result.tiles.length; i++) {
        const tile = result.tiles[i];
        const { colStart, rowStart, colEnd, rowEnd } = tile.gridCells;
        const filename = `tile_c${colStart}-${colEnd}_r${rowStart}-${rowEnd}.png`;
        const filePath = path.join(outputDir, filename);
        await fs.writeFile(filePath, Buffer.from(tile.dataBase64, 'base64'));

        tiles.push({
          file: filePath,
          gridCells: tile.gridCells,
          sceneBounds: tile.sceneBounds,
          pixelSize: tile.pixelSize,
        });
      }

      return {
        sceneId: result.sceneId,
        sceneName: result.sceneName,
        grid: result.grid,
        rect: result.rect,
        region: result.region,
        tileCount: tiles.length,
        tiles,
      };
    } catch (error) {
      this.logger.error('Failed to get scene map image', error);
      throw new Error(
        `Failed to get scene map image: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
