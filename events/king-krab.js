// ============================================================
// King Krab event — v0.5 port
//
// Self-contained scene module. Exported as CommonJS for server-side use by
// lib/event-runner.js. Uses the engine API (no direct DOM access).
// ============================================================

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival storytelling game. Players are stranded on an unfamiliar tropical island. You are running a single scene encounter with a recurring character — King Krab.

Each call, you emit ONE beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats.

A beat is an ordered array of voice segments. Two voices are available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Match the prose style of Ernest Hemingway.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

KRAB voice:
- King Krab himself, speaking aloud to the player.
- He believes the island herself chose him as king of the crabs and that he thereby exercises a divine right to rule. He demands deference. His manner is over-blown, bombastic, theatrical.
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

module.exports = {
  id: 'king-krab',
  title: 'King Krab',

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

  storytellerSystem: STORYTELLER_SYSTEM,

  // One-sentence shape the day narrator should aim for when handing off
  // into this scene. Tonal, never literal — the narrator adapts to context.
  handoffHint:
    'A short transitional sentence pointing the affected player(s) toward a stretch of shore where an unusually regal aura emanates.',

  async run(engine) {
    const { player } = engine;
    const playerName = player.name;

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

    // --- Player picks an item or declines ---
    const offerable = player.inventory.filter((s) => s.type === 'item');
    const choice = await engine.setPhonePicker({
      prompt: 'Choose an offering, or politely decline:',
      items: offerable.map((s) => ({ name: s.name })),
      allowDecline: true,
    });

    // --- Decline path ---
    if (choice.kind === 'decline') {
      engine.setPhoneLoading('You back away slowly…');
      await engine.callStoryteller(
        `${playerName} has politely declined to offer anything and is backing away. ` +
        `Generate the closing beat — narrator only. King Krab does NOT speak in this beat. The narrator describes ${playerName} retreating from the king's presence. The encounter ends here.`
      );
      engine.end({ summary: 'Politely declined. Inventory unchanged.' });
      return;
    }

    // --- Offer path: judge it ---
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
  },
};
