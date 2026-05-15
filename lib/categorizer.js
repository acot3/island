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

For each action, judge six things:

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

4. Whether the player is conducting a search and, if so, for what. This is about *finding* something, never about consuming or using something already at hand. Return all that apply, or leave the array blank if the proposed action is not a search.
   - "food" — explicitly looking for food.
   - "water" — explicitly looking for fresh water.
   - "item" — looking for tangible objects (tools, supplies, gear), OR an unspecified search like "rummage", "search the wreckage", "look around for anything useful".

5. Whether the action *notably involves* a specific character known to be present at this location. The list of present characters (if any) is given in <present-characters> below.
   - "Notably involves" covers: addressing the character (talking to, asking, offering); acting upon them (throwing at, lunging at, feeding, blocking); and significant proximity acts (kneeling next to, mimicking, deliberately ignoring in their face). Anything a person of normal sensibility would notice as directed at the character.
   - If the action notably involves a present character, return that character's KEY (e.g. "krab"). The character decides whether to react.
   - If the action is purely the player's own business with the environment, return null even if a character is nearby.

6. A one-sentence rationale explaining your judgment, useful for debug and downstream narration.

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
      seeking: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['food', 'water', 'item'],
        },
        description: "List of distinct categories the player is trying to discover. Empty list means the action isn't a discovery attempt.",
      },
      involves: {
        type: ['string', 'null'],
        description: "If the action notably involves a present character (address, physical action, or significant proximity), the character's key. Else null.",
      },
      rationale: {
        type: 'string',
        description: 'One short sentence explaining the judgment.',
      },
    },
    required: ['possible', 'attribute', 'difficulty', 'seeking', 'involves', 'rationale'],
  },
};

async function categorizeAction({ action, biome, description, annotations, characters }) {
  const descBlock = description ? `\n<location-description>\n${description}\n</location-description>` : '';
  const annBlock = (annotations && annotations.length)
    ? `\n<location-annotations>\n${annotations.map((a) => `- ${a}`).join('\n')}\n</location-annotations>\nTreat each annotation as ground truth about this location — characters, features, or events named there are present and available to interact with.`
    : '';
  const charBlock = (characters && characters.length)
    ? `\n<present-characters>\n${characters.map((c) => `- key="${c.key}", name="${c.displayName}"`).join('\n')}\n</present-characters>`
    : '';
  const userMessage = `The player is on a ${biome} node.${descBlock}${annBlock}${charBlock}\n\nAction: "${action}"\n\nCategorize this action.`;

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
