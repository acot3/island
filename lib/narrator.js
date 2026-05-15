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
    ? `${names[0]} is stranded on an island with beach, jungle, and cave biomes.`
    : `${joinNames(names)} are stranded on an island with beach, jungle, and cave biomes. They move independently between locations.`;

  return `You are the narrator of Island, a casual survival party game. ${intro}

You are writing one continuous, evolving story.

VOICE & STYLE
- Third-person, present tense.
- Write in the prose style of Ernest Hemingway, though avoid philosophical asides.
- Do not invent personal histories for the players (jobs, families, schools).

CONTINUITY
- The current state of the story is given to you between <story-so-far> tags. Read it carefully before writing.
- Day headers in the doc ("## Day 1", "## Day 2") are inserted by the system, not by you. Never write a day header yourself.`;
}

// Layered on top of the dynamic base for the morning call only.
const MORNING_INSTRUCTIONS = `YOUR TASK: MORNING OPENING
Write the opening prose for a new day. Set mood and locate the characters in their world.

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
- SEARCH actions are private. The outcome — whether they found anything, what they found, even whether the search was viable — is told to that player only, not in the public story.
- Move actions are mechanical: that player is now at the new location (other characters stay where they were).
- Assist actions mean those characters are working alongside the player they assist; weave that cooperation into the prose.

LOCATION RULES
- The <current-locations> block is authoritative. Each location is identified by an opaque token like "Location A" with its biome in parentheses, e.g. "Location A (jungle)". The token is for your reasoning only — NEVER mention "Location A", "Location B", etc. in your prose.
- Two characters are together iff they share the same token.

STRUCTURE & LENGTH
- Write one paragraph per location. Characters at the same location share a paragraph; characters at different locations get separate paragraphs.
- Separate paragraphs with a blank line (two newlines, "\\n\\n") via separate "narrator" segments.

OUTPUT FORMAT — SEGMENTS
- Your output is an ordered list of voice segments. Each segment is { voice, text }.
- For your own narration prose, use voice "narrator". For each paragraph, emit a separate narrator segment.
- A <character-reactions> block may be present. Each entry lists ordered "outputs" produced by a character. The two kinds are handled differently:
  - "action" outputs are FACTS about what the character physically did. Treat them as ground truth and paraphrase them into the surrounding prose in your own voice.
  - "dialogue" outputs are VERBATIM character speech. Embed them exactly as given, as separate segments with the character's voice key.
- Preserve the order of outputs within each entry: the action/dialogue should appear in the narration in the order the character chose.

COVERAGE — NON-NEGOTIABLE
- Every player listed in <action-reports> MUST appear in your prose. Skipping a player is not allowed under any circumstance.
- Every dialogue output in <character-reactions> MUST appear as a verbatim character-voice segment.`;

const MORNING_TOOL = {
  name: 'morning_chunk',
  description: 'Emit the next chunk of narration: an opening for the new day.',
  input_schema: {
    type: 'object',
    properties: {
      narration: {
        type: 'string',
        description: 'The morning narration prose. 2-3 sentences. No day header — the system handles that.',
      },
    },
    required: ['narration'],
  },
};

// The day tool is built per-call so its voice enum can include any
// characters present in the current scene. Default voices is just narrator.
function buildDayTool(voiceKeys = ['narrator']) {
  return {
    name: 'day_chunk',
    description: "Emit the after-action narration as an ordered list of voice segments.",
    input_schema: {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              voice: { type: 'string', enum: voiceKeys },
              text: { type: 'string' },
            },
            required: ['voice', 'text'],
          },
          description: 'Ordered list of voice segments. Use "narrator" for prose. For any character-reply provided in <character-replies>, emit the verbatim reply as a segment with the character\'s voice key. Limit non-dialogue prose to one 2-3 sentence paragraph per location.',
        },
      },
      required: ['segments'],
    },
  };
}

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

// Mint per-call opaque tokens (Location A, Location B, ...) for every nodeId
// that appears in this call. Tokens hide the compass info baked into real
// node ids — the narrator uses them only to judge colocation, never in prose.
function buildTokenMap(locations, reports) {
  const map = new Map();
  let next = 0;
  const letter = () => `Location ${String.fromCharCode(65 + next++)}`;
  const see = (id) => { if (id && !map.has(id)) map.set(id, letter()); };
  if (locations) for (const { nodeId } of locations) see(nodeId);
  if (reports) {
    for (const r of reports) {
      see(r.nodeId);
      if (r.fromNodeId) see(r.fromNodeId);
    }
  }
  return map;
}

function place(tokens, nodeId, biome) {
  return `${tokens.get(nodeId)} (${biome})`;
}

// Group players by nodeId so we can call out co-location explicitly.
function formatLocations(locations, tokens) {
  if (!locations || locations.length === 0) return '(no locations)';
  const byNode = new Map();
  for (const { name, nodeId, biome, description, annotations } of locations) {
    if (!byNode.has(nodeId)) byNode.set(nodeId, { biome, description, annotations, names: [] });
    byNode.get(nodeId).names.push(name);
  }
  const lines = [];
  for (const [nodeId, { biome, description, annotations, names }] of byNode.entries()) {
    const where = place(tokens, nodeId, biome);
    if (names.length === 1) {
      lines.push(`- ${names[0]} is at ${where}.`);
    } else {
      lines.push(`- ${joinNames(names)} are together at ${where}.`);
    }
    if (description) lines.push(`  Description: ${description}`);
    if (annotations && annotations.length) {
      for (const a of annotations) lines.push(`  Also true here: ${a}`);
    }
  }
  if (byNode.size > 1) {
    lines.push('Characters at different locations cannot see or interact with each other.');
  }
  return lines.join('\n');
}

function formatActionReports(reports, tokens) {
  if (!reports || reports.length === 0) return '(no actions submitted)';
  return reports
    .map((r) => {
      if (r.type === 'move') {
        return `- ${r.player}: moved from ${place(tokens, r.fromNodeId, r.fromBiome)} to ${place(tokens, r.nodeId, r.biome)}.`;
      }
      if (r.type === 'assist') {
        return `- ${r.player} at ${place(tokens, r.nodeId, r.biome)}: ${r.action}`;
      }
      // Search actions are private — the public narrator knows only that
      // the player searched, not whether they found anything.
      if (r.isSearch) {
        return `- ${r.player} at ${place(tokens, r.nodeId, r.biome)}: "${r.action}" → SEARCH (outcome private)`;
      }
      // free-text
      const verdict = r.reason === 'impossible'
        ? `IMPOSSIBLE — ${r.rationale}`
        : `${r.attribute}/${r.difficulty} — ${r.success ? 'SUCCESS' : 'FAILURE'}`;
      return `- ${r.player} at ${place(tokens, r.nodeId, r.biome)}: "${r.action}" → ${verdict}`;
    })
    .join('\n');
}

async function callNarrator({ system, tool, userMessage }) {
  const result = await callNarratorRaw({ system, tool, userMessage });
  return result.narration;
}

async function callNarratorRaw({ system, tool, userMessage }) {
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
  return toolUse.input;
}

async function narrateMorning({ narrative, day, players, locations }) {
  const tokens = buildTokenMap(locations, null);
  const userMessage = `<story-so-far>
${narrative || '(empty — the story starts now)'}
</story-so-far>

<context>
Day ${day} begins. The characters:
${formatPlayers(players)}
</context>

<current-locations>
${formatLocations(locations, tokens)}
</current-locations>

Write the opening prose for Day ${day}. Continue the existing story; do not recap or restart.`;
  const chunk = await callNarrator({
    system: `${buildNarratorBase(players)}\n\n${MORNING_INSTRUCTIONS}`,
    tool: MORNING_TOOL,
    userMessage,
  });
  return { chunk };
}

async function narrateDay({ narrative, day, players, locations, actionReports, sceneHandoff, characterReactions }) {
  const tokens = buildTokenMap(locations, actionReports);
  const handoffBlock = sceneHandoff
    ? `\n\n<scene-handoff>
${sceneHandoff.names.length === 1
  ? `${sceneHandoff.names[0]}'s day will not be narrated by you. They are about to enter a separate scene event.`
  : `${joinNames(sceneHandoff.names)} will not be narrated by you. They are about to enter a separate scene event.`}
Do NOT describe what they did this day. Instead, end your prose with one short transitional sentence that hands off to their scene, in ine with the hint below.
HINT: ${sceneHandoff.hint || 'a short transitional sentence pointing the affected player(s) toward where their separate scene will begin.'}
</scene-handoff>`
    : '';
  const reactionsBlock = (characterReactions && characterReactions.length)
    ? `\n\n<character-reactions>
${characterReactions.map((r) => {
  const outs = (r.outputs || []).map((o, i) => `    ${i + 1}. ${o.kind}: "${o.text}"`).join('\n');
  const outsBlock = outs || '    (no visible reaction — the character chose silence)';
  return `- ${r.playerName} did something that involves ${r.characterName} at ${place(tokens, r.nodeId, r.biome)}.
  Player's action: "${r.action}"
  ${r.characterName}'s ordered outputs (voice key for dialogue: "${r.voice}"):
${outsBlock}`;
}).join('\n')}
</character-reactions>
For each entry, weave the listed outputs into the paragraph covering that player's location, in order. "action" outputs are FACTS — paraphrase them into your narrator prose (do not use verbatim). "dialogue" outputs are character speech — embed VERBATIM as segments with the given voice key. If outputs is empty, narrate the player's action normally and do not mention the character reacting.`
    : '';

  const userMessage = `<story-so-far>
${narrative || '(empty)'}
</story-so-far>

<context>
Day ${day}. The characters:
${formatPlayers(players)}
</context>

<current-locations>
${formatLocations(locations, tokens)}
</current-locations>

<action-reports>
${formatActionReports(actionReports, tokens)}
</action-reports>${reactionsBlock}${handoffBlock}

Write the after-action prose for Day ${day}, dramatizing what just happened. Continue the existing story; do not recap.`;

  // Build the voice enum: narrator + every voice key referenced in
  // characterReactions (only matters for dialogue outputs).
  const voiceKeys = ['narrator'];
  if (characterReactions) {
    for (const r of characterReactions) {
      if (!voiceKeys.includes(r.voice)) voiceKeys.push(r.voice);
    }
  }
  const dayTool = buildDayTool(voiceKeys);

  const result = await callNarratorRaw({
    system: `${buildNarratorBase(players)}\n\n${DAY_INSTRUCTIONS}`,
    tool: dayTool,
    userMessage,
  });
  // Defensive: if the model emitted something other than the expected
  // array, fall back to a single narrator segment so downstream code
  // doesn't crash. Surface the raw output so we can see what happened.
  if (!Array.isArray(result.segments)) {
    const raw = JSON.stringify(result);
    console.error(`[narrateDay] segments not an array: ${raw.slice(0, 500)}`);
    const fallbackText = typeof result.narration === 'string'
      ? result.narration
      : raw;
    return { segments: [{ voice: 'narrator', text: fallbackText }] };
  }
  return { segments: result.segments };
}

module.exports = { narrateMorning, narrateDay };
