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
  
  const prompt = `You are narrating a survival game. Generate 2-3 paragraphs of narration for the start of Day ${currentDay}.

Game State:
- Players: ${playerSummary}
- Resources: ${resourceStatus}
${mapInfo}

The narration should:
- Be immersive and atmospheric
- Acknowledge the current situation (health levels, resource scarcity, exploration progress)
- Set the tone for the day ahead
- Be concise (2-3 paragraphs maximum)

${currentDay === 1 ? 'This is the first day after the shipwreck. The survivors are just waking up on the beach.' : ''}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "You are the narrator for Island Game, a survival RPG. Your narration is concise, immersive, and atmospheric. You acknowledge the current state of the players and resources without being overly dramatic."
        },
        { 
          role: "user", 
          content: prompt 
        }
      ],
      max_tokens: 300,
      temperature: 0.8,
    });
    
    return Response.json({
      narration: completion.choices[0].message.content
    });
  } catch (error) {
    console.error('OpenAI API error:', error);
    return Response.json({ 
      error: 'Failed to generate narration',
      message: error.message 
    }, { status: 500 });
  }
}
