// REVISED resolve-actions API route with failure-aware prompt
// Replace your current /api/resolve-actions/route.ts with this

// @ts-nocheck
import OpenAI from 'openai';

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function getAdjacentTiles(exploredTiles: string[], allLandTiles: string[], allWaterTiles: string[]): string[] {
  const explored = new Set(exploredTiles);
  const allTiles = new Set([...allLandTiles, ...allWaterTiles]);
  const adjacent = new Set<string>();

  exploredTiles.forEach(tile => {
    const [x, y] = tile.split(',').map(Number);
    
    const neighbors = [
      `${x + 1},${y}`,
      `${x - 1},${y}`,
      `${x},${y + 1}`,
      `${x},${y - 1}`
    ];

    neighbors.forEach(neighbor => {
      if (allTiles.has(neighbor) && !explored.has(neighbor)) {
        adjacent.add(neighbor);
      }
    });
  });

  return Array.from(adjacent);
}

function createFallbackOutcomes(players: any[]) {
  return {
    publicNarration: "The survivors carry out their tasks, facing the challenges of another day on the island.",
    outcomes: players.map(player => ({
      playerId: player.id,
      tilesRevealed: [],
      resourcesFound: { food: 0, water: 0 },
      itemsFound: [],
      factsLearned: [],
      hpChange: -5, // Default small HP loss
      privateNarration: `${player.name} completes their task, though it takes its toll.`
    })),
    threadUpdates: []
  };
}

export async function POST(request: Request) {
  try {
    const { currentDay, players, mapData, groupInventory, storyThreads } = await request.json();

    const adjacentTiles = getAdjacentTiles(
      mapData.exploredTiles,
      mapData.landTiles,
      mapData.waterTiles
    );

    // Build detailed player info
    const playerDetails = players.map((p: any) => {
      const inventory = p.inventory && p.inventory.length > 0 ? p.inventory.join(', ') : 'none';
      return `- ${p.name} (${p.pronouns}, ${p.mbtiType}, STR:${p.stats.strength} INT:${p.stats.intelligence} CHA:${p.stats.charisma}, HP:${p.hp}/10)
  Action: "${p.action}"
  Current location: ${mapData.startingTile}
  Inventory: ${inventory}`;
    }).join('\n');

    const activeThreadsText = storyThreads
      ? Object.entries(storyThreads)
          .filter(([, t]: [string, any]) => t.status !== 'resolved')
          .map(([id, t]: [string, any]) => {
            const recent = (t.beats || []).slice(-3).map((b: string) => `  • ${b}`).join('\n');
            return `THREAD ${id}: ${t.title}\nStatus: ${t.status}\nRecent beats:\n${recent}`;
          })
          .join('\n\n')
      : '';

    const threadsBlock = activeThreadsText
      ? `\nACTIVE PLOT THREADS:\n${activeThreadsText}\n`
      : '';

    // THE NEW SYSTEM PROMPT WITH FAILURE
    const systemPrompt = `You are the narrative engine for Island Game, a survival game where actions have real consequences.

Your job is to resolve player actions with REALISTIC outcomes based on their stats, the difficulty of their actions, and the current game state. Some actions will fail. This is expected and important.

## CORE PRINCIPLE: STATS DETERMINE SUCCESS

Player stats range from 0-6. These are NOT cosmetic - they mechanically determine success rates.

## STAT SELECTION

For each action, determine which stat is MOST relevant:
- STR (Strength): Climbing, building, fighting, carrying, breaking, hunting physically
- INT (Intelligence): Navigating, tracking, identifying plants/dangers, solving problems, planning
- CHA (Charisma): Leading, persuading, coordinating group efforts, maintaining morale

## DIFFICULTY ASSESSMENT

Assign each action a difficulty level:

EASY (routine): Gathering from ground, walking, resting, basic camp tasks
MODERATE (requires skill): Climbing trees, building shelter, hunting small game, navigating jungle
HARD (dangerous): Climbing cliffs, hunting dangerous animals, crossing treacherous terrain
EXTREME (life-threatening): Fighting predators, scaling sheer rock, desperate situations

## SUCCESS/FAILURE RATES

EASY TASKS:
- Stat 0-1: 80% success | Stat 2-3: 95% success | Stat 4-6: Always succeed

MODERATE TASKS:
- Stat 0-1: 40% success | Stat 2-3: 70% success | Stat 4-5: 90% success | Stat 6: Always succeed

HARD TASKS:
- Stat 0-1: 15% success (usually fail) | Stat 2-3: 50% success | Stat 4-5: 75% success | Stat 6: 90% success

EXTREME TASKS:
- Stat 0-2: Auto-fail with severe consequences | Stat 3-4: 30% success | Stat 5-6: 60% success

## FAILURE TYPES

When actions fail, vary the severity:

MINOR FAILURE (40% of failures):
- No resources gained, -5 HP from exhaustion/minor injury
- Example: "You search for hours but find nothing edible."

MODERATE FAILURE (40% of failures):
- No resources gained, -10 HP from injury or exhaustion
- Example: "You slip while climbing, scraping your arms badly as you fall."

CRITICAL FAILURE (20% of failures):
- No resources gained, -15 HP from serious injury, becomes injured (cannot act next turn)
- Example: "The branch snaps. You crash through the canopy, landing hard with a sickening crack."

## SUCCESS TYPES

MARGINAL SUCCESS (low stat + easy task): 0-1 resources, 0 HP
SOLID SUCCESS (average stat): 1-2 resources, -5 HP typical
EXCELLENT SUCCESS (high stat): 2-3 resources, possible item/fact, 0 HP
CRITICAL SUCCESS (stat 6): Max resources, guaranteed item/fact, +5 HP

## HP CHANGE GUIDELINES

- Passive/easy actions: 0 HP
- Moderate actions: -5 HP typical (even on success - these are tiring)
- Strenuous actions: -10 HP even on success
- Dangerous actions: Success: -5 HP, Failure: -10 to -15 HP

Remember: Players lose -1 HP per day automatically. HP attrition is core survival pressure.

## RESOURCE AMOUNTS

Food sources:
- Foraging (easy): 0-2 food
- Hunting small game (moderate): 1-3 food
- Hunting large game (hard): 2-4 food
- Fishing (moderate): 1-3 food

Water sources:
- Finding stream/spring (moderate): 2-4 water
- Collecting dew/rainwater (easy): 0-2 water
- Coconuts (easy): 1 food + 1 water

## ITEMS AND FACTS

Items (0-1 per successful exploration):
- Thematically appropriate: rope, knife, flint, medicinal herbs, fishing net, spear
- Only on solid+ successes, more likely with high INT

Facts (0-1 per successful exploration):
- Concrete, actionable: "Cave system to the north", "Purple berries are poisonous"
- Only on solid+ successes, more likely with high INT

## TILE REVELATION

- Only reveal tiles adjacent to explored tiles (from adjacentTiles list)
- 1-2 tiles max per exploration action
- Staying at camp reveals nothing
- Failed exploration: 0-1 tiles (wandered but didn't progress)

## NARRATIVE TONE

Public narration (200-300 words): Present tense, immersive, focus on 1-2 dramatic events, mention all players, balance success/failure

Private narration (50-100 words per player): Second person, specific, include emotional/sensory details, make failures feel earned not arbitrary

## CRITICAL RULES

1. Failure is not punishment - it's natural
2. Be fair - high stats perform better
3. Be varied - not everyone succeeds/fails together
4. Be realistic - STR:1 cannot wrestle a boar
5. Be dramatic - make both successes and failures interesting

Output ONLY valid JSON in this format:
{
  "publicNarration": "string",
  "outcomes": [
    {
      "playerId": "string",
      "tilesRevealed": ["x,y"],
      "resourcesFound": {"food": 0-3, "water": 0-3},
      "itemsFound": ["string"],
      "factsLearned": ["string"],
      "hpChange": -15 to +5,
      "privateNarration": "string"
    }
  ],
  "threadUpdates": [...]
}`;

    // Build resource tile information
    let resourceInfo = '';
    if (mapData.resourceTiles) {
      const resources = [];
      const rt = mapData.resourceTiles;
      if (rt.herbs) resources.push(`herbs at ${rt.herbs}`);
      if (rt.deer) resources.push(`deer at ${rt.deer}`);
      if (rt.coconut) resources.push(`coconut at ${rt.coconut}`);
      if (rt.bottle) resources.push(`bottle at ${rt.bottle}`);
      if (rt.spring) resources.push(`fresh water spring at ${rt.spring} (unlimited)`);
      if (rt.clams && rt.clams.length > 0) {
        rt.clams.forEach((tile: string) => resources.push(`clams at ${tile}`));
      }
      if (resources.length > 0) {
        resourceInfo = `\n- Known resource locations: ${resources.join(', ')}`;
      }
    }

    const userPrompt = `CURRENT DAY: ${currentDay}

PLAYERS AND THEIR ACTIONS:
${playerDetails}

MAP STATE:
- Explored tiles: ${mapData.exploredTiles.join(', ')}
- Adjacent explorable tiles: ${adjacentTiles.length > 0 ? adjacentTiles.join(', ') : 'none available'}
- Starting location: ${mapData.startingTile}${resourceInfo}

GROUP INVENTORY:
- Food: ${groupInventory.food} units
- Water: ${groupInventory.water} units
- Items: ${groupInventory.items.length > 0 ? groupInventory.items.join(', ') : 'none'}
- Facts: ${groupInventory.facts.length > 0 ? groupInventory.facts.length + ' discovered' : 'none'}
${threadsBlock}

Resolve all ${players.length} actions. Remember:
- Some actions WILL fail based on difficulty and stats
- Apply realistic HP changes
- Only reveal tiles from the adjacent list
- Make stats mechanically matter
- If players visit known resource locations, they should find those resources (use the "Known resource locations" list)
- Reference the current food/water levels when appropriate (e.g., if food is 0, characters might be desperate; if adequate, they might be cautious about using it)`;

    // Make API call with retry logic
    const openai = getOpenAIClient();
    let lastError: any = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          response_format: { type: "json_object" },
          max_tokens: 1500,
          temperature: 0.7,
        });

        const responseContent = completion.choices[0].message.content;
        
        try {
          const parsedResponse = JSON.parse(responseContent);
          
          if (!parsedResponse.publicNarration || !parsedResponse.outcomes) {
            throw new Error('Invalid response structure from AI');
          }

          const playerIds = new Set(players.map((p: any) => p.id));
          const outcomeIds = new Set(parsedResponse.outcomes.map((o: any) => o.playerId));
          
          if (playerIds.size !== outcomeIds.size) {
            console.warn('AI did not provide outcomes for all players, using fallback');
            throw new Error('Incomplete outcomes from AI');
          }

          // Validate tile revelations
          const adjacentSet = new Set(adjacentTiles);
          parsedResponse.outcomes.forEach((outcome: any) => {
            outcome.tilesRevealed = (outcome.tilesRevealed || []).filter((tile: string) => 
              adjacentSet.has(tile)
            );
          });

          return Response.json(parsedResponse);
          
        } catch (parseError) {
          console.error(`Attempt ${attempt}: Failed to parse AI response:`, parseError);
          console.error('Raw response:', responseContent);
          lastError = parseError;
          
          if (attempt === 3) {
            console.error('All attempts failed, using fallback outcomes');
            return Response.json(createFallbackOutcomes(players));
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        
      } catch (apiError) {
        console.error(`Attempt ${attempt}: OpenAI API error:`, apiError);
        lastError = apiError;
        
        if (attempt === 3) {
          console.error('All attempts failed, using fallback outcomes');
          return Response.json(createFallbackOutcomes(players));
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    return Response.json(createFallbackOutcomes(players));

  } catch (error) {
    console.error('Error in resolve-actions endpoint:', error);
    return Response.json(
      { 
        error: 'Failed to resolve actions',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}