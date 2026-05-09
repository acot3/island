// ============================================================
// Private finding narrator
//
// One Sonnet call per player who searched. Produces a single second-person
// sentence describing what they found (or didn't). Misses are not sent in
// the prompt — only the list of successful finds. An empty list means the
// search came up empty, and the model narrates a near-miss.
//
// These calls fan out in parallel from runDayNarration. The result is sent
// privately to that player's phone via the `private-narration` socket event,
// not woven into the public day narration.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 1 });

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `Write a private one-sentence note to a single player in Island, a survival storytelling game. The player just attempted to search a location. Tell them, in second person ("you"), what they discovered or did not.

VOICE
- Second person, present tense.
- Exactly one sentence — be concise.

INPUT
- A description of where the player is searching.
- The exact action text the player submitted.
- A list of items or food the player found (may be empty if nothing turned up).

OUTPUT
- One sentence describing what the player found, fitted to the action and the location.
- If the list is empty, narrate a miss — the search ran its course and turned up nothing worth keeping.
- Never invent items beyond the provided list.

EXAMPLES OF OUTPUT
- "You pick through the wreckage carefully but discover nothing."
- "Rustling through the jungle foliage, you come across a cluster of berries.`;

const TOOL = {
  name: 'private_finding',
  description: "Emit the player's private one-sentence note for what they found.",
  input_schema: {
    type: 'object',
    properties: {
      narration: {
        type: 'string',
        description: 'One sentence in second-person describing the find or miss.',
      },
    },
    required: ['narration'],
  },
};

async function narrateFinding({ description, action, finds }) {
  const findsBlock = (finds && finds.length)
    ? `Found:\n${finds.map((f) => `- ${f}`).join('\n')}`
    : 'Found: nothing';

  const userMessage = `<location>
${description || '(no description)'}
</location>

<action>
"${action}"
</action>

<finds>
${findsBlock}
</finds>

Write the private one-sentence note for this player.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Findings narrator did not return a tool call');
  return toolUse.input.narration;
}

module.exports = { narrateFinding };
