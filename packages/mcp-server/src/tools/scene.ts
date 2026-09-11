import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface SceneToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

export class SceneTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: SceneToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'SceneTools' });
  }

  /**
   * Tool definitions for scene operations
   */
  getToolDefinitions() {
    return [
      {
        name: 'get-current-scene',
        description:
          'Get information about the currently active scene: layout, grid, the real playable ' +
          'rectangle (accounting for padding), tokens, and - with the include* flags - real wall ' +
          'segment coordinates, light/sound positions and radii, and region shapes. Use ' +
          'includeWalls/rect/grid to reason about safe token placement or map geometry without ' +
          'needing a screenshot.',
        inputSchema: {
          type: 'object',
          properties: {
            includeTokens: {
              type: 'boolean',
              description: 'Whether to include detailed token information (default: true)',
              default: true,
            },
            includeHidden: {
              type: 'boolean',
              description: 'Whether to include hidden tokens and elements (default: false)',
              default: false,
            },
            includeWalls: {
              type: 'boolean',
              description:
                "Include each wall segment's coordinates (c: [x1,y1,x2,y2]) and its move/sight/" +
                'light/sound/door flags (default: false)',
              default: false,
            },
            includeLights: {
              type: 'boolean',
              description:
                "Include each ambient light's position, rotation, dim/bright radius, and color (default: false)",
              default: false,
            },
            includeSounds: {
              type: 'boolean',
              description:
                "Include each ambient sound's position, radius, and audio path (default: false)",
              default: false,
            },
            includeRegions: {
              type: 'boolean',
              description:
                "Include each Region document's shapes and attached behaviors (default: false)",
              default: false,
            },
          },
        },
      },
      {
        name: 'get-world-info',
        description: 'Get basic information about the Foundry world and system',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  async handleGetCurrentScene(args: any): Promise<any> {
    const schema = z.object({
      includeTokens: z.boolean().default(true),
      includeHidden: z.boolean().default(false),
      includeWalls: z.boolean().default(false),
      includeLights: z.boolean().default(false),
      includeSounds: z.boolean().default(false),
      includeRegions: z.boolean().default(false),
    });

    const {
      includeTokens,
      includeHidden,
      includeWalls,
      includeLights,
      includeSounds,
      includeRegions,
    } = schema.parse(args);

    this.logger.info('Getting current scene information', {
      includeTokens,
      includeHidden,
      includeWalls,
      includeLights,
      includeSounds,
      includeRegions,
    });

    try {
      const sceneData = await this.foundryClient.query('foundry-mcp-bridge.getActiveScene', {
        includeWalls,
        includeLights,
        includeSounds,
        includeRegions,
      });

      this.logger.debug('Successfully retrieved scene data', {
        sceneId: sceneData.id,
        sceneName: sceneData.name,
        tokenCount: sceneData.tokens?.length || 0,
      });

      return this.formatSceneResponse(sceneData, includeTokens, includeHidden);
    } catch (error) {
      this.logger.error('Failed to get current scene', error);
      throw new Error(
        `Failed to get current scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async handleGetWorldInfo(_args: any): Promise<any> {
    this.logger.info('Getting world information');

    try {
      const worldData = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');

      this.logger.debug('Successfully retrieved world data', {
        worldId: worldData.id,
        system: worldData.system,
      });

      return this.formatWorldResponse(worldData);
    } catch (error) {
      this.logger.error('Failed to get world information', error);
      throw new Error(
        `Failed to get world information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private formatSceneResponse(sceneData: any, includeTokens: boolean, includeHidden: boolean): any {
    const response: any = {
      id: sceneData.id,
      name: sceneData.name,
      active: sceneData.active,
      dimensions: {
        width: sceneData.width,
        height: sceneData.height,
        padding: sceneData.padding,
      },
      // The actual playable rectangle in pixel coordinates, accounting for
      // padding and grid rounding - use this, not `dimensions`, to check
      // whether a point is on the map.
      rect: sceneData.rect,
      grid: sceneData.grid,
      hasBackground: !!sceneData.background,
      navigation: sceneData.navigation,
      elements: {
        walls: sceneData.walls || 0,
        lights: sceneData.lights || 0,
        sounds: sceneData.sounds || 0,
        notes: sceneData.notes?.length || 0,
      },
    };

    if (sceneData.wallDetails) {
      response.walls = sceneData.wallDetails.map((wall: any) => ({
        id: wall.id,
        from: { x: wall.c[0], y: wall.c[1] },
        to: { x: wall.c[2], y: wall.c[3] },
        blocksMovement: wall.move !== 0,
        blocksSight: wall.sight !== 0,
        blocksLight: wall.light !== 0,
        blocksSound: wall.sound !== 0,
        isDoor: wall.door !== 0,
        doorState: wall.door !== 0 ? this.getDoorStateName(wall.ds) : undefined,
        isSecretDoor: wall.door === 2,
      }));
    }

    if (sceneData.lightDetails) {
      response.lights = sceneData.lightDetails.map((light: any) => ({
        id: light.id,
        position: { x: light.x, y: light.y },
        rotation: light.rotation,
        hidden: light.hidden,
        dimRadius: light.dim,
        brightRadius: light.bright,
        angle: light.angle,
        color: light.color,
      }));
    }

    if (sceneData.soundDetails) {
      response.sounds = sceneData.soundDetails.map((sound: any) => ({
        id: sound.id,
        position: { x: sound.x, y: sound.y },
        radius: sound.radius,
        hidden: sound.hidden,
        path: sound.path,
      }));
    }

    if (sceneData.regionDetails) {
      response.regions = sceneData.regionDetails.map((region: any) => ({
        id: region.id,
        name: region.name,
        hidden: region.hidden,
        shapes: region.shapes,
        behaviors: region.behaviors,
      }));
    }

    if (includeTokens && sceneData.tokens) {
      response.tokens = this.formatTokens(sceneData.tokens, includeHidden);
      response.tokenSummary = this.createTokenSummary(sceneData.tokens, includeHidden);
    }

    if (sceneData.notes && sceneData.notes.length > 0) {
      response.notes = sceneData.notes.map((note: any) => ({
        id: note.id,
        text: this.truncateText(note.text, 100),
        position: { x: note.x, y: note.y },
      }));
    }

    return response;
  }

  private formatTokens(tokens: any[], includeHidden: boolean): any[] {
    return tokens
      .filter(token => includeHidden || !token.hidden)
      .map(token => ({
        id: token.id,
        name: token.name,
        position: {
          x: token.x,
          y: token.y,
        },
        size: {
          width: token.width,
          height: token.height,
        },
        actorId: token.actorId,
        disposition: this.getDispositionName(token.disposition),
        hidden: token.hidden,
        hasImage: !!token.img,
      }));
  }

  private createTokenSummary(tokens: any[], includeHidden: boolean): any {
    const visibleTokens = includeHidden ? tokens : tokens.filter(t => !t.hidden);

    const summary = {
      total: visibleTokens.length,
      byDisposition: {
        friendly: 0,
        neutral: 0,
        hostile: 0,
        unknown: 0,
      },
      hasActors: 0,
      withoutActors: 0,
    };

    visibleTokens.forEach(token => {
      // Count by disposition
      const disposition = this.getDispositionName(token.disposition);
      if (disposition in summary.byDisposition) {
        summary.byDisposition[disposition as keyof typeof summary.byDisposition]++;
      } else {
        summary.byDisposition.unknown++;
      }

      // Count actor association
      if (token.actorId) {
        summary.hasActors++;
      } else {
        summary.withoutActors++;
      }
    });

    return summary;
  }

  private formatWorldResponse(worldData: any): any {
    return {
      id: worldData.id,
      title: worldData.title,
      system: {
        id: worldData.system,
        version: worldData.systemVersion,
      },
      foundry: {
        version: worldData.foundryVersion,
      },
      users: {
        total: worldData.users?.length || 0,
        active: worldData.users?.filter((u: any) => u.active).length || 0,
        gms: worldData.users?.filter((u: any) => u.isGM).length || 0,
        players: worldData.users?.filter((u: any) => !u.isGM).length || 0,
      },
      activeUsers:
        worldData.users
          ?.filter((u: any) => u.active)
          .map((u: any) => ({
            id: u.id,
            name: u.name,
            isGM: u.isGM,
          })) || [],
    };
  }

  private getDispositionName(disposition: number): string {
    switch (disposition) {
      case -1:
        return 'hostile';
      case 0:
        return 'neutral';
      case 1:
        return 'friendly';
      default:
        return 'unknown';
    }
  }

  // CONST.WALL_DOOR_STATES (common/constants.mjs): 0=closed, 1=open, 2=locked.
  private getDoorStateName(ds: number): string {
    switch (ds) {
      case 0:
        return 'closed';
      case 1:
        return 'open';
      case 2:
        return 'locked';
      default:
        return 'unknown';
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
