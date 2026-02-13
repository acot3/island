# Island Survival — Architecture & Flow

## File Overview

```
game.mjs              → Main game loop, state management, player input
action_classifier.mjs → AI classifies player input (type, difficulty, movement)
success_determiner.mjs→ Dice roll to decide success/failure
narrator.mjs          → AI narrates the outcome and determines consequences
map_generator.mjs     → Randomly builds the island map at startup
lore.txt              → Hidden island lore (fed to narrator AI)
rules.txt             → Narration style rules (fed to narrator AI)
```

## Game Loop (one turn = one day)

```mermaid
flowchart TD
    START([Game Start]) --> GEN_MAP[Generate random island map]
    GEN_MAP --> INTRO[AI narrates intro scene]
    INTRO --> PRINT[Print game state: HP, location, food, water, items]
    PRINT --> INPUT[/Player types an action/]

    INPUT --> CLASSIFY[AI classifies the action]
    CLASSIFY --> IS_MOVE{Is it movement\nto another zone?}

    IS_MOVE -- Yes --> CALC_DIST[Calculate link distance\n1-link = easy, 2-link = moderate]
    CALC_DIST --> ROLL
    IS_MOVE -- No --> POSSIBLE{Is it possible?}

    POSSIBLE -- No --> AUTO_FAIL[Auto FAILURE]
    AUTO_FAIL --> NARRATE
    POSSIBLE -- Yes --> TRIVIAL{Is it trivial?}

    TRIVIAL -- Yes --> AUTO_SUCCESS[Auto SUCCESS]
    AUTO_SUCCESS --> NARRATE
    TRIVIAL -- No --> ROLL[Roll dice vs difficulty threshold]

    ROLL --> MOVE_CHECK{Was it a\nmovement action?}
    MOVE_CHECK -- Yes, Success --> MOVE_PLAYER[Update player location]
    MOVE_CHECK -- Yes, Failed --> STAY[Player stays, note failed destination]
    MOVE_CHECK -- No --> NARRATE

    MOVE_PLAYER --> NARRATE
    STAY --> NARRATE

    NARRATE[AI narrates outcome\n+ determines consequences]

    NARRATE --> APPLY[Apply consequences to state]

    APPLY --> DAY_COST[Day-pass costs:\n-1 food, -1 water per player]
    DAY_COST --> STARVING{Missing food\nor water?}
    STARVING -- Yes --> HP_LOSS[-10 HP per missing resource]
    STARVING -- No --> NEXT
    HP_LOSS --> DEAD{Any player\nHP ≤ 0?}
    DEAD -- Yes --> GAME_OVER([Game Over])
    DEAD -- No --> NEXT[day++]
    NEXT --> PRINT
```

## Action Classification (action_classifier.mjs)

```mermaid
flowchart LR
    INPUT[Player input text] --> AI{Claude AI\nclassifies action}
    HISTORY[Story so far] --> AI
    LOCATION[Current zone +\nconnected zones] --> AI

    AI --> |possible: false| IMPOSSIBLE[Impossible action]
    AI --> |trivial: true| TRIVIAL[Auto-success]
    AI --> |type + difficulty| CLASSIFIED[physical / gathering /\nhunting / thinking /\nsocial / exploring / resting]
    AI --> |moveTo: zone_id| MOVEMENT[Movement to zone]
```

## Success Roll (success_determiner.mjs)

```mermaid
flowchart LR
    DIFF[Difficulty] --> THRESHOLD{Threshold}
    THRESHOLD --> |easy| E[80% success]
    THRESHOLD --> |moderate| M[60% success]
    THRESHOLD --> |hard| H[35% success]
    THRESHOLD --> |extreme| X[15% success]
    THRESHOLD --> ROLL[Random 0-100]
    ROLL --> |roll < threshold| WIN[SUCCESS]
    ROLL --> |roll ≥ threshold| LOSE[FAILURE]
```

## Narration & Consequences (narrator.mjs)

```mermaid
flowchart TD
    INPUTS[Action + Classification +\nSuccess/Failure + History +\nLocation + Lore + Rules] --> AI{Claude AI\nnarrates outcome}

    AI --> NARRATION[1 vivid sentence]
    AI --> HEALED{healed?}
    AI --> FOOD{foundFood?}
    AI --> WATER{foundWater?}
    AI --> ITEMS{itemsGained?}
    AI --> INJURED{injured?}

    HEALED -- true --> HP_UP[+10 to 15 HP]
    FOOD -- true --> FOOD_UP[+3 to 5 food]
    WATER -- true --> WATER_UP[+3 to 5 water]
    ITEMS -- true --> ADD_ITEMS[Add items to inventory]
    INJURED -- true --> MARK[Mark player as injured]
```

## Island Map Structure (map_generator.mjs)

```mermaid
flowchart TD
    BEACH["🏖 Beach\n(start)"]

    BEACH --- C1["🌊 Coastal Zone 1\n(random pick)"]
    BEACH --- C2["🌊 Coastal Zone 2\n(random pick)"]

    C1 --- J1["🌴 Jungle Zone 1\n(random pick)"]
    C1 --- J2
    C2 --- J2["🌴 Jungle Zone 2\n(random pick)"]

    J1 --- I1["🏔 Interior Zone 1\n(random pick)"]
    J2 --- I2["🏔 Interior Zone 2\n(random pick)"]

    I1 --- I2
    I1 --- HEART["🔥 The Heart\n(endgame?)"]
    I2 --- HEART

    style BEACH fill:#f9e79f
    style HEART fill:#e74c3c,color:#fff
```

**Zone pools (2 picked randomly from each):**
- Coastal: Tidepools, Rocky Shore, Sheltered Cove
- Jungle: Dense Jungle, Jungle Clearing, River Basin, Waterfall
- Interior: Cliffs, Plateau, Cave System, Ancient Ruins, Volcanic Ridge

## Data Flow Summary

```
Player Input
    │
    ▼
┌──────────────────────┐
│  action_classifier    │ ← story history + location context
│  (Claude AI)          │
│                       │
│  Returns: type,       │
│  difficulty, moveTo,  │
│  possible, trivial    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  success_determiner   │
│  (dice roll)          │
│                       │
│  Returns: success,    │
│  roll, threshold      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  narrator             │ ← story history + location + lore + rules
│  (Claude AI)          │
│                       │
│  Returns: narration,  │
│  healed, foundFood,   │
│  foundWater, items,   │
│  injured              │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  game.mjs             │
│  (state update)       │
│                       │
│  Apply consequences,  │
│  deduct food/water,   │
│  check death,         │
│  advance day          │
└──────────────────────┘
```
