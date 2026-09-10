import { MODULE_ID, ERROR_MESSAGES, TOKEN_DISPOSITIONS } from './constants.js';
import { permissionManager } from './permissions.js';
import { transactionManager } from './transaction-manager.js';
import { getDiagnosticEntries } from './diagnostics.js';
// Local type definitions to avoid shared package import issues
interface CharacterInfo {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
  items: CharacterItem[];
  effects: CharacterEffect[];
  actions?: any[]; // PF2e actions (strikes, spells, etc.)
  itemVariants?: any[]; // Item rule element variants (ChoiceSet, etc.)
  itemToggles?: any[]; // Item rule element toggles (RollOption, ToggleProperty, equipped)
  spellcasting?: SpellcastingEntry[]; // PF2e/D&D 5e spellcasting entries
}

interface SpellcastingEntry {
  id: string;
  name: string;
  tradition?: string | undefined; // arcane, divine, primal, occult (PF2e)
  type: string; // prepared, spontaneous, innate, focus (PF2e) or class name (5e)
  ability?: string | undefined; // spellcasting ability (int, wis, cha)
  dc?: number | undefined;
  attack?: number | undefined;
  slots?: Record<string, { value: number; max: number }> | undefined; // spell slots per level/rank
  spells: SpellInfo[];
}

interface SpellInfo {
  id: string;
  name: string;
  level: number; // spell level/rank
  prepared?: boolean | undefined; // for prepared casters
  expended?: boolean | undefined; // has this spell slot been used
  traits?: string[] | undefined;
  actionCost?: string | undefined; // 1, 2, 3, reaction, free
  // Targeting info - helps Claude decide whether to specify targets
  range?: string | undefined; // "touch", "self", "60 feet", etc.
  target?: string | undefined; // "1 creature", "self", "area", etc.
  area?: string | undefined; // "20-foot radius", "30-foot cone", etc. (for template spells)
}

interface CharacterItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

interface CharacterEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: {
    type: string;
    duration?: number;
    remaining?: number;
  };
}

interface CompendiumSearchResult {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system?: Record<string, unknown>;
  summary?: string;
  hasImage?: boolean;
  description?: string;
}

// D&D 5e Enhanced Creature Index
interface DnD5eCreatureIndex {
  id: string;
  name: string;
  type: string;
  pack: string;
  packLabel: string;
  challengeRating: number;
  creatureType: string;
  size: string;
  hitPoints: number;
  armorClass: number;
  hasSpells: boolean;
  hasLegendaryActions: boolean;
  alignment: string;
  description?: string;
  img?: string;
}

// Pathfinder 2e Enhanced Creature Index
interface PF2eCreatureIndex {
  id: string;
  name: string;
  type: string;
  pack: string;
  packLabel: string;
  level: number; // PF2e: -1 to 25+
  traits: string[]; // PF2e: ['dragon', 'fire', 'amphibious']
  creatureType: string; // Primary trait extracted from traits array
  rarity: string; // PF2e: 'common', 'uncommon', 'rare', 'unique'
  size: string;
  hitPoints: number;
  armorClass: number;
  hasSpells: boolean;
  alignment: string;
  description?: string;
  img?: string;
}

// Cosmere RPG (Plotweaver) Enhanced Creature Index
//
// Plotweaver categorises adversaries by `tier` (1-4) and `role`
// (minion/rival/boss) rather than CR or level — those are the primary
// encounter-design dials. Defenses are split into phy/cog/spi instead
// of a single AC, and Investiture is the Surge/Stormlight resource.
interface CosmereRpgCreatureIndex {
  id: string;
  name: string;
  type: string; // 'adversary' for compendium creatures
  pack: string;
  packLabel: string;
  tier: number; // 1-4
  role: string; // minion | rival | boss | (system-extended)
  creatureType: string; // humanoid | animal | spren | …
  subtype: string; // free-form secondary type
  size: string;
  hitPoints: number; // resources.hea.max (override-aware)
  focus: number; // resources.foc.max
  investiture: number; // resources.inv.max — typically 0
  hasInvestiture: boolean;
  defensePhysical: number;
  defenseCognitive: number;
  defenseSpiritual: number;
  deflect: number;
  walkSpeed: number;
  description?: string;
  img?: string;
}

interface MGT2eCreatureIndex {
  id: string;
  name: string;
  type: string; // traveller | npc | creature | spacecraft | …
  pack: string;
  packLabel: string;
  hits: number;
  creatureType: string;
  hasPsionics: boolean;
  characteristics: Record<string, { value: number; dm: number }>;
  img?: string;
}

// Union type across all supported systems
type EnhancedCreatureIndex =
  | DnD5eCreatureIndex
  | PF2eCreatureIndex
  | CosmereRpgCreatureIndex
  | MGT2eCreatureIndex;

interface PersistentIndexMetadata {
  version: string;
  timestamp: number;
  packFingerprints: Map<string, PackFingerprint>;
  totalCreatures: number;
  gameSystem: string; // 'dnd5e' or 'pf2e'
}

interface PackFingerprint {
  packId: string;
  packLabel: string;
  lastModified: number;
  documentCount: number;
  checksum: string;
}

interface PersistentEnhancedIndex {
  metadata: PersistentIndexMetadata;
  creatures: EnhancedCreatureIndex[];
}

interface SceneInfo {
  id: string;
  name: string;
  img?: string;
  background?: string;
  width: number;
  height: number;
  padding: number;
  active: boolean;
  navigation: boolean;
  tokens: SceneToken[];
  walls: number;
  lights: number;
  sounds: number;
  notes: SceneNote[];
}

interface SceneToken {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  actorId?: string;
  img: string;
  hidden: boolean;
  disposition: number;
}

interface SceneNote {
  id: string;
  text: string;
  x: number;
  y: number;
}

interface WorldInfo {
  id: string;
  title: string;
  system: string;
  systemVersion: string;
  foundryVersion: string;
  users: WorldUser[];
}

interface WorldUser {
  id: string;
  name: string;
  active: boolean;
  isGM: boolean;
}

// Phase 2: Write Operation Interfaces
interface ActorCreationRequest {
  creatureType: string;
  customNames?: string[] | undefined;
  packPreference?: string | undefined;
  quantity?: number | undefined;
  addToScene?: boolean | undefined;
}

interface ActorCreationResult {
  success: boolean;
  actors: CreatedActorInfo[];
  errors?: string[] | undefined;
  tokensPlaced?: number;
  totalRequested: number;
  totalCreated: number;
}

interface CreatedActorInfo {
  id: string;
  name: string;
  originalName: string;
  type: string;
  sourcePackId: string;
  sourcePackLabel: string;
  img?: string;
}

interface CompendiumEntryFull {
  id: string;
  name: string;
  type: string;
  img?: string;
  pack: string;
  packLabel: string;
  system: Record<string, unknown>;
  items?: CompendiumItem[];
  effects?: CompendiumEffect[];
  fullData: Record<string, unknown>;
}

interface CompendiumItem {
  id: string;
  name: string;
  type: string;
  img?: string;
  system: Record<string, unknown>;
}

interface CompendiumEffect {
  id: string;
  name: string;
  icon?: string;
  disabled: boolean;
  duration?: Record<string, unknown>;
}

interface SceneTokenPlacement {
  actorIds: string[];
  placement: 'random' | 'grid' | 'center' | 'coordinates';
  hidden: boolean;
  coordinates?: { x: number; y: number }[];
}

interface TokenPlacementResult {
  success: boolean;
  tokensCreated: number;
  tokenIds: string[];
  errors?: string[] | undefined;
}

/**
 * Persistent Enhanced Creature Index System
 * Stores pre-computed creature data in JSON file within Foundry world directory for instant filtering
 * Uses file-based storage following Foundry best practices for large data sets
 */
class PersistentCreatureIndex {
  private moduleId: string = MODULE_ID;
  private readonly INDEX_VERSION = '1.0.0';
  private readonly INDEX_FILENAME = 'enhanced-creature-index.json';
  private buildInProgress = false;
  private hooksRegistered = false;

  constructor() {
    this.registerFoundryHooks();
  }

  /**
   * Get the file path for the enhanced creature index
   */
  private getIndexFilePath(): string {
    // Store in world data directory using world ID
    return `worlds/${game.world.id}/${this.INDEX_FILENAME}`;
  }

  /**
   * Get or build the enhanced creature index
   */
  async getEnhancedIndex(): Promise<EnhancedCreatureIndex[]> {
    // Check if we have a valid persistent index
    const existingIndex = await this.loadPersistedIndex();

    if (existingIndex && this.isIndexValid(existingIndex)) {
      return existingIndex.creatures;
    }

    // Build new index if needed
    return await this.buildEnhancedIndex();
  }

  /**
   * Force rebuild of the enhanced index
   */
  async rebuildIndex(): Promise<EnhancedCreatureIndex[]> {
    return await this.buildEnhancedIndex(true);
  }

  /**
   * Load persisted index from JSON file
   */
  private async loadPersistedIndex(): Promise<PersistentEnhancedIndex | null> {
    try {
      const filePath = this.getIndexFilePath();

      // Check if file exists using Foundry's FilePicker
      let fileExists = false;
      try {
        const browseResult = await (
          foundry as any
        ).applications.apps.FilePicker.implementation.browse('data', `worlds/${game.world.id}`);
        fileExists = browseResult.files.some((f: any) => f.endsWith(this.INDEX_FILENAME));
      } catch (error) {
        // Directory doesn't exist or other error, return null
        return null;
      }

      if (!fileExists) {
        return null;
      }

      // Load file content
      const response = await fetch(filePath);
      if (!response.ok) {
        console.warn(`[${this.moduleId}] Failed to load index file: ${response.status}`);
        return null;
      }

      const rawData = await response.json();

      // Convert Map data back from JSON
      const metadata = rawData.metadata;
      if (metadata?.packFingerprints) {
        metadata.packFingerprints = new Map(metadata.packFingerprints);
      }

      return rawData;
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to load persisted index from file:`, error);
      return null;
    }
  }

  /**
   * Save enhanced index to JSON file
   */
  private async savePersistedIndex(index: PersistentEnhancedIndex): Promise<void> {
    try {
      // Convert Map to Array for JSON serialization
      const saveData = {
        ...index,
        metadata: {
          ...index.metadata,
          packFingerprints: Array.from(index.metadata.packFingerprints.entries()),
        },
      };

      const jsonContent = JSON.stringify(saveData, null, 2);

      // Create a File object and upload it using Foundry's file system
      const file = new File([jsonContent], this.INDEX_FILENAME, { type: 'application/json' });

      // Upload the file to the world directory
      const uploadResponse = await (
        foundry as any
      ).applications.apps.FilePicker.implementation.upload('data', `worlds/${game.world.id}`, file);

      if (uploadResponse) {
      } else {
        throw new Error('File upload failed');
      }
    } catch (error) {
      console.error(`[${this.moduleId}] Failed to save enhanced index to file:`, error);
      throw error;
    }
  }

  /**
   * Check if existing index is valid (all packs unchanged)
   */
  private isIndexValid(existingIndex: PersistentEnhancedIndex): boolean {
    // Check version
    if (existingIndex.metadata.version !== this.INDEX_VERSION) {
      return false;
    }

    // NEW: Check system compatibility
    const currentSystem = (game as any).system.id;
    if (existingIndex.metadata.gameSystem !== currentSystem) {
      console.log(
        `[${this.moduleId}] System changed from ${existingIndex.metadata.gameSystem} to ${currentSystem}, index invalidated`
      );
      return false;
    }

    // Check each pack fingerprint
    const actorPacks = Array.from(game.packs.values()).filter(
      pack => pack.metadata.type === 'Actor'
    );

    for (const pack of actorPacks) {
      const currentFingerprint = this.generatePackFingerprint(pack);
      const savedFingerprint = existingIndex.metadata.packFingerprints.get(pack.metadata.id);

      if (!savedFingerprint) {
        return false;
      }

      if (!this.fingerprintsMatch(currentFingerprint, savedFingerprint)) {
        return false;
      }
    }

    // Check if any saved packs no longer exist
    for (const [packId] of existingIndex.metadata.packFingerprints) {
      if (!game.packs.get(packId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Register Foundry hooks for real-time pack change detection
   */
  private registerFoundryHooks(): void {
    if (this.hooksRegistered) return;

    // Listen for compendium document changes
    Hooks.on('createDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        this.invalidateIndex();
      }
    });

    Hooks.on('updateDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        this.invalidateIndex();
      }
    });

    Hooks.on('deleteDocument', (document: any) => {
      if (
        document.pack &&
        (document.type === 'npc' || document.type === 'character' || document.type === 'creature')
      ) {
        this.invalidateIndex();
      }
    });

    // Listen for pack creation/deletion
    Hooks.on('createCompendium', (pack: any) => {
      if (pack.metadata.type === 'Actor') {
        this.invalidateIndex();
      }
    });

    Hooks.on('deleteCompendium', (pack: any) => {
      if (pack.metadata.type === 'Actor') {
        this.invalidateIndex();
      }
    });

    this.hooksRegistered = true;
  }

  /**
   * Invalidate the current index (mark for rebuild on next access)
   */
  private async invalidateIndex(): Promise<void> {
    try {
      // Check if auto-rebuild is enabled
      const autoRebuild = game.settings.get(this.moduleId, 'autoRebuildIndex');

      if (!autoRebuild) {
        return;
      }

      // Delete the index file to force rebuild
      const filePath = this.getIndexFilePath();

      try {
        // Check if file exists first by trying to browse to the world directory
        const browseResult = await (
          foundry as any
        ).applications.apps.FilePicker.implementation.browse('data', `worlds/${game.world.id}`);
        const fileExists = browseResult.files.some((f: any) => f.endsWith(this.INDEX_FILENAME));

        if (fileExists) {
          // File exists, delete it using fetch with DELETE method
          await fetch(filePath, { method: 'DELETE' });
          // File deletion completed (or failed silently)
        }
      } catch (error) {
        // File doesn't exist or deletion failed - that's okay
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to invalidate index:`, error);
    }
  }

  /**
   * Generate fingerprint for pack change detection with improved accuracy
   */
  private generatePackFingerprint(pack: any): PackFingerprint {
    // Get actual modification time if available
    let lastModified = Date.now();
    if (pack.metadata.lastModified) {
      lastModified = new Date(pack.metadata.lastModified).getTime();
    }

    return {
      packId: pack.metadata.id,
      packLabel: pack.metadata.label,
      lastModified,
      documentCount: pack.index?.size || 0,
      checksum: this.generatePackChecksum(pack),
    };
  }

  /**
   * Generate checksum for pack contents
   */
  private generatePackChecksum(pack: any): string {
    // Simple checksum based on pack metadata and size
    const data = `${pack.metadata.id}-${pack.metadata.label}-${pack.index?.size || 0}`;
    return btoa(data).slice(0, 16); // Simple hash for demonstration
  }

  /**
   * Compare two pack fingerprints
   */
  private fingerprintsMatch(current: PackFingerprint, saved: PackFingerprint): boolean {
    return current.documentCount === saved.documentCount && current.checksum === saved.checksum;
  }

  /**
   * Build enhanced creature index from all Actor packs with detailed progress tracking
   */
  private async buildEnhancedIndex(force = false): Promise<EnhancedCreatureIndex[]> {
    if (this.buildInProgress && !force) {
      throw new Error('Index build already in progress');
    }

    // Detect game system ONCE at build time
    const gameSystem = (game as any).system.id;

    console.log(`[${this.moduleId}] Building enhanced creature index for system: ${gameSystem}`);

    // Route to system-specific builder
    if (gameSystem === 'pf2e') {
      return await this.buildPF2eIndex(force);
    } else if (gameSystem === 'dnd5e') {
      return await this.buildDnD5eIndex(force);
    } else if (gameSystem === 'cosmere-rpg') {
      return await this.buildCosmereRpgIndex(force);
    } else if (gameSystem === 'mgt2e') {
      return await this.buildMGT2eIndex(force);
    } else {
      // Unknown system — skip silently rather than blocking world load
      console.warn(
        `[${this.moduleId}] Enhanced creature index not implemented for system: ${gameSystem}. Skipping.`
      );
      return [];
    }
  }

  /**
   * Build D&D 5e enhanced creature index
   */
  private async buildDnD5eIndex(_force = false): Promise<DnD5eCreatureIndex[]> {
    this.buildInProgress = true;

    const startTime = Date.now();
    let progressNotification: any = null;
    let totalErrors = 0; // Track extraction errors

    try {
      const actorPacks = Array.from(game.packs.values()).filter(
        pack => pack.metadata.type === 'Actor'
      );
      const enhancedCreatures: DnD5eCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      // Show initial progress notification
      ui.notifications?.info(
        `Starting enhanced creature index build from ${actorPacks.length} packs...`
      );

      for (let i = 0; i < actorPacks.length; i++) {
        const pack = actorPacks[i];
        const progressPercent = Math.round((i / actorPacks.length) * 100);

        // Update progress notification every few packs or for important packs
        if (i % 3 === 0 || pack.metadata.label.toLowerCase().includes('monster')) {
          if (progressNotification) {
            progressNotification.remove();
          }
          progressNotification = ui.notifications?.info(
            `Building creature index... ${progressPercent}% (${i + 1}/${actorPacks.length}) Processing: ${pack.metadata.label}`
          );
        }

        try {
          // Ensure pack index is loaded
          if (!pack.indexed) {
            await pack.getIndex({});
          }

          // Generate pack fingerprint for change detection
          packFingerprints.set(pack.metadata.id, this.generatePackFingerprint(pack));

          // Show pack processing details for large packs
          const packSize = pack.index?.size || 0;
          if (packSize > 50) {
            if (progressNotification) {
              progressNotification.remove();
            }
            progressNotification = ui.notifications?.info(
              `Processing large pack: ${pack.metadata.label} (${packSize} documents)...`
            );
          }

          // Process creatures in this pack
          const packResult = await this.extractDnD5eDataFromPack(pack);
          enhancedCreatures.push(...packResult.creatures);
          totalErrors += packResult.errors;

          // Pack processing completed: ${pack.metadata.label} - ${packResult.creatures.length} creatures extracted

          // Show milestone notifications for significant progress
          if (i === 0 || (i + 1) % 5 === 0 || i === actorPacks.length - 1) {
            const totalCreaturesSoFar = enhancedCreatures.length;
            if (progressNotification) {
              progressNotification.remove();
            }
            progressNotification = ui.notifications?.info(
              `Index Progress: ${i + 1}/${actorPacks.length} packs complete, ${totalCreaturesSoFar} creatures indexed`
            );
          }
        } catch (error) {
          console.warn(`[${this.moduleId}] Failed to process pack ${pack.metadata.label}:`, error);
          // Show error notification for pack failures
          ui.notifications?.warn(
            `Warning: Failed to index pack "${pack.metadata.label}" - continuing with other packs`
          );
        }
      }

      // Clear progress notification and show final processing step
      if (progressNotification) {
        progressNotification.remove();
      }
      ui.notifications?.info(
        `Saving enhanced index to world database... (${enhancedCreatures.length} creatures)`
      );

      // Create persistent index structure
      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          packFingerprints,
          totalCreatures: enhancedCreatures.length,
          gameSystem: 'dnd5e', // Mark as D&D 5e index
        },
        creatures: enhancedCreatures,
      };

      // Save to world flags
      await this.savePersistedIndex(persistentIndex);

      const buildTimeSeconds = Math.round((Date.now() - startTime) / 1000);
      const errorText = totalErrors > 0 ? ` (${totalErrors} extraction errors)` : '';
      const successMessage = `Enhanced creature index complete! ${enhancedCreatures.length} creatures indexed from ${actorPacks.length} packs in ${buildTimeSeconds}s${errorText}`;

      ui.notifications?.info(successMessage);

      return enhancedCreatures;
    } catch (error) {
      // Clear any progress notifications on error
      if (progressNotification) {
        progressNotification.remove();
      }

      const errorMessage = `Failed to build enhanced creature index: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[${this.moduleId}] ${errorMessage}`);
      ui.notifications?.error(errorMessage);

      throw error;
    } finally {
      this.buildInProgress = false;

      // Ensure progress notification is cleared
      if (progressNotification) {
        progressNotification.remove();
      }
    }
  }

  /**
   * Extract D&D 5e data from all documents in a pack
   */
  private async extractDnD5eDataFromPack(
    pack: any
  ): Promise<{ creatures: DnD5eCreatureIndex[]; errors: number }> {
    const creatures: DnD5eCreatureIndex[] = [];
    let errors = 0;

    try {
      // Load all documents from pack
      const documents = await pack.getDocuments();

      for (const doc of documents) {
        try {
          // Only process NPCs, characters, and creatures
          if (doc.type !== 'npc' && doc.type !== 'character' && doc.type !== 'creature') {
            continue;
          }

          const result = this.extractDnD5eCreatureData(doc, pack);
          if (result) {
            creatures.push(result.creature);
            errors += result.errors;
          }
        } catch (error) {
          console.warn(
            `[${this.moduleId}] Failed to extract data from ${doc.name} in ${pack.metadata.label}:`,
            error
          );
          errors++;
        }
      }
    } catch (error) {
      console.warn(
        `[${this.moduleId}] Failed to load documents from ${pack.metadata.label}:`,
        error
      );
      errors++;
    }

    return { creatures, errors };
  }

  /**
   * Extract D&D 5e creature data from a single document
   */
  private extractDnD5eCreatureData(
    doc: any,
    pack: any
  ): { creature: DnD5eCreatureIndex; errors: number } | null {
    try {
      const system = doc.system || {};

      // Extract challenge rating with comprehensive fallbacks
      // Based on debug logs: system.details.cr contains the actual value
      let challengeRating =
        system.details?.cr ??
        system.details?.cr?.value ??
        system.cr?.value ??
        system.cr ??
        system.attributes?.cr?.value ??
        system.attributes?.cr ??
        system.challenge?.rating ??
        system.challenge?.cr ??
        0;

      // Handle null values (spell effects, etc.)
      if (challengeRating === null || challengeRating === undefined) {
        challengeRating = 0;
      }

      if (typeof challengeRating === 'string') {
        if (challengeRating === '1/8') challengeRating = 0.125;
        else if (challengeRating === '1/4') challengeRating = 0.25;
        else if (challengeRating === '1/2') challengeRating = 0.5;
        else challengeRating = parseFloat(challengeRating) || 0;
      }

      // Ensure it's a number
      challengeRating = Number(challengeRating) || 0;

      // Extract creature type with proper type checking
      // Based on debug logs: system.details.type.value contains the actual value
      let creatureType =
        system.details?.type?.value ??
        system.details?.type ??
        system.type?.value ??
        system.type ??
        system.race?.value ??
        system.race ??
        system.details?.race ??
        'unknown';

      // Handle null/undefined values properly
      if (creatureType === null || creatureType === undefined || creatureType === '') {
        creatureType = 'unknown';
      }

      // Ensure creatureType is a string before calling toLowerCase()
      if (typeof creatureType !== 'string') {
        creatureType = String(creatureType || 'unknown');
      }

      // Extract size with proper type checking
      let size =
        system.traits?.size?.value ||
        system.traits?.size ||
        system.size?.value ||
        system.size ||
        system.details?.size ||
        'medium';

      // Ensure size is a string
      if (typeof size !== 'string') {
        size = String(size || 'medium');
      }

      // Extract hit points with more fallbacks
      const hitPoints =
        system.attributes?.hp?.max ||
        system.hp?.max ||
        system.attributes?.hp?.value ||
        system.hp?.value ||
        system.health?.max ||
        system.health?.value ||
        0;

      // Extract armor class with more fallbacks
      const armorClass =
        system.attributes?.ac?.value ||
        system.ac?.value ||
        system.attributes?.ac ||
        system.ac ||
        system.armor?.value ||
        system.armor ||
        10;

      // Extract alignment with proper type checking
      let alignment =
        system.details?.alignment?.value ||
        system.details?.alignment ||
        system.alignment?.value ||
        system.alignment ||
        'unaligned';

      // Ensure alignment is a string
      if (typeof alignment !== 'string') {
        alignment = String(alignment || 'unaligned');
      }

      // Check for spells with more comprehensive detection
      const hasSpells = !!(
        system.spells ||
        system.attributes?.spellcasting ||
        (system.details?.spellLevel && system.details.spellLevel > 0) ||
        (system.resources?.spell && system.resources.spell.max > 0) ||
        system.spellcasting ||
        system.traits?.spellcasting ||
        system.details?.spellcaster
      );

      // Check for legendary actions with more comprehensive detection
      const hasLegendaryActions = !!(
        system.resources?.legact ||
        system.legendary ||
        (system.resources?.legres && system.resources.legres.value > 0) ||
        system.details?.legendary ||
        system.traits?.legendary ||
        (system.resources?.legendary && system.resources.legendary.max > 0)
      );

      // DEBUG: Log what we extracted for comparison

      // Successful extraction
      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          challengeRating,
          creatureType: creatureType.toLowerCase(),
          size: size.toLowerCase(),
          hitPoints,
          armorClass,
          hasSpells,
          hasLegendaryActions,
          alignment: alignment.toLowerCase(),
          description: doc.system?.details?.biography || doc.system?.description || '',
          img: doc.img,
        },
        errors: 0,
      };
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to extract enhanced data from ${doc.name}:`, error);

      // Return a basic fallback record with error count instead of null to avoid losing creatures
      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          challengeRating: 0,
          creatureType: 'unknown',
          size: 'medium',
          hitPoints: 1,
          armorClass: 10,
          hasSpells: false,
          hasLegendaryActions: false,
          alignment: 'unaligned',
          description: 'Data extraction failed',
          img: doc.img || '',
        },
        errors: 1,
      };
    }
  }

  /**
   * Build Pathfinder 2e enhanced creature index
   */
  private async buildPF2eIndex(_force = false): Promise<PF2eCreatureIndex[]> {
    this.buildInProgress = true;

    const startTime = Date.now();
    let progressNotification: any = null;
    let totalErrors = 0;

    try {
      const actorPacks = Array.from(game.packs.values()).filter(
        pack => pack.metadata.type === 'Actor'
      );
      const enhancedCreatures: PF2eCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      ui.notifications?.info(
        `Starting PF2e creature index build from ${actorPacks.length} packs...`
      );

      let currentPack = 0;
      for (const pack of actorPacks) {
        currentPack++;

        if (progressNotification) {
          progressNotification.remove();
        }
        progressNotification = ui.notifications?.info(
          `Building PF2e index: Pack ${currentPack}/${actorPacks.length} (${pack.metadata.label})...`
        );

        const fingerprint = await this.generatePackFingerprint(pack);
        packFingerprints.set(pack.metadata.id, fingerprint);

        const result = await this.extractPF2eDataFromPack(pack);
        enhancedCreatures.push(...result.creatures);
        totalErrors += result.errors;
      }

      if (progressNotification) {
        progressNotification.remove();
      }
      ui.notifications?.info(
        `Saving PF2e index to world database... (${enhancedCreatures.length} creatures)`
      );

      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          packFingerprints,
          totalCreatures: enhancedCreatures.length,
          gameSystem: 'pf2e', // Mark as PF2e index
        },
        creatures: enhancedCreatures,
      };

      await this.savePersistedIndex(persistentIndex);

      const buildTimeSeconds = Math.round((Date.now() - startTime) / 1000);
      const errorText = totalErrors > 0 ? ` (${totalErrors} extraction errors)` : '';
      const successMessage = `PF2e creature index complete! ${enhancedCreatures.length} creatures indexed from ${actorPacks.length} packs in ${buildTimeSeconds}s${errorText}`;

      ui.notifications?.info(successMessage);

      return enhancedCreatures;
    } catch (error) {
      if (progressNotification) {
        progressNotification.remove();
      }

      const errorMessage = `Failed to build PF2e creature index: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[${this.moduleId}] ${errorMessage}`);
      ui.notifications?.error(errorMessage);

      throw error;
    } finally {
      this.buildInProgress = false;

      if (progressNotification) {
        progressNotification.remove();
      }
    }
  }

  /**
   * Extract PF2e creature data from all documents in a pack
   */
  private async extractPF2eDataFromPack(
    pack: any
  ): Promise<{ creatures: PF2eCreatureIndex[]; errors: number }> {
    const creatures: PF2eCreatureIndex[] = [];
    let errors = 0;

    try {
      const documents = await pack.getDocuments();

      for (const doc of documents) {
        try {
          // Support NPCs, characters, and creatures
          if (doc.type !== 'npc' && doc.type !== 'character' && doc.type !== 'creature') {
            continue;
          }

          const result = this.extractPF2eCreatureData(doc, pack);
          if (result) {
            creatures.push(result.creature);
            errors += result.errors;
          }
        } catch (error) {
          console.warn(
            `[${this.moduleId}] Failed to extract PF2e data from ${doc.name} in ${pack.metadata.label}:`,
            error
          );
          errors++;
        }
      }
    } catch (error) {
      console.warn(
        `[${this.moduleId}] Failed to load documents from ${pack.metadata.label}:`,
        error
      );
      errors++;
    }

    return { creatures, errors };
  }

  /**
   * Extract Pathfinder 2e creature data from a single document
   */
  private extractPF2eCreatureData(
    doc: any,
    pack: any
  ): { creature: PF2eCreatureIndex; errors: number } | null {
    try {
      const system = doc.system || {};

      // Level extraction (PF2e primary power metric)
      let level = system.details?.level?.value ?? 0;
      level = Number(level) || 0;

      // Traits extraction (PF2e uses array of traits)
      const traitsValue = system.traits?.value || [];
      const traits = Array.isArray(traitsValue) ? traitsValue : [];

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
      const creatureType =
        traits.find((t: string) => creatureTraits.includes(t.toLowerCase()))?.toLowerCase() ||
        'unknown';

      // Rarity extraction (PF2e specific)
      const rarity = system.traits?.rarity || 'common';

      // Size extraction
      let size = system.traits?.size?.value || 'med';
      // Normalize PF2e size values (tiny, sm, med, lg, huge, grg)
      const sizeMap: Record<string, string> = {
        tiny: 'tiny',
        sm: 'small',
        med: 'medium',
        lg: 'large',
        huge: 'huge',
        grg: 'gargantuan',
      };
      size = sizeMap[size.toLowerCase()] || 'medium';

      // Hit Points
      const hitPoints = system.attributes?.hp?.max || 0;

      // Armor Class
      const armorClass = system.attributes?.ac?.value || 10;

      // Spellcasting detection (PF2e uses spellcasting entries)
      const spellcasting = system.spellcasting || {};
      const hasSpells = Object.keys(spellcasting).length > 0;

      // Alignment
      let alignment = system.details?.alignment?.value || 'N';
      if (typeof alignment !== 'string') {
        alignment = String(alignment || 'N');
      }

      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          level,
          traits,
          creatureType,
          rarity,
          size,
          hitPoints,
          armorClass,
          hasSpells,
          alignment: alignment.toUpperCase(),
          description: system.details?.publicNotes || system.details?.biography || '',
          img: doc.img,
        },
        errors: 0,
      };
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to extract PF2e data from ${doc.name}:`, error);

      // Fallback with error count
      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          level: 0,
          traits: [],
          creatureType: 'unknown',
          rarity: 'common',
          size: 'medium',
          hitPoints: 1,
          armorClass: 10,
          hasSpells: false,
          alignment: 'N',
          description: 'Data extraction failed',
          img: doc.img || '',
        },
        errors: 1,
      };
    }
  }

  /**
   * Build Cosmere RPG (Plotweaver) enhanced creature index.
   *
   * Indexes `adversary`-type actors. Player characters are excluded —
   * they're individual sheets, not encounter material.
   */
  private async buildCosmereRpgIndex(_force = false): Promise<CosmereRpgCreatureIndex[]> {
    this.buildInProgress = true;

    const startTime = Date.now();
    let progressNotification: any = null;
    let totalErrors = 0;

    try {
      const actorPacks = Array.from(game.packs.values()).filter(
        pack => pack.metadata.type === 'Actor'
      );
      const enhancedCreatures: CosmereRpgCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      ui.notifications?.info(
        `Starting Cosmere RPG creature index build from ${actorPacks.length} packs...`
      );

      for (let i = 0; i < actorPacks.length; i++) {
        const pack = actorPacks[i];
        const progressPercent = Math.round((i / actorPacks.length) * 100);

        if (i % 3 === 0 || pack.metadata.label.toLowerCase().includes('adversar')) {
          if (progressNotification) {
            progressNotification.remove();
          }
          progressNotification = ui.notifications?.info(
            `Building creature index... ${progressPercent}% (${i + 1}/${actorPacks.length}) Processing: ${pack.metadata.label}`
          );
        }

        try {
          if (!pack.indexed) {
            await pack.getIndex({});
          }

          packFingerprints.set(pack.metadata.id, this.generatePackFingerprint(pack));

          const packResult = await this.extractCosmereRpgDataFromPack(pack);
          enhancedCreatures.push(...packResult.creatures);
          totalErrors += packResult.errors;

          if (i === 0 || (i + 1) % 5 === 0 || i === actorPacks.length - 1) {
            const totalCreaturesSoFar = enhancedCreatures.length;
            if (progressNotification) {
              progressNotification.remove();
            }
            progressNotification = ui.notifications?.info(
              `Index Progress: ${i + 1}/${actorPacks.length} packs complete, ${totalCreaturesSoFar} creatures indexed`
            );
          }
        } catch (error) {
          console.warn(`[${this.moduleId}] Failed to process pack ${pack.metadata.label}:`, error);
          ui.notifications?.warn(
            `Warning: Failed to index pack "${pack.metadata.label}" - continuing with other packs`
          );
        }
      }

      if (progressNotification) {
        progressNotification.remove();
      }
      ui.notifications?.info(
        `Saving enhanced index to world database... (${enhancedCreatures.length} creatures)`
      );

      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          packFingerprints,
          totalCreatures: enhancedCreatures.length,
          gameSystem: 'cosmere-rpg',
        },
        creatures: enhancedCreatures,
      };

      await this.savePersistedIndex(persistentIndex);

      const buildTimeSeconds = Math.round((Date.now() - startTime) / 1000);
      const errorText = totalErrors > 0 ? ` (${totalErrors} extraction errors)` : '';
      const successMessage = `Cosmere RPG creature index complete! ${enhancedCreatures.length} creatures indexed from ${actorPacks.length} packs in ${buildTimeSeconds}s${errorText}`;

      ui.notifications?.info(successMessage);

      return enhancedCreatures;
    } catch (error) {
      if (progressNotification) {
        progressNotification.remove();
      }

      const errorMessage = `Failed to build Cosmere RPG creature index: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[${this.moduleId}] ${errorMessage}`);
      ui.notifications?.error(errorMessage);

      throw error;
    } finally {
      this.buildInProgress = false;
      if (progressNotification) {
        progressNotification.remove();
      }
    }
  }

  // ─── mgt2e index builder ────────────────────────────────────────────────────

  private calcMGT2eDM(value: number): number {
    if (value <= 0) return -3;
    if (value <= 2) return -2; // matches calcDM() in mcp-server constants.ts
    if (value <= 5) return -1;
    if (value <= 8) return 0;
    if (value <= 11) return 1;
    if (value <= 14) return 2;
    return 3;
  }

  private async buildMGT2eIndex(_force = false): Promise<MGT2eCreatureIndex[]> {
    this.buildInProgress = true;
    const startTime = Date.now();
    let progressNotification: any = null;
    let totalErrors = 0;

    try {
      const actorPacks = Array.from(game.packs.values()).filter(
        pack => pack.metadata.type === 'Actor'
      );
      const enhancedCreatures: MGT2eCreatureIndex[] = [];
      const packFingerprints = new Map<string, PackFingerprint>();

      ui.notifications?.info(
        `Starting Traveller creature index build from ${actorPacks.length} packs...`
      );

      for (let i = 0; i < actorPacks.length; i++) {
        const pack = actorPacks[i];
        if (!pack.indexed) await pack.getIndex({});
        packFingerprints.set(pack.metadata.id, this.generatePackFingerprint(pack));

        if (i % 3 === 0) {
          if (progressNotification) progressNotification.remove();
          progressNotification = ui.notifications?.info(
            `Building Traveller index... ${Math.round((i / actorPacks.length) * 100)}% — ${pack.metadata.label}`
          );
        }

        try {
          const result = await this.extractMGT2eDataFromPack(pack);
          enhancedCreatures.push(...result.creatures);
          totalErrors += result.errors;
        } catch (error) {
          console.warn(`[${this.moduleId}] Failed to process pack ${pack.metadata.label}:`, error);
        }
      }

      if (progressNotification) progressNotification.remove();

      const persistentIndex: PersistentEnhancedIndex = {
        metadata: {
          version: this.INDEX_VERSION,
          timestamp: Date.now(),
          packFingerprints,
          totalCreatures: enhancedCreatures.length,
          gameSystem: 'mgt2e',
        },
        creatures: enhancedCreatures,
      };

      await this.savePersistedIndex(persistentIndex);

      const secs = Math.round((Date.now() - startTime) / 1000);
      const errText = totalErrors > 0 ? ` (${totalErrors} errors)` : '';
      ui.notifications?.info(
        `Traveller creature index complete! ${enhancedCreatures.length} actors indexed in ${secs}s${errText}`
      );

      return enhancedCreatures;
    } catch (error) {
      if (progressNotification) progressNotification.remove();
      const msg = `Failed to build Traveller creature index: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.error(`[${this.moduleId}] ${msg}`);
      ui.notifications?.error(msg);
      throw error;
    } finally {
      this.buildInProgress = false;
      if (progressNotification) progressNotification.remove();
    }
  }

  private async extractMGT2eDataFromPack(
    pack: any
  ): Promise<{ creatures: MGT2eCreatureIndex[]; errors: number }> {
    const creatures: MGT2eCreatureIndex[] = [];
    let errors = 0;

    try {
      const documents = await pack.getDocuments();
      for (const doc of documents) {
        // Index creature, npc and traveller actor types
        if (!['creature', 'npc', 'traveller'].includes(doc.type)) continue;

        try {
          const system = (doc as any).system ?? {};
          const chars = system.characteristics ?? {};
          const charMap: Record<string, { value: number; dm: number }> = {};
          for (const [k, v] of Object.entries(chars)) {
            const val = typeof v === 'object' ? ((v as any).value ?? 0) : (v as number);
            charMap[k.toUpperCase()] = { value: val, dm: this.calcMGT2eDM(val) };
          }

          const hitsMax =
            typeof system.hits === 'object'
              ? (system.hits.max ?? system.hits.value ?? 0)
              : (system.hits ?? 0);

          const hasPsionics = (charMap['PSI']?.value ?? 0) > 0;
          const creatureType = system.details?.type ?? system.details?.creatureType ?? '';

          creatures.push({
            id: doc.id,
            name: doc.name,
            type: doc.type,
            pack: pack.collection,
            packLabel: pack.metadata?.label ?? pack.collection,
            hits: hitsMax,
            creatureType,
            hasPsionics,
            characteristics: charMap,
            img: (doc as any).img,
          });
        } catch {
          errors++;
        }
      }
    } catch {
      errors++;
    }

    return { creatures, errors };
  }

  /**
   * Extract Cosmere RPG creatures from a single pack.
   */
  private async extractCosmereRpgDataFromPack(
    pack: any
  ): Promise<{ creatures: CosmereRpgCreatureIndex[]; errors: number }> {
    const creatures: CosmereRpgCreatureIndex[] = [];
    let errors = 0;

    try {
      const documents = await pack.getDocuments();

      for (const doc of documents) {
        try {
          if (doc.type !== 'adversary') {
            continue;
          }

          const result = this.extractCosmereRpgCreatureData(doc, pack);
          if (result) {
            creatures.push(result.creature);
            errors += result.errors;
          }
        } catch (error) {
          console.warn(
            `[${this.moduleId}] Failed to extract Cosmere RPG data from ${doc.name} in ${pack.metadata.label}:`,
            error
          );
          errors++;
        }
      }
    } catch (error) {
      console.warn(
        `[${this.moduleId}] Failed to load documents from ${pack.metadata.label}:`,
        error
      );
      errors++;
    }

    return { creatures, errors };
  }

  /**
   * Resolve a Cosmere DerivedValueField (`{value, derived, override?, useOverride, bonus?}`).
   * On a live, prepared actor `value` is already the fully-resolved number - Cosmere's own
   * getter computes it as `(useOverride ? override : derived) + bonus` (cosmere-rpg
   * src/system/data/fields/derived-value-field.ts) - so `value` is checked first. The
   * useOverride/override/derived fallback only matters for a hand-built/legacy shape that
   * has no `value` at all (audit round 6 found the old override-before-value order silently
   * dropped `bonus` whenever useOverride was true).
   */
  private readDerived(field: any): number | undefined {
    if (field == null) return undefined;
    if (typeof field === 'number') return field;
    if (typeof field === 'object') {
      if (typeof field.value === 'number') return field.value;
      if (field.useOverride === true && typeof field.override === 'number') {
        return field.override;
      }
      if (typeof field.derived === 'number') return field.derived;
    }
    return undefined;
  }

  /**
   * Extract a single Cosmere RPG adversary into the creature index format.
   */
  private extractCosmereRpgCreatureData(
    doc: any,
    pack: any
  ): { creature: CosmereRpgCreatureIndex; errors: number } | null {
    try {
      const system = doc.system ?? {};

      const tier = typeof system.tier === 'number' ? system.tier : 0;
      const role =
        typeof system.role === 'string' && system.role.length > 0
          ? system.role.toLowerCase()
          : 'unknown';

      const size =
        typeof system.size === 'string' && system.size.length > 0
          ? system.size.toLowerCase()
          : 'medium';

      const creatureType =
        typeof system.type?.id === 'string' && system.type.id.length > 0
          ? system.type.id.toLowerCase()
          : 'unknown';

      const subtype =
        typeof system.type?.subtype === 'string' && system.type.subtype.length > 0
          ? system.type.subtype
          : '';

      const hitPoints = this.readDerived(system.resources?.hea?.max) ?? 0;
      const focus = this.readDerived(system.resources?.foc?.max) ?? 0;
      const investiture = this.readDerived(system.resources?.inv?.max) ?? 0;

      const defensePhysical = this.readDerived(system.defenses?.phy) ?? 0;
      const defenseCognitive = this.readDerived(system.defenses?.cog) ?? 0;
      const defenseSpiritual = this.readDerived(system.defenses?.spi) ?? 0;

      const deflect = this.readDerived(system.deflect) ?? 0;
      const walkSpeed = this.readDerived(system.movement?.walk?.rate) ?? 0;

      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          tier,
          role,
          creatureType,
          subtype,
          size,
          hitPoints,
          focus,
          investiture,
          hasInvestiture: investiture > 0,
          defensePhysical,
          defenseCognitive,
          defenseSpiritual,
          deflect,
          walkSpeed,
          img: doc.img,
        },
        errors: 0,
      };
    } catch (error) {
      console.warn(
        `[${this.moduleId}] Failed to extract Cosmere RPG data from ${doc.name}:`,
        error
      );
      return {
        creature: {
          id: doc._id,
          name: doc.name,
          type: doc.type,
          pack: pack.metadata.id,
          packLabel: pack.metadata.label,
          tier: 0,
          role: 'unknown',
          creatureType: 'unknown',
          subtype: '',
          size: 'medium',
          hitPoints: 0,
          focus: 0,
          investiture: 0,
          hasInvestiture: false,
          defensePhysical: 0,
          defenseCognitive: 0,
          defenseSpiritual: 0,
          deflect: 0,
          walkSpeed: 0,
          description: 'Data extraction failed',
          img: doc.img || '',
        },
        errors: 1,
      };
    }
  }
}

export class FoundryDataAccess {
  private moduleId: string = MODULE_ID;
  private persistentIndex: PersistentCreatureIndex = new PersistentCreatureIndex();

  constructor() {}

  /**
   * Force rebuild of enhanced creature index
   */
  async rebuildEnhancedCreatureIndex(): Promise<{
    success: boolean;
    totalCreatures: number;
    message: string;
  }> {
    try {
      const creatures = await this.persistentIndex.rebuildIndex();
      return {
        success: true,
        totalCreatures: creatures.length,
        message: `Enhanced creature index rebuilt: ${creatures.length} creatures indexed from all packs`,
      };
    } catch (error) {
      console.error(`[${this.moduleId}] Failed to rebuild enhanced creature index:`, error);
      return {
        success: false,
        totalCreatures: 0,
        message: `Failed to rebuild index: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Get character/actor information by name or ID
   */
  async getCharacterInfo(identifier: string, raw = false): Promise<CharacterInfo> {
    let actor: Actor | undefined;

    // Try to find by ID first, then by name
    if (identifier.length === 16) {
      // Foundry ID length
      actor = game.actors.get(identifier);
    }

    if (!actor) {
      actor = game.actors.find(a => a.name?.toLowerCase() === identifier.toLowerCase());
    }

    if (!actor) {
      throw new Error(`${ERROR_MESSAGES.CHARACTER_NOT_FOUND}: ${identifier}`);
    }

    // Build character data structure
    const characterData: CharacterInfo = {
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
      ...(actor.img ? { img: actor.img } : {}),
      system: this.sanitizeData((actor as any).system),
      items: actor.items.map(item => {
        return {
          id: item.id,
          name: item.name,
          type: item.type,
          ...(item.img ? { img: item.img } : {}),
          system: this.sanitizeData(item.system),
        };
      }),
      effects: actor.effects.map(effect => {
        const eff = effect;
        const dur = eff.duration;
        const durRaw = eff._source?.duration;
        return {
          id: effect.id,
          name: eff.name || eff.label || 'Unknown Effect',
          ...(eff.icon ? { icon: eff.icon } : {}),
          disabled: eff.disabled,
          ...(dur
            ? {
                duration: {
                  type: dur.units ?? durRaw?.type ?? 'none',
                  duration: dur.seconds ?? durRaw?.duration,
                  remaining: dur.remaining,
                },
              }
            : {}),
        };
      }),
    };

    // Add PF2e-specific data if available
    const actorAny = actor as any;

    // Include actions (PF2e strikes, spells, etc.)
    if (actorAny.system?.actions) {
      characterData.actions = actorAny.system.actions.map((action: any) => ({
        name: action.label || action.name,
        type: action.type,
        ...(action.item ? { itemId: action.item.id } : {}),
        ...(action.variants
          ? {
              variants: action.variants.map((v: any) => ({
                label: v.label,
                ...(v.traits ? { traits: v.traits } : {}),
              })),
            }
          : {}),
        ...(action.ready !== undefined ? { ready: action.ready } : {}),
      }));
    }

    // Include item variants and toggles
    const itemVariants: any[] = [];
    const itemToggles: any[] = [];

    actor.items.forEach(item => {
      const itemAny = item;

      // Extract rule element variants (e.g., weapon variants, stance toggles)
      if (itemAny.system?.rules) {
        itemAny.system.rules.forEach((rule: any, ruleIndex: number) => {
          // Variants (ChoiceSet, RollOption with choices)
          if (rule.key === 'ChoiceSet' || (rule.key === 'RollOption' && rule.choices)) {
            itemVariants.push({
              itemId: item.id,
              itemName: item.name,
              ruleIndex,
              ruleKey: rule.key,
              label: rule.label || rule.prompt,
              ...(rule.selection ? { selected: rule.selection } : {}),
              ...(rule.choices ? { choices: rule.choices } : {}),
            });
          }

          // Toggles (RollOption toggleable, ToggleProperty)
          if ((rule.key === 'RollOption' && rule.toggleable) || rule.key === 'ToggleProperty') {
            itemToggles.push({
              itemId: item.id,
              itemName: item.name,
              ruleIndex,
              ruleKey: rule.key,
              label: rule.label,
              option: rule.option,
              ...(rule.value !== undefined ? { enabled: rule.value } : {}),
              ...(rule.toggleable !== undefined ? { toggleable: rule.toggleable } : {}),
            });
          }
        });
      }

      // Also check for item-level toggles (e.g., equipped, identified)
      if (itemAny.system?.equipped !== undefined) {
        itemToggles.push({
          itemId: item.id,
          itemName: item.name,
          type: 'equipped',
          enabled: itemAny.system.equipped,
        });
      }
    });

    // Add to character data if any found
    if (itemVariants.length > 0) {
      characterData.itemVariants = itemVariants;
    }
    if (itemToggles.length > 0) {
      characterData.itemToggles = itemToggles;
    }

    // Extract spellcasting data (PF2e and D&D 5e)
    const spellcastingEntries = this.extractSpellcastingData(actor);
    if (spellcastingEntries.length > 0) {
      characterData.spellcasting = spellcastingEntries;
    }

    if (raw) {
      // The curated view above hides most of `system`. `raw` returns the stored
      // _source for the fields callers commonly write and can't otherwise read
      // back (details, IWR, pfs, languages, build, proficiencies, ...).
      const src: any = (actor as any)._source?.system ?? {};
      const pick = (obj: any, keys: string[]) =>
        keys.reduce((o: any, k) => (k in (obj ?? {}) ? ((o[k] = obj[k]), o) : o), {});
      (characterData as any).raw = {
        details: src.details ?? null,
        traits: src.traits ?? null,
        abilities: src.abilities ?? null,
        attributes: pick(src.attributes, [
          'hp',
          'ac',
          'speed',
          'immunities',
          'weaknesses',
          'resistances',
          'initiative',
          'classDC',
        ]),
        perception: src.perception ?? null,
        saves: src.saves ?? null,
        skills: src.skills ?? null,
        proficiencies: src.proficiencies ?? null,
        martial: src.martial ?? null,
        build: src.build ?? null,
        resources: src.resources ?? null,
        pfs: src.pfs ?? null,
        spellcasting: src.spellcasting ?? null,
      };
    }

    return characterData;
  }

  /**
   * Search within a character's items, spells, actions, and effects
   * More token-efficient than getCharacterInfo when you need specific items
   */
  async searchCharacterItems(params: {
    characterIdentifier: string;
    query?: string | undefined;
    type?: string | undefined;
    category?: string | undefined;
    limit?: number | undefined;
  }): Promise<{
    characterId: string;
    characterName: string;
    query?: string;
    type?: string;
    category?: string;
    matches: Array<{
      id: string;
      name: string;
      type: string;
      description?: string;
      // For spells
      level?: number;
      prepared?: boolean;
      expended?: boolean;
      range?: string;
      target?: string;
      area?: string;
      actionCost?: string;
      traits?: string[];
      // For items
      quantity?: number;
      equipped?: boolean;
      invested?: boolean;
      // For actions
      actionType?: string;
    }>;
    totalMatches: number;
  }> {
    this.validateFoundryState();

    const { characterIdentifier, query, type, category, limit = 20 } = params;

    // Find the actor
    const actor = this.findActorByIdentifier(characterIdentifier);
    if (!actor) {
      throw new Error(`Character not found: ${characterIdentifier}`);
    }

    const actorAny = actor;
    const systemId = (game.system as any).id;
    const matches: Array<any> = [];

    // Normalize search query
    const searchQuery = query?.toLowerCase().trim();
    const searchType = type?.toLowerCase().trim();
    const searchCategory = category?.toLowerCase().trim();

    // Helper to check if text matches query (safely handles non-strings)
    const matchesQuery = (text: unknown): boolean => {
      if (!searchQuery) return true;
      if (typeof text !== 'string') return false;
      return text.toLowerCase().includes(searchQuery);
    };

    // Helper to check if item matches type filter
    const matchesType = (itemType: string): boolean => {
      if (!searchType) return true;
      return itemType.toLowerCase() === searchType;
    };

    // Search items
    for (const item of actor.items) {
      const itemSystem = item.system;

      // Check type filter
      if (!matchesType(item.type)) continue;

      // Check query filter (name or description)
      // Ensure description is a string (could be an object in some systems)
      let description = itemSystem?.description?.value || itemSystem?.description;
      if (typeof description !== 'string') description = '';
      if (!matchesQuery(item.name) && !matchesQuery(description)) continue;

      // Build result based on item type
      const result: any = {
        id: item.id,
        name: item.name,
        type: item.type,
      };

      // Add description (truncated for token efficiency)
      if (description) {
        // Strip HTML and truncate
        const plainText = description.replace(/<[^>]*>/g, '').trim();
        result.description =
          plainText.length > 300 ? `${plainText.substring(0, 300)}...` : plainText;
      }

      // Spell-specific fields
      if (item.type === 'spell') {
        result.level = itemSystem?.level?.value ?? itemSystem?.level ?? itemSystem?.rank ?? 0;
        const itemRaw = item._source?.system;
        result.prepared =
          itemSystem?.prepared ?? itemRaw?.preparation?.prepared ?? itemSystem?.location?.prepared;
        result.expended = itemSystem?.location?.expended;

        // Get targeting info
        if (systemId === 'pf2e') {
          const targeting = this.extractPF2eSpellTargeting(itemSystem);
          if (targeting.range) result.range = targeting.range;
          if (targeting.target) result.target = targeting.target;
          if (targeting.area) result.area = targeting.area;
          result.actionCost = this.formatPF2eActionCost(itemSystem?.time?.value);
          result.traits = itemSystem?.traits?.value || [];
        } else if (systemId === 'dnd5e') {
          const targeting = this.extractDnD5eSpellTargeting(itemSystem);
          if (targeting.range) result.range = targeting.range;
          if (targeting.target) result.target = targeting.target;
          if (targeting.area) result.area = targeting.area;
          result.actionCost = itemSystem?.activation?.type;
        } else if (systemId === 'dsa5') {
          const targeting = this.extractDSA5SpellTargeting(itemSystem);
          if (targeting.range) result.range = targeting.range;
          if (targeting.target) result.target = targeting.target;
          if (targeting.area) result.area = targeting.area;
          result.actionCost = itemSystem?.castingTime?.value;
        } else if (systemId === 'wfrp4e') {
          // WFRP4e spells use a Casting Number (CN) rather than levels/slots.
          if (itemSystem?.range?.value) result.range = itemSystem.range.value;
          if (itemSystem?.target?.value) result.target = itemSystem.target.value;
          const cn = itemSystem?.cn?.value;
          if (cn !== undefined && cn !== null) result.actionCost = `CN ${cn}`;
        }

        // Category filter for spells
        if (searchCategory) {
          const spellLevel = result.level || 0;
          const isPrepared = result.prepared !== false;
          const isCantrip = spellLevel === 0;
          const isFocus =
            itemSystem?.traits?.value?.includes('focus') || itemSystem?.category?.value === 'focus';

          if (searchCategory === 'cantrip' && !isCantrip) continue;
          if (searchCategory === 'prepared' && !isPrepared) continue;
          if (searchCategory === 'focus' && !isFocus) continue;
        }
      }

      // Equipment-specific fields
      if (['weapon', 'armor', 'equipment', 'consumable', 'backpack', 'loot'].includes(item.type)) {
        result.quantity = itemSystem?.quantity ?? 1;
        result.equipped = itemSystem?.equipped ?? false;
        result.invested = itemSystem?.equipped?.invested ?? itemSystem?.invested ?? undefined;

        // Category filter for equipment
        if (searchCategory) {
          if (searchCategory === 'equipped' && !result.equipped) continue;
          if (searchCategory === 'invested' && !result.invested) continue;
        }
      }

      // WFRP4e equipment fields (British 'armour'; 'trapping' is generic gear)
      if (
        systemId === 'wfrp4e' &&
        ['weapon', 'armour', 'trapping', 'ammunition', 'container'].includes(item.type)
      ) {
        result.quantity = itemSystem?.quantity?.value ?? 1;
        result.equipped = itemSystem?.equipped?.value ?? item.isEquipped ?? false;

        if (searchCategory === 'equipped' && !result.equipped) continue;
      }

      // WFRP4e prayer targeting (divine magic; item type 'prayer')
      if (systemId === 'wfrp4e' && item.type === 'prayer') {
        if (itemSystem?.range?.value) result.range = itemSystem.range.value;
        if (itemSystem?.target?.value) result.target = itemSystem.target.value;
      }

      // Feat/feature fields
      if (['feat', 'feature', 'class', 'ancestry', 'heritage', 'background'].includes(item.type)) {
        if (systemId === 'pf2e') {
          result.traits = itemSystem?.traits?.value || [];
          result.level = itemSystem?.level?.value ?? undefined;
          result.actionCost = this.formatPF2eActionCost(itemSystem?.actionType?.value);
        }
      }

      // Action fields
      if (item.type === 'action') {
        if (systemId === 'pf2e') {
          result.traits = itemSystem?.traits?.value || [];
          result.actionCost = this.formatPF2eActionCost(
            itemSystem?.actionType?.value || itemSystem?.actions?.value
          );
        }
      }

      matches.push(result);

      // Stop if we've reached the limit
      if (matches.length >= limit) break;
    }

    // Also search actions if type filter includes 'action' or is empty
    if (!searchType || searchType === 'action') {
      const actions =
        actorAny.system?.actions || actorAny.items?.filter((i: any) => i.type === 'action') || [];
      for (const action of actions) {
        if (matches.length >= limit) break;

        const actionName = action.name || action.label || '';
        if (!matchesQuery(actionName)) continue;

        const result: any = {
          id: action.id || action.slug || actionName,
          name: actionName,
          type: 'action',
          actionType: action.type || action.actionType || 'action',
        };

        if (systemId === 'pf2e') {
          result.traits = action.traits || [];
          result.actionCost = this.formatPF2eActionCost(action.actionCost?.value || action.actions);
        }

        matches.push(result);
      }
    }

    // Search effects if type filter includes 'effect' or is empty
    if (!searchType || searchType === 'effect') {
      const effects = actor.effects || [];
      for (const effect of effects) {
        if (matches.length >= limit) break;

        const effectAny = effect;
        if (!matchesQuery(effectAny.name || effectAny.label)) continue;

        matches.push({
          id: effectAny.id,
          name: effectAny.name || effectAny.label,
          type: 'effect',
          description: effectAny.description || undefined,
        });
      }
    }

    this.auditLog(
      'searchCharacterItems',
      {
        characterId: actor.id,
        query,
        type,
        category,
        matchCount: matches.length,
      },
      'success'
    );

    const result: {
      characterId: string;
      characterName: string;
      query?: string;
      type?: string;
      category?: string;
      matches: any[];
      totalMatches: number;
    } = {
      characterId: actor.id || '',
      characterName: actor.name || '',
      matches,
      totalMatches: matches.length,
    };

    if (query) result.query = query;
    if (type) result.type = type;
    if (category) result.category = category;

    return result;
  }

  /**
   * Extract spellcasting data from an actor (supports PF2e, D&D 5e, DSA5, and WFRP4e)
   */
  private extractSpellcastingData(actor: Actor): SpellcastingEntry[] {
    const entries: SpellcastingEntry[] = [];
    const actorAny = actor as any;
    const systemId = (game.system as any).id;

    // Get all spell items from the actor
    const spellItems = actor.items.filter(item => item.type === 'spell');

    if (systemId === 'pf2e') {
      // PF2e: Extract from spellcastingEntries
      const spellcastingEntries =
        actorAny.spellcasting?.contents ||
        actorAny.items?.filter((i: any) => i.type === 'spellcastingEntry') ||
        [];

      for (const entry of spellcastingEntries) {
        const entryData = entry.system || entry;
        const entrySpells: SpellInfo[] = [];

        // Get spells associated with this entry
        // In PF2e, spells have a location property pointing to their spellcasting entry
        const entryId = entry.id;
        const associatedSpells = spellItems.filter((spell: any) => {
          const spellSystem = spell.system;
          return spellSystem?.location?.value === entryId || spellSystem?.location === entryId;
        });

        for (const spell of associatedSpells) {
          const spellSystem = spell.system as any;
          const targeting = this.extractPF2eSpellTargeting(spellSystem);
          entrySpells.push({
            id: spell.id || '',
            name: spell.name || '',
            level: spellSystem?.level?.value ?? spellSystem?.rank ?? 0,
            prepared: spellSystem?.location?.prepared ?? true,
            expended: spellSystem?.location?.expended ?? false,
            traits: spellSystem?.traits?.value || [],
            actionCost: this.formatPF2eActionCost(spellSystem?.time?.value),
            range: targeting.range,
            target: targeting.target,
            area: targeting.area,
          });
        }

        // Also check for spells in the entry's spell collection
        if (entry.spells) {
          for (const [levelKey, levelData] of Object.entries(entry.spells as Record<string, any>)) {
            const spellsAtLevel = levelData?.value || levelData || [];
            if (Array.isArray(spellsAtLevel)) {
              for (const spellRef of spellsAtLevel) {
                // Skip if we already have this spell
                if (entrySpells.some(s => s.id === spellRef.id)) continue;

                const spellItem = actor.items.get(spellRef.id || spellRef);
                if (spellItem) {
                  const spellSystem = spellItem.system as any;
                  const targeting = this.extractPF2eSpellTargeting(spellSystem);
                  entrySpells.push({
                    id: spellItem.id || '',
                    name: spellItem.name || '',
                    level:
                      parseInt(levelKey.replace('spell', '')) || spellSystem?.level?.value || 0,
                    prepared: spellRef.prepared ?? true,
                    expended: spellRef.expended ?? false,
                    traits: spellSystem?.traits?.value || [],
                    actionCost: this.formatPF2eActionCost(spellSystem?.time?.value),
                    range: targeting.range,
                    target: targeting.target,
                    area: targeting.area,
                  });
                }
              }
            }
          }
        }

        entries.push({
          id: entry.id || '',
          name: entry.name || 'Spellcasting',
          tradition: entryData?.tradition?.value || entryData?.tradition || undefined,
          type: entryData?.prepared?.value || entryData?.prepared || 'prepared',
          ability: entryData?.ability?.value || entryData?.ability || undefined,
          dc: entryData?.spelldc?.dc || entryData?.dc?.value || undefined,
          attack: entryData?.spelldc?.value || entryData?.attack?.value || undefined,
          slots: this.extractPF2eSpellSlots(entryData),
          spells: entrySpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }

      // Also capture focus spells and innate spells that might not be in entries
      const focusSpells = spellItems.filter((spell: any) => {
        const spellSystem = spell.system;
        return (
          spellSystem?.traits?.value?.includes('focus') || spellSystem?.category?.value === 'focus'
        );
      });

      if (focusSpells.length > 0 && !entries.some(e => e.type === 'focus')) {
        entries.push({
          id: 'focus-spells',
          name: 'Focus Spells',
          type: 'focus',
          spells: focusSpells.map((spell: any) => {
            const spellSystem = spell.system;
            const targeting = this.extractPF2eSpellTargeting(spellSystem);
            return {
              id: spell.id || '',
              name: spell.name || '',
              level: spellSystem?.level?.value || 0,
              traits: spellSystem?.traits?.value || [],
              actionCost: this.formatPF2eActionCost(spellSystem?.time?.value),
              range: targeting.range,
              target: targeting.target,
              area: targeting.area,
            };
          }),
        });
      }
    } else if (systemId === 'dnd5e') {
      // D&D 5e: Extract from classes with spellcasting
      const classes = actor.items.filter(item => item.type === 'class');
      const spellSlots = actorAny.system?.spells || {};

      // Group spells by their source class or create a general entry
      const spellsByClass: Record<string, SpellInfo[]> = {};

      for (const spell of spellItems) {
        const spellSystem = spell.system as any;
        const spellRaw = (spell as any)._source?.system || spellSystem;
        const sourceItem = spellSystem?.sourceItem;
        const sourceClass =
          (sourceItem
            ? typeof sourceItem === 'string'
              ? sourceItem
              : sourceItem.identifier || sourceItem.id
            : spellRaw?.sourceClass) || 'general';

        if (!spellsByClass[sourceClass]) {
          spellsByClass[sourceClass] = [];
        }

        const targeting = this.extractDnD5eSpellTargeting(spellSystem);
        spellsByClass[sourceClass].push({
          id: spell.id || '',
          name: spell.name || '',
          level: spellSystem?.level || 0,
          prepared: spellSystem?.prepared ?? spellRaw?.preparation?.prepared ?? true,
          traits: [], // D&D 5e doesn't use traits the same way
          actionCost: spellSystem?.activation?.type || undefined,
          range: targeting.range,
          target: targeting.target,
          area: targeting.area,
        });
      }

      // Create entries for each spellcasting class
      for (const classItem of classes) {
        const classSystem = classItem.system as any;
        if (
          classSystem?.spellcasting?.progression &&
          classSystem.spellcasting.progression !== 'none'
        ) {
          const className = classItem.name || 'Unknown';
          const classSpells =
            spellsByClass[classItem.id || ''] || spellsByClass[className.toLowerCase()] || [];

          entries.push({
            id: classItem.id || '',
            name: `${className} Spellcasting`,
            type: classSystem?.spellcasting?.type || 'prepared',
            ability: classSystem?.spellcasting?.ability || undefined,
            slots: this.extractDnD5eSpellSlots(spellSlots),
            spells: classSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
          });
        }
      }

      // If no class-based entries found but we have spells, create a general entry
      if (entries.length === 0 && spellItems.length > 0) {
        const allSpells: SpellInfo[] = [];
        for (const spell of spellItems) {
          const spellSystem = spell.system as any;
          const targeting = this.extractDnD5eSpellTargeting(spellSystem);
          allSpells.push({
            id: spell.id || '',
            name: spell.name || '',
            level: spellSystem?.level || 0,
            prepared: spellSystem?.preparation?.prepared ?? true,
            actionCost: spellSystem?.activation?.type || undefined,
            range: targeting.range,
            target: targeting.target,
            area: targeting.area,
          });
        }

        entries.push({
          id: 'spellcasting',
          name: 'Spellcasting',
          type: 'prepared',
          slots: this.extractDnD5eSpellSlots(spellSlots),
          spells: allSpells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }
    } else if (systemId === 'dsa5') {
      // DSA5: Extract Zauber (spells), Liturgien (liturgies), Zeremonien (ceremonies), Rituale (rituals)
      const astralSpells = actor.items.filter(item => item.type === 'spell');
      const karmaSpells = actor.items.filter(item => ['liturgy', 'ceremony'].includes(item.type));
      const rituals = actor.items.filter(item => item.type === 'ritual');

      // Get AsP and KaP from actor
      const asp = actorAny.system?.status?.astralenergy || actorAny.system?.astralenergy;
      const kap = actorAny.system?.status?.karmaenergy || actorAny.system?.karmaenergy;

      // Zauber (Arcane spells using AsP)
      if (astralSpells.length > 0) {
        entries.push({
          id: 'zauber',
          name: 'Zauber (Spells)',
          type: 'arcane',
          slots: asp
            ? {
                asp: { value: asp.value ?? 0, max: asp.max ?? 0 },
              }
            : undefined,
          spells: astralSpells
            .map((spell: any) => {
              const spellSystem = spell.system;
              const targeting = this.extractDSA5SpellTargeting(spellSystem);
              return {
                id: spell.id || '',
                name: spell.name || '',
                level: spellSystem?.level?.value ?? spellSystem?.level ?? 0,
                traits: spellSystem?.effect?.attributes || [],
                actionCost: spellSystem?.castingTime?.value || undefined,
                range: targeting.range,
                target: targeting.target,
                area: targeting.area,
              };
            })
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }

      // Liturgien & Zeremonien (Divine spells using KaP)
      if (karmaSpells.length > 0) {
        entries.push({
          id: 'liturgien',
          name: 'Liturgien & Zeremonien (Liturgies)',
          type: 'divine',
          slots: kap
            ? {
                kap: { value: kap.value ?? 0, max: kap.max ?? 0 },
              }
            : undefined,
          spells: karmaSpells
            .map((spell: any) => {
              const spellSystem = spell.system;
              const targeting = this.extractDSA5SpellTargeting(spellSystem);
              return {
                id: spell.id || '',
                name: spell.name || '',
                level: spellSystem?.level?.value ?? spellSystem?.level ?? 0,
                traits: spellSystem?.effect?.attributes || [],
                actionCost: spellSystem?.castingTime?.value || undefined,
                range: targeting.range,
                target: targeting.target,
                area: targeting.area,
              };
            })
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }

      // Rituale (Rituals - can use either AsP or KaP depending on tradition)
      if (rituals.length > 0) {
        entries.push({
          id: 'rituale',
          name: 'Rituale (Rituals)',
          type: 'ritual',
          spells: rituals
            .map((spell: any) => {
              const spellSystem = spell.system;
              const targeting = this.extractDSA5SpellTargeting(spellSystem);
              return {
                id: spell.id || '',
                name: spell.name || '',
                level: spellSystem?.level?.value ?? spellSystem?.level ?? 0,
                traits: spellSystem?.effect?.attributes || [],
                actionCost: spellSystem?.castingTime?.value || undefined,
                range: targeting.range,
                target: targeting.target,
                area: targeting.area,
              };
            })
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
        });
      }
    } else if (systemId === 'wfrp4e') {
      // WFRP4e: arcane spells grouped by Lore, divine prayers grouped by God.
      // WFRP4e has no spell levels or slots; spells use a Casting Number (CN).
      const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

      // Arcane spells, grouped by lore
      const spellsByLore = new Map<string, SpellInfo[]>();
      for (const spell of actor.items.filter(item => item.type === 'spell')) {
        const spellSystem = spell.system as any;
        const loreRaw = spellSystem?.lore?.value;
        const lore = String((Array.isArray(loreRaw) ? loreRaw[0] : loreRaw) || 'arcane');
        const cn = spellSystem?.cn?.value;
        const info: SpellInfo = {
          id: spell.id || '',
          name: spell.name || '',
          level: 0,
          actionCost: cn !== undefined && cn !== null ? `CN ${cn}` : undefined,
          range: spellSystem?.range?.value || undefined,
          target: spellSystem?.target?.value || undefined,
        };
        if (!spellsByLore.has(lore)) spellsByLore.set(lore, []);
        spellsByLore.get(lore)!.push(info);
      }
      for (const [lore, loreSpells] of spellsByLore) {
        entries.push({
          id: `lore-${lore}`,
          name: `Lore of ${cap(lore)}`,
          type: 'arcane',
          tradition: 'arcane',
          spells: loreSpells.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }

      // Divine prayers, grouped by god
      const prayersByGod = new Map<string, SpellInfo[]>();
      for (const prayer of actor.items.filter(item => item.type === 'prayer')) {
        const praySystem = prayer.system as any;
        const god = String(praySystem?.god?.value || 'divine');
        const info: SpellInfo = {
          id: prayer.id || '',
          name: prayer.name || '',
          level: 0,
          range: praySystem?.range?.value || undefined,
          target: praySystem?.target?.value || undefined,
        };
        if (!prayersByGod.has(god)) prayersByGod.set(god, []);
        prayersByGod.get(god)!.push(info);
      }
      for (const [god, godPrayers] of prayersByGod) {
        entries.push({
          id: `prayers-${god}`,
          name: god === 'divine' ? 'Prayers' : `Prayers (${cap(god)})`,
          type: 'divine',
          tradition: 'divine',
          spells: godPrayers.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    }

    return entries;
  }

  /**
   * Format PF2e action cost to human-readable string
   */
  private formatPF2eActionCost(actionValue: any): string | undefined {
    if (!actionValue) return undefined;
    if (typeof actionValue === 'number') {
      return actionValue === 1 ? '1 action' : `${actionValue} actions`;
    }
    if (actionValue === 'reaction') return 'reaction';
    if (actionValue === 'free') return 'free action';
    return String(actionValue);
  }

  /**
   * Extract PF2e spell slots from spellcasting entry data
   */
  private extractPF2eSpellSlots(
    entryData: any
  ): Record<string, { value: number; max: number }> | undefined {
    const slots: Record<string, { value: number; max: number }> = {};

    // PF2e stores slots per rank
    for (let rank = 1; rank <= 10; rank++) {
      const slotKey = `slot${rank}`;
      const slotData = entryData?.slots?.[slotKey] || entryData?.[slotKey];
      if (slotData && (slotData.max > 0 || slotData.value > 0)) {
        slots[`rank${rank}`] = {
          value: slotData.value ?? 0,
          max: slotData.max ?? 0,
        };
      }
    }

    return Object.keys(slots).length > 0 ? slots : undefined;
  }

  /**
   * Extract D&D 5e spell slots from actor system data
   */
  private extractDnD5eSpellSlots(
    spellsData: any
  ): Record<string, { value: number; max: number }> | undefined {
    const slots: Record<string, { value: number; max: number }> = {};

    // D&D 5e stores slots as spell1, spell2, etc.
    for (let level = 1; level <= 9; level++) {
      const slotKey = `spell${level}`;
      const slotData = spellsData?.[slotKey];
      if (slotData && (slotData.max > 0 || slotData.value > 0)) {
        slots[`level${level}`] = {
          value: slotData.value ?? 0,
          max: slotData.max ?? 0,
        };
      }
    }

    // Also check for pact slots (warlock)
    const pactSlot = spellsData?.pact;
    if (pactSlot && (pactSlot.max > 0 || pactSlot.value > 0)) {
      slots['pact'] = {
        value: pactSlot.value ?? 0,
        max: pactSlot.max ?? 0,
      };
    }

    return Object.keys(slots).length > 0 ? slots : undefined;
  }

  /**
   * Extract spell targeting info for D&D 5e
   * D&D 5e spells have: target.type ("self", "creature", "point", etc.), range.value, range.units
   */
  private extractDnD5eSpellTargeting(spellSystem: any): {
    range?: string;
    target?: string;
    area?: string;
  } {
    const result: { range?: string; target?: string; area?: string } = {};

    // Range (e.g., "60 feet", "Self", "Touch")
    const rangeValue = spellSystem?.range?.value;
    const rangeUnits = spellSystem?.range?.units;
    if (rangeUnits === 'self') {
      result.range = 'Self';
    } else if (rangeUnits === 'touch') {
      result.range = 'Touch';
    } else if (rangeUnits === 'spec') {
      result.range = spellSystem?.range?.special || 'Special';
    } else if (rangeValue && rangeUnits) {
      result.range = `${rangeValue} ${rangeUnits}`;
    }

    // Target type (e.g., "1 creature", "self", "area")
    const targetType = spellSystem?.target?.type;
    const targetValue = spellSystem?.target?.value;
    if (targetType === 'self') {
      result.target = 'self';
    } else if (targetType === 'creature' || targetType === 'ally' || targetType === 'enemy') {
      result.target = targetValue
        ? `${targetValue} ${targetType}${targetValue > 1 ? 's' : ''}`
        : targetType;
    } else if (targetType === 'object') {
      result.target = targetValue ? `${targetValue} object${targetValue > 1 ? 's' : ''}` : 'object';
    } else if (targetType === 'space' || targetType === 'point') {
      result.target = 'point';
    } else if (targetType) {
      result.target = targetType;
    }

    // Area (for AoE spells - e.g., "20-foot radius", "30-foot cone")
    const areaType = spellSystem?.target?.template?.type;
    const areaSize = spellSystem?.target?.template?.size;
    const areaUnits = spellSystem?.target?.template?.units || 'ft';
    if (areaType && areaSize) {
      result.area = `${areaSize}-${areaUnits} ${areaType}`;
      // If spell has area, target is usually "area"
      if (!result.target || result.target === 'point') {
        result.target = 'area';
      }
    }

    return result;
  }

  /**
   * Extract spell targeting info for PF2e
   * PF2e spells have: target (string), range.value, area.type, area.value
   */
  private extractPF2eSpellTargeting(spellSystem: any): {
    range?: string;
    target?: string;
    area?: string;
  } {
    const result: { range?: string; target?: string; area?: string } = {};

    // Range (e.g., "30 feet", "touch")
    const rangeValue = spellSystem?.range?.value;
    if (rangeValue) {
      result.range = String(rangeValue);
    }

    // Target (PF2e has a descriptive target string)
    const targetValue = spellSystem?.target?.value;
    if (targetValue) {
      result.target = String(targetValue);
    }

    // Area (e.g., "15-foot emanation", "30-foot cone")
    const areaType = spellSystem?.area?.type;
    const areaValue = spellSystem?.area?.value;
    if (areaType) {
      if (areaValue) {
        result.area = `${areaValue}-foot ${areaType}`;
      } else {
        result.area = areaType;
      }
      // If has area but no explicit target, it's an area spell
      if (!result.target) {
        result.target = 'area';
      }
    }

    return result;
  }

  /**
   * Extract spell targeting info for DSA5
   * DSA5 spells have: targetCategory, range, etc.
   */
  private extractDSA5SpellTargeting(spellSystem: any): {
    range?: string;
    target?: string;
    area?: string;
  } {
    const result: { range?: string; target?: string; area?: string } = {};

    // Range
    const rangeValue = spellSystem?.range?.value || spellSystem?.Reichweite;
    if (rangeValue) {
      result.range = String(rangeValue);
    }

    // Target category
    const targetCategory = spellSystem?.targetCategory?.value || spellSystem?.Zielkategorie;
    if (targetCategory) {
      result.target = String(targetCategory);
    }

    // Area (Wirkungsbereich)
    const areaValue = spellSystem?.effectRadius?.value || spellSystem?.Wirkungsbereich;
    if (areaValue) {
      result.area = String(areaValue);
    }

    return result;
  }

  /**
   * Search compendium packs for items matching query with optional filters
   */
  async searchCompendium(
    query: string,
    packType?: string,
    filters?: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    }
  ): Promise<CompendiumSearchResult[]> {
    // Add defensive checks for query parameter
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      throw new Error('Search query must be a string with at least 2 characters');
    }

    // ENHANCED SEARCH: If we have creature-specific filters and Actor packType, use enhanced index
    if (
      filters &&
      packType === 'Actor' &&
      (filters.challengeRating || filters.creatureType || filters.hasLegendaryActions)
    ) {
      // Check if enhanced creature index is enabled
      const enhancedIndexEnabled = game.settings.get(this.moduleId, 'enableEnhancedCreatureIndex');

      if (enhancedIndexEnabled) {
        try {
          // Convert search criteria and use enhanced search
          const criteria: any = { limit: 100 }; // Default limit for search

          if (filters.challengeRating) criteria.challengeRating = filters.challengeRating;
          if (filters.creatureType) criteria.creatureType = filters.creatureType;
          if (filters.size) criteria.size = filters.size;
          if (filters.hasLegendaryActions)
            criteria.hasLegendaryActions = filters.hasLegendaryActions;

          const enhancedResult = await this.listCreaturesByCriteria(criteria);

          // No name filtering needed - trust the enhanced creature index!
          const filteredResults = enhancedResult.creatures;

          // Convert to CompendiumSearchResult format
          return filteredResults.map(
            creature =>
              ({
                id: creature.id || creature.name,
                name: creature.name,
                type: creature.type || 'npc',
                pack: creature.pack,
                packLabel: creature.packLabel || creature.pack,
                description: creature.description || '',
                hasImage: creature.hasImage || !!creature.img,
                summary: `CR ${creature.challengeRating} ${creature.creatureType} from ${creature.packLabel}`,
                // Enhanced data (not part of interface but will be included)
                challengeRating: creature.challengeRating,
                creatureType: creature.creatureType,
                size: creature.size,
                hasLegendaryActions: creature.hasLegendaryActions,
              }) as CompendiumSearchResult & {
                challengeRating: number;
                creatureType: string;
                size: string;
                hasLegendaryActions: boolean;
              }
          );
        } catch (error) {
          console.warn(
            `[${this.moduleId}] Enhanced search failed, falling back to basic search:`,
            error
          );
          // Continue to basic search below
        }
      }
    }

    const results: CompendiumSearchResult[] = [];
    const cleanQuery = query.toLowerCase().trim();
    const searchTerms = cleanQuery
      .split(' ')
      .filter(term => term && typeof term === 'string' && term.length > 0);

    if (searchTerms.length === 0) {
      throw new Error('Search query must contain valid search terms');
    }

    // Filter packs by type if specified
    const packs = Array.from(game.packs.values()).filter(pack => {
      if (packType && pack.metadata.type !== packType) {
        return false;
      }
      return pack.metadata.type !== 'Scene'; // Exclude scene packs for safety
    });

    for (const pack of packs) {
      try {
        // Ensure pack index is loaded.
        // In Foundry v13 getIndex() returns the index Collection; always call it
        // and use the return value so we don't depend on pack.indexed state.
        let packIndex: any;
        try {
          packIndex = await (pack as any).getIndex({ fields: ['name', 'img', 'type'] });
        } catch {
          // Fallback: older Foundry API without fields option
          packIndex = await (pack as any).getIndex();
        }

        // Use the returned index if available, otherwise fall back to pack.index
        const indexSource =
          packIndex && typeof packIndex.values === 'function' ? packIndex : (pack as any).index;

        const entriesToSearch = Array.from((indexSource as any).values());

        for (const entry of entriesToSearch) {
          try {
            // Type assertion and comprehensive safety checks for entry properties
            const typedEntry = entry as any;
            if (
              !typedEntry?.name ||
              typeof typedEntry.name !== 'string' ||
              typedEntry.name.trim().length === 0
            ) {
              continue;
            }

            // Ensure searchTerms are valid before using them
            if (!searchTerms || !Array.isArray(searchTerms) || searchTerms.length === 0) {
              continue;
            }

            // Use already created typedEntry

            const entryNameLower = typedEntry.name.toLowerCase();
            const nameMatch = searchTerms.every(term => {
              if (!term || typeof term !== 'string') {
                return false;
              }
              return entryNameLower.includes(term);
            });

            if (nameMatch) {
              // For Actor packs with filters, use simple name/description matching
              if (
                filters &&
                this.shouldApplyFilters(entry, filters) &&
                pack.metadata.type === 'Actor'
              ) {
                // Convert filters to search criteria for compatibility
                const searchCriteria: any = {};

                if (filters.challengeRating) {
                  const searchTerms = [];
                  if (typeof filters.challengeRating === 'number') {
                    if (filters.challengeRating >= 15) {
                      searchTerms.push('ancient', 'legendary', 'elder', 'greater');
                    } else if (filters.challengeRating >= 10) {
                      searchTerms.push('adult', 'warlord', 'champion', 'master');
                    } else if (filters.challengeRating >= 5) {
                      searchTerms.push('captain', 'knight', 'priest', 'mage');
                    } else {
                      searchTerms.push('guard', 'soldier', 'warrior', 'scout');
                    }
                  }
                  searchCriteria.searchTerms = searchTerms;
                }

                if (filters.creatureType) {
                  const typeTerms = [filters.creatureType];
                  if (filters.creatureType.toLowerCase() === 'humanoid') {
                    typeTerms.push('human', 'elf', 'dwarf', 'orc', 'goblin');
                  }
                  searchCriteria.searchTerms = [
                    ...(searchCriteria.searchTerms || []),
                    ...typeTerms,
                  ];
                }

                if (!this.matchesSearchCriteria(typedEntry, searchCriteria)) {
                  continue;
                }
              }

              // Standard index entry result
              results.push({
                id: typedEntry._id || '',
                name: typedEntry.name,
                type: typedEntry.type || 'unknown',
                img: typedEntry.img || undefined,
                pack: pack.metadata.id,
                packLabel: pack.metadata.label,
                description: typedEntry.description || '',
                hasImage: !!typedEntry.img,
                summary: `${typedEntry.type} from ${pack.metadata.label}`,
              });
            }
          } catch (entryError) {
            // Log individual entry errors but continue processing
            console.warn(
              `[${this.moduleId}] Error processing entry in pack ${pack.metadata.id}:`,
              entryError
            );
            continue;
          }

          // Limit results per pack to prevent overwhelming responses
          if (results.length >= 100) break;
        }
      } catch (error) {
        console.warn(`[${this.moduleId}] Failed to search pack ${pack.metadata.id}:`, error);
      }

      // Global limit to prevent memory issues
      if (results.length >= 100) break;
    }

    // Sort results by relevance with enhanced ranking for filtered searches
    results.sort((a, b) => {
      // Exact name matches first
      const aExact = a.name.toLowerCase() === query.toLowerCase();
      const bExact = b.name.toLowerCase() === query.toLowerCase();
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      // If filters are used, prioritize by filter match quality
      if (filters) {
        const aScore = this.calculateRelevanceScore(a, filters, query);
        const bScore = this.calculateRelevanceScore(b, filters, query);
        if (aScore !== bScore) return bScore - aScore; // Higher score first
      }

      // Fallback to alphabetical
      return a.name.localeCompare(b.name);
    });

    return results.slice(0, 50); // Final limit
  }

  /**
   * Check if filters should be applied to this entry
   */
  private shouldApplyFilters(entry: any, filters: any): boolean {
    // Only apply filters to Actor entries (which includes NPCs/monsters/creatures)
    if (entry.type !== 'npc' && entry.type !== 'character' && entry.type !== 'creature') {
      return false;
    }

    // Check if any filters are actually specified
    return Object.keys(filters).some(key => filters[key] !== undefined);
  }

  /**
   * Check if entry passes all specified filters
   * @unused - Replaced with simple index-only approach
   */
  // @ts-ignore - Unused method kept for compatibility
  private passesFilters(
    entry: any,
    filters: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      alignment?: string;
      hasLegendaryActions?: boolean;
      spellcaster?: boolean;
    }
  ): boolean {
    const system = entry.system || {};

    // Challenge Rating filter
    if (filters.challengeRating !== undefined) {
      // Try multiple possible CR locations in D&D 5e data structure
      let entryCR =
        system.details?.cr?.value || system.details?.cr || system.cr?.value || system.cr || 0;

      // Handle fractional CRs (common in D&D 5e)
      if (typeof entryCR === 'string') {
        if (entryCR === '1/8') entryCR = 0.125;
        else if (entryCR === '1/4') entryCR = 0.25;
        else if (entryCR === '1/2') entryCR = 0.5;
        else entryCR = parseFloat(entryCR) || 0;
      }

      if (typeof filters.challengeRating === 'number') {
        // Exact CR match
        if (entryCR !== filters.challengeRating) {
          return false;
        }
      } else if (typeof filters.challengeRating === 'object') {
        // CR range
        const { min, max } = filters.challengeRating;
        if (min !== undefined && entryCR < min) {
          return false;
        }
        if (max !== undefined && entryCR > max) {
          return false;
        }
      }
    }

    // Creature Type filter
    if (filters.creatureType) {
      const entryType = system.details?.type?.value || system.type?.value || '';
      if (entryType.toLowerCase() !== filters.creatureType.toLowerCase()) {
        return false;
      }
    }

    // Size filter
    if (filters.size) {
      const entrySize = system.traits?.size || system.size || '';
      if (entrySize.toLowerCase() !== filters.size.toLowerCase()) {
        return false;
      }
    }

    // Alignment filter
    if (filters.alignment) {
      const entryAlignment = system.details?.alignment || system.alignment || '';
      if (!entryAlignment.toLowerCase().includes(filters.alignment.toLowerCase())) {
        return false;
      }
    }

    // Legendary Actions filter
    if (filters.hasLegendaryActions !== undefined) {
      const hasLegendary = !!(
        system.resources?.legact ||
        system.legendary ||
        (system.resources?.legres && system.resources.legres.value > 0)
      );
      if (hasLegendary !== filters.hasLegendaryActions) {
        return false;
      }
    }

    // Spellcaster filter
    if (filters.spellcaster !== undefined) {
      const isSpellcaster = !!(
        system.spells ||
        system.attributes?.spellcasting ||
        (system.details?.spellLevel && system.details.spellLevel > 0)
      );
      if (isSpellcaster !== filters.spellcaster) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate relevance score for search result ranking
   */
  private calculateRelevanceScore(entry: any, filters: any, query: string): number {
    let score = 0;
    const system = entry.system || {};

    // Bonus for creature type match (high importance for encounter building)
    if (filters.creatureType) {
      const entryType = system.details?.type?.value || system.type?.value || '';
      if (entryType.toLowerCase() === filters.creatureType.toLowerCase()) {
        score += 20;
      }
    }

    // Bonus for CR match (exact match gets higher score than range)
    if (filters.challengeRating !== undefined) {
      const entryCR = system.details?.cr || system.cr || 0;
      if (typeof filters.challengeRating === 'number') {
        if (entryCR === filters.challengeRating) score += 15;
      } else if (typeof filters.challengeRating === 'object') {
        const { min, max } = filters.challengeRating;
        if (min !== undefined && max !== undefined) {
          // Bonus for being in range, extra for being in middle of range
          if (entryCR >= min && entryCR <= max) {
            score += 10;
            const rangeMid = (min + max) / 2;
            const distFromMid = Math.abs(entryCR - rangeMid);
            score += Math.max(0, 5 - distFromMid); // Up to 5 bonus for being near middle
          }
        }
      }
    }

    // Bonus for common creature names (better for encounters)
    const commonNames = [
      'knight',
      'warrior',
      'guard',
      'soldier',
      'mage',
      'priest',
      'bandit',
      'orc',
      'goblin',
      'dragon',
    ];
    const lowerName = entry.name.toLowerCase();
    if (commonNames.some(name => lowerName.includes(name))) {
      score += 5;
    }

    // Bonus for query term matches in name
    const queryTerms = query.toLowerCase().split(' ');
    for (const term of queryTerms) {
      if (term.length > 2 && lowerName.includes(term)) {
        score += 3;
      }
    }

    return score;
  }

  /**
   * List creatures by criteria using enhanced persistent index - optimized for instant filtering
   */
  async listCreaturesByCriteria(criteria: {
    challengeRating?: number | { min?: number; max?: number };
    creatureType?: string;
    size?: string;
    hasSpells?: boolean;
    hasLegendaryActions?: boolean;
    limit?: number;
  }): Promise<{ creatures: any[]; searchSummary: any }> {
    const limit = criteria.limit || 500;

    // Check if enhanced creature index is enabled
    const enhancedIndexEnabled = game.settings.get(this.moduleId, 'enableEnhancedCreatureIndex');

    if (!enhancedIndexEnabled) {
      return this.fallbackBasicCreatureSearch(criteria, limit, 'disabled');
    }

    try {
      // Get enhanced creature index (builds if needed)
      const enhancedCreatures = await this.persistentIndex.getEnhancedIndex();

      // Apply filters to enhanced data
      let filteredCreatures = enhancedCreatures.filter(creature =>
        this.passesEnhancedCriteria(creature, criteria)
      );

      // Sort by power level then name for consistent ordering (system-aware).
      // Power-level dial: tier (cosmere), level (pf2e), challengeRating (dnd5e).
      const powerLevel = (c: EnhancedCreatureIndex): number => {
        if ('hits' in c && 'hasPsionics' in c) return (c as MGT2eCreatureIndex).hits;
        if ('tier' in c) return (c as CosmereRpgCreatureIndex).tier;
        if ('level' in c) return (c as PF2eCreatureIndex).level;
        return (c as DnD5eCreatureIndex).challengeRating;
      };
      filteredCreatures.sort((a, b) => {
        const powerA = powerLevel(a);
        const powerB = powerLevel(b);
        if (powerA !== powerB) return powerA - powerB;
        return a.name.localeCompare(b.name);
      });

      // Apply limit
      if (filteredCreatures.length > limit) {
        filteredCreatures = filteredCreatures.slice(0, limit);
      }

      // Convert enhanced creatures to result format (system-aware)
      const results = filteredCreatures.map(creature => {
        const isMGT2e = 'hits' in creature && 'hasPsionics' in creature;
        const isCosmere = !isMGT2e && 'tier' in creature;
        const isPF2e = !isMGT2e && !isCosmere && 'level' in creature;

        const base = {
          id: creature.id,
          name: creature.name,
          type: creature.type,
          pack: creature.pack,
          packLabel: creature.packLabel,
          description: (creature as any).description || '',
          hasImage: !!creature.img,
          creatureType: (creature as any).creatureType,
          size: (creature as any).size,
          hitPoints: (creature as any).hitPoints,
        };

        if (isMGT2e) {
          const m = creature as MGT2eCreatureIndex;
          const strDm = m.characteristics?.STR?.dm ?? 0;
          const dexDm = m.characteristics?.DEX?.dm ?? 0;
          return {
            ...base,
            hits: m.hits,
            creatureType: m.creatureType,
            hasPsionics: m.hasPsionics,
            characteristics: m.characteristics,
            summary: `${m.type} — ${m.hits} hits${m.creatureType ? ', ' + m.creatureType : ''} (STR DM${strDm >= 0 ? '+' : ''}${strDm}, DEX DM${dexDm >= 0 ? '+' : ''}${dexDm}) from ${m.packLabel}`,
          };
        }

        if (isCosmere) {
          const c = creature;
          return {
            ...base,
            summary: `Tier ${c.tier} ${c.role} ${c.creatureType} from ${c.packLabel}`,
            tier: c.tier,
            role: c.role,
            subtype: c.subtype,
            focus: c.focus,
            investiture: c.investiture,
            hasInvestiture: c.hasInvestiture,
            defenses: {
              physical: c.defensePhysical,
              cognitive: c.defenseCognitive,
              spiritual: c.defenseSpiritual,
            },
            deflect: c.deflect,
            walkSpeed: c.walkSpeed,
          };
        }

        if (isPF2e) {
          const p = creature;
          return {
            ...base,
            armorClass: p.armorClass,
            hasSpells: p.hasSpells,
            alignment: p.alignment,
            summary: `Level ${p.level} ${p.creatureType} (${p.rarity}) from ${p.packLabel}`,
            level: p.level,
            traits: p.traits,
            rarity: p.rarity,
          };
        }

        const d = creature as DnD5eCreatureIndex;
        return {
          ...base,
          armorClass: d.armorClass,
          hasSpells: d.hasSpells,
          alignment: d.alignment,
          summary: `CR ${d.challengeRating} ${d.creatureType} from ${d.packLabel}`,
          challengeRating: d.challengeRating,
          hasLegendaryActions: d.hasLegendaryActions,
        };
      });

      // Calculate pack distribution for summary
      const packResults = new Map();
      results.forEach(creature => {
        const count = packResults.get(creature.packLabel) || 0;
        packResults.set(creature.packLabel, count + 1);
      });

      // Get unique pack information
      const uniquePacks = Array.from(new Set(enhancedCreatures.map(c => c.pack)));
      const topPacks = uniquePacks.slice(0, 5).map(packId => {
        const sampleCreature = enhancedCreatures.find(c => c.pack === packId);
        return {
          id: packId,
          label: sampleCreature?.packLabel || 'Unknown Pack',
          priority: 100, // All packs are prioritized equally in enhanced index
        };
      });

      if (packResults.size > 0) {
      }

      return {
        creatures: results,
        searchSummary: {
          packsSearched: uniquePacks.length,
          topPacks,
          totalCreaturesFound: results.length,
          resultsByPack: Object.fromEntries(packResults),
          criteria,
          indexMetadata: {
            totalIndexedCreatures: enhancedCreatures.length,
            searchMethod: 'enhanced_persistent_index',
          },
        },
      };
    } catch (error) {
      console.error(`[${this.moduleId}] Enhanced creature search failed:`, error);
      // Fallback to basic search if enhanced index fails. This reports rather
      // than degrades when the index is mid-rebuild or the criteria can't be
      // expressed as a name search.
      return this.fallbackBasicCreatureSearch(criteria, limit, 'failed');
    }
  }

  /**
   * Check if enhanced creature passes all specified criteria (system-aware routing).
   *
   * Discriminator order matters: cosmere-rpg has a `tier` field, pf2e has
   * `level`, dnd5e has `challengeRating`. Check cosmere first (tier is the
   * narrowest signal), then pf2e, then fall through to dnd5e.
   */
  private passesEnhancedCriteria(creature: EnhancedCreatureIndex, criteria: any): boolean {
    if ('hits' in creature && 'hasPsionics' in creature) {
      return this.passesMGT2eCriteria(creature as MGT2eCreatureIndex, criteria);
    }
    if ('tier' in creature) {
      return this.passesCosmereRpgCriteria(creature, criteria);
    }
    if ('level' in creature) {
      return this.passesPF2eCriteria(creature, criteria);
    }
    return this.passesDnD5eCriteria(creature, criteria);
  }

  /**
   * MGT2e criteria filter — minHits/maxHits, hasPsionics, creatureType, actorType.
   */
  private passesMGT2eCriteria(creature: MGT2eCreatureIndex, criteria: any): boolean {
    if (criteria.minHits !== undefined && creature.hits < criteria.minHits) return false;
    if (criteria.maxHits !== undefined && creature.hits > criteria.maxHits) return false;
    if (criteria.hasPsionics !== undefined && creature.hasPsionics !== criteria.hasPsionics)
      return false;
    if (criteria.creatureType && creature.creatureType !== criteria.creatureType) return false;
    if (criteria.actorType && creature.type !== criteria.actorType) return false;
    return true;
  }

  /**
   * Cosmere RPG criteria filter — tier, role, creatureType, size,
   * hasInvestiture, hitPoints range, defenses minimums, deflect minimum.
   */
  private passesCosmereRpgCriteria(
    creature: CosmereRpgCreatureIndex,
    criteria: {
      tier?: number | { min?: number; max?: number };
      role?: string;
      creatureType?: string;
      size?: string;
      hasInvestiture?: boolean;
      hitPoints?: number | { min?: number; max?: number };
      health?: number | { min?: number; max?: number };
      defensesMin?: { phy?: number; cog?: number; spi?: number };
      deflectMin?: number;
    }
  ): boolean {
    if (criteria.tier !== undefined) {
      if (typeof criteria.tier === 'number') {
        if (creature.tier !== criteria.tier) return false;
      } else {
        const { min, max } = criteria.tier;
        if (min !== undefined && creature.tier < min) return false;
        if (max !== undefined && creature.tier > max) return false;
      }
    }

    if (criteria.role && creature.role.toLowerCase() !== criteria.role.toLowerCase()) {
      return false;
    }

    if (
      criteria.creatureType &&
      creature.creatureType.toLowerCase() !== criteria.creatureType.toLowerCase()
    ) {
      return false;
    }

    if (criteria.size && creature.size.toLowerCase() !== criteria.size.toLowerCase()) {
      return false;
    }

    if (
      criteria.hasInvestiture !== undefined &&
      creature.hasInvestiture !== criteria.hasInvestiture
    ) {
      return false;
    }

    // Accept either `hitPoints` or `health` from callers — they're synonyms
    // here (hitPoints is the cross-system convention; health is the cosmere-
    // native term).
    const hpRange = criteria.hitPoints ?? criteria.health;
    if (hpRange !== undefined) {
      if (typeof hpRange === 'number') {
        if (creature.hitPoints !== hpRange) return false;
      } else {
        const { min, max } = hpRange;
        if (min !== undefined && creature.hitPoints < min) return false;
        if (max !== undefined && creature.hitPoints > max) return false;
      }
    }

    if (criteria.defensesMin) {
      const { phy, cog, spi } = criteria.defensesMin;
      if (phy !== undefined && creature.defensePhysical < phy) return false;
      if (cog !== undefined && creature.defenseCognitive < cog) return false;
      if (spi !== undefined && creature.defenseSpiritual < spi) return false;
    }

    if (criteria.deflectMin !== undefined && creature.deflect < criteria.deflectMin) {
      return false;
    }

    return true;
  }

  /**
   * Check if D&D 5e creature passes all specified criteria
   */
  private passesDnD5eCriteria(
    creature: DnD5eCreatureIndex,
    criteria: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      hasSpells?: boolean;
      hasLegendaryActions?: boolean;
    }
  ): boolean {
    // Challenge Rating filter
    if (criteria.challengeRating !== undefined) {
      if (typeof criteria.challengeRating === 'number') {
        if (creature.challengeRating !== criteria.challengeRating) {
          return false;
        }
      } else if (typeof criteria.challengeRating === 'object') {
        const { min, max } = criteria.challengeRating;
        if (min !== undefined && creature.challengeRating < min) {
          return false;
        }
        if (max !== undefined && creature.challengeRating > max) {
          return false;
        }
      }
    }

    // Creature Type filter
    if (criteria.creatureType) {
      if (creature.creatureType.toLowerCase() !== criteria.creatureType.toLowerCase()) {
        return false;
      }
    }

    // Size filter
    if (criteria.size) {
      if (creature.size.toLowerCase() !== criteria.size.toLowerCase()) {
        return false;
      }
    }

    // Spellcaster filter
    if (criteria.hasSpells !== undefined) {
      if (creature.hasSpells !== criteria.hasSpells) {
        return false;
      }
    }

    // Legendary Actions filter
    if (criteria.hasLegendaryActions !== undefined) {
      if (creature.hasLegendaryActions !== criteria.hasLegendaryActions) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if PF2e creature passes all specified criteria
   */
  private passesPF2eCriteria(
    creature: PF2eCreatureIndex,
    criteria: {
      level?: number | { min?: number; max?: number };
      traits?: string[];
      rarity?: string;
      creatureType?: string;
      size?: string;
      hasSpells?: boolean;
    }
  ): boolean {
    // Level filter
    if (criteria.level !== undefined) {
      if (typeof criteria.level === 'number') {
        if (creature.level !== criteria.level) {
          return false;
        }
      } else if (typeof criteria.level === 'object') {
        const { min = -1, max = 25 } = criteria.level;
        if (creature.level < min || creature.level > max) {
          return false;
        }
      }
    }

    // Traits filter (creature must have ALL specified traits)
    if (criteria.traits && criteria.traits.length > 0) {
      const hasAllTraits = criteria.traits.every(requiredTrait =>
        creature.traits.some(t => t.toLowerCase() === requiredTrait.toLowerCase())
      );
      if (!hasAllTraits) {
        return false;
      }
    }

    // Rarity filter
    if (criteria.rarity && creature.rarity !== criteria.rarity) {
      return false;
    }

    // Creature type filter
    if (
      criteria.creatureType &&
      creature.creatureType.toLowerCase() !== criteria.creatureType.toLowerCase()
    ) {
      return false;
    }

    // Size filter
    if (criteria.size && creature.size.toLowerCase() !== criteria.size.toLowerCase()) {
      return false;
    }

    // Spellcasting filter
    if (criteria.hasSpells !== undefined && creature.hasSpells !== criteria.hasSpells) {
      return false;
    }

    return true;
  }

  /**
   * Names of Actor compendium packs whose index Foundry hasn't finished building.
   *
   * `pack.indexed` is Foundry's own "has this pack been fully indexed?" flag.
   * While packs are still indexing, creature searches return badly degraded
   * results, so it's worth telling the caller to retry rather than handing them
   * junk that looks authoritative.
   */
  private getUnindexedCreaturePacks(): string[] {
    try {
      const packs = [...((game as any).packs ?? [])];
      return packs
        .filter((p: any) => p?.documentName === 'Actor' && p?.indexed === false)
        .map((p: any) => p.metadata?.label ?? p.collection ?? 'unknown');
    } catch {
      return [];
    }
  }

  /**
   * Fallback creature search, used when the enhanced index is disabled or fails.
   *
   * This path can only do name-substring matching, so it genuinely cannot serve
   * criteria like "level 3" or "has spells". It used to paper over that by
   * searching for the literal word "monster" whenever it had no usable terms,
   * which returned creatures with "Monster" in the name and presented them as a
   * successful filtered result. Now it refuses instead of inventing a query, and
   * it distinguishes "index still building — retry" from "this filter is
   * unsupported here", so callers get an actionable reason rather than garbage.
   */
  private async fallbackBasicCreatureSearch(
    criteria: any,
    limit: number,
    reason: 'disabled' | 'failed' = 'failed'
  ): Promise<{ creatures: any[]; searchSummary: any }> {
    // A rebuild in progress is the most common cause of an enhanced-index
    // failure, and the only one the caller can fix by simply waiting.
    const unindexed = this.getUnindexedCreaturePacks();
    if (reason === 'failed' && unindexed.length > 0) {
      throw new Error(
        `Foundry is still building its compendium index (${unindexed.length} Actor pack(s) ` +
          `not yet indexed: ${unindexed.slice(0, 5).join(', ')}${unindexed.length > 5 ? ', …' : ''}). ` +
          `Creature search results would be incomplete and misleading right now — wait for indexing ` +
          `to finish and retry.`
      );
    }

    console.warn(
      `[${this.moduleId}] Falling back to basic creature search (reason: ${reason})`,
      criteria
    );

    // Basic search is name-matching only; build terms from the criteria that can
    // actually be expressed as a name.
    const searchTerms: string[] = [];

    if (criteria.creatureType) {
      searchTerms.push(criteria.creatureType);
    }

    if (criteria.challengeRating) {
      if (typeof criteria.challengeRating === 'number') {
        // Add CR-based name patterns as fallback
        if (criteria.challengeRating >= 15) searchTerms.push('ancient', 'legendary');
        else if (criteria.challengeRating >= 10) searchTerms.push('adult', 'champion');
        else if (criteria.challengeRating >= 5) searchTerms.push('captain', 'knight');
      }
    }

    if (searchTerms.length === 0) {
      const applied = Object.keys(criteria ?? {}).filter(
        k => k !== 'limit' && (criteria as any)[k] !== undefined
      );
      throw new Error(
        `The enhanced creature index is ${reason === 'disabled' ? 'disabled' : 'unavailable'}, and ` +
          `the basic fallback can only match creature names — it cannot filter by ` +
          `${applied.length > 0 ? applied.join(', ') : 'the given criteria'}. ` +
          (reason === 'disabled'
            ? `Enable "enableEnhancedCreatureIndex" in the module settings, or `
            : `Retry once Foundry has finished indexing, or `) +
          `use search-compendium with a name instead. (Previously this returned creatures ` +
          `matching the literal word "monster", which looked like a real result.)`
      );
    }

    const searchQuery = searchTerms.join(' ');
    const basicResults = await this.searchCompendium(searchQuery, 'Actor');

    return {
      creatures: basicResults.slice(0, limit),
      searchSummary: {
        packsSearched: 0,
        topPacks: [],
        totalCreaturesFound: basicResults.length,
        resultsByPack: {},
        criteria,
        fallback: true,
        searchMethod: 'basic_fallback',
        fallbackReason: reason,
        warning:
          `Degraded result: matched only the name(s) "${searchQuery}". The requested criteria ` +
          `were NOT applied. Do not treat this as a filtered creature list.`,
      },
    };
  }

  /**
   * Prioritize compendium packs by likelihood of containing relevant creatures
   * @unused - Replaced by enhanced persistent index system
   */
  // @ts-ignore - Unused method kept for compatibility
  private prioritizePacksForCreatures(packs: any[]): any[] {
    const priorityOrder = [
      // Tier 1: Core D&D 5e content (highest priority)
      { pattern: /^dnd5e\.monsters/, priority: 100 }, // Core D&D 5e monsters
      { pattern: /^dnd5e\.actors/, priority: 95 }, // Core D&D 5e actors
      { pattern: /ddb.*monsters/i, priority: 90 }, // D&D Beyond monsters

      // Tier 2: Official modules and supplements
      { pattern: /^world\..*ddb.*monsters/i, priority: 85 }, // World-specific DDB monsters
      { pattern: /monsters/i, priority: 80 }, // Any pack with "monsters"

      // Tier 3: Campaign and adventure content
      { pattern: /^world\.(?!.*summon|.*hero)/i, priority: 70 }, // World packs (not summons/heroes)

      // Tier 4: Specialized content
      { pattern: /summon|familiar/i, priority: 40 }, // Summons and familiars

      // Tier 5: Unlikely to contain monsters (lowest priority)
      { pattern: /hero|player|pc/i, priority: 10 }, // Player characters
    ];

    return packs.sort((a, b) => {
      const aScore = this.getPackPriority(a.metadata.id, a.metadata.label, priorityOrder);
      const bScore = this.getPackPriority(b.metadata.id, b.metadata.label, priorityOrder);

      if (aScore !== bScore) {
        return bScore - aScore; // Higher score first
      }

      // Secondary sort by pack label alphabetically
      return a.metadata.label.localeCompare(b.metadata.label);
    });
  }

  /**
   * Get priority score for a pack based on ID and label
   */
  private getPackPriority(
    packId: string,
    packLabel: string,
    priorityOrder: { pattern: RegExp; priority: number }[]
  ): number {
    for (const rule of priorityOrder) {
      if (rule.pattern.test(packId) || rule.pattern.test(packLabel)) {
        return rule.priority;
      }
    }
    // Default priority for unmatched packs
    return 50;
  }

  /**
   * Check if creature entry passes the given criteria
   * @unused - Legacy method replaced by passesEnhancedCriteria
   */
  // @ts-ignore - Legacy method kept for compatibility
  private passesCriteria(
    entry: any,
    criteria: {
      challengeRating?: number | { min?: number; max?: number };
      creatureType?: string;
      size?: string;
      hasSpells?: boolean;
      hasLegendaryActions?: boolean;
    }
  ): boolean {
    const system = entry.system || {};

    // Challenge Rating filter - enhanced extraction
    if (criteria.challengeRating !== undefined) {
      // Try multiple possible CR locations in D&D 5e data structure
      let entryCR =
        system.details?.cr?.value || system.details?.cr || system.cr?.value || system.cr || 0;

      // Handle fractional CRs (common in D&D 5e)
      if (typeof entryCR === 'string') {
        if (entryCR === '1/8') entryCR = 0.125;
        else if (entryCR === '1/4') entryCR = 0.25;
        else if (entryCR === '1/2') entryCR = 0.5;
        else entryCR = parseFloat(entryCR) || 0;
      }

      if (typeof criteria.challengeRating === 'number') {
        if (entryCR !== criteria.challengeRating) {
          return false;
        }
      } else if (typeof criteria.challengeRating === 'object') {
        const { min = 0, max = 30 } = criteria.challengeRating;
        if (entryCR < min || entryCR > max) {
          return false;
        }
      }
    }

    // Creature Type filter - enhanced extraction
    if (criteria.creatureType) {
      // Try multiple possible type locations in D&D 5e data structure
      const entryType =
        system.details?.type?.value ||
        system.details?.type ||
        system.type?.value ||
        system.type ||
        '';
      if (entryType.toLowerCase() !== criteria.creatureType.toLowerCase()) {
        return false;
      }
    }

    // Size filter
    if (criteria.size) {
      const entrySize = system.traits?.size || system.size || '';
      if (entrySize.toLowerCase() !== criteria.size.toLowerCase()) return false;
    }

    // Spellcaster filter
    if (criteria.hasSpells !== undefined) {
      const isSpellcaster = !!(
        system.spells ||
        system.attributes?.spellcasting ||
        (system.details?.spellLevel && system.details.spellLevel > 0)
      );
      if (isSpellcaster !== criteria.hasSpells) return false;
    }

    // Legendary Actions filter
    if (criteria.hasLegendaryActions !== undefined) {
      const hasLegendary = !!(
        system.resources?.legact ||
        system.legendary ||
        (system.resources?.legres && system.resources.legres.value > 0)
      );
      if (hasLegendary !== criteria.hasLegendaryActions) return false;
    }

    return true;
  }

  /**
   * Simple name/description-based matching for creatures using index data only
   */
  private matchesSearchCriteria(
    entry: any,
    criteria: {
      searchTerms?: string[];
      excludeTerms?: string[];
      size?: string;
      hasSpells?: boolean;
      hasLegendaryActions?: boolean;
    }
  ): boolean {
    const name = (entry.name || '').toLowerCase();
    const description = (entry.description || '').toLowerCase();
    const searchText = `${name} ${description}`;

    // Include terms - at least one must match
    if (criteria.searchTerms && criteria.searchTerms.length > 0) {
      const hasMatch = criteria.searchTerms.some(term => searchText.includes(term.toLowerCase()));
      if (!hasMatch) {
        return false;
      }
    }

    // Exclude terms - none should match
    if (criteria.excludeTerms && criteria.excludeTerms.length > 0) {
      const hasExcluded = criteria.excludeTerms.some(term =>
        searchText.includes(term.toLowerCase())
      );
      if (hasExcluded) {
        return false;
      }
    }

    return true;
  }

  /**
   * List all actors with basic information
   */
  async listActors(): Promise<Array<{ id: string; name: string; type: string; img?: string }>> {
    return game.actors.map(actor => ({
      id: actor.id || '',
      name: actor.name || '',
      type: actor.type,
      ...(actor.img ? { img: actor.img } : {}),
    }));
  }

  /**
   * Get active scene information
   */
  async getActiveScene(): Promise<SceneInfo> {
    const scene = (game.scenes as any).current;
    if (!scene) {
      throw new Error(ERROR_MESSAGES.SCENE_NOT_FOUND);
    }

    const sceneData: SceneInfo = {
      id: scene.id,
      name: scene.name,
      img: scene.img || undefined,
      // Foundry v14 removed Scene#background; the image now lives on the Scene's first
      // Level document instead (see foundry.documents.Level / LevelData#background).
      background:
        scene._source?.background?.src ||
        (scene as any).levels?.contents?.[0]?.background?.src ||
        undefined,
      width: scene.width,
      height: scene.height,
      padding: scene.padding,
      active: scene.active,
      navigation: scene.navigation,
      tokens: scene.tokens.map((token: any) => ({
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        actorId: token.actorId || undefined,
        img: token.texture?.src || '',
        hidden: token.hidden,
        disposition: this.getTokenDisposition(token.disposition),
      })),
      walls: scene.walls.size,
      lights: scene.lights.size,
      sounds: scene.sounds.size,
      notes: scene.notes.map((note: any) => ({
        id: note.id,
        text: note.text || '',
        x: note.x,
        y: note.y,
      })),
    };

    return sceneData;
  }

  /**
   * Get world information
   */
  async getWorldInfo(): Promise<WorldInfo> {
    // World info doesn't require special permissions as it's basic metadata

    return {
      id: game.world.id,
      title: game.world.title,
      system: game.system.id,
      systemVersion: game.system.version,
      foundryVersion: game.version,
      users: game.users.map(user => ({
        id: user.id || '',
        name: user.name || '',
        active: user.active,
        isGM: user.isGM,
      })),
    };
  }

  /**
   * Module/system versions, active-module inventory, and recent captured
   * errors/warnings — for developing modules against this bridge (or anything
   * else running in this Foundry tab), not for the bridge's own health.
   *
   * The error buffer is captured by `diagnostics.ts` from the moment this
   * module loaded; it is empty after every world reload, not a persistent log.
   */
  async getModuleDiagnostics(params?: { limit?: number }): Promise<{
    foundryVersion: string;
    system: { id: string; version: string };
    modules: Array<{ id: string; title: string; version: string; active: boolean }>;
    recentErrors: Array<{
      timestamp: string;
      level: string;
      message: string;
      source?: string | undefined;
    }>;
  }> {
    this.validateFoundryState();

    const modules = Array.from((game as any).modules?.values?.() ?? []).map((m: any) => ({
      id: m.id,
      title: m.title ?? m.id,
      version: m.version ?? 'unknown',
      active: !!m.active,
    }));

    return {
      foundryVersion: game.version,
      system: { id: game.system.id, version: game.system.version },
      modules,
      recentErrors: getDiagnosticEntries(params?.limit),
    };
  }

  /**
   * Get available compendium packs
   */
  async getAvailablePacks() {
    return Array.from(game.packs.values()).map(pack => ({
      id: pack.metadata.id,
      label: pack.metadata.label,
      type: pack.metadata.type,
      system: pack.metadata.system,
      private: pack.metadata.private,
    }));
  }

  /**
   * Return a compendium pack's index entries as a plain array.
   * `fields` requests extra (dot-notation) fields be included in the index —
   * e.g. ['type', 'system.details.species.value'] — so callers can filter
   * without loading every full document. Mirrors the getIndex({ fields })
   * pattern used elsewhere, with a fallback for older Foundry APIs.
   */
  async getPackIndex(packId: string, fields?: string[]): Promise<any[]> {
    const pack = game.packs.get(packId);
    if (!pack) {
      throw new Error(`Compendium pack not found: ${packId}`);
    }

    let packIndex: any;
    try {
      packIndex = await (pack as any).getIndex(
        fields && fields.length > 0 ? { fields } : undefined
      );
    } catch {
      // Fallback: older Foundry API without the fields option
      packIndex = await (pack as any).getIndex();
    }

    const source =
      packIndex && typeof packIndex.values === 'function' ? packIndex : (pack as any).index;
    return Array.from((source as any).values()).map((entry: any) => this.sanitizeData(entry));
  }

  /**
   * Sanitize data to remove sensitive information and make it JSON-safe
   */
  private sanitizeData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data !== 'object') {
      return data;
    }

    try {
      // removeSensitiveFields now returns a sanitized copy
      const sanitized = this.removeSensitiveFields(data);

      // Use custom JSON serializer to avoid deprecated property warnings
      const jsonString = this.safeJSONStringify(sanitized);
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to sanitize data:`, error);
      return {};
    }
  }

  /**
   * Remove sensitive fields from data object with circular reference protection
   * Returns a sanitized copy instead of modifying the original
   */
  private removeSensitiveFields(
    obj: any,
    visited: WeakSet<object> = new WeakSet(),
    depth: number = 0
  ): any {
    // Handle primitives
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    // Safety depth limit to prevent extremely deep recursion
    if (depth > 50) {
      console.warn(`[${this.moduleId}] Sanitization depth limit reached at depth ${depth}`);
      return '[Max depth reached]';
    }

    // Check for circular reference
    if (visited.has(obj)) {
      return '[Circular Reference]';
    }

    // Mark this object as visited
    visited.add(obj);

    try {
      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map(item => this.removeSensitiveFields(item, visited, depth + 1));
      }

      // Create a new sanitized object
      const sanitized: any = {};

      // Use Object.keys (does not invoke getters) so we can filter deprecated
      // accessor properties before reading their values.
      const keys = Object.keys(obj);

      // dnd5e 5.3 moved senses.darkvision/blindsight/tremorsense/truesight to
      // senses.ranges.*. The legacy keys remain as deprecated getters that
      // log a warning when read. Detect this shape and skip the legacy keys.
      const DEPRECATED_DND5E_SENSE_KEYS = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
      const isDnd5eSensesShape =
        keys.includes('ranges') && keys.some(k => DEPRECATED_DND5E_SENSE_KEYS.includes(k));

      for (const key of keys) {
        // Skip sensitive and problematic fields entirely
        if (this.isSensitiveOrProblematicField(key)) {
          continue;
        }

        // Skip most private properties except essential ones.
        // _stats (Foundry document audit metadata) and _source (raw stored data
        // duplicate) are bloat in tool output; we keep only _id.
        if (key.startsWith('_') && key !== '_id') {
          continue;
        }

        if (isDnd5eSensesShape && DEPRECATED_DND5E_SENSE_KEYS.includes(key)) {
          continue;
        }

        // Recursively sanitize the value (read only after filter to avoid getter-triggered warnings)
        sanitized[key] = this.removeSensitiveFields(obj[key], visited, depth + 1);
      }

      return sanitized;
    } catch (error) {
      console.warn(`[${this.moduleId}] Error during sanitization at depth ${depth}:`, error);
      return '[Sanitization failed]';
    }
  }

  /**
   * Check if a field should be excluded from sanitized output
   */
  private isSensitiveOrProblematicField(key: string): boolean {
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'key',
      'auth',
      'credential',
      'session',
      'cookie',
      'private',
    ];

    const problematicKeys = [
      'parent',
      '_parent',
      'collection',
      'apps',
      'document',
      '_document',
      'constructor',
      'prototype',
      '__proto__',
      'valueOf',
      'toString',
      // dnd5e item leveling metadata; full of cycles back to the actor and other items.
      // Not gameplay-relevant for LLM consumers.
      'advancement',
    ];

    // Skip deprecated ability save properties that trigger warnings
    const deprecatedKeys = [
      'save', // Skip the deprecated 'save' property on abilities
    ];

    return (
      sensitiveKeys.includes(key) || problematicKeys.includes(key) || deprecatedKeys.includes(key)
    );
  }

  /**
   * Custom JSON serializer that handles Foundry objects safely
   */
  private safeJSONStringify(obj: any): string {
    try {
      return JSON.stringify(obj, (key, value) => {
        // Skip deprecated properties during JSON serialization
        if (key === 'save' && typeof value === 'object' && value !== null) {
          // If this looks like a deprecated ability save object, skip it
          return undefined;
        }
        return value;
      });
    } catch (error) {
      console.warn(`[${this.moduleId}] JSON stringify failed, using fallback:`, error);
      return '{}';
    }
  }

  /**
   * Get token disposition as number
   */
  private getTokenDisposition(disposition: any): number {
    if (typeof disposition === 'number') {
      return disposition;
    }

    // Default to neutral if unknown
    return TOKEN_DISPOSITIONS.NEUTRAL;
  }

  /**
   * Validate that Foundry is ready and world is active
   */
  validateFoundryState(): void {
    if (!game?.ready) {
      throw new Error('Foundry VTT is not ready');
    }

    if (!game.world) {
      throw new Error('No active world');
    }

    if (!game.user) {
      throw new Error('No active user');
    }
  }

  /**
   * Audit log for write operations
   */
  private auditLog(
    operation: string,
    data: any,
    result: 'success' | 'failure',
    error?: string
  ): void {
    // Always audit write operations (no setting required)
    const logEntry = {
      timestamp: new Date().toISOString(),
      operation,
      user: game.user?.name || 'Unknown',
      userId: game.user?.id || 'unknown',
      world: game.world?.id || 'unknown',
      data: this.sanitizeData(data),
      result,
      error,
    };

    // Store in flags for persistence (optional)
    if (game.world && (game.world as any).setFlag) {
      const auditLogs = (game.world as any).getFlag(this.moduleId, 'auditLogs') || [];
      auditLogs.push(logEntry);

      // Keep only last 100 entries to prevent bloat
      if (auditLogs.length > 100) {
        auditLogs.splice(0, auditLogs.length - 100);
      }

      (game.world as any).setFlag(this.moduleId, 'auditLogs', auditLogs);
    }
  }

  // ===== PHASE 2 & 3: WRITE OPERATIONS =====

  /**
   * Create journal entry for quests, with optional additional pages
   */
  async createJournalEntry(request: {
    name: string;
    content: string;
    folderName?: string;
    additionalPages?: Array<{ name: string; content: string }>;
  }): Promise<{ id: string; name: string; pageCount: number }> {
    this.validateFoundryState();

    // Use permission system for journal creation
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: 1, // Treat journal creation similar to actor creation for permissions
    });

    if (!permissionCheck.allowed) {
      throw new Error(`Journal creation denied: ${permissionCheck.reason}`);
    }

    try {
      // Build pages array: main page + any additional pages
      const pages: Array<{ type: string; name: string; text: { content: string } }> = [
        {
          type: 'text',
          name: 'Quest Details',
          text: {
            content: request.content,
          },
        },
      ];

      if (request.additionalPages) {
        for (const page of request.additionalPages) {
          pages.push({
            type: 'text',
            name: page.name,
            text: {
              content: page.content,
            },
          });
        }
      }

      // Create journal entry with proper Foundry v13 structure
      const journalData = {
        name: request.name,
        pages,
        ownership: { default: 0 }, // GM only by default
        folder: await this.getOrCreateFolder(request.folderName || request.name, 'JournalEntry'),
      };

      const journal = await JournalEntry.create(journalData);

      if (!journal) {
        throw new Error('Failed to create journal entry');
      }

      const result = {
        id: journal.id,
        name: journal.name || request.name,
        pageCount: pages.length,
      };

      this.auditLog('createJournalEntry', request, 'success');
      return result;
    } catch (error) {
      this.auditLog(
        'createJournalEntry',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * List all journal entries with page metadata
   */
  async listJournals(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      pageCount: number;
      pages: Array<{ id: string; name: string; type: string }>;
    }>
  > {
    this.validateFoundryState();

    return game.journal.map((journal: any) => ({
      id: journal.id || '',
      name: journal.name || '',
      type: 'JournalEntry',
      pageCount: journal.pages?.size || 0,
      pages:
        journal.pages?.map((page: any) => ({
          id: page.id || '',
          name: page.name || '',
          type: page.type || 'text',
        })) || [],
    }));
  }

  /**
   * Delete whole JournalEntry documents, or individual pages inside one.
   *
   * Both were previously impossible via any tool, which mattered most for
   * `createQuestJournal`: it always injects an "Adventure Hook / Quest
   * Objectives" boilerplate page that nothing could subsequently remove.
   *
   * As with deleteWorldItems, every id is validated before anything is deleted
   * so a bad id fails the whole call rather than silently deleting the subset
   * that happened to resolve.
   */
  async manageJournals(params: {
    action: 'delete' | 'delete-page';
    ids?: string[];
    journalId?: string;
    pageIds?: string[];
  }): Promise<{
    action: string;
    deleted: Array<{ id: string; name: string }>;
    total: number;
    journal?: { id: string; name: string; remainingPages: number };
  }> {
    this.validateFoundryState();

    const { action } = params;

    if (action === 'delete') {
      const ids = params.ids ?? [];
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('action "delete" requires an "ids" array of JournalEntry ids');
      }

      const resolved: Array<{ id: string; name: string }> = [];
      const missing: string[] = [];
      for (const id of ids) {
        const journal = (game as any).journal?.get(id);
        if (!journal) {
          missing.push(id);
          continue;
        }
        resolved.push({ id: journal.id, name: journal.name });
      }
      if (missing.length > 0) {
        throw new Error(
          `Journal(s) not found: ${missing.join(', ')}. Nothing was deleted. ` +
            `Use list-journals to get valid ids.`
        );
      }

      try {
        await (JournalEntry as any).deleteDocuments(resolved.map(r => r.id));
        const survivors = resolved.filter(r => (game as any).journal?.get(r.id));
        if (survivors.length > 0) {
          throw new Error(
            `Foundry reported success but these journals still exist: ${survivors
              .map(s => `${s.name} (${s.id})`)
              .join(', ')}`
          );
        }
        this.auditLog('manageJournals.delete', { count: resolved.length }, 'success');
        return { action, deleted: resolved, total: resolved.length };
      } catch (error) {
        this.auditLog(
          'manageJournals.delete',
          { count: resolved.length },
          'failure',
          error instanceof Error ? error.message : 'Unknown error'
        );
        throw error;
      }
    }

    // ── delete-page ──────────────────────────────────────────────────────────
    const journalRef = (params.journalId ?? '').trim();
    if (!journalRef) {
      throw new Error(
        'action "delete-page" requires "journalId" (the journal containing the page)'
      );
    }
    const pageIds = params.pageIds ?? [];
    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      throw new Error('action "delete-page" requires a "pageIds" array');
    }

    const journal =
      (game as any).journal?.get(journalRef) ??
      (game as any).journal?.find?.((j: any) => j.name?.toLowerCase() === journalRef.toLowerCase());
    if (!journal) throw new Error(`Journal not found: ${journalRef}`);

    const resolvedPages: Array<{ id: string; name: string }> = [];
    const missingPages: string[] = [];
    for (const pid of pageIds) {
      const page = journal.pages?.get(pid);
      if (!page) {
        missingPages.push(pid);
        continue;
      }
      resolvedPages.push({ id: page.id, name: page.name });
    }
    if (missingPages.length > 0) {
      throw new Error(
        `Page(s) not found in journal "${journal.name}": ${missingPages.join(', ')}. ` +
          `Nothing was deleted. Use list-journals to see each journal's page ids.`
      );
    }

    try {
      await journal.deleteEmbeddedDocuments(
        'JournalEntryPage',
        resolvedPages.map(p => p.id)
      );
      const survivors = resolvedPages.filter(p => journal.pages?.get(p.id));
      if (survivors.length > 0) {
        throw new Error(
          `Foundry reported success but these pages still exist: ${survivors
            .map(s => `${s.name} (${s.id})`)
            .join(', ')}`
        );
      }
      this.auditLog(
        'manageJournals.delete-page',
        { journalId: journal.id, count: resolvedPages.length },
        'success'
      );
      return {
        action,
        deleted: resolvedPages,
        total: resolvedPages.length,
        journal: {
          id: journal.id,
          name: journal.name,
          remainingPages: journal.pages?.size ?? 0,
        },
      };
    } catch (error) {
      this.auditLog(
        'manageJournals.delete-page',
        { journalId: journal.id, count: resolvedPages.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Get journal entry content (first text page + page manifest)
   */
  async getJournalContent(journalId: string): Promise<{
    content: string;
    currentPage?: { id: string; name: string } | undefined;
    allPages: Array<{ id: string; name: string; type: string }>;
    pageCount: number;
    note?: string | undefined;
  } | null> {
    this.validateFoundryState();

    const journal = game.journal.get(journalId);
    if (!journal) {
      return null;
    }

    const allPages =
      journal.pages?.map((page: any) => ({
        id: page.id || '',
        name: page.name || '',
        type: page.type || 'text',
      })) || [];
    const pageCount = allPages.length;

    // Get first text page content
    const firstPage = journal.pages.find((page: any) => page.type === 'text');
    if (!firstPage) {
      return { content: '', allPages, pageCount };
    }

    return {
      content: firstPage.text?.content || '',
      currentPage: { id: firstPage.id || '', name: firstPage.name || '' },
      allPages,
      pageCount,
      note:
        pageCount > 1
          ? `This journal has ${pageCount} pages. Use list-journals with journalId and pageId to read other pages: ${allPages.map((p: any) => `"${p.name}" (${p.id})`).join(', ')}`
          : undefined,
    };
  }

  /**
   * Get a specific journal page's content by ID
   */
  async getJournalPageContent(
    journalId: string,
    pageId: string
  ): Promise<{ id: string; name: string; type: string; content: string } | null> {
    this.validateFoundryState();

    const journal = game.journal.get(journalId);
    if (!journal) {
      return null;
    }

    const page = journal.pages.get(pageId);
    if (!page) {
      return null;
    }

    return {
      id: page.id || '',
      name: page.name || '',
      type: page.type || 'text',
      content: page.type === 'text' ? page.text?.content || '' : page.src || '',
    };
  }

  /**
   * Update journal entry content
   * - No pageId/newPageName: update first text page (backward compat)
   * - With pageId: update that specific page
   * - With newPageName (no pageId): create a new page
   */
  async updateJournalContent(request: {
    journalId: string;
    content: string;
    pageId?: string | undefined;
    newPageName?: string | undefined;
  }): Promise<{ success: boolean; pageId?: string | undefined; pageName?: string | undefined }> {
    this.validateFoundryState();

    // Use permission system for journal updates - treating as createActor permission level
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: 1, // Treat journal updates similar to actor creation for permissions
    });

    if (!permissionCheck.allowed) {
      throw new Error(`Journal update denied: ${permissionCheck.reason}`);
    }

    try {
      const journal = game.journal.get(request.journalId);
      if (!journal) {
        throw new Error('Journal entry not found');
      }

      // Mode 1: Create a new page
      if (request.newPageName) {
        const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
          {
            type: 'text',
            name: request.newPageName,
            text: {
              content: request.content,
            },
          },
        ]);
        const newPage = created?.[0];
        this.auditLog('updateJournalContent', request, 'success');
        return { success: true, pageId: newPage?.id || '', pageName: request.newPageName };
      }

      // Mode 2: Update a specific page by ID
      if (request.pageId) {
        const page = journal.pages.get(request.pageId);
        if (!page) {
          throw new Error(`Page not found: ${request.pageId}`);
        }
        await page.update({
          'text.content': request.content,
        });
        this.auditLog('updateJournalContent', request, 'success');
        return { success: true, pageId: page.id, pageName: page.name };
      }

      // Mode 3: Update first text page or create one if none exists (backward compat)
      const firstPage = journal.pages.find((page: any) => page.type === 'text');

      if (firstPage) {
        // Update existing page
        await firstPage.update({
          'text.content': request.content,
        });
        this.auditLog('updateJournalContent', request, 'success');
        return { success: true, pageId: firstPage.id, pageName: firstPage.name };
      } else {
        // Create new text page
        const created = await journal.createEmbeddedDocuments('JournalEntryPage', [
          {
            type: 'text',
            name: 'Quest Details',
            text: {
              content: request.content,
            },
          },
        ]);
        const newPage = created?.[0];
        this.auditLog('updateJournalContent', request, 'success');
        return { success: true, pageId: newPage?.id || '', pageName: 'Quest Details' };
      }
    } catch (error) {
      this.auditLog(
        'updateJournalContent',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Create actors from compendium entries with custom names
   */
  async createActorFromCompendium(request: ActorCreationRequest): Promise<ActorCreationResult> {
    this.validateFoundryState();

    // Use new permission system
    const permissionCheck = permissionManager.checkWritePermission('createActor', {
      quantity: request.quantity || 1,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    // Audit the permission check
    permissionManager.auditPermissionCheck('createActor', permissionCheck, request);

    const maxActors = game.settings.get(this.moduleId, 'maxActorsPerRequest') as number;
    const quantity = Math.min(request.quantity || 1, maxActors);

    // Start transaction for rollback capability
    const transactionId = transactionManager.startTransaction(
      `Create ${quantity} actor(s) from compendium: ${request.creatureType}`
    );

    try {
      // Find matching compendium entry
      const compendiumEntry = await this.findBestCompendiumMatch(
        request.creatureType,
        request.packPreference
      );
      if (!compendiumEntry) {
        throw new Error(`No compendium entry found for "${request.creatureType}"`);
      }

      // Get full compendium document
      const sourceDoc = await this.getCompendiumDocumentFull(
        compendiumEntry.pack,
        compendiumEntry.id
      );

      const createdActors: CreatedActorInfo[] = [];
      const errors: string[] = [];

      // Create actors with custom names
      for (let i = 0; i < quantity; i++) {
        try {
          const customName =
            request.customNames?.[i] ||
            (quantity > 1 ? `${sourceDoc.name} ${i + 1}` : sourceDoc.name);

          const newActor = await this.createActorFromSource(sourceDoc, customName);

          // Track actor creation for rollback
          transactionManager.addAction(
            transactionId,
            transactionManager.createActorCreationAction(newActor.id)
          );

          createdActors.push({
            id: newActor.id,
            name: newActor.name,
            originalName: sourceDoc.name,
            type: newActor.type,
            sourcePackId: compendiumEntry.pack,
            sourcePackLabel: compendiumEntry.packLabel,
            img: newActor.img,
          });
        } catch (error) {
          errors.push(
            `Failed to create actor ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      let tokensPlaced = 0;

      // Add to scene if requested and permission allows
      if (request.addToScene && createdActors.length > 0) {
        try {
          const scenePermissionCheck = permissionManager.checkWritePermission('modifyScene', {
            targetIds: createdActors.map(a => a.id),
          });

          if (!scenePermissionCheck.allowed) {
            errors.push(`Cannot add to scene: ${scenePermissionCheck.reason}`);
          } else {
            const tokenResult = await this.addActorsToScene(
              {
                actorIds: createdActors.map(a => a.id),
                placement: 'random',
                hidden: false,
              },
              transactionId
            );
            tokensPlaced = tokenResult.tokensCreated;
          }
        } catch (error) {
          errors.push(
            `Failed to add actors to scene: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      // If we had partial failure, decide whether to rollback
      if (errors.length > 0 && createdActors.length < quantity) {
        // Rollback if we failed to create more than half the requested actors
        if (createdActors.length < quantity / 2) {
          console.warn(
            `[${this.moduleId}] Rolling back due to significant failures (${createdActors.length}/${quantity} created)`
          );
          await transactionManager.rollbackTransaction(transactionId);
          throw new Error(`Actor creation failed: ${errors.join(', ')}`);
        }
      }

      // Commit transaction
      transactionManager.commitTransaction(transactionId);

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        actors: createdActors,
        ...(errors.length > 0 ? { errors } : {}),
        tokensPlaced,
        totalRequested: quantity,
        totalCreated: createdActors.length,
      };

      this.auditLog('createActorFromCompendium', request, 'success');
      return result;
    } catch (error) {
      // Rollback on complete failure
      try {
        await transactionManager.rollbackTransaction(transactionId);
      } catch (rollbackError) {
        console.error(`[${this.moduleId}] Failed to rollback transaction:`, rollbackError);
      }

      this.auditLog(
        'createActorFromCompendium',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Create actor from specific compendium entry using pack/item IDs
   */
  async createActorFromCompendiumEntry(request: {
    packId: string;
    itemId: string;
    customNames: string[];
    quantity?: number;
    addToScene?: boolean;
    placement?: {
      type: 'random' | 'grid' | 'center' | 'coordinates';
      coordinates?: { x: number; y: number }[];
    };
  }): Promise<ActorCreationResult> {
    this.validateFoundryState();

    try {
      const { packId, itemId, customNames, quantity = 1, addToScene = false, placement } = request;

      // Validate inputs
      if (!packId || !itemId) {
        throw new Error('Both packId and itemId are required');
      }

      // Get the pack
      const pack = game.packs.get(packId);
      if (!pack) {
        throw new Error(`Compendium pack "${packId}" not found`);
      }

      // Get the specific document
      const sourceDocument = await pack.getDocument(itemId);
      if (!sourceDocument) {
        throw new Error(`Document "${itemId}" not found in pack "${packId}"`);
      }

      // Validate that the document is an Actor (supports character, npc, creature, etc.)
      if (sourceDocument.documentName !== 'Actor') {
        throw new Error(
          `Document "${itemId}" is not an Actor (documentName: ${sourceDocument.documentName}, type: ${sourceDocument.type})`
        );
      }

      // Validate actor type - support all common actor types including DSA5 creatures
      // and Cosmere RPG adversaries.
      const validActorTypes = ['character', 'npc', 'creature', 'adversary'];
      if (!validActorTypes.includes(sourceDocument.type)) {
        throw new Error(
          `Document "${itemId}" has unsupported actor type: ${sourceDocument.type}. Supported types: ${validActorTypes.join(', ')}`
        );
      }

      const sourceActor = sourceDocument as Actor;

      // Prepare custom names
      const names = customNames.length > 0 ? customNames : [`${sourceActor.name} Copy`];
      const finalQuantity = Math.min(quantity, names.length);

      const createdActors: any[] = [];
      const errors: string[] = [];

      // Create actors
      for (let i = 0; i < finalQuantity; i++) {
        try {
          const customName = names[i] || `${sourceActor.name} ${i + 1}`;

          // Create actor data with full system, items, and effects
          const sourceData = sourceActor.toObject() as any;
          const actorData = {
            name: customName,
            type: sourceData.type,
            img: sourceData.img,
            system: sourceData.system || sourceData.data || {},
            items: sourceData.items || [],
            effects: sourceData.effects || [],
            folder: null, // Don't inherit folder
            prototypeToken: sourceData.prototypeToken, // Include prototype token
          };

          // Fix remote image URLs - normalize to local paths
          if (actorData.prototypeToken?.texture?.src?.startsWith('http')) {
            actorData.prototypeToken.texture.src = null; // Clear remote URL
          }

          // Organize created actors in a folder - use "Foundry MCP Creatures" for generic monsters
          const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
          if (folderId) {
            (actorData as any).folder = folderId;
          }

          // Create the actor
          const newActor = await Actor.create(actorData);
          if (!newActor) {
            throw new Error(`Failed to create actor "${customName}"`);
          }

          createdActors.push({
            id: newActor.id,
            name: newActor.name,
            originalName: sourceActor.name,
            sourcePackLabel: pack.metadata.label,
          });
        } catch (error) {
          const errorMsg = `Failed to create actor ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`;
          errors.push(errorMsg);
          console.error(`[${MODULE_ID}] ${errorMsg}`, error);
        }
      }

      // Add to scene if requested
      let tokensPlaced = 0;
      if (addToScene && createdActors.length > 0) {
        try {
          const sceneResult = await this.addActorsToScene({
            actorIds: createdActors.map(a => a.id),
            placement: placement?.type || 'grid',
            hidden: false,
            ...(placement?.coordinates && { coordinates: placement.coordinates }),
          });
          tokensPlaced = sceneResult.success ? sceneResult.tokensCreated : 0;
        } catch (error) {
          errors.push(
            `Failed to add actors to scene: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      const result: ActorCreationResult = {
        success: createdActors.length > 0,
        totalCreated: createdActors.length,
        totalRequested: finalQuantity,
        actors: createdActors,
        tokensPlaced,
        errors: errors.length > 0 ? errors : undefined,
      };

      this.auditLog('createActorFromCompendiumEntry', request, 'success');
      return result;
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create actor from compendium entry`, error);
      this.auditLog(
        'createActorFromCompendiumEntry',
        request,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Add one or more freshly-authored Item documents to an existing Actor.
   *
   * Unlike `createActorFromCompendium*`, the items here are constructed from
   * caller-supplied data — no compendium lookup. This is the path used to
   * push planner-authored content (talents, actions, powers, custom gear)
   * onto a PC or NPC sheet.
   *
   * Validation is intentionally light: name + type are required, and the
   * type is checked against the active system's declared Item document
   * types when available. Everything else (system schema validation,
   * required sub-fields) is delegated to Foundry's DataModel layer, which
   * will fill defaults or throw a meaningful error.
   */
  async addActorItems(params: {
    actorIdentifier: string;
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
  }): Promise<{
    actorId: string;
    actorName: string;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    this.validateFoundryState();

    const { actorIdentifier, items } = params;

    if (!actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    const actor = this.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Discover the active system's declared Item types so we can give a
    // useful error before sending the doc to Foundry's DataModel layer.
    const itemDocTypes = (game as any).system?.documentTypes?.Item;
    const validTypes: string[] | null =
      itemDocTypes && typeof itemDocTypes === 'object' ? Object.keys(itemDocTypes) : null;

    const payload = items.map((it, idx) => {
      if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
        throw new Error(`items[${idx}]: "name" is required and must be a non-empty string`);
      }
      if (typeof it.type !== 'string' || it.type.trim().length === 0) {
        throw new Error(`items[${idx}] ("${it.name}"): "type" is required`);
      }
      if (validTypes && !validTypes.includes(it.type)) {
        throw new Error(
          `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${(game.system as any)?.id}". ` +
            `Valid Item types: ${validTypes.join(', ')}`
        );
      }

      const doc: Record<string, any> = { name: it.name, type: it.type };
      if (it.img) doc.img = it.img;
      if (it.system && typeof it.system === 'object') doc.system = it.system;
      return doc;
    });

    let created: any[] = [];
    try {
      created = (await actor.createEmbeddedDocuments('Item', payload)) || [];
      // Hand-authored items (esp. PF2e ancestry/heritage/class/feat) can throw
      // during the actor's re-prep — e.g. an ancestry expects the actor to already
      // have `system.traits`, a feat's language prep dereferences a null ancestry.
      // Detect that and undo the add rather than leave the actor bricked.
      this.assertActorPreparesOrThrow(actor);

      const result = {
        actorId: actor.id,
        actorName: actor.name,
        created: created.map((doc: any) => ({ id: doc.id, name: doc.name, type: doc.type })),
      };
      this.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'success'
      );
      return result;
    } catch (error) {
      const ids = created.map((d: any) => d.id).filter(Boolean);
      if (ids.length) {
        await actor.deleteEmbeddedDocuments('Item', ids).catch(() => undefined);
        try {
          this.assertActorPreparesOrThrow(actor);
        } catch {
          /* actor without the bad items should prepare fine again */
        }
      }
      this.auditLog(
        'addActorItems',
        { actorIdentifier, actorId: actor.id, count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Could not attach the item(s) to "${actor.name}": ${error instanceof Error ? error.message : String(error)}. ` +
          `Any partially-added items were removed. On PF2e this usually means the actor is missing ` +
          `scaffolding the item depends on (attach an ancestry + class first, then feats/spells).`
      );
    }
  }

  /**
   * Remove embedded Items from an existing Actor.
   *
   * Items can be named by id (exact, reliable) and/or by name (case-insensitive,
   * optionally constrained to a `type` to disambiguate). Names that match nothing
   * are reported back rather than silently ignored. This is the counterpart to
   * `addActorItems` — useful for clearing stray items added with the wrong type.
   */
  async removeActorItems(params: {
    actorIdentifier: string;
    itemIds?: string[];
    itemNames?: string[];
    type?: string;
  }): Promise<{
    actorId: string;
    actorName: string;
    removed: Array<{ id: string; name: string; type: string }>;
    notFound: string[];
  }> {
    this.validateFoundryState();

    const { actorIdentifier, itemIds, itemNames, type } = params;

    if (!actorIdentifier) {
      throw new Error('actorIdentifier is required');
    }
    const hasIds = Array.isArray(itemIds) && itemIds.length > 0;
    const hasNames = Array.isArray(itemNames) && itemNames.length > 0;
    if (!hasIds && !hasNames) {
      throw new Error('Provide itemIds and/or itemNames identifying the items to remove');
    }

    const actor = this.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    const typeLower = type?.toLowerCase();
    const toDelete = new Map<string, any>(); // id -> item (dedupes overlap)
    const notFound: string[] = [];

    if (hasIds) {
      for (const id of itemIds) {
        const item = actor.items.get(id);
        if (item) toDelete.set(item.id, item);
        else notFound.push(id);
      }
    }
    if (hasNames) {
      for (const name of itemNames) {
        const nameLower = name.toLowerCase();
        const item = actor.items.find(
          (i: any) => i.name?.toLowerCase() === nameLower && (!typeLower || i.type === typeLower)
        );
        if (item) toDelete.set(item.id, item);
        else notFound.push(name);
      }
    }

    if (toDelete.size === 0) {
      return { actorId: actor.id, actorName: actor.name, removed: [], notFound };
    }

    const removed = Array.from(toDelete.values()).map((i: any) => ({
      id: i.id,
      name: i.name,
      type: i.type,
    }));

    try {
      await actor.deleteEmbeddedDocuments(
        'Item',
        removed.map(r => r.id)
      );
      this.auditLog(
        'removeActorItems',
        { actorIdentifier, actorId: actor.id, count: removed.length },
        'success'
      );
      return { actorId: actor.id, actorName: actor.name, removed, notFound };
    } catch (error) {
      this.auditLog(
        'removeActorItems',
        { actorIdentifier, actorId: actor.id, count: removed.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * List world-level Item documents from the Items sidebar.
   * Optionally filters by type, folder (name or id), or a case-insensitive name substring.
   */
  async listWorldItems(params: { type?: string; folder?: string; nameFilter?: string }): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      img?: string;
      folderId: string | null;
      folderName: string | null;
      folderPath: string;
    }>
  > {
    this.validateFoundryState();

    const { type, folder, nameFilter } = params;
    const nameLower = nameFilter ? nameFilter.toLowerCase() : null;

    // Resolve folder filter to an id if a name/id was provided. Accepts a bare name,
    // a folder id, or a "/"-separated path (the last segment is matched by name).
    let folderId: string | null = null;
    if (folder && folder.trim().length > 0) {
      const folderTrimmed = folder.trim();
      const leafName = folderTrimmed.split('/').pop()?.trim() || folderTrimmed;
      const folderDoc =
        (game as any).folders?.find(
          (f: any) =>
            f.type === 'Item' &&
            (f.name === leafName || f.name === folderTrimmed || f.id === folderTrimmed)
        ) ?? null;
      if (!folderDoc) {
        return [];
      }
      folderId = folderDoc.id;
    }

    const result: Array<{
      id: string;
      name: string;
      type: string;
      img?: string;
      folderId: string | null;
      folderName: string | null;
      folderPath: string;
    }> = [];

    for (const item of (game as any).items) {
      if (type && item.type !== type) continue;
      if (folderId && item.folder?.id !== folderId) continue;
      if (nameLower && !(item.name ?? '').toLowerCase().includes(nameLower)) continue;

      result.push({
        id: item.id ?? '',
        name: item.name ?? '',
        type: item.type,
        ...(item.img ? { img: item.img } : {}),
        folderId: item.folder?.id ?? null,
        folderName: item.folder?.name ?? null,
        folderPath: this.folderPathOf(item.folder),
      });
    }

    return result;
  }

  /**
   * The world collection backing each exportable document class.
   *
   * A method rather than a module constant because `game` is only populated after
   * Foundry's ready hook — a top-level constant would capture undefined.
   */
  private exportCollections(): Record<string, any> {
    const g = game as any;
    return {
      Item: g.items,
      Actor: g.actors,
      JournalEntry: g.journal,
      Macro: g.macros,
      RollTable: g.tables,
      Scene: g.scenes,
    };
  }

  /**
   * Phase 1 of an export: the plan.
   *
   * Returns an index only — id, name, subtype, folder path — for every document
   * matching the filters, across the requested classes. Deliberately small: the MCP
   * query transport has a hard 10s timeout, so the caller uses this to learn what
   * exists and then pulls the documents themselves in bounded batches via
   * `exportFetchDocuments`.
   *
   * Filters stack (all must pass). `folder` is a PREFIX match on the "/"-separated
   * path, so "Homebrew/Classes" catches everything nested beneath it — the useful
   * semantic for an export, and different on purpose from listWorldItems, which
   * matches a folder by leaf name only.
   */
  async exportPlan(params: {
    classes?: string[];
    type?: string;
    folder?: string;
    nameFilter?: string;
    ids?: string[];
  }): Promise<{
    world: { id: string; title: string; system: string; systemVersion: string; foundry: string };
    entries: Record<string, Array<{ id: string; name: string; type: string; folderPath: string }>>;
    counts: Record<string, number>;
    total: number;
    skipped: string[];
  }> {
    this.validateFoundryState();

    const collections = this.exportCollections();
    const known = Object.keys(collections);
    const requested = params.classes && params.classes.length > 0 ? params.classes : known.slice();

    const unknown = requested.filter(c => !known.includes(c));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown document class(es): ${unknown.join(', ')}. Known: ${known.join(', ')}.`
      );
    }

    const nameLower = params.nameFilter ? params.nameFilter.toLowerCase() : null;
    const folderFilter = params.folder
      ? params.folder.trim().replace(/^\/+/, '').replace(/\/+$/, '')
      : null;
    const folderLower = folderFilter ? folderFilter.toLowerCase() : null;
    const idSet = params.ids && params.ids.length > 0 ? new Set(params.ids) : null;

    const entries: Record<string, Array<any>> = {};
    const counts: Record<string, number> = {};
    const skipped: string[] = [];
    let total = 0;

    for (const cls of requested) {
      const collection = collections[cls];
      if (!collection) {
        // A world can legitimately lack a collection, or Foundry may rename one
        // across majors. Record it rather than throwing the whole export away.
        skipped.push(`${cls}: collection unavailable in this Foundry build`);
        continue;
      }

      const matched: Array<any> = [];
      for (const doc of collection as Iterable<any>) {
        if (idSet && !idSet.has(doc.id)) continue;
        if (params.type && doc.type !== params.type) continue;
        if (nameLower && !(doc.name ?? '').toLowerCase().includes(nameLower)) continue;

        const folderPath = this.folderPathOf(doc.folder);
        if (folderLower !== null) {
          const pathLower = folderPath.toLowerCase();
          const isMatch =
            pathLower === folderLower ||
            pathLower.startsWith(`${folderLower}/`) ||
            doc.folder?.id === folderFilter;
          if (!isMatch) continue;
        }

        matched.push({
          id: doc.id,
          name: doc.name ?? '',
          // Scenes and journals have no `type`; report the class instead so the
          // caller always has something to group by.
          type: doc.type ?? cls,
          folderPath,
        });
      }

      entries[cls] = matched;
      counts[cls] = matched.length;
      total += matched.length;
    }

    const g = game as any;
    return {
      world: {
        id: g.world?.id ?? 'unknown',
        title: g.world?.title ?? 'unknown',
        system: g.system?.id ?? 'unknown',
        systemVersion: g.system?.version ?? 'unknown',
        foundry: g.version ?? g.data?.version ?? 'unknown',
      },
      entries,
      counts,
      total,
      skipped,
    };
  }

  /**
   * Phase 2 of an export: pull one bounded batch of full documents.
   *
   * `toObject()` verbatim — no curation. A curated shape goes stale every time the
   * game system moves a field and silently drops whatever it does not know about;
   * the caller can always narrow, but cannot recover what was never sent.
   *
   * The batch is capped because the transport times out at 10s and these documents
   * are large (a Scene carries every token, wall, light and tile it contains). An
   * over-large batch fails here with a clear message rather than as a timeout.
   */
  async exportFetchDocuments(params: { documentClass: string; ids: string[] }): Promise<{
    documentClass: string;
    documents: any[];
    failed: Array<{ id: string; error: string }>;
  }> {
    this.validateFoundryState();

    const collections = this.exportCollections();
    const collection = collections[params.documentClass];
    if (!collection) {
      throw new Error(
        `Unknown document class: ${params.documentClass}. ` +
          `Known: ${Object.keys(collections).join(', ')}.`
      );
    }

    if (!Array.isArray(params.ids) || params.ids.length === 0) {
      throw new Error('exportFetchDocuments requires a non-empty "ids" array');
    }
    if (params.ids.length > 100) {
      throw new Error(
        `Batch of ${params.ids.length} exceeds the 100-document ceiling; the query ` +
          `transport times out at 10s. Send smaller batches.`
      );
    }

    const documents: any[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of params.ids) {
      try {
        const doc = collection.get?.(id);
        if (!doc) {
          failed.push({ id, error: 'not found' });
          continue;
        }
        documents.push({
          id: doc.id,
          name: doc.name ?? '',
          type: doc.type ?? params.documentClass,
          folderPath: this.folderPathOf(doc.folder),
          document: doc.toObject(),
        });
      } catch (error) {
        // One unserialisable document must not lose the other 99 in the batch.
        failed.push({ id, error: error instanceof Error ? error.message : 'unknown error' });
      }
    }

    return { documentClass: params.documentClass, documents, failed };
  }

  /**
   * The world's folder tree for the requested classes, as flat records carrying
   * "/"-separated paths. Exported alongside the documents so an EMPTY folder — real
   * organisational information — survives a round trip that only carried documents.
   */
  async exportFolderTree(params: {
    classes?: string[];
  }): Promise<Array<{ id: string; name: string; type: string; path: string; depth: number }>> {
    this.validateFoundryState();

    const known = Object.keys(this.exportCollections());
    const requested = params.classes && params.classes.length > 0 ? params.classes : known.slice();
    const wanted = new Set(requested);

    const out: Array<{ id: string; name: string; type: string; path: string; depth: number }> = [];
    for (const folder of ((game as any).folders ?? []) as Iterable<any>) {
      if (!wanted.has(folder.type)) continue;
      const path = this.folderPathOf(folder);
      out.push({
        id: folder.id,
        name: folder.name ?? '',
        type: folder.type,
        path,
        depth: path ? path.split('/').length : 0,
      });
    }
    out.sort((a, b) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path));
    return out;
  }

  /**
   * Export the contents of a world folder into a Foundry compendium pack.
   *
   * The JSON export writes files a human can read but Foundry cannot import without
   * a script; this writes a real pack the world can use directly. Both are useful and
   * neither replaces the other.
   *
   * Uses core Foundry's own `Folder#exportToCompendium`, so the packing rules stay
   * Foundry's rather than something reimplemented here.
   */
  async exportFolderToCompendium(params: {
    folder: string;
    packLabel?: string;
    packName?: string;
    updateByName?: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    const raw = (params.folder ?? '').trim();
    if (!raw) throw new Error('"folder" is required');

    const target = raw.replace(/^\/+/, '').replace(/\/+$/, '');
    const targetLower = target.toLowerCase();

    // Match on full path first so "Homebrew/Classes" and "Archive/Classes" stay
    // distinct; fall back to a bare-name or id match for convenience.
    let folderDoc: any = null;
    for (const f of ((game as any).folders ?? []) as Iterable<any>) {
      if (f.id === target) {
        folderDoc = f;
        break;
      }
      if (this.folderPathOf(f).toLowerCase() === targetLower) {
        folderDoc = f;
        break;
      }
    }
    if (!folderDoc) {
      for (const f of ((game as any).folders ?? []) as Iterable<any>) {
        if ((f.name ?? '').toLowerCase() === targetLower) {
          folderDoc = f;
          break;
        }
      }
    }
    if (!folderDoc) {
      throw new Error(`Folder not found: "${params.folder}" (matched by path, id, then name).`);
    }

    const documentName = folderDoc.type;
    const label = params.packLabel?.trim() || `${folderDoc.name} Export`;
    const packName =
      params.packName?.trim() ||
      `mcp-export-${
        (folderDoc.name ?? 'folder')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, '')
          .slice(0, 40) || 'folder'
      }`;

    const collectionId = `world.${packName}`;
    let pack = (game as any).packs?.get?.(collectionId) ?? null;

    if (pack && pack.documentName !== documentName) {
      throw new Error(
        `Compendium "${collectionId}" already exists but holds ${pack.documentName} documents, ` +
          `not ${documentName}. Pass a different "packName".`
      );
    }

    let created = false;
    if (!pack) {
      const CompendiumCls = (globalThis as any).CompendiumCollection;
      if (!CompendiumCls?.createCompendium) {
        throw new Error(
          'CompendiumCollection.createCompendium is unavailable in this Foundry build.'
        );
      }
      pack = await CompendiumCls.createCompendium({
        label,
        name: packName,
        type: documentName,
        package: 'world',
      });
      created = true;
    }

    if (pack.locked) {
      await pack.configure({ locked: false });
    }

    const before = pack.index?.size ?? 0;
    await folderDoc.exportToCompendium(pack, { updateByName: params.updateByName === true });
    // The index is what everything downstream reads; refresh before counting.
    await pack.getIndex();
    const after = pack.index?.size ?? 0;

    this.auditLog(
      'exportFolderToCompendium',
      { folder: this.folderPathOf(folderDoc), pack: collectionId, documentName },
      'success'
    );

    return {
      success: true,
      pack: collectionId,
      packLabel: pack.metadata?.label ?? label,
      documentName,
      createdPack: created,
      folder: { id: folderDoc.id, name: folderDoc.name, path: this.folderPathOf(folderDoc) },
      entriesBefore: before,
      entriesAfter: after,
      note: created
        ? 'New world compendium created. It appears in the Compendium sidebar tab.'
        : 'Existing world compendium reused.',
    };
  }

  /**
   * Delete a whole world compendium pack, entries and all.
   *
   * The only irreversible operation in this module, so it is built the opposite way
   * round from the rest: the default call deletes nothing. `dryRun` defaults to TRUE,
   * so the first call is always a report of what is in the pack, and a second call
   * carrying `dryRun: false` and the entry count it just saw is what actually deletes.
   *
   * That is a speed bump, not a lock, and deliberately so. A gate that cannot be
   * satisfied gets routed around - somebody deletes the pack from the Foundry sidebar
   * instead, where nothing is recorded at all. What this buys is that nobody deletes a
   * pack they have not looked inside, and the count check catches the case that
   * actually costs you something: being confident about the wrong pack.
   *
   * The one refusal that is absolute is system and module packs. That is not a rule
   * this module invented - `deleteCompendium` belongs to the owning package, and
   * Foundry rejects it for anything but a world pack. Refusing here just produces a
   * sentence instead of an exception. A typical world carries a hundred-odd packs from
   * its game system and its modules; none of them are ours to remove.
   *
   * The index entry list is returned in both modes, so a delete hands back the receipt
   * of what it destroyed. That is not a backup - the entries themselves are gone and
   * nothing here writes them to disk first. Deliberately: reading a large pack's full
   * documents would blow the 10s query ceiling, and a backup step that times out on
   * exactly the big packs that need it is worse than an honest "no backup taken".
   * Use export-world-data or export-to-compendium beforehand if the content matters.
   */
  async deleteCompendiumPack(params: {
    pack: string;
    dryRun?: boolean;
    expectedEntryCount?: number;
  }): Promise<any> {
    this.validateFoundryState();

    const raw = (params.pack ?? '').trim();
    if (!raw) throw new Error('"pack" is required');

    const packs = (game as any).packs;
    // Bare name means a world pack; a dotted id is taken as given, so a system or
    // module pack still RESOLVES here and gets the "not yours" answer below rather
    // than a misleading "not found".
    let pack = packs?.get?.(raw) ?? null;
    if (!pack && !raw.includes('.')) pack = packs?.get?.(`world.${raw}`) ?? null;
    if (!pack) {
      const worldPacks: string[] = [];
      for (const p of (packs ?? []) as Iterable<any>) {
        if (p?.metadata?.packageType === 'world') worldPacks.push(p.collection);
      }
      throw new Error(
        `Compendium not found: "${params.pack}". World packs in this world: ` +
          `${worldPacks.length ? worldPacks.join(', ') : '(none)'}.`
      );
    }

    const collection = pack.collection ?? raw;
    const packageType = pack.metadata?.packageType ?? 'unknown';
    const packageName = pack.metadata?.packageName ?? pack.metadata?.package ?? 'unknown';

    if (packageType !== 'world') {
      throw new Error(
        `Refusing to delete "${collection}": it belongs to the ${packageType} ` +
          `"${packageName}", not to this world. Only world.* packs can be deleted, and ` +
          `Foundry itself rejects the call for anything else. To stop using this content, ` +
          `disable or uninstall the ${packageType} instead.`
      );
    }

    // The index is what the sidebar shows and what everything downstream counts.
    await pack.getIndex();
    const index = Array.from((pack.index ?? []) as Iterable<any>);
    const entryCount = index.length;
    const ENTRY_CAP = 200;
    const entries = index.slice(0, ENTRY_CAP).map((e: any) => ({
      id: e._id ?? e.id,
      name: e.name,
      ...(e.type !== undefined ? { type: e.type } : {}),
    }));

    const summary = {
      pack: collection,
      label: pack.metadata?.label ?? collection,
      documentName: pack.documentName,
      packageType,
      locked: pack.locked === true,
      entryCount,
      entries,
      entriesTruncated: entryCount > ENTRY_CAP,
    };

    if (params.dryRun !== false) {
      return {
        success: true,
        dryRun: true,
        deleted: false,
        ...summary,
        note:
          `Nothing was deleted. To delete this pack and all ${entryCount} entries, call again ` +
          `with dryRun: false and expectedEntryCount: ${entryCount}. There is no undo and no ` +
          `automatic backup - export first if the content matters.`,
      };
    }

    if (typeof params.expectedEntryCount !== 'number') {
      throw new Error(
        `"expectedEntryCount" is required when dryRun is false. "${collection}" holds ` +
          `${entryCount} entries right now; pass that number to confirm this is the pack you mean.`
      );
    }
    if (params.expectedEntryCount !== entryCount) {
      throw new Error(
        `Entry count mismatch on "${collection}": you expected ${params.expectedEntryCount}, ` +
          `the pack holds ${entryCount}. Nothing was deleted. Re-read the pack before ` +
          `deleting - either this is not the pack you meant, or it changed since you looked.`
      );
    }

    if (typeof pack.deleteCompendium !== 'function') {
      throw new Error(
        'CompendiumCollection#deleteCompendium is unavailable in this Foundry build.'
      );
    }

    try {
      await pack.deleteCompendium();
    } catch (error) {
      this.auditLog(
        'deleteCompendiumPack',
        { pack: collection, entryCount },
        'failure',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }

    // Report what is true, not what was requested: confirm the pack is actually gone
    // from game.packs rather than trusting the call to have done what it said.
    const stillPresent = packs?.get?.(collection) != null;

    this.auditLog('deleteCompendiumPack', { pack: collection, entryCount }, 'success');

    return {
      success: !stillPresent,
      dryRun: false,
      deleted: !stillPresent,
      ...summary,
      entriesDeleted: entryCount,
      verified: stillPresent
        ? 'FAILED - the pack is still registered in game.packs after deleteCompendium() returned.'
        : 'Confirmed gone from game.packs.',
      note:
        `Deleted. The ${entryCount} entries listed above are not recoverable from here; the ` +
        `list is a receipt, not a backup.`,
    };
  }

  /**
   * Full stat-block read for standalone world Items — the whole stored document via
   * `toObject()`, `system` block included.
   *
   * This is the gap `listWorldItems` leaves: that method is deliberately an index
   * (id/name/type/folder) so listing a large world stays cheap, which means every
   * scrape of world Items was name-and-folder only. `manage-world-items describe`
   * looks like it should fill the gap but does not — it is a per-system enum
   * reference, and it is empty for pf2e.
   *
   * Verbatim `toObject()` rather than a curated view on purpose: a curated shape goes
   * stale every time the game system moves a field, and silently drops whatever it
   * does not know about. The caller can narrow; it cannot recover what was never sent.
   *
   * Bounded by `maxDocuments` because the MCP query transport has a hard 10s timeout
   * (foundry-connector.ts) and these documents are large. A filter matching more than
   * the cap fails loudly with the count rather than timing out or truncating — for a
   * bulk dump the caller wants exportWorldData, which batches and writes to disk.
   */
  async getWorldItems(params: {
    ids?: string[];
    type?: string;
    folder?: string;
    nameFilter?: string;
    maxDocuments?: number;
  }): Promise<{ items: any[]; total: number }> {
    this.validateFoundryState();

    const cap = Math.max(1, Math.min(params.maxDocuments ?? 25, 200));
    let matched: any[] = [];

    if (params.ids && params.ids.length > 0) {
      // Validate every id before returning anything, so a typo is an error rather
      // than a silently short list the caller reads as "that item does not exist".
      const missing: string[] = [];
      for (const id of params.ids) {
        const doc = (game as any).items?.get?.(id) ?? null;
        if (doc) matched.push(doc);
        else missing.push(id);
      }
      if (missing.length > 0) {
        throw new Error(
          `Unknown world Item id(s): ${missing.join(', ')}. ` +
            `Get ids from manage-world-items action:"list".`
        );
      }
    } else {
      const index = await this.listWorldItems({
        ...(params.type !== undefined ? { type: params.type } : {}),
        ...(params.folder !== undefined ? { folder: params.folder } : {}),
        ...(params.nameFilter !== undefined ? { nameFilter: params.nameFilter } : {}),
      });
      matched = index
        .map((entry: any) => (game as any).items?.get?.(entry.id))
        .filter((doc: any) => !!doc);
    }

    if (matched.length > cap) {
      throw new Error(
        `action:"get" matched ${matched.length} world Items, over the ${cap}-document cap. ` +
          `Narrow the filter, pass a larger "maxDocuments" (max 200), or use ` +
          `export-world-data to write them all to disk instead.`
      );
    }

    const items = matched.map((doc: any) => ({
      id: doc.id,
      name: doc.name,
      type: doc.type,
      img: doc.img ?? null,
      folderId: doc.folder?.id ?? null,
      folderPath: this.folderPathOf(doc.folder),
      document: doc.toObject(),
    }));

    return { items, total: items.length };
  }

  /**
   * Update one or more existing world-level Item documents.
   *
   * Each entry must supply an `id` plus at least one field to change (name,
   * img, system, folder). Uses Item.updateDocuments() for a single batched
   * write. Folder may be supplied as a name or id; if a name is given that
   * does not exist, it is created automatically (same behaviour as
   * createWorldItems).
   */
  async updateWorldItems(params: {
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      system?: Record<string, any>;
      folder?: string;
    }>;
  }): Promise<{
    updated: Array<{ id: string; name: string; type: string }>;
  }> {
    this.validateFoundryState();

    const { updates } = params;

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('updates array is required and must contain at least one entry');
    }

    // Cache folder resolutions so we only look up / create each folder path once
    const folderCache = new Map<string, string>(); // folder param → leaf folder id

    const resolveFolderId = async (folder: string): Promise<string | null> => {
      if (folderCache.has(folder)) return folderCache.get(folder)!;
      const id = await this.resolveFolderPath(folder, 'Item');
      if (id) folderCache.set(folder, id);
      return id;
    };

    const payload: Array<Record<string, any>> = [];

    for (let idx = 0; idx < updates.length; idx++) {
      const upd = updates[idx];
      if (!upd || typeof upd.id !== 'string' || upd.id.trim().length === 0) {
        throw new Error(`updates[${idx}]: "id" is required and must be a non-empty string`);
      }

      const item = (game as any).items?.get(upd.id);
      if (!item) {
        throw new Error(`updates[${idx}]: Item "${upd.id}" not found in world`);
      }

      const patch: Record<string, any> = { _id: upd.id };
      if (upd.name !== undefined) patch.name = upd.name;
      if (upd.img !== undefined) patch.img = upd.img;
      if (upd.system !== undefined) patch.system = upd.system;
      if (upd.folder !== undefined && upd.folder.trim().length > 0) {
        const folderId = await resolveFolderId(upd.folder.trim());
        if (folderId) patch.folder = folderId;
      }

      payload.push(patch);
    }

    try {
      const updated = await (Item as any).updateDocuments(payload);

      const result = {
        updated: (updated || []).map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
        })),
      };

      this.auditLog('updateWorldItems', { count: payload.length }, 'success');
      return result;
    } catch (error) {
      this.auditLog(
        'updateWorldItems',
        { count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Permanently delete one or more world-level Item documents by id.
   *
   * This is the only way to remove a standalone world Item — `removeActorItems`
   * only detaches items already embedded on an actor.
   *
   * Every id is validated *before* anything is deleted: an unknown id fails the
   * whole call and removes nothing, rather than silently deleting the subset it
   * recognised. (Contrast `deleteTokens`, which reports `deletedCount: 0` on a
   * bad id and looks like a success.)
   */
  async deleteWorldItems(params: { ids: string[] }): Promise<{
    deleted: Array<{ id: string; name: string; type: string }>;
    total: number;
  }> {
    this.validateFoundryState();

    const { ids } = params;

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ids array is required and must contain at least one world Item id');
    }

    const resolved: Array<{ id: string; name: string; type: string }> = [];
    const missing: string[] = [];

    for (const id of ids) {
      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Every entry in "ids" must be a non-empty string');
      }
      const item = (game as any).items?.get(id);
      if (!item) {
        missing.push(id);
        continue;
      }
      resolved.push({ id: item.id, name: item.name, type: item.type });
    }

    if (missing.length > 0) {
      throw new Error(
        `Not found in the world Items directory: ${missing.join(', ')}. ` +
          `Nothing was deleted. Use action:"list" to get valid ids — note that items embedded ` +
          `on an actor are not world Items and must be removed with action:"remove-from-actor".`
      );
    }

    try {
      await (Item as any).deleteDocuments(resolved.map(r => r.id));

      // Confirm they're actually gone rather than trusting the call.
      const survivors = resolved.filter(r => (game as any).items?.get(r.id));
      if (survivors.length > 0) {
        throw new Error(
          `Foundry reported success but these items still exist: ${survivors
            .map(s => `${s.name} (${s.id})`)
            .join(', ')}`
        );
      }

      this.auditLog('deleteWorldItems', { count: resolved.length }, 'success');
      return { deleted: resolved, total: resolved.length };
    } catch (error) {
      this.auditLog(
        'deleteWorldItems',
        { count: resolved.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Create one or more world-level Item documents (Items sidebar, not embedded on an actor).
   *
   * Uses Item.createDocuments() with no parent so items appear in the Foundry
   * Items sidebar and can be dragged onto any actor sheet. Optionally places
   * items inside a named/id-resolved folder, creating the folder if necessary.
   */
  async createWorldItems(params: {
    items: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
    folder?: string;
  }): Promise<{
    folderId: string | null;
    folderName: string | null;
    created: Array<{ id: string; name: string; type: string }>;
  }> {
    this.validateFoundryState();

    const { items, folder } = params;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items array is required and must contain at least one entry');
    }

    const itemDocTypes = (game as any).system?.documentTypes?.Item;
    const validTypes: string[] | null =
      itemDocTypes && typeof itemDocTypes === 'object' ? Object.keys(itemDocTypes) : null;

    const payload = items.map((it, idx) => {
      if (!it || typeof it.name !== 'string' || it.name.trim().length === 0) {
        throw new Error(`items[${idx}]: "name" is required and must be a non-empty string`);
      }
      if (typeof it.type !== 'string' || it.type.trim().length === 0) {
        throw new Error(`items[${idx}] ("${it.name}"): "type" is required`);
      }
      if (validTypes && !validTypes.includes(it.type)) {
        throw new Error(
          `items[${idx}] ("${it.name}"): unknown type "${it.type}" for system "${(game.system as any)?.id}". ` +
            `Valid Item types: ${validTypes.join(', ')}`
        );
      }

      const doc: Record<string, any> = { name: it.name, type: it.type };
      if (it.img) doc.img = it.img;
      if (it.system && typeof it.system === 'object') doc.system = it.system;
      if (Array.isArray((it as any).effects)) doc.effects = (it as any).effects;
      if ((it as any).flags && typeof (it as any).flags === 'object') doc.flags = (it as any).flags;
      return doc;
    });

    // Resolve or create the target folder. A "/"-separated `folder` nests
    // (e.g. "Homebrew/Classes/Scrapwright" walks or creates the whole path).
    let folderDoc: any = null;
    if (folder && folder.trim().length > 0) {
      const folderId = await this.resolveFolderPath(folder.trim(), 'Item');
      if (folderId) {
        folderDoc = (game as any).folders?.get?.(folderId) ?? { id: folderId, name: null };
        for (const doc of payload) {
          doc.folder = folderId;
        }
      }
    }

    try {
      const created = await (Item as any).createDocuments(payload);

      const result = {
        folderId: folderDoc ? folderDoc.id : null,
        folderName: folderDoc ? folderDoc.name : null,
        created: (created || []).map((doc: any) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
        })),
      };

      this.auditLog(
        'createWorldItems',
        { folder: folder ?? null, count: payload.length },
        'success'
      );
      return result;
    } catch (error) {
      this.auditLog(
        'createWorldItems',
        { folder: folder ?? null, count: payload.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Get system-specific enum/schema information for the current game system.
   * Returns valid values for enumerated fields so the LLM can use correct keys
   * when creating or updating items/actors (e.g. weapon.traits in mgt2e).
   */
  getSystemSchema(): Record<string, any> {
    const systemId = (game as any).system?.id ?? 'unknown';

    if (systemId !== 'mgt2e') {
      return {
        system: systemId,
        message: 'No enum schema available for this system',
      };
    }

    const mgt2Config = (CONFIG as any).MGT2;
    if (!mgt2Config) {
      return { system: 'mgt2e', message: 'CONFIG.MGT2 not found — system may not be fully loaded' };
    }

    // ── Weapon traits from live CONFIG.MGT2.WEAPONS.traits ───────────────────
    const weaponTraitsRaw = mgt2Config.WEAPONS?.traits ?? {};
    const traitsPersonal: string[] = [];
    const traitsSpacecraft: string[] = [];
    const traitsAny: string[] = [];
    const traitsWithValue: string[] = [];

    for (const [key, val] of Object.entries(weaponTraitsRaw)) {
      const v = val as any;
      const scale: string = v.scale ?? 'any';
      if (scale === 'traveller' || scale === 'vehicle') traitsPersonal.push(key);
      else if (scale === 'spacecraft') traitsSpacecraft.push(key);
      else traitsAny.push(key); // no scale restriction
      if (v.value !== undefined) traitsWithValue.push(key);
    }

    return {
      system: 'mgt2e',
      description:
        'Enum reference for mgt2e item and actor fields. Use these exact keys — wrong values are silently ignored by the system.',
      items: {
        weapon: {
          'weapon.traits': {
            description:
              'Comma-separated string of trait keys. Traits with numeric values use "key N" (e.g. "ap 5, auto 3, stun"). Conflicts: bulky/veryBulky, dangerous/veryDangerous, ap/loPen.',
            traits_personal_scale: traitsPersonal.sort(),
            traits_spacecraft_scale: traitsSpacecraft.sort(),
            traits_any_scale: traitsAny.sort(),
            traits_requiring_numeric_value: traitsWithValue.sort(),
            example: 'ap 5, auto 3, scope, stun',
          },
          'weapon.scale': ['traveller', 'vehicle', 'spacecraft'],
          'weapon.characteristic': ['STR', 'DEX', 'END', 'INT', 'EDU', 'SOC'],
          'weapon.damageType': [
            'standard',
            'fire',
            'cutting',
            'energy',
            'laser',
            'plasma',
            'meson',
            'nuclear',
          ],
          'weapon.skill':
            'Format: "skillKey.specialityKey" (e.g. "guncombat.slug", "melee.blade", "heavyweapons.portable")',
        },
        armour: {
          'armour.form': ['standard', 'layered', 'stackable', 'natural'],
          note: 'stackable: stacks with other stackable armour. layered: can layer under others. natural: creature skin, always worn.',
        },
        hardware: {
          'hardware.system': [
            'general',
            'power',
            'armour',
            'fuel',
            'drive',
            'bridge',
            'sensor',
            'computer',
            'weapon',
            'defence',
            'stateroom',
            'common',
            'cargo',
          ],
          spacecraft_sheet_sections: {
            'Componentes (coreItems)': ['power', 'armour', 'fuel', 'drive'],
            'Puente (bridgeItems)': ['bridge', 'sensor', 'computer'],
            'Armas (weaponItems)': ['weapon', 'defence'],
            'Habitabilidad (livingItems)': ['stateroom', 'common'],
            'Carga (cargoItems)': ['cargo'],
            'General (generalItems)': ['general'],
          },
        },
        software: {
          'software.class': ['personal', 'ship'],
          'software.type': ['generic', 'interface', 'bonus'],
          note: 'class determines which SOFTWARE_EFFECTS apply. type=bonus enables skill/char bonuses.',
        },
        associate: {
          'associate.relationship': ['contact', 'ally', 'rival', 'enemy'],
        },
        base: {
          status: ['equipped', 'carried'],
          note: 'status is set from MgT2Item.EQUIPPED / MgT2Item.CARRIED constants.',
        },
        actor: {
          'weapon.scale_hint':
            'When adding a weapon to a spacecraft actor, set weapon.scale="spacecraft" to show in the ship weapons section.',
        },
      },
    };
  }

  /**
   * Get full compendium document with all embedded data
   */
  async getCompendiumDocumentFull(
    packId: string,
    documentId: string
  ): Promise<CompendiumEntryFull> {
    const pack = game.packs.get(packId);
    if (!pack) {
      throw new Error(`Compendium pack ${packId} not found`);
    }

    const document = await pack.getDocument(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found in pack ${packId}`);
    }

    // Build comprehensive data structure
    const fullEntry: CompendiumEntryFull = {
      id: document.id || '',
      name: document.name || '',
      type: (document as any).type || 'unknown',
      img: (document as any).img || undefined,
      pack: packId,
      packLabel: pack.metadata.label,
      system: this.sanitizeData((document as any).system || {}),
      fullData: this.sanitizeData(document.toObject()),
    };

    // Add items if the actor has them
    if ((document as any).items) {
      fullEntry.items = (document as any).items.map((item: any) => ({
        id: item.id,
        name: item.name,
        type: item.type,
        img: item.img || undefined,
        system: this.sanitizeData(item.system || {}),
      }));
    }

    // Add effects if the actor has them
    if ((document as any).effects) {
      fullEntry.effects = (document as any).effects.map((effect: any) => ({
        id: effect.id,
        name: effect.name || effect.label || 'Unknown Effect',
        icon: effect.icon || undefined,
        disabled: effect.disabled || false,
        duration: this.sanitizeData(effect.duration || {}),
      }));
    }

    return fullEntry;
  }

  /**
   * Add actors to the current scene as tokens
   */
  async addActorsToScene(
    placement: SceneTokenPlacement,
    transactionId?: string
  ): Promise<TokenPlacementResult> {
    this.validateFoundryState();

    // Use new permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: placement.actorIds,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    // Audit the permission check
    permissionManager.auditPermissionCheck('modifyScene', permissionCheck, placement);

    const scene = (game.scenes as any).current;
    if (!scene) {
      throw new Error('No active scene found');
    }

    this.auditLog('addActorsToScene', placement, 'success');

    try {
      const tokenData: any[] = [];
      const errors: string[] = [];

      for (const actorId of placement.actorIds) {
        try {
          const actor = game.actors.get(actorId);
          if (!actor) {
            errors.push(`Actor ${actorId} not found`);
            continue;
          }

          const tokenDoc = (actor as any).prototypeToken.toObject();
          const position = this.calculateTokenPosition(
            placement.placement,
            scene,
            tokenData.length,
            placement.coordinates
          );

          // Fix token texture if it's still a remote URL (Foundry may have overridden our actor creation fix)
          if (tokenDoc.texture?.src?.startsWith('http')) {
            console.error(
              `[${this.moduleId}] Token texture still has remote URL, clearing: ${tokenDoc.texture.src}`
            );
            tokenDoc.texture.src = null; // Use Foundry's fallback
          } else {
          }

          tokenData.push({
            ...tokenDoc,
            x: position.x,
            y: position.y,
            actorId,
            hidden: placement.hidden,
          });
        } catch (error) {
          errors.push(
            `Failed to prepare token for actor ${actorId}: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      const createdTokens = await scene.createEmbeddedDocuments('Token', tokenData);

      // Track token creation for rollback if transaction is active
      if (transactionId && createdTokens.length > 0) {
        for (const token of createdTokens) {
          transactionManager.addAction(
            transactionId,
            transactionManager.createTokenCreationAction(token.id)
          );
        }
      }

      const result: TokenPlacementResult = {
        success: createdTokens.length > 0,
        tokensCreated: createdTokens.length,
        tokenIds: createdTokens.map((token: any) => token.id),
        ...(errors.length > 0 ? { errors } : {}),
      };

      this.auditLog('addActorsToScene', placement, 'success');
      return result;
    } catch (error) {
      this.auditLog(
        'addActorsToScene',
        placement,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  /**
   * Find best matching compendium entry for creature type
   */
  private async findBestCompendiumMatch(
    creatureType: string,
    packPreference?: string
  ): Promise<CompendiumSearchResult | null> {
    // First try exact search
    const exactResults = await this.searchCompendium(creatureType, 'Actor');

    // Look for exact name match first
    const exactMatch = exactResults.find(
      result => result.name.toLowerCase() === creatureType.toLowerCase()
    );
    if (exactMatch) return exactMatch;

    // Look for partial matches, preferring specified pack
    if (packPreference) {
      const packMatch = exactResults.find(result => result.pack === packPreference);
      if (packMatch) return packMatch;
    }

    // Return best fuzzy match
    return exactResults.length > 0 ? exactResults[0] : null;
  }

  /**
   * Create actor from source document with custom name
   */
  private async createActorFromSource(
    sourceDoc: CompendiumEntryFull,
    customName: string
  ): Promise<any> {
    try {
      // Clone the source data
      const actorData = foundry.utils.deepClone(sourceDoc.fullData) as any;

      // Apply customizations
      actorData.name = customName;

      // Fix only token texture - leave portrait (actor.img) alone
      if (actorData.prototypeToken?.texture?.src?.startsWith('http')) {
        console.error(
          `[${this.moduleId}] Removing remote token texture URL: ${actorData.prototypeToken.texture.src}`
        );
        actorData.prototypeToken.texture.src = null; // Let Foundry use fallback
      }

      // Remove source-specific identifiers
      delete actorData._id;
      delete actorData.folder;
      delete actorData.sort;

      // Ensure required fields are present
      if (!actorData.name) actorData.name = customName;
      if (!actorData.type) actorData.type = sourceDoc.type || 'npc';

      // Organize created actors in a folder - use "Foundry MCP Creatures" for generic monsters
      const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');
      if (folderId) {
        actorData.folder = folderId;
      }

      // Create the new actor
      const createdDocs = await Actor.createDocuments([actorData]);
      if (!createdDocs || createdDocs.length === 0) {
        throw new Error('Failed to create actor document');
      }

      return createdDocs[0];
    } catch (error) {
      console.error(`[${this.moduleId}] Actor creation failed:`, error);
      throw error;
    }
  }

  /**
   * Calculate token position based on placement strategy
   */
  private calculateTokenPosition(
    placement: 'random' | 'grid' | 'center' | 'coordinates',
    scene: any,
    index: number,
    coordinates?: { x: number; y: number }[]
  ): { x: number; y: number } {
    const gridSize = scene.grid?.size || 100;

    switch (placement) {
      case 'coordinates':
        if (coordinates?.[index]) {
          return coordinates[index];
        }
        // Fallback to grid if coordinates not provided or insufficient
        const fallbackCols = Math.ceil(Math.sqrt(index + 1));
        const fallbackRow = Math.floor(index / fallbackCols);
        const fallbackCol = index % fallbackCols;
        return {
          x: gridSize + fallbackCol * gridSize * 2,
          y: gridSize + fallbackRow * gridSize * 2,
        };

      case 'center':
        return {
          x: scene.width / 2 + index * gridSize,
          y: scene.height / 2,
        };

      case 'grid':
        const cols = Math.ceil(Math.sqrt(index + 1));
        const row = Math.floor(index / cols);
        const col = index % cols;
        return {
          x: gridSize + col * gridSize * 2,
          y: gridSize + row * gridSize * 2,
        };

      case 'random':
      default:
        return {
          x: Math.random() * (scene.width - gridSize),
          y: Math.random() * (scene.height - gridSize),
        };
    }
  }

  /**
   * Validate write operation permissions
   */
  async validateWritePermissions(operation: 'createActor' | 'modifyScene'): Promise<{
    allowed: boolean;
    reason?: string;
    requiresConfirmation?: boolean;
    warnings?: string[];
  }> {
    this.validateFoundryState();

    const permissionCheck = permissionManager.checkWritePermission(operation);

    // Audit the permission check
    permissionManager.auditPermissionCheck(operation, permissionCheck);

    return {
      allowed: permissionCheck.allowed,
      ...(permissionCheck.reason ? { reason: permissionCheck.reason } : {}),
      ...(permissionCheck.requiresConfirmation
        ? { requiresConfirmation: permissionCheck.requiresConfirmation }
        : {}),
      ...(permissionCheck.warnings ? { warnings: permissionCheck.warnings } : {}),
    };
  }

  /**
   * Request player rolls - creates interactive roll buttons in chat
   */
  async requestPlayerRolls(data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    this.validateFoundryState();

    try {
      // Resolve target player from character name or player name with enhanced error handling
      const playerInfo = this.resolveTargetPlayer(data.targetPlayer);
      if (!playerInfo.found) {
        // Provide structured error message for MCP that Claude Desktop can understand
        const errorMessage =
          playerInfo.errorMessage || `Could not find player or character: ${data.targetPlayer}`;

        return {
          success: false,
          message: '',
          error: errorMessage,
        };
      }

      // Build roll formula based on type and target
      const rollFormula = this.buildRollFormula(
        data.rollType,
        data.rollTarget,
        data.rollModifier,
        playerInfo.character
      );

      // Generate roll button HTML
      const buttonId = foundry.utils.randomID();
      const buttonLabel = this.buildRollButtonLabel(data.rollType, data.rollTarget, data.isPublic);

      // Check if this type of roll was already performed (optional: could check for duplicate recent rolls)
      // For now, we'll just create the button and let the rendering logic handle the state restoration

      const rollButtonHtml = `
        <div class="mcp-roll-request" style="margin: 12px 0; padding: 12px; border: 1px solid #ccc; border-radius: 8px; background: #f9f9f9;">
          <p><strong>Roll Request:</strong> ${buttonLabel}</p>
          <p><strong>Target:</strong> ${playerInfo.targetName} ${playerInfo.character ? `(${playerInfo.character.name})` : ''}</p>
          ${data.flavor ? `<p><strong>Context:</strong> ${data.flavor}</p>` : ''}
          
          <div style="text-align: center; margin-top: 8px;">
            <!-- Single Roll Button (clickable by both character owner and GM) -->
            <button class="mcp-roll-button mcp-button-active" 
                    data-button-id="${buttonId}"
                    data-roll-formula="${rollFormula}"
                    data-roll-label="${buttonLabel}"
                    data-is-public="${data.isPublic}"
                    data-character-id="${playerInfo.character?.id || ''}"
                    data-target-user-id="${playerInfo.user?.id || ''}">
              🎲 ${buttonLabel}
            </button>
          </div>
        </div>
      `;

      // Create chat message with roll button
      // For PUBLIC rolls: both roll request and results visible to all players
      // For PRIVATE rolls: both roll request and results visible to target player + GM only
      const whisperTargets: string[] = [];

      if (!data.isPublic) {
        // Private roll request: whisper to target player + GM only

        // Always whisper to the character owner if they exist
        if (playerInfo.user?.id) {
          whisperTargets.push(playerInfo.user.id);
        }

        // Also send to GM (GMs can see all whispered messages anyway, but this ensures they see it)
        const gmUsers = game.users?.filter((u: User) => u.isGM && u.active);
        if (gmUsers) {
          for (const gm of gmUsers) {
            if (gm.id && !whisperTargets.includes(gm.id)) {
              whisperTargets.push(gm.id);
            }
          }
        }
      } else {
        // Public roll request: visible to all players (empty whisperTargets array)
      }

      const messageData = {
        content: rollButtonHtml,
        speaker: ChatMessage.getSpeaker({ actor: game.user }),
        style: (CONST as any).CHAT_MESSAGE_STYLES?.OTHER || 0, // Use style instead of deprecated type
        whisper: whisperTargets,
        flags: {
          [MODULE_ID]: {
            rollButtons: {
              [buttonId]: {
                rolled: false,
                rollFormula,
                rollLabel: buttonLabel,
                isPublic: data.isPublic,
                characterId: playerInfo.character?.id || '',
                targetUserId: playerInfo.user?.id || '',
              },
            },
          },
        },
      };

      const chatMessage = await ChatMessage.create(messageData);

      // Store message ID for later updates
      this.saveRollButtonMessageId(buttonId, chatMessage.id);

      // Note: Click handlers are attached globally via renderChatMessageHTML hook in main.ts
      // This ensures all users get the handlers when they see the message

      return {
        success: true,
        message: `Roll request sent to ${playerInfo.targetName}. ${data.isPublic ? 'Public roll' : 'Private roll'} button created in chat.`,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Error creating roll request:`, error);
      return {
        success: false,
        message: '',
        error: error instanceof Error ? error.message : 'Unknown error creating roll request',
      };
    }
  }

  /**
   * Enhanced player resolution with offline/non-existent player detection
   * Supports partial matching and provides structured error messages for MCP
   */
  private resolveTargetPlayer(targetPlayer: string): {
    found: boolean;
    user?: User;
    character?: Actor;
    targetName: string;
    errorType?: 'PLAYER_OFFLINE' | 'PLAYER_NOT_FOUND' | 'CHARACTER_NOT_FOUND';
    errorMessage?: string;
  } {
    const searchTerm = targetPlayer.toLowerCase().trim();

    // FIRST: Check all registered users (both active and inactive) for player name match
    const allUsers = Array.from(game.users?.values() || []);

    // Try exact player name match first (active and inactive users)
    let user = allUsers.find((u: User) => u.name?.toLowerCase() === searchTerm);

    if (user) {
      const isActive = user.active;

      if (!isActive) {
        // Player exists but is offline
        return {
          found: false,
          user,
          targetName: user.name || 'Unknown Player',
          errorType: 'PLAYER_OFFLINE',
          errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
        };
      }

      // Find the player's character for roll calculations
      const playerCharacter = game.actors?.find((actor: Actor) => {
        if (!user) return false;
        return actor.testUserPermission(user, 'OWNER') && !user.isGM;
      });

      return {
        found: true,
        user,
        ...(playerCharacter && { character: playerCharacter }), // Include character only if found
        targetName: user.name || 'Unknown Player',
      };
    }

    // Try partial player name match (active and inactive users)
    if (!user) {
      user = allUsers.find((u: User) => {
        return Boolean(u.name?.toLowerCase().includes(searchTerm));
      });

      if (user) {
        const isActive = user.active;

        if (!isActive) {
          // Player exists but is offline
          return {
            found: false,
            user,
            targetName: user.name || 'Unknown Player',
            errorType: 'PLAYER_OFFLINE',
            errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
          };
        }

        // Find the player's character for roll calculations
        const playerCharacter = game.actors?.find((actor: Actor) => {
          if (!user) return false;
          return actor.testUserPermission(user, 'OWNER') && !user.isGM;
        });

        return {
          found: true,
          user,
          ...(playerCharacter && { character: playerCharacter }), // Include character only if found
          targetName: user.name || 'Unknown Player',
        };
      }
    }

    // SECOND: Try to find by character name (exact match, then partial match)
    let character = game.actors?.find(
      (actor: Actor) => actor.name?.toLowerCase() === searchTerm && actor.hasPlayerOwner
    );

    if (character) {
    }

    // If no exact character match, try partial match
    if (!character) {
      character = game.actors?.find((actor: Actor) => {
        return Boolean(actor.name?.toLowerCase().includes(searchTerm) && actor.hasPlayerOwner);
      });

      if (character) {
      }
    }

    if (character) {
      // Find the actual player owner (not GM) of this character
      const ownerUser = allUsers.find(
        (u: User) => character.testUserPermission(u, 'OWNER') && !u.isGM
      );

      if (ownerUser) {
        const isOwnerActive = ownerUser.active;

        if (!isOwnerActive) {
          // Character owner exists but is offline
          return {
            found: false,
            user: ownerUser,
            character,
            targetName: ownerUser.name || 'Unknown Player',
            errorType: 'PLAYER_OFFLINE',
            errorMessage: `Player "${ownerUser.name}" (owner of character "${character.name}") is registered but not currently logged in. They need to be online to receive roll requests.`,
          };
        }

        return {
          found: true,
          user: ownerUser,
          character,
          targetName: ownerUser.name || 'Unknown Player',
        };
      } else {
        // No player owner found - character is GM-only controlled
        // Still return found=true but without user, GM can still roll for it
        return {
          found: true,
          character,
          targetName: character.name || 'Unknown Character',
          // user is omitted (undefined) for GM-only characters
        };
      }
    }

    // THIRD: Check if the search term might be a character that exists but has no player owner
    const anyCharacter = game.actors?.find((actor: Actor) => {
      if (!actor.name) return false;
      return (
        actor.name.toLowerCase() === searchTerm || actor.name.toLowerCase().includes(searchTerm)
      );
    });

    if (anyCharacter && !anyCharacter.hasPlayerOwner) {
      return {
        found: true,
        character: anyCharacter,
        targetName: anyCharacter.name || 'Unknown Character',
        // No user for GM-controlled characters
      };
    }

    // No player or character found at all

    return {
      found: false,
      targetName: targetPlayer,
      errorType: 'PLAYER_NOT_FOUND',
      errorMessage: `No player or character named "${targetPlayer}" found. Available players: ${
        allUsers
          .filter(u => !u.isGM)
          .map(u => u.name)
          .join(', ') || 'none'
      }`,
    };
  }

  /**
   * Build roll formula based on roll type and target using Foundry's roll data system
   */
  private buildRollFormula(
    rollType: string,
    rollTarget: string,
    rollModifier: string,
    character?: Actor
  ): string {
    let baseFormula = '1d20';

    if (character) {
      // Use Foundry's getRollData() to get calculated modifiers including active effects
      const rollData = character.getRollData() as any; // Type assertion for Foundry's dynamic roll data

      switch (rollType) {
        case 'ability':
          // Use calculated ability modifier from roll data
          const abilityMod = rollData.abilities?.[rollTarget]?.mod ?? 0;
          baseFormula = `1d20+${abilityMod}`;
          break;

        case 'skill':
          // Map skill name to skill code (D&D 5e uses 3-letter codes)
          const skillCode = this.getSkillCode(rollTarget);
          // Use calculated skill total from roll data (includes ability mod + proficiency + bonuses)
          const skillMod = rollData.skills?.[skillCode]?.total ?? 0;
          baseFormula = `1d20+${skillMod}`;
          break;

        case 'save':
          // Use saving throw modifier from roll data
          const saveMod =
            rollData.abilities?.[rollTarget]?.save ?? rollData.abilities?.[rollTarget]?.mod ?? 0;
          baseFormula = `1d20+${saveMod}`;
          break;

        case 'initiative':
          // Use initiative modifier from attributes or dex mod
          const initMod = rollData.attributes?.init?.mod ?? rollData.abilities?.dex?.mod ?? 0;
          baseFormula = `1d20+${initMod}`;
          break;

        case 'custom':
          baseFormula = rollTarget; // Use rollTarget as the formula directly
          break;

        default:
          baseFormula = '1d20';
      }
    } else {
      console.warn(`[${MODULE_ID}] No character provided for roll formula, using base 1d20`);
    }

    // Add modifier if provided
    if (rollModifier && rollModifier.trim()) {
      const modifier =
        rollModifier.startsWith('+') || rollModifier.startsWith('-')
          ? rollModifier
          : `+${rollModifier}`;
      baseFormula += modifier;
    }

    return baseFormula;
  }

  /**
   * Map skill names to D&D 5e skill codes
   */
  private getSkillCode(skillName: string): string {
    const skillMap: { [key: string]: string } = {
      acrobatics: 'acr',
      'animal handling': 'ani',
      animalhandling: 'ani',
      arcana: 'arc',
      athletics: 'ath',
      deception: 'dec',
      history: 'his',
      insight: 'ins',
      intimidation: 'itm',
      investigation: 'inv',
      medicine: 'med',
      nature: 'nat',
      perception: 'prc',
      performance: 'prf',
      persuasion: 'per',
      religion: 'rel',
      'sleight of hand': 'slt',
      sleightofhand: 'slt',
      stealth: 'ste',
      survival: 'sur',
    };

    const normalizedName = skillName.toLowerCase().replace(/\s+/g, '');
    const skillCode =
      skillMap[normalizedName] || skillMap[skillName.toLowerCase()] || skillName.toLowerCase();

    return skillCode;
  }

  /**
   * Build roll button label
   */
  private buildRollButtonLabel(rollType: string, rollTarget: string, isPublic: boolean): string {
    const visibility = isPublic ? 'Public' : 'Private';

    switch (rollType) {
      case 'ability':
        return `${rollTarget.toUpperCase()} Ability Check (${visibility})`;
      case 'skill':
        return `${rollTarget.charAt(0).toUpperCase() + rollTarget.slice(1)} Skill Check (${visibility})`;
      case 'save':
        return `${rollTarget.toUpperCase()} Saving Throw (${visibility})`;
      case 'attack':
        return `${rollTarget} Attack (${visibility})`;
      case 'initiative':
        return `Initiative Roll (${visibility})`;
      case 'custom':
        return `Custom Roll (${visibility})`;
      default:
        return `Roll (${visibility})`;
    }
  }

  /**
   * Restore roll button states from persistent storage
   * Called when chat messages are rendered to maintain state across sessions
   */

  /**
   * Attach click handlers to roll buttons and handle visibility
   * Called by global renderChatMessageHTML hook in main.ts
   */
  public attachRollButtonHandlers(html: JQuery): void {
    const currentUserId = game.user?.id;
    const isGM = game.user?.isGM;

    // Note: Roll state restoration now handled by ChatMessage content, not DOM manipulation

    // Handle button visibility and styling based on permissions and public/private status
    // IMPORTANT: Skip styling for buttons that are already in rolled state
    html.find('.mcp-roll-button').each((_index, element) => {
      const button = $(element);
      const targetUserId = button.data('target-user-id');
      const isPublicRollRaw = button.data('is-public');
      const isPublicRoll = isPublicRollRaw === true || isPublicRollRaw === 'true';

      // Note: No need to check for rolled state - ChatMessage.update() replaces buttons with completion status

      // Determine if user can interact with this button
      const canClickButton = isGM || (targetUserId && targetUserId === currentUserId);

      if (isPublicRoll) {
        // Public roll: show to all players, but style differently for non-clickable users
        if (canClickButton) {
          // Can click: normal active button
          button.css({
            background: '#4CAF50',
            cursor: 'pointer',
            opacity: '1',
          });
        } else {
          // Cannot click: disabled/informational style
          button.css({
            background: '#9E9E9E',
            cursor: 'not-allowed',
            opacity: '0.7',
          });
          button.prop('disabled', true);
        }
      } else {
        // Private roll: only show to target user and GM
        if (canClickButton) {
          button.show();
        } else {
          button.hide();
        }
      }
    });

    // Attach click handlers to roll buttons
    html.find('.mcp-roll-button').on('click', async event => {
      const button = $(event.currentTarget);

      // Ignore clicks on disabled buttons
      if (button.prop('disabled')) {
        return;
      }

      // Prevent double-clicks by immediately disabling the button
      button.prop('disabled', true);
      const originalText = button.text();
      button.text('🎲 Rolling...');

      // Check if this button is already being processed by another user
      const buttonId = button.data('button-id');
      if (buttonId && this.isRollButtonProcessing(buttonId)) {
        button.text('🎲 Processing...');
        return;
      }

      // Mark this button as being processed
      if (buttonId) {
        this.setRollButtonProcessing(buttonId, true);
      }

      // Validate button has required data
      if (!buttonId) {
        console.warn(`[${MODULE_ID}] Button missing button-id data attribute`);
        button.prop('disabled', false);
        button.text(originalText);
        return;
      }

      const rollFormula = button.data('roll-formula');
      const rollLabel = button.data('roll-label');
      const isPublicRaw = button.data('is-public');
      const isPublic = isPublicRaw === true || isPublicRaw === 'true'; // Convert to proper boolean
      const characterId = button.data('character-id');
      const targetUserId = button.data('target-user-id');
      const isGmRoll = game.user?.isGM || false; // Determine if this is a GM executing the roll

      // Check if user has permission to execute this roll
      // Allow GM to roll for any character, or allow character owner to roll for their character
      const canExecuteRoll = game.user?.isGM || (targetUserId && targetUserId === game.user?.id);

      if (!canExecuteRoll) {
        console.warn(`[${MODULE_ID}] Permission denied for roll execution`);
        ui.notifications?.warn('You do not have permission to execute this roll');
        return;
      }

      try {
        // Create and evaluate the roll
        const roll = new Roll(rollFormula);
        await roll.evaluate();

        // Get the character for speaker info
        const character = characterId ? game.actors?.get(characterId) : null;

        // Use the modern Foundry v13 approach with roll.toMessage()
        const rollMode = isPublic ? 'publicroll' : 'whisper';
        const whisperTargets: string[] = [];

        if (!isPublic) {
          // For private rolls: whisper to target + GM
          if (targetUserId) {
            whisperTargets.push(targetUserId);
          }
          // Add all active GMs
          const gmUsers = game.users?.filter((u: User) => u.isGM && u.active);
          if (gmUsers) {
            for (const gm of gmUsers) {
              if (gm.id && !whisperTargets.includes(gm.id)) {
                whisperTargets.push(gm.id);
              }
            }
          }
        }

        const messageData: any = {
          speaker: ChatMessage.getSpeaker({ actor: character }),
          flavor: `${rollLabel} ${isGmRoll ? '(GM Override)' : ''}`,
          ...(whisperTargets.length > 0 ? { whisper: whisperTargets } : {}),
        };

        // Use roll.toMessage() with proper rollMode
        await roll.toMessage(messageData, {
          create: true,
          rollMode,
        });

        // Update the ChatMessage to reflect rolled state
        const buttonId = button.data('button-id');
        if (buttonId && game.user?.id) {
          try {
            await this.updateRollButtonMessage(buttonId, game.user.id, rollLabel);
          } catch (updateError) {
            console.error(`[${MODULE_ID}] Failed to update chat message:`, updateError);
            console.error(
              `[${MODULE_ID}] Error details:`,
              updateError instanceof Error ? updateError.stack : updateError
            );
            // Fall back to DOM manipulation if message update fails
            button.prop('disabled', true).text('✓ Rolled');
          }
        } else {
          console.warn(`[${MODULE_ID}] Cannot update ChatMessage - missing buttonId or userId:`, {
            buttonId,
            userId: game.user?.id,
          });
        }
      } catch (error) {
        console.error(`[${MODULE_ID}] Error executing roll:`, error);
        ui.notifications?.error('Failed to execute roll');

        // Re-enable button on error so user can try again
        button.prop('disabled', false);
        button.text(originalText);
      } finally {
        // Clear processing state
        if (buttonId) {
          this.setRollButtonProcessing(buttonId, false);
        }
      }
    });
  }

  /**
   * Get enhanced creature index for campaign analysis
   */
  async getEnhancedCreatureIndex(): Promise<any[]> {
    this.validateFoundryState();

    // Get the enhanced creature index (builds if needed)
    const enhancedCreatures = await this.persistentIndex.getEnhancedIndex();

    return enhancedCreatures || [];
  }

  /**
   * Save roll button state to persistent storage
   */
  async saveRollState(buttonId: string, userId: string): Promise<void> {
    // LEGACY METHOD - Redirecting to new ChatMessage.update() system

    try {
      // Use the new ChatMessage.update() approach instead
      const rollLabel = 'Legacy Roll'; // We don't have the label here, use generic
      await this.updateRollButtonMessage(buttonId, userId, rollLabel);
    } catch (error) {
      console.error(`[${MODULE_ID}] Legacy saveRollState redirect failed:`, error);
      // Don't throw - we don't want to break the old system completely
    }
  }

  /**
   * Get roll button state from persistent storage
   */
  getRollState(
    buttonId: string
  ): { rolled: boolean; rolledBy?: string; rolledByName?: string; timestamp?: number } | null {
    this.validateFoundryState();

    try {
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      return rollStates[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting roll state:`, error);
      return null;
    }
  }

  /**
   * Save button ID to message ID mapping for ChatMessage updates
   */
  saveRollButtonMessageId(buttonId: string, messageId: string): void {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      buttonMessageMap[buttonId] = messageId;
      game.settings.set(MODULE_ID, 'buttonMessageMap', buttonMessageMap);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error saving button-message mapping:`, error);
    }
  }

  /**
   * Get message ID for a roll button
   */
  getRollButtonMessageId(buttonId: string): string | null {
    try {
      const buttonMessageMap = game.settings.get(MODULE_ID, 'buttonMessageMap') || {};
      return buttonMessageMap[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting button-message mapping:`, error);
      return null;
    }
  }

  /**
   * Get roll button state from ChatMessage flags
   */
  getRollStateFromMessage(chatMessage: any, buttonId: string): any {
    try {
      const rollButtons = chatMessage.getFlag(MODULE_ID, 'rollButtons');
      return rollButtons?.[buttonId] || null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting roll state from message:`, error);
      return null;
    }
  }

  /**
   * Update the ChatMessage to replace button with rolled state
   */
  async updateRollButtonMessage(
    buttonId: string,
    userId: string,
    rollLabel: string
  ): Promise<void> {
    try {
      // Get the message ID for this button
      const messageId = this.getRollButtonMessageId(buttonId);

      if (!messageId) {
        throw new Error(`No message ID found for button ${buttonId}`);
      }

      // Get the chat message
      const chatMessage = game.messages?.get(messageId);

      if (!chatMessage) {
        throw new Error(`ChatMessage ${messageId} not found`);
      }

      const rolledByName = game.users?.get(userId)?.name || 'Unknown';
      const timestamp = new Date().toLocaleString();

      // Check permissions before attempting update
      const canUpdate = chatMessage.canUserModify(game.user, 'update');

      if (!canUpdate && !game.user?.isGM) {
        // Non-GM user cannot update message - request GM to do it via socket

        // Find online GM
        const onlineGM = game.users?.find(u => u.isGM && u.active);
        if (!onlineGM) {
          throw new Error('No Game Master is online to update the chat message');
        }

        // Send socket request to GM
        if (game.socket) {
          game.socket.emit('module.foundry-mcp-bridge', {
            type: 'requestMessageUpdate',
            buttonId,
            userId,
            rollLabel,
            messageId,
            fromUserId: game.user.id,
            targetGM: onlineGM.id,
          });
          return; // Exit early - GM will handle the update
        } else {
          throw new Error('Socket not available for GM communication');
        }
      }

      // Update the message flags to mark button as rolled
      const currentFlags = chatMessage.flags || {};
      const moduleFlags = currentFlags[MODULE_ID] || {};
      const rollButtons = moduleFlags.rollButtons || {};

      rollButtons[buttonId] = {
        ...rollButtons[buttonId],
        rolled: true,
        rolledBy: userId,
        rolledByName,
        timestamp: Date.now(),
      };

      // Create the rolled state HTML
      const rolledHtml = `
        <div class="mcp-roll-request" style="margin: 10px 0; padding: 10px; border: 1px solid #ccc; border-radius: 5px; background: #f9f9f9;">
          <p><strong>Roll Request:</strong> ${rollLabel}</p>
          <p><strong>Status:</strong> ✅ <strong>Completed by ${rolledByName}</strong> at ${timestamp}</p>
        </div>
      `;

      // Update the message content and flags
      await chatMessage.update({
        content: rolledHtml,
        flags: {
          ...currentFlags,
          [MODULE_ID]: {
            ...moduleFlags,
            rollButtons,
          },
        },
      });
    } catch (error) {
      console.error(`[${MODULE_ID}] Error updating roll button message:`, error);
      console.error(`[${MODULE_ID}] Error stack:`, error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  /**
   * Request GM to save roll state (for non-GM users who can't write to world settings)
   */
  requestRollStateSave(buttonId: string, userId: string): void {
    // LEGACY METHOD - Redirecting to new ChatMessage.update() system

    try {
      // Use the new ChatMessage.update() approach instead
      const rollLabel = 'Legacy Roll'; // We don't have the label here, use generic
      this.updateRollButtonMessage(buttonId, userId, rollLabel)
        .then(() => {})
        .catch(error => {
          console.error(`[${MODULE_ID}] Legacy requestRollStateSave redirect failed:`, error);
          // If the new system fails, just log it - don't use the old socket system
        });
    } catch (error) {
      console.error(`[${MODULE_ID}] Error in legacy requestRollStateSave redirect:`, error);
    }
  }

  /**
   * Broadcast roll state change to all connected users for real-time sync
   */
  broadcastRollState(_buttonId: string, _rollState: any): void {
    // LEGACY METHOD - No longer needed with ChatMessage.update() system
    // ChatMessage.update() automatically broadcasts to all clients, so this method is no longer needed
  }

  /**
   * Clean up old roll states (optional maintenance)
   * Removes roll states older than 30 days to prevent storage bloat
   */
  async cleanOldRollStates(): Promise<number> {
    this.validateFoundryState();

    try {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const rollStates = game.settings.get(MODULE_ID, 'rollStates') || {};
      let cleanedCount = 0;

      // Remove old roll states
      for (const [buttonId, rollState] of Object.entries(rollStates)) {
        if (rollState && typeof rollState === 'object' && 'timestamp' in rollState) {
          const timestamp = (rollState as any).timestamp;
          if (typeof timestamp === 'number' && timestamp < thirtyDaysAgo) {
            delete rollStates[buttonId];
            cleanedCount++;
          }
        }
      }

      if (cleanedCount > 0) {
        await game.settings.set(MODULE_ID, 'rollStates', rollStates);
      }

      return cleanedCount;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error cleaning old roll states:`, error);
      return 0;
    }
  }

  /**
   * Set actor ownership permission for a user
   */
  async setActorOwnership(data: {
    actorId: string;
    userId: string;
    permission: number;
  }): Promise<{ success: boolean; message: string; error?: string }> {
    this.validateFoundryState();

    try {
      const actor = game.actors?.get(data.actorId);
      if (!actor) {
        return { success: false, error: `Actor not found: ${data.actorId}`, message: '' };
      }

      const user = game.users?.get(data.userId);
      if (!user) {
        return { success: false, error: `User not found: ${data.userId}`, message: '' };
      }

      // Get current ownership
      const currentOwnership = (actor as any).ownership || {};
      const newOwnership = { ...currentOwnership };

      // Set the new permission level
      newOwnership[data.userId] = data.permission;

      // Update the actor
      await actor.update({ ownership: newOwnership });

      const permissionNames = { 0: 'NONE', 1: 'LIMITED', 2: 'OBSERVER', 3: 'OWNER' };
      const permissionName =
        permissionNames[data.permission as keyof typeof permissionNames] ||
        data.permission.toString();

      return {
        success: true,
        message: `Set ${actor.name} ownership to ${permissionName} for ${user.name}`,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Error setting actor ownership:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: '',
      };
    }
  }

  /**
   * Update a WFRP4e actor's stat block (characteristics and/or wounds).
   * Writes initial/advances/modifier and wounds value/max; WFRP4e recomputes
   * the derived characteristic value/bonus on update.
   */
  async updateWfrp4eActor(data: {
    actor: string;
    characteristics?: Record<string, { initial?: number; advances?: number; modifier?: number }>;
    wounds?: { value?: number; max?: number };
    skills?: Array<{ name: string; advances: number }>;
    career?: string;
    movement?: number;
    biography?: string;
  }): Promise<any> {
    this.validateFoundryState();

    const systemId = (game.system as any).id;
    if (systemId !== 'wfrp4e') {
      return {
        success: false,
        error: `wfrp4e-update-actor requires the WFRP4e system (current: "${systemId}")`,
      };
    }

    // Resolve a world actor by id/name, or a scene token by id (an unlinked
    // token resolves to its own synthetic actor — see findActorByIdentifier).
    const actor = this.findActorByIdentifier(data.actor);
    if (!actor) {
      return { success: false, error: `Actor not found: ${data.actor}` };
    }

    const CHAR_KEYS = ['ws', 'bs', 's', 't', 'i', 'ag', 'dex', 'int', 'wp', 'fel'];
    const FIELDS = ['initial', 'advances', 'modifier'] as const;
    const sys = actor.system || {};
    const update: Record<string, any> = {};
    const itemUpdates: Array<Record<string, any>> = [];
    const applied: {
      characteristics: Record<string, any>;
      wounds: Record<string, any>;
      skills: Record<string, any>;
      career?: string;
      details?: Record<string, any>;
    } = {
      characteristics: {},
      wounds: {},
      skills: {},
    };
    const warnings: string[] = [];

    if (data.characteristics) {
      for (const [rawKey, fields] of Object.entries(data.characteristics)) {
        const key = rawKey.toLowerCase();
        if (!CHAR_KEYS.includes(key)) {
          warnings.push(`Unknown characteristic "${rawKey}" — skipped`);
          continue;
        }
        const current = sys.characteristics?.[key] || {};
        const record: Record<string, any> = {};
        for (const field of FIELDS) {
          const val = (fields as any)[field];
          if (val !== undefined) {
            update[`system.characteristics.${key}.${field}`] = val;
            record[field] = { from: current[field], to: val };
          }
        }
        if (Object.keys(record).length > 0) {
          applied.characteristics[key.toUpperCase()] = record;
        }
      }
    }

    if (data.wounds) {
      const current = sys.status?.wounds || {};
      if (data.wounds.value !== undefined) {
        update['system.status.wounds.value'] = data.wounds.value;
        applied.wounds.value = { from: current.value, to: data.wounds.value };
      }
      if (data.wounds.max !== undefined) {
        update['system.status.wounds.max'] = data.wounds.max;
        applied.wounds.max = { from: current.max, to: data.wounds.max };
      }
    }

    // Detail fields: base movement and the biography/notes text.
    if (data.movement !== undefined) {
      update['system.details.move.value'] = data.movement;
      applied.details = applied.details || {};
      applied.details.movement = { from: sys.details?.move?.value, to: data.movement };
    }
    if (data.biography !== undefined) {
      update['system.details.biography.value'] = data.biography;
      applied.details = applied.details || {};
      applied.details.biography = { chars: data.biography.length };
    }

    // Existing embedded-item edits: bump advances on skills the actor already
    // has, and/or switch which career item is current. (Adding new skills or
    // careers is wfrp4e-add-items' job.)
    if (Array.isArray(data.skills)) {
      for (const s of data.skills) {
        const item = actor.items.find(
          (i: any) => i.type === 'skill' && i.name?.toLowerCase() === s.name.toLowerCase()
        );
        if (!item) {
          warnings.push(`Skill "${s.name}" not on ${actor.name} — use wfrp4e-add-items to add it.`);
          continue;
        }
        itemUpdates.push({ _id: item.id, 'system.advances.value': s.advances });
        applied.skills[item.name] = {
          advances: { from: item.system?.advances?.value, to: s.advances },
        };
      }
    }

    if (data.career) {
      const target = actor.items.find(
        (i: any) => i.type === 'career' && i.name?.toLowerCase() === data.career?.toLowerCase()
      );
      if (!target) {
        warnings.push(
          `Career "${data.career}" not on ${actor.name} — use wfrp4e-add-items to add it.`
        );
      } else {
        // Exactly one career is current; flip the target on and the rest off.
        for (const it of actor.items) {
          if (it.type === 'career') {
            itemUpdates.push({ _id: it.id, 'system.current.value': it.id === target.id });
          }
        }
        applied.career = target.name;
      }
    }

    if (Object.keys(update).length === 0 && itemUpdates.length === 0) {
      return {
        success: false,
        error: 'No valid fields to update.',
        ...(warnings.length ? { warnings } : {}),
      };
    }

    try {
      if (Object.keys(update).length > 0) {
        await actor.update(update);
      }
      if (itemUpdates.length > 0) {
        await actor.updateEmbeddedDocuments('Item', itemUpdates);
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Error updating WFRP4e actor:`, error);
      this.auditLog(
        'updateWfrp4eActor',
        { actor: data.actor },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Read back recomputed characteristic totals as confirmation.
    const after = actor.system || {};
    const newTotals: Record<string, any> = {};
    for (const key of CHAR_KEYS) {
      if (applied.characteristics[key.toUpperCase()]) {
        const c = after.characteristics?.[key];
        if (c) newTotals[key.toUpperCase()] = { total: c.value, bonus: c.bonus };
      }
    }

    this.auditLog('updateWfrp4eActor', { actor: data.actor }, 'success');

    return {
      success: true,
      actor: actor.name,
      id: actor.id,
      applied,
      newCharacteristicTotals: newTotals,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /**
   * Add items (skills, talents, traits, trappings, careers, weapons, spells, …)
   * to an existing WFRP4e actor. Each requested item is matched by name against
   * the installed WFRP4e compendiums and copied in full, so a skill keeps its
   * linked characteristic, a talent its tests/max, a career its progression.
   * Names with no compendium match are added as a blank item of the requested
   * (or default) type so homebrew still works.
   *
   * Per-item extras: `advances` sets a skill's advances; `quantity` sets a
   * gear count; `setCurrent` makes a career the active one (flipping the others
   * off). Resolution prefers the Core Rulebook pack, then the rest; pass `type`
   * and/or `pack` to disambiguate a name that exists in several places.
   */
  async addWfrp4eItems(data: {
    actor: string;
    items: Array<{
      name: string;
      type?: string;
      pack?: string;
      advances?: number;
      quantity?: number;
      setCurrent?: boolean;
    }>;
  }): Promise<any> {
    this.validateFoundryState();

    const systemId = (game.system as any).id;
    if (systemId !== 'wfrp4e') {
      return {
        success: false,
        error: `wfrp4e-add-items requires the WFRP4e system (current: "${systemId}")`,
      };
    }

    if (!Array.isArray(data.items) || data.items.length === 0) {
      return {
        success: false,
        error: 'items array is required and must contain at least one entry',
      };
    }

    const actor = this.findActorByIdentifier(data.actor);
    if (!actor) {
      return { success: false, error: `Actor not found: ${data.actor}` };
    }

    // Candidate Item packs, Core Rulebook first so a name shared across books
    // resolves to the canonical entry.
    const itemPacks: any[] = Array.from((game.packs as any) || []).filter(
      (p: any) => (p.metadata?.type ?? p.documentName) === 'Item'
    );
    itemPacks.sort((a: any, b: any) => {
      const rank = (p: any) => (String(p.metadata?.id || '').startsWith('wfrp4e-core') ? 0 : 1);
      return rank(a) - rank(b);
    });

    // Per-call index cache — each pack's index is loaded at most once.
    const indexCache = new Map<string, any>();
    const getIndex = async (pack: any) => {
      const id = pack.metadata.id;
      if (!indexCache.has(id)) indexCache.set(id, await pack.getIndex());
      return indexCache.get(id);
    };

    const warnings: string[] = [];
    const notFound: string[] = [];
    const ambiguous: Array<{ name: string; candidates: Array<{ pack: string; type: string }> }> =
      [];

    // Skill advances and gear quantity are baked into each item's creation data
    // (below) rather than patched afterwards, because createEmbeddedDocuments
    // does not guarantee it returns documents in the order we send them — so
    // positional alignment between the created docs and our requests is unsafe.
    const GEAR_TYPES = new Set([
      'weapon',
      'armour',
      'trapping',
      'ammunition',
      'container',
      'money',
      'cargo',
    ]);
    const applyExtras = (obj: Record<string, any>, type: string, req: any): void => {
      obj.system = obj.system || {};
      if (req.advances !== undefined && type === 'skill') {
        obj.system.advances = { ...(obj.system.advances || {}), value: req.advances };
      }
      if (req.quantity !== undefined && GEAR_TYPES.has(type)) {
        obj.system.quantity = { ...(obj.system.quantity || {}), value: req.quantity };
      }
    };

    const toCreate: Array<Record<string, any>> = [];
    // Keyed by `${type}::${name}` (the created doc's own name/type) so we can
    // match created documents back to their request without relying on order.
    const plan: Array<{
      nameLower: string;
      type: string;
      setCurrent: boolean | undefined;
      source: string;
    }> = [];

    // Find every compendium entry whose name (and optional type) matches, across
    // the candidate packs (their core-first order is preserved in the result).
    const findMatches = async (
      packs: any[],
      searchName: string,
      typeConstraint: string | undefined
    ): Promise<Array<{ packId: string; packLabel: string; entryId: string; type: string }>> => {
      const found: Array<{ packId: string; packLabel: string; entryId: string; type: string }> = [];
      for (const pack of packs) {
        const index = await getIndex(pack);
        for (const entry of index) {
          if (
            entry.name?.toLowerCase() === searchName &&
            (!typeConstraint || entry.type === typeConstraint)
          ) {
            found.push({
              packId: pack.metadata.id,
              packLabel: pack.metadata.label,
              entryId: entry._id,
              type: entry.type,
            });
          }
        }
      }
      return found;
    };

    for (const req of data.items) {
      const nameLower = req.name.toLowerCase();
      const typeWanted = req.type?.toLowerCase();
      const searchPacks = req.pack
        ? itemPacks.filter(
            (p: any) => p.metadata.id === req.pack || p.metadata.id.includes(req.pack as string)
          )
        : itemPacks;

      let matches = await findMatches(searchPacks, nameLower, typeWanted);

      // Grouped-skill fallback: a specialisation like "Entertain (Taunt)" often
      // has no dedicated entry, but the group's generic template "Entertain ()"
      // does — copy that (it carries the correct characteristic and grouping)
      // and rename the copy to the requested specialisation.
      let nameOverride: string | undefined;
      let templated = false;
      if (matches.length === 0 && (typeWanted === undefined || typeWanted === 'skill')) {
        const grouped = /^\s*(.+?)\s*\([^)]+\)\s*$/.exec(req.name);
        if (grouped) {
          const templateName = `${grouped[1]} ()`.toLowerCase();
          const templateMatches = await findMatches(searchPacks, templateName, 'skill');
          if (templateMatches.length > 0) {
            matches = templateMatches;
            nameOverride = req.name.trim();
            templated = true;
          }
        }
      }

      if (matches.length === 0) {
        const fallbackType = typeWanted || 'trapping';
        const obj: Record<string, any> = { name: req.name, type: fallbackType, system: {} };
        applyExtras(obj, fallbackType, req);
        toCreate.push(obj);
        plan.push({
          nameLower,
          type: fallbackType,
          setCurrent: req.setCurrent,
          source: 'custom (not in compendium)',
        });
        notFound.push(req.name);
        warnings.push(
          `"${req.name}" not found in any WFRP4e compendium — added as a blank ${fallbackType}.`
        );
        continue;
      }

      // Several distinct item types share this name and the caller didn't pick
      // one — don't guess.
      const distinctTypes = [...new Set(matches.map(m => m.type))];
      if (!typeWanted && distinctTypes.length > 1) {
        ambiguous.push({
          name: req.name,
          candidates: matches.map(m => ({ pack: m.packId, type: m.type })),
        });
        warnings.push(
          `"${req.name}" matches multiple item types (${distinctTypes.join(', ')}); pass "type" to choose — skipped.`
        );
        continue;
      }

      // matches preserves the core-first pack order, so [0] is the best source.
      const chosen = matches[0];
      const pack = (game.packs as any).get(chosen.packId);
      const sourceDoc = await pack.getDocument(chosen.entryId);
      const obj = sourceDoc.toObject();
      const finalName = nameOverride ?? obj.name;
      const clean: Record<string, any> = {
        name: finalName,
        type: obj.type,
        img: obj.img,
        system: obj.system || {},
        effects: obj.effects || [],
        flags: obj.flags || {},
      };
      applyExtras(clean, obj.type, req);
      toCreate.push(clean);
      plan.push({
        nameLower: String(finalName).toLowerCase(),
        type: obj.type,
        setCurrent: req.setCurrent,
        source: templated ? `${chosen.packLabel} (grouped template)` : chosen.packLabel,
      });
    }

    if (toCreate.length === 0) {
      return {
        success: false,
        error: 'No items could be added.',
        ...(notFound.length ? { notFound } : {}),
        ...(ambiguous.length ? { ambiguous } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
    }

    let created: any[] = [];
    try {
      created = (await actor.createEmbeddedDocuments('Item', toCreate)) || [];

      // Make a career current if requested. Match the created career by NAME,
      // not by position (see the ordering note above). Exactly one career is
      // current, so flip the target on and every other career off.
      const setCurrentNames = new Set(
        plan.filter(p => p.setCurrent && p.type === 'career').map(p => p.nameLower)
      );
      if (setCurrentNames.size > 0) {
        let targetId: string | undefined;
        for (const doc of created) {
          if (doc.type === 'career' && setCurrentNames.has(String(doc.name).toLowerCase())) {
            targetId = doc.id;
          }
        }
        if (targetId) {
          const careerUpdates: Array<Record<string, any>> = [];
          for (const it of actor.items) {
            if (it.type === 'career') {
              careerUpdates.push({ _id: it.id, 'system.current.value': it.id === targetId });
            }
          }
          if (careerUpdates.length > 0) {
            await actor.updateEmbeddedDocuments('Item', careerUpdates);
          }
        }
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Error adding WFRP4e items:`, error);
      this.auditLog(
        'addWfrp4eItems',
        { actor: data.actor, count: toCreate.length },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Summarise, reading back derived skill totals / career state as confirmation.
    // Source is looked up by name+type (order-independent).
    const sourceByKey = new Map<string, string>();
    for (const p of plan) sourceByKey.set(`${p.type}::${p.nameLower}`, p.source);

    const createdSummary = created.map((doc: any) => {
      const after = actor.items.get(doc.id);
      const entry: Record<string, any> = {
        id: doc.id,
        name: doc.name,
        type: doc.type,
        source: sourceByKey.get(`${doc.type}::${String(doc.name).toLowerCase()}`) ?? 'unknown',
      };
      if (after?.type === 'skill') {
        entry.advances = after.system?.advances?.value;
        entry.total = after.system?.total?.value;
        entry.characteristic = after.system?.characteristic?.value;
      }
      if (after?.type === 'career') entry.current = after.system?.current?.value ?? false;
      return entry;
    });

    this.auditLog('addWfrp4eItems', { actor: data.actor, count: created.length }, 'success');

    return {
      success: true,
      actor: actor.name,
      id: actor.id,
      created: createdSummary,
      ...(notFound.length ? { notFound } : {}),
      ...(ambiguous.length ? { ambiguous } : {}),
      ...(warnings.length ? { warnings } : {}),
    };
  }

  /**
   * Get actor ownership information
   */
  async getActorOwnership(data: {
    actorIdentifier?: string;
    playerIdentifier?: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      const actors = data.actorIdentifier
        ? data.actorIdentifier === 'all'
          ? Array.from(game.actors || [])
          : [this.findActorByIdentifier(data.actorIdentifier)].filter(Boolean)
        : Array.from(game.actors || []);

      const users = data.playerIdentifier
        ? [
            game.users?.getName(data.playerIdentifier) || game.users?.get(data.playerIdentifier),
          ].filter(Boolean)
        : Array.from(game.users || []);

      const ownershipInfo = [];
      const permissionNames = { 0: 'NONE', 1: 'LIMITED', 2: 'OBSERVER', 3: 'OWNER' };

      for (const actor of actors) {
        const actorInfo: any = {
          id: actor.id,
          name: actor.name,
          type: actor.type,
          ownership: [],
        };

        for (const user of users.filter(u => u && !u.isGM)) {
          const permission = actor.testUserPermission(user, 'OWNER')
            ? 3
            : actor.testUserPermission(user, 'OBSERVER')
              ? 2
              : actor.testUserPermission(user, 'LIMITED')
                ? 1
                : 0;

          actorInfo.ownership.push({
            userId: user!.id,
            userName: user!.name,
            permission: permissionNames[permission as keyof typeof permissionNames],
            numericPermission: permission,
          });
        }

        ownershipInfo.push(actorInfo);
      }

      return ownershipInfo;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting actor ownership:`, error);
      throw error;
    }
  }

  /**
   * Find actor by name or ID
   */
  private findActorByIdentifier(identifier: string): any {
    const worldActor =
      game.actors?.get(identifier) ||
      game.actors?.getName(identifier) ||
      Array.from(game.actors || []).find(a =>
        a.name?.toLowerCase().includes(identifier.toLowerCase())
      );
    if (worldActor) return worldActor;

    // Fallback: a scene Token id. For an unlinked token this returns the token's
    // own synthetic (delta-backed) actor, so edits persist to that token alone —
    // the way to tweak one copy on a map without touching the prototype or its
    // siblings. (For a linked token this is the world actor, same as above.)
    for (const scene of (game.scenes as any) || []) {
      const token = scene.tokens?.get(identifier);
      if (token?.actor) return token.actor;
    }
    return undefined;
  }

  /**
   * Get friendly NPCs from current scene
   */
  async getFriendlyNPCs(): Promise<Array<{ id: string; name: string }>> {
    this.validateFoundryState();

    try {
      const scene = game.scenes?.find(s => s.active);
      if (!scene) {
        return [];
      }

      const friendlyTokens = scene.tokens.filter(
        (token: any) => token.disposition === 1 // FRIENDLY disposition
      );

      return friendlyTokens
        .map((token: any) => ({
          id: token.actor?.id || token.id || '',
          name: token.name || token.actor?.name || 'Unknown',
        }))
        .filter(t => t.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting friendly NPCs:`, error);
      return [];
    }
  }

  /**
   * Get party characters (player-owned actors)
   */
  async getPartyCharacters(): Promise<Array<{ id: string; name: string }>> {
    this.validateFoundryState();

    try {
      const partyCharacters = Array.from(game.actors || []).filter(
        actor => actor.hasPlayerOwner && actor.type === 'character'
      );

      return partyCharacters
        .map(actor => ({
          id: actor.id || '',
          name: actor.name || 'Unknown',
        }))
        .filter(c => c.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting party characters:`, error);
      return [];
    }
  }

  /**
   * Get connected players (excluding GM)
   */
  async getConnectedPlayers(): Promise<Array<{ id: string; name: string }>> {
    this.validateFoundryState();

    try {
      const connectedPlayers = Array.from(game.users || []).filter(
        user => user.active && !user.isGM
      );

      return connectedPlayers
        .map(user => ({
          id: user.id || '',
          name: user.name || 'Unknown',
        }))
        .filter(u => u.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting connected players:`, error);
      return [];
    }
  }

  /**
   * Find players by identifier with partial matching
   */
  async findPlayers(data: {
    identifier: string;
    allowPartialMatch?: boolean;
    includeCharacterOwners?: boolean;
  }): Promise<Array<{ id: string; name: string }>> {
    this.validateFoundryState();

    try {
      const { identifier, allowPartialMatch = true, includeCharacterOwners = true } = data;
      const searchTerm = identifier.toLowerCase();
      const players = [];

      // Direct user name matching
      for (const user of game.users || []) {
        if (user.isGM) continue;

        const userName = user.name?.toLowerCase() || '';
        if (userName === searchTerm || (allowPartialMatch && userName.includes(searchTerm))) {
          players.push({ id: user.id || '', name: user.name || 'Unknown' });
        }
      }

      // Character name matching (find owner of character)
      if (includeCharacterOwners && players.length === 0) {
        for (const actor of game.actors || []) {
          if (actor.type !== 'character') continue;

          const actorName = actor.name?.toLowerCase() || '';
          if (actorName === searchTerm || (allowPartialMatch && actorName.includes(searchTerm))) {
            // Find the player owner of this character
            const owner = game.users?.find(
              user => actor.testUserPermission(user, 'OWNER') && !user.isGM
            );

            if (owner && !players.some(p => p.id === owner.id)) {
              players.push({ id: owner.id || '', name: owner.name || 'Unknown' });
            }
          }
        }
      }

      return players.filter(p => p.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error finding players:`, error);
      return [];
    }
  }

  /**
   * Find single actor by identifier
   */
  async findActor(data: { identifier: string }): Promise<{ id: string; name: string } | null> {
    this.validateFoundryState();

    try {
      const actor = this.findActorByIdentifier(data.identifier);
      return actor ? { id: actor.id, name: actor.name } : null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error finding actor:`, error);
      return null;
    }
  }

  // Private storage for tracking roll button processing states
  private rollButtonProcessingStates: Map<string, boolean> = new Map();

  /**
   * Check if a roll button is currently being processed
   */
  private isRollButtonProcessing(buttonId: string): boolean {
    return this.rollButtonProcessingStates.get(buttonId) || false;
  }

  /**
   * Set roll button processing state
   */
  private setRollButtonProcessing(buttonId: string, processing: boolean): void {
    if (processing) {
      this.rollButtonProcessingStates.set(buttonId, true);
    } else {
      this.rollButtonProcessingStates.delete(buttonId);
    }
  }

  /**
   * Resolve a folder by name, id, or "/"-separated path, creating any missing folders
   * along the way. Examples:
   *   "NPCs"                       -> flat folder "NPCs" (unchanged legacy behaviour)
   *   "NPCs/Bosses/Act 1"          -> walks or creates NPCs -> Bosses -> Act 1, returns leaf id
   *   "<existing folder id>"       -> returned as-is if it exists and matches `type`
   * Segments are trimmed; empty segments (leading/trailing/double slashes) are ignored.
   * Each segment is matched by name + type + parent, so "Heroes/Bosses" and
   * "Villains/Bosses" produce two distinct "Bosses" folders under different parents.
   * Returns null on failure so callers can fall back to creating content unfiled.
   */
  /**
   * The inverse of resolveFolderPath: given a Folder document (or null), walk up
   * `.folder` to the root and return a "/"-separated path, e.g. "Homebrew/Classes".
   * Returns '' for a document sitting at the root.
   *
   * Foundry caps folder nesting, so the walk is bounded anyway, but the depth guard
   * is there so a cyclic or corrupt folder graph can never hang the client — this
   * runs inside the GM's browser, and an infinite loop here freezes their Foundry.
   *
   * Segments are returned raw (a Foundry folder name may contain "/" or characters
   * illegal in a filename); sanitising for disk is the MCP server's job, not this one.
   */
  private folderPathOf(folder: any): string {
    const segments: string[] = [];
    let current = folder;
    let depth = 0;
    const seen = new Set<string>();
    while (current && depth < 32) {
      if (current.id) {
        if (seen.has(current.id)) break; // cycle guard
        seen.add(current.id);
      }
      segments.unshift(current.name ?? '');
      current = current.folder ?? null;
      depth += 1;
    }
    return segments.join('/');
  }

  private async resolveFolderPath(
    pathOrName: string,
    // Folder document type: 'Actor' | 'JournalEntry' | 'Item' | 'Scene' | 'RollTable' | ...
    type: string
  ): Promise<string | null> {
    try {
      const raw = (pathOrName ?? '').trim();
      if (!raw) return null;

      // Exact id match wins (back-compat: some callers pass a folder id, not a name)
      const byId = (game as any).folders?.get?.(raw);
      if (byId && byId.type === type) return byId.id;

      const segments = raw
        .split('/')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      if (segments.length === 0) return null;

      // Foundry caps folder nesting at CONST.FOLDER_MAX_DEPTH (4 since v11).
      // Exceeding it makes Folder.create reject, which used to surface as the
      // content being created unfiled with no warning at all. Fail loudly and
      // up front instead — the cap itself is a core engine limit we can't lift.
      const maxDepth = Number((globalThis as any).CONST?.FOLDER_MAX_DEPTH ?? 4);
      if (Number.isFinite(maxDepth) && segments.length > maxDepth) {
        throw folderPathError(
          `Folder path "${raw}" is ${segments.length} levels deep, but Foundry allows at most ` +
            `${maxDepth} (CONST.FOLDER_MAX_DEPTH). Shorten the path to ${maxDepth} levels or fewer — ` +
            `this is a core Foundry limit, not a bridge restriction.`
        );
      }

      const color = type === 'Actor' ? '#4a90e2' : type === 'JournalEntry' ? '#f39c12' : undefined;

      let parentId: string | null = null;
      let leafId: string | null = null;

      for (const name of segments) {
        const existing = (game as any).folders?.find(
          (f: any) =>
            f.type === type && f.name === name && (f.folder?.id ?? f.folder ?? null) === parentId
        );

        if (existing) {
          parentId = existing.id;
          leafId = existing.id;
          continue;
        }

        const created = await (Folder as any).create({
          name,
          type,
          folder: parentId, // Foundry v10+ nests folders via the `folder` field
          color,
          sort: 0,
          flags: {
            'foundry-mcp-bridge': {
              mcpGenerated: true,
              createdAt: new Date().toISOString(),
            },
          },
        });

        parentId = created?.id ?? null;
        leafId = created?.id ?? null;
        if (!leafId) {
          // Foundry rejected the create and returned nothing. Previously this
          // returned null and the caller silently filed the content nowhere.
          throw folderPathError(
            `Foundry refused to create the folder "${name}" while resolving "${raw}" ` +
              `(segment ${segments.indexOf(name) + 1} of ${segments.length}). Nothing was filed ` +
              `into a folder. This usually means the nesting depth limit was hit.`
          );
        }
      }

      return leafId;
    } catch (error) {
      // Depth/creation failures are real errors the caller must see — silently
      // filing content at the root is what made these bugs so hard to spot.
      if (isFolderPathError(error)) throw error;
      console.warn(`[${this.moduleId}] Failed to resolve folder path "${pathOrName}":`, error);
      // Return null so content is created without a folder rather than failing outright
      return null;
    }
  }

  /**
   * Get or create a folder for organizing MCP-generated content.
   * Thin wrapper around resolveFolderPath so a "/"-separated name nests.
   */
  private async getOrCreateFolder(
    folderName: string,
    type: 'Actor' | 'JournalEntry'
  ): Promise<string | null> {
    return this.resolveFolderPath(folderName, type);
  }

  /** Full "/"-joined path from the root down to (and including) this folder. */
  private folderFullPath(folder: any): string {
    const names: string[] = [];
    let cur: any = folder;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.folder ?? null;
    }
    return names.join('/');
  }

  /** Resolve an existing folder by id or "/"-path. Does NOT create. */
  private findFolderByPath(idOrPath: string, type?: string): any {
    const raw = (idOrPath ?? '').trim();
    if (!raw) return null;
    const byId = (game as any).folders?.get?.(raw);
    if (byId && (!type || byId.type === type)) return byId;

    const segments = raw
      .split('/')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0);
    if (!segments.length) return null;

    let parentId: string | null = null;
    let match: any = null;
    for (const name of segments) {
      match =
        (game as any).folders?.find(
          (f: any) =>
            (!type || f.type === type) &&
            f.name === name &&
            (f.folder?.id ?? f.folder ?? null) === parentId
        ) ?? null;
      if (!match) return null;
      parentId = match.id;
    }
    return match;
  }

  /**
   * Folder management: list / delete / rename / move folders of any document type.
   */
  async manageFolders(params: {
    action: 'list' | 'delete' | 'rename' | 'move';
    type?: string;
    id?: string;
    ids?: string[];
    path?: string;
    paths?: string[];
    newName?: string;
    newParent?: string | null;
    deleteContents?: boolean;
    deleteSubfolders?: boolean;
  }): Promise<any> {
    this.validateFoundryState();
    const all: any[] = Array.from((game as any).folders ?? []);

    if (params.action === 'list') {
      const wantType = params.type;
      const prefix = (params.path ?? '').trim().replace(/\/+$/, '');
      const rows = all
        .filter((f: any) => !wantType || f.type === wantType)
        .map((f: any) => {
          const fullPath = this.folderFullPath(f);
          return {
            id: f.id,
            name: f.name,
            type: f.type,
            path: fullPath,
            depth: fullPath.split('/').length - 1,
            parentId: f.folder?.id ?? f.folder ?? null,
            contents: (f.contents ?? []).length,
            subfolders: all.filter((c: any) => (c.folder?.id ?? c.folder ?? null) === f.id).length,
          };
        })
        .filter((r: any) => !prefix || r.path === prefix || r.path.startsWith(`${prefix}/`))
        .sort((a: any, b: any) => a.type.localeCompare(b.type) || a.path.localeCompare(b.path));
      return { folders: rows, total: rows.length };
    }

    // delete / rename / move all operate on target folder(s)
    const targets: any[] = [];
    const notFound: string[] = [];
    const push = (ref: string) => {
      const f = this.findFolderByPath(ref, params.type);
      if (f) targets.push(f);
      else notFound.push(ref);
    };
    if (params.id) push(params.id);
    if (params.path) push(params.path);
    for (const x of params.ids ?? []) push(x);
    for (const x of params.paths ?? []) push(x);

    if (!targets.length) {
      throw new Error(
        `No folder found for: ${[...(params.id ? [params.id] : []), ...(params.path ? [params.path] : []), ...(params.ids ?? []), ...(params.paths ?? [])].join(', ') || '(nothing specified)'}`
      );
    }

    if (params.action === 'delete') {
      const deleteContents = params.deleteContents === true;
      const deleteSubfolders = params.deleteSubfolders !== false; // default true
      const deleted: Array<{ id: string; name: string; path: string }> = [];
      for (const f of targets) {
        const path = this.folderFullPath(f);
        await f.delete({ deleteSubfolders, deleteContents });
        deleted.push({ id: f.id, name: f.name, path });
      }
      this.auditLog('manageFolders.delete', { count: deleted.length, deleteContents }, 'success');
      return { deleted, notFound, deleteContents, deleteSubfolders };
    }

    if (params.action === 'rename') {
      const newName = params.newName?.trim();
      if (!newName) throw new Error('newName is required for rename');
      const f = targets[0];
      await f.update({ name: newName });
      return {
        renamed: { id: f.id, name: newName, path: this.folderFullPath(f) },
        notFound,
      };
    }

    if (params.action === 'move') {
      const f = targets[0];
      let newParentId: string | null = null;
      const np = (params.newParent ?? '').toString().trim();
      if (np) {
        newParentId = await this.resolveFolderPath(np, f.type);
        if (!newParentId) throw new Error(`Could not resolve destination parent: ${np}`);
      }
      await f.update({ folder: newParentId });
      return { moved: { id: f.id, name: f.name, path: this.folderFullPath(f) }, notFound };
    }

    throw new Error(`Unknown manage-folders action: ${params.action}`);
  }

  /**
   * List all scenes with filtering options
   */
  async listScenes(
    options: { filter?: string; include_active_only?: boolean } = {}
  ): Promise<any[]> {
    this.validateFoundryState();

    try {
      let scenes = game.scenes?.contents || [];

      // Filter by active only if requested
      if (options.include_active_only) {
        scenes = scenes.filter((scene: any) => scene.active);
      }

      // Filter by name if provided
      if (options.filter) {
        const filterLower = options.filter.toLowerCase();
        scenes = scenes.filter((scene: any) => scene.name.toLowerCase().includes(filterLower));
      }

      // Map to consistent format
      return scenes.map((scene: any) => ({
        id: scene.id,
        name: scene.name,
        active: scene.active,
        dimensions: {
          width: scene.dimensions?.width || scene.width || 0,
          height: scene.dimensions?.height || scene.height || 0,
        },
        gridSize: scene.grid?.size || 100,
        // Foundry v14 removed Scene#background; the image now lives on the Scene's first
        // Level document instead (see foundry.documents.Level / LevelData#background).
        background:
          scene._source?.background?.src ||
          scene.levels?.contents?.[0]?.background?.src ||
          scene.img ||
          '',
        walls: scene.walls?.size || 0,
        tokens: scene.tokens?.size || 0,
        lighting: scene.lights?.size || 0,
        sounds: scene.sounds?.size || 0,
        navigation: scene.navigation || false,
      }));
    } catch (error) {
      throw new Error(
        `Failed to list scenes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Switch to a different scene
   */
  async switchScene(options: { scene_identifier: string; optimize_view?: boolean }): Promise<any> {
    this.validateFoundryState();

    try {
      // Find the target scene by ID or name
      const scenes = game.scenes?.contents || [];
      const targetScene = scenes.find(
        (scene: any) =>
          scene.id === options.scene_identifier ||
          scene.name.toLowerCase() === options.scene_identifier.toLowerCase()
      );

      if (!targetScene) {
        throw new Error(`Scene not found: "${options.scene_identifier}"`);
      }

      // Activate the scene
      await targetScene.activate();

      // Optimize view if requested (default true)
      if (options.optimize_view !== false && typeof canvas !== 'undefined' && canvas?.scene) {
        const dimensions = targetScene.dimensions || {
          width: (targetScene as any).width || 0,
          height: (targetScene as any).height || 0,
        };
        const width = (dimensions as any).width || 0;
        const height = (dimensions as any).height || 0;

        if (width && height) {
          // Center the view on the scene
          await canvas.pan({
            x: width / 2,
            y: height / 2,
            scale: Math.min(
              (canvas as any).screenDimensions?.[0] / width || 1,
              (canvas as any).screenDimensions?.[1] / height || 1,
              1
            ),
          });
        }
      }

      return {
        success: true,
        sceneId: targetScene.id,
        sceneName: targetScene.name,
        dimensions: {
          width: (targetScene.dimensions as any)?.width || (targetScene as any).width || 0,
          height: (targetScene.dimensions as any)?.height || (targetScene as any).height || 0,
        },
      };
    } catch (error) {
      throw new Error(
        `Failed to switch scene: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ===== PHASE 7: CHARACTER ENTITY AND TOKEN MANIPULATION METHODS =====

  /**
   * Get detailed information about a specific entity within a character (item, action, or effect)
   */
  async getCharacterEntity(data: {
    characterIdentifier: string;
    entityIdentifier: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      // Find the character first
      const actors = game.actors?.contents || [];
      const character = actors.find(
        (actor: any) =>
          actor.id === data.characterIdentifier ||
          actor.name.toLowerCase() === data.characterIdentifier.toLowerCase()
      );

      if (!character) {
        throw new Error(`Character not found: "${data.characterIdentifier}"`);
      }

      // Search in items first (by ID or name)
      const items = character.items?.contents || [];
      let entity = items.find(
        (item: any) =>
          item.id === data.entityIdentifier ||
          item.name.toLowerCase() === data.entityIdentifier.toLowerCase()
      );

      if (entity) {
        return {
          success: true,
          entityType: 'item',
          entity: {
            id: entity.id,
            name: entity.name,
            type: entity.type,
            img: entity.img,
            description: entity.system?.description?.value || entity.system?.description || '',
            system: entity.system,
          },
        };
      }

      // Search in actions (for systems that have actions as separate entities)
      if ((character as any).system?.actions) {
        const actions = Array.isArray((character as any).system.actions)
          ? (character as any).system.actions
          : Object.values((character as any).system.actions || {});

        entity = actions.find(
          (action: any) =>
            action.id === data.entityIdentifier ||
            action.name?.toLowerCase() === data.entityIdentifier.toLowerCase()
        );

        if (entity) {
          return {
            success: true,
            entityType: 'action',
            entity,
          };
        }
      }

      // Search in effects
      const effects = character.effects?.contents || [];
      entity = effects.find(
        (effect: any) =>
          effect.id === data.entityIdentifier ||
          effect.name?.toLowerCase() === data.entityIdentifier.toLowerCase()
      );

      if (entity) {
        return {
          success: true,
          entityType: 'effect',
          entity: {
            id: entity.id,
            name: entity.name || entity.label,
            icon: entity.icon,
            disabled: entity.disabled,
            duration: entity.duration,
            changes: entity.changes,
          },
        };
      }

      throw new Error(
        `Entity not found: "${data.entityIdentifier}" in character "${character.name}"`
      );
    } catch (error) {
      throw new Error(
        `Failed to get character entity: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Move a token to a new position on the scene
   */
  async moveToken(data: {
    tokenId: string;
    x: number;
    y: number;
    animate?: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Update token position
      await token.update(
        {
          x: data.x,
          y: data.y,
        },
        { animate: data.animate !== false }
      );

      this.auditLog('moveToken', data, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        newPosition: { x: data.x, y: data.y },
        animated: data.animate !== false,
      };
    } catch (error) {
      this.auditLog(
        'moveToken',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to move token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update token properties
   */
  async updateToken(data: { tokenId: string; updates: Record<string, any> }): Promise<any> {
    this.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Filter out undefined values
      const cleanUpdates = Object.fromEntries(
        Object.entries(data.updates).filter(([_, v]) => v !== undefined)
      );
      const requestedProperties = Object.keys(cleanUpdates);

      // PF2e derives a token's disposition from the linked actor's alliance on every
      // data-prep pass, so a direct token.disposition write silently reverts. Route the
      // request to the actor instead. SECRET (-2) has no alliance equivalent, so it
      // still falls through to the normal token update.
      if (
        (game.system as any)?.id === 'pf2e' &&
        cleanUpdates.disposition !== undefined &&
        cleanUpdates.disposition !== -2 &&
        token.actor
      ) {
        const allianceByDisposition: Record<number, string | null> = {
          [-1]: 'opposition',
          [0]: null,
          [1]: 'party',
        };
        if (cleanUpdates.disposition in allianceByDisposition) {
          await token.actor.update({
            'system.details.alliance': allianceByDisposition[cleanUpdates.disposition as number],
          });
          delete cleanUpdates.disposition;
        }
      }

      // Apply updates
      if (Object.keys(cleanUpdates).length > 0) {
        await token.update(cleanUpdates);
      }

      this.auditLog('updateToken', { tokenId: data.tokenId, updates: cleanUpdates }, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        updatedProperties: requestedProperties,
      };
    } catch (error) {
      this.auditLog(
        'updateToken',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to update token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete one or more tokens from the scene
   */
  async deleteTokens(data: { tokenIds: string[] }): Promise<any> {
    this.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: data.tokenIds,
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const deletedTokens: string[] = [];
      const failedTokens: string[] = [];

      for (const tokenId of data.tokenIds) {
        try {
          const token = scene.tokens.get(tokenId);
          if (token) {
            await token.delete();
            deletedTokens.push(tokenId);
          } else {
            failedTokens.push(tokenId);
          }
        } catch (error) {
          failedTokens.push(tokenId);
        }
      }

      this.auditLog(
        'deleteTokens',
        { tokenIds: data.tokenIds, deletedCount: deletedTokens.length },
        'success'
      );

      return {
        success: true,
        deletedCount: deletedTokens.length,
        deletedTokens,
        failedTokens: failedTokens.length > 0 ? failedTokens : undefined,
      };
    } catch (error) {
      this.auditLog(
        'deleteTokens',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to delete tokens: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get detailed information about a token
   */
  async getTokenDetails(data: { tokenId: string }): Promise<any> {
    this.validateFoundryState();

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      // Return flat structure that matches MCP server expectations
      return {
        success: true,
        id: token.id,
        name: token.name,
        x: token.x,
        y: token.y,
        width: token.width,
        height: token.height,
        rotation: token.rotation,
        scale: token.texture?.scaleX || 1,
        alpha: token.alpha,
        hidden: token.hidden,
        disposition: token.disposition,
        elevation: token.elevation,
        lockRotation: token.lockRotation,
        img: token.texture?.src,
        actorId: token.actor?.id,
        actorData: token.actor
          ? {
              name: token.actor.name,
              type: token.actor.type,
              img: token.actor.img,
            }
          : null,
        actorLink: token.actorLink,
      };
    } catch (error) {
      throw new Error(
        `Failed to get token details: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Toggle a status condition on a token
   */
  async toggleTokenCondition(data: {
    tokenId: string;
    conditionId: string;
    active: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    // Use permission system
    const permissionCheck = permissionManager.checkWritePermission('modifyScene', {
      targetIds: [data.tokenId],
    });

    if (!permissionCheck.allowed) {
      throw new Error(`${ERROR_MESSAGES.ACCESS_DENIED}: ${permissionCheck.reason}`);
    }

    try {
      const scene = (game.scenes as any).current;
      if (!scene) {
        throw new Error('No active scene found');
      }

      const token = scene.tokens.get(data.tokenId);
      if (!token) {
        throw new Error(`Token ${data.tokenId} not found in current scene`);
      }

      const actor = token.actor;
      if (!actor) {
        throw new Error(`Token ${data.tokenId} has no associated actor`);
      }

      // Get the condition configuration for the game system.
      // CONFIG.statusEffects is an array in core Foundry and most systems (D&D5e, DSA5),
      // but PF2e replaces it with a slug-keyed object. Normalise to an array so the
      // .find()/.map() calls below work regardless of system.
      const rawStatusEffects = (CONFIG as any).statusEffects;
      const conditions: any[] = Array.isArray(rawStatusEffects)
        ? rawStatusEffects
        : Object.values(rawStatusEffects ?? {});
      const condition = conditions.find(
        (c: any) =>
          c.id === data.conditionId || c.name?.toLowerCase() === data.conditionId.toLowerCase()
      );

      if (!condition) {
        throw new Error(`Condition not found: ${data.conditionId}`);
      }

      if (data.active) {
        // Add the condition - handle DSA5 and other systems
        const effectData: any = {
          name: condition.name || condition.label || condition.id,
          icon: condition.icon || condition.img,
        };

        // Add statuses for systems that support it (D&D5e, PF2e)
        if (condition.id) {
          effectData.statuses = [condition.id];
        }

        // DSA5-specific: Copy all properties from the condition
        // DSA5 conditions have different structure than D&D5e/PF2e
        if ((game.system as any)?.id === 'dsa5') {
          // For DSA5, use the condition's full data structure
          Object.assign(effectData, {
            flags: condition.flags || {},
            changes: condition.changes || [],
            duration: condition.duration || {},
            origin: condition.origin,
          });
        }

        await actor.createEmbeddedDocuments('ActiveEffect', [effectData]);
      } else {
        // Remove the condition
        const effects = actor.effects?.contents || [];
        const effectsToRemove = effects.filter((effect: any) => {
          // Check by status (D&D5e, PF2e)
          if (effect.statuses?.has(data.conditionId)) {
            return true;
          }
          // Check by name (fallback for all systems including DSA5)
          if (effect.name?.toLowerCase() === data.conditionId.toLowerCase()) {
            return true;
          }
          // Check by label (some systems use label instead of name)
          if (effect.label?.toLowerCase() === data.conditionId.toLowerCase()) {
            return true;
          }
          return false;
        });

        if (effectsToRemove.length > 0) {
          await actor.deleteEmbeddedDocuments(
            'ActiveEffect',
            effectsToRemove.map((e: any) => e.id)
          );
        }
      }

      this.auditLog('toggleTokenCondition', data, 'success');

      return {
        success: true,
        tokenId: token.id,
        tokenName: token.name,
        conditionId: data.conditionId,
        conditionName: condition.name || condition.label || condition.id,
        isActive: data.active,
        active: data.active,
        message: data.active
          ? `Applied ${data.conditionId} to ${token.name}`
          : `Removed ${data.conditionId} from ${token.name}`,
      };
    } catch (error) {
      this.auditLog(
        'toggleTokenCondition',
        data,
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to toggle token condition: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get all available conditions for the current game system
   */
  async getAvailableConditions(): Promise<any> {
    this.validateFoundryState();

    try {
      // CONFIG.statusEffects is an array in core Foundry and most systems (D&D5e, DSA5),
      // but PF2e replaces it with a slug-keyed object. Normalise to an array.
      const rawStatusEffects = (CONFIG as any).statusEffects;
      const conditions: any[] = Array.isArray(rawStatusEffects)
        ? rawStatusEffects
        : Object.values(rawStatusEffects ?? {});

      return {
        success: true,
        gameSystem: game.system?.id,
        conditions: conditions.map((condition: any) => ({
          id: condition.id,
          name: condition.name || condition.label || condition.id,
          icon: condition.icon || condition.img,
          description: condition.description || '',
        })),
      };
    } catch (error) {
      throw new Error(
        `Failed to get available conditions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Move a token to a new position
   */

  /**
   * Use an item on a character (cast spell, use ability, consume item, etc.)
   * This triggers the item's default use behavior in Foundry VTT
   */
  async useItem(params: {
    actorIdentifier: string;
    itemIdentifier: string;
    targets?: string[] | undefined; // Target character/token names or IDs. "self" targets the caster.
    options?:
      | {
          consume?: boolean | undefined; // Whether to consume charges/uses
          configureDialog?: boolean | undefined; // Whether to show configuration dialog
          skipDialog?: boolean | undefined; // Skip confirmation dialogs (default: true for MCP)
          spellLevel?: number | undefined; // For spells: cast at higher level
          versatile?: boolean | undefined; // For versatile weapons: use versatile damage
        }
      | undefined;
  }): Promise<{
    success: boolean;
    status?: string;
    message: string;
    itemName?: string;
    actorName?: string;
    targets?: string[];
    requiresGMInteraction?: boolean;
  }> {
    this.validateFoundryState();

    const { actorIdentifier, itemIdentifier, targets, options = {} } = params;

    // Find the actor
    const actor = this.findActorByIdentifier(actorIdentifier);
    if (!actor) {
      throw new Error(`Actor not found: ${actorIdentifier}`);
    }

    // Find the item on the actor
    const item = actor.items.find(
      (i: any) => i.id === itemIdentifier || i.name.toLowerCase() === itemIdentifier.toLowerCase()
    );

    if (!item) {
      throw new Error(`Item "${itemIdentifier}" not found on actor "${actor.name}"`);
    }

    const itemAny = item;
    const systemId = (game.system as any).id;

    // Handle targeting if targets are specified
    const resolvedTargetNames: string[] = [];
    if (targets && targets.length > 0) {
      // Get all tokens on the current scene
      const scene = (game.scenes as any)?.active;
      if (!scene) {
        throw new Error('No active scene to find targets on');
      }

      const sceneTokens = scene.tokens;
      const tokenIds: string[] = [];

      for (const targetIdentifier of targets) {
        // Handle "self" - target the caster's token
        if (targetIdentifier.toLowerCase() === 'self') {
          // Find token for the caster actor
          const selfToken = sceneTokens.find(
            (t: any) => t.actor?.id === actor.id || t.actorId === actor.id
          );
          if (selfToken) {
            tokenIds.push(selfToken.id);
            resolvedTargetNames.push(actor.name);
          } else {
            console.warn(
              `[foundry-mcp-bridge] No token found on scene for actor "${actor.name}" (self)`
            );
          }
          continue;
        }

        // Find token by name or ID
        const targetToken = sceneTokens.find(
          (t: any) =>
            t.id === targetIdentifier ||
            t.name?.toLowerCase() === targetIdentifier.toLowerCase() ||
            t.actor?.name?.toLowerCase() === targetIdentifier.toLowerCase()
        );

        if (targetToken) {
          tokenIds.push(targetToken.id);
          resolvedTargetNames.push(targetToken.name || targetToken.actor?.name || targetIdentifier);
        } else {
          console.warn(`[foundry-mcp-bridge] Target not found: "${targetIdentifier}"`);
        }
      }

      // Set targets using Foundry's targeting system
      if (tokenIds.length > 0 && game.user) {
        await (game.user as any).updateTokenTargets(tokenIds);
        console.log(`[foundry-mcp-bridge] Set targets: ${resolvedTargetNames.join(', ')}`);
      }
    }

    try {
      // For items that may show dialogs (spells with choices, etc.),
      // we fire-and-forget to avoid timeout issues. The GM will interact
      // with the dialog in Foundry, and the result appears in chat.

      // Check if item has a use() method (common in D&D 5e, PF2e)
      if (typeof itemAny.use === 'function') {
        // D&D 5e and similar systems
        // Only pass options that D&D 5e's item.use() expects
        const useOptions: Record<string, any> = {
          createMessage: true,
        };

        // D&D 5e specific options
        if (systemId === 'dnd5e') {
          useOptions.consumeResource = options.consume ?? true;
          useOptions.consumeSpellSlot = options.consume ?? true;
          useOptions.consumeUsage = options.consume ?? true;
          // Always show dialog so GM can make choices
          useOptions.configureDialog = true;
        }

        // Spell level for upcasting
        if (options.spellLevel !== undefined) {
          useOptions.slotLevel = options.spellLevel; // D&D 5e
          useOptions.level = options.spellLevel; // generic
        }

        // Fire and forget - don't await, as dialogs block the promise
        itemAny.use(useOptions).catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else if (typeof itemAny.toChat === 'function') {
        // PF2e and some other systems use toChat
        if (typeof itemAny.toMessage === 'function') {
          itemAny.toMessage(undefined, { create: true }).catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        } else {
          itemAny.toChat().catch((err: Error) => {
            console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
          });
        }
      } else if (typeof itemAny.roll === 'function') {
        // Some items have a roll method
        itemAny.roll().catch((err: Error) => {
          console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
        });
      } else if (systemId === 'dsa5') {
        // DSA5 specific handling
        if (
          item.type === 'spell' ||
          item.type === 'liturgy' ||
          item.type === 'ceremony' ||
          item.type === 'ritual'
        ) {
          if (typeof itemAny.postItem === 'function') {
            itemAny.postItem().catch((err: Error) => {
              console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
            });
          } else if (typeof itemAny.setupEffect === 'function') {
            itemAny.setupEffect().catch((err: Error) => {
              console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
            });
          } else {
            // Fallback: create a chat message describing the item
            const chatData = {
              user: game.user?.id,
              speaker: ChatMessage.getSpeaker({ actor }),
              content: `<h3>${item.name}</h3><p>${actor.name} uses ${item.name}.</p>`,
            };
            ChatMessage.create(chatData);
          }
        } else {
          if (typeof itemAny.postItem === 'function') {
            itemAny.postItem().catch((err: Error) => {
              console.error(`[foundry-mcp-bridge] Error using item ${item.name}:`, err);
            });
          }
        }
      } else {
        // Generic fallback: create a chat message
        const chatData = {
          user: game.user?.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<h3>${item.name}</h3><p>${actor.name} uses ${item.name}.</p>`,
        };
        ChatMessage.create(chatData);
      }

      this.auditLog(
        'useItem',
        {
          actorId: actor.id,
          itemId: item.id,
          itemName: item.name,
          targets: resolvedTargetNames,
        },
        'success'
      );

      const targetInfo =
        resolvedTargetNames.length > 0 ? ` targeting ${resolvedTargetNames.join(', ')}` : '';

      const result: {
        success: boolean;
        status?: string;
        message: string;
        itemName?: string;
        actorName?: string;
        targets?: string[];
        requiresGMInteraction?: boolean;
      } = {
        success: true,
        status: 'initiated',
        message: `Item use initiated for ${actor.name} using ${item.name}${targetInfo}. If a dialog appeared in Foundry VTT, the GM should select options and confirm. The result will appear in chat.`,
        itemName: item.name,
        actorName: actor.name,
        requiresGMInteraction: true,
      };

      if (resolvedTargetNames.length > 0) {
        result.targets = resolvedTargetNames;
      }

      return result;
    } catch (error) {
      this.auditLog(
        'useItem',
        {
          actorId: actor.id,
          itemId: item.id,
        },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );

      throw new Error(
        `Failed to use item "${item.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // ===== D&D 5E FEATURE CREATION =====

  /**
   * Add a save-attack feature (feat) to an existing D&D 5e actor.
   * Creates a single save Activity with damage and an optional area template.
   */
  async addSaveFeatureToActor(data: {
    actorIdentifier: string;
    featureName: string;
    description: string;
    activationType: string;
    saveAbility: string;
    saveDC: number;
    damageParts: Array<{ number: number; denomination: number; type: string }>;
    halfOnSave: boolean;
    areaType: string;
    areaSize?: number;
    areaUnits: string;
    affectsType: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      // 1. Lookup actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. System guard
      if ((game.system as any).id !== 'dnd5e') {
        throw new Error(
          `addSaveFeatureToActor requires D&D 5e. ` +
            `Current system: "${(game.system as any).id}".`
        );
      }

      // 3. Duplicate check (by name only, regardless of item type)
      const existing = actor.items.find((i: any) => i.name === data.featureName);
      if (existing) {
        throw new Error(
          `Feature "${data.featureName}" already exists on actor "${actor.name}" ` +
            `(id: ${existing.id}). Use a different name or remove the existing feature first.`
        );
      }

      // 4. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 5. Slug identifier
      const identifier = slugify(data.featureName);

      // 5a. Map emanation → radius (Foundry uses "radius" for radial emanations)
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 6. Build item data — schema verified against dnd5e 5.1.8 real output
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description, chat: '' },
          identifier,
          source: { revision: 1, rules: '2024' },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'save',
              sort: 0,
              name: '',
              activation: {
                type: data.activationType,
                override: false,
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true,
                targets: [],
              },
              description: {},
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] },
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits,
                  count: '',
                  type: mappedAreaType,
                  size: mappedAreaType ? String(data.areaSize) : '',
                },
                affects: {
                  choice: false,
                  count: '',
                  type: data.affectsType,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.halfOnSave ? 'half' : 'none',
                parts: data.damageParts.map(p => ({
                  custom: { enabled: false, formula: '' },
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  types: [p.type],
                  scaling: { mode: '', number: 1 },
                })),
              },
              save: {
                ability: [data.saveAbility],
                dc: {
                  calculation: '',
                  formula: String(data.saveDC),
                },
              },
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];

      this.auditLog(
        'addSaveFeatureToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      // 8. Return structured result
      return {
        success: true,
        item: { id: created.id, name: created.name },
        actor: { id: actor.id, name: actor.name },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add save feature to actor`, error);
      this.auditLog(
        'addSaveFeatureToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ===== CREATE NPC ACTOR (D&D 5e) =====

  async createNpcActor(data: {
    name: string;
    creatureType: string;
    creatureSubtype: string;
    size: string;
    alignment: string;
    cr: string | number;
    hpAverage: number;
    hpFormula: string;
    acMode: string;
    acValue?: number;
    abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
    savingThrows: string[];
    walkSpeed: number;
    flySpeed: number;
    swimSpeed: number;
    climbSpeed: number;
    burrowSpeed: number;
    hover: boolean;
    darkvision: number;
    blindsight: number;
    tremorsense: number;
    truesight: number;
    specialSenses: string;
    skills: Array<{ skill: string; proficiency: string }>;
    damageImmunities: string[];
    damageResistances: string[];
    damageVulnerabilities: string[];
    conditionImmunities: string[];
    languages: string[];
    languagesCustom: string;
    biography: string;
    sourceBook: string;
    sourcePage: string;
    sourceRules: string;
  }): Promise<any> {
    this.validateFoundryState();

    try {
      // 1. System guard
      if ((game.system as any).id !== 'dnd5e') {
        throw new Error(
          `createNpcActor requires D&D 5e. ` + `Current system: "${(game.system as any).id}".`
        );
      }

      // 2. Duplicate check by name — only against other NPCs, so a player
      //    character sharing the name does not block NPC creation.
      const existingActor = game.actors?.find((a: any) => a.name === data.name && a.type === 'npc');
      if (existingActor) {
        throw new Error(
          `NPC "${data.name}" already exists (id: ${existingActor.id}). ` +
            `Use a different name or remove the existing NPC first.`
        );
      }

      // 3. Soft validation — collect warnings, do NOT block creation
      const warnings: string[] = [];
      const allDamageValues: Array<{ field: string; value: string }> = [
        ...data.damageImmunities.map(v => ({ field: 'damageImmunities', value: v })),
        ...data.damageResistances.map(v => ({ field: 'damageResistances', value: v })),
        ...data.damageVulnerabilities.map(v => ({ field: 'damageVulnerabilities', value: v })),
      ];
      for (const { field, value } of allDamageValues) {
        if (!NPC_DAMAGE_CANONICAL.has(value)) {
          const msg = `Unknown damage type "${value}" in ${field} — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const value of data.conditionImmunities) {
        if (!NPC_CONDITION_CANONICAL.has(value)) {
          const msg = `Unknown condition "${value}" in conditionImmunities — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Normalize CR to float
      const normalizedCR = npcNormalizeCR(data.cr);

      // 5. Folder
      const folderId = await this.getOrCreateFolder('Foundry MCP Creatures', 'Actor');

      // 6. Ability scores with saving throw proficiency flags
      const savingThrowSet = new Set(data.savingThrows);
      const abilities = {
        str: { value: data.abilities.str, proficient: savingThrowSet.has('str') ? 1 : 0 },
        dex: { value: data.abilities.dex, proficient: savingThrowSet.has('dex') ? 1 : 0 },
        con: { value: data.abilities.con, proficient: savingThrowSet.has('con') ? 1 : 0 },
        int: { value: data.abilities.int, proficient: savingThrowSet.has('int') ? 1 : 0 },
        wis: { value: data.abilities.wis, proficient: savingThrowSet.has('wis') ? 1 : 0 },
        cha: { value: data.abilities.cha, proficient: savingThrowSet.has('cha') ? 1 : 0 },
      };

      // 7. AC block — omit flat when mode is "default"
      const acBlock =
        data.acMode === 'flat' ? { calc: 'flat', flat: data.acValue } : { calc: 'default' };

      // 8. Build full actor data
      const actorData: any = {
        name: data.name,
        type: 'npc',
        system: {
          abilities,
          attributes: {
            ac: acBlock,
            hp: {
              value: data.hpAverage,
              max: data.hpAverage,
              temp: 0,
              tempmax: 0,
              formula: data.hpFormula,
            },
            movement: {
              walk: data.walkSpeed,
              fly: data.flySpeed,
              swim: data.swimSpeed,
              climb: data.climbSpeed,
              burrow: data.burrowSpeed,
              units: 'ft',
              hover: data.hover,
              special: '',
            },
            senses: {
              darkvision: data.darkvision,
              blindsight: data.blindsight,
              tremorsense: data.tremorsense,
              truesight: data.truesight,
              units: 'ft',
              special: data.specialSenses,
            },
          },
          details: {
            cr: normalizedCR,
            type: {
              value: data.creatureType,
              subtype: data.creatureSubtype,
            },
            alignment: data.alignment,
            biography: {
              value: data.biography,
              public: '',
            },
            source: {
              revision: 1,
              rules: data.sourceRules,
              book: data.sourceBook,
              page: data.sourcePage,
              custom: '',
              license: '',
            },
          },
          traits: {
            size: NPC_SIZE_MAP[data.size] ?? 'med',
            di: { value: data.damageImmunities, custom: '', bypasses: [] },
            dr: { value: data.damageResistances, custom: '', bypasses: [] },
            dv: { value: data.damageVulnerabilities, custom: '', bypasses: [] },
            ci: { value: data.conditionImmunities, custom: '' },
            languages: {
              value: data.languages,
              custom: data.languagesCustom,
              communication: {},
            },
          },
          skills: npcBuildSkillsBlock(data.skills),
        },
      };

      // 9. Assign folder if available
      if (folderId) {
        actorData.folder = folderId;
      }

      // 10. Create actor
      const actor = await Actor.create(actorData);
      if (!actor) {
        throw new Error(`Failed to create NPC actor "${data.name}"`);
      }

      this.auditLog('createNpcActor', { name: data.name, cr: normalizedCR }, 'success');

      // 11. Return structured result
      return {
        success: true,
        actor: {
          id: actor.id,
          name: actor.name,
          cr: npcFormatCR(normalizedCR),
          folder: folderId ?? null,
        },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to create NPC actor`, error);
      this.auditLog(
        'createNpcActor',
        { name: data.name },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Pathfinder 2e NPC creation (pf2e-create-npc)
  // ---------------------------------------------------------------------------

  async createPf2eNpcActor(data: {
    name: string;
    level: number;
    abilities: Record<string, number>;
    hp: number;
    ac: number;
    saves: { fortitude: number; reflex: number; will: number };
    perception: number;
    size: string;
    rarity: string;
    traits: string[];
    speed: number;
    otherSpeeds: Array<{ type: string; value: number }>;
    skills: Record<string, number>;
    languages: string[];
    immunities: string[];
    weaknesses: Array<{ type: string; value?: number; exceptions?: string[] }>;
    resistances: Array<{ type: string; value?: number; exceptions?: string[] }>;
    strikes: Array<{
      name: string;
      kind: 'melee' | 'ranged';
      bonus: number;
      damage: string;
      traits: string[];
      rangeIncrement?: number;
    }>;
    blurb: string;
    publicNotes: string;
    folder?: string;
    addToScene: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'pf2e') {
      throw new Error(
        `createPf2eNpcActor requires the Pathfinder 2e system. Current: "${(game.system as any).id}".`
      );
    }

    const existing = game.actors?.find((a: any) => a.name === data.name && a.type === 'npc');
    if (existing) {
      throw new Error(
        `An NPC named "${data.name}" already exists (id: ${existing.id}). Use a different name.`
      );
    }

    const warnings: string[] = [];

    // Abilities: PF2e NPCs store the modifier directly as { mod: N }.
    const abilities: Record<string, { mod: number }> = {};
    for (const key of ['str', 'dex', 'con', 'int', 'wis', 'cha']) {
      abilities[key] = { mod: Number(data.abilities[key] ?? 0) };
    }

    // Skills: NPC skills live in system.skills as { <slug>: { base: N } }.
    const skills: Record<string, { base: number }> = {};
    for (const [slug, mod] of Object.entries(data.skills ?? {})) {
      skills[slug] = { base: Number(mod) };
    }

    const iwr = (
      list: Array<{ type: string; value?: number; exceptions?: string[] }>,
      needsValue: boolean
    ) =>
      (list ?? []).map(e => {
        const out: Record<string, any> = {
          type: e.type,
          exceptions: Array.isArray(e.exceptions) ? e.exceptions : [],
        };
        if (needsValue) {
          out.value = typeof e.value === 'number' ? e.value : 0;
          if (typeof e.value !== 'number') {
            warnings.push(`${e.type}: no numeric value given, defaulted to 0`);
          }
        }
        return out;
      });

    const folderId = await this.resolveFolderPath(
      data.folder?.trim() ? data.folder.trim() : 'Foundry MCP Creatures',
      'Actor'
    );

    const actorData: Record<string, any> = {
      name: data.name,
      type: 'npc',
      folder: folderId ?? null,
      system: {
        abilities,
        attributes: {
          hp: { value: data.hp, max: data.hp, temp: 0, details: '' },
          ac: { value: data.ac, details: '' },
          speed: {
            value: data.speed,
            otherSpeeds: (data.otherSpeeds ?? []).map(s => ({ type: s.type, value: s.value })),
            details: '',
          },
          immunities: iwr(
            (data.immunities ?? []).map(t => ({ type: t })),
            false
          ),
          weaknesses: iwr(data.weaknesses ?? [], true),
          resistances: iwr(data.resistances ?? [], true),
        },
        saves: {
          fortitude: { value: data.saves.fortitude, saveDetail: '' },
          reflex: { value: data.saves.reflex, saveDetail: '' },
          will: { value: data.saves.will, saveDetail: '' },
        },
        // NPC perception uses `mod` (saves use `value` — PF2e is inconsistent here).
        perception: { mod: data.perception, details: '', senses: [], vision: true },
        skills,
        details: {
          level: { value: data.level },
          languages: { value: data.languages ?? [], details: '' },
          blurb: data.blurb ?? '',
          publicNotes: data.publicNotes ?? '',
          privateNotes: '',
          publication: { title: '', authors: '', license: 'OGL', remaster: false },
        },
        traits: {
          value: data.traits ?? [],
          rarity: data.rarity,
          size: { value: data.size },
        },
        resources: {},
      },
    };

    try {
      const created = (await Actor.create(actorData as any)) as any;
      if (!created) throw new Error('Actor.create returned nothing');

      // Strikes: PF2e represents both melee and ranged NPC attacks as `melee`
      // items; `range` (null vs { increment }) is what distinguishes them.
      const strikeItems = (data.strikes ?? []).map(s => {
        const lastSpace = s.damage.lastIndexOf(' ');
        const dice = lastSpace > 0 ? s.damage.slice(0, lastSpace).trim() : s.damage.trim();
        const damageType = lastSpace > 0 ? s.damage.slice(lastSpace + 1).trim() : 'untyped';
        const rollId = (foundry.utils as any).randomID(16);
        return {
          name: s.name,
          type: 'melee',
          system: {
            description: { value: '', gm: '' },
            rules: [],
            slug: null,
            traits: { otherTags: [], value: s.traits ?? [] },
            action: 'strike',
            area: null,
            damageRolls: { [rollId]: { damage: dice, damageType, category: null } },
            bonus: { value: s.bonus },
            attackEffects: { value: [] },
            range: s.kind === 'ranged' ? { increment: s.rangeIncrement ?? 30, max: null } : null,
            subjectToMAP: true,
            material: { type: null, grade: null, effects: [] },
            runes: { property: [] },
          },
        };
      });
      if (strikeItems.length) {
        await created.createEmbeddedDocuments('Item', strikeItems);
      }

      this.assertActorPreparesOrThrow(created);

      let tokensPlaced = 0;
      if (data.addToScene) {
        try {
          const result = await this.addActorsToScene({
            actorIds: [created.id],
            placement: 'random',
            hidden: false,
          });
          tokensPlaced = result?.tokensCreated ?? 0;
        } catch (err) {
          warnings.push(
            `Actor created but could not place a token: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      this.auditLog('createPf2eNpcActor', { name: data.name, level: data.level }, 'success');
      return {
        success: true,
        actor: { id: created.id, name: created.name, type: created.type },
        strikesAdded: strikeItems.length,
        tokensPlaced,
        ...(warnings.length ? { warnings } : {}),
      };
    } catch (error) {
      this.auditLog(
        'createPf2eNpcActor',
        { name: data.name },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw new Error(
        `Failed to create PF2e NPC "${data.name}": ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // PF2e homebrew ABC + feat items (pf2e-create-abc-item)
  // ---------------------------------------------------------------------------

  /**
   * Resolve a `basedOn` string to a cloned compendium item's source data.
   * Accepts a full "Compendium.…" UUID or a "<packId>.<ItemName-or-id>" ref
   * (the pack id itself may contain dots — we match the longest pack prefix).
   */
  private async resolvePf2eBasedOn(
    basedOn: string
  ): Promise<{ type: string; name: string; fullData: any }> {
    const raw = (basedOn ?? '').trim();
    if (!raw) throw new Error('basedOn was empty');

    if (raw.startsWith('Compendium.')) {
      const doc: any = await fromUuid(raw);
      if (!doc) throw new Error(`basedOn UUID not found: ${raw}`);
      return {
        type: doc.type,
        name: doc.name,
        fullData: this.sanitizeData(doc.toObject()),
      };
    }

    let bestPack: any = null;
    let remainder = '';
    for (const p of (game as any).packs) {
      if (p.documentName !== 'Item') continue;
      const id: string = p.metadata.id;
      if (raw === id) continue; // need a name/id after the pack
      if (raw.startsWith(`${id}.`)) {
        if (!bestPack || id.length > (bestPack.metadata.id as string).length) {
          bestPack = p;
          remainder = raw.slice(id.length + 1);
        }
      }
    }
    if (!bestPack) {
      throw new Error(
        `Could not find a compendium pack in basedOn "${raw}". Use "<packId>.<ItemName>" ` +
          `(e.g. "pf2e.ancestries.Goblin") or a full "Compendium.…" UUID.`
      );
    }
    if (!bestPack.indexed) await bestPack.getIndex();
    const entry: any =
      bestPack.index.get(remainder) ??
      bestPack.index.find((e: any) => (e.name ?? '').toLowerCase() === remainder.toLowerCase());
    if (!entry) {
      throw new Error(`"${remainder}" not found in compendium "${bestPack.metadata.id}".`);
    }
    const full = await this.getCompendiumDocumentFull(bestPack.metadata.id, entry._id);
    return { type: full.type, name: full.name, fullData: full.fullData };
  }

  async createPf2eAbcItem(data: {
    itemType: 'ancestry' | 'heritage' | 'background' | 'class' | 'deity' | 'feat';
    name?: string;
    basedOn?: string;
    targetCharacter?: string;
    description?: string;
    rarity?: string;
    traits?: string[];
    folder?: string;
    overrides?: Record<string, any>;
    [k: string]: any;
  }): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'pf2e') {
      throw new Error(
        `createPf2eAbcItem requires the Pathfinder 2e system. Current: "${(game.system as any).id}".`
      );
    }

    const type = data.itemType;
    if (!PF2E_ABC_ITEM_TYPES.has(type)) {
      throw new Error(`itemType must be one of: ${[...PF2E_ABC_ITEM_TYPES].join(', ')}`);
    }

    const warnings: string[] = [];

    // 1. Base source — clone a compendium item or build from a template.
    let source: Record<string, any>;
    if (data.basedOn) {
      const cloned = await this.resolvePf2eBasedOn(data.basedOn);
      if (cloned.type !== type) {
        throw new Error(
          `basedOn "${data.basedOn}" is a "${cloned.type}", but itemType is "${type}".`
        );
      }
      source = foundry.utils.deepClone(cloned.fullData);
      delete source._id;
      delete source.folder;
      delete source.sort;
      delete source.ownership;
      delete source._stats;
      if (data.name) source.name = data.name;
      else source.name = `${cloned.name} (Homebrew)`;
    } else {
      source = {
        name: data.name,
        type,
        img: PF2E_ITEM_DEFAULT_IMG[type],
        system: foundry.utils.deepClone(PF2E_ITEM_TEMPLATES[type]),
      };
    }
    source.type = type;
    if (!source.system || typeof source.system !== 'object') source.system = {};

    // 2. Friendly params -> system data.
    applyPf2eAbcParams(type, source.system, data, warnings);

    // 3. Caller overrides, deep-merged last.
    if (data.overrides && typeof data.overrides === 'object') {
      source.system = foundry.utils.mergeObject(source.system, data.overrides, { inplace: false });
    }

    // 4. Shared emitter — guarantee the common template fields exist.
    finalizePf2eItemSource(source, data);

    // 5. Create the standalone world item.
    const folderId = await this.resolveFolderPath(
      data.folder?.trim() ? data.folder.trim() : 'Foundry MCP Items',
      'Item'
    );
    let item: any;
    try {
      source.folder = folderId ?? null;
      const results = (await Item.createDocuments([source as any])) as any[];
      item = results?.[0];
      if (!item) throw new Error('Item.createDocuments returned nothing');
    } catch (error) {
      this.auditLog(
        'createPf2eAbcItem',
        { name: source.name, type },
        'failure',
        error instanceof Error ? error.message : String(error)
      );
      throw new Error(
        `Failed to create PF2e ${type} "${source.name}": ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // 6. Optionally attach to a character.
    let attachedTo: string | null = null;
    if (data.targetCharacter?.trim()) {
      const actor = this.findActorByIdentifier(data.targetCharacter.trim());
      if (!actor) {
        warnings.push(
          `Item created, but no actor matched "${data.targetCharacter}" — not attached.`
        );
      } else if (actor.type !== 'character') {
        warnings.push(
          `Item created, but "${actor.name}" is a ${actor.type}, not a character — not attached. ` +
            `Use manage-world-items add-to-actor for NPCs.`
        );
      } else {
        let addedIds: string[] = [];
        try {
          const embedded = (await actor.createEmbeddedDocuments('Item', [item.toObject()])) || [];
          addedIds = embedded.map((d: any) => d.id).filter(Boolean);
          this.assertActorPreparesOrThrow(actor);
          attachedTo = actor.name;
        } catch (error) {
          if (addedIds.length) {
            await actor.deleteEmbeddedDocuments('Item', addedIds).catch(() => undefined);
            try {
              this.assertActorPreparesOrThrow(actor);
            } catch {
              /* actor without the bad item should prepare fine again */
            }
          }
          warnings.push(
            `Item "${item.name}" was saved as a world item but could not attach to "${actor.name}": ` +
              `${error instanceof Error ? error.message : String(error)}. On PF2e, attach an ancestry + ` +
              `class first, then heritage/feats.`
          );
        }
      }
    }

    this.auditLog('createPf2eAbcItem', { name: item.name, type, attachedTo }, 'success');
    return {
      success: true,
      item: { id: item.id, name: item.name, type: item.type, uuid: item.uuid },
      attachedTo,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack to an existing actor (dnd5e-add-attack-feature)
  // ---------------------------------------------------------------------------

  async addAttackToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAttackToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts as Array<{
        number: number;
        denomination: number;
        type: string;
      }>) {
        if (!ATTACK_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }
      for (const prop of data.properties as string[]) {
        if (!ATTACK_PROPERTY_CANONICAL.has(prop)) {
          const msg = `Unknown weapon property "${prop}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 5. Damage parts for the activity (all except the first — which is system.damage.base)
      const activityDamageParts = (
        data.damageParts as Array<{ number: number; denomination: number; type: string }>
      )
        .slice(1)
        .map(p => ({
          types: [p.type],
          number: p.number,
          denomination: p.denomination,
          bonus: '',
          scaling: { mode: '', number: 1 },
          custom: { enabled: false },
        }));

      // 6. Range object (system-level — holds the real range/reach)
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 7. Conditional 2024-only fields
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 8. Build item data
      const itemData: Record<string, any> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [(data.damageParts as any[])[0].type],
              number: (data.damageParts as any[])[0].number,
              denomination: (data.damageParts as any[])[0].denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties as string[],
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: {
                targets: [],
                scaling: { allowed: false, max: '' },
                spellSlot: true,
              },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: {
                  value: data.attackType ?? 'melee',
                  classification: classification,
                },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },
          },
        },
      };

      // 9. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0];
      if (!created) {
        throw new Error(
          `Failed to create attack item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAttackToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack to actor`, error);
      this.auditLog(
        'addAttackToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add automatic-damage aura/emanation feature to an existing actor
  // (dnd5e-add-aura-feature)
  // ---------------------------------------------------------------------------

  async addAuraToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAuraToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive name match)
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — collect warnings, never block
      const warnings: string[] = [];

      for (const part of data.damageParts as Array<{
        number: number;
        denomination: number;
        type: string;
      }>) {
        if (!AURA_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Map areaType: Foundry uses "radius" internally for what 5e 2024 calls "emanation"
      //    <option value="radius">Emanation</option> — no "emanation" value exists in the dropdown
      const mappedAreaType: string = data.areaType === 'emanation' ? 'radius' : data.areaType;

      // 5. Generate activity ID
      const activityId: string = (foundry.utils as any).randomID(16);

      // 6. Slug identifier
      const identifier = slugify(data.featureName as string);

      // 7. Build item data — schema verified against dnd5e 5.1.8 Banshee Wail
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {
            [activityId]: {
              _id: activityId,
              type: 'damage', // activity type: damage — no attack roll, no save
              name: '',
              sort: 0,
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — not present in real dnd5e 5.1.8 schema
              },
              consumption: {
                scaling: { allowed: false },
                spellSlot: true, // confirmed: true in real Banshee Wail schema
                targets: [], // no uses management in V1
              },
              description: {}, // empty object — confirmed from real schema
              duration: {
                units: 'inst',
                concentration: false,
                override: false,
              },
              effects: [],
              range: { units: 'self', override: false }, // NO value, NO special
              uses: { spent: 0, recovery: [] }, // NO max field
              target: {
                template: {
                  contiguous: false,
                  units: data.areaUnits ?? 'ft',
                  count: '',
                  type: mappedAreaType,
                  size: String(data.areaSize),
                  width: '',
                  height: '',
                },
                affects: {
                  count: '',
                  type: data.affectsType ?? 'creature',
                  choice: false,
                  special: '',
                },
                override: false,
                prompt: true,
              },
              damage: {
                critical: { allow: false }, // only this key — no bonus, no dice
                parts: (
                  data.damageParts as Array<{ number: number; denomination: number; type: string }>
                ).map(p => ({
                  types: [p.type],
                  number: p.number,
                  denomination: p.denomination,
                  bonus: '',
                  scaling: { mode: '', number: 1 }, // mode: '' required — from real schema
                  custom: { enabled: false }, // NO formula field
                })),
                // NO onSave — damage activity has no save concept
              },
              // NO save block
              // NO attack block
            },
          },
        },
        effects: [],
      };

      // 7. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];
      if (!created) {
        throw new Error(
          `Failed to create aura item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAuraToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add aura to actor`, error);
      this.auditLog(
        'addAuraToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add passive/descriptive feature to an existing actor (dnd5e-add-passive-feature)
  // No activities, no mechanics — pure description displayed on the sheet.
  // ---------------------------------------------------------------------------

  async addPassiveFeatureToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addPassiveFeatureToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check (case-insensitive)
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Slug identifier
      const identifier = slugify(data.featureName as string);

      // 4. Build item data — no activities, no activityId needed
      const itemData = {
        name: data.featureName,
        type: 'feat',
        img: 'systems/dnd5e/icons/svg/items/feature.svg',
        system: {
          description: { value: data.description ?? '', chat: '' },
          identifier,
          source: {
            revision: 1,
            rules: data.sourceRules ?? '2014',
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
          },
          type: { value: 'monster', subtype: '' },
          uses: { spent: 0, recovery: [], max: '' },
          advancement: [],
          crewed: false,
          enchant: {},
          prerequisites: { items: [], repeatable: false, level: null },
          properties: [],
          requirements: '',
          activities: {}, // empty — passive feature has no mechanical activity
        },
        effects: [],
      };

      // 5. Create embedded item
      const [created] = (await actor.createEmbeddedDocuments('Item', [itemData])) as any[];
      if (!created) {
        throw new Error(
          `Failed to create passive feature "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addPassiveFeatureToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'feat' },
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add passive feature to actor`, error);
      this.auditLog(
        'addPassiveFeatureToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add weapon attack + save effect to an existing actor
  // (dnd5e-add-attack-with-save) — Tipo B
  // Two activities: attack (sort:0) + save (sort:1)
  // ---------------------------------------------------------------------------

  async addAttackWithSaveToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addAttackWithSaveToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = await this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      // 2. Duplicate check
      const existing = actor.items.find(
        (i: any) => i.name.toLowerCase() === data.featureName.toLowerCase()
      );
      if (existing) {
        throw new Error(
          `An item named "${data.featureName}" already exists on actor "${actor.name}". ` +
            `Remove or rename it first.`
        );
      }

      // 3. Soft validation — both damage groups unified
      const warnings: string[] = [];
      const allParts = [
        ...(data.damageParts as Array<{ type: string }>),
        ...(data.saveDamageParts as Array<{ type: string }>),
      ];
      for (const part of allParts) {
        if (!ATTACK_WITH_SAVE_DAMAGE_CANONICAL.has(part.type)) {
          const msg = `Unknown damage type "${part.type}" — verify it matches dnd5e system values`;
          if (!warnings.includes(msg)) warnings.push(msg);
          console.warn(`[${MODULE_ID}] ${msg}`);
        }
      }

      // 4. Generate two distinct activity IDs
      const attackActivityId: string = (foundry.utils as any).randomID(16);
      const saveActivityId: string = (foundry.utils as any).randomID(16);

      // 5. Attack activity damage parts: damageParts[1+] (base is in system.damage.base)
      const activityDamageParts = (
        data.damageParts as Array<{ number: number; denomination: number; type: string }>
      )
        .slice(1)
        .map(p => ({
          types: [p.type],
          number: p.number,
          denomination: p.denomination,
          bonus: '',
          scaling: { mode: '', number: 1 },
          custom: { enabled: false },
        }));

      // 6. Save activity damage parts: ALL saveDamageParts (no base — independent)
      const saveActivityDamageParts = (
        data.saveDamageParts as Array<{ number: number; denomination: number; type: string }>
      ).map(p => ({
        types: [p.type],
        number: p.number,
        denomination: p.denomination,
        bonus: '',
        scaling: { mode: '', number: 1 },
        custom: { enabled: false },
      }));

      // 7. System-level range (real reach/range — activity range is always 'self')
      const rangeObj =
        data.attackType === 'melee'
          ? { value: data.reachFt ?? 5, long: null, units: 'ft' }
          : { value: data.rangeFt, long: data.longRangeFt ?? null, units: 'ft' };

      // 8. Conditional 2024-only fields (same rules as Tipo A)
      const sourceRules: string = data.sourceRules ?? '2014';
      const masteryField = sourceRules === '2024' ? { mastery: '' } : {};
      const abilityField = sourceRules === '2024' ? { ability: data.effectiveAbility } : {};
      const classification = sourceRules === '2014' ? 'weapon' : '';

      // 9. Build item data
      const itemData: Record<string, any> = {
        name: data.featureName,
        type: 'weapon',
        system: {
          description: {
            value: data.description ?? '',
            chat: '',
            unidentified: '',
          },
          source: {
            custom: '',
            book: data.sourceBook ?? '',
            page: data.sourcePage ?? '',
            license: '',
            rules: sourceRules,
          },
          quantity: 1,
          weight: { value: 0, units: 'lb' },
          price: { value: 0, denomination: 'gp' },
          attunement: '',
          equipped: data.equipped !== false,
          rarity: '',
          identified: true,
          activation: {
            type: data.activationType ?? 'action',
            value: 1,
            condition: '',
            override: false,
          },
          duration: { value: '', units: '' },
          cover: null,
          target: {
            template: {
              count: '',
              contiguous: false,
              type: '',
              size: '',
              width: '',
              height: '',
              units: '',
            },
            affects: { count: '', type: '', choice: false, special: '' },
            prompt: true,
            override: false,
          },
          range: rangeObj,
          uses: { value: null, max: '', recovery: [], prompt: true },
          damage: {
            base: {
              types: [(data.damageParts as any[])[0].type],
              number: (data.damageParts as any[])[0].number,
              denomination: (data.damageParts as any[])[0].denomination,
              bonus: '',
              scaling: { mode: '', number: 1 },
              custom: { enabled: false },
            },
          },
          type: { value: data.weaponClass ?? 'natural', baseItem: '' },
          properties: data.properties as string[],
          proficient: 1,
          magicalBonus: null,
          ...masteryField,
          activities: {
            // ── Activity 1: attack (sort 0) ───────────────────────────────
            [attackActivityId]: {
              _id: attackActivityId,
              type: 'attack',
              name: '',
              img: '',
              sort: 0,
              description: {},
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                condition: '',
                override: false,
              },
              duration: { units: '', value: '', override: false },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '', type: '', choice: false, special: '' },
                prompt: true,
                override: false,
              },
              range: { units: 'self', override: false },
              uses: { spent: 0, max: '', recovery: [] },
              consumption: { targets: [], scaling: { allowed: false, max: '' }, spellSlot: true },
              attack: {
                ability: '',
                bonus: data.attackBonus > 0 ? String(data.attackBonus) : '',
                critical: { threshold: null },
                flat: false,
                type: { value: data.attackType ?? 'melee', classification },
                ...abilityField,
              },
              damage: {
                critical: { bonus: '' },
                includeBase: true,
                parts: activityDamageParts,
              },
              effects: [],
              save: { ability: '', dc: { formula: '', calculation: '' } },
            },

            // ── Activity 2: save (sort 1) ─────────────────────────────────
            [saveActivityId]: {
              _id: saveActivityId,
              type: 'save',
              name: '',
              sort: 1,
              description: {}, // {} — not { chatFlavor: '' } (real schema confirmed)
              activation: {
                type: data.activationType ?? 'action',
                value: 1,
                override: false,
                // NO condition — per real schema
              },
              duration: { units: 'inst', concentration: false, override: false },
              effects: [],
              range: { units: 'self', override: false },
              uses: { spent: 0, recovery: [] }, // NO max
              consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] },
              target: {
                template: {
                  count: '',
                  contiguous: false,
                  type: '',
                  size: '',
                  width: '',
                  height: '',
                  units: '',
                },
                affects: { count: '1', type: 'creature', choice: false, special: '' },
                override: false,
                prompt: true,
              },
              damage: {
                onSave: data.saveOnSave ?? 'none',
                parts: saveActivityDamageParts,
                // NO includeBase — save damage is independent from weapon base damage
              },
              save: {
                ability: [data.saveAbility],
                dc: { calculation: '', formula: String(data.saveDC) },
              },
            },
          },
        },
      };

      // 10. Create the item on the actor
      const created = (await actor.createEmbeddedDocuments('Item', [itemData]))[0];
      if (!created) {
        throw new Error(
          `Failed to create attack+save item "${data.featureName}" on actor "${actor.name}"`
        );
      }

      this.auditLog(
        'addAttackWithSaveToActor',
        { actorId: actor.id, featureName: data.featureName },
        'success'
      );

      return {
        success: true,
        actor: { id: actor.id, name: actor.name },
        item: { id: created.id, name: created.name, type: 'weapon' },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add attack+save to actor`, error);
      this.auditLog(
        'addAttackWithSaveToActor',
        { actorIdentifier: data.actorIdentifier, featureName: data.featureName },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Set actor spellcasting (ability + slot counts)
  // ---------------------------------------------------------------------------

  async setActorSpellcasting(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('setActorSpellcasting requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const cls = data.spellcastingClass as string;
      const lvl = data.spellcastingLevel as number;
      const ability = data.effectiveAbility as string;
      const idx = lvl - 1; // 0-based index into slot tables
      const warnings: string[] = [];

      // 2. Build flat updates object for a single actor.update() call
      const updates: Record<string, unknown> = {};

      // Spellcasting ability
      updates['system.attributes.spellcasting'] = ability;

      if (cls === 'warlock') {
        // ── Pact Magic ────────────────────────────────────────────────────────
        // All regular slots set to 0; pact slots from table
        for (let i = 1; i <= 9; i++) {
          updates[`system.spells.spell${i}.max`] = 0;
          updates[`system.spells.spell${i}.value`] = 0;
        }
        const pact = WARLOCK_PACT_TABLE[idx];
        updates['system.spells.pact.max'] = pact.max;
        updates['system.spells.pact.value'] = pact.max;
        updates['system.spells.pact.level'] = pact.level;
      } else {
        // ── Regular spell slots ───────────────────────────────────────────────
        let slotRow: number[];

        if (cls === 'artificer') {
          slotRow = ARTIFICER_SLOTS[idx];
        } else if (cls === 'paladin' || cls === 'ranger') {
          slotRow = HALF_CASTER_SLOTS[idx];
          if (lvl === 1) {
            warnings.push(
              `${cls} level 1 has no spell slots — use level 2+ to unlock spellcasting`
            );
          }
        } else {
          // Full casters: wizard, cleric, druid, sorcerer, bard
          slotRow = FULL_CASTER_SLOTS[idx];
        }

        for (let i = 1; i <= 9; i++) {
          const n = slotRow[i - 1];
          updates[`system.spells.spell${i}.max`] = n;
          updates[`system.spells.spell${i}.value`] = n;
        }
      }

      // 3. Single update call
      await actor.update(updates);

      // 4. Build response
      const slots: Record<string, unknown> = {};
      if (cls === 'warlock') {
        const pact = WARLOCK_PACT_TABLE[idx];
        slots['pact'] = { max: pact.max, level: pact.level };
      } else {
        const slotRow =
          cls === 'artificer'
            ? ARTIFICER_SLOTS[idx]
            : cls === 'paladin' || cls === 'ranger'
              ? HALF_CASTER_SLOTS[idx]
              : FULL_CASTER_SLOTS[idx];

        for (let i = 1; i <= 9; i++) {
          (slots as Record<string, number>)[`spell${i}`] = slotRow[i - 1];
        }
      }

      this.auditLog('setActorSpellcasting', { actorId: actor.id, cls, lvl, ability }, 'success');

      return {
        actor: { id: actor.id, name: actor.name },
        spellcasting: { ability, slots },
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to set actor spellcasting`, error);
      this.auditLog(
        'setActorSpellcasting',
        { actorIdentifier: data.actorIdentifier, spellcastingClass: data.spellcastingClass },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add spells from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addSpellsToActor(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addSpellsToActor requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const spellNames: string[] = data.spellNames;
      const compendiumPacks: string[] = data.compendiumPacks ?? ['dnd5e.spells'];
      const warnings: string[] = [];

      // ── Phase A: deduplicate input (case-insensitive) ─────────────────────
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];

      for (const name of spellNames) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // ── Phase B: build pack index maps (once per pack) ────────────────────
      interface PackMap {
        packId: string;
        packLabel: string;
        nameMap: Map<string, string>; // lowercase name → _id
      }
      const packMaps: PackMap[] = [];

      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }

        // Q6: type guard — Item packs only
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }

        if (!pack.indexed) {
          await pack.getIndex({});
        }

        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values() as IterableIterator<any>) {
          if (entry.name) {
            nameMap.set((entry.name as string).toLowerCase(), entry._id as string);
          }
        }

        packMaps.push({ packId, packLabel: pack.metadata.label as string, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(
          'No valid compendium packs available — check the compendiumPacks parameter. ' +
            'Valid pack IDs for D&D 5e: "dnd5e.spells" (2014) or "dnd5e.spells24" (2024).'
        );
      }

      // ── Phase C: per-spell search + import ───────────────────────────────
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        // 1. Duplicate check on actor (only items of type 'spell')
        const existing = (actor.items as any[]).find(
          (i: any) => i.type === 'spell' && i.name?.toLowerCase() === normalizedName
        );
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // 2. Lookup across packs — first-pack-wins
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }

        if (!found) {
          notFound.push(name);
          continue;
        }

        // 3. Fetch full document from compendium
        const pack = game.packs.get(found.packId);
        const document = await (pack as any).getDocument(found.entryId);

        if (!document) {
          // Entry was in index but document is missing (shouldn't happen, defensive)
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        // 4. Prepare data for embedding
        const spellData = (document as any).toObject() as Record<string, unknown>;
        delete spellData._id; // Let Foundry assign a new local id; prevents id clash

        // 5. Embed individually — per-spell error isolation
        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [spellData])) as any[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({
            name,
            error: embedErr instanceof Error ? embedErr.message : 'Unknown error',
          });
        }
      }

      // ── Phase D: audit + return ───────────────────────────────────────────
      this.auditLog(
        'addSpellsToActor',
        {
          actorId: actor.id,
          added: added.length,
          skipped: skipped.length,
          notFound: notFound.length,
          failed: failed.length,
        },
        'success'
      );

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add spells to actor`, error);
      this.auditLog(
        'addSpellsToActor',
        { actorIdentifier: data.actorIdentifier },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Add features from compendium packs to an actor
  // ---------------------------------------------------------------------------

  async addFeaturesFromCompendium(data: any): Promise<any> {
    this.validateFoundryState();

    if ((game.system as any).id !== 'dnd5e') {
      throw new Error('addFeaturesFromCompendium requires the dnd5e game system');
    }

    try {
      // 1. Resolve actor
      const actor = this.findActorByIdentifier(data.actorIdentifier);
      if (!actor) {
        throw new Error(`Actor not found: "${data.actorIdentifier}"`);
      }

      const featureNames: string[] = data.featureNames;
      const compendiumPacks: string[] = data.compendiumPacks ?? [
        'dnd5e.monsterfeatures',
        'dnd5e.classfeatures',
      ];
      const warnings: string[] = [];

      // ── Phase A: deduplicate input (case-insensitive) ─────────────────────
      const seen = new Set<string>();
      const unique: string[] = [];
      const skipped: Array<{ name: string; reason: string }> = [];

      for (const name of featureNames) {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          skipped.push({ name, reason: 'duplicate in input' });
        } else {
          seen.add(key);
          unique.push(name);
        }
      }

      // ── Phase B: build pack index maps (once per pack) ────────────────────
      interface PackMap {
        packId: string;
        packLabel: string;
        nameMap: Map<string, string>; // lowercase name → _id
      }
      const packMaps: PackMap[] = [];

      for (const packId of compendiumPacks) {
        const pack = game.packs.get(packId);
        if (!pack) {
          warnings.push(`Compendium pack "${packId}" not found — skipped`);
          continue;
        }

        // Type guard — Item packs only
        if (pack.metadata.type !== 'Item') {
          warnings.push(
            `Pack "${packId}" has type "${pack.metadata.type}", expected "Item" — skipped`
          );
          continue;
        }

        if (!pack.indexed) {
          await pack.getIndex({});
        }

        const nameMap = new Map<string, string>();
        for (const entry of pack.index.values() as IterableIterator<any>) {
          if (entry.name) {
            nameMap.set((entry.name as string).toLowerCase(), entry._id as string);
          }
        }

        packMaps.push({ packId, packLabel: pack.metadata.label as string, nameMap });
      }

      if (packMaps.length === 0) {
        throw new Error(
          'No valid compendium packs available — check the compendiumPacks parameter. ' +
            'Valid pack IDs for D&D 5e: "dnd5e.monsterfeatures" or "dnd5e.classfeatures" (2014), ' +
            '"dnd5e.monsterfeatures24" (2024 monster features). ' +
            'Note: 2024 class features are embedded in class items and cannot be imported with this tool.'
        );
      }

      // ── Phase C: per-feature search + import ─────────────────────────────
      const added: Array<{ name: string; packId: string; packLabel: string; itemId: string }> = [];
      const notFound: string[] = [];
      const failed: Array<{ name: string; error: string }> = [];

      for (const name of unique) {
        const normalizedName = name.toLowerCase();

        // 1. Duplicate check on actor — name-only, any item type
        //    (feature names are semantically unique on an actor regardless of stored type)
        const existing = (actor.items as any[]).find(
          (i: any) => i.name?.toLowerCase() === normalizedName
        );
        if (existing) {
          skipped.push({ name, reason: 'already on actor' });
          continue;
        }

        // 2. Lookup across packs — first-pack-wins
        let found: { packId: string; packLabel: string; entryId: string } | null = null;
        for (const pm of packMaps) {
          const entryId = pm.nameMap.get(normalizedName);
          if (entryId) {
            found = { packId: pm.packId, packLabel: pm.packLabel, entryId };
            break;
          }
        }

        if (!found) {
          notFound.push(name);
          continue;
        }

        // 3. Fetch full document from compendium
        const pack = game.packs.get(found.packId);
        const document = await (pack as any).getDocument(found.entryId);

        if (!document) {
          // Entry was in index but document is missing (shouldn't happen, defensive)
          notFound.push(name);
          warnings.push(
            `"${name}" found in index but document missing in pack "${found.packId}" — skipped`
          );
          continue;
        }

        // 4. Prepare data for embedding
        const featureData = (document as any).toObject() as Record<string, unknown>;
        delete featureData._id; // Let Foundry assign a new local id; prevents id clash

        // 5. Embed individually — per-feature error isolation
        try {
          const [created] = (await actor.createEmbeddedDocuments('Item', [featureData])) as any[];
          added.push({
            name,
            packId: found.packId,
            packLabel: found.packLabel,
            itemId: created.id,
          });
        } catch (embedErr) {
          failed.push({
            name,
            error: embedErr instanceof Error ? embedErr.message : 'Unknown error',
          });
        }
      }

      // ── Phase D: audit + return ───────────────────────────────────────────
      this.auditLog(
        'addFeaturesFromCompendium',
        {
          actorId: actor.id,
          added: added.length,
          skipped: skipped.length,
          notFound: notFound.length,
          failed: failed.length,
        },
        'success'
      );

      return {
        actor: { id: actor.id, name: actor.name },
        added,
        skipped,
        notFound,
        failed,
        warnings,
      };
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to add features from compendium`, error);
      this.auditLog(
        'addFeaturesFromCompendium',
        { actorIdentifier: data.actorIdentifier },
        'failure',
        error instanceof Error ? error.message : 'Unknown error'
      );
      throw error;
    }
  }

  // ─── Generic actor CRUD ─────────────────────────────────────────────────────

  /**
   * Create one or more actors of any type with arbitrary system data.
   * Works for any Foundry game system — types and system fields are not validated here.
   */
  async createActors(params: {
    actors: Array<{
      name: string;
      type: string;
      img?: string;
      system?: Record<string, any>;
    }>;
    folder?: string;
  }): Promise<{ created: Array<{ id: string; name: string; type: string }>; total: number }> {
    const folderName = params.folder ?? 'Foundry MCP Actors';
    const folderId = await this.getOrCreateFolder(folderName, 'Actor');

    const gameSystemId = (game as any).system?.id ?? '';

    const docs = params.actors.map(a => {
      const doc: Record<string, any> = { name: a.name, type: a.type };
      if (a.img) doc.img = a.img;

      // Merge system data, adding safe defaults for systems that require certain
      // fields to exist during data preparation (avoids non-fatal init errors).
      let systemData: Record<string, any> = a.system ?? {};

      if (gameSystemId === 'mgt2e') {
        // mgt2e's _prepareCreatureData iterates skills.specialities —
        // ensure skills is at least an empty object to prevent a TypeError.
        if (!systemData.skills) {
          systemData = { skills: {}, ...systemData };
        }
        // Normalize skill keys to canonical lowercase (e.g. gunCombat → guncombat)
        // to prevent duplicate entries that the localization system cannot resolve.
        systemData = this.normalizeMGT2eSkillKeys(systemData);

        // ── mgt2e traveller/npc convenience handling ────────────────────────
        // When creating a traveller or npc, accept the same shorthand inputs
        // as the (now-removed) create-mgt2e-traveller tool:
        //   • Skills shorthand: { pilot: 2 } → { pilot: { value:2, trained:true } }
        //   • Skill full object: { pilot: { value:0, trained:true, specialities:{...} } }
        //   • Characteristics: lowercase keys (str/dex/…) normalised to uppercase +
        //     show:true so they appear on the sheet; hits auto-calculated if omitted
        //   • Details → sophont: { details: { career, species, … } } remapped to
        //     system.sophont (system.details does not exist in mgt2e)
        if (a.type === 'traveller' || a.type === 'npc') {
          // 1. Skills: add id, auto-populate specialities, set parent value.
          //    normalizeMGT2eSkillKeys already normalised keys and expanded number shorthands
          //    to {value, trained}; this step adds the createActors-only extras.
          const MGT2E_SKILL_SPECS: Record<string, string[]> = {
            animals: ['handling', 'veterinary', 'training'],
            art: ['performer', 'holography', 'instrument', 'visualMedia', 'write'],
            athletics: ['dexterity', 'endurance', 'strength'],
            drive: ['hovercraft', 'mole', 'track', 'walker', 'wheel'],
            electronics: ['comms', 'computers', 'remoteOps', 'sensors'],
            engineer: ['mDrive', 'jDrive', 'lifeSupport', 'power'],
            flyer: ['airship', 'grav', 'ornithopter', 'rotor', 'wing'],
            gunner: ['turret', 'ortillery', 'screen', 'capital'],
            guncombat: ['archaic', 'energy', 'slug'],
            heavyweapons: ['artillery', 'portable', 'vehicle'],
            melee: ['unarmed', 'blade', 'bludgeon', 'natural'],
            pilot: ['smallCraft', 'spacecraft', 'capitalShips'],
            seafarer: ['oceanShips', 'personal', 'sail', 'submarine'],
            tactics: ['military', 'naval'],
          };
          if (systemData.skills && typeof systemData.skills === 'object') {
            const normSkills: Record<string, any> = {};
            for (const [sk, sv] of Object.entries(systemData.skills as Record<string, any>)) {
              const s =
                sv && typeof sv === 'object' ? (sv as any) : { value: sv ?? 0, trained: true };
              normSkills[sk] = { id: sk, value: s.value ?? 0, trained: s.trained ?? true, ...s };
              // Parent value = min of caller-provided active spec values (before auto-populate).
              if (s.specialities && typeof s.specialities === 'object') {
                const activeValues: number[] = [];
                for (const sd of Object.values(s.specialities as Record<string, any>)) {
                  const v = Number((sd as any)?.value ?? 0);
                  if (v > 0) activeValues.push(v);
                }
                if (activeValues.length > 0) normSkills[sk].value = Math.min(...activeValues);
              }
              // Auto-populate missing specialities (additive only).
              const defaultSpecs = MGT2E_SKILL_SPECS[sk];
              if (defaultSpecs) {
                const existing: Record<string, any> = normSkills[sk].specialities ?? {};
                const merged: Record<string, any> = { ...existing };
                for (const specKey of defaultSpecs) {
                  if (!(specKey in merged)) merged[specKey] = { value: 0, trained: false };
                }
                normSkills[sk].specialities = merged;
              }
            }
            systemData = { ...systemData, skills: normSkills };
          }

          // 2. Characteristics: accept lowercase or uppercase keys,
          //    ensure show:true, calculate hits from STR+DEX+END if missing.
          if (systemData.characteristics && typeof systemData.characteristics === 'object') {
            const normChars: Record<string, any> = {};
            let str = 7,
              dex = 7,
              end = 7;
            for (const [k, v] of Object.entries(
              systemData.characteristics as Record<string, any>
            )) {
              const uk = k.toUpperCase();
              let charVal: number;
              if (typeof v === 'number') {
                charVal = v;
                normChars[uk] = { value: charVal, damage: 0, show: true };
              } else if (v && typeof v === 'object') {
                charVal = (v as any).value ?? 7;
                normChars[uk] = { show: true, ...(v as any) };
                if (normChars[uk].damage === undefined) normChars[uk].damage = 0;
              } else {
                charVal = 7;
                normChars[uk] = { value: charVal, damage: 0, show: true };
              }
              if (uk === 'STR') str = charVal;
              if (uk === 'DEX') dex = charVal;
              if (uk === 'END') end = charVal;
            }
            systemData = { ...systemData, characteristics: normChars };
            if (!systemData.hits) {
              const hitsMax = str + dex + end;
              systemData = { ...systemData, hits: { value: hitsMax, max: hitsMax } };
            }
          }

          // 3. Remap system.details → system.sophont (system.details does not exist in mgt2e)
          if (systemData.details && !systemData.sophont) {
            const d = systemData.details as any;
            const sophont: Record<string, any> = {};
            for (const [k, v] of Object.entries(d)) {
              if (k === 'career') {
                sophont.profession = v;
              } else if (k === 'description') {
                systemData = { ...systemData, description: v };
              } else {
                sophont[k] = v;
              }
            }
            if (Object.keys(sophont).length > 0) systemData = { ...systemData, sophont };
            const { details: _removed, ...rest } = systemData;
            systemData = rest;
          }
        }
      }

      // mgt2e software items: the spacecraft sheet reads i.system.software.bandwidth
      // unconditionally — if the software sub-object is missing the sheet crashes.
      // Inject safe defaults when the caller didn't supply them.
      if (a.type === 'software' && gameSystemId === 'mgt2e' && !systemData.software) {
        systemData = {
          software: { class: 'spacecraft', type: 'generic', interface: 'none', bandwidth: 0 },
          ...systemData,
        };
      }

      doc.system = systemData;
      if (folderId) doc.folder = folderId;
      return doc;
    });

    const created = await Actor.createDocuments(docs as any[]);
    if (!created || created.length === 0) {
      throw new Error('Foundry failed to create actor documents');
    }

    return {
      created: (created as any[]).map(a => ({ id: a.id, name: a.name, type: a.type })),
      total: created.length,
    };
  }

  /** Lowercases mgt2e skill keys before createActors processes them. */
  private normalizeMGT2eSkillKeys(system: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(system)) {
      if (key === 'skills' && val && typeof val === 'object' && !Array.isArray(val)) {
        const normalized: Record<string, any> = {};
        for (const [sk, sv] of Object.entries(val as Record<string, any>)) {
          normalized[sk.toLowerCase()] = sv;
        }
        result['skills'] = normalized;
      } else if (key.startsWith('skills.-=')) {
        result[`skills.-=${key.slice('skills.-='.length).toLowerCase()}`] = val;
      } else if (key.startsWith('skills.')) {
        const rest = key.slice('skills.'.length);
        const dotIdx = rest.indexOf('.');
        const lk =
          dotIdx === -1
            ? rest.toLowerCase()
            : rest.substring(0, dotIdx).toLowerCase() + rest.substring(dotIdx);
        result[`skills.${lk}`] = val;
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * Update one or more existing actors by ID.
   * Merges supplied fields into the actor (top-level keys overwrite).
   */
  /**
   * Re-run an actor's data preparation and throw if it fails. System data models
   * (esp. PF2e) don't reject `actor.update()` for a malformed `system` payload —
   * they accept it into `_source` and then throw on every later `prepareData()`,
   * leaving the sheet unopenable and item ops broken. Callers use this after a
   * write so they can roll back instead of bricking the actor.
   */
  private assertActorPreparesOrThrow(actor: any): void {
    if (typeof actor.reset === 'function') actor.reset();
    else actor.prepareData();
  }

  async updateActors(
    updates: Array<{
      id: string;
      name?: string;
      img?: string;
      folder?: string;
      system?: Record<string, any>;
    }>
  ): Promise<{ updated: Array<{ id: string; name: string }>; total: number }> {
    const updatedActors: Array<{ id: string; name: string }> = [];

    for (const u of updates) {
      const actor = game.actors.get(u.id) as any;
      if (!actor) throw new Error(`Actor not found: ${u.id}`);
      // Snapshot the fields we might touch so a bad payload can be rolled back.
      const before = {
        name: actor._source.name,
        img: actor._source.img,
        folder: actor._source.folder,
        system: foundry.utils.deepClone(actor._source.system),
      };

      const patch: Record<string, any> = {};
      if (u.name !== undefined) patch.name = u.name;
      if (u.img !== undefined) patch.img = u.img;
      if (u.folder !== undefined) {
        // A blank "folder" used to be silently ignored — the update reported success
        // but the actor never moved. Fail loudly instead.
        const wanted = u.folder.trim();
        if (wanted.length === 0) {
          throw new Error(
            `Update to "${actor.name}" was rejected: "folder" was empty. Give a folder name ` +
              `or "/"-separated path. Moving an actor back to the top level isn't supported ` +
              `here — delete the containing folder instead (its loose contents move up).`
          );
        }
        // "/"-separated path nests (walks/creates each folder); a bare name stays flat.
        const folderId = await this.resolveFolderPath(wanted, 'Actor');
        if (!folderId) {
          throw new Error(
            `Update to "${actor.name}" was rejected: folder "${wanted}" could not be resolved or created.`
          );
        }
        patch.folder = folderId;
      }
      if (u.system !== undefined) {
        // Build a single patch.system nested object so Foundry deep-merges everything
        // in one pass without flat-key vs nested-key conflicts.
        // Dot-notation keys (e.g. "crewed.passengers.-=actorId") are expanded to their
        // nested equivalent — Foundry's mergeObject honours the "-=" deletion operator
        // at any depth in a nested object, just as it does with top-level flat keys.
        const systemPatch: Record<string, any> = {};
        for (const [key, val] of Object.entries(u.system)) {
          if (key.includes('.')) {
            const parts = key.split('.');
            let cur = systemPatch;
            for (let i = 0; i < parts.length - 1; i++) {
              if (!(parts[i] in cur)) cur[parts[i]] = {};
              cur = cur[parts[i]];
            }
            cur[parts[parts.length - 1]] = val;
          } else {
            systemPatch[key] = val;
          }
        }
        patch.system = systemPatch;
      }

      // A PF2e party silently drops non-creature members in PartyPF2e#prepareBaseData,
      // so a bad UUID would sit in _source as dead cruft with no error. Reject it here.
      const memberPatch = patch.system?.details?.members;
      if (actor.type === 'party' && Array.isArray(memberPatch)) {
        const notCreatures: string[] = [];
        for (const m of memberPatch) {
          const uuid = typeof m === 'string' ? m : m?.uuid;
          const ref: any = uuid ? await fromUuid(uuid) : null;
          if (!ref || typeof ref.isOfType !== 'function' || !ref.isOfType('creature')) {
            notCreatures.push(uuid ?? JSON.stringify(m));
          }
        }
        if (notCreatures.length > 0) {
          throw new Error(
            `Update to "${actor.name}" was rejected: a party only accepts creature members ` +
              `(character, npc, familiar). Not a creature: ${notCreatures.join(', ')}.`
          );
        }
      }

      // PF2e (CreaturePF2e#_preUpdate) clamps an incoming system.attributes.hp.value
      // against the *currently prepared* max, so raising value and max in the same
      // update caps value at the old max. When both are present, apply max first and
      // value in a follow-up update.
      const hpPatch = patch.system?.attributes?.hp;
      const splitHp =
        hpPatch &&
        typeof hpPatch === 'object' &&
        hpPatch.max !== undefined &&
        hpPatch.value !== undefined;
      const deferredHpValue = splitHp ? hpPatch.value : undefined;
      if (splitHp) delete hpPatch.value;

      try {
        await actor.update(patch);
        if (splitHp) await actor.update({ 'system.attributes.hp.value': deferredHpValue });
        // A malformed system payload is accepted into _source but breaks every
        // later prepareData(). Detect that here and roll back rather than leave
        // the actor bricked (unopenable sheet, failing item ops).
        this.assertActorPreparesOrThrow(actor);
      } catch (err) {
        await actor
          .update(
            {
              name: before.name,
              img: before.img,
              folder: before.folder,
              system: before.system,
            },
            { diff: false, recursive: false }
          )
          .catch(() => undefined);
        try {
          this.assertActorPreparesOrThrow(actor);
        } catch {
          /* restored source is the known-good pre-write state */
        }
        this.auditLog(
          'updateActors',
          { id: u.id },
          'failure',
          err instanceof Error ? err.message : String(err)
        );
        throw new Error(
          `Update to "${actor.name}" was rejected and rolled back: the payload left the actor ` +
            `unable to prepare its data (${err instanceof Error ? err.message : String(err)}). ` +
            `A system field was almost certainly given an invalid shape — check paths like ` +
            `system.details.languages, system.attributes.immunities/weaknesses/resistances, system.pfs.`
        );
      }
      updatedActors.push({ id: actor.id, name: u.name ?? actor.name });
    }

    return { updated: updatedActors, total: updatedActors.length };
  }

  /**
   * Update one or more items embedded in an actor.
   */
  async updateActorItems(
    actorIdentifier: string,
    itemUpdates: Array<{ id: string; name?: string; img?: string; system?: Record<string, any> }>
  ): Promise<{ updated: Array<{ id: string; name: string }>; total: number }> {
    const actor =
      (game.actors.get(actorIdentifier) as any) ??
      (game.actors.find(
        (a: any) => a.name?.toLowerCase() === actorIdentifier.toLowerCase()
      ) as any);
    if (!actor) throw new Error(`Actor not found: ${actorIdentifier}`);

    const updated: Array<{ id: string; name: string }> = [];

    for (const u of itemUpdates) {
      const item = actor.items.get(u.id) as any;
      if (!item) throw new Error(`Item ${u.id} not found on actor "${actor.name}"`);

      const patch: Record<string, any> = {};
      if (u.name !== undefined) patch.name = u.name;
      if (u.img !== undefined) patch.img = u.img;
      if (u.system !== undefined) patch.system = u.system;

      await item.update(patch);
      updated.push({ id: item.id, name: u.name ?? item.name });
    }

    return { updated, total: updated.length };
  }

  /**
   * Delete one or more items embedded in an actor.
   */
  async deleteActorItems(
    actorIdentifier: string,
    itemIds: string[]
  ): Promise<{ deleted: string[]; total: number }> {
    const actor =
      (game.actors.get(actorIdentifier) as any) ??
      (game.actors.find(
        (a: any) => a.name?.toLowerCase() === actorIdentifier.toLowerCase()
      ) as any);
    if (!actor) throw new Error(`Actor not found: ${actorIdentifier}`);

    const existing = itemIds.filter(id => actor.items.get(id));
    if (existing.length === 0)
      throw new Error('None of the provided item IDs were found on this actor');

    try {
      await actor.deleteEmbeddedDocuments('Item', existing);
      this.assertActorPreparesOrThrow(actor);
      return { deleted: existing, total: existing.length };
    } catch (err) {
      // The normal delete runs PF2e's grant-cascade / re-prep, which throws
      // (e.g. `reading 'grantedBy'`) when the actor is already in a degraded
      // state — often because of the very item we're trying to remove. Fall
      // back to pulling the ids out of _source directly, bypassing the cascade.
      try {
        const kept = (actor._source.items ?? []).filter((i: any) => !existing.includes(i._id));
        await actor.updateSource({ items: kept });
        if (typeof actor.reset === 'function') actor.reset();
        const stillThere = existing.filter(id => actor.items.get(id));
        if (stillThere.length === 0) {
          this.auditLog(
            'deleteActorItems',
            { actorId: actor.id, count: existing.length },
            'success'
          );
          return { deleted: existing, total: existing.length };
        }
      } catch {
        /* fall through to the descriptive error below */
      }
      this.auditLog(
        'deleteActorItems',
        { actorId: actor.id, count: existing.length },
        'failure',
        err instanceof Error ? err.message : String(err)
      );
      throw new Error(
        `Could not remove the item(s) from "${actor.name}": ${err instanceof Error ? err.message : String(err)}. ` +
          `The actor's data is in a state PF2e can't prepare — deleting the whole actor and rebuilding is usually the fastest fix.`
      );
    }
  }

  /**
   * Delete one or more actors by ID.
   */
  async deleteActors(ids: string[]): Promise<{ deleted: string[]; total: number }> {
    const existing = ids.filter(id => game.actors.get(id));
    if (existing.length === 0) throw new Error('None of the provided actor IDs were found');

    await Actor.deleteDocuments(existing);
    return { deleted: existing, total: existing.length };
  }

  // ─── Chat & dice ────────────────────────────────────────────────────────────

  /**
   * Resolve a user reference (id or name) to a user id.
   */
  private resolveUserId(ref: string): string | null {
    const raw = (ref ?? '').trim();
    if (!raw) return null;
    const byId = (game as any).users?.get?.(raw);
    if (byId?.id) return byId.id;
    const byName = (game as any).users?.find?.(
      (u: any) => u.name?.toLowerCase() === raw.toLowerCase()
    );
    return byName?.id ?? null;
  }

  /**
   * Resolve an actor reference (id or name) for chat speaker attribution.
   */
  private resolveSpeakerActor(ref?: string): any {
    const raw = (ref ?? '').trim();
    if (!raw) return null;
    const actor =
      (game as any).actors?.get?.(raw) ??
      (game as any).actors?.find?.((a: any) => a.name?.toLowerCase() === raw.toLowerCase());
    if (!actor) throw new Error(`Speaker actor not found: ${ref}`);
    return actor;
  }

  private static readonly ROLL_MODES = ['publicroll', 'gmroll', 'blindroll', 'selfroll'];

  /**
   * Post a message to Foundry's chat log, optionally spoken as an actor.
   *
   * The bridge could already create chat messages internally (the roll-request
   * flow does), but nothing exposed it as a tool — so "post to chat" was listed
   * as impossible when it was merely unimplemented.
   */
  async sendChatMessage(params: {
    content: string;
    speakerActor?: string;
    whisperTo?: string[];
    flavor?: string;
    rollMode?: string;
  }): Promise<{
    id: string;
    content: string;
    speaker: string | null;
    whisperedTo: string[];
    rollMode: string;
  }> {
    this.validateFoundryState();

    const content = (params.content ?? '').trim();
    if (!content) throw new Error('content is required and cannot be empty');

    const rollMode = params.rollMode ?? 'publicroll';
    if (!FoundryDataAccess.ROLL_MODES.includes(rollMode)) {
      throw new Error(
        `Invalid rollMode "${rollMode}". Valid values: ${FoundryDataAccess.ROLL_MODES.join(', ')}.`
      );
    }

    const actor = this.resolveSpeakerActor(params.speakerActor);

    const whisperTargets: string[] = [];
    const unresolved: string[] = [];
    for (const ref of params.whisperTo ?? []) {
      const id = this.resolveUserId(ref);
      if (id) whisperTargets.push(id);
      else unresolved.push(ref);
    }
    if (unresolved.length > 0) {
      throw new Error(
        `Could not resolve these whisper target(s) to a Foundry user: ${unresolved.join(', ')}. ` +
          `Nothing was sent.`
      );
    }

    const messageData: any = {
      content,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({}),
      ...(params.flavor ? { flavor: params.flavor } : {}),
      ...(whisperTargets.length > 0 ? { whisper: whisperTargets } : {}),
    };

    const message = await (ChatMessage as any).create(messageData, { rollMode });
    if (!message?.id) {
      throw new Error('Foundry did not return a chat message — the message was not posted.');
    }

    this.auditLog('sendChatMessage', { speaker: actor?.name ?? null }, 'success');

    return {
      id: message.id,
      content,
      speaker: actor?.name ?? null,
      whisperedTo: whisperTargets.map(id => (game as any).users?.get(id)?.name ?? id),
      rollMode,
    };
  }

  /**
   * Evaluate a dice formula GM-side and post it to chat.
   *
   * Complements `requestPlayerRolls`: that asks a player to roll (right for
   * player actions), this rolls directly (right for GM/NPC actions). The total
   * and individual dice are returned so the result is verifiable from the MCP
   * side rather than only visible in Foundry.
   */
  async rollDice(params: {
    formula: string;
    flavor?: string;
    speakerActor?: string;
    rollMode?: string;
  }): Promise<{
    formula: string;
    total: number;
    result: string;
    dice: Array<{ faces: number; results: number[] }>;
    flavor: string | null;
    speaker: string | null;
    rollMode: string;
  }> {
    this.validateFoundryState();

    const formula = (params.formula ?? '').trim();
    if (!formula) throw new Error('formula is required (e.g. "2d6+3", "1d20")');

    const rollMode = params.rollMode ?? 'publicroll';
    if (!FoundryDataAccess.ROLL_MODES.includes(rollMode)) {
      throw new Error(
        `Invalid rollMode "${rollMode}". Valid values: ${FoundryDataAccess.ROLL_MODES.join(', ')}.`
      );
    }

    const actor = this.resolveSpeakerActor(params.speakerActor);

    let roll: any;
    try {
      roll = new Roll(formula);
      await roll.evaluate();
    } catch (error) {
      throw new Error(
        `Could not evaluate dice formula "${formula}": ` +
          `${error instanceof Error ? error.message : 'Unknown error'}. ` +
          `Use standard Foundry syntax, e.g. "2d6+3", "1d20+5", "4d6kh3".`
      );
    }

    const messageData: any = {
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : ChatMessage.getSpeaker({}),
      ...(params.flavor ? { flavor: params.flavor } : {}),
    };

    await roll.toMessage(messageData, { create: true, rollMode });

    this.auditLog('rollDice', { formula, total: roll.total }, 'success');

    return {
      formula,
      total: roll.total,
      result: roll.result,
      dice: (roll.dice ?? []).map((d: any) => ({
        faces: d.faces,
        results: (d.results ?? []).map((r: any) => r.result),
      })),
      flavor: params.flavor ?? null,
      speaker: actor?.name ?? null,
      rollMode,
    };
  }

  /**
   * Read back recent chat log entries. The only read-path complement to
   * sendChatMessage/rollDice — without it, "what did the player just do" had no
   * answer besides asking the GM to type it out.
   */
  async listChatLog(params: { limit?: number; sinceId?: string; rollsOnly?: boolean }): Promise<{
    entries: Array<{
      id: string;
      timestamp: string;
      speaker: string | null;
      content: string;
      flavor: string | null;
      isRoll: boolean;
      rolls: Array<{ formula: string; total: number }>;
      whisperedTo: string[];
    }>;
    total: number;
  }> {
    this.validateFoundryState();

    const all: any[] = Array.from((game as any).messages?.contents ?? []);

    let source = all;
    if (params.sinceId) {
      const idx = all.findIndex(m => m.id === params.sinceId);
      // Unknown sinceId: treat as "nothing missed yet" rather than guessing a
      // count, so a stale/typo'd id cannot silently dump the whole log.
      source = idx === -1 ? [] : all.slice(idx + 1);
    }

    const mapped = source.map((m: any) => {
      const rolls = (m.rolls ?? []).map((r: any) => ({
        formula: r.formula ?? '',
        total: typeof r.total === 'number' ? r.total : 0,
      }));
      const speakerActorId = m.speaker?.actor;
      const speakerName =
        m.speaker?.alias ??
        (speakerActorId ? (game as any).actors?.get(speakerActorId)?.name : null) ??
        m.author?.name ??
        m.user?.name ??
        null;

      return {
        id: m.id,
        timestamp: new Date(m.timestamp ?? Date.now()).toISOString(),
        speaker: speakerName,
        content: m.content ?? '',
        flavor: m.flavor ?? null,
        isRoll: rolls.length > 0,
        rolls,
        whisperedTo: (m.whisper ?? []).map(
          (id: string) => (game as any).users?.get(id)?.name ?? id
        ),
      };
    });

    const filtered = params.rollsOnly ? mapped.filter(m => m.isRoll) : mapped;
    const limit = params.limit ?? 20;
    // sinceId means "catch up on what I missed" - take the OLDEST `limit`
    // entries after sinceId (not the newest), so nothing in the returned
    // window is silently skipped and a caller can page forward by passing
    // the last returned entry's id back in as the next sinceId. Without
    // sinceId this is "what just happened" instead, so the newest `limit`
    // is right there.
    // Caveat this does NOT cover, mechanism unconfirmed: whether game.messages
    // (a WorldCollection - Foundry's own docs describe it as the full set of
    // ChatMessage documents in the world, with no partial-load language) can
    // ever actually be incomplete client-side after a GM tab reload. An
    // earlier version of this comment named CONFIG.ChatMessage.batchSize/
    // ChatLog.renderBatch as the cause, but those are documented as sidebar
    // *rendering* pagination, not WorldCollection sync - likely the wrong
    // mechanism. Left as a suspected, unconfirmed risk rather than asserted
    // as fact either way - see list-chat-log-sinceid-reload-completeness in
    // the notes file. If it turns out game.messages is always complete, this
    // whole caveat can be deleted. Separately, an unresolvable sinceId below
    // always reads as "nothing missed" regardless of cause - a typo'd id, a
    // real reload gap (this caveat), or simply that the anchor message was
    // deleted from chat since (an everyday GM action, arguably more common
    // than a reload gap) all look identical from here.
    const limited = params.sinceId
      ? filtered.slice(0, limit)
      : filtered.slice(Math.max(0, filtered.length - limit));

    return { entries: limited, total: filtered.length };
  }

  /**
   * The active combat encounter: whose turn it is, initiative order, HP and
   * defeated state, and the handful of actions that advance it. See
   * manageCombat's tool description for the full action list.
   *
   * `game.combat` is Foundry's own "the encounter currently being viewed"
   * getter — the same one the built-in Combat Tracker sidebar uses — so this
   * follows the same target a GM looking at their own screen would.
   */
  async manageCombat(params: {
    action: string;
    combatId?: string;
    combatantIds?: string[];
    tokenIds?: string[];
    initiative?: number;
    formula?: string;
    npcsOnly?: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    const resolveCombat = (combatId?: string): any => {
      if (combatId) {
        const c = (game as any).combats?.get(combatId);
        if (!c) throw new Error(`Combat not found: ${combatId}`);
        return c;
      }
      return (game as any).combat ?? null;
    };

    // pf2e/dnd5e keep HP at system.attributes.hp; WFRP4e AND DSA5 both at
    // system.status.wounds (DSA5's own actor-dsa5.js applyDamage/applyRegeneration
    // read/write system.status.wounds.value/.max the same way WFRP4e does - audit
    // round 6 confirmed via DSA5's upstream source and template.json after round 5
    // wrongly logged DSA5 as an unhandled gap; the two systems just happen to share
    // this shape, so DSA5 was already covered by this branch); Cosmere RPG at
    // system.resources.hea as DerivedValueField(s) (see readDerived's own doc
    // comment); MGT2e (Traveller) at system.hits, either {value, max} or (rarely,
    // pre-normalization) a bare number treated as max - same shape already read
    // at ~line 1455 and written at ~line 11368. Checked in that order so a
    // system matching an earlier shape never falls through to a later one.
    const readCombatantHp = (actor: any): { value: number | null; max: number | null } | null => {
      const system = actor?.system;
      if (!system) return null;

      const attrHp = system.attributes?.hp;
      if (attrHp && (attrHp.value !== undefined || attrHp.max !== undefined)) {
        return { value: attrHp.value ?? null, max: attrHp.max ?? null };
      }

      const wounds = system.status?.wounds;
      if (wounds && (wounds.value !== undefined || wounds.max !== undefined)) {
        return { value: wounds.value ?? null, max: wounds.max ?? null };
      }

      // Cosmere DerivedValueField ({value, derived, override?, useOverride, bonus?}) -
      // duplicated from PersistentCreatureIndex.readDerived rather than shared across
      // classes for a two-line resolver. `value` is checked first because on a live,
      // prepared actor it's already the fully-resolved (useOverride ? override :
      // derived) + bonus number (cosmere-rpg's own DerivedValueField getter) - audit
      // round 6 found the previous override-before-value order silently dropped
      // `bonus` whenever useOverride was true.
      const resolveDerived = (field: any): number | undefined => {
        if (field == null) return undefined;
        if (typeof field === 'number') return field;
        if (typeof field === 'object') {
          if (typeof field.value === 'number') return field.value;
          if (field.useOverride === true && typeof field.override === 'number') {
            return field.override;
          }
          if (typeof field.derived === 'number') return field.derived;
        }
        return undefined;
      };

      const hea = system.resources?.hea;
      if (hea != null) {
        const value = typeof hea.value === 'number' ? hea.value : resolveDerived(hea.value);
        const max = resolveDerived(hea.max);
        if (value !== undefined || max !== undefined) {
          return { value: value ?? null, max: max ?? null };
        }
      }

      const hits = system.hits;
      if (hits != null) {
        if (typeof hits === 'number') {
          return { value: hits, max: hits };
        }
        if (typeof hits === 'object' && (hits.value !== undefined || hits.max !== undefined)) {
          return { value: hits.value ?? null, max: hits.max ?? null };
        }
      }

      return null;
    };

    const combatantSnapshot = (c: any) => {
      const actor = c.actor ?? null;
      // Prefer Foundry's own Combatant#isNPC getter, which is documented as
      // treating an actor-less combatant (deleted actor, orphaned token) as NPC
      // (true) rather than unknown - audit round 6 found the prior
      // actor-only fallback returned null for that case instead. Only fall back
      // to reimplementing it via hasPlayerOwner when c.isNPC isn't present at
      // all (e.g. a stubbed combatant in tests).
      const isNPC = typeof c.isNPC === 'boolean' ? c.isNPC : actor ? !actor.hasPlayerOwner : true;
      return {
        id: c.id,
        name: c.name ?? actor?.name ?? 'Unknown',
        actorId: c.actorId ?? null,
        tokenId: c.tokenId ?? null,
        initiative: c.initiative ?? null,
        hidden: !!c.hidden,
        defeated: !!(c.isDefeated ?? c.defeated),
        isNPC,
        hp: readCombatantHp(actor),
      };
    };

    const describe = (combat: any) => {
      if (!combat) {
        return {
          active: false,
          combatId: null,
          round: 0,
          turn: null,
          current: null,
          combatants: [],
        };
      }
      const turns: any[] = combat.turns ?? [];
      const turnIndex: number | null = combat.turn ?? null;
      const current =
        turnIndex !== null && turns[turnIndex] ? combatantSnapshot(turns[turnIndex]) : null;
      return {
        active: true,
        combatId: combat.id,
        started: !!combat.started,
        round: combat.round ?? 0,
        turn: turnIndex,
        current,
        combatants: turns.map(combatantSnapshot),
      };
    };

    const action = params.action ?? 'get';

    if (action === 'get') {
      return describe(resolveCombat(params.combatId));
    }

    if (action === 'start') {
      let combat = resolveCombat(params.combatId);
      if (!combat) {
        const scene = (game.scenes as any).current;
        combat = await (Combat as any).create({ scene: scene?.id ?? null });
        if (!combat) throw new Error('Foundry did not create a Combat document.');
      }
      await combat.startCombat();
      this.auditLog('manageCombat.start', { combatId: combat.id }, 'success');
      return describe(combat);
    }

    const combat = resolveCombat(params.combatId);
    if (!combat) {
      throw new Error(
        `No active combat${params.combatId ? ` (${params.combatId})` : ''}. Use action:"start" first.`
      );
    }

    switch (action) {
      case 'end': {
        // Combat#endCombat() is a UI confirmation dialog ("are you sure?"),
        // not a headless end - it doesn't resolve until a human clicks it.
        // delete() is the real headless call.
        await combat.delete();
        this.auditLog('manageCombat.end', { combatId: combat.id }, 'success');
        return { ended: true, combatId: combat.id };
      }

      case 'next-turn':
        await combat.nextTurn();
        break;

      case 'previous-turn':
        await combat.previousTurn();
        break;

      case 'next-round':
        await combat.nextRound();
        break;

      case 'previous-round':
        await combat.previousRound();
        break;

      case 'roll-initiative': {
        const options = params.formula ? { formula: params.formula } : undefined;
        if (params.combatantIds?.length) {
          await combat.rollInitiative(params.combatantIds, options);
        } else if (params.npcsOnly) {
          await combat.rollNPC(options);
        } else {
          await combat.rollAll(options);
        }
        break;
      }

      case 'set-initiative': {
        const id = params.combatantIds?.[0];
        if (!id) throw new Error('set-initiative requires combatantIds[0]');
        if (typeof params.initiative !== 'number') {
          throw new Error('set-initiative requires a numeric initiative');
        }
        if (typeof combat.setInitiative === 'function') {
          await combat.setInitiative(id, params.initiative);
        } else {
          const c = combat.combatants.get(id);
          if (!c) throw new Error(`Combatant not found: ${id}`);
          await c.update({ initiative: params.initiative });
        }
        break;
      }

      case 'add-combatants': {
        if (!params.tokenIds?.length) throw new Error('add-combatants requires tokenIds');
        // Prefer the target combat's OWN scene (combat.scene, a real Combat field/getter)
        // over the currently-viewed scene - audit round 6 found the prior code always used
        // the viewed scene even when combatId targets a different, non-viewed combat (this
        // tool's own combatId param exists specifically to let a caller do that). Falls back
        // to the viewed scene for a scene-less combat, which Foundry does allow.
        const scene = combat.scene ?? (game.scenes as any).current;
        if (!scene) throw new Error('No active scene found');
        const notFound: string[] = [];
        const alreadyInCombat: string[] = [];
        const creates: any[] = [];
        for (const tokenId of params.tokenIds) {
          const token = scene.tokens.get(tokenId);
          if (!token) {
            notFound.push(tokenId);
            continue;
          }
          // Mirrors Foundry's own TokenDocument#createCombatants (client/documents/
          // token.mjs): carry the token's hidden state over so a hidden ambusher
          // doesn't show up on the tracker visible by default, and skip a token
          // already in this combat instead of creating a duplicate Combatant
          // (audit round 7, confirmed against the installed v14 client).
          if (token.inCombat) {
            alreadyInCombat.push(tokenId);
            continue;
          }
          creates.push({ tokenId: token.id, sceneId: scene.id, hidden: !!token.hidden });
        }
        if (creates.length === 0) {
          throw new Error(
            `No combatants to add: ${params.tokenIds.join(', ')} (not found: ${notFound.join(', ') || 'none'}; already in combat: ${alreadyInCombat.join(', ') || 'none'})`
          );
        }
        await combat.createEmbeddedDocuments('Combatant', creates);
        this.auditLog('manageCombat.add-combatants', { count: creates.length }, 'success');
        return { ...describe(combat), notFound, alreadyInCombat };
      }

      case 'remove-combatants': {
        if (!params.combatantIds?.length)
          throw new Error('remove-combatants requires combatantIds');
        await combat.deleteEmbeddedDocuments('Combatant', params.combatantIds);
        this.auditLog(
          'manageCombat.remove-combatants',
          { count: params.combatantIds.length },
          'success'
        );
        break;
      }

      case 'toggle-defeated': {
        if (!params.combatantIds?.length) throw new Error('toggle-defeated requires combatantIds');
        for (const id of params.combatantIds) {
          const c = combat.combatants.get(id);
          if (!c) throw new Error(`Combatant not found: ${id}`);
          const isDefeated = !(c.isDefeated ?? c.defeated);
          await c.update({ defeated: isDefeated });
          // Foundry's own tracker skull-icon handler (CombatTracker#_onToggleDefeatedStatus,
          // client/applications/sidebar/tabs/combat-tracker.mjs) does this too, not just the
          // raw field flip - without it the `defeated` field changes but the token's dead/
          // skull overlay on the canvas never appears or disappears. Confirmed against the
          // installed Foundry v14 client (audit round 7); previously logged only as
          // "suspected" (toggle-defeated-isDefeated-getter-unverified in the notes file)
          // since round 2.
          const statusId =
            typeof CONFIG !== 'undefined'
              ? (CONFIG as any).specialStatusEffects?.DEFEATED
              : undefined;
          if (statusId && typeof c.actor?.toggleStatusEffect === 'function') {
            await c.actor.toggleStatusEffect(statusId, { overlay: true, active: isDefeated });
          }
        }
        break;
      }

      case 'toggle-hidden': {
        if (!params.combatantIds?.length) throw new Error('toggle-hidden requires combatantIds');
        for (const id of params.combatantIds) {
          const c = combat.combatants.get(id);
          if (!c) throw new Error(`Combatant not found: ${id}`);
          await c.update({ hidden: !c.hidden });
        }
        break;
      }

      default:
        throw new Error(
          `Unknown manage-combat action: ${action}. See the tool description for valid actions.`
        );
    }

    this.auditLog('manageCombat', { action, combatId: combat.id }, 'success');
    return describe(combat);
  }

  // ---------------------------------------------------------------------------
  // Roll tables (manage-rolltables)
  // ---------------------------------------------------------------------------

  /** The field TableResult stores its text under: `description` since v13, `text` before. */
  private tableResultTextKey(): string {
    const fields = (foundry as any).documents?.BaseTableResult?.schema?.fields ?? {};
    return 'description' in fields ? 'description' : 'text';
  }

  private resolveRollTable(idOrName: string): any {
    const tables = (game as any).tables;
    return (
      tables?.get(idOrName) ??
      tables?.find((t: any) => t.name?.toLowerCase() === idOrName.toLowerCase()) ??
      null
    );
  }

  /**
   * Turn friendly result rows into TableResult source data. If no row carries
   * an explicit range, rows are auto-numbered 1..N (a mix of some-with and
   * some-without is ambiguous and rejected).
   */
  private buildTableResults(
    rows: Array<{
      text: string;
      weight?: number;
      range?: [number, number];
      img?: string;
      documentUuid?: string;
    }>
  ): { results: Array<Record<string, any>>; maxRoll: number } {
    const withRange = rows.filter(r => Array.isArray(r.range)).length;
    if (withRange > 0 && withRange < rows.length) {
      throw new Error(
        `${withRange} of ${rows.length} result rows have a "range" — give every row a range, ` +
          `or none (rows are then auto-numbered 1..${rows.length}).`
      );
    }

    const textKey = this.tableResultTextKey();
    const TYPES: any = (CONST as any).TABLE_RESULT_TYPES ?? {};
    let maxRoll = 0;

    const results = rows.map((row, i) => {
      const range = row.range ?? [i + 1, i + 1];
      if (range[0] > range[1]) {
        throw new Error(`Result "${row.text}": range [${range[0]}, ${range[1]}] is inverted.`);
      }
      maxRoll = Math.max(maxRoll, range[1]);
      const data: Record<string, any> = {
        type: row.documentUuid ? (TYPES.DOCUMENT ?? 'document') : (TYPES.TEXT ?? 'text'),
        [textKey]: row.text,
        weight: row.weight ?? 1,
        range,
        drawn: false,
      };
      if (row.img) data.img = row.img;
      if (row.documentUuid) data.documentUuid = row.documentUuid;
      return data;
    });

    return { results, maxRoll };
  }

  private describeTableResult(r: any): Record<string, any> {
    const textKey = this.tableResultTextKey();
    return {
      id: r.id,
      text: r[textKey] ?? r.text ?? r.name ?? '',
      weight: r.weight ?? 1,
      range: r.range ?? null,
      drawn: !!r.drawn,
      ...(r.documentUuid ? { documentUuid: r.documentUuid } : {}),
      ...(r.img ? { img: r.img } : {}),
    };
  }

  async manageRollTables(params: {
    action: 'create' | 'list' | 'get' | 'update' | 'move' | 'delete' | 'roll';
    id?: string;
    ids?: string[];
    name?: string;
    description?: string;
    formula?: string;
    replacement?: boolean;
    displayRoll?: boolean;
    img?: string;
    folder?: string;
    results?: Array<{
      text: string;
      weight?: number;
      range?: [number, number];
      img?: string;
      documentUuid?: string;
    }>;
    count?: number;
    displayChat?: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    const RollTableCls = (globalThis as any).RollTable;

    switch (params.action) {
      case 'create': {
        if (!params.name?.trim()) throw new Error('"name" is required to create a roll table');
        if (!params.results?.length) {
          throw new Error('"results" must contain at least one row: [{ "text": "..." }, ...]');
        }
        const { results, maxRoll } = this.buildTableResults(params.results);
        const folderId = params.folder
          ? await this.resolveFolderPath(params.folder, 'RollTable')
          : null;
        if (params.folder && !folderId) {
          throw new Error(`Folder "${params.folder}" could not be resolved or created.`);
        }

        const table = await RollTableCls.create({
          name: params.name.trim(),
          description: params.description ?? '',
          formula: params.formula?.trim() || `1d${maxRoll}`,
          replacement: params.replacement ?? true,
          displayRoll: params.displayRoll ?? true,
          ...(params.img ? { img: params.img } : {}),
          folder: folderId,
          results,
        });
        if (!table?.id) throw new Error('RollTable.create returned nothing');

        this.auditLog('manageRollTables', { action: 'create', name: table.name }, 'success');
        return {
          id: table.id,
          name: table.name,
          formula: table.formula,
          resultCount: table.results?.size ?? results.length,
          folder: table.folder?.name ?? null,
        };
      }

      case 'list': {
        const tables = Array.from(((game as any).tables ?? []) as Iterable<any>);
        return {
          tables: tables.map((t: any) => ({
            id: t.id,
            name: t.name,
            formula: t.formula ?? null,
            resultCount: t.results?.size ?? 0,
            replacement: t.replacement ?? true,
            folder: t.folder?.name ?? null,
          })),
          total: tables.length,
        };
      }

      case 'get': {
        const table = this.resolveRollTable(params.id!);
        if (!table) throw new Error(`Roll table not found: "${params.id}"`);
        return {
          id: table.id,
          name: table.name,
          description: table.description ?? '',
          formula: table.formula ?? null,
          replacement: table.replacement ?? true,
          displayRoll: table.displayRoll ?? true,
          img: table.img ?? null,
          folder: table.folder?.name ?? null,
          results: Array.from((table.results ?? []) as Iterable<any>).map((r: any) =>
            this.describeTableResult(r)
          ),
        };
      }

      case 'update': {
        const table = this.resolveRollTable(params.id!);
        if (!table) throw new Error(`Roll table not found: "${params.id}"`);

        const patch: Record<string, any> = {};
        if (params.name !== undefined) patch.name = params.name;
        if (params.description !== undefined) patch.description = params.description;
        if (params.formula !== undefined) patch.formula = params.formula;
        if (params.replacement !== undefined) patch.replacement = params.replacement;
        if (params.displayRoll !== undefined) patch.displayRoll = params.displayRoll;
        if (params.img !== undefined) patch.img = params.img;
        if (Object.keys(patch).length > 0) await table.update(patch);

        let resultsReplaced = false;
        if (params.results?.length) {
          const { results, maxRoll } = this.buildTableResults(params.results);
          const oldIds = Array.from((table.results ?? []) as Iterable<any>).map((r: any) => r.id);
          if (oldIds.length > 0) await table.deleteEmbeddedDocuments('TableResult', oldIds);
          await table.createEmbeddedDocuments('TableResult', results);
          // Keep the formula in step with an auto-numbered replacement set.
          if (params.formula === undefined && !params.results.some(r => r.range)) {
            await table.update({ formula: `1d${maxRoll}` });
          }
          resultsReplaced = true;
        }

        this.auditLog('manageRollTables', { action: 'update', id: table.id }, 'success');
        return {
          id: table.id,
          name: table.name,
          formula: table.formula,
          resultCount: table.results?.size ?? 0,
          resultsReplaced,
        };
      }

      case 'move': {
        const table = this.resolveRollTable(params.id!);
        if (!table) throw new Error(`Roll table not found: "${params.id}"`);
        const folderId = await this.resolveFolderPath(params.folder!, 'RollTable');
        if (!folderId) {
          throw new Error(`Folder "${params.folder}" could not be resolved or created.`);
        }
        await table.update({ folder: folderId });
        this.auditLog('manageRollTables', { action: 'move', id: table.id }, 'success');
        return { id: table.id, name: table.name, folder: table.folder?.name ?? null };
      }

      case 'delete': {
        const resolved: Array<{ id: string; name: string }> = [];
        const missing: string[] = [];
        for (const id of params.ids ?? []) {
          const table = (game as any).tables?.get(id);
          if (table) resolved.push({ id: table.id, name: table.name });
          else missing.push(id);
        }
        if (missing.length > 0) {
          throw new Error(
            `Roll table id(s) not found: ${missing.join(', ')}. Nothing was deleted — ` +
              `use action:"list" to get valid ids.`
          );
        }
        if (resolved.length === 0) throw new Error('No roll table ids were given');

        await RollTableCls.deleteDocuments(resolved.map(r => r.id));
        const survivors = resolved.filter(r => (game as any).tables?.get(r.id));
        if (survivors.length > 0) {
          throw new Error(
            `Foundry reported success but these tables still exist: ${survivors
              .map(s => `${s.name} (${s.id})`)
              .join(', ')}`
          );
        }
        this.auditLog('manageRollTables', { action: 'delete', count: resolved.length }, 'success');
        return { deleted: resolved, total: resolved.length };
      }

      case 'roll': {
        const table = this.resolveRollTable(params.id!);
        if (!table) throw new Error(`Roll table not found: "${params.id}"`);
        const count = params.count ?? 1;
        const displayChat = params.displayChat ?? true;

        let draw: any;
        try {
          draw =
            count === 1
              ? await table.draw({ displayChat })
              : await table.drawMany(count, { displayChat });
        } catch (error) {
          throw new Error(
            `Could not draw from "${table.name}": ` +
              `${error instanceof Error ? error.message : String(error)}. ` +
              `If the table draws without replacement it may be exhausted — ` +
              `reset it by updating "replacement", or re-create the results.`
          );
        }

        const drawn = (draw?.results ?? []).map((r: any) => this.describeTableResult(r));
        this.auditLog('manageRollTables', { action: 'roll', id: table.id, count }, 'success');
        return {
          table: table.name,
          roll: draw?.roll?.total ?? null,
          requested: count,
          drawn,
          ...(drawn.length < count
            ? { warning: `Only ${drawn.length} of ${count} draws were possible (table exhausted?)` }
            : {}),
        };
      }

      default:
        throw new Error(`Unknown manage-rolltables action: "${(params as any).action}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Macros (manage-macros)
  // ---------------------------------------------------------------------------

  private resolveMacro(idOrName: string): any {
    const macros = (game as any).macros;
    return (
      macros?.get(idOrName) ??
      macros?.find((m: any) => m.name?.toLowerCase() === idOrName.toLowerCase()) ??
      null
    );
  }

  async manageMacros(params: {
    action: 'create' | 'list' | 'get' | 'update' | 'move' | 'delete' | 'execute';
    id?: string;
    ids?: string[];
    name?: string;
    type?: 'script' | 'chat';
    command?: string;
    img?: string;
    folder?: string;
    full?: boolean;
  }): Promise<any> {
    this.validateFoundryState();

    const MacroCls = (globalThis as any).Macro;

    switch (params.action) {
      case 'create': {
        if (!params.name?.trim()) throw new Error('"name" is required to create a macro');
        if (!params.command?.trim()) throw new Error('"command" is required to create a macro');
        const folderId = params.folder
          ? await this.resolveFolderPath(params.folder, 'Macro')
          : null;
        if (params.folder && !folderId) {
          throw new Error(`Folder "${params.folder}" could not be resolved or created.`);
        }

        const macro = await MacroCls.create({
          name: params.name.trim(),
          type: params.type ?? 'script',
          command: params.command,
          scope: 'global',
          ...(params.img ? { img: params.img } : {}),
          folder: folderId,
        });
        if (!macro?.id) throw new Error('Macro.create returned nothing');

        this.auditLog(
          'manageMacros',
          { action: 'create', name: macro.name, type: macro.type },
          'success'
        );
        return {
          id: macro.id,
          name: macro.name,
          type: macro.type,
          folder: macro.folder?.name ?? null,
        };
      }

      case 'list': {
        const macros = Array.from(((game as any).macros ?? []) as Iterable<any>);
        // `full` returns the whole command for every macro in one call. Without it a
        // whole-world macro export is one `get` per macro — 118 round trips on a
        // world we tested against. Folder is reported as a "/"-separated path as well
        // as a bare name, so colliding macro names stay tellable apart: Foundry allows
        // duplicates freely, and that test world had two distinct pairs sharing a name.
        return {
          macros: macros.map((m: any) => ({
            id: m.id,
            name: m.name,
            type: m.type,
            folder: m.folder?.name ?? null,
            folderPath: this.folderPathOf(m.folder),
            ...(params.full
              ? { command: m.command ?? '', img: m.img ?? null }
              : {
                  commandPreview:
                    (m.command ?? '').length > 120
                      ? `${m.command.slice(0, 120)}…`
                      : (m.command ?? ''),
                }),
          })),
          total: macros.length,
          full: params.full === true,
        };
      }

      case 'get': {
        const macro = this.resolveMacro(params.id!);
        if (!macro) throw new Error(`Macro not found: "${params.id}"`);
        return {
          id: macro.id,
          name: macro.name,
          type: macro.type,
          command: macro.command ?? '',
          img: macro.img ?? null,
          folder: macro.folder?.name ?? null,
        };
      }

      case 'update': {
        const macro = this.resolveMacro(params.id!);
        if (!macro) throw new Error(`Macro not found: "${params.id}"`);
        const patch: Record<string, any> = {};
        if (params.name !== undefined) patch.name = params.name;
        if (params.type !== undefined) patch.type = params.type;
        if (params.command !== undefined) patch.command = params.command;
        if (params.img !== undefined) patch.img = params.img;
        if (Object.keys(patch).length === 0) {
          throw new Error('Nothing to update — give at least one of name/type/command/img');
        }
        await macro.update(patch);
        this.auditLog('manageMacros', { action: 'update', id: macro.id }, 'success');
        return { id: macro.id, name: macro.name, type: macro.type };
      }

      case 'move': {
        const macro = this.resolveMacro(params.id!);
        if (!macro) throw new Error(`Macro not found: "${params.id}"`);
        const folderId = await this.resolveFolderPath(params.folder!, 'Macro');
        if (!folderId) {
          throw new Error(`Folder "${params.folder}" could not be resolved or created.`);
        }
        await macro.update({ folder: folderId });
        this.auditLog('manageMacros', { action: 'move', id: macro.id }, 'success');
        return { id: macro.id, name: macro.name, folder: macro.folder?.name ?? null };
      }

      case 'delete': {
        const resolved: Array<{ id: string; name: string }> = [];
        const missing: string[] = [];
        for (const id of params.ids ?? []) {
          const macro = (game as any).macros?.get(id);
          if (macro) resolved.push({ id: macro.id, name: macro.name });
          else missing.push(id);
        }
        if (missing.length > 0) {
          throw new Error(
            `Macro id(s) not found: ${missing.join(', ')}. Nothing was deleted — ` +
              `use action:"list" to get valid ids.`
          );
        }
        if (resolved.length === 0) throw new Error('No macro ids were given');

        await MacroCls.deleteDocuments(resolved.map(r => r.id));
        const survivors = resolved.filter(r => (game as any).macros?.get(r.id));
        if (survivors.length > 0) {
          throw new Error(
            `Foundry reported success but these macros still exist: ${survivors
              .map(s => `${s.name} (${s.id})`)
              .join(', ')}`
          );
        }
        this.auditLog('manageMacros', { action: 'delete', count: resolved.length }, 'success');
        return { deleted: resolved, total: resolved.length };
      }

      case 'execute': {
        const macro = this.resolveMacro(params.id!);
        if (!macro) throw new Error(`Macro not found: "${params.id}"`);

        let result: any;
        try {
          result = await macro.execute();
        } catch (error) {
          this.auditLog(
            'manageMacros',
            { action: 'execute', id: macro.id },
            'failure',
            error instanceof Error ? error.message : String(error)
          );
          throw new Error(
            `Macro "${macro.name}" threw while executing: ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }

        // Script results can be anything; make them transportable.
        let serialized: any = null;
        if (result !== undefined && result !== null) {
          if (typeof result === 'object') {
            try {
              serialized = this.sanitizeData(result);
            } catch {
              serialized = String(result);
            }
          } else {
            serialized = result;
          }
        }

        this.auditLog('manageMacros', { action: 'execute', id: macro.id }, 'success');
        return {
          executed: true,
          id: macro.id,
          name: macro.name,
          type: macro.type,
          command: macro.command ?? '',
          result: serialized,
        };
      }

      default:
        throw new Error(`Unknown manage-macros action: "${(params as any).action}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Images (manage-images): search / assign / svg-to-png
  // ---------------------------------------------------------------------------

  private static readonly IMAGE_EXTENSIONS = ['webp', 'png', 'jpg', 'jpeg', 'svg', 'gif'];

  private filePicker(): any {
    return (foundry as any).applications.apps.FilePicker.implementation;
  }

  /**
   * Breadth-first filename search through a FilePicker source. Browse is
   * per-directory, so this walks with hard caps (result count + directories
   * scanned) — the PF2e icon tree alone holds thousands of files.
   */
  private async searchImageFiles(params: {
    query?: string;
    path?: string;
    source?: string;
    extensions?: string[];
    maxResults?: number;
  }): Promise<{ files: string[]; total: number; truncated: boolean; dirsScanned: number }> {
    const source = params.source ?? 'data';
    const root = (params.path ?? '').trim().replace(/^\/+|\/+$/g, '');
    const exts = (params.extensions ?? FoundryDataAccess.IMAGE_EXTENSIONS).map(e =>
      e.toLowerCase().replace(/^\./, '')
    );
    const cap = Math.min(params.maxResults ?? 50, 200);
    const query = (params.query ?? '').toLowerCase();
    const MAX_DIRS = 400;

    const matches: string[] = [];
    const queue: string[] = [root];
    const visited = new Set<string>();
    let dirsScanned = 0;
    let browseFailures = 0;

    while (queue.length > 0 && matches.length < cap && dirsScanned < MAX_DIRS) {
      const dir = queue.shift()!;
      if (visited.has(dir)) continue;
      visited.add(dir);
      dirsScanned++;

      let listing: any;
      try {
        listing = await this.filePicker().browse(source, dir);
      } catch {
        browseFailures++;
        continue;
      }

      for (const file of listing.files ?? []) {
        const base = decodeURIComponent(String(file).split('/').pop() ?? '').toLowerCase();
        const ext = base.includes('.') ? base.split('.').pop()! : '';
        if (!exts.includes(ext)) continue;
        if (query && !base.includes(query)) continue;
        matches.push(file);
        if (matches.length >= cap) break;
      }
      for (const sub of listing.dirs ?? []) queue.push(String(sub));
    }

    if (matches.length === 0 && dirsScanned <= 1 && browseFailures > 0) {
      throw new Error(
        `Could not browse "${root || '(root)'}" in source "${source}" — the directory may not exist.`
      );
    }

    return {
      files: matches,
      total: matches.length,
      truncated: matches.length >= cap || dirsScanned >= MAX_DIRS,
      dirsScanned,
    };
  }

  /** Throw unless `path` exists in the 'data' or 'public' file sources. */
  private async verifyImageFileExists(path: string): Promise<void> {
    const clean = path.split('?')[0];
    const dir = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    const base = decodeURIComponent(clean.split('/').pop() ?? '');
    for (const source of ['data', 'public']) {
      try {
        const listing = await this.filePicker().browse(source, dir);
        const found = (listing.files ?? []).some(
          (f: string) => decodeURIComponent(String(f).split('/').pop() ?? '') === base
        );
        if (found) return;
      } catch {
        /* directory absent in this source — try the next */
      }
    }
    throw new Error(
      `Image not found on the server: "${path}". Use manage-images action:"search" to find ` +
        `a valid path — nothing was assigned.`
    );
  }

  /** Point an actor portrait / prototype token / item at an existing image. */
  private async assignImageTo(
    imagePath: string,
    target: {
      targetType: 'actor' | 'item';
      actorIdentifier?: string;
      itemId?: string;
      scope?: 'portrait' | 'token' | 'both';
    }
  ): Promise<{ assigned: Record<string, any> }> {
    const isUrl = /^(https?:)?\/\//i.test(imagePath);
    if (!isUrl) await this.verifyImageFileExists(imagePath);

    if (target.targetType === 'actor') {
      if (!target.actorIdentifier) {
        throw new Error('targetType "actor" requires "actorIdentifier"');
      }
      const actor = this.findActorByIdentifier(target.actorIdentifier);
      if (!actor) throw new Error(`Actor not found: ${target.actorIdentifier}`);

      const scope = target.scope ?? 'both';
      const patch: Record<string, any> = {};
      if (scope === 'portrait' || scope === 'both') patch.img = imagePath;
      if (scope === 'token' || scope === 'both') {
        patch.prototypeToken = { texture: { src: imagePath } };
      }
      await actor.update(patch);

      this.auditLog('manageImages', { action: 'assign', actor: actor.name, scope }, 'success');
      return {
        assigned: { type: 'actor', id: actor.id, name: actor.name, scope, imagePath },
      };
    }

    // targetType === 'item'
    if (!target.itemId) throw new Error('targetType "item" requires "itemId"');

    if (target.actorIdentifier) {
      const actor = this.findActorByIdentifier(target.actorIdentifier);
      if (!actor) throw new Error(`Actor not found: ${target.actorIdentifier}`);
      const item =
        actor.items.get(target.itemId) ??
        actor.items.find((i: any) => i.name?.toLowerCase() === target.itemId!.toLowerCase());
      if (!item) {
        throw new Error(`Item "${target.itemId}" not found on actor "${actor.name}"`);
      }
      await item.update({ img: imagePath });
      this.auditLog(
        'manageImages',
        { action: 'assign', actor: actor.name, item: item.name },
        'success'
      );
      return {
        assigned: {
          type: 'actor-item',
          id: item.id,
          name: item.name,
          actor: actor.name,
          imagePath,
        },
      };
    }

    const items = (game as any).items;
    const item =
      items?.get(target.itemId) ??
      items?.find((i: any) => i.name?.toLowerCase() === target.itemId!.toLowerCase());
    if (!item) {
      throw new Error(
        `World item "${target.itemId}" not found. For an item on an actor, also pass "actorIdentifier".`
      );
    }
    await item.update({ img: imagePath });
    this.auditLog('manageImages', { action: 'assign', item: item.name }, 'success');
    return { assigned: { type: 'item', id: item.id, name: item.name, imagePath } };
  }

  /** Rasterise SVG markup to PNG via a canvas and upload it into the data directory. */
  private async svgToPng(params: {
    svg?: string;
    svgPath?: string;
    filename?: string;
    destination?: string;
    width?: number;
    height?: number;
    assignTo?: {
      targetType: 'actor' | 'item';
      actorIdentifier?: string;
      itemId?: string;
      scope?: 'portrait' | 'token' | 'both';
    };
  }): Promise<any> {
    let markup = params.svg;
    if (!markup && params.svgPath) {
      await this.verifyImageFileExists(params.svgPath);
      const response = await fetch(params.svgPath);
      if (!response.ok) {
        throw new Error(`Could not read "${params.svgPath}": HTTP ${response.status}`);
      }
      markup = await response.text();
    }
    if (!markup?.trim()) throw new Error('Provide "svg" markup or an existing "svgPath"');
    if (!/<svg[\s>]/i.test(markup)) {
      throw new Error('The provided markup has no <svg> tag — it is not SVG.');
    }

    const rawName = (params.filename ?? '').trim().split('/').pop() ?? '';
    if (!rawName) throw new Error('"filename" is required, e.g. "clownkin-jester.png"');
    const filename = /\.png$/i.test(rawName) ? rawName : `${rawName}.png`;

    const blobUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
    let pngBlob: Blob | null = null;
    let width = params.width ?? 0;
    let height = params.height ?? 0;
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () =>
          reject(
            new Error(
              'The SVG could not be rasterised — check that the markup is valid, ' +
                'self-contained SVG (no external references).'
            )
          );
        image.src = blobUrl;
      });

      const naturalW = image.naturalWidth || 0;
      const naturalH = image.naturalHeight || 0;
      if (!width && !height) {
        width = naturalW || 512;
        height = naturalH || 512;
      } else if (width && !height) {
        height = naturalW > 0 ? Math.round((width * naturalH) / naturalW) : width;
      } else if (!width && height) {
        width = naturalH > 0 ? Math.round((height * naturalW) / naturalH) : height;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get a 2d canvas context in the Foundry client');
      ctx.drawImage(image, 0, 0, width, height);

      pngBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    if (!pngBlob) throw new Error('Canvas produced no PNG data');

    // Ensure the destination directory chain exists; upload fails loudly if not.
    const destination = (params.destination ?? 'foundry-mcp-assets').replace(/^\/+|\/+$/g, '');
    const segments = destination.split('/').filter(s => s.length > 0);
    let partial = '';
    for (const segment of segments) {
      partial = partial ? `${partial}/${segment}` : segment;
      try {
        await this.filePicker().createDirectory('data', partial);
      } catch {
        /* already exists */
      }
    }

    const file = new File([pngBlob], filename, { type: 'image/png' });
    const uploaded = await this.filePicker().upload(
      'data',
      destination,
      file,
      {},
      { notify: false }
    );
    const path = uploaded?.path ?? `${destination}/${filename}`;
    if (!uploaded) throw new Error('Foundry rejected the PNG upload');

    this.auditLog('manageImages', { action: 'svg-to-png', path, width, height }, 'success');

    const warnings: string[] = [];
    let assigned: Record<string, any> | null = null;
    if (params.assignTo) {
      try {
        assigned = (await this.assignImageTo(path, params.assignTo)).assigned;
      } catch (error) {
        warnings.push(
          `The PNG was uploaded to "${path}" but could not be assigned: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      path,
      width,
      height,
      assigned,
      ...(warnings.length ? { warnings } : {}),
    };
  }

  async manageImages(params: {
    action: 'search' | 'assign' | 'svg-to-png';
    query?: string;
    path?: string;
    source?: string;
    extensions?: string[];
    maxResults?: number;
    imagePath?: string;
    targetType?: 'actor' | 'item';
    actorIdentifier?: string;
    itemId?: string;
    scope?: 'portrait' | 'token' | 'both';
    svg?: string;
    svgPath?: string;
    filename?: string;
    destination?: string;
    width?: number;
    height?: number;
    assignTo?: {
      targetType: 'actor' | 'item';
      actorIdentifier?: string;
      itemId?: string;
      scope?: 'portrait' | 'token' | 'both';
    };
  }): Promise<any> {
    this.validateFoundryState();

    switch (params.action) {
      case 'search':
        return await this.searchImageFiles(params);

      case 'assign': {
        if (!params.imagePath?.trim()) throw new Error('"imagePath" is required');
        if (!params.targetType) throw new Error('"targetType" is required ("actor" or "item")');
        return await this.assignImageTo(params.imagePath.trim(), {
          targetType: params.targetType,
          ...(params.actorIdentifier ? { actorIdentifier: params.actorIdentifier } : {}),
          ...(params.itemId ? { itemId: params.itemId } : {}),
          ...(params.scope ? { scope: params.scope } : {}),
        });
      }

      case 'svg-to-png':
        return await this.svgToPng(params);

      default:
        throw new Error(`Unknown manage-images action: "${(params as any).action}"`);
    }
  }

  // ─── mgt2e ──────────────────────────────────────────────────────────────────
}

// =============================================================================
// Shared dnd5e helpers
// =============================================================================

// =============================================================================
// Folder path errors
// =============================================================================

/**
 * Marker for folder-path failures that must reach the caller.
 *
 * `resolveFolderPath` deliberately swallows most problems and returns null so
 * content still gets created (just unfiled). That fallback is wrong for depth
 * limits and outright creation refusals: the content lands at the root with no
 * warning, which is exactly the silent-failure pattern this bridge keeps hitting.
 * Errors tagged here are re-thrown instead of being downgraded to null.
 */
const FOLDER_PATH_ERROR = Symbol.for('foundry-mcp-bridge.folderPathError');

function folderPathError(message: string): Error {
  const err = new Error(message);
  (err as any)[FOLDER_PATH_ERROR] = true;
  return err;
}

function isFolderPathError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as any)[FOLDER_PATH_ERROR] === true;
}

function slugify(name: string, fallback = 'feature'): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '') || fallback
  );
}

// =============================================================================
// NPC creation helpers — module-level, used exclusively by createNpcActor
// =============================================================================

const NPC_DAMAGE_CANONICAL = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

const NPC_CONDITION_CANONICAL = new Set([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
]);

const NPC_SIZE_MAP: Record<string, string> = {
  tiny: 'tiny',
  small: 'sm',
  medium: 'med',
  large: 'lg',
  huge: 'huge',
  gargantuan: 'grg',
};

const NPC_SKILL_MAP: Record<string, string> = {
  Acrobatics: 'acr',
  'Animal Handling': 'ani',
  Arcana: 'arc',
  Athletics: 'ath',
  Deception: 'dec',
  History: 'his',
  Insight: 'ins',
  Intimidation: 'itm',
  Investigation: 'inv',
  Medicine: 'med',
  Nature: 'nat',
  Perception: 'prc',
  Performance: 'prf',
  Persuasion: 'per',
  Religion: 'rel',
  'Sleight of Hand': 'slt',
  Stealth: 'ste',
  Survival: 'sur',
};

function npcNormalizeCR(input: string | number): number {
  if (typeof input === 'number') return input;
  if (input.includes('/')) {
    const [num, den] = input.split('/').map(Number);
    return num / den;
  }
  return parseInt(input, 10);
}

function npcFormatCR(value: number): string {
  if (value === 0) return '0';
  if (value === 0.125) return '1/8';
  if (value === 0.25) return '1/4';
  if (value === 0.5) return '1/2';
  return String(Math.round(value));
}

function npcBuildSkillsBlock(
  skills: Array<{ skill: string; proficiency: string }>
): Record<string, { value: number }> {
  const result: Record<string, { value: number }> = {};
  for (const { skill, proficiency } of skills) {
    const key = NPC_SKILL_MAP[skill];
    if (key) {
      result[key] = { value: proficiency === 'expert' ? 2 : 1 };
    }
  }
  return result;
}

// =============================================================================
// Attack feature helpers — module-level, used exclusively by addAttackToActor
// =============================================================================

const ATTACK_DAMAGE_CANONICAL = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

const ATTACK_PROPERTY_CANONICAL = new Set([
  'ada',
  'amm',
  'fin',
  'fir',
  'foc',
  'hvy',
  'lgt',
  'lod',
  'mgc',
  'rch',
  'ret',
  'spc',
  'thr',
  'two',
  'ver',
]);

// =============================================================================
// Aura feature helpers — module-level, used exclusively by addAuraToActor
// =============================================================================

const AURA_DAMAGE_CANONICAL = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

// =============================================================================
// Attack+save helpers — module-level, used exclusively by addAttackWithSaveToActor
// =============================================================================

const ATTACK_WITH_SAVE_DAMAGE_CANONICAL = new Set([
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
]);

// =============================================================================
// Spellcasting slot tables — module-level, used by setActorSpellcasting
//
// Each array has 20 entries (index 0 = level 1 … index 19 = level 20).
// Each entry is a 9-element tuple: [L1, L2, L3, L4, L5, L6, L7, L8, L9].
// Source: SRD 5.1 spell slot tables.
// =============================================================================

// prettier-ignore
const FULL_CASTER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level  9
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   3,   2,   1,   0,   0,   0 ], // level 11
  [   4,   3,   3,   3,   2,   1,   0,   0,   0 ], // level 12
  [   4,   3,   3,   3,   2,   1,   1,   0,   0 ], // level 13
  [   4,   3,   3,   3,   2,   1,   1,   0,   0 ], // level 14
  [   4,   3,   3,   3,   2,   1,   1,   1,   0 ], // level 15
  [   4,   3,   3,   3,   2,   1,   1,   1,   0 ], // level 16
  [   4,   3,   3,   3,   2,   1,   1,   1,   1 ], // level 17
  [   4,   3,   3,   3,   3,   1,   1,   1,   1 ], // level 18
  [   4,   3,   3,   3,   3,   2,   1,   1,   1 ], // level 19
  [   4,   3,   3,   3,   3,   2,   2,   1,   1 ], // level 20
];

// prettier-ignore
/** Paladin / Ranger — half-caster (rounds down). Level 1 = no slots. */
const HALF_CASTER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   0,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1 — no slots
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  9
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 11
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 12
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 13
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 14
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 15
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 16
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 17
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 18
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 19
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 20
];

// prettier-ignore
/** Artificer — half-caster (rounds UP). Starts at level 1. Max 5th-level slots. */
const ARTIFICER_SLOTS: number[][] = [
  //  L1  L2  L3  L4  L5  L6  L7  L8  L9
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  1
  [   2,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  2
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  3
  [   3,   0,   0,   0,   0,   0,   0,   0,   0 ], // level  4
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  5
  [   4,   2,   0,   0,   0,   0,   0,   0,   0 ], // level  6
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  7
  [   4,   3,   0,   0,   0,   0,   0,   0,   0 ], // level  8
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level  9
  [   4,   3,   2,   0,   0,   0,   0,   0,   0 ], // level 10
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 11
  [   4,   3,   3,   0,   0,   0,   0,   0,   0 ], // level 12
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 13
  [   4,   3,   3,   1,   0,   0,   0,   0,   0 ], // level 14
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 15
  [   4,   3,   3,   2,   0,   0,   0,   0,   0 ], // level 16
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 17
  [   4,   3,   3,   3,   1,   0,   0,   0,   0 ], // level 18
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 19
  [   4,   3,   3,   3,   2,   0,   0,   0,   0 ], // level 20
];

// prettier-ignore
/** Warlock Pact Magic — slot count and slot level per warlock level. */
const WARLOCK_PACT_TABLE: Array<{ max: number; level: number }> = [
  { max: 1, level: 1 }, // level  1
  { max: 2, level: 1 }, // level  2
  { max: 2, level: 2 }, // level  3
  { max: 2, level: 2 }, // level  4
  { max: 2, level: 3 }, // level  5
  { max: 2, level: 3 }, // level  6
  { max: 2, level: 4 }, // level  7
  { max: 2, level: 4 }, // level  8
  { max: 2, level: 5 }, // level  9
  { max: 2, level: 5 }, // level 10
  { max: 3, level: 5 }, // level 11
  { max: 3, level: 5 }, // level 12
  { max: 3, level: 5 }, // level 13
  { max: 3, level: 5 }, // level 14
  { max: 3, level: 5 }, // level 15
  { max: 3, level: 5 }, // level 16
  { max: 4, level: 5 }, // level 17
  { max: 4, level: 5 }, // level 18
  { max: 4, level: 5 }, // level 19
  { max: 4, level: 5 }, // level 20
];

// =============================================================================
// PF2e ABC item helpers — module-level, used exclusively by createPf2eAbcItem
// =============================================================================

const PF2E_ABC_ITEM_TYPES = new Set([
  'ancestry',
  'heritage',
  'background',
  'class',
  'deity',
  'feat',
  'action',
  'effect',
  'spell',
]);

/** PF2e's own default-icon art per item type. A missing file just renders blank. */
const PF2E_ITEM_DEFAULT_IMG: Record<string, string> = {
  ancestry: 'systems/pf2e/icons/default-icons/ancestry.svg',
  heritage: 'systems/pf2e/icons/default-icons/heritage.svg',
  background: 'systems/pf2e/icons/default-icons/background.svg',
  class: 'systems/pf2e/icons/default-icons/class.svg',
  deity: 'systems/pf2e/icons/default-icons/deity.svg',
  feat: 'systems/pf2e/icons/default-icons/feat.svg',
  action: 'systems/pf2e/icons/default-icons/action.svg',
  effect: 'systems/pf2e/icons/default-icons/effect.svg',
  spell: 'systems/pf2e/icons/default-icons/spell.svg',
};

/** Feat categories the character sheet slots by class-defined level (vs. unslotted bonus/feature). */
const SLOTTED_FEAT_CATEGORIES = new Set(['ancestry', 'class', 'skill', 'general']);

/**
 * Item types whose `system.traits` schema has a `value` array.
 * Verified against the system's own schemas: action/effect declare
 * `traits: {otherTags, value}`, spell picks up `value` from the shared
 * "traits" template in template.json.
 */
const PF2E_TYPES_WITH_TRAIT_VALUE = new Set([
  'ancestry',
  'background',
  'heritage',
  'feat',
  'action',
  'effect',
  'spell',
]);
/**
 * Item types whose `system.traits` schema has a `rarity` field.
 * Spell includes the "rarity" template; action and effect deliberately do NOT
 * (their schemas declare only otherTags + value), so writing rarity there would
 * be silently dropped.
 */
const PF2E_TYPES_WITH_TRAIT_RARITY = new Set([
  'ancestry',
  'background',
  'heritage',
  'class',
  'feat',
  'spell',
]);

/**
 * Minimal `system` payloads for a scratch build (no `basedOn`). Only the
 * type-specific fields that PF2e prep iterates over need to be here — the
 * common template (`description`/`publication`/`rules`/`slug`/`traits`/
 * `_migration`) is added afterwards by `finalizePf2eItemSource`.
 */
const PF2E_ITEM_TEMPLATES: Record<string, Record<string, any>> = {
  ancestry: {
    hp: 8,
    size: 'med',
    reach: 5,
    speed: 25,
    boosts: { '0': { value: [] }, '1': { value: [] } },
    flaws: {},
    languages: { value: ['common'], custom: '' },
    additionalLanguages: { count: 0, value: [], custom: '' },
    vision: 'normal',
    items: {},
  },
  heritage: {
    ancestry: null,
  },
  background: {
    boosts: { '0': { value: [] }, '1': { value: [] } },
    trainedSkills: { value: [], lore: [] },
    items: {},
  },
  class: {
    keyAbility: { value: [], selected: null },
    hp: 8,
    perception: 0,
    savingThrows: { fortitude: 1, reflex: 1, will: 1 },
    attacks: {
      simple: 0,
      martial: 0,
      advanced: 0,
      unarmed: 0,
      other: { name: '', rank: 0 },
    },
    defenses: { unarmored: 0, light: 0, medium: 0, heavy: 0 },
    spellcasting: 0,
    trainedSkills: { value: [], additional: 0 },
    ancestryFeatLevels: { value: [1, 5, 9, 13, 17] },
    classFeatLevels: { value: [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
    generalFeatLevels: { value: [3, 7, 11, 15, 19] },
    skillFeatLevels: { value: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
    skillIncreaseLevels: { value: [3, 5, 7, 9, 11, 13, 15, 17, 19] },
    items: {},
  },
  deity: {
    category: 'deity',
    sanctification: { modal: 'can', what: [] },
    domains: { primary: [], alternate: [] },
    font: [],
    attribute: [],
    skill: [],
    weapons: [],
    spells: {},
  },
  feat: {
    level: { value: 1 },
    category: 'bonus',
    onlyLevel1: false,
    maxTakable: 1,
    actionType: { value: 'passive' },
    actions: { value: null },
    prerequisites: { value: [] },
    location: null,
    subfeatures: {
      keyOptions: [],
      languages: { slots: 0, granted: [] },
      proficiencies: {},
      senses: {},
      suppressedFeatures: [],
    },
  },
  // Shapes below taken from the system's own schemas (template.json for spell,
  // the AbilitySystemData / EffectSystemData defineSchema() blocks for
  // action / effect) rather than inferred from sample items.
  action: {
    actionType: { value: 'action' },
    actions: { value: 1 },
    category: null,
  },
  effect: {
    level: { value: 1 },
    duration: { value: -1, unit: 'unlimited', expiry: null, sustained: false },
    start: { value: 0, initiative: null },
    tokenIcon: { show: true },
    unidentified: false,
    badge: null,
    fromSpell: false,
    context: null,
  },
  spell: {
    level: { value: 1 },
    requirements: '',
    target: { value: '' },
    range: { value: '' },
    area: null,
    time: { value: '2' },
    duration: { value: '', sustained: false },
    damage: {},
    defense: null,
    cost: { value: '' },
    location: { value: null },
    counteraction: false,
  },
};

/** PF2e ability (`action` item) categories; null = an uncategorised action. */
const PF2E_ACTION_CATEGORIES = new Set(['defensive', 'interaction', 'offensive', 'familiar']);

/** Duration units an `effect` accepts, per EffectSystemData's schema. */
const PF2E_EFFECT_DURATION_UNITS = new Set([
  'rounds',
  'minutes',
  'hours',
  'days',
  'unlimited',
  'encounter',
]);

/** Magic traditions a spell can belong to. */
const PF2E_SPELL_TRADITIONS = new Set(['arcane', 'divine', 'occult', 'primal']);

/** The CONFIG.PF2E trait dictionary an item type's `system.traits.value` is validated against. */
function pf2eKnownTraitsFor(type: string): Record<string, string> | undefined {
  const cfg: any = (CONFIG as any).PF2E ?? {};
  switch (type) {
    case 'ancestry':
    case 'heritage':
    case 'background':
      return cfg.creatureTraits;
    case 'feat':
      return cfg.featTraits;
    case 'class':
      return cfg.classTraits;
    case 'spell':
      return cfg.spellTraits;
    // action / effect validate against the action-trait vocabulary, which is
    // also the safest default for anything else.
    default:
      return cfg.actionTraits;
  }
}

/** Resolve a world Item of type "ancestry" by id, exact name, or slug (case-insensitive). */
function findWorldAncestryItem(ref: string): any {
  const needle = (ref ?? '').trim();
  if (!needle) return undefined;
  const bySlug = slugify(needle);
  return Array.from((game as any).items ?? []).find(
    (i: any) =>
      i.type === 'ancestry' &&
      (i.id === needle ||
        i.name?.toLowerCase() === needle.toLowerCase() ||
        i.system?.slug === bySlug)
  );
}

/** Turn `["str","dex"]` / `[]` / `""` rows into PF2e's `{ "0": { value: [...] } }` record. */
function pf2eBoostRows(rows: any): Record<string, { value: string[] }> {
  const out: Record<string, { value: string[] }> = {};
  (Array.isArray(rows) ? rows : []).forEach((row: any, i: number) => {
    out[String(i)] = { value: Array.isArray(row) ? row : row ? [String(row)] : [] };
  });
  return out;
}

/** Coerce a partial rank map to a full one (missing keys -> 0) so PF2e prep never hits NaN. */
function pf2eRanks(obj: any, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = typeof obj?.[k] === 'number' ? obj[k] : 0;
  return out;
}

/** Map the tool's friendly per-type params onto `system` in place. */
function applyPf2eAbcParams(
  type: string,
  system: Record<string, any>,
  data: Record<string, any>,
  _warnings: string[]
): void {
  switch (type) {
    case 'ancestry': {
      if (typeof data.hp === 'number') system.hp = data.hp;
      if (typeof data.size === 'string') system.size = data.size;
      if (typeof data.speed === 'number') system.speed = data.speed;
      if (data.boosts !== undefined) system.boosts = pf2eBoostRows(data.boosts);
      if (data.flaws !== undefined) system.flaws = pf2eBoostRows(data.flaws);
      if (Array.isArray(data.languages)) system.languages = { value: data.languages, custom: '' };
      if (typeof data.additionalLanguages === 'number') {
        system.additionalLanguages = { count: data.additionalLanguages, value: [], custom: '' };
      }
      if (typeof data.vision === 'string') system.vision = data.vision;
      break;
    }
    case 'heritage': {
      if (data.ancestryName || data.ancestrySlug || data.ancestryUuid) {
        let uuid = typeof data.ancestryUuid === 'string' ? data.ancestryUuid.trim() : '';
        let name = typeof data.ancestryName === 'string' ? data.ancestryName : '';
        let slug = typeof data.ancestrySlug === 'string' ? data.ancestrySlug : '';
        if (!uuid) {
          // PF2e's ancestry link is a real UUID — an empty string fails schema
          // validation and Item.createDocuments silently drops the document
          // (no throw), so this must resolve to a real UUID or fail loudly.
          const found = findWorldAncestryItem(name || slug);
          if (!found) {
            throw new Error(
              `heritage ancestry link: no world ancestry item matches "${name || slug}". ` +
                `Pass "ancestryUuid" (the ancestry item's uuid, e.g. from its pf2e-create-abc-item ` +
                `result) explicitly, or the exact name/slug of an ancestry item that already exists.`
            );
          }
          uuid = found.uuid;
          if (!name) name = found.name;
          if (!slug) slug = found.system?.slug ?? slugify(found.name);
        }
        system.ancestry = { name: name || slug, slug: slug || (name ? slugify(name) : ''), uuid };
      }
      break;
    }
    case 'background': {
      if (data.boosts !== undefined) system.boosts = pf2eBoostRows(data.boosts);
      if (Array.isArray(data.trainedSkills) || Array.isArray(data.trainedLore)) {
        system.trainedSkills = {
          value: Array.isArray(data.trainedSkills) ? data.trainedSkills : [],
          lore: Array.isArray(data.trainedLore) ? data.trainedLore : [],
        };
      }
      break;
    }
    case 'class': {
      if (Array.isArray(data.keyAbility)) {
        system.keyAbility = {
          value: data.keyAbility,
          selected: data.keyAbility.length === 1 ? data.keyAbility[0] : null,
        };
      }
      if (typeof data.hp === 'number') system.hp = data.hp;
      if (typeof data.perception === 'number') system.perception = data.perception;
      if (data.savingThrows) {
        system.savingThrows = pf2eRanks(data.savingThrows, ['fortitude', 'reflex', 'will']);
      }
      if (data.attacks) {
        system.attacks = {
          ...pf2eRanks(data.attacks, ['simple', 'martial', 'advanced', 'unarmed']),
          other: {
            name: data.attacks.other?.name ?? '',
            rank: typeof data.attacks.other?.rank === 'number' ? data.attacks.other.rank : 0,
          },
        };
      }
      if (data.defenses) {
        system.defenses = pf2eRanks(data.defenses, ['unarmored', 'light', 'medium', 'heavy']);
      }
      if (typeof data.spellcasting === 'number') system.spellcasting = data.spellcasting;
      if (Array.isArray(data.trainedSkills)) {
        system.trainedSkills = { value: data.trainedSkills, additional: 0 };
      }
      break;
    }
    case 'deity': {
      if (typeof data.category === 'string') system.category = data.category;
      if (data.sanctification) {
        system.sanctification = {
          modal: data.sanctification.modal ?? 'can',
          what: Array.isArray(data.sanctification.what) ? data.sanctification.what : [],
        };
      }
      if (data.domains) {
        system.domains = {
          primary: Array.isArray(data.domains.primary) ? data.domains.primary : [],
          alternate: Array.isArray(data.domains.alternate) ? data.domains.alternate : [],
        };
      }
      if (Array.isArray(data.font)) system.font = data.font;
      const attr = data.attribute ?? data.divineAbility;
      if (Array.isArray(attr)) system.attribute = attr;
      if (Array.isArray(data.skill)) system.skill = data.skill;
      if (Array.isArray(data.weapons)) system.weapons = data.weapons;
      break;
    }
    case 'feat': {
      if (typeof data.level === 'number') system.level = { value: data.level, taken: data.level };
      if (typeof data.category === 'string') system.category = data.category;
      if (typeof data.actionType === 'string') system.actionType = { value: data.actionType };
      if (data.actions === null || typeof data.actions === 'number') {
        system.actions = { value: data.actions };
      }
      if (Array.isArray(data.prerequisites)) {
        system.prerequisites = {
          value: data.prerequisites.map((p: any) => ({ value: String(p) })),
        };
      }
      if (typeof data.maxTakable === 'number') system.maxTakable = data.maxTakable;
      if (typeof data.onlyLevel1 === 'boolean') system.onlyLevel1 = data.onlyLevel1;
      // The character sheet only slots an ancestry/class/skill/general feat into
      // its class-defined level slot when system.location exactly matches
      // "<category>-<level>" (what the game's own feat picker writes via
      // FeatGroup#insertFeat). Without it, FeatGroup#assignFeat always falls
      // through to Bonus Feats regardless of category — every homebrew feat
      // landed there silently.
      if (SLOTTED_FEAT_CATEGORIES.has(system.category) && typeof system.level?.value === 'number') {
        system.location = `${system.category}-${system.level.value}`;
      }
      break;
    }
    case 'action': {
      if (typeof data.actionType === 'string') system.actionType = { value: data.actionType };
      if (data.actions === null || typeof data.actions === 'number') {
        system.actions = { value: data.actions };
      }
      if (data.category === null) {
        system.category = null;
      } else if (typeof data.category === 'string') {
        // Unlike feats, an ability's category is a closed set. An unknown value
        // is dropped silently by PF2e, so reject it here instead.
        if (!PF2E_ACTION_CATEGORIES.has(data.category)) {
          throw new Error(
            `Invalid action category "${data.category}". Valid values: ` +
              `${[...PF2E_ACTION_CATEGORIES].join(', ')}, or null for an uncategorised action.`
          );
        }
        system.category = data.category;
      }
      if (data.frequency) system.frequency = data.frequency;
      break;
    }
    case 'effect': {
      if (typeof data.level === 'number') system.level = { value: data.level };
      if (data.duration) {
        const unit = data.duration.unit ?? 'unlimited';
        if (!PF2E_EFFECT_DURATION_UNITS.has(unit)) {
          throw new Error(
            `Invalid effect duration unit "${unit}". Valid values: ` +
              `${[...PF2E_EFFECT_DURATION_UNITS].join(', ')}.`
          );
        }
        const unlimited = unit === 'unlimited' || unit === 'encounter';
        system.duration = {
          // -1 is PF2e's "no countdown" sentinel; a real value only makes
          // sense for the counted units.
          value: typeof data.duration.value === 'number' ? data.duration.value : unlimited ? -1 : 1,
          unit,
          expiry: unlimited ? null : (data.duration.expiry ?? 'turn-start'),
          sustained: !!data.duration.sustained,
        };
      }
      if (data.badge) system.badge = data.badge;
      if (typeof data.tokenIcon === 'boolean') system.tokenIcon = { show: data.tokenIcon };
      if (typeof data.unidentified === 'boolean') system.unidentified = data.unidentified;
      break;
    }
    case 'spell': {
      if (typeof data.level === 'number') system.level = { value: data.level };
      if (Array.isArray(data.traditions)) {
        const bad = data.traditions.filter((t: any) => !PF2E_SPELL_TRADITIONS.has(String(t)));
        if (bad.length > 0) {
          throw new Error(
            `Invalid spell tradition(s): ${bad.join(', ')}. Valid values: ` +
              `${[...PF2E_SPELL_TRADITIONS].join(', ')}.`
          );
        }
        // traditions live under system.traits, which finalizePf2eItemSource
        // rebuilds — stash them and let that merge them in.
        system.traits = { ...(system.traits ?? {}), traditions: data.traditions };
      }
      if (typeof data.time === 'string') system.time = { value: data.time };
      if (typeof data.range === 'string') system.range = { value: data.range };
      if (typeof data.target === 'string') system.target = { value: data.target };
      if (typeof data.cost === 'string') system.cost = { value: data.cost };
      if (typeof data.requirements === 'string') system.requirements = data.requirements;
      if (data.area !== undefined) system.area = data.area;
      if (data.defense !== undefined) system.defense = data.defense;
      if (data.duration) {
        system.duration = {
          value: typeof data.duration.value === 'string' ? data.duration.value : '',
          sustained: !!data.duration.sustained,
        };
      }
      if (typeof data.counteraction === 'boolean') system.counteraction = data.counteraction;
      break;
    }
  }
}

/**
 * Guarantee the PF2e Item common-template fields exist on `source.system`,
 * whatever path built it. This is the fix for the "heritage `reading 'value'`"
 * crash — `ItemPF2e._preCreate` reads `traits.value` and `rules` off raw
 * `_source` without guarding.
 */
function finalizePf2eItemSource(source: Record<string, any>, data: Record<string, any>): void {
  const type: string = source.type;
  const sys: Record<string, any> = source.system ?? (source.system = {});

  const desc = sys.description && typeof sys.description === 'object' ? sys.description : {};
  sys.description = {
    value: typeof data.description === 'string' ? data.description : (desc.value ?? ''),
    gm: typeof desc.gm === 'string' ? desc.gm : '',
  };

  const pub = sys.publication && typeof sys.publication === 'object' ? sys.publication : {};
  sys.publication = {
    title: typeof pub.title === 'string' ? pub.title : '',
    authors: typeof pub.authors === 'string' ? pub.authors : '',
    license: typeof pub.license === 'string' ? pub.license : 'OGL',
    remaster: typeof pub.remaster === 'boolean' ? pub.remaster : false,
  };

  if (!Array.isArray(sys.rules)) sys.rules = [];
  if (sys.slug === undefined) sys.slug = null;

  const t = sys.traits && typeof sys.traits === 'object' ? sys.traits : {};
  const traits: Record<string, any> = {
    otherTags: Array.isArray(t.otherTags) ? t.otherTags : [],
  };
  if (PF2E_TYPES_WITH_TRAIT_VALUE.has(type)) {
    const given = Array.isArray(data.traits) ? data.traits : Array.isArray(t.value) ? t.value : [];
    // system.traits.value is validated against a per-type trait vocabulary
    // (CONFIG.PF2E.creatureTraits / featTraits / classTraits / ...) and PF2e
    // silently drops anything not in that list during data prep — no error,
    // no warning. A homebrew setting's own tags (e.g. a custom ancestry trait)
    // would otherwise vanish without a trace. Split known-vs-unknown here so
    // unrecognized tags land in otherTags instead of being lost outright.
    const known = pf2eKnownTraitsFor(type);
    const accepted: string[] = [];
    const overflow: string[] = [];
    for (const tag of given) {
      if (typeof tag !== 'string' || !tag) continue;
      (known && tag in known ? accepted : overflow).push(tag);
    }
    traits.value = accepted;
    if (overflow.length) {
      const seen = new Set(traits.otherTags);
      for (const tag of overflow) {
        if (!seen.has(tag)) {
          traits.otherTags.push(tag);
          seen.add(tag);
        }
      }
    }
  } else if (Array.isArray(t.value)) {
    traits.value = t.value;
  }
  if (PF2E_TYPES_WITH_TRAIT_RARITY.has(type)) {
    traits.rarity = typeof data.rarity === 'string' ? data.rarity : (t.rarity ?? 'common');
  } else if (typeof t.rarity === 'string') {
    traits.rarity = t.rarity;
  }
  // A spell's magic traditions also live under system.traits. This object is
  // rebuilt from scratch above, so carry them across explicitly or they'd be
  // dropped the same way unknown trait tags used to be.
  if (type === 'spell') {
    const traditions = Array.isArray(data.traditions)
      ? data.traditions
      : Array.isArray(t.traditions)
        ? t.traditions
        : [];
    traits.traditions = traditions;
  }
  sys.traits = traits;

  sys._migration = { version: 0.959, previous: null };
}
