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

function pickStartingCorner() {
  return CORNERS[Math.floor(Math.random() * CORNERS.length)];
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
    .filter(([, p]) => p.nodeId)
    .map(([name, p]) => ({ name, color: p.color, nodeId: p.nodeId }));

  const viewBox = computeViewBox(nodes);
  return { nodes, edges, players, viewBox };
}

function buildLocationPayload(room, name) {
  const player = room.players.get(name);
  if (!player || !player.nodeId) return null;
  const { visited } = computeFog(room);
  const node = NODES[player.nodeId];
  const neighbors = neighborsWithMeta(player.nodeId).map((nb) => ({
    ...nb,
    visited: visited.has(nb.nodeId),
  }));
  return {
    nodeId: player.nodeId,
    biome: node.biome,
    color: player.color,
    neighbors,
  };
}

module.exports = {
  NODES, EDGES, CORNERS,
  pickStartingCorner,
  neighborsOf, neighborsWithMeta, directionFromDelta,
  getFullMap, computeViewBox,
  computeFog, buildMapPayload, buildLocationPayload,
};
