# Island — Design

## Core Principle

The LLM never decides what happened mechanically. It only describes what the code already determined.

## Turn Flow

### 1. Player Input
Free text. The player says what they want to do.

### 2. Classification (LLM)
The one place the LLM makes a mechanical decision. Parses free text into structured output via tool use:
- Action type (physical, gathering, hunting, exploring, resting, social, thinking)
- Difficulty (easy, moderate, hard, extreme)
- Target location (zone ID, if movement)
- Possible / trivial flags

### 3. Resolution (Code)
Dice roll against difficulty thresholds, modified by player stats. Code determines all mechanical consequences:
- Resource changes (food, water) based on action type + success + current zone
- Zone reveals for exploration
- HP changes (healing, injury)
- Whether an item was found (boolean), based on action type + success + zone

All state mutations except item identity happen here.

### 4. Narration (LLM)
Receives a read-only summary of everything above: what the player tried, whether it worked, what changed mechanically, active story threads. Writes 2-3 sentences of prose.

If resolution flagged `itemFound: true`, the narrator also proposes what the item is — a single short concrete noun ("rusted knife", "carved idol"). Code validates (no duplicates, no food/water) and commits it to inventory. The narrator invents the identity; code decides whether it's valid.

### 5. Story Evolution (LLM)
The Story Architect reads the narrator's finished prose and updates plot threads (`seed → rising → climax → resolved`). These updated threads feed into the *next* turn's narration.

The one-turn lag is intentional. The Architect needs finished prose to react to, and the delay creates a natural rhythm — the island responds to what just happened rather than anticipating it.

## Map

Zone graph, not a grid. Named locations with typed connections (Beach → Rocky Shore → Dense Jungle → etc.). LLMs reason about named places naturally; coordinate math is unreliable.

## Data Model

```
{
  day,
  players: [{ name, pronouns, stats, hp, injured, location, visited }],
  zones: { id → { name, description, connections[], resourceBias, danger } },
  group: { food, water, items },
  plotPoints: [{ id, name, stage, seed, beats[], nextBeatHint }],
  narrationHistory: []
}
```

The LLM sees a read-only view. Code owns all mutations.
