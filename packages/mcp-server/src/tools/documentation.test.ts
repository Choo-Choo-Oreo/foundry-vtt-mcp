/**
 * foundry-docs tests.
 *
 * A documentation tool fails in a way no typecheck catches: it keeps answering
 * confidently while what it says drifts away from what is true. These tests target
 * exactly those failure modes rather than the formatting.
 *
 * - **Silence must never read as an all-clear.** A missing or malformed notes file has
 *   to say "unknown", loudly. The catastrophic bug here is a broken notes file
 *   rendering as "no known issues" — that is worse than the tool not existing.
 * - **Stale claims must announce themselves.** An issue last checked months ago must
 *   not render like a fact checked today. This is how a fixed bug goes on being worked
 *   around for a year.
 * - **The tool list must be generated.** If the catalog is not wired in, the tool has
 *   to say so instead of falling back to a hand-written list that will rot.
 * - **No caching.** The notes file is read fresh on every call; that is the entire
 *   reason it lives on disk instead of in the bundle. A cache would silently
 *   reintroduce the rebuild-and-restart cycle it exists to avoid.
 * - **The result is a string.** backend.ts passes a string result through verbatim and
 *   JSON-stringifies anything else, so returning an object would deliver escaped
 *   `\n`-riddled markdown. That contract is invisible from this file alone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DocumentationTools } from './documentation.js';

function makeLogger(): any {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  logger.child = () => logger;
  return logger;
}

function makeClient(opts: { connected?: boolean; worldInfo?: any; queryError?: string } = {}): any {
  return {
    isConnected: () => opts.connected ?? false,
    query: vi.fn(async () => {
      if (opts.queryError) throw new Error(opts.queryError);
      return opts.worldInfo ?? {};
    }),
  };
}

function makeTools(
  client: any,
  catalog?: Array<{ name: string; description?: string }>
): DocumentationTools {
  const tools = new DocumentationTools({ foundryClient: client, logger: makeLogger() });
  if (catalog) tools.setToolCatalog(() => catalog);
  return tools;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe('foundry-docs', () => {
  let tmp: string;
  let notesPath: string;
  let emptyDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'foundry-docs-'));
    notesPath = path.join(tmp, 'notes.json');
    emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'foundry-docs-empty-'));

    // Pin every candidate location at an empty directory so a real notes file on the
    // developer's machine can never leak into a test result.
    for (const key of ['FOUNDRY_MCP_NOTES', 'LOCALAPPDATA', 'USERPROFILE', 'HOME']) {
      savedEnv[key] = process.env[key];
    }
    process.env.LOCALAPPDATA = emptyDir;
    process.env.USERPROFILE = emptyDir;
    process.env.HOME = emptyDir;
    delete process.env.FOUNDRY_MCP_NOTES;
    vi.spyOn(process, 'cwd').mockReturnValue(emptyDir);
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  async function writeNotes(notes: any): Promise<void> {
    await fs.writeFile(notesPath, JSON.stringify(notes), 'utf-8');
    process.env.FOUNDRY_MCP_NOTES = notesPath;
  }

  describe('the result contract', () => {
    it('returns a string, so backend.ts passes markdown through unescaped', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({});
      expect(typeof out).toBe('string');
      // A real newline, not the two characters backslash-n.
      expect(out).toContain('\n');
      expect(out).not.toContain('\\n');
    });

    it('defaults to the overview topic when given no arguments', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({});
      expect(out).toContain('orientation');
    });

    it('rejects an unknown topic rather than silently showing the overview', async () => {
      await expect(
        makeTools(makeClient(), []).handleFoundryDocs({ topic: 'nonsense' })
      ).rejects.toThrow();
    });
  });

  describe('silence is never an all-clear', () => {
    it('says unknown, not none, when no notes file exists', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).toMatch(/unknown, not/i);
      expect(out).not.toMatch(/no known issues/i);
    });

    it('reports a malformed notes file loudly instead of showing zero issues', async () => {
      await fs.writeFile(notesPath, '{ this is not json', 'utf-8');
      process.env.FOUNDRY_MCP_NOTES = notesPath;

      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).toMatch(/could not read the notes file/i);
      expect(out).toContain(notesPath);
      expect(out).not.toMatch(/no recorded issues match/i);
    });

    it('surfaces a malformed notes file on the overview too, not only under known-issues', async () => {
      await fs.writeFile(notesPath, 'nope', 'utf-8');
      process.env.FOUNDRY_MCP_NOTES = notesPath;

      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'overview' });
      expect(out).toMatch(/notes file problem/i);
    });

    it('lists the paths it searched so a missing file is diagnosable', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'environment' });
      expect(out).toMatch(/no notes file found/i);
      expect(out).toContain(emptyDir);
    });
  });

  describe('staleness', () => {
    const issue = (verified: string | undefined) => ({
      issues: [
        {
          id: 'x',
          summary: 'Something is broken',
          confidence: 'verified',
          ...(verified ? { verified } : {}),
        },
      ],
    });

    it('marks an issue unverified for longer than the threshold as STALE', async () => {
      await writeNotes(issue(daysAgo(100)));
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).toContain('STALE');
      expect(out).toMatch(/100 days ago/);
      expect(out).toMatch(/re-verify/i);
    });

    it('does not mark a recently checked issue as stale', async () => {
      await writeNotes(issue(daysAgo(3)));
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).not.toContain('STALE');
      expect(out).toMatch(/3 days ago/);
    });

    it('marks an undated issue as unverified rather than letting it read as current', async () => {
      await writeNotes(issue(undefined));
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).toContain('UNDATED');
    });

    it('distinguishes a suspicion from a verified defect', async () => {
      await writeNotes({
        issues: [
          { summary: 'Maybe wrong', confidence: 'suspected', verified: daysAgo(1) },
          { summary: 'Definitely wrong', confidence: 'verified', verified: daysAgo(1) },
        ],
      });
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'known-issues' });
      expect(out).toContain('SUSPECTED');
      expect(out).toContain('VERIFIED');
      // Verified defects sort ahead of guesses.
      expect(out.indexOf('Definitely wrong')).toBeLessThan(out.indexOf('Maybe wrong'));
    });
  });

  describe('the notes file is read fresh every call', () => {
    it('reflects an edit without any restart or rebuild', async () => {
      await writeNotes({ issues: [{ summary: 'First problem', verified: daysAgo(1) }] });
      const tools = makeTools(makeClient(), []);

      const before = await tools.handleFoundryDocs({ topic: 'known-issues' });
      expect(before).toContain('First problem');

      await fs.writeFile(
        notesPath,
        JSON.stringify({ issues: [{ summary: 'Second problem', verified: daysAgo(1) }] }),
        'utf-8'
      );

      const after = await tools.handleFoundryDocs({ topic: 'known-issues' });
      expect(after).toContain('Second problem');
      expect(after).not.toContain('First problem');
    });
  });

  describe('the tool inventory is generated', () => {
    it('lists tools from the injected catalog, including ones it knows nothing about', async () => {
      const out = await makeTools(makeClient(), [
        { name: 'brand-new-tool', description: 'invented after this file was written' },
        { name: 'export-world-data', description: 'x' },
      ]).handleFoundryDocs({ topic: 'tools' });

      expect(out).toContain('brand-new-tool');
      expect(out).toContain('2 tools registered');
      // Known one is annotated; unknown one is explicitly flagged as untested.
      expect(out).toMatch(/## With local notes[\s\S]*export-world-data/);
      expect(out).toMatch(/No local notes[\s\S]*brand-new-tool/);
    });

    it('says the catalog is unwired rather than inventing a tool list', async () => {
      const out = await makeTools(makeClient()).handleFoundryDocs({ topic: 'tools' });
      expect(out).toMatch(/not wired/i);
      expect(out).not.toContain('export-world-data');
    });

    it('counts known issues against the tool they affect', async () => {
      await writeNotes({
        issues: [{ summary: 'busted', tools: ['manage-macros'], verified: daysAgo(1) }],
      });
      const out = await makeTools(makeClient(), [{ name: 'manage-macros' }]).handleFoundryDocs({
        topic: 'tools',
      });
      expect(out).toMatch(/manage-macros.*1 known issue/);
    });

    it('lets the notes file add a note for a tool with no built-in one', async () => {
      await writeNotes({ toolNotes: { 'roll-dice': 'Note added from disk' } });
      const out = await makeTools(makeClient(), [{ name: 'roll-dice' }]).handleFoundryDocs({
        topic: 'tools',
      });
      expect(out).toMatch(/## With local notes[\s\S]*Note added from disk/);
    });
  });

  describe('filtering', () => {
    it('narrows issues by game system but keeps ones that apply everywhere', async () => {
      await writeNotes({
        issues: [
          { summary: 'pf2e only', systems: ['pf2e'], verified: daysAgo(1) },
          { summary: 'dnd5e only', systems: ['dnd5e'], verified: daysAgo(1) },
          { summary: 'every system', verified: daysAgo(1) },
        ],
      });
      const out = await makeTools(makeClient(), []).handleFoundryDocs({
        topic: 'known-issues',
        system: 'pf2e',
      });
      expect(out).toContain('pf2e only');
      expect(out).toContain('every system');
      expect(out).not.toContain('dnd5e only');
    });

    it('narrows recipes by substring', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({
        topic: 'recipes',
        filter: 'journal',
      });
      expect(out).toContain('Read a journal entry');
      expect(out).not.toContain('Dump a world');
    });

    it('narrows the tool list by substring', async () => {
      const out = await makeTools(makeClient(), [
        { name: 'manage-macros' },
        { name: 'roll-dice' },
      ]).handleFoundryDocs({ topic: 'tools', filter: 'macro' });
      expect(out).toContain('manage-macros');
      expect(out).not.toContain('roll-dice');
      expect(out).toContain('1 matching');
    });
  });

  describe('built-in content', () => {
    it('states the 10-second timeout, which no tool description mentions', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'constraints' });
      expect(out).toContain('10 seconds');
      expect(out).toContain('foundry-connector.ts');
    });

    it('warns that manage-journals cannot read', async () => {
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'recipes' });
      expect(out).toMatch(/manage-journals.*only deletes/);
      expect(out).toContain('list-journals');
    });

    it('covers every topic under "all"', async () => {
      const out = await makeTools(makeClient(), [{ name: 'roll-dice' }]).handleFoundryDocs({
        topic: 'all',
      });
      for (const heading of [
        '# Foundry MCP bridge',
        '# Registered tools',
        '# Known issues',
        '# Recipes',
        '# Design constraints',
        '# Environment',
      ]) {
        expect(out).toContain(heading);
      }
    });
  });

  describe('environment probe', () => {
    it('works with Foundry closed and says the docs still apply', async () => {
      const client = makeClient({ connected: false });
      const out = await makeTools(client, []).handleFoundryDocs({ topic: 'environment' });
      expect(out).toMatch(/not connected/i);
      expect(out).toMatch(/still work/i);
      expect(client.query).not.toHaveBeenCalled();
    });

    it('reports live world info when connected', async () => {
      const client = makeClient({
        connected: true,
        worldInfo: { system: { id: 'pf2e', version: '8.5.0' } },
      });
      const out = await makeTools(client, []).handleFoundryDocs({ topic: 'environment' });
      expect(client.query).toHaveBeenCalledWith('foundry-mcp-bridge.getWorldInfo');
      expect(out).toContain('pf2e');
      expect(out).toContain('8.5.0');
    });

    it('explains a failed probe instead of throwing the whole doc away', async () => {
      const client = makeClient({ connected: true, queryError: 'not a GM' });
      const out = await makeTools(client, []).handleFoundryDocs({ topic: 'environment' });
      expect(out).toContain('not a GM');
      expect(out).toMatch(/GM/);
      // The rest of the section survived.
      expect(out).toContain('# Environment');
    });

    it('names where the notes file was loaded from', async () => {
      await writeNotes({ issues: [] });
      const out = await makeTools(makeClient(), []).handleFoundryDocs({ topic: 'environment' });
      expect(out).toContain(notesPath);
      expect(out).toMatch(/read fresh on every call/i);
    });
  });
});
