/**
 * Documentation Tools
 *
 * A manual for this bridge, readable from inside a session.
 *
 * The problem this solves: an MCP client is handed ~40 tool descriptions at connect
 * time and nothing else. Descriptions say what a tool takes; they never say which of
 * three overlapping tools to reach for, which ones are quietly broken for your game
 * system, or that the transport underneath them times out at 10 seconds. Every fresh
 * session rediscovers that by trial and error, and the expensive discoveries are the
 * ones that *look* like they worked.
 *
 * Three sources, deliberately kept apart:
 *
 * 1. **The tool inventory is generated** from the live catalog the backend assembled,
 *    never hand-listed. A hand-written list of tools is wrong the moment somebody adds
 *    one; a generated list cannot be.
 * 2. **Constraints and recipes are compiled in** (below). They describe the shape of
 *    the system rather than any specific defect, so they are safe to ship and stable
 *    enough not to rot between releases.
 * 3. **Known issues load from a JSON file at call time** — not bundled, not committed.
 *    That keeps working notes about defects out of a public fork, and it means the
 *    notes can be corrected without rebuilding or restarting anything: the MCP tool
 *    *list* is negotiated once at connect, but a tool's *result* is computed per call.
 *    Edit the file, ask again, see the change.
 *
 * Every issue carries a confidence and a date, and anything older than
 * STALE_AFTER_DAYS is rendered with a loud staleness marker. An undated claim that
 * reads as current is worse than no claim at all — it is how a fixed bug goes on
 * being worked around for months.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface DocumentationToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const TOPICS = [
  'overview',
  'tools',
  'known-issues',
  'recipes',
  'constraints',
  'environment',
  'all',
] as const;

type Topic = (typeof TOPICS)[number];

/**
 * The slice of a registered tool definition this tool needs. `| undefined` is
 * explicit because tsconfig sets `exactOptionalPropertyTypes`, under which an
 * optional property is not assignable from an explicitly-undefined one.
 */
type CatalogEntry = { name: string; description?: string | undefined };

/** An issue unverified for longer than this is rendered as stale, not as fact. */
const STALE_AFTER_DAYS = 45;

const NOTES_FILENAME = 'foundry-mcp-notes.json';

interface NoteIssue {
  id?: string;
  summary: string;
  detail?: string;
  tools?: string[];
  systems?: string[];
  confidence?: 'verified' | 'suspected';
  verified?: string;
  workaround?: string;
  evidence?: string;
}

interface NoteRecipe {
  id?: string;
  title: string;
  when?: string;
  steps: string[];
  notes?: string;
}

interface NotesFile {
  version?: number;
  issues?: NoteIssue[];
  recipes?: NoteRecipe[];
  toolNotes?: Record<string, string>;
}

interface LoadedNotes {
  data: NotesFile | null;
  loadedFrom: string | null;
  searched: string[];
  error: string | null;
}

/**
 * Constraints that cost real time to discover and are not visible from any tool
 * description. Each carries its citation so a future reader can re-check it rather
 * than trusting this file.
 */
const BUILTIN_CONSTRAINTS: Array<{ title: string; body: string }> = [
  {
    title: 'The query transport times out at 10 seconds — hard-coded',
    body:
      '`packages/mcp-server/src/foundry-connector.ts:379-382` rejects any query that has not ' +
      'answered in 10s. Nothing about a tool description hints at this. Every bulk operation ' +
      'must therefore be split into bounded batches, which is why export runs as one planning ' +
      'call followed by N fetch batches instead of a single call. If a read of many large ' +
      'documents fails with a timeout, the fix is a smaller batch, not a retry.',
  },
  {
    title: 'Anything a tool returns crosses the model context',
    body:
      'Tool results are text in the conversation. Returning two thousand stat blocks is slow, ' +
      'expensive, and will truncate. This is the reason export-world-data writes files itself ' +
      'and returns only a manifest: the model orchestrates an export whose contents it never ' +
      'has to read. When you want data on disk, do not route it through a read tool first.',
  },
  {
    title: 'Exports are verbatim `toObject()`, on purpose',
    body:
      'Documents are written exactly as stored, including the whole `system` block and any ' +
      'module flags. A curated or "readable" shape was considered and rejected: it goes stale ' +
      'every time a game system moves a field, and silently drops whatever it does not know ' +
      'about. A caller can always narrow verbatim data; it cannot recover what was never sent.',
  },
  {
    title: 'The export never deletes',
    body:
      'A non-empty destination is refused unless `overwrite` is true, and even then files are ' +
      'only added or replaced — files left by an earlier run are not removed. So a directory ' +
      'that has been exported to twice may hold documents that no longer exist in the world. ' +
      'Export to a fresh directory when you need the result to be an exact mirror.',
  },
  {
    title: 'Filenames are sanitised for Windows, the strictest target',
    body:
      'Each path segment is sanitised separately: illegal characters become "-", control ' +
      'characters are stripped, trailing dots and spaces are removed (Windows drops them ' +
      'silently), reserved device names are prefixed (CON.json is still CON), and total path ' +
      'length is budgeted to 240 characters against a MAX_PATH of 260. Document names are ' +
      'truncated to fit rather than letting a write fail; the id stays in the filename, so a ' +
      'truncated document is still identifiable.',
  },
  {
    title: 'The tool list is negotiated once, at connect time',
    body:
      'Adding, renaming, or changing the *schema* of a tool requires a full restart of the MCP ' +
      'client and of the Foundry world before it is visible. Changing what an existing tool ' +
      '*returns* does not — results are computed per call. This is why the known-issues notes ' +
      'below are read from disk instead of compiled in.',
  },
  {
    title: 'Every world-wide read is GM-gated',
    body:
      'The Foundry-side query layer checks GM status before answering, because a stored ' +
      'document can carry GM-only notes and a world-wide read is the broadest read the bridge ' +
      'offers. If queries fail with an access error, check that the browser session running ' +
      'the bridge is logged in as a GM — not that the tool is broken.',
  },
  {
    title: 'Every tool is a pull — nothing from Foundry is ever pushed to you',
    body:
      'MCP tools here only run when called; there is no channel by which Foundry notifies a ' +
      'client that something happened. This matters most for `manage-combat` and ' +
      '`list-chat-log`: "whose turn is it now" and "what did the player just roll" are only ' +
      'ever answered by calling again, not delivered when the event occurs. Design any ' +
      'GMing workflow around polling at the right moments (after a player says they acted, ' +
      'before deciding an NPC turn), not around waiting for an update.',
  },
  {
    title: 'Exactly one tool is irreversible, and it is built inside out',
    body:
      'Deleting documents puts them somewhere a person can still get at — Foundry keeps the ' +
      'world file, and an item deleted from an actor still exists in the world. ' +
      '`delete-compendium-pack` is the one call with nothing behind it: the pack and every ' +
      'entry in it are gone. So it is the one tool whose DEFAULT does nothing. Called with ' +
      'just `pack`, it reports and deletes nothing; deleting takes a second call with ' +
      '`dryRun`:false and `expectedEntryCount` matching what the first call reported.\n' +
      'These are speed bumps, not locks, and that is deliberate. A guard that cannot be ' +
      'satisfied gets routed around — the pack gets deleted from the Foundry sidebar ' +
      'instead, where nothing is logged at all. Every check here is satisfiable by a caller ' +
      'who has looked at the pack and unsatisfiable by one who has not. A bare `confirm`:true ' +
      'flag would be neither: the model sets it, so it protects nobody. The consent that ' +
      'matters is the user naming the pack, not a boolean.\n' +
      "The single absolute refusal is system and module packs, and it is not this bridge's " +
      'rule: `deleteCompendium` belongs to the owning package and Foundry rejects it for ' +
      'anything but `world.*`. Refusing early just turns an exception into a sentence.',
  },
];

/**
 * Worked sequences. These exist because the costly mistakes here are about *which*
 * tool to reach for, not about how to call one.
 */
const BUILTIN_RECIPES: NoteRecipe[] = [
  {
    id: 'choose-read-path',
    title: 'Choosing between the three ways to read world Items',
    when: 'Any time you want Item data and are about to guess.',
    steps: [
      'Names, ids, types, folders only — `manage-world-items` action:"list". Cheap, unbounded, ' +
        'no `system` block. Use it to find ids.',
      'Full stat blocks for a handful — `manage-world-items` action:"get" with `ids` or a ' +
        'filter. Returns whole documents; capped (default 25) because documents are large and ' +
        'the transport has a 10s ceiling.',
      'Everything, or more than the cap — `export-world-data`. Writes to disk and returns a ' +
        'manifest, so size stops being a context problem.',
    ],
    notes:
      'Picking wrong is usually slow rather than incorrect, but "get" against an unfiltered ' +
      'world will refuse rather than truncate — that refusal is the tool working, not failing.',
  },
  {
    id: 'export-a-world',
    title: 'Dump a world to a directory of JSON',
    when: 'Backup, offline reference, diffing content between worlds.',
    steps: [
      'Call `export-world-data` with a destination directory. Default document classes ' +
        'exclude Scene, which is much heavier than the rest — pass it explicitly if wanted.',
      'Narrow with `type`, `folder` (prefix match on the folder path) or `nameFilter` when you ' +
        'want a subset. Choose a layout: "tree" mirrors the Foundry folder structure, "flat" ' +
        'puts everything in one directory, "single-file" writes one combined JSON.',
      'Read the returned manifest for counts and failures. A per-document failure does not ' +
        'abort the run, so check the failure count rather than assuming zero.',
      'Read `_index.md` in the destination for a human-readable summary alongside the data.',
    ],
    notes:
      'This is a reference and backup format, not a migration format: nothing reads it back ' +
      'into a world. Say so when handing someone the directory. For a real round trip inside ' +
      'Foundry, use `export-to-compendium`, which writes an actual pack.',
  },
  {
    id: 'read-a-journal',
    title: 'Read a journal entry',
    when: 'The obvious guess fails here, so it is worth stating.',
    steps: [
      'Use `list-journals` — it reads. All entries, or one `journalId`, or a `journalId` plus ' +
        '`pageId` for a single page.',
      '`manage-journals` only deletes, by design. An `action:"get"` guess against it fails.',
    ],
  },
  {
    id: 'bulk-macros',
    title: 'Read every macro in one call',
    when: 'Exporting or auditing macros.',
    steps: [
      '`manage-macros` action:"list" with `full`:true returns the complete command for every ' +
        'macro at once, instead of one "get" per macro.',
      'Prefer ids over names everywhere afterwards. Macro names collide freely and Foundry ' +
        'does nothing to prevent it; `folderPath` in the response disambiguates across folders ' +
        'but not within one.',
    ],
  },
  {
    id: 'folder-to-pack',
    title: 'Turn a world folder into a real compendium pack',
    when: 'You want content reusable across worlds, inside Foundry.',
    steps: [
      'Call `export-to-compendium` with the folder path. It creates the pack if absent.',
      'Re-running with `updateByName`:true matches existing entries by name and updates them ' +
        'instead of appending duplicates. Without it, a second run duplicates.',
      'A pack whose document type differs from the folder contents is refused rather than ' +
        'mixed.',
    ],
  },
  {
    id: 'find-compendium-content',
    title: 'Find something in compendium packs',
    when: 'Most system content lives in packs, not in the world.',
    steps: [
      '`search-compendium` to locate candidates, or `list-compendium-packs` to see what is ' +
        'installed.',
      '`get-compendium-entry-full` for the complete document of one entry.',
      'Note there is no bulk export path for pack contents — only world documents. Reading a ' +
        'whole pack means one call per entry.',
    ],
  },
  {
    id: 'delete-a-compendium-pack',
    title: 'Delete a world compendium pack',
    when: 'A pack is genuinely unwanted — scratch output, a bad export, a superseded pack.',
    steps: [
      'Confirm the user named this pack. Do not delete a pack on your own initiative because ' +
        'it looks like test data; being sure it is scratch is exactly the state in which ' +
        'people delete the wrong thing.',
      'If the content might be wanted, export it FIRST — `export-world-data` for JSON on ' +
        'disk. Nothing in the delete path takes a backup, and there is no undo.',
      'Call `delete-compendium-pack` with just `pack`. This is a dry run by default: it ' +
        "deletes nothing and returns the pack's type, lock state, entry count and entry names.",
      'Show the user that report — pack id and entry count — and get their word before ' +
        'going further.',
      'Call again with `dryRun`:false and `expectedEntryCount` set to the count from the dry ' +
        'run. A mismatch aborts and deletes nothing; that means the pack changed under you or ' +
        'it is not the pack you thought.',
      'Check `verified` in the response. It re-reads `game.packs` after the delete rather than ' +
        'trusting the call, so it can say FAILED even when no error was thrown.',
    ],
    notes:
      'Only `world.*` packs. System and module packs (pf2e.*, any module) are refused, and ' +
      'Foundry would refuse them too — to stop using that content, disable the module. The ' +
      'entry list in the response is a receipt of what was destroyed, not a copy of it.',
  },
  {
    id: 'change-content-instead-of-deleting',
    title: 'Change or edit existing content',
    when:
      'The usual case. Deleting and recreating loses ids, ownership and links; editing ' +
      'does not.',
    steps: [
      'World Items — `manage-world-items` action:"update" with `updates`: each patch needs ' +
        '`id` plus the fields to change. Merges into the stored document, so an unmentioned ' +
        'field is left alone rather than blanked.',
      'Actors — `manage-actors` action:"update". For items ON an actor use ' +
        '"update-items" / "delete-items"; deleting an actor\'s copy does not touch the world ' +
        'item it came from.',
      'Journals — `replace-journal-page` for page content. `manage-journals` only deletes.',
      'Read the change back before reporting it — `manage-world-items` action:"get", or ' +
        '`get-character` with `raw`:true, which exposes stored `_source` fields the curated ' +
        'view hides. A success response is not evidence the field you meant actually moved.',
      'Ids are the safe handle everywhere. Names collide, silently, and nothing warns you.',
    ],
    notes:
      'There is no edit path for entries already inside a compendium pack. Changing packed ' +
      'content means editing the world documents and re-running `export-to-compendium` with ' +
      '`updateByName`:true — without that flag a re-run appends duplicates rather than ' +
      'updating.',
  },
  {
    id: 'run-a-live-encounter',
    title: 'Run a live combat encounter turn by turn',
    when: 'GMing an active fight, not just prepping one.',
    steps: [
      'Before the fight: `manage-combat` action:"add-combatants" with the scene `tokenIds`, ' +
        'then action:"roll-initiative" (omit `combatantIds`/`npcsOnly` to roll for everyone ' +
        'without initiative yet), then action:"start".',
      'Each turn: action:"get" to see whose turn it is, current HP, and conditions before ' +
        'deciding an NPC action or narrating a result.',
      "After the current combatant acts (yours or a player's): `list-chat-log` to see what " +
        'was actually rolled/posted, then `manage-combat` action:"next-turn".',
      'Mark a kill with action:"toggle-defeated" on that combatant\'s id so the tracker (and ' +
        'a later "get") reflects it.',
      'action:"end" when the fight is over.',
    ],
    notes:
      'There is no push channel from Foundry to an MCP client — "get" and "list-chat-log" are ' +
      'both pulls. Call them again after something happens; nothing is delivered on its own. ' +
      'A player rolling their own initiative at the table is `set-initiative`, not a fresh roll.',
  },
  {
    id: 'debug-a-foundry-module',
    title: 'Debug a Foundry module while developing it',
    when:
      'Building or fixing a module in this ecosystem (this bridge or any other) and something ' +
      'is not behaving, rather than asking the user to open DevTools and paste an error.',
    steps: [
      "`get-module-diagnostics` first — Foundry/system versions, every installed module's id " +
        'and version (confirms which build is actually loaded; a rebuild that was not deployed ' +
        'looks identical from the outside otherwise), and recent captured errors/warnings.',
      'If `recentErrors` is empty but something is visibly broken, the failure likely predates ' +
        "this session's world load (the buffer starts empty on every reload) — ask the user to " +
        'reproduce it once more with the tab open, then call again.',
      'Cross-reference a module id/version against what you expect to have deployed. A stale ' +
        'build showing up here explains a lot of "I fixed that already" confusion.',
    ],
    notes:
      'This captures error/warn-level console output plus uncaught exceptions and unhandled ' +
      'promise rejections only — not routine console.log traffic, and not anything from before ' +
      'the module loaded.',
  },
];

/**
 * Neutral usage guidance for tools that have actually been exercised. Defect claims
 * deliberately do NOT live here — they live in the notes file, which is not committed.
 */
const BUILTIN_TOOL_NOTES: Record<string, string> = {
  'manage-world-items':
    'Three read paths with different costs: "list" (index), "get" (full documents, capped), ' +
    'and export-world-data for bulk. See the "choose-read-path" recipe.',
  'manage-journals': 'Deletes only. Reading journals is `list-journals`.',
  'list-journals': 'This is the journal *read* tool: all, one entry, or one page.',
  'manage-macros':
    'action:"list" with `full`:true returns every command in one call. Names collide — key ' +
    'off ids.',
  'export-world-data':
    'Writes JSON to disk and returns a manifest, not the documents. Refuses a non-empty ' +
    'destination without `overwrite`. Excludes Scene by default.',
  'export-to-compendium':
    'Writes a real Foundry pack from a world folder. Use `updateByName` on re-runs or entries ' +
    'duplicate.',
  'get-world-info': 'Cheapest way to learn the game system and version before branching on it.',
  'delete-compendium-pack':
    'The only irreversible tool here. Dry run by default — one call reports, a second with ' +
    '`dryRun`:false and a matching `expectedEntryCount` deletes. World packs only; system and ' +
    'module packs are refused. Takes no backup. See the "delete-a-compendium-pack" recipe.',
  'manage-combat':
    'Combat tracker: whose turn, round, initiative order, HP/defeated, and advancing the ' +
    'encounter. "get" is read-only; every other action needs a GM. There is no push from ' +
    'Foundry — call "get" again after a player acts. See the "run-a-live-encounter" recipe.',
  'list-chat-log':
    'Read-back complement to send-chat-message/roll-dice. Pull-based like manage-combat: ' +
    'nothing arrives here on its own, call it after a turn to see what was posted.',
  'get-module-diagnostics':
    'Foundry/system versions, every installed module with its version and active state, and ' +
    'recent captured console errors/warnings/uncaught exceptions — for developing and ' +
    'debugging a Foundry module without asking the user to paste DevTools output. See the ' +
    '"debug-a-foundry-module" recipe.',
};

export class DocumentationTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  /**
   * Supplied by the backend after it has assembled the full catalog. A function
   * rather than an array because this tool's own definition is part of that catalog,
   * so the value cannot exist yet at construction time.
   */
  private toolCatalog: (() => CatalogEntry[]) | null = null;

  constructor({ foundryClient, logger }: DocumentationToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'DocumentationTools' });
  }

  setToolCatalog(fn: () => CatalogEntry[]): void {
    this.toolCatalog = fn;
  }

  getToolDefinitions() {
    return [
      {
        name: 'foundry-docs',
        description:
          'Read the manual for this Foundry bridge: how the tools fit together, which one to ' +
          'reach for, known defects, and the design constraints that are not visible from any ' +
          'tool description. Call this BEFORE trial-and-error testing of an unfamiliar tool, ' +
          'and before concluding that something is broken.\n' +
          'Topics:\n' +
          '- "overview" (default): what this bridge is, its layers, and what else to ask for.\n' +
          '- "tools": every registered tool, generated from the live catalog, marked with ' +
          'whether local notes exist for it.\n' +
          '- "known-issues": recorded defects and suspicions, each with a confidence level and ' +
          'the date it was last checked. Anything stale says so.\n' +
          '- "recipes": worked call sequences for the multi-step jobs (exporting a world, ' +
          'reading journals, bulk macro reads, folder to compendium).\n' +
          '- "constraints": the 10-second query timeout, context costs, filename rules, and ' +
          'other things worth not rediscovering.\n' +
          '- "environment": where the notes file was loaded from, whether Foundry is ' +
          'connected, and (if it is) the live system, version and document counts.\n' +
          '- "all": everything.\n' +
          'Optional `filter` restricts tools, issues and recipes to those mentioning a string ' +
          '(e.g. "macro", "pf2e"). Optional `system` restricts issues to one game system. ' +
          'Works with Foundry closed; only "environment" needs a live connection.',
        inputSchema: {
          type: 'object',
          properties: {
            topic: {
              type: 'string',
              enum: [...TOPICS],
              description: 'Which section to read. Defaults to "overview".',
            },
            filter: {
              type: 'string',
              description:
                'Case-insensitive substring. Restricts tools, issues and recipes to matches.',
            },
            system: {
              type: 'string',
              description:
                'Game system id (e.g. "pf2e") to restrict known issues to. Issues that apply ' +
                'to every system are always included.',
            },
          },
        },
      },
    ];
  }

  async handleFoundryDocs(args: any): Promise<string> {
    const schema = z.object({
      topic: z.enum(TOPICS).optional(),
      filter: z.string().optional(),
      system: z.string().optional(),
    });

    const params = schema.parse(args ?? {});
    const topic: Topic = params.topic ?? 'overview';
    const filter = params.filter?.trim().toLowerCase() || null;

    this.logger.debug('foundry-docs', { topic, filter, system: params.system });

    const notes = await this.loadNotes();
    const wants = (t: Topic) => topic === 'all' || topic === t;

    const sections: string[] = [];

    if (wants('overview')) sections.push(this.renderOverview(notes));
    if (wants('tools')) sections.push(this.renderTools(notes, filter));
    if (wants('known-issues')) {
      sections.push(this.renderIssues(notes, filter, params.system ?? null));
    }
    if (wants('recipes')) sections.push(this.renderRecipes(notes, filter));
    if (wants('constraints')) sections.push(this.renderConstraints(filter));
    if (wants('environment')) sections.push(await this.renderEnvironment(notes));

    return sections.join('\n\n---\n\n');
  }

  // --- notes loading --------------------------------------------------------

  /**
   * Candidate locations, in priority order. The file is intentionally not bundled,
   * so it has to be found at runtime. `import.meta.url` is defined away to the
   * literal string "bundled" by the esbuild step (see package.json build:bundle),
   * so resolving relative to this module is not an option — hence explicit
   * candidates plus an env override.
   */
  private notesCandidates(): string[] {
    const candidates: string[] = [];

    if (process.env.FOUNDRY_MCP_NOTES) candidates.push(process.env.FOUNDRY_MCP_NOTES);

    candidates.push(path.join(os.homedir(), '.foundry-mcp', NOTES_FILENAME));

    if (process.env.LOCALAPPDATA) {
      candidates.push(
        path.join(
          process.env.LOCALAPPDATA,
          'FoundryMCPServer',
          'foundry-mcp-server',
          'packages',
          'mcp-server',
          'dist',
          NOTES_FILENAME
        )
      );
    }

    candidates.push(path.join(process.cwd(), NOTES_FILENAME));

    return candidates;
  }

  /**
   * Read fresh on every call — no caching. The whole point of keeping these notes on
   * disk is that correcting them takes effect immediately; a cache would reintroduce
   * the restart this design exists to avoid. The file is small.
   *
   * A malformed file is reported loudly rather than skipped. Silently falling through
   * to "no known issues" would be the worst possible failure: it reads as an all-clear.
   */
  private async loadNotes(): Promise<LoadedNotes> {
    const searched = this.notesCandidates();

    for (const candidate of searched) {
      let raw: string;
      try {
        raw = await fs.readFile(candidate, 'utf-8');
      } catch {
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as NotesFile;
        return { data: parsed, loadedFrom: candidate, searched, error: null };
      } catch (e) {
        return {
          data: null,
          loadedFrom: null,
          searched,
          error: `Found ${candidate} but could not parse it as JSON: ${
            e instanceof Error ? e.message : 'unknown error'
          }. Treat "no known issues" below as UNKNOWN, not as an all-clear.`,
        };
      }
    }

    return { data: null, loadedFrom: null, searched, error: null };
  }

  /** Whole days since an ISO date, or null if absent/unparseable. */
  private ageInDays(date: string | undefined): number | null {
    if (!date) return null;
    const then = Date.parse(date);
    if (Number.isNaN(then)) return null;
    return Math.floor((Date.now() - then) / 86400000);
  }

  // --- rendering ------------------------------------------------------------

  private renderOverview(notes: LoadedNotes): string {
    const catalog = this.toolCatalog ? this.toolCatalog() : [];
    const issueCount = notes.data?.issues?.length ?? 0;

    const lines: string[] = [
      '# Foundry MCP bridge — orientation',
      '',
      'Three processes, and knowing which one you are talking to explains most surprises:',
      '',
      '1. **The MCP server** — a local Node process. It owns the tool definitions, does the ' +
        'orchestration, and can write files to disk. It runs whether or not Foundry is open.',
      "2. **The Foundry module** — runs inside the GM's browser tab. It is the only thing " +
        'that can touch actual Foundry documents, and it answers queries from the server.',
      '3. **Foundry itself** — the world data.',
      '',
      'Consequences worth holding on to:',
      '',
      '- If Foundry is closed, tools that read world data cannot work. This tool still can.',
      "- Work happens in a real browser, so a long operation blocks the GM's UI. Bulk reads " +
        'are batched for that reason as much as for the timeout.',
      '- The bridge acts as a GM. World-wide reads are gated on it.',
      '',
      `**Registered tools:** ${catalog.length || 'unknown (catalog not wired)'}. ` +
        `**Known issues on file:** ${notes.data ? issueCount : 'none loaded'}.`,
      '',
      'Ask for more with `foundry-docs`:',
      '',
      '| topic | what you get |',
      '| --- | --- |',
      '| `tools` | every registered tool, generated live, flagged where notes exist |',
      '| `known-issues` | recorded defects and suspicions, dated and confidence-marked |',
      '| `recipes` | worked sequences for the multi-step jobs |',
      '| `constraints` | timeouts, context costs, filename rules |',
      '| `environment` | notes file location, connection state, live world counts |',
      '| `all` | everything at once |',
    ];

    if (notes.error) {
      lines.push('', `> **Notes file problem.** ${notes.error}`);
    } else if (!notes.data) {
      lines.push(
        '',
        '> **No local notes file loaded.** Known issues will be empty — which means *unknown*, ' +
          'not *none*. Ask for the `environment` topic to see where it looked.'
      );
    }

    return lines.join('\n');
  }

  private renderTools(notes: LoadedNotes, filter: string | null): string {
    const lines: string[] = ['# Registered tools'];

    if (!this.toolCatalog) {
      lines.push(
        '',
        '**The tool catalog was not wired into this tool**, so the list cannot be generated. ' +
          'That is a wiring defect in the backend, not an empty world. Rather than hand-list ' +
          'tools here and risk being wrong, this section reports nothing.'
      );
      return lines.join('\n');
    }

    const toolNotes: Record<string, string> = {
      ...BUILTIN_TOOL_NOTES,
      ...(notes.data?.toolNotes ?? {}),
    };

    const issuesByTool = new Map<string, number>();
    for (const issue of notes.data?.issues ?? []) {
      for (const t of issue.tools ?? []) {
        issuesByTool.set(t, (issuesByTool.get(t) ?? 0) + 1);
      }
    }

    const all = this.toolCatalog();
    const matched = filter
      ? all.filter(
          t =>
            t.name.toLowerCase().includes(filter) ||
            (t.description ?? '').toLowerCase().includes(filter)
        )
      : all;

    lines.push(
      '',
      `Generated from the live catalog: ${all.length} tools registered` +
        (filter ? `, ${matched.length} matching "${filter}"` : '') +
        '.',
      '',
      'Full descriptions are already in your context from the connect handshake, so they are ' +
        'not repeated here. What this adds is which tools carry local notes and which are ' +
        'untested by us.',
      ''
    );

    const documented = matched.filter(t => toolNotes[t.name] || issuesByTool.has(t.name));
    const undocumented = matched.filter(t => !toolNotes[t.name] && !issuesByTool.has(t.name));

    if (documented.length > 0) {
      lines.push('## With local notes', '');
      for (const t of documented.sort((a, b) => a.name.localeCompare(b.name))) {
        const issues = issuesByTool.get(t.name);
        const flag = issues ? ` **(${issues} known issue${issues === 1 ? '' : 's'})**` : '';
        lines.push(`- **${t.name}**${flag} — ${toolNotes[t.name] ?? 'See known-issues.'}`);
      }
      lines.push('');
    }

    if (undocumented.length > 0) {
      lines.push(
        '## No local notes — untested by us',
        '',
        'These are registered and presumably work; we have simply never exercised them here. ' +
          'Absence of a note is not evidence of correctness.',
        '',
        undocumented
          .map(t => t.name)
          .sort()
          .map(n => `- ${n}`)
          .join('\n')
      );
    }

    return lines.join('\n');
  }

  private renderIssues(notes: LoadedNotes, filter: string | null, system: string | null): string {
    const lines: string[] = ['# Known issues'];

    if (notes.error) {
      lines.push('', `**Could not read the notes file.** ${notes.error}`);
      return lines.join('\n');
    }

    if (!notes.data) {
      lines.push(
        '',
        'No notes file was found, so nothing is recorded here. **This means unknown, not ' +
          'clear.** Ask for the `environment` topic to see the paths searched, and add a file ' +
          'at any of them to start recording.'
      );
      return lines.join('\n');
    }

    let issues = notes.data.issues ?? [];

    if (system) {
      const wanted = system.toLowerCase();
      issues = issues.filter(
        i => !i.systems || i.systems.length === 0 || i.systems.some(s => s.toLowerCase() === wanted)
      );
    }

    if (filter) {
      issues = issues.filter(i =>
        [i.id, i.summary, i.detail, i.workaround, ...(i.tools ?? []), ...(i.systems ?? [])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(filter)
      );
    }

    if (issues.length === 0) {
      lines.push('', 'No recorded issues match.');
      return lines.join('\n');
    }

    // Verified before suspected, then most recently checked first — the reader should
    // hit the things we are sure about before the things we are guessing at.
    const rank = (i: NoteIssue) => (i.confidence === 'suspected' ? 1 : 0);
    issues = [...issues].sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.verified ?? '').localeCompare(a.verified ?? '');
    });

    lines.push('', `${issues.length} recorded.`, '');

    for (const issue of issues) {
      const age = this.ageInDays(issue.verified);
      const confidence = issue.confidence === 'suspected' ? 'SUSPECTED' : 'VERIFIED';

      let dateNote: string;
      if (age === null) {
        dateNote = '**UNDATED — treat as unverified**';
      } else if (age > STALE_AFTER_DAYS) {
        dateNote = `**STALE — last checked ${issue.verified}, ${age} days ago. Re-verify before relying on this.**`;
      } else {
        dateNote = `last checked ${issue.verified} (${age} day${age === 1 ? '' : 's'} ago)`;
      }

      lines.push(`## ${issue.summary}`);
      lines.push('');
      lines.push(`*${confidence}* · ${dateNote}`);

      if (issue.tools?.length) lines.push(`Tools: ${issue.tools.join(', ')}`);
      if (issue.systems?.length) lines.push(`Systems: ${issue.systems.join(', ')}`);

      lines.push('');
      if (issue.detail) lines.push(issue.detail, '');
      if (issue.workaround) lines.push(`**Workaround:** ${issue.workaround}`, '');
      if (issue.evidence) lines.push(`**Evidence:** ${issue.evidence}`, '');
    }

    return lines.join('\n').trimEnd();
  }

  private renderRecipes(notes: LoadedNotes, filter: string | null): string {
    const all = [...BUILTIN_RECIPES, ...(notes.data?.recipes ?? [])];

    const matched = filter
      ? all.filter(r =>
          [r.id, r.title, r.when, r.notes, ...r.steps]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(filter)
        )
      : all;

    const lines: string[] = ['# Recipes'];

    if (matched.length === 0) {
      lines.push('', `No recipe matches "${filter}".`);
      return lines.join('\n');
    }

    for (const recipe of matched) {
      lines.push('', `## ${recipe.title}`);
      if (recipe.when) lines.push('', `*When:* ${recipe.when}`);
      lines.push('');
      recipe.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
      if (recipe.notes) lines.push('', recipe.notes);
    }

    return lines.join('\n');
  }

  private renderConstraints(filter: string | null): string {
    const matched = filter
      ? BUILTIN_CONSTRAINTS.filter(c => `${c.title} ${c.body}`.toLowerCase().includes(filter))
      : BUILTIN_CONSTRAINTS;

    const lines: string[] = ['# Design constraints'];

    if (matched.length === 0) {
      lines.push('', `No constraint matches "${filter}".`);
      return lines.join('\n');
    }

    for (const c of matched) {
      lines.push('', `## ${c.title}`, '', c.body);
    }

    return lines.join('\n');
  }

  private async renderEnvironment(notes: LoadedNotes): Promise<string> {
    const lines: string[] = ['# Environment'];

    lines.push('', '## Notes file', '');
    if (notes.loadedFrom) {
      lines.push(`Loaded from \`${notes.loadedFrom}\`.`);
      lines.push('');
      lines.push(
        'This file is read fresh on every call. Edit it and ask again — no rebuild, no ' +
          'restart. It is not committed to the repository by design.'
      );
    } else if (notes.error) {
      lines.push(notes.error);
    } else {
      lines.push('No notes file found. Searched, in order:', '');
      lines.push(...notes.searched.map(p => `- \`${p}\``));
      lines.push(
        '',
        'Create a JSON file at any of these to start recording. Shape:',
        '',
        '```json',
        '{',
        '  "version": 1,',
        '  "issues": [',
        '    {',
        '      "id": "short-slug",',
        '      "summary": "One line, what is wrong",',
        '      "detail": "What happens and why it matters",',
        '      "tools": ["tool-name"],',
        '      "systems": ["pf2e"],',
        '      "confidence": "verified",',
        '      "verified": "2026-09-07",',
        '      "workaround": "What to do instead",',
        '      "evidence": "The call made and what came back"',
        '    }',
        '  ],',
        '  "recipes": [],',
        '  "toolNotes": { "tool-name": "One-line usage note" }',
        '}',
        '```',
        '',
        'Omit `systems` for an issue that applies everywhere. Omit `verified` and it renders ' +
          'as undated, which is deliberately unflattering.'
      );
    }

    lines.push('', '## Foundry connection', '');

    if (!this.foundryClient.isConnected()) {
      lines.push(
        'Not connected. Foundry is closed, the world is not loaded, or the bridge module is ' +
          'not active.',
        '',
        'Everything above still works — this tool reads from disk, not from Foundry. Only the ' +
          'live world figures below need a connection.'
      );
      return lines.join('\n');
    }

    lines.push('Connected.', '');

    try {
      const info = await this.foundryClient.query('foundry-mcp-bridge.getWorldInfo');
      lines.push('```json', JSON.stringify(info, null, 2), '```');
      lines.push(
        '',
        'Use the system id above when asking for `known-issues` with a `system` filter.'
      );
    } catch (e) {
      lines.push(
        `The connection reports as open but the world query failed: ` +
          `${e instanceof Error ? e.message : 'unknown error'}. ` +
          `That usually means the browser tab is on the setup screen rather than in a world, ` +
          `or the bridge user is not a GM.`
      );
    }

    return lines.join('\n');
  }
}
