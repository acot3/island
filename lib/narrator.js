// ============================================================
// Narrator
//
// Per DESIGN.md §6.3 (and the simplified architecture we've settled on):
// the canonical narrative is a single growing prose document, room.narrative.
// Every narrator call reads the whole doc as context and emits a chunk that
// the server appends. Day headers ("## Day N") are inserted by the system,
// not by the AI — the AI only writes prose.
//
// Two roles share one persona:
//   - narrateMorning — opens a day. Hint: "Day N begins."
//   - narrateDay     — closes a day, given the action reports.
//
// Per-player private prose is intentionally NOT a feature here; the doc is a
// group story players take with them at the end of the run. Reward fields
// (food/water/items/injury) are also deferred — the day narrator only sees
// success/fail/impossible verdicts on free-text actions.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 1 });

const MODEL = 'claude-sonnet-4-6';

// Joins a list of names with Oxford commas: ["A","B","C"] → "A, B, and C".
function joinNames(names) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

// Builds the shared base prompt with the actual character roster baked in.
// Solo games drop the "they move independently" clause (only one mover).
function buildNarratorBase(players) {
  const names = players.map((p) => p.name);
  const intro = names.length === 1
    ? `${names[0]} is stranded on a procedurally-themed island with beach, jungle, and cave biomes.`
    : `${joinNames(names)} are stranded on a procedurally-themed island with beach, jungle, and cave biomes. They move independently between locations.`;

  return `You are the narrator of Island, a casual survival party game. ${intro}

You are writing one continuous, evolving story that the players will keep at the end of the game. Your task is to extend it — never restart, never recap.

VOICE & STYLE
- Third-person, present tense.
- Vary sentence rhythm and length.
- Use humor.
- Narration will be read by TTS, so write accordingly.
- Do not invent personal histories for the players (jobs, families, schools).

CONTINUITY
- The current state of the story is given to you between <story-so-far> tags. Read it carefully before writing. Match established tone, names, and details.
- Day headers in the doc ("## Day 1", "## Day 2") are inserted by the system, not by you. Never write a day header yourself. Never write "Day N" or "the next day" as a heading — just continue the prose.`;
}

// Layered on top of the dynamic base for the morning call only.
const MORNING_INSTRUCTIONS = `YOUR TASK: MORNING OPENING
Write the opening prose for a new day. Set mood and locate the characters in their world. On Day 1 this is the arrival scene; on later days it is the dawn that follows yesterday's events — let the previous day's prose color the tone.

LENGTH
- 2-4 sentences. One short paragraph.`;

// Layered on top of the dynamic base for the day call only.
const DAY_INSTRUCTIONS = `YOUR TASK: DRAMATIZE TODAY'S ACTIONS
You receive a list of action reports for the day between <action-reports> tags. Each line tells you:
- which player and where they are,
- what they tried,
- whether the world allowed it (impossible / possible),
- if rolled: success or failure, and the attribute and difficulty the roll tested.

You dramatize what happened. You do NOT decide outcomes — the verdict is fixed.
- IMPOSSIBLE means the world rejected the attempt (no trees on the beach to climb, etc.). Narrate the player discovering this, not "they failed."
- A FAILED roll means they tried and it didn't work.
- A SUCCESS roll means they accomplished what they intended. Do not invent specific rewards like "she found 3 berries" — keep success vague enough that a future system can fill in the specifics.
- Move actions are mechanical: that player is now at the new location (other characters stay where they were). Mention the move but do not dramatize the journey unless it is brief and natural.
- Assist actions mean those characters are working alongside the player they assist; weave that cooperation into the prose.

LOCATION RULES
- The <current-locations> block is authoritative. After today's moves, characters at different locations cannot see, hear, or meet each other — even if their nodes share a biome (e.g. the northwest jungle and the southwest jungle are different places). Treat them as separate threads in the prose.
- An assist only counts as cooperation if both characters are at the same location.

STRUCTURE & LENGTH
- Write one paragraph per location. Characters at the same location share a paragraph; characters at different locations get separate paragraphs.
- Separate paragraphs with a blank line (two newlines, "\\n\\n").
- Each paragraph: 3-5 sentences. The order of paragraphs is up to you.`;

const MORNING_TOOL = {
  name: 'morning_chunk',
  description: 'Emit the next chunk of narration: an opening for the new day.',
  input_schema: {
    type: 'object',
    properties: {
      narration: {
        type: 'string',
        description: 'The morning narration prose. 2-4 sentences. No day header — the system handles that.',
      },
    },
    required: ['narration'],
  },
};

const DAY_TOOL = {
  name: 'day_chunk',
  description: "Emit the next chunk of narration: dramatize the players' actions for today.",
  input_schema: {
    type: 'object',
    properties: {
      narration: {
        type: 'string',
        description: 'The after-action narration prose. One paragraph per location (see system instructions). Separate paragraphs with a blank line — i.e. two newlines (\\n\\n) between them.',
      },
    },
    required: ['narration'],
  },
};

function formatPlayers(players) {
  if (!players || players.length === 0) return '(no players)';
  return players
    .map((p) => {
      const mbti = p.mbti ? ` [${p.mbti}]` : '';
      const pronouns = p.pronouns ? ` (${p.pronouns})` : '';
      return `- ${p.name}${pronouns}${mbti}`;
    })
    .join('\n');
}

// Group players by nodeId so we can call out co-location explicitly.
function formatLocations(locations) {
  if (!locations || locations.length === 0) return '(no locations)';
  const byNode = new Map();
  for (const { name, nodeId, label } of locations) {
    if (!byNode.has(nodeId)) byNode.set(nodeId, { label, names: [] });
    byNode.get(nodeId).names.push(name);
  }
  const lines = [];
  for (const { label, names } of byNode.values()) {
    if (names.length === 1) {
      lines.push(`- ${names[0]} is at ${label}.`);
    } else {
      lines.push(`- ${joinNames(names)} are together at ${label}.`);
    }
  }
  if (byNode.size > 1) {
    lines.push('Characters at different locations cannot see or interact with each other.');
  }
  return lines.join('\n');
}

function formatActionReports(reports) {
  if (!reports || reports.length === 0) return '(no actions submitted)';
  return reports
    .map((r) => {
      if (r.type === 'move') {
        return `- ${r.player}: moved from ${r.fromLabel} to ${r.currentLabel}.`;
      }
      if (r.type === 'assist') {
        return `- ${r.player} (at ${r.currentLabel}): ${r.action}`;
      }
      // free-text
      const verdict = r.reason === 'impossible'
        ? `IMPOSSIBLE — ${r.rationale}`
        : `${r.attribute}/${r.difficulty} — ${r.success ? 'SUCCESS' : 'FAILURE'}`;
      return `- ${r.player} (at ${r.currentLabel}): "${r.action}" → ${verdict}`;
    })
    .join('\n');
}

async function callNarrator({ system, tool, userMessage }) {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMessage }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Narrator did not return a tool call');
  return toolUse.input.narration;
}

async function narrateMorning({ narrative, day, players, locations }) {
  const userMessage = `<story-so-far>
${narrative || '(empty — the story starts now)'}
</story-so-far>

<context>
Day ${day} begins. The characters:
${formatPlayers(players)}
</context>

<current-locations>
${formatLocations(locations)}
</current-locations>

Write the opening prose for Day ${day}. Continue the existing story; do not recap or restart.`;
  const chunk = await callNarrator({
    system: `${buildNarratorBase(players)}\n\n${MORNING_INSTRUCTIONS}`,
    tool: MORNING_TOOL,
    userMessage,
  });
  return { chunk };
}

async function narrateDay({ narrative, day, players, locations, actionReports }) {
  const userMessage = `<story-so-far>
${narrative || '(empty)'}
</story-so-far>

<context>
Day ${day}. The characters:
${formatPlayers(players)}
</context>

<current-locations>
${formatLocations(locations)}
</current-locations>

<action-reports>
${formatActionReports(actionReports)}
</action-reports>

Write the after-action prose for Day ${day}, dramatizing what just happened. Continue the existing story; do not recap.`;
  const chunk = await callNarrator({
    system: `${buildNarratorBase(players)}\n\n${DAY_INSTRUCTIONS}`,
    tool: DAY_TOOL,
    userMessage,
  });
  return { chunk };
}

module.exports = { narrateMorning, narrateDay };
