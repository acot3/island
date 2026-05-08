// ============================================================
// Island map — topology
//
// 13 nodes: 4 beach corners, 4 beach sides, 4 jungles, 1 cave.
// Coordinates use a centered grid that the SVG viewBox mirrors.
//
//   bc_nw — bs_n — bc_ne
//    │  ╲    │    ╱  │
//    │   j_nw — j_ne │
//   bs_w │  ╲ │ ╱  │ bs_e
//    │   ┝—— cave ──┤
//    │   │  ╱ │ ╲  │   │
//    │   j_sw — j_se │
//    │  ╱    │    ╲  │
//   bc_sw — bs_s — bc_se
//
// Adjacency rules (per the design PDF):
//   beach corner: 2 adjacent beach sides + 1 jungle (the diagonal-inward one)
//   beach side:   2 adjacent beach corners + 2 jungles (the two on its side)
//   jungle:       2 other jungles (4-cycle) + cave + (3 beaches)
//   cave:         all 4 jungles
// ============================================================

const NODES = {
  bc_nw: { biome: 'beach',  position: 'corner', x: -3,   y: -3   },
  bc_ne: { biome: 'beach',  position: 'corner', x:  3,   y: -3   },
  bc_sw: { biome: 'beach',  position: 'corner', x: -3,   y:  3   },
  bc_se: { biome: 'beach',  position: 'corner', x:  3,   y:  3   },
  // Beach side nodes pushed outward to corner-radius (3√2 ≈ 4.24) so all
  // 8 beach nodes lie on the same circle — the island reads as round.
  bs_n:  { biome: 'beach',  position: 'side',   x:  0,    y: -4.24 },
  bs_e:  { biome: 'beach',  position: 'side',   x:  4.24, y:  0    },
  bs_s:  { biome: 'beach',  position: 'side',   x:  0,    y:  4.24 },
  bs_w:  { biome: 'beach',  position: 'side',   x: -4.24, y:  0    },
  j_nw:  { biome: 'jungle', position: 'inland', x: -1.5, y: -1.5 },
  j_ne:  { biome: 'jungle', position: 'inland', x:  1.5, y: -1.5 },
  j_sw:  { biome: 'jungle', position: 'inland', x: -1.5, y:  1.5 },
  j_se:  { biome: 'jungle', position: 'inland', x:  1.5, y:  1.5 },
  cave:  { biome: 'cave',   position: 'center', x:  0,   y:  0   },
};

const EDGES = [
  // beach perimeter
  ['bc_nw', 'bs_n'], ['bs_n', 'bc_ne'],
  ['bc_ne', 'bs_e'], ['bs_e', 'bc_se'],
  ['bc_se', 'bs_s'], ['bs_s', 'bc_sw'],
  ['bc_sw', 'bs_w'], ['bs_w', 'bc_nw'],
  // beach corner → diagonal-inward jungle
  ['bc_nw', 'j_nw'], ['bc_ne', 'j_ne'],
  ['bc_sw', 'j_sw'], ['bc_se', 'j_se'],
  // beach side → two adjacent jungles
  ['bs_n', 'j_nw'], ['bs_n', 'j_ne'],
  ['bs_e', 'j_ne'], ['bs_e', 'j_se'],
  ['bs_s', 'j_sw'], ['bs_s', 'j_se'],
  ['bs_w', 'j_nw'], ['bs_w', 'j_sw'],
  // jungle 4-cycle
  ['j_nw', 'j_ne'], ['j_ne', 'j_se'],
  ['j_se', 'j_sw'], ['j_sw', 'j_nw'],
  // jungles → cave
  ['j_nw', 'cave'], ['j_ne', 'cave'],
  ['j_sw', 'cave'], ['j_se', 'cave'],
];

const CORNERS = Object.entries(NODES)
  .filter(([, n]) => n.position === 'corner')
  .map(([id]) => id);

// Human-readable name for each node — used in narrator prompts, the phone
// confirm panel, and the move-action label. Distinguishes nodes within the
// same biome (j_nw vs j_ne both appear as "jungle" but are different places).
const LOCATION_LABELS = {
  bc_nw: 'northwest beach corner',
  bc_ne: 'northeast beach corner',
  bc_sw: 'southwest beach corner',
  bc_se: 'southeast beach corner',
  bs_n:  'north beach',
  bs_e:  'east beach',
  bs_s:  'south beach',
  bs_w:  'west beach',
  j_nw:  'northwest jungle',
  j_ne:  'northeast jungle',
  j_sw:  'southwest jungle',
  j_se:  'southeast jungle',
  cave:  'cave',
};

function nodeLabel(nodeId) {
  const label = LOCATION_LABELS[nodeId];
  return label ? `the ${label}` : nodeId;
}

function neighborsOf(nodeId) {
  const out = [];
  for (const [a, b] of EDGES) {
    if (a === nodeId) out.push(b);
    else if (b === nodeId) out.push(a);
  }
  return out;
}

// dx/dy in our coordinate system: +y points south.
// Returns one of: N NE E SE S SW W NW.
function directionFromDelta(dx, dy) {
  const angle = Math.atan2(dy, dx); // -π..π, 0 = east
  const idx = ((Math.round((angle + Math.PI / 2) / (Math.PI / 4)) % 8) + 8) % 8;
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][idx];
}

function neighborsWithMeta(nodeId) {
  const current = NODES[nodeId];
  if (!current) return [];
  return neighborsOf(nodeId).map((id) => {
    const n = NODES[id];
    const dx = n.x - current.x;
    const dy = n.y - current.y;
    return { nodeId: id, biome: n.biome, dx, dy, direction: directionFromDelta(dx, dy) };
  });
}

function getFullMap() {
  return {
    nodes: Object.entries(NODES).map(([id, n]) => ({ id, ...n })),
    edges: EDGES.map(([from, to]) => ({ from, to })),
  };
}

// Bounding box of visibleNodes ([{x, y}, ...]) → square viewBox [x, y, w, h]
// with `padding` units of breathing room and a `minSize` floor (so a single
// visible node doesn't render absurdly large).
function computeViewBox(visibleNodes, padding = 0.6, minSize = 3) {
  if (!visibleNodes || visibleNodes.length === 0) return [-1.5, -1.5, 3, 3];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of visibleNodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const dataSize = Math.max(maxX - minX, maxY - minY) + 2 * padding;
  const size = Math.max(dataSize, minSize);
  return [cx - size / 2, cy - size / 2, size, size];
}

// ============================================================
// Per-room visibility & payloads
//
// Everything above is static — facts about the island that don't depend on
// any particular game. Everything below takes a Room (or Room + player name)
// and returns data to send to clients. The fog-of-war rule lives here.
// ============================================================

// Once-seen-always-seen fog model:
//   visited = nodes any player has actually been on (monotonic).
//   seen    = visited ∪ (neighbors of every visited node, across all players).
// Both sets only grow. Every visited node permanently reveals its neighbors.
function computeFog(room) {
  const visited = new Set();
  for (const [, p] of room.players) {
    if (p.visited) for (const id of p.visited) visited.add(id);
  }
  const seen = new Set(visited);
  for (const id of visited) {
    for (const nb of neighborsOf(id)) seen.add(nb);
  }
  return { visited, seen };
}

function buildMapPayload(room) {
  const { visited, seen } = computeFog(room);

  const nodes = Object.entries(NODES)
    .filter(([id]) => seen.has(id))
    .map(([id, n]) => ({
      id, biome: n.biome, x: n.x, y: n.y,
      visited: visited.has(id),
    }));

  // Edges drawn iff both endpoints are seen AND at least one is visited.
  // Both `seen` and `visited` are monotonic, so once an edge appears it stays.
  const edges = EDGES
    .filter(([a, b]) => seen.has(a) && seen.has(b) && (visited.has(a) || visited.has(b)))
    .map(([a, b]) => ({
      from: a, to: b,
      kind: visited.has(a) && visited.has(b) ? 'visited' : 'partial',
    }));

  const players = Array.from(room.players.entries())
    .filter(([, p]) => p.nodeId && !p.dead)
    .map(([name, p]) => ({ name, color: p.color, nodeId: p.nodeId }));

  const viewBox = computeViewBox(nodes);
  const wreckageNodeId = findSceneNode(room, 'wreckage-site');
  return { nodes, edges, players, viewBox, wreckageNodeId };
}

function buildLocationPayload(room, name) {
  const player = room.players.get(name);
  if (!player || !player.nodeId) return null;
  const { visited } = computeFog(room);
  const node = NODES[player.nodeId];
  const neighbors = neighborsWithMeta(player.nodeId).map((nb) => ({
    ...nb,
    visited: visited.has(nb.nodeId),
    label: nodeLabel(nb.nodeId),
  }));
  return {
    nodeId: player.nodeId,
    biome: node.biome,
    color: player.color,
    hp: player.hp,
    inventory: player.inventory ? player.inventory.slice() : [],
    neighbors,
    wreckageNodeId: findSceneNode(room, 'wreckage-site'),
  };
}

// ============================================================
// Per-room scene state
//
// Two-layer model:
//   - lib/content/scenes.js  → immutable authored library, biome-keyed pools.
//   - room.nodeState[nodeId] → per-game mutation: which scene was dealt onto
//     this node, and what's been found.
//
// distributeScenes(room) is called once at room creation. After that, callers
// read live node info via getNodeView(room, nodeId), and mutate via the
// markItemFound helper — never by touching room.nodeState directly.
// ============================================================

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

// Group every node by biome, then fill each biome's slots from its pool,
// honoring per-scene minCount/maxCount. The result lives on the room as a
// flat { [nodeId]: state } map.
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

    // Validate min/max bounds against the number of nodes in this biome.
    let minSum = 0, maxSum = 0;
    for (const s of pool) {
      const min = s.minCount || 0;
      const max = s.maxCount ?? Infinity;
      if (min > max) {
        throw new Error(`Scene "${s.id}": minCount ${min} > maxCount ${max}.`);
      }
      minSum += min;
      maxSum += (max === Infinity ? nodeIds.length : max);
    }
    if (minSum > nodeIds.length) {
      throw new Error(
        `Biome "${biome}": minCounts sum to ${minSum} but only ${nodeIds.length} nodes exist.`
      );
    }
    if (maxSum < nodeIds.length) {
      throw new Error(
        `Biome "${biome}": maxCounts cap total placements at ${maxSum} but ${nodeIds.length} nodes need filling. Add an unlimited scene or raise a maxCount.`
      );
    }

    // Two-phase fill: first place every mandatory copy (minCount), then
    // top up the remaining slots by uniformly picking from scenes that
    // haven't hit their maxCount yet.
    const picks = [];
    const placed = new Map();
    const placedCount = (id) => placed.get(id) || 0;
    for (const s of pool) {
      const min = s.minCount || 0;
      for (let i = 0; i < min; i++) {
        picks.push(s);
        placed.set(s.id, placedCount(s.id) + 1);
      }
    }
    while (picks.length < nodeIds.length) {
      const candidates = pool.filter((s) => placedCount(s.id) < (s.maxCount ?? Infinity));
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      picks.push(pick);
      placed.set(pick.id, placedCount(pick.id) + 1);
    }

    // Shuffle so mandatory picks aren't biased toward the first nodes.
    const dealt = shuffled(picks);
    nodeIds.forEach((nodeId, i) => {
      state[nodeId] = {
        sceneId: dealt[i].id,
        foundItems: [],     // item names already taken from this node
      };
    });
  }
  room.nodeState = state;
}

// Combined live view of a node: static scene fields + dynamic state.
// Items reflect what's still findable.
function getNodeView(room, nodeId) {
  const ns = room.nodeState && room.nodeState[nodeId];
  if (!ns) return null;
  const scene = getSceneById(ns.sceneId);
  if (!scene) return null;
  const remainingItems = scene.items.filter((it) => !ns.foundItems.includes(it.name));
  return {
    nodeId,
    biome: NODES[nodeId].biome,
    sceneId: scene.id,
    description: scene.description,
    food: { kinds: scene.food.kinds, chance: scene.food.baseChance },
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

// Find the node currently hosting a given scene id. Returns the nodeId or
// null. Useful for "where did the wreckage land?" — the starting node.
function findSceneNode(room, sceneId) {
  if (!room.nodeState) return null;
  for (const [nodeId, ns] of Object.entries(room.nodeState)) {
    if (ns.sceneId === sceneId) return nodeId;
  }
  return null;
}

module.exports = {
  NODES, EDGES, CORNERS, LOCATION_LABELS,
  neighborsOf, neighborsWithMeta, directionFromDelta,
  nodeLabel,
  getFullMap, computeViewBox,
  computeFog, buildMapPayload, buildLocationPayload,
  distributeScenes, getNodeView, markItemFound, findSceneNode,
};
