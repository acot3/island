// ============================================================
// Chest — the cave milestone scene
//
// Fires the first time the skeleton-key holder steps into the cave. The
// player is offered a binary choice: use the key, or step back. Using the
// key opens the oak chest and reveals a rolled parchment dense with the
// words "just ask" — the seed for the actual escape. This event does NOT
// end the game; it sets room.chestOpened = true and lets play continue.
//
// On open, the cave node's annotation flips from "chest is sealed" to
// "chest stands open, parchment inside" so the categorizer + day narrator
// keep up. The key stays in the lock (removed from the player's inventory).
// ============================================================

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival storytelling game. You are running a single milestone scene at the heart of the island: a player who carries the skeleton key has descended into the cave and now stands before the oak chest.

Each call, you emit ONE beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats.

Only one voice is available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Match the prose style of Ernest Hemingway.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The player's turn belongs to the player. Stop at the player's next choice (or at scene close for terminal beats).

NAMES: Use the player's exact name and pronouns as given in the instruction. Never invent or substitute a name.

BREVITY: Each beat is limited to 110 words total across all segments — punchy and evocative, not expansive.`;

// Annotation seeded on the cave node at room creation.
const LOCKED_ANNOTATION =
  'The oak chest is sealed shut by a heavy lock. Nothing short of a key will turn it.';
// Annotation that replaces the locked one once the chest event resolves
// with the key. Quoted phrase echoes the parchment so the categorizer +
// narrator can reference it accurately.
const OPENED_ANNOTATION =
  "The oak chest stands open, the skeleton key still in its lock. Inside lay a rolled parchment with the words \"just ask\" written a thousand times.";

async function run(engine) {
  const { player, room } = engine;
  const playerName = player.name;
  const pronouns = player.pronouns || 'they/them';

  // --- Beat 1: approaching the chest ---
  await engine.callStoryteller(
    `Generate the OPENING beat. ${playerName} (${pronouns}) has descended into the cave and now stands before the oak chest. ` +
    `The skeleton key is in ${playerName}'s hand. The cave is cool, echoing, dim. The lock looks old but solid. ` +
    `End the beat at the moment ${playerName} must decide whether to turn the key or step back.`
  );

  // --- Player choice (binary) ---
  const choice = await engine.setPhonePicker({
    prompt: 'You stand before the oak chest, the skeleton key in your hand. What do you do?',
    items: [
      { name: 'Use the skeleton key' },
      { name: 'Step back' },
    ],
    allowDecline: false,
    hostStatus: `${playerName} weighs the key in ${possessive(pronouns)} hand…`,
  });

  if (choice.kind !== 'offer' || choice.item === 'Step back') {
    // --- Decline beat: chest stays sealed; scene can re-trigger on re-entry. ---
    await engine.callStoryteller(
      `${playerName} steps back from the chest without turning the key. ` +
      `Generate the closing beat: ${playerName} retreats from the chest; it remains sealed, the lock untouched. ` +
      `Close the scene cleanly — set scene_complete true.`,
      { replace: true }
    );
    engine.end({ summary: 'Stepped back. Chest remains locked.' });
    return;
  }

  // --- Use the key: open the chest, reveal the parchment. ---
  engine.removeItem('skeleton key');
  // Flip the cave's annotation so subsequent narration + the categorizer
  // see the chest as open with parchment, not locked.
  engine.replaceNodeAnnotations([OPENED_ANNOTATION]);
  room.chestOpened = true;

  await engine.callStoryteller(
    `${playerName} turns the skeleton key in the lock. ` +
    `Generate the closing beat: the chest opens. Inside is a single rolled-up piece of parchment. ` +
    `When ${playerName} unrolls it, the same three words are written in a tight hand, over and over, filling the page: "just ask" — written a thousand times. ` +
    `The key stays in the lock. ${playerName} is left with the words and no further instruction. ` +
    `Close the scene cleanly — set scene_complete true.`,
    { replace: true }
  );
  engine.end({ summary: 'Chest opened. Parchment: "just ask" × 1000.' });
}

// "he/him" → "his", "she/her" → "her", everything else → "their".
function possessive(pronouns) {
  const p = (pronouns || '').toLowerCase();
  if (p.startsWith('he')) return 'his';
  if (p.startsWith('she')) return 'her';
  return 'their';
}

module.exports = {
  id: 'chest',
  title: 'The Chest',
  characters: [],
  storytellerSystem: STORYTELLER_SYSTEM,
  run,

  // Constants surfaced so server.js can seed the locked annotation at room
  // creation without duplicating the string.
  LOCKED_ANNOTATION,
  OPENED_ANNOTATION,

  // Day-narrator handoff line for the turn the player enters the cave with
  // the key — the day prose hands off to this scene.
  handoffHint:
    'A short transitional sentence pointing the affected player toward the dim mouth of the cave, where something carved waits in the dark.',
};
