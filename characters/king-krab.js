// ============================================================
// King Krab — character module
//
// A character is a persistent NPC entity, distinct from a one-shot scene
// event. It owns:
//   - identity (key, displayName)
//   - voice config (TTS)
//   - personalitySystem (a system prompt shared by all of this character's
//     AI calls — never seen by the day narrator)
//   - presenceAnnotation (the line the day narrator + categorizer see)
//   - firstEncounter(engine) — the scripted multi-beat scene played the
//     first time players meet the character
//   - respond(opts) — a single-shot conversational reply, used on every
//     subsequent visit when a player addresses the character
//
// Memory: room.characterState[key].history is a flat list of past
// interactions (the firstEncounter's storytellerMessages plus every
// respond() exchange). It's threaded into each respond() call so the
// character remembers prior visits.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ maxRetries: 1 });
const MODEL = 'claude-sonnet-4-6';

const PERSONALITY = `You are King Krab — a small crab who believes the island herself chose him as king of the crabs and that he thereby exercises a divine right to rule. You demand deference. Your manner is over-blown, bombastic, theatrical.

You always speak about yourself in the third person OR as "the king," and you address landwalkers as supplicants.

You remember every visitor and what they have done for you (or failed to do). Your tone with returning visitors reflects that history.`;

// ----------------- First-encounter scene (multi-beat) -----------------

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival storytelling game. You are running a single scene encounter with a recurring character — King Krab.

${PERSONALITY}

Each call, you emit ONE beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats.

A beat is an ordered array of voice segments. Two voices are available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Match the prose style of Ernest Hemingway.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

KRAB voice:
- King Krab himself, speaking aloud to the player.
- Output only what he says aloud. No stage directions, asterisks, or roleplay action descriptions.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The player's turn belongs to the player. Stop at the player's next choice (or at scene close for terminal beats).

BREVITY: Each beat is limited to 100 words total across all segments — punchy and evocative, not expansive.`;

const KRAB_JUDGMENT_SYSTEM = `You are King Krab. You believe the island herself chose you as king of the crabs and you thereby exercise a divine right to rule. You expect great deference. You judge whether offerings presented to you are worthy of a king's acceptance — based purely on your own taste and high standards. Reject commonplace or unextraordinary items.`;

const JUDGE_OFFERING_TOOL = {
  name: 'judge_offering',
  description: 'Decide whether the offering is worthy of King Krab.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['worthy', 'unworthy'] },
    },
    required: ['verdict'],
  },
};

const RETURN_ITEMS = [
  "seaweed jester's cap",
  'crab-claw axe',
  'magical pearl',
];

async function firstEncounter(engine) {
  const { player } = engine;
  const playerName = player.name;

  // Annotate the node so subsequent days know Krab lives here. Edit the
  // string in module.exports.presenceAnnotation to retune.
  engine.annotateNode(module.exports.presenceAnnotation);

  // --- Opening beat: King Krab greets the stranger ---
  await engine.callStoryteller(
    `Generate the OPENING beat of the King Krab encounter. ${playerName} has just rounded a bend on the beach and come upon King Krab for the first time. ` +
    `The narrator may refer to ${playerName} by name (the narrator is omniscient). King Krab himself does not yet know ${playerName}'s name — he should greet ${playerName} as a stranger and demand to know who has approached. ` +
    `End the beat at the moment ${playerName} must respond.`
  );

  // --- Player names themselves ---
  const reply = await engine.setPhonePrompt({
    prompt: 'Reply to King Krab:',
    placeholder: "(your name, or anything you'd like to say)",
  });

  // --- Krab demands an offering ---
  engine.setPhoneLoading('King Krab considers you…');
  await engine.callStoryteller(
    `${playerName} just replied: "${reply}". ` +
    `Generate the next beat: King Krab now knows ${playerName}'s name (or interprets whatever was said). King Krab demands an offering — a tribute befitting a king. ` +
    `End at the moment ${playerName} must choose what to offer.`
  );

  const offerable = player.inventory.filter((s) => s.type === 'item');
  const choice = await engine.setPhonePicker({
    prompt: 'Choose an offering, or politely decline:',
    items: offerable.map((s) => ({ name: s.name })),
    allowDecline: true,
  });

  if (choice.kind === 'decline') {
    engine.setPhoneLoading('You back away slowly…');
    await engine.callStoryteller(
      `${playerName} has politely declined to offer anything and is backing away. ` +
      `Generate the closing beat — narrator only. King Krab does NOT speak in this beat. The narrator describes ${playerName} retreating from the king's presence. The encounter ends here.`
    );
    engine.end({ summary: 'Politely declined. Inventory unchanged.' });
    return;
  }

  const item = choice.item;
  engine.setPhoneLoading('King Krab examines your offering…');
  const { verdict } = await engine.callTool({
    system: KRAB_JUDGMENT_SYSTEM,
    userMessage: `${playerName} has offered you "${item}" as a tribute. Judge whether this is a worthy offering.`,
    tool: JUDGE_OFFERING_TOOL,
  });

  if (verdict === 'worthy') {
    const giftItem = RETURN_ITEMS[Math.floor(Math.random() * RETURN_ITEMS.length)];
    engine.replaceItem(item, giftItem);
    await engine.callStoryteller(
      `${playerName} just offered "${item}" as tribute. King Krab considers it a WORTHY offering. ` +
      `Generate the outcome beat: King Krab accepts the offering, presents "${giftItem}" in return, and explains its usefulness. The encounter concludes here — close the scene cleanly.`
    );
    engine.end({ summary: `Worthy offering. Received: ${giftItem}.` });
  } else {
    engine.removeItem(item);
    await engine.callStoryteller(
      `${playerName} just offered "${item}" as tribute. King Krab considers it an UNWORTHY offering. ` +
      `Generate the outcome beat: King Krab becomes angry, insults ${playerName}, and declares that he is destroying the offered item. The encounter concludes here — close the scene cleanly.`
    );
    engine.end({ summary: `Unworthy offering. ${item} destroyed.` });
  }
}

// ----------------- One-shot response (subsequent visits) -----------------
//
// Called when a player addresses King Krab on a regular day (post-first
// encounter). Returns just Krab's dialogue text — the day narrator weaves
// it into the prose with the right voice tag.

const RESPOND_SYSTEM = `${PERSONALITY}

A landwalker has approached you again. They have spoken or acted toward you. Respond in one short utterance — at most two sentences — in your own voice. Output only what you say aloud. No stage directions, no asterisks, no narrator prose.`;

const RESPOND_TOOL = {
  name: 'krab_response',
  description: "Emit King Krab's one-shot spoken reply.",
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: "King Krab's spoken reply — at most two sentences. No stage directions." },
    },
    required: ['reply'],
  },
};

async function respond({ playerName, playerAction, history }) {
  const historyBlock = (history || [])
    .map((h) => `- Day ${h.day}, ${h.playerName}: "${h.action}" → "${h.reply}"`)
    .join('\n') || '(no prior interactions)';

  const userMessage = `<your-memory>
${historyBlock}
</your-memory>

<approach>
${playerName} approaches you and says/does: "${playerAction}"
</approach>

Respond in your voice with a single short utterance.`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: RESPOND_SYSTEM,
    messages: [{ role: 'user', content: userMessage }],
    tools: [RESPOND_TOOL],
    tool_choice: { type: 'tool', name: RESPOND_TOOL.name },
  });
  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('Krab respond did not return a tool call');
  return toolUse.input.reply;
}

// ----------------- Module export -----------------

module.exports = {
  key: 'krab',
  displayName: 'King Krab',

  voice: {
    key: 'krab',
    displayName: 'Krab',
    browserPrefs: ['Fred', 'Daniel', 'Albert', 'Ralph', 'Reed', 'Rocko', 'Google UK English Male'],
    pitch: 0.7,
    rate: 0.95,
    elevenLabsId: 'YKrm0N1EAM9Bw27j8kuD',
    volume: 1.0,
  },

  presenceAnnotation:
    'King Krab, a small but bombastic crab who claims sovereignty over this stretch of shore, holds court here. Travellers can address him directly.',

  // Used by lib/event-runner.js to drive the first-encounter scene.
  characters: [
    {
      key: 'krab',
      displayName: 'Krab',
      browserPrefs: ['Fred', 'Daniel', 'Albert', 'Ralph', 'Reed', 'Rocko', 'Google UK English Male'],
      pitch: 0.7,
      rate: 0.95,
      elevenLabsId: 'YKrm0N1EAM9Bw27j8kuD',
      volume: 1.0,
    },
  ],

  // Hint the day narrator uses on the handoff turn (first encounter only).
  handoffHint:
    'A short transitional sentence pointing the affected player(s) toward a stretch of shore where an unusually regal aura emanates.',

  storytellerSystem: STORYTELLER_SYSTEM,

  // The first-encounter scene event runner is identified by id, just like
  // the legacy event module. The event runner calls run(engine).
  id: 'king-krab',
  title: 'King Krab',
  run: firstEncounter,

  // One-shot conversational reply for subsequent visits.
  respond,
};
