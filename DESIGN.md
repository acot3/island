# Island — Architectural Design

A systems-level design for the Island game. Source of truth for *how the
pieces fit*; not a pitch document, not a full GDD. The PDF
`New Island 4_24_26.pdf` is the authoritative game-design seed for v0.5 —
this doc operationalizes it.

The goal of this document is to make the moving parts and their contracts
explicit so each subsystem can be built and reasoned about in isolation.
Where the design is unsettled, gaps are flagged in **Open Questions**
rather than papered over.

---

## 1. Provenance — what already exists

This is a v0.5 design, but it inherits heavily from prior prototypes:

- **v0.3** (`deprecated_versions/v0.3/`) — multiplayer skeleton:
  Socket.IO rooms with 4-letter join codes, host/phone split, lobby →
  morning → action → narration → campfire → next-day phase loop,
  parallel action submission with public/assist mechanic, HP/food
  bookkeeping, death + game-over, ElevenLabs single-voice TTS,
  reconnect handling. The day loop is driven by a **monolithic
  narrator** — one Claude call produces narration + per-player
  food/injury/death + freshWater flag.

- **v0.4** (current `events/`) — event harness:
  Tool-driven storyteller emits one beat at a time as an ordered list
  of `{voice, text}` segments. Multi-voice TTS (narrator + character),
  ElevenLabs voice IDs per character, scene-complete signal, in-event
  helper UIs (item picker, free-text reply). Two prototype events
  shipped: `king-krab` (offering judgment) and `sage` (open-ended
  conversation).

v0.5 keeps v0.3's room/phase skeleton, adopts v0.4's event harness as a
sub-protocol the day loop can hand off to, and **replaces** v0.3's
monolithic narrator with the PDF's split pipeline:
categorizer → deterministic resolver → narrator.

---

## 2. System map

Five processes / surfaces:

```
┌────────────────┐        ┌────────────────┐
│  Host screen   │◀──ws──▶│                │      ┌──────────────┐
│  (browser TV)  │        │  Node server   │─http▶│  Anthropic   │
└────────────────┘        │  (Express +    │      └──────────────┘
                          │   Socket.IO)   │      ┌──────────────┐
┌────────────────┐        │                │─http▶│  ElevenLabs  │
│  Player phone  │◀──ws──▶│  authoritative │      └──────────────┘
│  (1..N)        │        │  game state    │
└────────────────┘        └────────────────┘
```

- **Host screen** — read-only display of the unfolding story + map +
  group state. Plays narrator and character TTS audio. Owns the
  "advance" buttons during host-driven phase transitions.
- **Player phone** — 1..N. Each player joins a room with a code. The
  phone is the action-input surface and shows private state (own HP,
  food, inventory, private narration deltas).
- **Node server** — single source of truth for game state. All clients
  are dumb terminals — they render server state and emit intents. This
  was already true in v0.3 and we keep it.
- **Anthropic API** — three logical roles (categorizer, resolver,
  narrator) + per-event storyteller. All are tool-call style for
  structured output.
- **ElevenLabs API** — TTS, server-proxied. Per-voice IDs (narrator +
  characters).

---

## 3. Game state model

The room is the unit of state. Schematically:

```js
Room {
  code: 'ABCD',
  hostSocket: socketId | null,
  phase: 'lobby' | 'day-start' | 'action' | 'resolve' | 'narration'
       | 'event' | 'campfire' | 'ended' | 'game-over',
  loading: false,
  day: 1,

  // Map — generated once at start
  map: {
    nodes: { [nodeId]: Node },
    edges: [[nodeIdA, nodeIdB], ...],   // undirected, one-day travel
    startNodeId: 'b0',
  },

  // Group state
  party: {
    nodeId: 'b0',                       // party moves as one unit
    freshWater: false,                  // re-evaluated each day
    sharedFood: 0,                      // campfire pool
    inventory: [],                      // group items (key, etc.)
  },

  // Per-player
  players: { [name]: Player },

  // Narrative memory
  history: [{ day, morning, daySummary, eventLog }],

  // Active event, if any
  activeEvent: null | { id, state, ... },
}

Node {
  id: 'b0',
  biome: 'beach' | 'jungle' | 'cave',
  position: 'corner' | 'side' | 'inland' | 'center',
  feature: null | 'old-camp' | 'island-heart'
         | 'message-in-bottle' | 'king-krab' | 'pretty-panther',
  visited: false,
  // For features that fire once on entry, then are consumed:
  featureConsumed: false,
}

Player {
  socketId, pronouns, mbti,
  hp,                                   // 0..MAX
  food,                                 // private inventory of food units
  inventory: [],                        // private items
  attributes: { physical, mental, social },  // see §6
  chosenAction: null | string,
  isPublic: false,                      // assist mechanic
  suggestions: [],                      // morning-time hints
  // Per-day pending deltas applied by resolver, surfaced by narrator:
  pendingFood, pendingInjury, pendingItems, pendingDescription,
  campfireReady, shareFood,
  dead, deathDay,
}
```

Two important shifts from v0.3:

1. **Party-level location.** v0.3 had no map; the party was abstract.
   Per the PDF the *party* moves as a unit between nodes. Players do
   not split. (This is the simple read; see Open Questions if we ever
   want to allow splitting.)
2. **Group inventory vs. player inventory.** The key is a *group*
   object; foraged food and most items are per-player (consistent with
   v0.3's campfire-share design). Question for review: which bucket
   does the *island heart* live in? Probably group.

---

## 4. Lifecycle

Phases the room moves through, named the same way v0.3 names them where
possible:

```
lobby
  └─▶ (host: start) ─▶ map gen + day-start
day-start
  └─▶ morning narration; per-player suggestions; possible random event
       ├─▶ event ─▶ (event resolves) ─▶ action
       └─▶ action
action
  └─▶ players submit in parallel; public/assist as in v0.3
       ├─▶ if any player picked "Move to <node>" and entry triggers
       │   a feature event ─▶ event ─▶ resolve
       └─▶ resolve
resolve
  └─▶ categorizer + deterministic resolver run (per non-movement action)
       ─▶ structured action report
narration
  └─▶ narrator AI weaves report + history into the day's prose;
       host screen reads aloud; phones show private deltas
campfire
  └─▶ same mechanics as v0.3 (share food into group pool, optional take)
day-pass
  └─▶ apply food/water HP loss; check deaths;
       check win (key delivered to heart) / lose (last player dead)
       ─▶ next day-start, or ─▶ ended / game-over
```

**Events are an inline phase**, not a separate game mode. The day loop
yields control to the v0.4 event harness, which runs to completion (or
to a defined exit) and then control returns. Events can be triggered
from two places: (1) random-on-day-start, and (2) on entry to a node
with a feature. Both routes funnel through the same `enterEvent(eventId)`
server function.

---

## 5. Map

### 5.1 Topology

13 nodes per the PDF:

- 4 beach corner nodes
- 4 beach side nodes
- 4 jungle inland nodes
- 1 cave center node

Edge rules from the PDF:

- Each beach corner ↔ its 2 adjacent beach sides + 1 jungle node.
- Each beach side ↔ its 2 adjacent beach corners + 2 jungle nodes.
- Each jungle node ↔ 2 other jungle nodes + the cave.

This produces a fixed *topology*; what's randomized is which specific
node holds each feature, and which corner the party starts at.

### 5.2 Generation

`generateMap(rng)` returns a `Map` object. The function is
deterministic given a seed — useful for replay/debug. Algorithm:

1. Build the 13-node skeleton with the fixed edge set above.
2. Choose a random corner as `startNodeId`.
3. Place features:
   - `island-heart` → cave node (the only one).
   - `old-camp` → a jungle node *not* adjacent to the start.
   - `message-in-bottle` → a non-starting beach node.
   - `king-krab` → a different non-starting beach node.
   - `pretty-panther` → a jungle node (any).

### 5.3 Movement

Movement is one of two action types the player can submit (the other is
free-text). The phone surfaces only the nodes adjacent to the party's
current location. Submitting "Move to X" is **resolved before**
non-movement actions: if movement is unanimous (or the design says
majority — see Open Questions), the party moves; if entry triggers a
feature event, the day pivots into the event before non-movement actions
resolve.

> Note: movement is a *party* action, but each player still submits
> independently. A reconciliation step is needed when players disagree.
> See **Open Questions §10.1**.

---

## 6. Action pipeline

This replaces v0.3's single-call narrator. There are now three roles.

### 6.1 Categorizer (AI)

Per non-movement action, called once. Takes the player's free-text
intent + game context; returns structured judgment via tool call:

```
categorize_action(action, context) →
{
  possible: boolean,                   // is this physically possible here?
  attribute: 'physical'|'mental'|'social'|'none',
  difficulty: 'easy'|'medium'|'hard',
  rationale: string,                   // for debug + narrator context
}
```

Context passed in: current node biome + features, recent history
summary, the player's stats, the action.

If `possible: false`, the resolver short-circuits (no roll, narrator
told the action failed because it was incoherent with the world).

### 6.2 Deterministic resolver (no AI)

Pure function. Inputs: the categorizer's verdict, player stats, dice
RNG, current node, group state. Outputs the per-action **action
report** the narrator will dramatize:

```
ActionReport {
  player, action,
  possible, attribute, difficulty,     // forwarded
  roll: { d20, modifier, total, dc, success },
  food: { units, kind },               // 0 if none
  water: { found: boolean, kind },     // augments room.party.freshWater
  items: [{ name, kind }],             // foraged / discovered items
  injury: { hpLoss, kind },            // 0 or 1
}
```

DC tables, attribute modifiers, food/water/item drop tables, and injury
chances live in `rules/` as plain data + tiny pure functions. They are
the *only* place game balance is tunable without touching prompts.

The resolver does not know about narrative; the narrator does not know
about dice. Dividing them this way means we can rebalance survival
without re-prompting, and rewrite narration without changing balance.

### 6.3 Narrator (AI)

Receives a bundle: morning narration, prior day summary, all per-player
ActionReports, party state changes (water, location). Emits:

- `narration`: prose, read aloud to the host screen (TTS).
- `pendingDescription` per player: short private flavor for the phone
  ("You found 2 coconuts.").
- `deaths: []`: narrator-driven deaths (kept from v0.3, but now
  constrained — the resolver already says whether HP hit zero, so
  narrator deaths are reserved for *narrative* deaths the resolver
  can't anticipate, e.g. an event outcome).

The narrator must be told what *did* happen (per the action reports);
it does not invent outcomes. This is a significant change from v0.3,
where the narrator chose food units and injuries itself.

### 6.4 Storyteller (AI, in-event only)

The v0.4 event harness's storyteller. Distinct prompt, distinct
context window, scoped to the event. The day-loop narrator hands off to
the storyteller when an event begins and resumes after it ends; the
event is summarized into one paragraph and appended to `history` so the
day-loop narrator has continuity going forward.

---

## 7. Event runner

Carry over from v0.4 with two additions:

1. **Events run inside a phase, not in place of one.** When the room
   enters `phase: 'event'`, the host screen takes the storyteller's
   beats and the active player's phone takes the event's `engine` UI
   prompts. Other players' phones show a "Watching <player name>..."
   state — they can read along on the host screen but cannot act.
2. **Events declare their entry trigger** in their module:
   ```js
   export default {
     id: 'king-krab',
     trigger: { kind: 'feature', feature: 'king-krab' },
     // or: trigger: { kind: 'random-day-start', weight: 1 }
     ...
   }
   ```
   The server reads these at boot and registers them in two indexes
   (feature → event, random pool). Events with `kind: 'feature'` are
   **single-fire** — once consumed they don't fire again at that node.

Event outcomes feed back into the room: `engine.replaceItem`,
`engine.addItem`, `engine.removeItem`, plus new affordances we'll need:
`engine.setPartyItem(name)` (e.g. award the *key*),
`engine.applyHpDelta(playerName, n)`, `engine.summarizeEventForHistory(text)`.

The two existing events (`king-krab`, `sage`) are correct prototypes for
the *interaction shape* but need adapting to:
- Multi-player context (which player(s) is the event addressed to?
  Probably "the party", or "the player who entered"; see §10.2).
- Authoritative server-side state instead of `PLAYER` hardcoded in
  index.html.

---

## 8. Day-pass + win/lose

Same as PDF and v0.3, simplified by removing the day-12 cap:

```
on day-pass:
  if room.party.sharedFood < aliveCount: each alive player loses 1 hp
  else room.party.sharedFood -= aliveCount
  if !room.party.freshWater: each alive player loses 1 hp
  any player at 0 hp dies
  if all dead: lose
  if room.party.inventory.includes('key') and party.nodeId === heartNodeId
     and (some player action this day was "use key"): win
```

Win condition specifically requires **delivering** the key, not merely
holding it while standing on the heart. Otherwise the win can be
accidental. This is a small interpretation of the PDF — flag for
review.

---

## 9. Wire protocol (incremental from v0.3)

Most v0.3 events stay. Additions for v0.5:

| Event | From | Payload | Notes |
|---|---|---|---|
| `map-init` | server→all | `{ map, partyNode }` | Sent once after map gen |
| `move-vote` | phone→server | `{ targetNodeId }` | Replaces "Move" action |
| `party-moved` | server→all | `{ nodeId }` | After move resolution |
| `event-begin` | server→all | `{ eventId, primaryPlayer }` | Pause action UI for non-primary |
| `event-beat` | server→host | `{ segments }` | Same shape as v0.4 |
| `event-prompt` | server→phone | `{ kind, payload }` | Routes to primary player only |
| `event-end` | server→all | `{ summary, outcome }` | Resume day loop |

`submit-action`, `make-public`, `cancel-action`, `submit-campfire`,
`take-portion`, `eat-food`, all rejoin/reconnect events: keep verbatim
from v0.3.

---

## 10. Open questions

These are the calls I am not making unilaterally; each meaningfully
affects implementation.

1. **Movement reconciliation.** When players submit different "Move to
   X" votes, what wins? Options: (a) the party can't move that day if
   not unanimous; (b) majority wins, ties = no move; (c) movement is a
   single shared decision made before private actions, not a per-player
   choice. (c) is cleanest UX but requires a new pre-action sub-phase.
2. **Event addressee.** When the party enters a feature node and an
   event fires, who is the "primary player"? Options: (a) whoever
   triggered the move; (b) host picks; (c) random; (d) the whole party
   sees the same beats and any player can answer prompts (more chaotic
   but more multiplayer). (d) probably best for King-Krab-style; (a)
   probably best for Sage-style.
3. **Random-on-day-start event probability.** PDF says "possibility of
   event" at day-start. Concrete number? My recommendation: 25%, with
   weighting that decays for events recently fired.
4. **Item economy.** Are foraged items meaningfully distinct from food?
   The PDF lists "items found" as a distinct resolver output but never
   says what they're used for outside events. Recommendation: items
   exist primarily to be *offered* in events (King Krab) and to be
   *required* by features (the key). Food is a separate resource.
5. **Day cap.** v0.3 forced an ending at day 12. The PDF win/lose
   conditions don't require a cap. Recommendation: drop the cap; the
   game ends naturally when the party wins, dies, or stalls (and we
   can revisit if playtests show stalling).
6. **MBTI / pronouns.** v0.3 collected these and fed them to the
   narrator. Keep? Recommendation: keep, but feed to the narrator
   only, not the categorizer or resolver.
7. **Where does the heart fit mechanically?** The PDF says "heart"
   means the cave node and the magic door home, but doesn't specify
   whether the heart itself is interactable before the key arrives.
   Recommendation: entering the cave without the key triggers a
   read-only "the door is sealed" beat.
8. **Pretty Panther and Message in a Bottle.** Listed as features but
   not specified. Need event modules. Out of scope for this doc but
   flagged so the architecture leaves room.

---

## 11. Build order

A suggested sequence — each step leaves a runnable game:

1. **Port v0.3 skeleton into v0.5 codebase**, but with phases renamed
   per §4. No map yet, no categorizer, narrator unchanged. Verify
   multiplayer still works.
2. **Insert the action pipeline.** Add categorizer + deterministic
   resolver. Narrator now consumes structured action reports instead
   of free-text actions. No map yet — single abstract location.
3. **Add the map.** Generation, movement UI on phone, party-moved
   broadcasts, biome context fed to categorizer.
4. **Wire the event harness in.** Move `events/king-krab.js` and
   `events/sage.js` into the day loop on feature-entry. Validate the
   handoff (storyteller takes over → ends → narrator resumes).
5. **Random-on-day-start events.**
6. **Win/lose conditions** (key + heart + use-key action).
7. **Remaining feature events** (panther, message in a bottle, old camp).

---

## 12. Out of scope (for this doc)

- Visual design of the host screen and phone UI.
- Voice casting / specific ElevenLabs voice IDs beyond what v0.4
  already uses.
- Persistence across sessions (rooms are in-memory; v0.3 was the same).
- Spectator mode, dropping/rejoining mid-game beyond v0.3's rejoin.
- Analytics, telemetry.
