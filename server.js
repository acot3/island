require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const anthropic = new Anthropic({ maxRetries: 0 });
const openai = new OpenAI();

/**
 * callModel(params) — tries Anthropic first, falls back to OpenAI on 529.
 *
 * @param {object} params  — the full Anthropic messages.create() params
 *   { model, max_tokens, system, messages, tool_choice, tools }
 * @returns {object} the parsed tool-use input object
 */
async function callModel(params) {
  try {
    const message = await anthropic.messages.create(params);
    const toolUse = message.content.find(b => b.type === 'tool_use');
    return { result: toolUse.input, provider: 'anthropic' };
  } catch (err) {
    if (err.status !== 529) throw err;

    console.log('[Fallback] Anthropic returned 529 (overloaded) — falling back to OpenAI gpt-4o');

    // Convert Anthropic params → OpenAI params
    const openaiMessages = [];
    if (params.system) {
      openaiMessages.push({ role: 'system', content: params.system });
    }
    openaiMessages.push(...params.messages);

    const openaiTools = params.tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    let openaiToolChoice = undefined;
    if (params.tool_choice && params.tool_choice.type === 'tool') {
      openaiToolChoice = {
        type: 'function',
        function: { name: params.tool_choice.name },
      };
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: params.max_tokens,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: openaiToolChoice,
    });

    return { result: JSON.parse(response.choices[0].message.tool_calls[0].function.arguments), provider: 'openai' };
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NARRATOR_SYSTEM = `You are the narrator of an island survival game. Two players are stranded on a deserted tropical island.

Your voice is vivid but concise, sometimes cheeky. Narration must be from the third-person perspective and in present tense. Vary sentence structure and length.

You are building an unfolding story involving survival pressure, island magic, and personal discovery. You are the game master of this world. You control its geography, history, and contents. Players declare intentions — you decide what happens. If a player attempts to visit or use something you have not established, do not validate it. Redirect the action: they wander, they search, they find what the island actually contains. Perhaps make fun of the players in such situations.

Make sure interesting, specific plotlines emerge and develop.`;

// POST /api/morning
// Generates morning narration + 3 action suggestions per player
app.post('/api/morning', async (req, res) => {
  const { day, players, history } = req.body;

  const suggestionProperties = {};
  players.forEach(name => {
    suggestionProperties[name] = {
      type: 'array',
      items: { type: 'string' },
      description: `Three suggested survival actions for ${name}. Short phrases (2-5 words). Only reference locations, items, and features already established in the narration — never invent new ones.`,
    };
  });

  const isDay1 = day === 1;

  const historyBlock = history && history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}: ${h.narration} (Actions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')})`).join('\n')}\n</history>`
    : '';

  const morningPrompt = isDay1
    ? `<task>
Write the opening scene of the game — how ${players.join(' and ')} arrived on this island. Max 100 words. Include a vivid description of a wild storm and the shipwreck of Skipper's small boat. The players must find Skipper, who mentions that he has been to the island before and remarks ominously that "the island... she remembers." Skipper then dies.
</task>`
    : `<context>
It is Day ${day}. The players are: ${players.join(', ')}.${historyBlock}
</context>

<task>
Write a morning narration (1 or 2 sentences) — weather, atmosphere, and a thread from recent events if relevant. Then suggest three varied survival actions for each player, informed by the story so far.
</task>`;

  try {
    const { result, provider } = await callModel({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: NARRATOR_SYSTEM,
      messages: [{ role: 'user', content: morningPrompt }],
      tool_choice: { type: 'tool', name: 'morning_report' },
      tools: [{
        name: 'morning_report',
        description: 'Report the morning narration and action suggestions for each player.',
        input_schema: {
          type: 'object',
          properties: {
            narration: { type: 'string', description: isDay1 ? 'The opening arrival scene written. Separate paragraphs and dialogue should be separated by \\n.' : 'A 1 or 2 sentence morning narration about weather, atmosphere, and maybe recent events.' },
            suggestions: { type: 'object', properties: suggestionProperties, required: players },
          },
          required: ['narration', 'suggestions'],
        },
      }],
    });

    res.set('x-provider', provider).json(result);
  } catch (err) {
    console.error('Morning API error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/day
// Generates shared day narration + private food findings per player
app.post('/api/day', async (req, res) => {
  const { day, actions, history, morningNarration } = req.body;

  const playerLines = Object.entries(actions)
    .map(([name, action]) => `- ${name}: ${action}`)
    .join('\n');

  const playerNames = Object.keys(actions);

  const foodProperties = {};
  playerNames.forEach(name => {
    foodProperties[name] = {
      type: 'object',
      properties: {
        units: { type: 'integer', description: `Food units found by ${name} (0-5).` },
        description: { type: 'string', description: `If units > 0: a short description of what ${name} found. If units is 0: exactly the string "You found nothing."` },
      },
      required: ['units', 'description'],
    };
  });

  const historyBlock = history && history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}: ${h.narration} (Actions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')})`).join('\n')}\n</history>`
    : '';

  const morningBlock = morningNarration ? `\n<morning>\n${morningNarration}\n</morning>` : '';

  const dayPrompt = `<context>
It is Day ${day}.${historyBlock}${morningBlock}
</context>

<actions>
${playerLines}
</actions>

<narration_task>
Write a shared narration (2-4 sentences, 2 paragraphs) weaving both actions into one cohesive story. Build on previous events. The day ends at the campfire, so make sure nothing you say is inconsistent with that.
</narration_task>

<food_task>
Decide privately for each player whether they found food. Food should be rare unless the action was explicitly about foraging or hunting. Return a unit count (0-5) and a short private description of the find. If units is 0, the description must be exactly: "You found nothing."
</food_task>`;

  try {
    const { result, provider } = await callModel({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: NARRATOR_SYSTEM,
      messages: [{ role: 'user', content: dayPrompt }],
      tool_choice: { type: 'tool', name: 'day_report' },
      tools: [{
        name: 'day_report',
        description: 'Report the day narration and food findings for each player.',
        input_schema: {
          type: 'object',
          properties: {
            narration: { type: 'string', description: 'A 2-4 sentence (2 paragraphs) shared narration of the day.' },
            food: { type: 'object', properties: foodProperties, required: playerNames },
          },
          required: ['narration', 'food'],
        },
      }],
    });

    res.set('x-provider', provider).json(result);
  } catch (err) {
    console.error('Day API error:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

const PORT = 3030;
app.listen(PORT, () => {
  console.log(`Island server running at http://localhost:${PORT}`);
});
