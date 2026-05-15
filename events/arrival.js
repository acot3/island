// ============================================================
// Arrival — the opening scene event
//
// Played once at game start, in place of Day 1's morning narration. A
// storm has wrecked Skipper's small boat against the island; the party
// washes ashore and finds Skipper himself, gravely injured. He has been
// here before. He does not survive the scene — but with his last breath
// he points the party at the heart of the island.
//
// Shape matches the current event harness (lib/event-runner.js): the
// module exports `id`, `characters`, `storytellerSystem`, and `run(engine)`.
// Skipper is a scene-only character — he dies here and never recurs, so
// there is no persistent character module for him, just a voice config.
// ============================================================

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival storytelling game. You are running the OPENING scene of the game: one or more players has been shipwrecked on a mysterious island.

The scene has one character besides the narrator — SKIPPER, the boatman whose small boat has just been wrecked in the storm. Skipper has been to this island before. He is gravely injured in the wreck and will not survive the scene.

Each call, you emit ONE beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the players must make their next choice, or at scene close for terminal beats.

A beat is an ordered array of voice segments. Two voices are available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Match the prose style of Ernest Hemingway.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

SKIPPER voice:
- Skipper himself, speaking aloud. Weathered, plain-spoken, a man who has seen too much. In this scene he is weak and failing — his lines are short and come hard.
- Output only what he says aloud. No stage directions, asterisks, or roleplay action descriptions.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The players' turn belongs to the players. Stop at the players' next choice (or at scene close for terminal beats).

BREVITY: Each beat is limited to 120 words total across all segments — punchy and evocative, not expansive.`;

async function run(engine) {
  const { player, room } = engine;
  const playerName = player.name;
  const roster = Array.from(room.players.entries()).filter(([, p]) => !p.dead);
  const names = roster.map(([n]) => n);
  const rosterLine = roster
    .map(([n, p]) => `${n}${p.pronouns ? ` (${p.pronouns})` : ''}`)
    .join(', ');
  const solo = names.length === 1;
  const partyList = solo
    ? playerName
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  // Singular vs. plural phrasing — a solo game must not be narrated as a
  // group, or the plural voice bleeds into every later morning narration.
  const isAre = solo ? 'is' : 'are';
  const subject = solo ? `${playerName}` : 'the party';
  const reflexive = solo ? 'themself' : 'themselves';

  // --- Beat 1: the storm, the wreck, finding Skipper ---
  await engine.callStoryteller(
    `Generate the OPENING beat. A wild storm has wrecked Skipper's small boat against this island. ` +
    `${partyList} ${isAre} thrown ashore onto a wide stretch of pale sand, surrounded by debris and cargo from the wreck. ` +
    `The survivor${solo ? ' is' : 's are'}: ${rosterLine}. Use ${solo ? 'this exact name' : 'these exact names'} and the pronouns given — never invent or substitute a name. ` +
    `As ${subject} gather${solo ? 's' : ''} ${reflexive}, ${subject} find${solo ? 's' : ''} Skipper himself in the sand — gravely hurt, not long for the world. ` +
    `Skipper speaks: he has been to this island before, and he remarks, ominously, "the island... she remembers." ` +
    `End the beat at the moment ${subject} must respond to the dying boatman. ` +
    `IMPORTANT: there ${isAre} exactly ${solo ? 'ONE survivor' : `${names.length} survivors`} — never imply a larger group.`
  );

  // --- The party replies to Skipper (primary player drives) ---
  const reply = await engine.setPhonePrompt({
    prompt: 'Skipper lies dying in the sand. What do you say to him?',
    placeholder: '(say anything)',
    hostStatus: `${playerName} is speaking with Skipper…`,
  });

  // --- Beat 2: Skipper's last words, and his death ---
  engine.setPhoneLoading("Skipper's eyes find yours…");
  await engine.callStoryteller(
    `${playerName} just said to Skipper: "${reply}". Have Skipper react briefly to those words. ` +
    `Then, with the last of his strength, Skipper delivers his final, broken words — say them close to verbatim, fragmented, trailing off exactly like this: ` +
    `"There's a way out... Search for... Search the... heart..." ` +
    `His voice fails. Skipper dies. The narrator closes the scene: the storm has passed, ${subject} ${isAre} alone on the island now, and the only thread ${solo ? playerName + ' holds' : 'they hold'} is a dead man's riddle. ` +
    `This beat closes the scene — set scene_complete true.`,
    { replace: true }
  );

  engine.end({ summary: "Skipper dies. His last words: search the heart of the island." });
}

module.exports = {
  id: 'arrival',
  title: 'Arrival',

  // Scene-only character. The host uses this config to route Skipper's
  // TTS; the event runner uses `key` to tag his voice segments.
  characters: [
    {
      key: 'skipper',
      displayName: 'Skipper',
      browserPrefs: ['Daniel', 'Fred', 'Albert', 'Reed', 'Google UK English Male'],
      pitch: 0.85,
      rate: 0.9,
      elevenLabsId: 'y0SYydk17lMbUIUvSf3N',
      // eleven_v3 (alpha) — the expressive model. stability 0.5 ≈ "Natural"
      // mode (Creative is ~0.0, Robust ~1.0). Audio tags aren't being emitted
      // or stripped yet — this is a raw-voice listen test.
      elevenLabsModel: 'eleven_v3',
      elevenLabsSettings: { stability: 0.5, similarity_boost: 0.75, speed: 0.8},
      // Boosted above 1.0 (via Web Audio gain on the host) — his voice clone
      // is recorded quieter than the narrator and needs lifting to match.
      volume: 1.0,
      // A one-second breath after each of Skipper's lines before the next
      // segment plays — the narrator was crowding his dying words.
      pauseAfterMs: 1000,
    },
  ],

  // Per-voice audio tags, prepended to every segment of that voice by the
  // event runner before emit. eleven_v3 performs these; every line Skipper
  // speaks is tagged [dying]. The tag goes to the voice model only — it's
  // kept out of the host-screen prose and the narrative doc.
  voiceTags: {
    skipper: '[dying] [breathless] [fading] ',
  },

  storytellerSystem: STORYTELLER_SYSTEM,
  run,
};
