// ============================================================
// Sandbox setup
//
// Wires up a sandbox-mode room: places Max the Gull on a beach side,
// annotates the node so the day narrator + categorizer know he's there,
// and points the room's startNodeId at that node so players spawn beside
// him.
//
// Sandbox rooms are otherwise identical to normal rooms — same sockets,
// same day flow, same campfire mechanics — so a character can be exercised
// in the real game loop without needing to find it first.
// ============================================================

const { NODES, annotateNode } = require('../lib/map');
const maxCharacter = require('./max-the-gull');

// Pick a beach SIDE node deterministically (north beach if available).
function pickSandboxStartNode() {
  // Beach side ids start with `bs_`. The north beach is `bs_n`.
  const sides = Object.entries(NODES)
    .filter(([id, n]) => n.biome === 'beach' && n.position === 'side')
    .map(([id]) => id);
  return sides.includes('bs_n') ? 'bs_n' : sides[0];
}

function setupSandbox(room) {
  const startNode = pickSandboxStartNode();
  room.startNodeId = startNode;
  room.characterState[maxCharacter.key] = {
    nodes: [startNode],
    history: [],
  };
  annotateNode(room, startNode, maxCharacter.presenceAnnotation);
}

// Endgame test setup — spawns players on the northwest jungle node, one
// move away from the cave, with a skeleton key already in inventory. Lets
// the chest + homecoming events be exercised in two real day turns without
// going through the wreck, the old camp, or the search loop.
function setupEndgameTest(room) {
  // j_nw is adjacent to the cave (see EDGES in lib/map.js). Any jungle
  // node would work; we pick one deterministically for predictable tests.
  room.startNodeId = 'j_nw';
  for (const [, p] of room.players) {
    p.inventory.push({ name: 'skeleton key', count: 1, type: 'item' });
  }
}

module.exports = {
  setupSandbox,
  setupEndgameTest,
  maxCharacter,
};
