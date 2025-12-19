// @ts-nocheck
import OpenAI from 'openai';

// Lazy initialization to avoid build-time errors
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Calculate tiles adjacent to explored tiles
function getAdjacentTiles(exploredTiles: string[], allLandTiles: string[], allWaterTiles: string[]): string[] {
  const explored = new Set(exploredTiles);
  const allTiles = new Set([...allLandTiles, ...allWaterTiles]);
  const adjacent = new Set<string>();

  exploredTiles.forEach(tile => {
    const [x, y] = tile.split(',').map(Number);
    
    // Check all 4 adjacent directions
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

// Create safe default outcomes if AI fails
function createFallbackOutcomes(players: any[]) {
  return {
    publicNarration: "The survivors carry out their tasks, facing the challenges of another day on the island.",
    outcomes: players.map(player => ({
      playerId: player.id,
      tilesRevealed: [],
      resourcesFound: { food: 0, water: 0 },
      itemsFound: [],
      factsLearned: [],
      hpChange: 0,
      privateNarration: `${player.name} completes their task, maintaining their current condition.`
    })),
    threadUpdates: []
  };
}

export async function POST(request: Request) {
  try {
    const { currentDay, players, mapData, groupInventory, storyThreads } = await request.json();

    // Calculate which tiles are adjacent to explored tiles (can be revealed)
    const adjacentTiles = getAdjacentTiles(
      mapData.exploredTiles,
      mapData.landTiles,
      mapData.waterTiles
    );

    // Build player summary for the prompt
    const playerDetails = players.map((p: any) => {
      const statsSummary = `STR:${p.stats.strength} INT:${p.stats.intelligence} CHA:${p.stats.charisma}`;
      return `- ${p.name} (${p.pronouns}, ${p.mbtiType}, ${statsSummary}, HP:${p.hp}/10)
  Action: "${p.action}"`;
    }).join('\n');

    // Create active threads text for the prompt
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

    // Build the AI prompt
    const systemPrompt = `You are resolving player actions in a survival game called Island Game. You receive multiple player actions simultaneously and must generate:
1. A cohesive public narration (200-300 words) that weaves all actions together
2. Individual outcomes for each player with private narration

KEY RESPONSIBILITIES:
- Focus on the 1-2 most dramatic/consequential events in public narration
- Mention other actions briefly to acknowledge everyone
- Use player stats (STR/INT/CHA) and MBTI to influence outcomes
- Each player gets private narration about their personal experience
- Maintain narrative consistency with story threads

STAT INFLUENCE:
- STR (Strength): Physical tasks (climbing, building, hunting, combat)
- INT (Intelligence): Mental tasks (navigation, problem-solving, tracking, planning)
- CHA (Charisma): Social tasks (leadership, morale, coordination, persuasion)
- Higher relevant stat = better outcomes, more resources, less risk

MBTI INFLUENCE:
- Use personality type to color HOW they do things, not mechanical outcomes
- E.g., INTJ strategizes methodically, ENFP maintains morale, ISTJ focuses on practical details

HP CHANGES:
- Most actions: 0 HP change
- Dangerous actions (climbing, fighting, risky exploration): -5 to -15 HP loss possible
- Resting/recovery: +5 HP gain possible
- Never exceed max HP (10)
- Higher relevant stats reduce risk of HP loss

RESOURCE DISTRIBUTION:
- Food: 0-3 units for successful foraging/hunting (STR/INT dependent)
- Water: 0-3 units for successful water finding (INT dependent)
- Be realistic - not everyone succeeds every time
- Better stats = higher chances and quantities

TILE REVELATION RULES (CRITICAL):
- Only reveal tiles that are in the adjacentTiles list provided
- Maximum 2 tiles per "explore" action
- Movement/exploration actions reveal tiles, other actions don't
- Return tile coordinates as strings (e.g., "1,2")

You must respond with valid JSON only.`;

    const userPrompt = `CURRENT DAY: ${currentDay}

PLAYERS AND THEIR ACTIONS:
${playerDetails}

MAP STATE:
- Explored tiles: ${mapData.exploredTiles.join(', ')}
- Adjacent explorable tiles: ${adjacentTiles.length > 0 ? adjacentTiles.join(', ') : 'none available'}
- Starting location: ${mapData.startingTile}

GROUP INVENTORY:
- Food: ${groupInventory.food} units
- Water: ${groupInventory.water} units
- Items: ${groupInventory.items.length > 0 ? groupInventory.items.join(', ') : 'none'}
- Facts: ${groupInventory.facts.length > 0 ? groupInventory.facts.length + ' discovered' : 'none'}
${threadsBlock}

Generate outcomes for all ${players.length} player(s). Respond with JSON in this exact format:
{
  "publicNarration": "200-300 word narrative weaving together the most significant actions",
  "outcomes": [
    {
      "playerId": "player id string",
      "tilesRevealed": ["x,y", "x,y"], // only from adjacentTiles list, max 2, only for explore actions
      "resourcesFound": { "food": 0-3, "water": 0-3 },
      "itemsFound": ["item name"], // rare, only for exceptional discoveries
      "factsLearned": ["fact text"], // new knowledge about the island
      "hpChange": -15 to +5, // most actions = 0, dangerous = negative, rest = positive
      "privateNarration": "50-100 word personal outcome for this player"
    }
  ],
  "threadUpdates": [
    {
      "thread_id": "existing_id or NEW",
      "title_if_new": "title if thread_id is NEW",
      "update_type": "introduce | escalate | complicate | resolve",
      "beat": "concrete story change based on player actions"
    }
  ]
}`;

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
          
          // Validate the response structure
          if (!parsedResponse.publicNarration || !parsedResponse.outcomes) {
            throw new Error('Invalid response structure from AI');
          }

          // Ensure all players have outcomes
          const playerIds = new Set(players.map((p: any) => p.id));
          const outcomeIds = new Set(parsedResponse.outcomes.map((o: any) => o.playerId));
          
          if (playerIds.size !== outcomeIds.size) {
            console.warn('AI did not provide outcomes for all players, using fallback');
            throw new Error('Incomplete outcomes from AI');
          }

          // Validate tile revelations are from adjacent list
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
            // Final attempt failed, use fallback
            console.error('All attempts failed, using fallback outcomes');
            return Response.json(createFallbackOutcomes(players));
          }
          
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
        
      } catch (apiError) {
        console.error(`Attempt ${attempt}: OpenAI API error:`, apiError);
        lastError = apiError;
        
        if (attempt === 3) {
          // Final attempt failed, use fallback
          console.error('All attempts failed, using fallback outcomes');
          return Response.json(createFallbackOutcomes(players));
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }

    // Should not reach here, but just in case
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
