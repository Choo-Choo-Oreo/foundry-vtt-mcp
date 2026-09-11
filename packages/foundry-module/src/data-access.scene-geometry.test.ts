/**
 * Scene snapshot / geometry capability (2026-09-10), added at the GM's request
 * to let the assistant reason about wall placement, safe token positions, and
 * light/sound layout without needing a screenshot.
 *
 * `getActiveScene()` previously exposed walls/lights/sounds only as bare
 * counts (`scene.walls.size`) - no coordinates, no door/move/sight/sound
 * flags, no light/sound position or radius, and no region data anywhere.
 * It also never exposed the scene's actual playable rectangle (accounting
 * for padding/grid rounding) or grid config, forcing any position reasoning
 * to guess from raw width/height/padding.
 *
 * Field names and door/sense-type encodings verified against the actually
 * installed Foundry v14.361.0 client source: common/documents/wall.mjs
 * defineSchema() ~53-79, common/documents/ambient-light.mjs ~34-49 (+
 * common/data/data.mjs LightData ~44-57 for config.dim/bright/angle/color),
 * common/documents/ambient-sound.mjs ~36-65, common/documents/region.mjs
 * ~51-89, common/constants.mjs WALL_DOOR_TYPES ~1512-1521/WALL_DOOR_STATES
 * ~1533-1543, and client/documents/scene.mjs getDimensions() ~447-484 for
 * the live `scene.dimensions.sceneRect` used as the playable rect.
 *
 * Fixed by adding optional includeWalls/includeLights/includeSounds/
 * includeRegions flags (default false, so the existing plain snapshot is
 * unchanged) that populate wallDetails/lightDetails/soundDetails/
 * regionDetails with real geometry, plus always-on `grid` and `rect` fields.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FoundryDataAccess } from './data-access.js';

function stubGame(overrides: Record<string, any> = {}) {
  (globalThis as any).Hooks = { on: vi.fn(), off: vi.fn(), once: vi.fn(), call: vi.fn() };
  (globalThis as any).CONFIG = { specialStatusEffects: { DEFEATED: 'dead' }, statusEffects: {} };
  (globalThis as any).game = {
    ready: true,
    world: { id: 'test-world' },
    user: { id: 'gm1', name: 'GM' },
    system: { id: 'pf2e' },
    settings: { get: () => true },
    ...overrides,
  };
}

function arrayCollection<T>(items: T[]) {
  return {
    size: items.length,
    map: (fn: (item: T) => any) => items.map(fn),
    [Symbol.iterator]: items[Symbol.iterator].bind(items),
  };
}

describe('FoundryDataAccess.getActiveScene geometry (scene snapshot capability)', () => {
  let dataAccess: FoundryDataAccess;
  let wall: any;
  let light: any;
  let sound: any;
  let region: any;
  let scene: any;

  beforeEach(() => {
    wall = {
      id: 'wall1',
      c: [100, 200, 300, 200],
      move: 20,
      sight: 20,
      light: 20,
      sound: 20,
      dir: 0,
      door: 1,
      ds: 0,
    };
    light = {
      id: 'light1',
      x: 500,
      y: 500,
      rotation: 0,
      hidden: false,
      config: { dim: 40, bright: 20, angle: 360, color: '#ff0000' },
    };
    sound = { id: 'sound1', x: 600, y: 600, radius: 30, hidden: false, path: 'sounds/fire.ogg' };
    region = {
      id: 'region1',
      name: 'Lava Pit',
      shapes: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }],
      hidden: false,
      visibility: 0,
      behaviors: arrayCollection([{ id: 'behavior1', type: 'teleportToken', disabled: false }]),
    };

    scene = {
      id: 'scene1',
      name: 'Test Scene',
      img: undefined,
      _source: {},
      width: 4000,
      height: 3000,
      padding: 0.25,
      active: true,
      navigation: true,
      grid: { type: 1, size: 100, distance: 5, units: 'ft' },
      dimensions: { sceneRect: { x: 100, y: 100, width: 3000, height: 2000 } },
      tokens: arrayCollection([]),
      walls: arrayCollection([wall]),
      lights: arrayCollection([light]),
      sounds: arrayCollection([sound]),
      notes: arrayCollection([]),
      regions: arrayCollection([region]),
    };

    stubGame({ scenes: { current: scene } });
    dataAccess = new FoundryDataAccess();
  });

  it('always includes grid config and the real playable rect (accounting for padding), even with no include flags', async () => {
    const result = await dataAccess.getActiveScene();

    expect(result.grid).toEqual({
      type: 1,
      typeName: 'square',
      size: 100,
      distance: 5,
      units: 'ft',
    });
    expect(result.rect).toEqual({ x: 100, y: 100, width: 3000, height: 2000 });
    expect(result.walls).toBe(1);
    expect(result.wallDetails).toBeUndefined();
  });

  it('returns real wall coordinates and door/move/sight/sound flags only when includeWalls is set', async () => {
    const result = await dataAccess.getActiveScene({ includeWalls: true });

    expect(result.wallDetails).toEqual([
      {
        id: 'wall1',
        c: [100, 200, 300, 200],
        move: 20,
        sight: 20,
        light: 20,
        sound: 20,
        dir: 0,
        door: 1,
        ds: 0,
      },
    ]);
  });

  it('returns light position/radius/color only when includeLights is set', async () => {
    const result = await dataAccess.getActiveScene({ includeLights: true });

    expect(result.lightDetails).toEqual([
      {
        id: 'light1',
        x: 500,
        y: 500,
        rotation: 0,
        hidden: false,
        dim: 40,
        bright: 20,
        angle: 360,
        color: '#ff0000',
      },
    ]);
  });

  it('returns sound position/radius/path only when includeSounds is set', async () => {
    const result = await dataAccess.getActiveScene({ includeSounds: true });

    expect(result.soundDetails).toEqual([
      { id: 'sound1', x: 600, y: 600, radius: 30, hidden: false, path: 'sounds/fire.ogg' },
    ]);
  });

  it('returns region shapes and behaviors only when includeRegions is set', async () => {
    const result = await dataAccess.getActiveScene({ includeRegions: true });

    expect(result.regionDetails).toEqual([
      {
        id: 'region1',
        name: 'Lava Pit',
        shapes: [{ type: 'rectangle', x: 0, y: 0, width: 100, height: 100 }],
        hidden: false,
        visibility: 0,
        behaviors: [{ id: 'behavior1', type: 'teleportToken', disabled: false }],
      },
    ]);
  });

  it('falls back to raw width/height when the live scene has no computed dimensions.sceneRect', async () => {
    scene.dimensions = {};
    const result = await dataAccess.getActiveScene();

    expect(result.rect).toEqual({ x: 0, y: 0, width: 4000, height: 3000 });
  });
});
