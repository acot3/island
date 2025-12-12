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
  
  const resourceStatus = food === 0 && water === 0 ? 'without any supplies' : 
                        food === 0 ? 'without food' : 
                        water === 0 ? 'without water' : 
                        food <= 2 && water <= 2 ? 'with scarce supplies' :
                        'with some supplies';
  
  let explorationInfo = '';
  if (mapState) {
    const hasExplored = mapState.exploredTiles > 1; // More than just starting location
    explorationInfo = hasExplored ? 
      `- The survivors have begun to explore their surroundings` : 
      `- The survivors have not yet ventured far from the wreckage`;
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
  
  // Determine available choices based on game state
  const availableChoices = [];
  
  // Check if there are unrevealed tiles within 2 spaces of starting tile
  if (mapState && mapState.nearbyUnexplored !== undefined) {
    if (mapState.nearbyUnexplored) {
      availableChoices.push({
        id: 'explore',
        text: 'Explore nearby surroundings',
        type: 'explore'
      });
    }
  }
  
  // Check for revealed food resources
  if (mapState && mapState.revealedResources) {
    const foodResources = mapState.revealedResources.filter(r => 
      (r.type === 'herbs' || r.type === 'deer' || r.type === 'coconut' || r.type === 'clams') && !r.collected
    );
    if (foodResources.length > 0) {
      availableChoices.push({
        id: 'gather_food',
        text: 'Gather food',
        type: 'collect',
        resource: 'food'
      });
    }
  }
  
  // Check for revealed water resources
  if (mapState && mapState.revealedResources) {
    const waterResources = mapState.revealedResources.filter(r => 
      (r.type === 'spring' || r.type === 'bottle') && !r.collected
    );
    if (waterResources.length > 0) {
      availableChoices.push({
        id: 'collect_water',
        text: 'Collect water',
        type: 'collect',
        resource: 'water'
      });
    }
  }
  
  // Build choice instructions for AI (for context only - we'll use our own choices)
  let choiceInstructions = '';
  if (availableChoices.length > 0) {
    choiceInstructions = `\n\nNote: Players will have these choices available: ${availableChoices.map(c => c.text).join(', ')}. You can reference these in your narration if appropriate, but focus on the narrative.`;
  }
  
  const prompt = `You are narrating a survival game. Generate a very brief narration for the start of Day ${currentDay}.

Current Situation:
- ${playerSummary}
- The group is ${resourceStatus}
${explorationInfo}
${threadsBlock}

CRITICAL: The ONLY characters in this story are: ${players.map(p => p.name).join(', ')} (total ${players.length}). Do NOT reference any other characters. If there is only one player, do NOT mention a group—refer only to that person.

The narration should:
- Be written in present tense
- Be immersive and atmospheric
- Convey the mood and challenges facing the survivors
- ONLY reference the specific characters listed above - never invent or mention other characters, names, or roles. If there is only one player, do NOT mention a group—refer only to that person.
- Use each character's MBTI type to personalize their behavior, reactions, and interactions in the narrative (e.g., INTJs might strategize, ENFPs might maintain group morale, ISTJs might focus on practical tasks)
- Focus on the experience, not game mechanics
- Avoid mentioning: health numbers, tiles, maps, or any explicit game systems
- Set the tone for the day ahead
- Be very brief (200 words maximum)
${choiceInstructions}

${currentDay === 1 ? 'This is the first day after the shipwreck. The survivors are just waking up on the beach.' : ''}

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

Do NOT include mechanics, numbers, or systems. Do NOT include choices - those are handled separately.`;

  try {
    const openai = getOpenAIClient();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You are the narrator for Island Game, a survival story. Your narration is very brief (200 words maximum), immersive, and atmospheric, written in present tense. You focus on the experience and emotions of the survivors, never mentioning game mechanics like health, tiles, maps, or numbers. CRITICAL: ONLY reference the specific characters provided in the prompt (no new names or roles). If there is only one player, do NOT mention a group—refer only to that person. Personalize each character's behavior and reactions based on their MBTI personality type, showing how different personalities respond to survival situations. You acknowledge the current state through narrative description, not game terms. You always respond with valid JSON containing 'narration' and 'thread_updates' fields. The thread_updates should be 1–2 structured updates that advance plot threads with concrete beats (not mechanics, numbers, or systems). If ACTIVE PLOT THREADS exist, you must update at least one of them. If none exist, create a NEW thread. Thread update beats must be irreversible external changes (new facts/decisions/consequences/observations), not just emotions, and stalled threads must be externalized after 2 days."
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
        choices: availableChoices
      });
    }
    
    // Use AI's narration but ALWAYS use our pre-determined available choices
    // Choices are determined by game state logic, not AI generation
    // This ensures accuracy and prevents AI from inventing unavailable choices
    const narration = parsedResponse.narration || responseContent;
    const threadUpdates = parsedResponse.thread_updates || [];
    
    console.log(`Generated narration with ${availableChoices.length} available choices:`, availableChoices.map(c => c.id));
    
    return Response.json({
      narration: narration,
      threadUpdates: threadUpdates,
      choices: availableChoices
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return Response.json({ 
      error: 'Failed to generate narration',
      message: error.message 
    }, { status: 500 });
  }
}
