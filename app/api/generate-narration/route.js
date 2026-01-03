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

export async function POST(request) {
  const { currentDay, players, food, water, mapState, storyThreads } = await request.json();
  
  // Build a simple prompt with game state
  const playerSummary = players.map((p) => {
    const healthStatus = p.health <= 3 ? 'in critical condition' : p.health <= 6 ? 'weakened and struggling' : 'holding steady';
    const mbtiInfo = p.mbtiType ? ` (${p.mbtiType})` : '';
    return `${p.name}${mbtiInfo} is ${healthStatus}`;
  }).join(', ');
  
  // Detailed resource status
  let resourceStatus = '';
  if (food === 0 && water === 0) {
    resourceStatus = 'The group has NO food and NO water remaining - they are in desperate need of supplies';
  } else if (food === 0) {
    resourceStatus = `The group has NO food left (but ${water} water). Hunger is becoming critical`;
  } else if (water === 0) {
    resourceStatus = `The group has NO water left (but ${food} food). Dehydration is a serious threat`;
  } else if (food <= 2 && water <= 2) {
    resourceStatus = `Supplies are running dangerously low (${food} food, ${water} water)`;
  } else if (food <= 5 && water <= 5) {
    resourceStatus = `The group has modest supplies (${food} food, ${water} water) but should gather more`;
  } else {
    resourceStatus = `The group has adequate supplies for now (${food} food, ${water} water)`;
  }

  // Detailed exploration and map info
  let explorationInfo = '';
  if (mapState) {
    const explorationPercent = Math.round((mapState.exploredTiles / mapState.totalTiles) * 100);
    explorationInfo = `\n- Map exploration: ${explorationPercent}% of the island explored (${mapState.exploredTiles}/${mapState.totalTiles} areas)`;

    if (mapState.nearbyUnexplored) {
      explorationInfo += '\n- There are unexplored areas nearby that could be investigated';
    } else {
      explorationInfo += '\n- The immediate surroundings have been fully explored';
    }

    // Revealed resources
    if (mapState.revealedResources && mapState.revealedResources.length > 0) {
      const availableResources = mapState.revealedResources.filter(r => !r.collected);
      const depletedResources = mapState.revealedResources.filter(r => r.collected);

      if (availableResources.length > 0) {
        const resourceList = availableResources.map(r => {
          if (r.type === 'spring') return 'fresh water spring (unlimited)';
          return r.type;
        }).join(', ');
        explorationInfo += `\n- Available resources discovered: ${resourceList}`;
      }

      if (depletedResources.length > 0) {
        const depletedList = depletedResources.map(r => r.type).join(', ');
        explorationInfo += `\n- Depleted/gathered resources: ${depletedList}`;
      }
    }
  }
  
  // Create active threads text for the prompt
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
    ? `\nACTIVE PLOT THREADS (use these; continue from the most recent beats):\n${activeThreadsText}\n`
    : '';
  
  const prompt = `You are narrating a survival game. Generate a very brief OPENING NARRATION for the beginning of Day ${currentDay}.

IMPORTANT CONTEXT: This narration happens at the START of the day, BEFORE players take actions. Set the scene and mood for what they're about to do.

Current Situation:
- ${playerSummary}
- ${resourceStatus}${explorationInfo}
${threadsBlock}

CRITICAL: The ONLY characters in this story are: ${players.map(p => p.name).join(', ')} (total ${players.length}). Do NOT reference any other characters. If there is only one player, do NOT mention a group—refer only to that person.

The narration should:
- Be written in present tense
- Be immersive and atmospheric
- DIRECTLY RESPOND to the current resource situation (if food/water is zero, convey urgency and desperation; if supplies are low, show concern; if adequate, show relative calm)
- REFERENCE discovered resources when relevant (e.g., if a spring was found, characters might discuss returning to it; if resources are depleted, mention the empty locations)
- REFLECT the exploration progress (characters should notice and discuss newly explored areas or feel confined if they haven't explored much)
- Convey the mood and challenges facing the survivors based on their ACTUAL circumstances
- ONLY reference the specific characters listed above - never invent or mention other characters, names, or roles. If there is only one player, do NOT mention a group—refer only to that person.
- Use each character's MBTI type to personalize their behavior, reactions, and interactions in the narrative (e.g., INTJs might strategize about resource management, ENFPs might maintain morale despite scarcity, ISTJs might inventory supplies)
- Focus on the experience through narrative description (NOT game mechanics)
- Avoid mentioning: health numbers, tiles, maps, grid coordinates, or any explicit game systems
- Translate game state into narrative: "food: 0" becomes "empty stomachs", "spring found" becomes "the fresh water source they discovered", etc.
- Set the scene for what they're about to decide to do today
- Be very brief (150-200 words maximum)
- DO NOT describe actions they take - just set the morning scene and their current state/concerns

${currentDay === 1 ? 'This is the first day after the shipwreck. The survivors are just waking up on the beach.' : 'This is the morning of a new day. Describe how they wake up, their immediate concerns based on resources/health, and what challenges face them today.'}

IMPORTANT: You must respond with valid JSON containing:
{
  "narration": "brief narrative text (200 words maximum)",
  "thread_updates": [
    {
      "thread_id": "thread_1 | NEW",
      "title_if_new": "short title if thread_id is NEW",
      "update_type": "introduce | escalate | complicate | resolve",
      "beat": "one concrete, irreversible story change that alters what will be true tomorrow (no mechanics; not internal feelings alone)"
    }
  ]
}

Rules:
- Each day, output 1–2 thread_updates.
- At least 1 update must be a concrete new beat (not vague mood).
- If there are ACTIVE PLOT THREADS, you must update one of them (use most recent beats).
- If none exist, create one NEW thread.

Beat quality requirements:
- A beat must introduce a NEW fact, decision, consequence, or observation that changes the situation.
- Internal emotions alone are NOT sufficient (e.g., "feels torn", "anxious", "doubt lingers").
- The beat must create narrative consequences that future days must acknowledge.
- If a thread has not materially changed for 2 days, the next update MUST externalize it (someone notices, an action is taken, or a consequence occurs).

Do NOT include mechanics, numbers, or systems.`;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are the narrator for Island Game, a survival story. Your narration is very brief (200 words maximum), immersive, and atmospheric, written in present tense. You MUST directly respond to the game state: if food/water is zero, show desperation; if low, show concern; if adequate, show relative calm. REFERENCE discovered resources in the narrative (e.g., 'the spring they found yesterday'). REFLECT exploration progress (characters discuss new areas or feel trapped if stuck). Translate game state into narrative: 'food: 0' becomes 'empty stomachs', 'spring discovered' becomes 'fresh water source', 'low supplies' becomes 'dwindling rations'. Never mention health numbers, tiles, maps, or game systems—only the lived experience. CRITICAL: ONLY reference the specific characters provided in the prompt (no new names or roles). If there is only one player, do NOT mention a group—refer only to that person. Personalize each character's behavior and reactions based on their MBTI personality type, showing how different personalities respond to survival situations (INTJs strategize, ENFPs maintain morale, ISTJs inventory). You always respond with valid JSON containing 'narration' and 'thread_updates' fields. The thread_updates should be 1–2 structured updates that advance plot threads with concrete beats (not mechanics, numbers, or systems). If ACTIVE PLOT THREADS exist, you must update at least one of them. If none exist, create a NEW thread. Thread update beats must be irreversible external changes (new facts/decisions/consequences/observations), not just emotions, and stalled threads must be externalized after 2 days."
        },
        { 
          role: "user", 
          content: prompt 
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 800,
      temperature: 0.8,
    });
    
    // Parse the JSON response
    const responseContent = completion.choices[0].message.content;
    let parsedResponse;
    
    try {
      parsedResponse = JSON.parse(responseContent);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.error('Raw response:', responseContent);
      // Fallback: return just narration if JSON parsing fails
      return Response.json({
        narration: responseContent,
        threadUpdates: []
      });
    }
    
    const narration = parsedResponse.narration || responseContent;
    const threadUpdates = parsedResponse.thread_updates || [];
    
    return Response.json({
      narration: narration,
      threadUpdates: threadUpdates
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return Response.json({ 
      error: 'Failed to generate narration',
      message: error.message 
    }, { status: 500 });
  }
}
