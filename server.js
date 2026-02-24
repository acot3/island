require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const anthropic = new Anthropic();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// POST /api/morning
// Generates morning narration + 3 action suggestions per player
app.post('/api/morning', async (req, res) => {
  const { day, players } = req.body;

  const suggestionProperties = {};
  players.forEach(name => {
    suggestionProperties[name] = {
      type: 'array',
      items: { type: 'string' },
      description: `Three suggested survival actions for ${name}. Short phrases, 2-5 words each.`,
    };
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: `You are the narrator of an island survival game. It is day ${day} on a deserted tropical island. The players are: ${players.join(', ')}. Generate a very short morning narration (2-3 sentences max) — just the weather and atmosphere. Also suggest three varied, interesting survival actions for each player.` }],
      tool_choice: { type: 'tool', name: 'morning_report' },
      tools: [{
        name: 'morning_report',
        description: 'Report the morning narration and action suggestions for each player.',
        input_schema: {
          type: 'object',
          properties: {
            narration: { type: 'string', description: 'A 2-3 sentence morning narration about weather and atmosphere.' },
            suggestions: { type: 'object', properties: suggestionProperties, required: players },
          },
          required: ['narration', 'suggestions'],
        },
      }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    res.json(toolUse.input);
  } catch (err) {
    console.error('Morning API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/day
// Generates shared day narration + private food findings per player
app.post('/api/day', async (req, res) => {
  const { day, actions } = req.body;

  const playerLines = Object.entries(actions)
    .map(([name, action]) => `- ${name}: ${action}`)
    .join('\n');

  const playerNames = Object.keys(actions);

  const foodProperties = {};
  playerNames.forEach(name => {
    foodProperties[name] = {
      type: 'object',
      properties: {
        units: { type: 'integer', description: `Food units found by ${name} (0-3).` },
        description: { type: 'string', description: `Private description of what ${name} found (or that they found nothing).` },
      },
      required: ['units', 'description'],
    };
  });

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: `You are the narrator of an island survival game. It is day ${day} on a deserted tropical island.\n\nThe players took these actions today:\n${playerLines}\n\nGenerate a shared narration (3-5 sentences) describing what happened. Be vivid but concise. Weave all players' actions into one cohesive story. Also decide if each player found food (0-5 units) and write a short private description of their findings. Food findings should make sense given their actions.` }],
      tool_choice: { type: 'tool', name: 'day_report' },
      tools: [{
        name: 'day_report',
        description: 'Report the day narration and food findings for each player.',
        input_schema: {
          type: 'object',
          properties: {
            narration: { type: 'string', description: 'A 3-5 sentence shared narration of the day.' },
            food: { type: 'object', properties: foodProperties, required: playerNames },
          },
          required: ['narration', 'food'],
        },
      }],
    });

    const toolUse = message.content.find(b => b.type === 'tool_use');
    res.json(toolUse.input);
  } catch (err) {
    console.error('Day API error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3030;
app.listen(PORT, () => {
  console.log(`Island server running at http://localhost:${PORT}`);
});
