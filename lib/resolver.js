// ============================================================
// Resolver
//
// Pure deterministic resolution of a categorized action. Per DESIGN.md §6.2,
// this layer takes the categorizer's verdict + dice randomness and returns a
// structured outcome. No prompts, no API calls — just math and tables.
//
// First slice covers success/fail only:
//   - possible: false  → auto-fail, reason 'impossible' (no roll). The
//                        narrator will treat these differently from a rolled
//                        failure (the world rejected the action, it didn't
//                        just go badly).
//   - otherwise        → d20 + modifier vs DC; reason 'rolled'.
//
// Modifier is 0 for now — players don't have attribute scores yet. The
// modifier slot exists so adding stats later doesn't change the shape.
//
// Reward tables (food / water / items / injury) are deferred.
// ============================================================

const DC = { easy: 5, medium: 10, hard: 15 };

function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

function resolveAction(categorization) {
  if (!categorization.possible) {
    return { success: false, reason: 'impossible', roll: null };
  }
  const dc = DC[categorization.difficulty];
  const d20 = rollD20();
  const modifier = 0;
  const total = d20 + modifier;
  return {
    success: total >= dc,
    reason: 'rolled',
    roll: { d20, modifier, total, dc },
  };
}

module.exports = { resolveAction, DC };
