// ============================================================
// Per-room node state.
//
// Two-layer model:
//   - lib/content/scenes.js  → immutable authored library, biome-keyed pools.
//   - room.nodeState[nodeId] → per-game mutation: which scene was dealt onto
//     this node, and what's been found.
//
// distributeScenes(room) is called once at game start. After that, callers
// read live node info via getNodeView(room, nodeId), and mutate via the
// markItemFound helper — never by touching room.nodeState directly.
// ============================================================

const { NODES } = require('./map');
const { getPool, getSceneById } = require('./content/scenes');

// Fisher-Yates shuffle, returns a new array.
function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Walk every node, group by biome, deal one unique scene from the matching
// pool onto each. Throws if any pool is too small. The result lives on the
// room as a flat { [nodeId]: state } map.
function distributeScenes(room) {
  const byBiome = {};
  for (const [nodeId, n] of Object.entries(NODES)) {
    if (!byBiome[n.biome]) byBiome[n.biome] = [];
    byBiome[n.biome].push(nodeId);
  }
  const state = {};
  for (const [biome, nodeIds] of Object.entries(byBiome)) {
    const pool = getPool(biome);
    if (pool.length === 0) {
      throw new Error(`Scene pool for biome "${biome}" is empty.`);
    }
    // Prefer unique scenes; if the pool is smaller than the node count,
    // top up with extra random picks (duplicates allowed).
    const picks = shuffled(pool);
    while (picks.length < nodeIds.length) {
      picks.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    nodeIds.forEach((nodeId, i) => {
      state[nodeId] = {
        sceneId: picks[i].id,
        foundItems: [],     // item names already taken from this node
      };
    });
  }
  room.nodeState = state;
}

// Combined live view of a node: static scene fields + dynamic state.
// Items reflect what's still findable; foodChance reflects depletion.
function getNodeView(room, nodeId) {
  const ns = room.nodeState && room.nodeState[nodeId];
  if (!ns) return null;
  const scene = getSceneById(ns.sceneId);
  if (!scene) return null;
  const remainingItems = scene.items.filter((it) => !ns.foundItems.includes(it));
  return {
    nodeId,
    biome: NODES[nodeId].biome,
    sceneId: scene.id,
    description: scene.description,
    food: {
      kinds: scene.food.kinds,
      chance: scene.food.baseChance,
    },
    freshWater: scene.freshWater,
    items: remainingItems,
  };
}

// Mark an item as found. Idempotent — calling twice with the same item is a
// no-op rather than an error, since the resolver shouldn't have to track
// whether it's already done so.
function markItemFound(room, nodeId, itemName) {
  const ns = room.nodeState && room.nodeState[nodeId];
  if (!ns) return false;
  if (ns.foundItems.includes(itemName)) return false;
  ns.foundItems.push(itemName);
  return true;
}

module.exports = { distributeScenes, getNodeView, markItemFound };
