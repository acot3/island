// ============================================================
// Resolver
//
// Pure deterministic resolution of a categorized action. Per DESIGN.md §6.2,
// this layer takes the categorizer's verdict + dice/probability randomness
// and returns a structured outcome. No prompts, no API calls — just math.
//
// Two paths, decided by the categorizer's `seeking` list:
//
//   - non-search (seeking is empty): existing d20 path. d20 + modifier vs DC.
//   - search    (seeking is non-empty): scene-driven probability rolls. No
//                d20. For each scene category (food, item) we roll using the
//                base scene chance, debuffed to 75% if that category isn't
//                in `seeking`. Multiple finds in a single search are fine.
//
// Either path short-circuits to auto-fail when categorizer.possible is false.
//
// Water is intentionally not handled yet — bracketed for design rethink.
//
// The resolver is pure: callers pass scene info as data via `sceneContext`
// (no `room` import). Mutation of room.nodeState is the caller's problem.
// ============================================================

const DC = { easy: 5, medium: 10, hard: 15 };

// Cross-category debuff: when the player's seeking list doesn't include this
// category, the scene's base chance is multiplied by this. 1.0 if seeking
// the category explicitly, OFF_TARGET_MULT otherwise.
const OFF_TARGET_MULT = 0.75;

function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

function multiplierFor(category, seeking) {
  return seeking.includes(category) ? 1.0 : OFF_TARGET_MULT;
}

function resolveSearch(seeking, sceneContext) {
  const results = [];

  // Food: one roll for the category. On hit, pick a random kind from the
  // scene's food.kinds list.
  if (sceneContext && sceneContext.food && sceneContext.food.chance > 0) {
    const mult = multiplierFor('food', seeking);
    const chance = sceneContext.food.chance * mult;
    const hit = Math.random() < chance;
    const kinds = sceneContext.food.kinds || [];
    results.push({
      category: 'food',
      success: hit,
      found: hit && kinds.length ? kinds[Math.floor(Math.random() * kinds.length)] : null,
      chance,
    });
  }

  // Items: roll each remaining item independently. Multiple finds OK.
  const items = (sceneContext && sceneContext.items) || [];
  for (const it of items) {
    const mult = multiplierFor('item', seeking);
    const chance = it.chance * mult;
    const hit = Math.random() < chance;
    results.push({
      category: 'item',
      success: hit,
      found: hit ? it.name : null,
      chance,
    });
  }

  return { kind: 'search', results };
}

function resolveAction(categorization, sceneContext) {
  if (!categorization.possible) {
    return { kind: 'roll', success: false, reason: 'impossible', roll: null };
  }
  const seeking = categorization.seeking || [];
  if (seeking.length > 0) {
    return resolveSearch(seeking, sceneContext);
  }
  // Non-search: existing d20 path.
  const dc = DC[categorization.difficulty];
  const d20 = rollD20();
  const modifier = 0;
  const total = d20 + modifier;
  return {
    kind: 'roll',
    success: total >= dc,
    reason: 'rolled',
    roll: { d20, modifier, total, dc },
  };
}

module.exports = { resolveAction, DC, OFF_TARGET_MULT };
