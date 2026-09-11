/**
 * check-scene-position capability (2026-09-10), Phase 2 of the GM's scene-
 * snapshot request (Phase 1 was get-current-scene's new geometry flags, see
 * data-access.scene-geometry.test.ts). Answers "is this point on the map"
 * and, given an origin, "does a movement-blocking wall cross the line to
 * it" - for safe token placement without needing a screenshot.
 *
 * The wall-collision check delegates to the same real, Token-independent
 * primitive Foundry's own `Token#checkCollision` uses
 * (client/canvas/placeables/token.mjs ~2766):
 * `CONFIG.Canvas.polygonBackends.move.testCollision(origin, destination,
 * {type: 'move', mode: 'any'})`, confirmed against the actually-installed
 * Foundry v14.361.0 client source (`client/config.mjs` ~772: `move` maps to
 * `ClockwiseSweepPolygon`; `client/canvas/geometry/shapes/source-
 * polygon.mjs` ~326-341: the static `testCollision` only needs an
 * origin/destination pair and `{type}`, not an actual placed Token).
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

describe('FoundryDataAccess.checkScenePosition (safe token placement)', () => {
  let dataAccess: FoundryDataAccess;
  let testCollision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const scene = {
      id: 'scene1',
      name: 'Test Scene',
      width: 4000,
      height: 3000,
      dimensions: { sceneRect: { x: 100, y: 100, width: 3000, height: 2000 } },
    };
    stubGame({ scenes: { current: scene } });

    testCollision = vi.fn(() => false);
    (globalThis as any).canvas = { ready: true };
    (globalThis as any).CONFIG.Canvas = { polygonBackends: { move: { testCollision } } };

    dataAccess = new FoundryDataAccess();
  });

  it('reports a point inside the playable rect as in bounds, with the rect echoed back', async () => {
    const result = await dataAccess.checkScenePosition({ x: 1000, y: 1000 });

    expect(result.inBounds).toBe(true);
    expect(result.rect).toEqual({ x: 100, y: 100, width: 3000, height: 2000 });
    expect(result.path).toBeUndefined();
    expect(testCollision).not.toHaveBeenCalled();
  });

  it('reports a point outside the padded playable rect (but inside raw width/height) as out of bounds', async () => {
    const result = await dataAccess.checkScenePosition({ x: 50, y: 50 });

    expect(result.inBounds).toBe(false);
  });

  it('checks wall collision via CONFIG.Canvas.polygonBackends.move.testCollision only when fromX/fromY are given', async () => {
    testCollision.mockReturnValue(true);

    const result = await dataAccess.checkScenePosition({
      x: 1000,
      y: 1000,
      fromX: 500,
      fromY: 500,
    });

    expect(testCollision).toHaveBeenCalledWith(
      { x: 500, y: 500 },
      { x: 1000, y: 1000 },
      { type: 'move', mode: 'any' }
    );
    expect(result.path).toEqual({
      from: { x: 500, y: 500 },
      to: { x: 1000, y: 1000 },
      blockedByWall: true,
    });
  });

  it('throws a clear error instead of crashing when the canvas is not ready', async () => {
    (globalThis as any).canvas = { ready: false };

    await expect(
      dataAccess.checkScenePosition({ x: 1000, y: 1000, fromX: 500, fromY: 500 })
    ).rejects.toThrow('Canvas is not ready');
    expect(testCollision).not.toHaveBeenCalled();
  });
});
