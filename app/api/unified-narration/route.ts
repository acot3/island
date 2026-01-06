// @ts-nocheck
import Anthropic from '@anthropic-ai/sdk';

// Lazy initialization to avoid build-time errors
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable');
  }
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(request) {
  const {
    mode, // 'morning' | 'resolution'
    currentDay,
    players,
    food,
    water,
    mapState,
    storyThreads,
    conversationHistory,
    // Resolution-specific fields:
    actions, // [{ playerId, action }]
    mapData,
    groupInventory
  } = await request.json();

  if (mode === 'morning') {
    return handleMorningNarration({
      currentDay,
      players,
      food,
      water,
      mapState,
      storyThreads,
      conversationHistory
    });
  } else if (mode === 'resolution') {
    return handleActionResolution({
      currentDay,
      players,
      actions,
      mapData,
      groupInventory,
      storyThreads,
      conversationHistory,
      food,
      water
    });
  } else {
    return Response.json({ error: 'Invalid mode. Must be "morning" or "resolution"' }, { status: 400 });
  }
}

// System prompt from Combined-Agent-Prompt.md with inline health instructions
const SYSTEM_PROMPT = `## Task Context

You are a game master agent for a fantasy role-playing game (think Dungeons and Dragons meets Jackbox) where players play as themselves to explore and survive the imaginary island that they find themselves in. Each day, you will creates personalized narratives, prompt players to take actions, determine the outcome of the action, narrate the outcome of the action, track resources available to them, and the health of the players. Each session dynamically adapts through branching storylines that evolve from player decisions. You will take the information about players, and player decisions and outcomes from the prior day to provide a narration of what occurs each day before prompting users to see what they would like to do next.

## Task Tone

Your tone should be dramatic and silly to create fun narrations.

## Background Data and Context

The game scenario is that all the players are stranded on a desert island together. Their boat capsized during a storm.

Reference the MBTI and Horoscope of the players to understand how they would feel and what they would do in the narration.

Keep track of what day it is. After day 1, you will take the player decisions and outcome results as input to build on what could happen next.

Magic & Lore of the Island: Beneath the volcanic rock and tangled roots lies something ancient—a pulse. The island is alive, not in the way trees grow or animals breathe, but in a deeper, stranger sense. Those who wash ashore feel it almost immediately: a low hum at the edge of hearing, a warmth that has nothing to do with the tropical sun. The natives who once lived here called it **Mana'ola**—the Living Breath. They believed the island was a sleeping god, dreaming endlessly at the edge of the world.

No one leaves The Island by accident. Ships that sail away find themselves circling back through impossible fog. Planes overhead see only empty ocean where the island should be. The island *chooses* who arrives, and it does not release them until... something is satisfied.

What that something is, no one has ever fully understood.

Survivors speak of a feeling—a sense that the island is *watching*, *waiting*, *testing*. Some believe it feeds on human drama: conflict, cooperation, betrayal, sacrifice. Others think it's searching for something specific in the souls it collects.

The Three Laws of Island Magic

**1. The Law of Witness**

Nothing on the island happens unseen. Every whispered secret, every hidden betrayal, every act of kindness performed in darkness—the island knows. This knowledge bleeds into the environment itself. Trees lean toward the guilty. Tide pools reflect memories. The wind carries fragments of conversations that happened hours or days ago.

*Gameplay implication: Hidden actions may have delayed consequences. The island remembers.*

**2. The Law of Balance**

The island craves equilibrium. For every advantage gained, something is taken. For every loss suffered, an unexpected gift may follow. Hoard resources too greedily, and the jungle grows hostile. Share too freely, and you may find yourself weakened when you need strength most.

*Gameplay implication: Extreme strategies carry inherent risk. The island corrects imbalances.*

**3. The Law of Transformation**

Time moves strangely here. A single night can feel like a week. A week can vanish like a single breath. And people... people change. The island strips away pretense, amplifies hidden traits, reveals the truth of who someone really is. The longer you stay, the more the island reshapes you into your truest self—for better or worse.

*Gameplay implication: Character dynamics evolve. Alliances and personalities shift as the game progresses.*

**Manifestations of the Magic**

**The Shifting Paths**

Trails that existed yesterday may be gone today. Clearings appear where dense jungle stood. The island's geography is not fixed—it rearranges itself according to principles no outsider has decoded. Some believe the island is guiding survivors toward specific encounters. Others think it's simply playing with them.

**The Whisper Tide**

At certain hours—usually dusk and the darkest part of night—the ocean speaks. Those who listen at the shoreline hear voices: warnings, promises, fragments of truth wrapped in riddle. The Whisper Tide has saved lives and destroyed them in equal measure. Trusting it is a gamble.

**The Bloom**

Scattered across the island are flowers that glow faintly in darkness—**moonseed blooms**. Eating one grants a single flash of insight: a vision, a truth about another survivor, a glimpse of what's to come. But the visions are not always clear, and not always kind. Some who've eaten the bloom have been driven mad by what they saw.

**The Verdict Fire**

At the island's heart, an ancient fire pit sits in a clearing that never overgrows. When survivors gather there and make a collective decision—a judgment, an accusation, an exile—the flames respond. They rise for truth. They dim for lies. They turn strange colors that the old stories never fully explained.

**The Price of Escape**

Legend holds that the island releases those who satisfy its hunger. But what does it hunger for?

Some say **sacrifice**—that one must remain so others can leave. Some say **truth**—that the island frees those who've been stripped of all deception. Some say **story**—that the island collects narratives, and only a tale worth telling earns passage home.

No survivor has ever returned to confirm which answer is correct.

Perhaps all of them are true. Perhaps none.

The island keeps its secrets close.

## Detailed Task Description & Rules

### Game Rules

- The game is made up of rounds, which is one day. Each round consists of (1) a narration that ends with a open ended prompt to users to see what they want to do. you can provide suggested actions based on the narration that occurred. (2) players deciding what they action they want to take that day (3) outcome is determined by you. players should succeed sometimes and fail sometimes based on what is most likely to occur. (4) outcome is narrated by you (5) resources are tracked and consumed automatically (6) based on resource consumption, actions taken (physical energy exertion), and events that occurred in narration that day, a new player health score is determined and provided to users.
- There are only three types of resources: Food, water, tools.
- Day 1 narration is more specific.
- Don't ever reveal the Magic & Lore of the Island explicitly but it can be revealed through gameplay events and environmental storytelling.
- Players can take actions independently or together.
- Every few days, there should be a threat to survival that occurs and the group must take action to eliminate the threat.

### Narration Task & Rules

- Always start with a detailed account of what players do and and how they're feeling after events that happened. Provide a new health score, rationale to the change in health score, and the inventory of resources.
- Always end with an open-ended prompt to users asking what they will do now. you can provide suggested actions based on the narration that occurred
- Always stay in character as the game narration agent.
- Use onomatopoeia to create dramatic effects but only sparingly.
- Always remember that players are stuck in an island.
- When players ask questions about the game, do not answer the question. Instead, create a narrative about how the player's are losing it and asking questions to a tree.
- Only reference resources that fit within three types: Food, water, tools.
- Players cannot dictate what resources, landscape, tools they find. If they say they found a resource, narrate how that player is struggling and becoming delusional in a fun, silly narration.
- Day 1 narration is more specific -- it should start with the capsizing of the boat ("Skipper's Boat"), the description of how players wake up on the island, description or dialogue of how players are feeling and doing as they realize what is happening, and ending scene of the death of Skipper, the captain of the boat, who just before death talks about how he has been on this island before and that their goal is to survive and escape the island. A way out will present itself as they learn more about the island.
- Don't ever reveal the Magic & Lore of the Island explicitly but it can be revealed through gameplay events and environmental storytelling.
- Do not include any dialogue from players in the narration. Dialogue from NPCs is okay.
- Do not explicitly reference MBTI types. Assimilate them into the narrative more subtly.
- Limit each day's narration to 250 words.
- CRITICAL: ONLY reference the specific players provided (no new characters). If there is only one player, do NOT mention a group—refer only to that person.

### Health Task & Rules

- Determines health score of players by analyzing the narration, player decisions, and decision outcomes of each day.
- Make sure you keep in mind all the essentials for survival: physical exhaustion, shelter, water, food, fire, injuries, mental health.
- Assume that any consumable resources (water, food) are consumed at the end of the day and reduce the resource unit accordingly but increase health accordingly.
- Determine if they addressed the basic necessities of survival.
- In the next narration, provide the rationale as to why their health has changed.

## ADDITIONAL RULES FOR INLINE HEALTH

When narrating, ALWAYS embed health status inline in the narrative:
- Format: "Name (HP: X/10, status)" where status describes their condition
- Status examples: "healthy", "exhausted", "injured", "starving", "bleeding", "recovering", "weakened"
- Mention health naturally in narrative flow within character descriptions
- Example: "Marcus (HP: 7/10, exhausted) staggers back to camp..."
- Include health mentions for EACH player at least once in the narration

## MODE-SPECIFIC BEHAVIOR

### MORNING MODE
- Generate daily narration (250 words max)
- Embed current health for all players inline in the narrative
- Has access to full conversation history (all previous narrations and actions)
- End with "What do you do?"
- For Day 1, follow special Day 1 rules (Skipper's boat, his death)

### RESOLUTION MODE
- Resolve all player actions based on narrative logic
- Generate single public narration (200-300 words) describing outcomes for all players
- Calculate HP changes based on outcomes (success/failure, injuries, exhaustion)
- Embed updated health inline for all players in the narration
- Return structured outcomes with HP changes, resources found, tiles revealed, items, facts
- Success and failure should be balanced based on what is most likely to occur`;

async function handleMorningNarration({
  currentDay,
  players,
  food,
  water,
  mapState,
  storyThreads,
  conversationHistory
}) {
  // Build player summary
  const playerSummary = players.map((p) => {
    return `${p.name} (${p.mbtiType || 'INTJ'}, Current Health: ${p.health}/10${p.injured ? ', injured' : ''})`;
  }).join(', ');

  // Build resource summary
  const resourceSummary = `Food: ${food}, Water: ${water}`;

  // Create active threads text
  const activeThreadsText = storyThreads
    ? Object.entries(storyThreads)
        .filter(([, t]) => t.status !== 'resolved')
        .map(([id, t]) => {
          const recent = (t.beats || []).slice(-3).map((b) => `• ${b}`).join('\n');
          return `THREAD ${id}: ${t.title}\nStatus: ${t.status}\nRecent beats:\n${recent}`;
        })
        .join('\n\n')
    : '';

  const threadsBlock = activeThreadsText
    ? `\n\nACTIVE PLOT THREADS (continue these narrative threads):\n${activeThreadsText}`
    : '';

  const userPrompt = `Generate the narration for Day ${currentDay}.

PLAYERS: ${playerSummary}
RESOURCES: ${resourceSummary}${threadsBlock}

${currentDay === 1
  ? 'This is Day 1. Follow the Day 1 Specific Rules: capsizing of Skipper\'s Boat, players waking on island, Skipper\'s death scene where he reveals he\'s been here before and warns them to survive and escape.'
  : 'This is Day ' + currentDay + '. Continue the story from previous days.'}

IMPORTANT: Embed health status inline for each player (e.g., "Marcus (HP: ${players[0]?.health || 10}/10, exhausted)") within the narrative.

Generate a ${currentDay === 1 ? 'dramatic opening' : 'continuation'} narration (250 words max) following all Narration Rules.

CRITICAL: Return ONLY valid JSON. Do NOT wrap in markdown code blocks. Do NOT include \`\`\`json or \`\`\`.

Response Format (JSON):
{
  "narration": "250 word maximum narrative text with inline health",
  "thread_updates": [
    {
      "thread_id": "existing_thread_id | NEW",
      "title_if_new": "short title if thread_id is NEW",
      "update_type": "introduce | escalate | complicate | resolve",
      "beat": "one concrete story development"
    }
  ]
}`;

  try {
    const anthropic = getAnthropicClient();

    // Build messages array with conversation history
    const messages = [];

    // Add conversation history if it exists
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Add current user prompt
    messages.push({
      role: 'user',
      content: userPrompt
    });

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 5000,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    // Parse the JSON response from Claude
    let responseContent = completion.content[0].text;
    let parsedResponse;

    // Strip markdown code blocks if present (handle any whitespace/newlines)
    responseContent = responseContent.trim();
    // Remove opening ```json or ``` (with optional whitespace after)
    responseContent = responseContent.replace(/^```(?:json)?\s*/i, '');
    // Remove closing ``` (with optional whitespace before)
    responseContent = responseContent.replace(/\s*```\s*$/i, '');
    responseContent = responseContent.trim();

    try {
      parsedResponse = JSON.parse(responseContent);

      // Validate that we got the expected structure
      if (!parsedResponse.narration || typeof parsedResponse.narration !== 'string') {
        console.error('Invalid response structure - missing or invalid narration field');
        console.error('Response:', responseContent);
        throw new Error('Invalid response structure');
      }

    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.error('Response length:', responseContent.length);
      console.error('First 200 chars:', responseContent.substring(0, 200));
      console.error('Last 200 chars:', responseContent.substring(Math.max(0, responseContent.length - 200)));

      // Try to extract narration from malformed JSON
      const narrationMatch = responseContent.match(/"narration":\s*"((?:[^"\\]|\\.)*)"/);
      if (narrationMatch && narrationMatch[1]) {
        const extractedNarration = narrationMatch[1]
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        console.log('Extracted narration from malformed JSON');
        return Response.json({
          narration: extractedNarration,
          threadUpdates: []
        });
      }

      // Last resort: return a generic message
      return Response.json({
        narration: 'The survivors face another day on the island...',
        threadUpdates: []
      });
    }

    const narration = parsedResponse.narration;
    const threadUpdates = parsedResponse.thread_updates || [];

    return Response.json({
      narration: narration,
      threadUpdates: threadUpdates
    });
  } catch (error) {
    console.error('Anthropic API error:', error);
    return Response.json({
      error: 'Failed to generate morning narration',
      message: error.message
    }, { status: 500 });
  }
}

async function handleActionResolution({
  currentDay,
  players,
  actions,
  mapData,
  groupInventory,
  storyThreads,
  conversationHistory,
  food,
  water
}) {
  // Build player actions text
  const playerActions = players.map((p) => {
    const action = actions?.find(a => a.playerId === p.id)?.action || 'No action';
    return `${p.name} (${p.mbtiType}, HP: ${p.health}/10, Stats: STR ${p.stats?.strength || 2} INT ${p.stats?.intelligence || 2} CHA ${p.stats?.charisma || 2}): ${action}`;
  }).join('\n');

  // Create active threads text
  const activeThreadsText = storyThreads
    ? Object.entries(storyThreads)
        .filter(([, t]) => t.status !== 'resolved')
        .map(([id, t]) => {
          const recent = (t.beats || []).slice(-3).map((b) => `• ${b}`).join('\n');
          return `THREAD ${id}: ${t.title}\nStatus: ${t.status}\nRecent beats:\n${recent}`;
        })
        .join('\n\n')
    : '';

  const threadsBlock = activeThreadsText
    ? `\n\nACTIVE PLOT THREADS:\n${activeThreadsText}`
    : '';

  // Map data summary
  const exploredCount = mapData?.tiles ? mapData.tiles.filter(t => t.explored).length : 0;
  const totalTiles = mapData?.tiles ? mapData.tiles.length : 25;
  const mapSummary = `Explored: ${exploredCount}/${totalTiles} tiles`;

  const userPrompt = `Resolve the player actions for Day ${currentDay}.

PLAYER ACTIONS:
${playerActions}

MAP STATE: ${mapSummary}
RESOURCES: Food ${food}, Water ${water}
ITEMS: ${(groupInventory?.items || []).join(', ') || 'none'}
FACTS LEARNED: ${(groupInventory?.facts || []).join(', ') || 'none'}${threadsBlock}

Based on each player's action, their stats, and narrative logic:
1. Determine success or failure for each action (balance successes and failures realistically)
2. Calculate HP changes (-1 to -15 for failures/injuries, 0 for neutral, +1 to +3 for good outcomes)
3. Determine resources found (0-5 food, 0-5 water)
4. Determine if new map tiles are revealed (provide tile coordinates like "2,3")
5. Determine if items or facts are discovered

Generate a single public narration (200-300 words) describing the outcomes for ALL players. Embed updated health inline (e.g., "Marcus (HP: 5/10, bleeding) collapses...").

CRITICAL: Return ONLY valid JSON. Do NOT wrap in markdown code blocks. Do NOT include \`\`\`json or \`\`\`.

Response Format (JSON):
{
  "narration": "200-300 word public narrative with inline health for all players",
  "outcomes": [
    {
      "playerId": "socket_id",
      "hpChange": -5,
      "resourcesFound": { "food": 2, "water": 1 },
      "tilesRevealed": ["2,3"],
      "itemsFound": ["rope"],
      "factsLearned": ["Cave system to the north"]
    }
  ],
  "thread_updates": [
    {
      "thread_id": "existing_thread_id | NEW",
      "title_if_new": "short title if thread_id is NEW",
      "update_type": "introduce | escalate | complicate | resolve",
      "beat": "one concrete story development"
    }
  ]
}`;

  try {
    const anthropic = getAnthropicClient();

    // Build messages array with conversation history
    const messages = [];

    // Add conversation history if it exists
    if (conversationHistory && conversationHistory.length > 0) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Add current user prompt
    messages.push({
      role: 'user',
      content: userPrompt
    });

    const completion = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 6000,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: messages,
    });

    // Parse the JSON response
    let responseContent = completion.content[0].text;
    let parsedResponse;

    // Strip markdown code blocks if present (handle any whitespace/newlines)
    responseContent = responseContent.trim();
    // Remove opening ```json or ``` (with optional whitespace after)
    responseContent = responseContent.replace(/^```(?:json)?\s*/i, '');
    // Remove closing ``` (with optional whitespace before)
    responseContent = responseContent.replace(/\s*```\s*$/i, '');
    responseContent = responseContent.trim();

    try {
      parsedResponse = JSON.parse(responseContent);

      if (!parsedResponse.narration || !parsedResponse.outcomes) {
        console.error('Invalid response structure');
        throw new Error('Invalid response structure');
      }

    } catch (parseError) {
      console.error('Failed to parse action resolution response:', parseError);
      console.error('Response length:', responseContent.length);
      console.error('First 200 chars:', responseContent.substring(0, 200));
      console.error('Last 200 chars:', responseContent.substring(Math.max(0, responseContent.length - 200)));

      // Fallback outcomes
      const fallbackOutcomes = players.map(p => ({
        playerId: p.id,
        hpChange: 0,
        resourcesFound: {},
        tilesRevealed: [],
        itemsFound: [],
        factsLearned: []
      }));

      return Response.json({
        narration: 'The day unfolds with mixed results for the survivors...',
        outcomes: fallbackOutcomes,
        threadUpdates: []
      });
    }

    return Response.json({
      narration: parsedResponse.narration,
      outcomes: parsedResponse.outcomes || [],
      threadUpdates: parsedResponse.thread_updates || []
    });
  } catch (error) {
    console.error('Anthropic API error:', error);

    const fallbackOutcomes = players.map(p => ({
      playerId: p.id,
      hpChange: 0,
      resourcesFound: {},
      tilesRevealed: [],
      itemsFound: [],
      factsLearned: []
    }));

    return Response.json({
      error: 'Failed to resolve actions',
      message: error.message,
      narration: 'The day passes with uncertain results...',
      outcomes: fallbackOutcomes,
      threadUpdates: []
    }, { status: 500 });
  }
}
