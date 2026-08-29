/**
 * Pathfinder 2e homebrew character-build items.
 *
 * One tool, an `itemType` discriminator (ancestry / heritage / background /
 * class / deity / feat), covering the Cinderfall blocker: build ABCD + feat
 * items that actually attach to a `character` sheet.
 *
 * Two construction paths, chosen by `basedOn`:
 *  - `basedOn` supplied  -> clone a compendium item, deep-merge the overrides.
 *  - `basedOn` omitted    -> build from a per-type minimal template.
 * Both paths run through one shared emitter (module side) that guarantees
 * `traits` / `rules` / `description` / `publication` / `slug` / `_migration`
 * exist — the fix for the "heritage `reading 'value'`" crash.
 *
 * Follows the leaner wfrp4e / pf2e-create-npc convention: module-scope
 * `.strict()` schemas, `safeParse` returning `{ success: false, error }`.
 */

import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

export interface PF2eAbcItemToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ITEM_TYPES = ['ancestry', 'heritage', 'background', 'class', 'deity', 'feat'] as const;
const PF2E_SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'] as const;
const RARITIES = ['common', 'uncommon', 'rare', 'unique'] as const;
const VISIONS = ['normal', 'low-light', 'darkvision', 'greater-darkvision'] as const;
const DEITY_CATEGORIES = ['deity', 'pantheon', 'philosophy', 'covenant'] as const;
const SANCT_MODALS = ['can', 'must', 'no'] as const;
const FEAT_ACTION_TYPES = ['passive', 'action', 'reaction', 'free'] as const;

/** Fields common to every itemType. */
const baseShape = {
  name: z.string().min(1).optional(),
  basedOn: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Compendium ref to clone: "<packId>.<ItemName>" e.g. "pf2e.ancestries.Goblin", or a full "Compendium.…" UUID.'
    ),
  targetCharacter: z
    .string()
    .min(1)
    .optional()
    .describe('Name or ID of a character actor to attach the finished item to.'),
  description: z.string().optional(),
  rarity: z.enum(RARITIES).optional(),
  traits: z.array(z.string()).optional(),
  folder: z.string().optional().describe('Item-sidebar folder. Defaults to "Foundry MCP Items".'),
  overrides: z.record(z.any()).optional().describe('Raw system-field overrides, deep-merged last.'),
};

const rankSchema = z.number().int().min(0).max(4);
const boostRows = z
  .array(z.union([z.string(), z.array(z.string())]))
  .describe(
    'One entry per choice slot; [] or "" = a free boost, ["str","dex"] = a fixed pick from that set.'
  );

const schemas: Record<(typeof ITEM_TYPES)[number], z.ZodTypeAny> = {
  ancestry: z
    .object({
      itemType: z.literal('ancestry'),
      ...baseShape,
      hp: z.number().int().min(1).optional(),
      size: z.enum(PF2E_SIZES).optional(),
      speed: z.number().int().min(0).optional(),
      boosts: boostRows.optional(),
      flaws: boostRows.optional(),
      languages: z.array(z.string()).optional(),
      additionalLanguages: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Bonus language count (INT-based).'),
      vision: z.enum(VISIONS).optional(),
    })
    .strict(),
  heritage: z
    .object({
      itemType: z.literal('heritage'),
      ...baseShape,
      ancestryName: z.string().optional(),
      ancestrySlug: z.string().optional(),
      ancestryUuid: z.string().optional(),
    })
    .strict(),
  background: z
    .object({
      itemType: z.literal('background'),
      ...baseShape,
      boosts: boostRows.optional(),
      trainedSkills: z.array(z.string()).optional(),
      trainedLore: z
        .array(z.string())
        .optional()
        .describe('Lore subcategory names, e.g. ["Circus"].'),
    })
    .strict(),
  class: z
    .object({
      itemType: z.literal('class'),
      ...baseShape,
      keyAbility: z.array(z.string()).optional(),
      hp: z.number().int().min(1).optional(),
      perception: rankSchema.optional(),
      savingThrows: z
        .object({ fortitude: rankSchema, reflex: rankSchema, will: rankSchema })
        .partial()
        .optional(),
      attacks: z
        .object({
          simple: rankSchema,
          martial: rankSchema,
          advanced: rankSchema,
          unarmed: rankSchema,
          other: z.object({ name: z.string(), rank: rankSchema }).partial(),
        })
        .partial()
        .optional(),
      defenses: z
        .object({ unarmored: rankSchema, light: rankSchema, medium: rankSchema, heavy: rankSchema })
        .partial()
        .optional(),
      spellcasting: rankSchema.optional(),
      trainedSkills: z.array(z.string()).optional(),
    })
    .strict(),
  deity: z
    .object({
      itemType: z.literal('deity'),
      ...baseShape,
      category: z.enum(DEITY_CATEGORIES).optional(),
      sanctification: z
        .object({ modal: z.enum(SANCT_MODALS), what: z.array(z.string()) })
        .partial()
        .optional(),
      domains: z
        .object({ primary: z.array(z.string()), alternate: z.array(z.string()) })
        .partial()
        .optional(),
      font: z.array(z.enum(['harm', 'heal'])).optional(),
      attribute: z.array(z.string()).optional().describe('Divine attribute(s), e.g. ["cha"].'),
      skill: z.array(z.string()).optional(),
      weapons: z.array(z.string()).optional().describe('Favored weapon slugs.'),
    })
    .strict(),
  feat: z
    .object({
      itemType: z.literal('feat'),
      ...baseShape,
      level: z.number().int().min(0).max(30).optional(),
      category: z
        .string()
        .optional()
        .describe('e.g. "ancestry","class","skill","general","bonus".'),
      actionType: z.enum(FEAT_ACTION_TYPES).optional(),
      actions: z.number().int().min(1).max(3).nullable().optional(),
      prerequisites: z.array(z.string()).optional(),
      maxTakable: z.number().int().min(1).optional(),
      onlyLevel1: z.boolean().optional(),
    })
    .strict(),
};

export class PF2eAbcItemTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: PF2eAbcItemToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'PF2eAbcItemTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'pf2e-create-abc-item',
        description:
          '[Pathfinder 2e only] Build a homebrew Ancestry, Heritage, Background, Class, Deity, or Feat ' +
          'and (optionally) attach it to a character. Set `itemType` to pick the mode. ' +
          'Two ways to build: give `basedOn` (e.g. "pf2e.ancestries.Goblin" or a "Compendium.…" UUID) ' +
          'to clone-and-tweak an existing item, or omit it to build from a minimal template. ' +
          '`overrides` is deep-merged onto system data last for anything the friendly params miss. ' +
          'The item is filed in "Foundry MCP Items" unless `folder` is given; pass `targetCharacter` ' +
          '(name or ID) to also add it to a PC — attach an ancestry + class before heritage/feats. ' +
          'Per-mode params: ' +
          'ancestry → hp, size, speed, boosts, flaws, languages, additionalLanguages, vision; ' +
          'heritage → ancestryName/ancestrySlug/ancestryUuid; ' +
          'background → boosts, trainedSkills, trainedLore; ' +
          'class → keyAbility, hp, perception, savingThrows, attacks, defenses, spellcasting, trainedSkills (proficiency ranks 0-4); ' +
          'deity → category, sanctification, domains, font, attribute, skill, weapons; ' +
          'feat → level, category, actionType, actions, prerequisites, maxTakable, onlyLevel1.',
        inputSchema: {
          type: 'object',
          properties: {
            itemType: {
              type: 'string',
              enum: [...ITEM_TYPES],
              description: 'Which build item to create.',
            },
            name: { type: 'string', description: 'Item name. Required unless `basedOn` is given.' },
            basedOn: {
              type: 'string',
              description:
                'Clone source: "<packId>.<ItemName>" (e.g. "pf2e.ancestries.Goblin") or a full "Compendium.…" UUID.',
            },
            targetCharacter: {
              type: 'string',
              description: 'Character actor name/ID to attach the finished item to.',
            },
            description: { type: 'string', description: 'Item description (HTML allowed).' },
            rarity: { type: 'string', enum: [...RARITIES], description: 'Default "common".' },
            traits: { type: 'array', items: { type: 'string' }, description: 'Item trait slugs.' },
            folder: {
              type: 'string',
              description: 'Item-sidebar folder. Defaults to "Foundry MCP Items".',
            },
            overrides: {
              type: 'object',
              description: 'Raw system-field overrides, deep-merged last.',
            },

            hp: { type: 'number', description: 'ancestry: ancestry HP. class: HP per level.' },
            size: { type: 'string', enum: [...PF2E_SIZES], description: 'ancestry size.' },
            speed: { type: 'number', description: 'ancestry land Speed (ft).' },
            boosts: {
              type: 'array',
              description:
                'ancestry/background: one entry per choice slot — [] or "" for a free boost, ["str","dex"] for a fixed pick.',
              items: {},
            },
            flaws: {
              type: 'array',
              description: 'ancestry ability flaws, same shape as boosts.',
              items: {},
            },
            languages: {
              type: 'array',
              items: { type: 'string' },
              description: 'ancestry starting languages.',
            },
            additionalLanguages: { type: 'number', description: 'ancestry bonus language count.' },
            vision: { type: 'string', enum: [...VISIONS], description: 'ancestry vision type.' },

            ancestryName: {
              type: 'string',
              description: 'heritage: parent ancestry display name.',
            },
            ancestrySlug: { type: 'string', description: 'heritage: parent ancestry slug.' },
            ancestryUuid: { type: 'string', description: 'heritage: parent ancestry UUID.' },

            trainedSkills: {
              type: 'array',
              items: { type: 'string' },
              description: 'background/class: trained skill slugs.',
            },
            trainedLore: {
              type: 'array',
              items: { type: 'string' },
              description: 'background: Lore names.',
            },

            keyAbility: {
              type: 'array',
              items: { type: 'string' },
              description: 'class: key ability options.',
            },
            perception: { type: 'number', description: 'class: Perception proficiency rank 0-4.' },
            savingThrows: {
              type: 'object',
              description: 'class: { fortitude, reflex, will } proficiency ranks 0-4.',
              properties: {
                fortitude: { type: 'number' },
                reflex: { type: 'number' },
                will: { type: 'number' },
              },
            },
            attacks: {
              type: 'object',
              description:
                'class: { simple, martial, advanced, unarmed } ranks 0-4, plus optional other:{name,rank}.',
              properties: {
                simple: { type: 'number' },
                martial: { type: 'number' },
                advanced: { type: 'number' },
                unarmed: { type: 'number' },
                other: {
                  type: 'object',
                  properties: { name: { type: 'string' }, rank: { type: 'number' } },
                },
              },
            },
            defenses: {
              type: 'object',
              description: 'class: { unarmored, light, medium, heavy } proficiency ranks 0-4.',
              properties: {
                unarmored: { type: 'number' },
                light: { type: 'number' },
                medium: { type: 'number' },
                heavy: { type: 'number' },
              },
            },
            spellcasting: {
              type: 'number',
              description: 'class: spellcasting proficiency rank 0-4.',
            },

            category: {
              type: 'string',
              description:
                'deity: "deity"/"pantheon"/"philosophy"/"covenant". feat: feat category slug.',
            },
            sanctification: {
              type: 'object',
              description: 'deity: { modal: "can"|"must"|"no", what: ["holy"|"unholy"] }.',
              properties: {
                modal: { type: 'string', enum: [...SANCT_MODALS] },
                what: { type: 'array', items: { type: 'string' } },
              },
            },
            domains: {
              type: 'object',
              description: 'deity: { primary: [...], alternate: [...] } domain slugs.',
              properties: {
                primary: { type: 'array', items: { type: 'string' } },
                alternate: { type: 'array', items: { type: 'string' } },
              },
            },
            font: {
              type: 'array',
              items: { type: 'string', enum: ['harm', 'heal'] },
              description: 'deity: divine font.',
            },
            attribute: {
              type: 'array',
              items: { type: 'string' },
              description: 'deity: divine attribute(s).',
            },
            skill: {
              type: 'array',
              items: { type: 'string' },
              description: 'deity: divine skill(s).',
            },
            weapons: {
              type: 'array',
              items: { type: 'string' },
              description: 'deity: favored weapon slug(s).',
            },

            level: { type: 'number', description: 'feat: feat level (0-30).' },
            actionType: {
              type: 'string',
              enum: [...FEAT_ACTION_TYPES],
              description: 'feat: passive/action/reaction/free.',
            },
            actions: { type: ['number', 'null'], description: 'feat: action cost 1-3, or null.' },
            prerequisites: {
              type: 'array',
              items: { type: 'string' },
              description: 'feat: prerequisite lines.',
            },
            maxTakable: { type: 'number', description: 'feat: how many times it can be taken.' },
            onlyLevel1: { type: 'boolean', description: 'feat: ancestry feat locked to level 1.' },
          },
          required: ['itemType'],
        },
      },
    ];
  }

  async handleCreateAbcItem(args: unknown): Promise<any> {
    const disc = z
      .object({ itemType: z.enum(ITEM_TYPES) })
      .passthrough()
      .safeParse(args);
    if (!disc.success) {
      return {
        success: false,
        error: `Invalid arguments: itemType is required and must be one of: ${ITEM_TYPES.join(', ')}.`,
      };
    }

    const schema = schemas[disc.data.itemType];
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    const data = parsed.data as Record<string, any>;
    if (!data.name && !data.basedOn) {
      return {
        success: false,
        error:
          'Provide `name` (to build from a template) or `basedOn` (to clone a compendium item).',
      };
    }

    const system = await detectGameSystem(this.foundryClient, this.logger);
    if (system !== 'pf2e') {
      return {
        success: false,
        error:
          `pf2e-create-abc-item requires the Pathfinder 2e system. ` +
          `Detected: "${getCachedSystemId() ?? 'unknown'}".`,
      };
    }

    this.logger.info('Creating PF2e ABC item', {
      itemType: data.itemType,
      name: data.name ?? `(from ${data.basedOn})`,
      targetCharacter: data.targetCharacter,
    });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.createPf2eAbcItem', data);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
