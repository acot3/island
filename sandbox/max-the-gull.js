// ============================================================
// Max the Gull — sandbox character
//
// A sandbox-only character used for iterating on character module shape
// without dropping the wider game. Same shape as characters/king-krab.js
// minus a firstEncounter scene — Max is simply present from day one.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 1 });
const MODEL = 'claude-sonnet-4-6';

// Personality — used by all of Max's AI calls. Never seen by the day
// narrator (only Max's verbatim replies reach the narrator).
const PERSONALITY = `You are Max — a scruffy and eager young herring gull. You can speak.

You want to be a great warrior to protect the island from her foes. You train daily. You have observed humans before and have noted their perseverance and desire to improve. This interests you.

You talk a lot but speak in short, clipped sentences.'`;

const REACT_SYSTEM = `${PERSONALITY}

A landwalker has done something that involves you. Decide how you react AND write the brief memory you'll keep of this moment.

OUTPUTS — your reaction this turn
- An ordered list. Each item is either an "action" or "dialogue":
  - "action" is a plain factual statement of what you intend to do. The narrator will paraphrase it into the story in their own voice.
  - "dialogue" is your verbatim spoken line, in YOUR voice. No quotation marks, no stage directions, no narrator wrapping. Whatever you write here will be read aloud as you.
- Output is limited to one action and one dialogue portion.
- You may choose to ignore the player: return outputs: [].
- You may speak without acting, act without speaking, or both. Order them as they naturally play.
- Your reaction has to be one-and-done for the present day. Do not ask any questions or do anything that requires a further response from the player.

MEMORY — what you take away
- A single short sentence in YOUR voice, written from your point of view, capturing what happened and how you felt about it.`;

const REACT_TOOL = {
  name: 'max_react',
  description: "Emit Max's reaction (outputs) and his brief memory of the moment.",
  input_schema: {
    type: 'object',
    properties: {
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['action', 'dialogue'] },
            text: { type: 'string' },
          },
          required: ['kind', 'text'],
        },
      },
      memory: {
        type: 'string',
        description: "One short sentence in Max's voice — the memory he keeps of this turn.",
      },
    },
    required: ['outputs', 'memory'],
  },
};

async function react({ playerName, playerAction, history }) {
  const historyBlock = (history || [])
    .map((h) => `- Day ${h.day}: ${h.memory}`)
    .join('\n') || '(no prior interactions)';

  const userMessage = `<your-memory>
${historyBlock}
</your-memory>

<approach>
${playerName} does: "${playerAction}"
</approach>

How do you react, and what will you remember?`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: REACT_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
    tools: [REACT_TOOL],
    tool_choice: { type: 'tool', name: REACT_TOOL.name },
  });
  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Max react did not return a tool call');
  return {
    outputs: toolUse.input.outputs || [],
    memory: toolUse.input.memory || '',
  };
}

module.exports = {
  key: 'max',
  displayName: 'Max the Gull',

  voice: {
    key: 'max',
    displayName: 'Max',
    browserPrefs: ['Daniel', 'Fred', 'Aaron', 'Google UK English Male'],
    pitch: 1.1,
    rate: 1.1,
    elevenLabsId: 'cjVigY5qzO86Huf0OWal',
    // ElevenLabs tuning. Tune these to taste:
    //   stability         0–1   higher = more consistent; lower = more expressive
    //   similarity_boost  0–1   higher = stricter match to the source voice
    //   style             0–1   character exaggeration (turbo ignores it; v2 honors)
    //   use_speaker_boost bool  helps stability on clones with sparse training
    // Models: 'eleven_turbo_v2_5' is fast/quirky; 'eleven_multilingual_v2' is
    // slower but more stable on edge-of-distribution voices.
    elevenLabsModel: 'eleven_multilingual_v2',
    elevenLabsSettings: {
      stability: 0.55,
      similarity_boost: 0.85,
      style: 0.2,
      use_speaker_boost: true,
    },
    volume: 1.0,
  },

  presenceAnnotation:
    'A herring gull named Max watches from a piece of driftwood. He can — and sometimes will — speak.',

  // No firstEncounter scene; Max is present from day one of the sandbox.
  react,
};
