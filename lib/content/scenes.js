// ============================================================
// Authored scene library.
//
// One pool per biome. At room creation, each node draws a unique scene from
// its biome's pool — see lib/nodeState.js distributeScenes(). The pool must
// have at least as many entries as the biome has nodes (8 beach, 4 jungle,
// 1 cave) or distribution will throw.
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
//
// Authoring guideline: keep descriptions evocative but generic enough that
// the player can be standing anywhere within that "kind of place." The
// narrator weaves in the specifics.

const BEACH_SCENES = [
  {
    id: 'driftwood-flats',
    description: 'A wide stretch of pale sand strewn with sun-bleached driftwood and tangled fishing line.',
    food: { baseChance: 0.2, kinds: ['shellfish', 'crabs'] },
    freshWater: false,
    items: ['rusted tin', 'length of nylon rope'],
  },
  // TODO: 7 more beach scenes (one per beach node).
];

const JUNGLE_SCENES = [
  {
    id: 'fruit-canopy',
    description: 'Dense canopy filtered by gold light. Vines hang heavy with unfamiliar fruit.',
    food: { baseChance: 0.5, kinds: ['fruit', 'edible leaves'] },
    freshWater: false,
    items: ['flat stone, sharp on one edge'],
  },
  // TODO: 3 more jungle scenes.
];

const CAVE_SCENES = [
  {
    id: 'echoing-hollow',
    description: 'A cool, echoing hollow that smells faintly of old smoke. A trickle of water runs down one wall.',
    food: { baseChance: 0.05, kinds: ['cave crickets'] },
    freshWater: true,
    items: ['rusted lantern', 'charcoal stub'],
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
