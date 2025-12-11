import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request) {
  const { currentDay, players, food, water, mapState } = await request.json();
  
  // Build a simple prompt with game state
  const playerSummary = players.map(p => {
    const healthStatus = p.health <= 3 ? 'critically low' : p.health <= 6 ? 'concerning' : 'stable';
    return `${p.name} (Health: ${p.health}/10, ${healthStatus})`;
  }).join(', ');
  
  const resourceStatus = food === 0 && water === 0 ? 'no resources' : 
                        food === 0 ? 'no food' : 
                        water === 0 ? 'no water' : 
                        `${food} food, ${water} water`;
  
  let mapInfo = '';
  if (mapState) {
    const explorationPercent = Math.round((mapState.exploredTiles / mapState.totalTiles) * 100);
    mapInfo = `- Map exploration: ${mapState.exploredTiles} of ${mapState.totalTiles} tiles explored (${explorationPercent}% of the island)`;
  }
  
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

Game State:
- Players: ${playerSummary}
- Resources: ${resourceStatus}
${mapInfo}

The narration should:
- Be immersive and atmospheric
- Acknowledge the current situation (health levels, resource scarcity, exploration progress)
- Set the tone for the day ahead
- Be very brief (100 words maximum)
${choiceInstructions}

${currentDay === 1 ? 'This is the first day after the shipwreck. The survivors are just waking up on the beach.' : ''}

IMPORTANT: You must respond with valid JSON containing ONLY a "narration" field. Do NOT include choices - those are handled separately. Format:
{
  "narration": "Your very brief narration text here (100 words maximum)"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are the narrator for Island Game, a survival RPG. Your narration is very brief (100 words maximum), immersive, and atmospheric. You acknowledge the current state of the players and resources without being overly dramatic. You always respond with valid JSON containing only a 'narration' field."
        },
        { 
          role: "user", 
          content: prompt 
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 400,
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
    
    console.log(`Generated narration with ${availableChoices.length} available choices:`, availableChoices.map(c => c.id));
    
    return Response.json({
      narration: narration,
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
