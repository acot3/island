# Prompt Evaluation: Unified Narration System

## Overview
This file contains prompts for a survival RPG game ("D&D meets Jackbox") with two modes: **morning narration** and **action resolution**. The prompts are generally well-structured but have several areas for improvement.

---

## Strengths

**1. Rich World-Building**
The "Magic & Lore of the Island" section (lines 74-131) provides excellent thematic grounding with the three laws (Witness, Balance, Transformation) that create narrative hooks.

**2. Clear Mode Separation**
The dual-mode architecture (morning vs. resolution) with distinct responsibilities is clean.

**3. Structured Output Requirements**
Both prompts request specific JSON schemas, which helps with parsing reliability.

**4. Explicit Player ID Handling**
The resolution prompt emphasizes using exact player IDs (lines 451-458), which addresses a common AI hallucination issue.

---

## Issues & Recommendations

**1. System Prompt is Too Long (~1,800 words)**
The system prompt mixes world lore, game rules, narration rules, and health rules. This dilutes focus.

**Recommendation:** Split into modular sections or move lore to a reference document that gets conditionally included.

---

**2. Contradictory/Redundant Instructions**
Several rules appear multiple times:
- "Don't ever reveal the Magic & Lore of the Island explicitly" appears at lines 139 **and** 154
- Day 1 rules are mentioned in both Game Rules (line 138) and Narration Rules (line 153)

**Recommendation:** Deduplicate and consolidate rules.

---

**3. Ambiguous HP/Health Terminology**
The prompt uses both `health` and `hp` interchangeably:
- Line 163: "a new player health score"
- Line 179: "Calculate HP changes"
- Line 353: `p.hp || p.health`

The Player interface only has `health`, not `hp`. This inconsistency could confuse the model.

**Recommendation:** Standardize on one term throughout.

---

**4. Missing Guardrails for Resource Inflation**
The resolution prompt says resources found can be `0-5 food, 0-5 water` (line 428), but there's no guidance on when high values are appropriate. The model might generate generous resources too frequently.

**Recommendation:** Add context like "typical exploration yields 0-2 resources; 3+ only on exceptional success or specific discoveries."

---

**5. Temperature Setting May Be Too High**
Both API calls use `temperature: 0.8` (lines 266, 500). For structured JSON output with specific rules, this is high and can lead to:
- JSON formatting errors
- Rule violations
- Inconsistent tone

**Recommendation:** Lower to `0.5-0.6` for more reliable structured output, or use separate creative/structured generations.

---

**6. Weak Fallback Narrations**
The fallback narrations are generic:
- Line 315: `'The survivors face another day on the island...'`
- Line 543: `'The day unfolds with mixed results for the survivors...'`

These break immersion and don't handle the state appropriately.

**Recommendation:** Generate contextual fallbacks using player names and current day.

---

**7. Story Threads Lack Lifecycle Guidance**
The prompt mentions thread updates with types like "introduce | escalate | complicate | resolve" (line 236) but doesn't explain when each should be used or how many threads should be active.

**Recommendation:** Add guidance like: "Maintain 2-3 active threads. Resolve threads over 3-5 days. New threads should connect to player actions."

---

**8. Map Direction Logic is Duplicated**
The resolution prompt includes detailed coordinate logic (lines 434-442) that should probably be handled in code, not by the LLM. Asking the LLM to do coordinate math is unreliable.

**Recommendation:** Pre-calculate valid exploration tiles per direction in code and pass them categorized (e.g., `northernTiles: ["0,2", "0,3"]`) rather than asking the LLM to parse coordinates.

---

**9. No Examples Provided**
Neither prompt includes few-shot examples. For complex structured output, examples dramatically improve reliability.

**Recommendation:** Add 1-2 example outputs for each mode, showing proper JSON structure and tone.

---

**10. Stats System Mentioned but Underutilized**
Player stats (`STR`, `INT`, `CHA`) are passed to the resolution prompt (line 353) but there's no guidance on how they affect outcomes.

**Recommendation:** Add explicit rules like "STR 3+ gives advantage on physical tasks. INT 3+ helps puzzle/exploration. CHA 3+ affects NPC interactions."

---

## Summary Table

| Aspect | Rating | Notes |
|--------|--------|-------|
| Clarity | 3/5 | Redundant rules, mixed terminology |
| Structure | 4/5 | Good separation of concerns |
| Reliability | 2/5 | High temp + coordinate math in LLM = issues |
| Completeness | 3/5 | Missing examples, stat guidance |
| Maintainability | 2/5 | Monolithic, duplicated content |

---
