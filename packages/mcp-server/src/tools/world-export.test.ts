/**
 * export-world-data / export-to-compendium tests.
 *
 * The export writes real files to a real filesystem, so these cover the parts that
 * corrupt an export silently rather than failing loudly:
 *
 * - Filename sanitisation. A Foundry document name is free text; a disk path is not.
 *   A document called `Strike: Dragon's Bite?` or `CON` must still land on disk
 *   under Windows, which is the strictest of the three platforms.
 * - The destination guard. Exporting into a directory that already has content must
 *   refuse rather than quietly interleave two exports.
 * - Batching. The bridge query transport times out at 10s, so the export MUST chunk
 *   its fetches. A regression to "one big fetch" would pass a typecheck and then fail
 *   only against a large world — the exact bug this splits the tool to avoid.
 * - Verbatim documents. The written file must be the stored object, unmodified.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorldExportTools } from './world-export.js';

function makeLogger(): any {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  return logger;
}

/**
 * A fake world. `plan` drives what exists; `fetch` records every batch it was asked
 * for, so a test can assert on how the export chunked its work.
 */
function makeTools(world: {
  entries?: Record<string, Array<{ id: string; name: string; type: string; folderPath: string }>>;
  folders?: any[];
  documentFor?: (cls: string, id: string) => any;
}) {
  const entries = world.entries ?? {};
  const batches: Array<{ documentClass: string; ids: string[] }> = [];

  const query = vi.fn(async (method: string, data: any) => {
    if (method === 'foundry-mcp-bridge.exportPlan') {
      const wanted: string[] = data.classes ?? Object.keys(entries);
      const picked: Record<string, any[]> = {};
      const counts: Record<string, number> = {};
      let total = 0;
      for (const cls of wanted) {
        picked[cls] = entries[cls] ?? [];
        counts[cls] = picked[cls].length;
        total += picked[cls].length;
      }
      return {
        world: {
          id: 'test-world',
          title: 'Test World',
          system: 'pf2e',
          systemVersion: '8.4.1',
          foundry: '14.361',
        },
        entries: picked,
        counts,
        total,
        skipped: [],
      };
    }
    if (method === 'foundry-mcp-bridge.exportFetchDocuments') {
      batches.push({ documentClass: data.documentClass, ids: [...data.ids] });
      const source = entries[data.documentClass] ?? [];
      return {
        documentClass: data.documentClass,
        documents: data.ids.map((id: string) => {
          const entry = source.find(e => e.id === id)!;
          return {
            id: entry.id,
            name: entry.name,
            type: entry.type,
            folderPath: entry.folderPath,
            document: world.documentFor
              ? world.documentFor(data.documentClass, id)
              : { _id: id, name: entry.name, type: entry.type, system: { level: { value: 3 } } },
          };
        }),
        failed: [],
      };
    }
    if (method === 'foundry-mcp-bridge.exportFolderTree') {
      return world.folders ?? [];
    }
    if (method === 'foundry-mcp-bridge.exportFolderToCompendium') {
      return { success: true, pack: 'world.mcp-export-classes', echo: data };
    }
    throw new Error(`unexpected query ${method}`);
  });

  const tools = new WorldExportTools({ foundryClient: { query } as any, logger: makeLogger() });
  return { tools, query, batches };
}

function entry(id: string, name: string, folderPath = '', type = 'feat') {
  return { id, name, type, folderPath };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmcp-export-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('WorldExportTools — tool definitions', () => {
  it('exposes both export tools', () => {
    const defs = makeTools({}).tools.getToolDefinitions();
    expect(defs.map(d => d.name)).toEqual(['export-world-data', 'export-to-compendium']);
  });

  it('requires an outputPath', async () => {
    const { tools } = makeTools({});
    await expect(tools.handleExportWorldData({})).rejects.toThrow();
  });
});

describe('WorldExportTools — filename safety', () => {
  it('keeps documents whose names are illegal or reserved on Windows', async () => {
    const out = path.join(tmpDir, 'export');
    const { tools } = makeTools({
      entries: {
        Item: [
          // ":" and "?" are illegal in a Windows filename.
          entry('aaa', "Strike: Dragon's Bite?"),
          // A device name is reserved even WITH an extension — CON.json is still CON.
          entry('bbb', 'CON'),
          // Windows silently strips a trailing dot, which would desync disk from manifest.
          entry('ccc', 'Trailing dot.'),
          // A name that is only illegal characters must still produce a usable file.
          entry('ddd', '???'),
        ],
      },
    });

    const result = await tools.handleExportWorldData({ outputPath: out });
    expect(result.documentsWritten).toBe(4);

    const files = await fs.readdir(path.join(out, 'Item'));
    for (const f of files) {
      expect(f).not.toMatch(/[<>:"/\\|?*]/);
      expect(f.replace(/\.json$/, '')).not.toMatch(/[. ]$/);
    }
    expect(files.some(f => f.startsWith('_CON.'))).toBe(true);
    expect(files.some(f => f.includes('ddd'))).toBe(true);
    // Every file must remain resolvable back to its document id.
    for (const id of ['aaa', 'bbb', 'ccc', 'ddd']) {
      expect(files.some(f => f.includes(id))).toBe(true);
    }
  });

  it('does not exceed the Windows MAX_PATH budget on a deep tree', async () => {
    const deep = Array.from({ length: 6 }, (_, i) => `folder-${i}-${'x'.repeat(20)}`).join('/');
    const out = path.join(tmpDir, 'deep');
    const { tools } = makeTools({
      entries: { Item: [entry('e1', 'y'.repeat(200), deep)] },
    });

    const result = await tools.handleExportWorldData({ outputPath: out });
    expect(result.documentsWritten + result.failures.length).toBe(1);
    if (result.documentsWritten === 1) {
      const written = path.resolve(out, result.manifest ? '' : '', '.');
      expect(written.length).toBeLessThan(260);
      const manifest = JSON.parse(await fs.readFile(path.join(out, '_manifest.json'), 'utf8'));
      const full = path.join(out, manifest.documents[0].file);
      expect(full.length).toBeLessThanOrEqual(260);
    }
  });
});

describe('WorldExportTools — destination guard', () => {
  it('refuses a non-empty directory without overwrite', async () => {
    const out = path.join(tmpDir, 'busy');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'previous.json'), '{}', 'utf8');

    const { tools } = makeTools({ entries: { Item: [entry('a', 'Thing')] } });
    await expect(tools.handleExportWorldData({ outputPath: out })).rejects.toThrow(
      /already contains/
    );
  });

  it('proceeds with overwrite:true and leaves pre-existing files alone', async () => {
    const out = path.join(tmpDir, 'busy2');
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'previous.json'), '{"keep":true}', 'utf8');

    const { tools } = makeTools({ entries: { Item: [entry('a', 'Thing')] } });
    const result = await tools.handleExportWorldData({ outputPath: out, overwrite: true });

    expect(result.documentsWritten).toBe(1);
    // Nothing is ever deleted — the earlier file must survive untouched.
    expect(JSON.parse(await fs.readFile(path.join(out, 'previous.json'), 'utf8'))).toEqual({
      keep: true,
    });
  });

  it('writes nothing at all when the filters match nothing', async () => {
    const out = path.join(tmpDir, 'empty');
    const { tools } = makeTools({ entries: { Item: [] } });
    const result = await tools.handleExportWorldData({ outputPath: out, classes: ['Item'] });

    expect(result.wrote).toBe(0);
    await expect(fs.readdir(out)).rejects.toThrow();
  });
});

describe('WorldExportTools — batching', () => {
  it('chunks fetches so no single query can exceed the 10s transport timeout', async () => {
    const items = Array.from({ length: 57 }, (_, i) => entry(`i${i}`, `Item ${i}`));
    const { tools, batches } = makeTools({ entries: { Item: items } });

    await tools.handleExportWorldData({
      outputPath: path.join(tmpDir, 'batched'),
      classes: ['Item'],
    });

    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map(b => b.ids.length))).toBeLessThanOrEqual(25);
    // Every document is fetched exactly once — no gaps, no duplicates.
    const fetched = batches.flatMap(b => b.ids);
    expect(fetched.length).toBe(57);
    expect(new Set(fetched).size).toBe(57);
  });

  it('honours an explicit batchSize', async () => {
    const items = Array.from({ length: 20 }, (_, i) => entry(`i${i}`, `Item ${i}`));
    const { tools, batches } = makeTools({ entries: { Item: items } });

    await tools.handleExportWorldData({
      outputPath: path.join(tmpDir, 'batched2'),
      classes: ['Item'],
      batchSize: 5,
    });

    expect(Math.max(...batches.map(b => b.ids.length))).toBe(5);
    expect(batches.length).toBe(4);
  });

  it('excludes Scene from the default class set', async () => {
    const { tools, query } = makeTools({
      entries: { Item: [entry('a', 'Thing')], Scene: [entry('s', 'Map', '', 'Scene')] },
    });

    await tools.handleExportWorldData({ outputPath: path.join(tmpDir, 'noscene') });

    const planCall = query.mock.calls.find(c => c[0] === 'foundry-mcp-bridge.exportPlan');
    expect(planCall?.[1].classes).not.toContain('Scene');
  });
});

describe('WorldExportTools — layouts and output', () => {
  it('tree layout mirrors the Foundry folder structure', async () => {
    const out = path.join(tmpDir, 'tree');
    const { tools } = makeTools({
      entries: { Item: [entry('a', 'Blade', 'Homebrew/Classes/Artificer')] },
    });

    await tools.handleExportWorldData({ outputPath: out, classes: ['Item'] });

    const dir = path.join(out, 'Item', 'Homebrew', 'Classes', 'Artificer');
    const files = await fs.readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('Blade.a.json');
  });

  it('flat layout ignores folders', async () => {
    const out = path.join(tmpDir, 'flat');
    const { tools } = makeTools({
      entries: { Item: [entry('a', 'Blade', 'Homebrew/Classes/Artificer')] },
    });

    await tools.handleExportWorldData({ outputPath: out, classes: ['Item'], layout: 'flat' });

    expect(await fs.readdir(path.join(out, 'Item'))).toEqual(['Blade.a.json']);
  });

  it('single-file layout writes one JSON keyed by class', async () => {
    const out = path.join(tmpDir, 'single');
    const { tools } = makeTools({
      entries: { Item: [entry('a', 'Blade'), entry('b', 'Shield')] },
    });

    const result = await tools.handleExportWorldData({
      outputPath: out,
      classes: ['Item'],
      layout: 'single-file',
    });

    const payload = JSON.parse(await fs.readFile(path.join(out, 'world-export.json'), 'utf8'));
    expect(payload.Item).toHaveLength(2);
    expect(result.documentsWritten).toBe(2);
  });

  it('writes each document verbatim, with nothing dropped or reshaped', async () => {
    const out = path.join(tmpDir, 'verbatim');
    const stored = {
      _id: 'a',
      name: 'Blade',
      type: 'weapon',
      system: { level: { value: 5 }, traits: { value: ['magical'] }, nested: { deep: [1, 2, 3] } },
      flags: { mymodule: { owner: 'x' } },
    };
    const { tools } = makeTools({
      entries: { Item: [entry('a', 'Blade', '', 'weapon')] },
      documentFor: () => stored,
    });

    await tools.handleExportWorldData({ outputPath: out, classes: ['Item'] });

    const written = JSON.parse(await fs.readFile(path.join(out, 'Item', 'Blade.a.json'), 'utf8'));
    expect(written).toEqual(stored);
  });

  it('writes a manifest and a readable index, and records empty folders', async () => {
    const out = path.join(tmpDir, 'manifest');
    const { tools } = makeTools({
      entries: { Item: [entry('a', 'Blade', 'Homebrew')] },
      folders: [
        { id: 'f1', name: 'Homebrew', type: 'Item', path: 'Homebrew', depth: 1 },
        { id: 'f2', name: 'Unused', type: 'Item', path: 'Unused', depth: 1 },
      ],
    });

    await tools.handleExportWorldData({ outputPath: out, classes: ['Item'] });

    const manifest = JSON.parse(await fs.readFile(path.join(out, '_manifest.json'), 'utf8'));
    expect(manifest.world.system).toBe('pf2e');
    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0].file).toBe('Item/Homebrew/Blade.a.json');
    expect(manifest.folders).toHaveLength(2);

    const index = await fs.readFile(path.join(out, '_index.md'), 'utf8');
    expect(index).toContain('# Test World — world export');
    expect(index).toContain('Blade');
    // An empty folder is real organisation and must survive the round trip.
    expect(index).toContain('Unused');
  });
});

describe('WorldExportTools — export-to-compendium', () => {
  it('forwards a folder export', async () => {
    const { tools, query } = makeTools({});
    const result = await tools.handleExportToCompendium({ folder: 'Homebrew/Classes' });

    expect(result.success).toBe(true);
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.exportFolderToCompendium', {
      folder: 'Homebrew/Classes',
    });
  });

  it('rejects a packName that would not be a legal Foundry pack id', async () => {
    const { tools } = makeTools({});
    await expect(
      tools.handleExportToCompendium({ folder: 'Homebrew', packName: 'Not Valid!' })
    ).rejects.toThrow();
  });
});
