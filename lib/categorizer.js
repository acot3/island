// ============================================================
// Categorizer
//
// Per DESIGN.md §6.1 — given a player's free-text action and a small
// slice of context (current biome for now), ask Claude to judge:
//   - is the action physically possible at this location?
//   - which attribute does it test (physical / mental / social / none)?
//   - how difficult is it (easy / medium / hard)?
//   - one-sentence rationale
//
// Returns a structured object via tool-call. Throws on failure;
// the caller decides how to handle (we currently fire-and-forget
// from server.js and log errors to the host debug panel).
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 1 });

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are the action categorizer for Island, a multiplayer survival storytelling game. Players are stranded on a procedurally-themed island with beach, jungle, and cave biomes. They submit free-text actions describing what they want to do.

For each action, judge four things:

1. Whether the action is physically possible at the player's current biome. Be reasonable — generic actions like "rest" or "look around" are possible anywhere.

2. Which attribute the action primarily tests:
   - "physical" — strength, endurance, manual skill
   - "mental" — knowledge, perception, problem-solving
   - "social" — communication, persuasion, performance
   - "none" — trivial actions that don't really test anything (sitting, waiting)

3. How difficult the action is:
   - "easy"
   - "medium"
   - "hard"

4. A one-sentence rationale explaining your judgment, useful for debug and downstream narration.

Be concise and concrete. Do not narrate the outcome — only categorize.`;

const TOOL = {
  name: 'categorize_action',
  description: "Return a structured categorization of the player's action.",
  input_schema: {
    type: 'object',
    properties: {
      possible: {
        type: 'boolean',
        description: 'True if the action is physically possible at the current location.',
      },
      attribute: {
        type: 'string',
        enum: ['physical', 'mental', 'social', 'none'],
        description: 'Which attribute the action primarily tests.',
      },
      difficulty: {
        type: 'string',
        enum: ['easy', 'medium', 'hard'],
        description: 'How difficult the action is.',
      },
      rationale: {
        type: 'string',
        description: 'One short sentence explaining the judgment.',
      },
    },
    required: ['possible', 'attribute', 'difficulty', 'rationale'],
  },
};

async function categorizeAction({ action, biome }) {
  const userMessage = `The player is currently on a ${biome} node.\nAction: "${action}"\n\nCategorize this action.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Categorizer did not return a tool call');
  return toolUse.input;
}

module.exports = { categorizeAction };
