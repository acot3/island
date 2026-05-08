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

// Fisher-Yates shuffle, returns a new array.
function shuffled(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function resolveSearch(seeking, sceneContext, playerContext) {
  const results = [];
  let slotsLeft = playerContext && Number.isFinite(playerContext.inventoryRemaining)
    ? playerContext.inventoryRemaining
    : Infinity;
  const existingFood = new Set(
    (playerContext && playerContext.existingFoodNames) || []
  );

  // Food first. One roll. Food items stack by name in the player's inventory:
  // a kind that the player already carries doesn't consume a new slot. So we
  // allow the food roll if there's an empty slot OR at least one possible
  // kind would stack onto an existing slot.
  const foodKinds = (sceneContext && sceneContext.food && sceneContext.food.kinds) || [];
  const foodChance = (sceneContext && sceneContext.food && sceneContext.food.chance) || 0;
  const possibleKinds = foodKinds.filter((k) => slotsLeft > 0 || existingFood.has(k));
  if (foodChance > 0 && possibleKinds.length > 0) {
    const mult = multiplierFor('food', seeking);
    const chance = foodChance * mult;
    const hit = Math.random() < chance;
    let found = null;
    if (hit) {
      // When out of slots we can only land a stacking kind. Otherwise pick
      // uniformly among any landable kind.
      const stackable = possibleKinds.filter((k) => existingFood.has(k));
      const pool = (slotsLeft <= 0 && stackable.length > 0) ? stackable : possibleKinds;
      found = pool[Math.floor(Math.random() * pool.length)];
      if (!existingFood.has(found)) slotsLeft--;
    }
    results.push({ category: 'food', success: hit, found, chance });
  }

  // Items next. Random iteration so list-ordering doesn't privilege earlier
  // entries. Each hit consumes a slot; once slots are full we stop rolling —
  // remaining items aren't touched (no roll, no mark-found).
  const items = (sceneContext && sceneContext.items) || [];
  for (const it of shuffled(items)) {
    if (slotsLeft <= 0) break;
    const mult = multiplierFor('item', seeking);
    const chance = it.chance * mult;
    const hit = Math.random() < chance;
    if (hit) slotsLeft--;
    results.push({
      category: 'item',
      success: hit,
      found: hit ? it.name : null,
      chance,
    });
  }

  return { kind: 'search', results };
}

function resolveAction(categorization, sceneContext, playerContext) {
  if (!categorization.possible) {
    return { kind: 'roll', success: false, reason: 'impossible', roll: null };
  }
  const seeking = categorization.seeking || [];
  if (seeking.length > 0) {
    return resolveSearch(seeking, sceneContext, playerContext);
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
