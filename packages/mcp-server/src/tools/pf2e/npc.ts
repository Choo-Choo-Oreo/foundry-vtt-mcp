/**
 * Pathfinder 2e NPC creation.
 *
 * The PF2e analogue of `dnd5e-create-npc`: build a complete NPC stat block from
 * friendly parameters in one call, instead of cloning a bestiary creature with
 * `create-actor-from-compendium` and patching it. Follows the leaner wfrp4e tool
 * convention — module-scope `.strict()` schemas, `safeParse` returning
 * `{ success: false, error }` rather than throwing.
 */

import { z } from 'zod';
import { FoundryClient } from '../../foundry-client.js';
import { Logger } from '../../logger.js';
import { detectGameSystem, getCachedSystemId } from '../../utils/system-detection.js';

export interface PF2eNpcToolsOptions {
  foundryClient: FoundryClient;
  logger: Logger;
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const SKILL_KEYS = [
  'acrobatics',
  'arcana',
  'athletics',
  'crafting',
  'deception',
  'diplomacy',
  'intimidation',
  'medicine',
  'nature',
  'occultism',
  'performance',
  'religion',
  'society',
  'stealth',
  'survival',
  'thievery',
] as const;
const PF2E_SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'] as const;
const RARITIES = ['common', 'uncommon', 'rare', 'unique'] as const;

const iwrSchema = z
  .object({
    type: z.string().min(1),
    value: z.number().int().optional(),
    exceptions: z.array(z.string()).optional(),
  })
  .strict();

const strikeSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(['melee', 'ranged']).default('melee'),
    bonus: z.number().int(),
    damage: z.string().min(1).describe('e.g. "1d8+4 slashing" or "2d6 fire"'),
    traits: z.array(z.string()).default([]),
    rangeIncrement: z.number().int().positive().optional(),
  })
  .strict();

const createNpcSchema = z
  .object({
    name: z.string().min(1),
    level: z.number().int().min(-1).max(30),
    abilities: z
      .object({
        str: z.number().int(),
        dex: z.number().int(),
        con: z.number().int(),
        int: z.number().int(),
        wis: z.number().int(),
        cha: z.number().int(),
      })
      .strict(),
    hp: z.number().int().min(1),
    ac: z.number().int().min(1),
    saves: z
      .object({
        fortitude: z.number().int(),
        reflex: z.number().int(),
        will: z.number().int(),
      })
      .strict(),
    perception: z.number().int(),
    size: z.enum(PF2E_SIZES).default('med'),
    rarity: z.enum(RARITIES).default('common'),
    traits: z.array(z.string()).default([]),
    speed: z.number().int().min(0).default(25),
    otherSpeeds: z
      .array(z.object({ type: z.string().min(1), value: z.number().int().min(0) }).strict())
      .default([]),
    skills: z.record(z.enum(SKILL_KEYS), z.number().int()).default({}),
    languages: z.array(z.string()).default([]),
    immunities: z.array(z.string().min(1)).default([]),
    weaknesses: z.array(iwrSchema).default([]),
    resistances: z.array(iwrSchema).default([]),
    strikes: z.array(strikeSchema).default([]),
    blurb: z.string().default(''),
    publicNotes: z.string().default(''),
    folder: z.string().optional(),
    addToScene: z.boolean().default(false),
  })
  .strict();

export class PF2eNpcTools {
  private foundryClient: FoundryClient;
  private logger: Logger;

  constructor({ foundryClient, logger }: PF2eNpcToolsOptions) {
    this.foundryClient = foundryClient;
    this.logger = logger.child({ component: 'PF2eNpcTools' });
  }

  getToolDefinitions() {
    return [
      {
        name: 'pf2e-create-npc',
        description:
          '[Pathfinder 2e only] Build a complete NPC stat block from scratch in one call: ' +
          'level, ability modifiers, HP, AC, Fortitude/Reflex/Will, Perception, size, rarity, ' +
          'creature traits, land + other speeds, trained skills (as modifiers), languages, ' +
          'immunities/weaknesses/resistances, and simple melee/ranged Strikes. ' +
          'Numbers are PF2e modifiers, not scores — `abilities.str: 4` means a +4 STR mod, ' +
          '`saves.fortitude: 9` means Fort +9. ' +
          'The actor is placed in the "Foundry MCP Creatures" folder unless `folder` is given. ' +
          'For a bestiary monster use create-actor-from-compendium instead; to add feats/spells/' +
          'equipment after creation use manage-world-items add-to-actor.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'NPC name.' },
            level: { type: 'number', description: 'Creature level (-1 to 30).' },
            abilities: {
              type: 'object',
              description: 'Ability MODIFIERS (not scores). All six required.',
              properties: Object.fromEntries(ABILITY_KEYS.map(k => [k, { type: 'number' }])),
              required: [...ABILITY_KEYS],
            },
            hp: { type: 'number', description: 'Max hit points.' },
            ac: { type: 'number', description: 'Armor Class.' },
            saves: {
              type: 'object',
              description: 'Save modifiers.',
              properties: {
                fortitude: { type: 'number' },
                reflex: { type: 'number' },
                will: { type: 'number' },
              },
              required: ['fortitude', 'reflex', 'will'],
            },
            perception: { type: 'number', description: 'Perception modifier.' },
            size: { type: 'string', enum: [...PF2E_SIZES], description: 'Default "med".' },
            rarity: { type: 'string', enum: [...RARITIES], description: 'Default "common".' },
            traits: {
              type: 'array',
              items: { type: 'string' },
              description: 'Creature traits, e.g. ["undead","construct"]. Rarity is separate.',
            },
            speed: { type: 'number', description: 'Land Speed in feet. Default 25.' },
            otherSpeeds: {
              type: 'array',
              description: 'Non-land speeds, e.g. [{ "type": "fly", "value": 40 }].',
              items: {
                type: 'object',
                properties: { type: { type: 'string' }, value: { type: 'number' } },
                required: ['type', 'value'],
              },
            },
            skills: {
              type: 'object',
              description:
                'Trained skills as total modifiers, e.g. { "athletics": 12, "stealth": 9 }. ' +
                'Keys must be the 16 PF2e skill slugs.',
              additionalProperties: { type: 'number' },
            },
            languages: { type: 'array', items: { type: 'string' } },
            immunities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Immunity type slugs, e.g. ["fire","bleed"].',
            },
            weaknesses: {
              type: 'array',
              description: '[{ "type": "cold-iron", "value": 5 }]',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'number' },
                  exceptions: { type: 'array', items: { type: 'string' } },
                },
                required: ['type', 'value'],
              },
            },
            resistances: {
              type: 'array',
              description: '[{ "type": "physical", "value": 10, "exceptions": ["adamantine"] }]',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  value: { type: 'number' },
                  exceptions: { type: 'array', items: { type: 'string' } },
                },
                required: ['type', 'value'],
              },
            },
            strikes: {
              type: 'array',
              description:
                'Simple attacks: [{ "name": "Claw", "kind": "melee", "bonus": 14, ' +
                '"damage": "2d6+7 slashing", "traits": ["agile"] }]. Ranged strikes may set ' +
                '"rangeIncrement".',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  kind: { type: 'string', enum: ['melee', 'ranged'] },
                  bonus: { type: 'number' },
                  damage: { type: 'string' },
                  traits: { type: 'array', items: { type: 'string' } },
                  rangeIncrement: { type: 'number' },
                },
                required: ['name', 'bonus', 'damage'],
              },
            },
            blurb: { type: 'string', description: 'One-line recall knowledge blurb.' },
            publicNotes: { type: 'string', description: 'Public description (HTML allowed).' },
            folder: {
              type: 'string',
              description: 'Folder name/ID or "/"-path. Defaults to "Foundry MCP Creatures".',
            },
            addToScene: { type: 'boolean', description: 'Also drop a token on the active scene.' },
          },
          required: ['name', 'level', 'abilities', 'hp', 'ac', 'saves', 'perception'],
        },
      },
    ];
  }

  async handleCreateNpc(args: unknown): Promise<any> {
    const parsed = createNpcSchema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return { success: false, error: `Invalid arguments: ${detail}` };
    }

    const system = await detectGameSystem(this.foundryClient, this.logger);
    if (system !== 'pf2e') {
      return {
        success: false,
        error:
          `pf2e-create-npc requires the Pathfinder 2e system. ` +
          `Detected: "${getCachedSystemId() ?? 'unknown'}".`,
      };
    }

    this.logger.info('Creating PF2e NPC', { name: parsed.data.name, level: parsed.data.level });

    try {
      return await this.foundryClient.query('foundry-mcp-bridge.createPf2eNpcActor', parsed.data);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
