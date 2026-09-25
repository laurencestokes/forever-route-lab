import { ShapeError } from './lua-value';

/**
 * Which dungeons.lua entries are dungeons or raids, for `dungeonQuest` (DATA_PROVENANCE §6.2).
 * Both lists are self-authored and together must cover every dungeons.lua key of either faction:
 * a key in neither list fails the extraction and `validate` until someone classifies it, and a
 * listed key that leaves dungeons.lua fails too (review finding data-F12). The names are the
 * dungeons.lua names at the pin, for review only.
 */

/** Dungeon and raid entries. Their alternative AreaIds count as the dungeon too. */
export const DUNGEON_KEYS: ReadonlyMap<number, string> = new Map<number, string>([
  [206, 'Utgarde Keep'], [209, 'Shadowfang Keep'], [491, 'Razorfen Kraul'], [717, 'The Stockade'],
  [718, 'Wailing Caverns'], [719, 'Blackfathom Deeps'], [721, 'Gnomeregan'], [722, 'Razorfen Downs'],
  [796, 'Scarlet Monastery'], [1176, "Zul'Farrak"], [1196, 'Utgarde Pinnacle'], [1337, 'Uldaman'],
  [1477, "The Temple of Atal'Hakkar"], [1581, 'The Deadmines'], [1583, 'Blackrock Spire'], [1584, 'Blackrock Depths'],
  [1977, "Zul'Gurub"], [2017, 'Stratholme'], [2057, 'Scholomance'], [2100, 'Maraudon'],
  [2159, "Onyxia's Lair"], [2366, 'The Black Morass'], [2367, 'Old Hillsbrad Foothills'], [2437, 'Ragefire Chasm'],
  [2557, 'Dire Maul'], [2677, 'Blackwing Lair'], [2717, 'Molten Core'], [3428, "Temple of Ahn'Qiraj"],
  [3429, "Ruins of Ahn'Qiraj"], [3456, 'Naxxramas'], [3457, 'Karazhan'], [3562, 'Hellfire Ramparts'],
  [3606, 'Hyjal Summit'], [3607, 'Serpentshire Cavern'], [3713, 'The Blood Furnace'], [3714, 'The Shattered Halls'],
  [3715, 'The Steamvault'], [3716, 'The Underbog'], [3717, 'The Slave Pens'], [3789, 'Shadow Labyrinth'],
  [3790, 'Auchenai Crypts'], [3791, 'Sethekk Halls'], [3792, 'Mana-Tombs'], [3805, "Zul'Aman"],
  [3836, "Magtheridon's Lair"], [3845, 'Tempest Keep'], [3847, 'The Botanica'], [3848, 'The Arcatraz'],
  [3849, 'The Mechanar'], [3923, "Gruul's Lair"], [3959, 'Black Temple'], [4075, 'Sunwell Plateau'],
  [4100, 'The Culling of Stratholme'], [4131, "Magisters' Terrace"], [4196, "Drak'Tharon Keep"], [4228, 'The Oculus'],
  [4264, 'Halls of Stone'], [4265, 'The Nexus'], [4272, 'Halls of Lightning'], [4273, 'Ulduar'],
  [4277, 'Azjol-Nerub'], [4415, 'The Violet Hold'], [4416, 'Gundrak'], [4493, 'The Obsidian Sanctum'],
  [4494, "Ahn'kahet: The Old Kingdom"], [4500, 'The Eye of Eternity'], [4603, 'Vault of Archavon'], [4722, 'Trial of the Crusader'],
  [4723, 'Trial of the Champion'], [4809, 'The Forge of Souls'], [4812, 'Icecrown Citadel'], [4813, 'Pit of Saron'],
  [4820, 'Halls of Reflection'], [4926, 'Blackrock Caverns'], [4945, 'Halls of Origination'], [4950, 'Grim Batol'],
  [4987, 'The Ruby Sanctum'], [5004, 'Throne of the Tides'], [5035, 'The Vortex Pinnacle'], [5088, 'The Stonecore'],
  [5094, 'Blackwing Descent'], [5334, 'The Bastion of Twilight'], [5396, "Lost City of the Tol'vir"], [5600, 'Baradin Hold'],
  [5638, 'Throne of the Four Winds'], [5723, 'Firelands'], [5788, 'Well of Eternity'], [5789, 'End Time'],
  [5844, 'Hour of Twilight'], [5892, 'Dragon Soul'], [5918, 'Shado-Pan Monastery'], [5956, 'Temple of the Jade Serpent'],
  [5963, 'Stormstout Brewery'], [5976, 'Gate of the Setting Sun'], [6052, 'Scarlet Halls'], [6066, 'Scholomance'],
  [6067, 'Terrace of Endless Spring'], [6125, "Mogu'shan Vaults"], [6182, "Mogu'shan Palace"], [6214, 'Siege of Niuzao Temple'],
  [6297, 'Heart of Fear'], [6622, 'Throne of Thunder'], [6738, 'Siege of Orgrimmar'], [10001, 'Stratholme'],
  [10022, 'Dire Maul'], [10023, 'Dire Maul'], [10024, 'Dire Maul'], [10025, 'Dire Maul'],
  [10026, 'Dire Maul'], [10027, 'Dire Maul'], [15475, 'Demon Fall Canyon'], [15531, 'The Tainted Scar'],
  [15828, 'The Burning of Andorhal'], [16074, 'Karazhan Crypts'], [16236, 'Scarlet Enclave'],
]);

/**
 * Entries that are not dungeons: the Deeprun Tram, the two PvP halls, the three battlegrounds,
 * and four later-expansion areas (a phased daily-quest zone, the Darkmoon Faire island and the two
 * brawler's guild arenas).
 */
export const NON_DUNGEON_KEYS: ReadonlyMap<number, string> = new Map<number, string>([
  [2257, 'Deeprun Tram'], [2597, 'Alterac Valley'], [2917, 'Hall of Legends'], [2918, "Champions' Hall"],
  [3277, 'Warsong Gulch'], [3358, 'Arathi Basin'], [5733, 'Molten Front'], [5861, 'Darkmoon Faire Island'],
  [6298, "Brawl'gar Arena"], [6618, "Bizmo's Brawlpub"],
]);

export interface DungeonKeyEntry {
  readonly areaId: number;
  readonly alternativeAreaIds: readonly number[];
}

/** Every classification problem for the dungeons.lua keys of both factions (empty when none). */
export function dungeonClassificationProblems(keys: ReadonlySet<number>): readonly string[] {
  const problems: string[] = [];
  for (const key of [...keys].sort((a, b) => a - b)) {
    if (!DUNGEON_KEYS.has(key) && !NON_DUNGEON_KEYS.has(key)) {
      problems.push(`dungeons.lua key ${String(key)} is in neither DUNGEON_KEYS nor NON_DUNGEON_KEYS (tools/questiedb/lib/dungeon-areas.ts): classify it`);
    }
  }
  for (const [list, name] of [[DUNGEON_KEYS, 'DUNGEON_KEYS'], [NON_DUNGEON_KEYS, 'NON_DUNGEON_KEYS']] as const) {
    for (const key of list.keys()) if (!keys.has(key)) problems.push(`${name} lists ${String(key)}, which is not a dungeons.lua key any more: review the list`);
  }
  return problems;
}

/**
 * The AreaIds a quest's positive zoneOrSort must name to be a dungeon quest: every dungeon key
 * and its alternative ids, over both factions' entries. Fails closed on any classification problem.
 */
export function dungeonQuestAreas(entries: Iterable<DungeonKeyEntry>): ReadonlySet<number> {
  const all = [...entries];
  const problems = dungeonClassificationProblems(new Set(all.map((entry) => entry.areaId)));
  if (problems.length > 0) throw new ShapeError('dungeonQuest', problems.join('; '));
  const areas = new Set<number>();
  for (const entry of all) {
    if (!DUNGEON_KEYS.has(entry.areaId)) continue;
    areas.add(entry.areaId);
    for (const id of entry.alternativeAreaIds) areas.add(id);
  }
  return areas;
}
