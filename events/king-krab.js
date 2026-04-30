// ============================================================
// King Krab event
// ============================================================

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival choose-your-own-adventure game. Players are stranded on a deserted tropical island. You are building an unfolding story involving survival pressure, island magic, and personal discovery.

Each call, you emit one beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats. The audience hears your output via text-to-speech.

A beat is an ordered array of voice segments. Two voices are available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Read aloud by TTS — favor prose that sounds natural when spoken.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

KRAB voice:
- King Krab himself, speaking aloud to the players.
- He believes the island herself chose him as king of the crabs and that he thereby exercises a divine right to rule. He demands deference. His manner is over-blown, bombastic, theatrical.
- Output only what he says aloud. No stage directions, asterisks, or roleplay action descriptions.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The player's turn belongs to the player. Stop at the player's next choice (or at scene close for terminal beats).

BREVITY: Each beat is limited to 100 words total across all segments — punchy and evocative, not expansive. Every word is read aloud; keep the audience moving.`;

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
  "crab-claw axe",
  "magical pearl",
];

// ============================================================
// Event-local helper: item picker phone screen
// ============================================================
function pickOffering(engine) {
  return new Promise(resolve => {
    const items = engine.player.inventory
      .map(i => `<div class="item" data-item="${i}">${i}</div>`)
      .join('');
    engine.setPhone(`
      <div class="prompt">Choose an offering, or politely decline:</div>
      <div class="inventory">${items || '<div class="loading">(no items)</div>'}</div>
      <div class="actions">
        <button id="confirm-offer" disabled>Offer selected item</button>
        <button id="decline" class="secondary">Politely decline and back away slowly</button>
      </div>
    `);
    let selected = null;
    document.querySelectorAll('.item').forEach(el => {
      el.onclick = () => {
        document.querySelectorAll('.item').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        selected = el.dataset.item;
        document.getElementById('confirm-offer').disabled = false;
      };
    });
    document.getElementById('confirm-offer').onclick = () => resolve({ kind: 'offer', item: selected });
    document.getElementById('decline').onclick = () => resolve({ kind: 'decline' });
  });
}

// ============================================================
// Event definition
// ============================================================
export default {
  id: 'king-krab',
  title: 'King Krab Event — Prototype',

  characters: [{
    key: 'krab',
    displayName: 'Krab',
    browserPrefs: ['Fred', 'Daniel', 'Albert', 'Ralph', 'Reed', 'Rocko', 'Google UK English Male'],
    pitch: 0.7,
    rate: 0.95,
    elevenLabsId: 'YKrm0N1EAM9Bw27j8kuD',
    volume: 1.0,
  }],

  storytellerSystem: STORYTELLER_SYSTEM,

  async run(engine) {
    const { player } = engine;

    // --- Opening beat: King Krab greets the stranger ---
    {
      const instruction =
        `Generate the OPENING beat of the King Krab encounter. The player ${player.name} has just rounded a bend on the beach and come upon King Krab for the first time. ` +
        `The narrator may refer to ${player.name} by name (the narrator is omniscient). King Krab himself does not yet know ${player.name}'s name — he should greet ${player.name} as a stranger and demand to know who has approached. ` +
        `End the beat at the moment ${player.name} must respond.`;
      const { segments } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);
      engine.playSegments(els); // non-blocking
    }

    // --- Player names themselves ---
    const reply = await engine.askText({
      prompt: 'Reply to King Krab:',
      placeholder: "(your name, or anything you'd like to say)",
    });

    // --- Krab demands an offering ---
    engine.setPhoneLoading('King Krab considers you…');
    {
      const instruction =
        `${player.name} just replied: "${reply}". ` +
        `Generate the next beat: King Krab now knows ${player.name}'s name (or interprets whatever was said). King Krab demands an offering — a tribute befitting a king. ` +
        `End at the moment ${player.name} must choose what to offer.`;
      const { segments } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);
      engine.playSegments(els);
    }

    // --- Player picks an item or declines ---
    const choice = await pickOffering(engine);

    // --- Decline path ---
    if (choice.kind === 'decline') {
      engine.setPhoneLoading('You back away slowly…');
      const instruction =
        `${player.name} has politely declined to offer anything and is backing away. ` +
        `Generate the closing beat — narrator only. King Krab does NOT speak in this beat. The narrator describes ${player.name} retreating from the king's presence and returning the way he came. The encounter ends here.`;
      const { segments } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);
      engine.end(`<strong>Outcome 3 — Politely declined.</strong><br>Inventory unchanged: ${player.inventory.join(', ')}`, 3);
      await engine.playSegments(els);
      return;
    }

    // --- Offer path: judge it ---
    const item = choice.item;
    engine.setPhoneLoading('King Krab examines your offering…');
    const { verdict } = await engine.callTool({
      system: KRAB_JUDGMENT_SYSTEM,
      userMessage: `${player.name} has offered you "${item}" as a tribute. Judge whether this is a worthy offering.`,
      tool: JUDGE_OFFERING_TOOL,
    });

    if (verdict === 'worthy') {
      const giftItem = RETURN_ITEMS[Math.floor(Math.random() * RETURN_ITEMS.length)];
      engine.replaceItem(item, giftItem);
      const instruction =
        `${player.name} just offered "${item}" as tribute. King Krab considers it a WORTHY offering. ` +
        `Generate the outcome beat: King Krab accepts the offering, presents "${giftItem}" in return, and explains its usefulness. The encounter concludes here — close the scene cleanly.`;
      const { segments } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);
      engine.end(
        `<strong>Outcome 1 — Worthy offering.</strong><br>Received: <em>${giftItem}</em><br>Inventory: ${player.inventory.join(', ') || '(empty)'}`,
        1,
      );
      await engine.playSegments(els);
    } else {
      engine.removeItem(item);
      const instruction =
        `${player.name} just offered "${item}" as tribute. King Krab considers it an UNWORTHY offering. ` +
        `Generate the outcome beat: King Krab becomes angry, insults ${player.name}, and declares that he is destroying the offered item. The encounter concludes here — close the scene cleanly.`;
      const { segments } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);
      engine.end(
        `<strong>Outcome 2 — Unworthy offering.</strong><br><em>${item}</em> destroyed.<br>Inventory: ${player.inventory.join(', ') || '(empty)'}`,
        2,
      );
      await engine.playSegments(els);
    }
  },
};
