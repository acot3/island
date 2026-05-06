// ============================================================
// Authored scene library.
//
// One pool per biome. At room creation, each node is dealt a scene from its
// biome's pool — see lib/nodeState.js distributeScenes(). minCount and
// maxCount per scene control how many copies may appear on a single map.
//
// A scene is immutable authored content shared by every game. Per-game
// mutation (items found, food depletion) lives on the room, keyed by node
// id, in room.nodeState.
// ============================================================

// Shape of a scene:
//   id            unique within its biome's pool; used as a stable handle
//   description   1–2 sentences. The narrator reads this; do not encode
//                 compass directions or cross-node references.
//   food: {
//     baseChance   probability per search attempt, 0..1
//     kinds        short list of edible things (e.g. ['berries', 'roots'])
//   }
//   freshWater    boolean
//   items         list of authored items findable here. Order is irrelevant;
//                 each is removed from the live pool once found.
//   minCount      optional. Minimum copies that must appear on the map.
//                 Defaults to 0 (optional). Use 1 to force a scene to appear.
//   maxCount      optional. Maximum copies allowed on the map.
//                 Defaults to Infinity (unlimited).
//
// Authoring guideline: keep descriptions evocative but generic enough that
// the player can be standing anywhere within that "kind of place." The
// narrator weaves in the specifics.

const BEACH_SCENES = [
  {
    id: 'wreckage-site',
    description: 'A wide stretch of pale sand strewn with sun-bleached driftwood. Inland, there is a jungle edge with trees and bushes.',
    food: { baseChance: 1.0, kinds: ['canned peaches', 'bag of potato chips', 'protein bars'] },
    freshWater: true,
    items: ['hatchet', 'length of nylon rope', 'journal of the captain'],
    minCount: 1,
    maxCount: 1,
  },
  {
    id: 'driftwood-flats',
    description: 'A wide stretch of pale sand strewn with sun-bleached driftwood. Inland, there is a jungle edge with trees and bushes.',
    food: { baseChance: 0.5, kinds: ['coconuts', 'berries', 'crabs'] },
    freshWater: false,
    items: [],
    minCount: 0,
    maxCount: Infinity,
  },
  {
    id: 'tidepools',
    description: 'Rocky tidepools teeming with life.',
    food: { baseChance: 0.8, kinds: ['shellfish', 'crabs', 'small fish'] },
    freshWater: false,
    items: ['iridescent shell'],
    minCount: 3,
    maxCount: 5,
  },
  
];

const JUNGLE_SCENES = [
  {
    id: 'basic-jungle',
    description: 'Thick jungle brush',
    food: { baseChance: 0.5, kinds: ['berries', 'edible leaves'] },
    freshWater: false,
    items: [],
    minCount: 1,
    maxCount: 1,
  },
  {
    id: 'fruit-canopy',
    description: 'Dense canopy filtered by gold light. Vines hang heavy with unfamiliar fruit.',
    food: { baseChance: 1.0, kinds: ['fruit', 'edible leaves'] },
    freshWater: false,
    items: [],
    minCount: 1,
    maxCount: 1,
  },
  {
    id: 'spring',
    description: 'A freshwater pool about twenty feet across with inscrutable depth',
    food: { baseChance: 0.2, kinds: ['fruit', 'edible leaves'] },
    freshWater: true,
    items: [],
    minCount: 1,
    maxCount: 1,
  },
  {
    id: 'camp',
    description: 'An abandoned camp. A number of decrepit boxes and tent parts. A fire pit.',
    food: { baseChance: 0.2, kinds: ['fruit', 'edible leaves'] },
    freshWater: false,
    items: ['skeleton key'],
    minCount: 1,
    maxCount: 1,
  },
];

const CAVE_SCENES = [
  {
    id: 'echoing-hollow',
    description: 'A cool, echoing hollow that smells faintly of old smoke. A trickle of water runs down one wall. A firepit with a remarkably well-preserved oak chest next to it, about the size of a shoebox.',
    food: { baseChance: 0.2, kinds: ['lichen'] },
    freshWater: false,
    items: [],
    minCount: 1,
    maxCount: 1,
  },
];

const SCENE_POOLS = {
  beach: BEACH_SCENES,
  jungle: JUNGLE_SCENES,
  cave: CAVE_SCENES,
};

// Flat lookup for resolving sceneId → scene regardless of biome.
const SCENES_BY_ID = {};
for (const pool of Object.values(SCENE_POOLS)) {
  for (const scene of pool) {
    if (SCENES_BY_ID[scene.id]) {
      throw new Error(`Duplicate scene id: ${scene.id}`);
    }
    SCENES_BY_ID[scene.id] = scene;
  }
}

function getSceneById(id) {
  return SCENES_BY_ID[id] || null;
}

function getPool(biome) {
  return SCENE_POOLS[biome] || [];
}

module.exports = { SCENE_POOLS, getSceneById, getPool };
