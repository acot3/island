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

function neighborsOf(nodeId) {
  const out = [];
  for (const [a, b] of EDGES) {
    if (a === nodeId) out.push(b);
    else if (b === nodeId) out.push(a);
  }
  return out;
}

function getFullMap() {
  return {
    nodes: Object.entries(NODES).map(([id, n]) => ({ id, ...n })),
    edges: EDGES.map(([from, to]) => ({ from, to })),
  };
}

module.exports = { NODES, EDGES, neighborsOf, getFullMap };
