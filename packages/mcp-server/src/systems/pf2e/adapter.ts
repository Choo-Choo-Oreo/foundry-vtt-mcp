/**
 * Pathfinder 2e System Adapter
 *
 * Implements SystemAdapter interface for Pathfinder 2nd Edition support.
 * Handles creature indexing, filtering, formatting, and data extraction.
 */

import type {
  SystemAdapter,
  SystemMetadata,
  SystemCreatureIndex,
  PF2eCreatureIndex,
} from '../types.js';
import {
  PF2eFiltersSchema,
  matchesPF2eFilters,
  describePF2eFilters,
  type PF2eFilters,
} from './filters.js';

/**
 * Pathfinder 2e system adapter
 */
export class PF2eAdapter implements SystemAdapter {
  getMetadata(): SystemMetadata {
    return {
      id: 'pf2e',
      name: 'pf2e',
      displayName: 'Pathfinder 2nd Edition',
      version: '1.0.0',
      description:
        'Support for PF2e game system with Level, traits, rarity, and spellcasting entries',
      supportedFeatures: {
        creatureIndex: true,
        characterStats: true,
        spellcasting: true,
        powerLevel: true, // Uses Level
      },
    };
  }

  canHandle(systemId: string): boolean {
    return systemId.toLowerCase() === 'pf2e';
  }

  /**
   * Extract creature data from Foundry document for indexing
   * This is called by the index builder in Foundry's browser context
   */
  extractCreatureData(
    doc: any,
    pack: any
  ): { creature: SystemCreatureIndex; errors: number } | null {
    // Implementation is in index-builder.ts since it runs in browser
    // This method is here for type compliance but delegates to IndexBuilder
    throw new Error('extractCreatureData should be called from PF2eIndexBuilder, not the adapter');
  }

  getFilterSchema() {
    return PF2eFiltersSchema;
  }

  matchesFilters(creature: SystemCreatureIndex, filters: Record<string, any>): boolean {
    // Validate filters match PF2e schema
    const validated = PF2eFiltersSchema.safeParse(filters);
    if (!validated.success) {
      return false;
    }

    return matchesPF2eFilters(creature, validated.data as PF2eFilters);
  }

  getDataPaths(): Record<string, string | null> {
    return {
      // Pathfinder 2e specific paths
      level: 'system.details.level.value',
      creatureType: 'system.traits.value', // Array of traits
      size: 'system.traits.size.value',
      alignment: 'system.details.alignment.value',
      rarity: 'system.traits.rarity',
      traits: 'system.traits.value', // All traits as array
      hitPoints: 'system.attributes.hp',
      armorClass: 'system.attributes.ac.value',
      abilities: 'system.abilities',
      skills: 'system.skills',
      perception: 'system.perception',
      saves: 'system.saves',
      // PF2e doesn't have CR or legendary actions
      challengeRating: null,
      legendaryActions: null,
      legendaryResistances: null,
      spells: null, // PF2e uses spellcasting entries instead
    };
  }

  formatCreatureForList(creature: SystemCreatureIndex): any {
    const pf2eCreature = creature as PF2eCreatureIndex;
    const formatted: any = {
      id: creature.id,
      name: creature.name,
      type: creature.type,
      pack: {
        id: creature.packName,
        label: creature.packLabel,
      },
    };

    // Add PF2e specific stats
    if (pf2eCreature.systemData) {
      const stats: any = {};

      if (pf2eCreature.systemData.level !== undefined) {
        stats.level = pf2eCreature.systemData.level;
      }

      if (pf2eCreature.systemData.traits && pf2eCreature.systemData.traits.length > 0) {
        stats.traits = pf2eCreature.systemData.traits;

        // Extract primary creature type from traits
        const creatureTraits = [
          'aberration',
          'animal',
          'beast',
          'celestial',
          'construct',
          'dragon',
          'elemental',
          'fey',
          'fiend',
          'fungus',
          'humanoid',
          'monitor',
          'ooze',
          'plant',
          'undead',
        ];
        const primaryType = pf2eCreature.systemData.traits.find((t: string) =>
          creatureTraits.includes(t.toLowerCase())
        );
        if (primaryType) stats.creatureType = primaryType;
      }

      if (pf2eCreature.systemData.rarity) {
        stats.rarity = pf2eCreature.systemData.rarity;
      }

      if (pf2eCreature.systemData.size) {
        stats.size = pf2eCreature.systemData.size;
      }

      if (pf2eCreature.systemData.alignment) {
        stats.alignment = pf2eCreature.systemData.alignment;
      }

      if (pf2eCreature.systemData.hitPoints) {
        stats.hitPoints = pf2eCreature.systemData.hitPoints;
      }

      if (pf2eCreature.systemData.armorClass) {
        stats.armorClass = pf2eCreature.systemData.armorClass;
      }

      if (pf2eCreature.systemData.hasSpellcasting) {
        stats.spellcaster = true;
      }

      if (Object.keys(stats).length > 0) {
        formatted.stats = stats;
      }
    }

    if (creature.img) {
      formatted.hasImage = true;
    }

    return formatted;
  }

  formatCreatureForDetails(creature: SystemCreatureIndex): any {
    const pf2eCreature = creature as PF2eCreatureIndex;
    const formatted = this.formatCreatureForList(creature);

    // Add additional details
    if (pf2eCreature.systemData) {
      formatted.detailedStats = {
        level: pf2eCreature.systemData.level,
        traits: pf2eCreature.systemData.traits,
        size: pf2eCreature.systemData.size,
        alignment: pf2eCreature.systemData.alignment,
        rarity: pf2eCreature.systemData.rarity,
        hitPoints: pf2eCreature.systemData.hitPoints,
        armorClass: pf2eCreature.systemData.armorClass,
        hasSpellcasting: pf2eCreature.systemData.hasSpellcasting,
      };
    }

    if (creature.img) {
      formatted.img = creature.img;
    }

    return formatted;
  }

  describeFilters(filters: Record<string, any>): string {
    const validated = PF2eFiltersSchema.safeParse(filters);
    if (!validated.success) {
      return 'invalid filters';
    }

    return describePF2eFilters(validated.data as PF2eFilters);
  }

  getPowerLevel(creature: SystemCreatureIndex): number | undefined {
    const pf2eCreature = creature as PF2eCreatureIndex;

    // PF2e: Level is the primary metric
    if (pf2eCreature.systemData?.level !== undefined) {
      return pf2eCreature.systemData.level;
    }

    return undefined;
  }

  /**
   * Extract character statistics from actor data
   */
  extractCharacterStats(actorData: any): any {
    const system = actorData.system || {};
    const stats: any = {};

    // Basic info
    stats.name = actorData.name;
    stats.type = actorData.type;

    // Level
    const level = system.details?.level?.value ?? system.details?.level ?? system.level;
    if (level !== undefined && level !== null) {
      stats.level = Number(level);
    }

    // Hit Points
    const hp = system.attributes?.hp;
    if (hp) {
      stats.hitPoints = {
        current: hp.value ?? 0,
        max: hp.max ?? 0,
        temp: hp.temp ?? 0,
      };
    }

    // Armor Class
    const ac = system.attributes?.ac?.value ?? system.attributes?.ac;
    if (ac !== undefined) {
      stats.armorClass = ac;
    }

    // Abilities (STR, DEX, CON, INT, WIS, CHA)
    if (system.abilities) {
      stats.abilities = {};
      for (const [key, ability] of Object.entries(system.abilities)) {
        const abilityData = ability as any;
        stats.abilities[key] = {
          value: abilityData.value ?? abilityData.mod ?? 0,
          modifier: abilityData.mod ?? 0,
        };
      }
    }

    // Skills
    if (system.skills) {
      stats.skills = {};
      for (const [key, skill] of Object.entries(system.skills)) {
        const skillData = skill as any;
        stats.skills[key] = {
          modifier: skillData.value ?? skillData.mod ?? 0,
          rank: skillData.rank ?? 0,
          proficient: (skillData.rank ?? 0) > 0,
        };
      }
    }

    // Perception
    if (system.perception) {
      stats.perception = {
        modifier: system.perception.value ?? system.perception.mod ?? 0,
        rank: system.perception.rank ?? 0,
      };
    }

    // Saves
    if (system.saves) {
      stats.saves = {};
      for (const [key, save] of Object.entries(system.saves)) {
        const saveData = save as any;
        stats.saves[key] = {
          modifier: saveData.value ?? saveData.mod ?? 0,
          rank: saveData.rank ?? 0,
        };
      }
    }

    // Creature-specific info
    if (actorData.type === 'npc') {
      const traits = system.traits?.value || [];
      if (Array.isArray(traits) && traits.length > 0) {
        stats.traits = traits;

        // Extract primary creature type
        const creatureTraits = [
          'aberration',
          'animal',
          'beast',
          'celestial',
          'construct',
          'dragon',
          'elemental',
          'fey',
          'fiend',
          'fungus',
          'humanoid',
          'monitor',
          'ooze',
          'plant',
          'undead',
        ];
        const primaryType = traits.find((t: string) => creatureTraits.includes(t.toLowerCase()));
        if (primaryType) {
          stats.creatureType = primaryType;
        }
      }

      const size = system.traits?.size?.value ?? system.traits?.size;
      if (size) {
        stats.size = size;
      }

      const alignment = system.details?.alignment?.value ?? system.details?.alignment;
      if (alignment) {
        stats.alignment = alignment;
      }

      const rarity = system.traits?.rarity;
      if (rarity) {
        stats.rarity = rarity;
      }
    }

    // Spellcasting
    const spellcasting = system.spellcasting || {};
    const hasSpells = Object.keys(spellcasting).length > 0;
    if (hasSpells) {
      stats.spellcasting = {
        hasSpells: true,
        entries: Object.keys(spellcasting).length,
      };
    }

    return stats;
  }

  /**
   * Human-readable PF2e actor schema reference for `manage-actors describe`.
   *
   * PF2e's DataModel accepts a malformed `system` payload into _source without
   * complaint and only throws later, during prepareData() — at which point the
   * sheet won't open and item operations fail with unrelated-looking errors.
   * The field notes below are the ones that actually bite.
   */
  describeActorSchema(): string {
    return [
      '=== Pathfinder 2e Actor Schema Reference ===',
      '',
      'ACTOR TYPES: character, npc, familiar, hazard, loot, vehicle, party',
      '',
      'A PRISTINE `character` system looks like this — note what is null:',
      '  abilities: null            (see ABILITIES warning below)',
      '  traits/saves/proficiencies/build: null   (derived — never author)',
      '  skills: {}                 (must EXIST; {} is correct for a blank PC)',
      '  attributes: { hp: { value, temp } }      (NO speed key at all)',
      '  details: { level:{value}, languages:{value:[],details:""},',
      '             keyability:{value}, xp:{value,min,max}, biography:{...},',
      '             age/height/weight/gender/ethnicity/nationality:{value} }',
      '  resources: { heroPoints: { value, max } }',
      '  pfs: { playerNumber, characterNumber, levelBump, currentFaction,',
      '         school, reputation:{EA,GA,HH,VS,RO,VW} }',
      '',
      'NEVER AUTHOR on a character — prepareBaseData overwrites these every',
      'cycle, and a hand-written value can break the build:',
      '  build, saves, proficiencies, martial, traits, movement, perception,',
      '  hands, crafting',
      '  (NPCs are different: an npc DOES author system.saves.<save>.value and',
      '   system.traits.value directly.)',
      '',
      'UNGUARDED READS — malformed or missing here throws during prepareData:',
      '  attributes.speed   If present it MUST include otherSpeeds: [].',
      '                     PF2e does `...speed.otherSpeeds` and spreading',
      '                     undefined throws, aborting prepareBaseData before',
      '                     it creates details.deities — which then surfaces as',
      '                     an unrelated "setting \'primary\'" error when adding',
      '                     a deity. Safest: omit speed and let the ancestry set',
      '                     it. (normalizePayload injects otherSpeeds for you.)',
      '  skills             Must exist; read as skills[k]?.rank for all 16.',
      '  details.level.value, details.keyability.value, details.xp',
      '  details.languages.value  Array. Invalid slugs are silently filtered,',
      '                           not fatal — but the key must exist.',
      '  resources.heroPoints, pfs',
      '  attributes.hp      Needs at least { value, temp }.',
      '',
      'ABILITIES (character): supplying `abilities` AT ALL flips the sheet into',
      '  manual-attribute mode (build.attributes.manual = true), which',
      '  suppresses ancestry/background/class boosts. Leave it null unless you',
      '  intend manual mode. Shape is { str: { mod: N }, ... } — the shorthand',
      '  { str: N } is accepted and expanded for you.',
      '',
      'IWR — attributes.immunities / weaknesses / resistances:',
      '  immunities:  [{ type, exceptions: [], source: null }]',
      '  weaknesses:  [{ type, value, exceptions: [], applyOnce: false }]',
      '  resistances: [{ type, value, exceptions: [], doubleVs: [] }]',
      '  `value` is REQUIRED on weaknesses/resistances. A bare string ("fire")',
      '  is accepted and expanded to { type: "fire" }. Type slugs come from',
      '  CONFIG.PF2E.immunityTypes/weaknessTypes/resistanceTypes; an unknown',
      '  slug does not throw, it simply never matches anything.',
      '',
      'SKILL KEYS (16, long form): acrobatics arcana athletics crafting',
      '  deception diplomacy intimidation medicine nature occultism performance',
      '  religion society stealth survival thievery.  Value shape: { rank: 0-4 }.',
      '',
      'ITEMS: every hand-authored PF2e item must include system.traits (object),',
      '  system.rules (array), system.description {value,gm}, system.publication,',
      '  and system.slug. ItemPF2e._preCreate reads _source.system.traits.value',
      '  and _source.system.rules.filter() with no guard, so omitting either',
      '  throws on create. Attach ancestry/heritage/background/class/deity to a',
      '  character only AFTER the actor exists and prepares cleanly.',
    ].join('\n');
  }

  /**
   * Normalise/validate a PF2e system payload before it reaches Foundry.
   *
   * Called by manage-actors on every create and update. Runs for all actor
   * types (the caller does not tell us which), so this only does things that
   * are correct for every PF2e actor: repair known-fatal shapes, expand
   * documented shorthands, and reject values whose type is outright wrong.
   * Type-specific advice (e.g. "never author saves on a character") lives in
   * describeActorSchema() rather than being enforced here.
   */
  normalizePayload(system: Record<string, any>): Record<string, any> {
    if (!system || typeof system !== 'object' || Array.isArray(system)) return system;

    const out: Record<string, any> = { ...system };

    const isPlainObject = (v: any): v is Record<string, any> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);

    // ── hard type rejections ────────────────────────────────────────────────
    // These land in _source unchallenged and then quietly degrade the actor
    // (e.g. `abilities: 42` prepares as {}), so fail loudly and early instead.
    for (const key of ['abilities', 'skills', 'details', 'attributes', 'resources', 'pfs']) {
      if (key in out && out[key] !== null && out[key] !== undefined && !isPlainObject(out[key])) {
        throw new Error(
          `PF2e: system.${key} must be an object (received ${Array.isArray(out[key]) ? 'array' : typeof out[key]}). ` +
            `Run manage-actors action:"describe" for the expected shapes.`
        );
      }
    }

    // ── abilities: accept { str: 2 } shorthand for { str: { mod: 2 } } ───────
    if (isPlainObject(out.abilities)) {
      const abilities: Record<string, any> = {};
      for (const [key, val] of Object.entries(out.abilities)) {
        if (typeof val === 'number') {
          abilities[key] = { mod: val };
        } else if (isPlainObject(val)) {
          abilities[key] = val;
        } else {
          throw new Error(
            `PF2e: system.abilities.${key} must be a number or { mod: number } (received ${typeof val}).`
          );
        }
      }
      out.abilities = abilities;
    }

    // ── attributes ──────────────────────────────────────────────────────────
    if (isPlainObject(out.attributes)) {
      const attributes: Record<string, any> = { ...out.attributes };

      if ('hp' in attributes && attributes.hp !== undefined && !isPlainObject(attributes.hp)) {
        throw new Error(
          `PF2e: system.attributes.hp must be an object like { value, max } (received ${typeof attributes.hp}).`
        );
      }

      // speed MUST carry otherSpeeds — PF2e spreads it unguarded, and the
      // resulting throw aborts prepareBaseData partway through, corrupting the
      // actor in ways that surface much later and look unrelated.
      if (isPlainObject(attributes.speed) && !Array.isArray(attributes.speed.otherSpeeds)) {
        attributes.speed = { ...attributes.speed, otherSpeeds: [] };
      }

      attributes.immunities = this.normalizeIwr(attributes.immunities, 'immunities');
      attributes.weaknesses = this.normalizeIwr(attributes.weaknesses, 'weaknesses');
      attributes.resistances = this.normalizeIwr(attributes.resistances, 'resistances');
      for (const key of ['immunities', 'weaknesses', 'resistances']) {
        if (attributes[key] === undefined) delete attributes[key];
      }

      out.attributes = attributes;
    }

    // Same speed repair for callers using dot-notation paths.
    const dotSpeed = out['attributes.speed'];
    if (isPlainObject(dotSpeed) && !Array.isArray(dotSpeed.otherSpeeds)) {
      out['attributes.speed'] = { ...dotSpeed, otherSpeeds: [] };
    }

    return out;
  }

  /**
   * Coerce an immunities/weaknesses/resistances array into the shape PF2e's
   * IWR classes expect. Bare strings become { type }; missing exception arrays
   * are filled in. Unknown type slugs are left alone — PF2e tolerates them.
   */
  private normalizeIwr(entries: any, kind: 'immunities' | 'weaknesses' | 'resistances'): any {
    if (entries === undefined || entries === null) return entries;
    if (!Array.isArray(entries)) {
      throw new Error(
        `PF2e: system.attributes.${kind} must be an array (received ${typeof entries}). ` +
          `Expected e.g. [{ type: "fire"${kind === 'immunities' ? '' : ', value: 5'} }].`
      );
    }

    return entries.map((entry, idx) => {
      const base = typeof entry === 'string' ? { type: entry } : entry;
      if (typeof base !== 'object' || base === null || Array.isArray(base)) {
        throw new Error(
          `PF2e: system.attributes.${kind}[${idx}] must be a string or an object with a "type".`
        );
      }
      if (typeof base.type !== 'string' || base.type.length === 0) {
        throw new Error(`PF2e: system.attributes.${kind}[${idx}] is missing a "type" slug.`);
      }

      const normalized: Record<string, any> = {
        ...base,
        exceptions: Array.isArray(base.exceptions) ? base.exceptions : [],
      };

      if (kind === 'immunities') {
        if (normalized.source === undefined) normalized.source = null;
      } else {
        if (typeof normalized.value !== 'number') {
          throw new Error(
            `PF2e: system.attributes.${kind}[${idx}] ("${base.type}") needs a numeric "value" ` +
              `(e.g. { type: "${base.type}", value: 5 }).`
          );
        }
        if (kind === 'weaknesses') {
          if (normalized.applyOnce === undefined) normalized.applyOnce = false;
        } else if (!Array.isArray(normalized.doubleVs)) {
          normalized.doubleVs = [];
        }
      }

      return normalized;
    });
  }
}
