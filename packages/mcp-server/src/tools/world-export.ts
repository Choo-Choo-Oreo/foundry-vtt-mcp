/**
 * World Export Tools
 *
 * Scrape a Foundry world to files on disk.
 *
 * Two things make this a separate tool rather than another `list`-style read:
 *
 * 1. **The 10-second query timeout.** `foundry-connector.ts` rejects any query that
 *    takes longer than 10s. A world's worth of full documents cannot cross that in
 *    one call, so the export runs as plan -> N bounded fetch batches, each well
 *    inside the budget.
 * 2. **Tool results cross the model's context.** Returning 2,000 stat blocks as a
 *    tool result is slow, expensive, and truncates. So the MCP server — a local
 *    Node process — writes the files itself and returns only a manifest. The model
 *    orchestrates an export it never has to read.
 *
 * Documents are written verbatim from `toObject()`. A curated shape would go stale
 * every time the game system moved a field and would silently drop whatever it did
 * not know about; the caller can always narrow, but cannot recover what was never
 * sent.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { z } from 'zod';
import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

export interface WorldExportToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const DOCUMENT_CLASSES = ['Item', 'Actor', 'JournalEntry', 'Macro', 'RollTable', 'Scene'] as const;

const LAYOUTS = ['tree', 'flat', 'single-file'] as const;

/**
 * Per-class batch sizes, tuned to the 10s query ceiling by how big one document of
 * that class typically is. A Scene carries every token, wall, light and tile it
 * contains, so three at a time; a Macro is a string.
 */
const DEFAULT_BATCH_SIZES: Record<string, number> = {
  Item: 25,
  Actor: 10,
  JournalEntry: 15,
  Macro: 40,
  RollTable: 25,
  Scene: 3,
};

/** Windows device names. Reserved with ANY extension — `CON.json` is still CON. */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Longest full path we will produce. Windows' classic MAX_PATH is 260 and long-path
 * support is opt-in per machine, so staying under it is the portable choice. Names
 * are truncated to fit rather than the write being allowed to fail — the id stays in
 * the filename either way, so a truncated document is still identifiable.
 */
const MAX_PATH_BUDGET = 240;

export class WorldExportTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: WorldExportToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'WorldExportTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'export-world-data',
        description:
          'Export Foundry world content to JSON files on disk. GM-only.\n' +
          'This is the way to pull a whole content line out of Foundry: it writes the files ' +
          'itself and returns only a manifest, so the documents never have to fit in a tool ' +
          'result. Prefer it over manage-world-items "get" for anything above ~25 documents.\n' +
          'Each document is written VERBATIM (the full stored object, `system` block included), ' +
          'so nothing the game system tracks is lost.\n' +
          'Writes alongside the documents: `_manifest.json` (machine-readable index: every ' +
          'document, its id, type, folder path and file) and `_index.md` (the same thing as a ' +
          'readable summary). Empty folders are recorded too, so the organisation survives.\n' +
          'Classes: Item, Actor, JournalEntry, Macro, RollTable, Scene. Scene export is ' +
          'supported but LARGE and the least tested — export it on its own the first time.\n' +
          'Filters (type/folder/nameFilter/ids) all stack. `folder` is a path PREFIX, so ' +
          '"Homebrew/Classes" takes everything nested under it.\n' +
          'Nothing is ever deleted: an export into an existing directory needs `overwrite`:true ' +
          'and still only adds and replaces files, it never removes files left by an earlier run.',
        inputSchema: {
          type: 'object',
          properties: {
            outputPath: {
              type: 'string',
              description:
                'Directory to write into (absolute, or relative to the MCP server process). ' +
                'Created if missing, including parents. Choose somewhere the user will find it ' +
                '— e.g. a folder under their Documents — and tell them the path afterwards.',
            },
            classes: {
              type: 'array',
              items: { type: 'string', enum: [...DOCUMENT_CLASSES] },
              description:
                'Document classes to export. Defaults to every class EXCEPT Scene (scenes are ' +
                'large; ask for them explicitly).',
            },
            type: {
              type: 'string',
              description:
                'Filter by document subtype, e.g. "feat", "weapon", "npc". Applies to every ' +
                'requested class.',
            },
            folder: {
              type: 'string',
              description:
                'Filter by folder, as a "/"-separated path PREFIX — "Homebrew/Classes" matches ' +
                'that folder and everything nested inside it. A folder id also works.',
            },
            nameFilter: {
              type: 'string',
              description: 'Filter by case-insensitive substring of the document name.',
            },
            ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Export only these specific document ids.',
            },
            layout: {
              type: 'string',
              enum: [...LAYOUTS],
              description:
                '"tree" (default): mirror the Foundry folder structure on disk, one file per ' +
                'document. "flat": one directory per class, no nesting. "single-file": one JSON ' +
                'file holding everything (best for a small set, or for feeding another script).',
            },
            overwrite: {
              type: 'boolean',
              description:
                'Required to export into a directory that already contains files. Files are ' +
                'added and replaced; nothing is ever deleted.',
            },
            batchSize: {
              type: 'number',
              description:
                'Documents per round trip. Defaults per class (Item 25, Actor 10, Scene 3), ' +
                'tuned to the 10s query timeout. Lower it if an export times out.',
            },
          },
          required: ['outputPath'],
        },
      },
      {
        name: 'export-to-compendium',
        description:
          'Export a world folder into a Foundry compendium pack. GM-only.\n' +
          'The counterpart to export-world-data: that writes JSON a person can read but ' +
          'Foundry cannot import without a script; this writes a real pack the world can use ' +
          'directly, and that can be handed to another world. Uses core Foundry’s own ' +
          '`Folder#exportToCompendium`, so packing follows Foundry’s rules.\n' +
          'The pack is created in the world if it does not exist and reused if it does. Its ' +
          'document type is fixed by the folder’s type (an Actor folder makes an Actor pack).',
        inputSchema: {
          type: 'object',
          properties: {
            folder: {
              type: 'string',
              description:
                'Folder to export: a "/"-separated full path (preferred — unambiguous), a ' +
                'folder id, or a bare name. Its whole contents are packed.',
            },
            packLabel: {
              type: 'string',
              description: 'Display name for the compendium. Defaults to "<folder name> Export".',
            },
            packName: {
              type: 'string',
              description:
                'Machine name for the pack (becomes "world.<packName>"). Defaults to a slug of ' +
                'the folder name. Pass one to target an existing pack deliberately.',
            },
            updateByName: {
              type: 'boolean',
              description:
                'Update entries already in the pack that match by name, instead of appending ' +
                'duplicates. Default false (append).',
            },
          },
          required: ['folder'],
        },
      },
    ];
  }

  /**
   * Make one path segment safe on Windows (the strictest of the three platforms, so
   * Windows-safe is safe everywhere).
   *
   * Handles the case that actually bites: a device name is reserved even WITH an
   * extension, so a document named "CON" cannot become "CON.<id>.json".
   */
  private sanitizeSegment(segment: string, fallback: string): string {
    let out = (segment ?? '')
      // Illegal on Windows, plus control characters.
      .replace(/[<>:"/\\|?*]/g, '-')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f]/g, '')
      .trim()
      // Windows silently strips trailing dots and spaces; strip them ourselves so the
      // name on disk is the name we recorded in the manifest.
      .replace(/[. ]+$/, '');

    if (!out) out = fallback;
    if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
    return out;
  }

  /** A document's filename: readable name plus id, so it is unique and identifiable. */
  private documentFileName(name: string, id: string, budget: number): string {
    const safeName = this.sanitizeSegment(name, 'unnamed');
    const suffix = `.${id}.json`;
    const room = Math.max(8, budget - suffix.length);
    return `${safeName.length > room ? safeName.slice(0, room) : safeName}${suffix}`;
  }

  async handleExportWorldData(args: any): Promise<any> {
    const schema = z.object({
      outputPath: z.string().min(1, 'outputPath is required'),
      classes: z.array(z.enum(DOCUMENT_CLASSES)).optional(),
      type: z.string().optional(),
      folder: z.string().optional(),
      nameFilter: z.string().optional(),
      ids: z.array(z.string().min(1)).optional(),
      layout: z.enum(LAYOUTS).optional(),
      overwrite: z.boolean().optional(),
      batchSize: z.number().int().positive().max(100).optional(),
    });

    const params = schema.parse(args);
    const layout = params.layout ?? 'tree';
    // Scene is excluded from the default set on purpose: scenes are by far the
    // largest documents, and "export everything" should not surprise anyone with a
    // multi-hundred-megabyte write.
    const classes = params.classes ?? DOCUMENT_CLASSES.filter(c => c !== 'Scene');
    const outputRoot = path.resolve(params.outputPath);
    const startedAt = Date.now();

    this.logger.info('export-world-data', {
      outputRoot,
      classes,
      layout,
      filters: {
        type: params.type ?? null,
        folder: params.folder ?? null,
        nameFilter: params.nameFilter ?? null,
        ids: params.ids?.length ?? 0,
      },
    });

    // --- Guard the destination before touching Foundry -----------------------
    let existingEntries: string[] = [];
    try {
      existingEntries = await fs.readdir(outputRoot);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        throw new Error(`Cannot read outputPath "${outputRoot}": ${error?.message ?? error}`);
      }
    }
    if (existingEntries.length > 0 && params.overwrite !== true) {
      throw new Error(
        `"${outputRoot}" already contains ${existingEntries.length} entr${existingEntries.length === 1 ? 'y' : 'ies'}. ` +
          `Pass overwrite:true to export into it (files are added and replaced; nothing is deleted), ` +
          `or choose an empty directory.`
      );
    }

    // --- Phase 1: plan -------------------------------------------------------
    const plan = await this.foundryClient.query('foundry-mcp-bridge.exportPlan', {
      classes,
      ...(params.type !== undefined ? { type: params.type } : {}),
      ...(params.folder !== undefined ? { folder: params.folder } : {}),
      ...(params.nameFilter !== undefined ? { nameFilter: params.nameFilter } : {}),
      ...(params.ids !== undefined ? { ids: params.ids } : {}),
    });

    if (plan?.success === false) {
      throw new Error(plan.error ?? 'Export plan refused by the Foundry module');
    }
    if (!plan?.total) {
      return {
        success: true,
        wrote: 0,
        message:
          'Nothing matched those filters — no files written. Check the folder path ' +
          '(it is a prefix of the "/"-separated path, e.g. "Homebrew/Classes") and the type.',
        filters: {
          classes,
          type: params.type ?? null,
          folder: params.folder ?? null,
          nameFilter: params.nameFilter ?? null,
        },
        counts: plan?.counts ?? {},
      };
    }

    await fs.mkdir(outputRoot, { recursive: true });

    // --- Phase 2: fetch in bounded batches and write as we go ----------------
    const manifestDocuments: Array<Record<string, any>> = [];
    const failures: Array<{ documentClass: string; id: string; error: string }> = [];
    const warnings: string[] = [];
    const singleFilePayload: Record<string, any[]> = {};
    let bytesWritten = 0;
    let filesWritten = 0;

    for (const cls of classes) {
      const entries: Array<{ id: string; name: string; type: string; folderPath: string }> =
        plan.entries?.[cls] ?? [];
      if (entries.length === 0) continue;

      const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZES[cls] ?? 20;
      if (layout === 'single-file') singleFilePayload[cls] = [];

      for (let i = 0; i < entries.length; i += batchSize) {
        const slice = entries.slice(i, i + batchSize);
        const batch = await this.foundryClient.query('foundry-mcp-bridge.exportFetchDocuments', {
          documentClass: cls,
          ids: slice.map(e => e.id),
        });

        if (batch?.success === false) {
          throw new Error(batch.error ?? `Fetch refused for ${cls}`);
        }

        for (const fail of batch?.failed ?? []) {
          failures.push({ documentClass: cls, id: fail.id, error: fail.error });
        }

        for (const doc of batch?.documents ?? []) {
          if (layout === 'single-file') {
            singleFilePayload[cls].push(doc.document);
            manifestDocuments.push({
              documentClass: cls,
              id: doc.id,
              name: doc.name,
              type: doc.type,
              folderPath: doc.folderPath,
              file: null,
            });
            continue;
          }

          // Where on disk this document goes.
          const dirSegments =
            layout === 'tree' && doc.folderPath
              ? doc.folderPath
                  .split('/')
                  .filter((s: string) => s.length > 0)
                  .map((s: string) => this.sanitizeSegment(s, 'folder'))
              : [];
          const dir = path.join(outputRoot, cls, ...dirSegments);

          // Budget the filename against what is left of MAX_PATH_BUDGET so a deep
          // tree plus a long name cannot produce an unwritable path.
          const remaining = MAX_PATH_BUDGET - (dir.length + 1);
          if (remaining < 24) {
            failures.push({
              documentClass: cls,
              id: doc.id,
              error: `folder path too deep to write within ${MAX_PATH_BUDGET} characters (${dir.length})`,
            });
            continue;
          }
          const fileName = this.documentFileName(doc.name, doc.id, remaining);
          const filePath = path.join(dir, fileName);

          try {
            await fs.mkdir(dir, { recursive: true });
            const payload = `${JSON.stringify(doc.document, null, 2)}\n`;
            await fs.writeFile(filePath, payload, 'utf8');
            bytesWritten += Buffer.byteLength(payload, 'utf8');
            filesWritten += 1;
            manifestDocuments.push({
              documentClass: cls,
              id: doc.id,
              name: doc.name,
              type: doc.type,
              folderPath: doc.folderPath,
              file: path.relative(outputRoot, filePath).split(path.sep).join('/'),
            });
          } catch (error: any) {
            failures.push({
              documentClass: cls,
              id: doc.id,
              error: `write failed: ${error?.message ?? error}`,
            });
          }
        }
      }
    }

    if (layout === 'single-file') {
      const filePath = path.join(outputRoot, 'world-export.json');
      const payload = `${JSON.stringify(singleFilePayload, null, 2)}\n`;
      await fs.writeFile(filePath, payload, 'utf8');
      bytesWritten += Buffer.byteLength(payload, 'utf8');
      filesWritten += 1;
      for (const entry of manifestDocuments) entry.file = 'world-export.json';
    }

    // --- Folder tree: empty folders are real organisation, keep them ---------
    let folderTree: any[] = [];
    try {
      const tree = await this.foundryClient.query('foundry-mcp-bridge.exportFolderTree', {
        classes,
      });
      folderTree = Array.isArray(tree) ? tree : [];
    } catch (error) {
      warnings.push(
        `Folder tree not captured: ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }

    // --- Manifest + readable index ------------------------------------------
    const manifest = {
      exportedAt: new Date().toISOString(),
      generatedBy: 'foundry-mcp-bridge export-world-data',
      world: plan.world,
      layout,
      filters: {
        classes,
        type: params.type ?? null,
        folder: params.folder ?? null,
        nameFilter: params.nameFilter ?? null,
        ids: params.ids ?? null,
      },
      counts: plan.counts,
      documentsWritten: manifestDocuments.length,
      filesWritten,
      bytesWritten,
      failures,
      warnings: [...warnings, ...(plan.skipped ?? [])],
      folders: folderTree,
      documents: manifestDocuments,
    };

    const manifestPath = path.join(outputRoot, '_manifest.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const indexPath = path.join(outputRoot, '_index.md');
    await fs.writeFile(indexPath, this.renderIndexMarkdown(manifest), 'utf8');

    const durationMs = Date.now() - startedAt;
    this.logger.info('export-world-data complete', {
      documents: manifestDocuments.length,
      files: filesWritten,
      failures: failures.length,
      durationMs,
    });

    // Manifest only — the documents themselves stay on disk by design.
    return {
      success: true,
      outputPath: outputRoot,
      layout,
      world: plan.world,
      counts: plan.counts,
      documentsWritten: manifestDocuments.length,
      filesWritten: filesWritten + 2,
      bytesWritten,
      durationMs,
      manifest: path.relative(outputRoot, manifestPath),
      readableIndex: path.relative(outputRoot, indexPath),
      failures,
      warnings: manifest.warnings,
      note:
        failures.length > 0
          ? `${failures.length} document(s) could not be exported — see "failures".`
          : 'All matched documents written. Read _index.md for a summary, _manifest.json for the full index.',
    };
  }

  /** The human-readable half of the export: what is in here, grouped and countable. */
  private renderIndexMarkdown(manifest: any): string {
    const lines: string[] = [];
    lines.push(`# ${manifest.world?.title ?? 'Foundry'} — world export`);
    lines.push('');
    lines.push(`- Exported: ${manifest.exportedAt}`);
    lines.push(
      `- World: \`${manifest.world?.id}\` · system \`${manifest.world?.system}\` ` +
        `${manifest.world?.systemVersion} · Foundry ${manifest.world?.foundry}`
    );
    lines.push(`- Layout: \`${manifest.layout}\``);
    lines.push(`- Documents: ${manifest.documentsWritten} in ${manifest.filesWritten} file(s)`);
    if (manifest.filters?.folder) lines.push(`- Folder filter: \`${manifest.filters.folder}\``);
    if (manifest.filters?.type) lines.push(`- Type filter: \`${manifest.filters.type}\``);
    if (manifest.filters?.nameFilter) {
      lines.push(`- Name filter: \`${manifest.filters.nameFilter}\``);
    }
    lines.push('');

    if (manifest.failures?.length) {
      lines.push(`## Failures (${manifest.failures.length})`);
      lines.push('');
      for (const f of manifest.failures) {
        lines.push(`- \`${f.documentClass}\` \`${f.id}\` — ${f.error}`);
      }
      lines.push('');
    }
    if (manifest.warnings?.length) {
      lines.push('## Warnings');
      lines.push('');
      for (const w of manifest.warnings) lines.push(`- ${w}`);
      lines.push('');
    }

    const byClass: Record<string, any[]> = {};
    for (const doc of manifest.documents ?? []) {
      (byClass[doc.documentClass] ??= []).push(doc);
    }

    for (const cls of Object.keys(byClass).sort()) {
      const docs = byClass[cls];
      lines.push(`## ${cls} (${docs.length})`);
      lines.push('');
      const byFolder: Record<string, any[]> = {};
      for (const doc of docs) (byFolder[doc.folderPath || '(root)'] ??= []).push(doc);

      for (const folder of Object.keys(byFolder).sort()) {
        lines.push(`### ${folder}`);
        lines.push('');
        lines.push('| Name | Type | Id | File |');
        lines.push('| --- | --- | --- | --- |');
        for (const doc of byFolder[folder].sort((a: any, b: any) =>
          String(a.name).localeCompare(String(b.name))
        )) {
          const file = doc.file ? `\`${doc.file}\`` : '—';
          lines.push(`| ${doc.name} | ${doc.type} | \`${doc.id}\` | ${file} |`);
        }
        lines.push('');
      }
    }

    const emptyFolders = (manifest.folders ?? []).filter(
      (f: any) =>
        !(manifest.documents ?? []).some(
          (d: any) => d.folderPath === f.path && d.documentClass === f.type
        )
    );
    if (emptyFolders.length > 0) {
      lines.push(`## Folders with nothing exported (${emptyFolders.length})`);
      lines.push('');
      lines.push('Recorded so the structure survives even where no document matched.');
      lines.push('');
      for (const f of emptyFolders) lines.push(`- \`${f.type}\` — ${f.path || '(root)'}`);
      lines.push('');
    }

    return `${lines.join('\n')}\n`;
  }

  async handleExportToCompendium(args: any): Promise<any> {
    const schema = z.object({
      folder: z.string().min(1, 'folder is required'),
      packLabel: z.string().min(1).optional(),
      packName: z
        .string()
        .min(1)
        .regex(
          /^[a-z0-9][a-z0-9-]*$/,
          'packName must be lowercase letters, digits and hyphens, starting with a letter or digit'
        )
        .optional(),
      updateByName: z.boolean().optional(),
    });

    const params = schema.parse(args);

    this.logger.info('export-to-compendium', {
      folder: params.folder,
      packName: params.packName ?? null,
      updateByName: params.updateByName ?? false,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.exportFolderToCompendium', {
        folder: params.folder,
        ...(params.packLabel !== undefined ? { packLabel: params.packLabel } : {}),
        ...(params.packName !== undefined ? { packName: params.packName } : {}),
        ...(params.updateByName !== undefined ? { updateByName: params.updateByName } : {}),
      });
    } catch (error) {
      this.logger.error('Failed to export folder to compendium', error);
      throw new Error(
        `Failed to export to compendium: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
