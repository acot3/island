// ============================================================
// Homecoming — the game-ending escape scene
//
// Fires the turn a player makes an aloud request to be allowed off the
// island (categorizer flag escapeRequest, gated behind room.chestOpened).
// The day narrator's handoff sentence has just played: "Meanwhile, [name]
// looks deep within [their] heart and speaks simple words…".
//
// Two beats:
//   1. The narrator opens by QUOTING the player's exact words verbatim,
//      then narrates the island's answer — light, an unwinding, time
//      pulled backward (a soft, hand-waved time travel). The party arrives
//      at a sunny dock, BEFORE the wreck.
//   2. Page-turn. They stand at the dock. Skipper is alive (for him it
//      hasn't happened yet). He is about to sign the surviving party up
//      for a three-hour tour. The player who asked politely declines.
//      Scene closes. Game over (won).
// ============================================================

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival storytelling game. You are running the CLOSING scene of the game: a player, having found a parchment in the heart of the island that read "just ask" a thousand times, has spoken simple words asking to be allowed home. The island answers.

Each call, you emit ONE beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats.

Only one voice is available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Match the prose style of Ernest Hemingway.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The player's turn belongs to the player. Stop at the player's next choice (or at scene close for terminal beats).

NAMES: Use the players' exact names and pronouns as given in the instruction. Never invent or substitute a name.

BREVITY: Each beat is limited to 130 words total across all segments — punchy and evocative, not expansive.`;

async function run(engine) {
  const { player, room } = engine;
  const playerName = player.name;
  const pronouns = player.pronouns || 'they/them';
  const survivors = Array.from(room.players.entries())
    .filter(([, p]) => !p.dead)
    .map(([n]) => n);
  const survivorList = listNames(survivors);
  const requestText = (room.pendingEscape && room.pendingEscape.action) || '';

  // --- Beat 1: the words, the unwinding, the dock ---
  await engine.callStoryteller(
    `The day narrator has just delivered the handoff line: "Meanwhile, ${playerName} looks deep within ${possessive(pronouns)} heart and speaks simple words." ` +
    `Generate the OPENING beat. ` +
    `OPEN with ${playerName}'s spoken request, on its own line, in quotation marks. The player typed: "${requestText}". ` +
    `If that text reads as direct dialogue — a complete spoken sentence, plea, or invocation that ${playerName} would naturally say aloud — quote it VERBATIM, exactly as typed, with no edits. ` +
    `If it reads as a description of the action rather than the words themselves (e.g. something framed in the third person, or beginning with "ask" / "plead with" / "request that"), do NOT quote it. Instead, invent a short, plain-spoken request in ${playerName}'s own voice that matches the intent, and quote that one line. Keep it under twelve words. ` +
    `Either way, the result is a single quoted line, clearly spoken. ` +
    `Then the island answers. Light. The cave, the jungle, the sand all unspool. Time pulls backward — a soft, hand-waved unwinding. Not a portal, not a flash; an unmaking, like a film run in reverse. ` +
    `The survivors (${survivorList}) arrive on a wooden dock under a clear sun. The air smells of salt and creosote. The storm has not happened yet — has, in this place, not yet been. ` +
    `End the beat at the moment they realize where, and when, they are.`
  );

  // --- Beat 2 (page-turn): Skipper alive, three-hour tour, decline ---
  await engine.callStoryteller(
    `Generate the CLOSING beat. ${playerName} (${pronouns}) and the other survivors — ${survivorList} — stand on the dock. SKIPPER is there, alive and unhurt: for him, the wreck has not happened yet and he carries no memory of any of it. ` +
    `He is at his small boat with a clipboard, cheerfully signing the party up for a three-hour tour out around the coast. ` +
    `${playerName} politely declines — scripted, in ${possessive(pronouns)} voice, narrated in prose, no character-voice segment. Make the decline gentle and a little tired, the line of someone who has been somewhere they aren't going to talk about. ` +
    `Skipper takes it in stride. The party walks off the dock together. Close the scene cleanly — set scene_complete true.`,
    { replace: true }
  );

  engine.end({ summary: 'The island let them go. They go home.' });
}

// "he/him" → "his", "she/her" → "her", everything else → "their".
function possessive(pronouns) {
  const p = (pronouns || '').toLowerCase();
  if (p.startsWith('he')) return 'his';
  if (p.startsWith('she')) return 'her';
  return 'their';
}

function listNames(names) {
  if (!names || names.length === 0) return '(no one)';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

module.exports = {
  id: 'homecoming',
  title: 'Homecoming',
  characters: [],
  storytellerSystem: STORYTELLER_SYSTEM,
  run,

  // Day-narrator handoff line — pre-filled with the player's possessive
  // pronoun by the server. The exact wording the user specified.
  handoffHintFor(playerName, pronouns) {
    // End with a period rather than an ellipsis — the narrator runs on the
    // turbo model and renders trailing ellipses as garbled audio. The
    // Proceed click after this line provides the dramatic pause anyway.
    return `End your prose with EXACTLY this transitional sentence, with no additions or rephrasing, and ending in a period: "Meanwhile, ${playerName} looks deep within ${possessive(pronouns)} heart and speaks simple words."`;
  },
};
