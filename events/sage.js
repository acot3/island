// ============================================================
// Conversation event — TEMPLATE
//
// A flexible back-and-forth with a single character. The scene runs
// up to MAX_TURNS exchanges; the storyteller may end the scene early
// by setting `scene_complete: true` on a beat. On the final turn, the
// instruction explicitly asks for a wind-down + departure beat so the
// close lands in-fiction.
//
// To make this your character, fill in the TODO blocks below.
// ============================================================

const MAX_TURNS = 4;

// TODO: replace with your character's name + voice description for the
// storyteller prompt. The KEY (e.g. 'sage') must match the character.key
// declared further down — that's how the storyteller tags speech segments.
const CHARACTER_KEY = 'sage';
const CHARACTER_DISPLAY_NAME = 'the Sage';

const STORYTELLER_SYSTEM = `You are the storyteller for an island survival choose-your-own-adventure game. Players are stranded on a deserted tropical island. You are building an unfolding story involving survival pressure, island magic, and personal discovery.

Each call, you emit one beat of the host-screen script via the \`emit_beat\` tool. A beat is the unit of action between player choices. It ends at the moment the player must make their next choice, or at scene close for terminal beats. The audience hears your output via text-to-speech.

A beat is an ordered array of voice segments. Two voices are available:

NARRATOR voice:
- Third-person, present tense.
- Vary sentence structure and length.
- Read aloud by TTS — favor prose that sounds natural when spoken.
- Write only flowing prose. Never use asterisks or stage directions. Any character actions must be described in prose, not bracketed off.

${CHARACTER_KEY.toUpperCase()} voice:
- An old hermit who has lived alone on the island longer than anyone remembers.
- He believes the island speaks to those who listen. He values patience and dislikes hurry. He hopes the player is the listener he has been waiting for.
- His speech is slow, measured, full of pauses and oblique metaphors. He rarely answers a question directly.
- Output only what he says aloud. No stage directions, asterisks, or roleplay action descriptions.

CONTINUITY: Prior beats in this conversation are visible as your past tool calls. The audience has already heard them. Never re-establish or repeat what has been said. Pick up where the previous beat left off.

CONSTRAINTS: Do not invent player actions, decisions, dialogue, items, or outcomes. The player's turn belongs to the player. Stop at the player's next choice (or at scene close for terminal beats).

SCENE LENGTH: This is a conversation that may run up to ${MAX_TURNS} exchanges. Pace yourself accordingly. If the conversation reaches a natural close before then, set \`scene_complete: true\` on the final beat to let ${CHARACTER_DISPLAY_NAME} depart in-fiction.

BREVITY: Each beat is limited to 80 words total across all segments — punchy and evocative, not expansive. Every word is read aloud; keep the audience moving.`;

// ============================================================
// Event definition
// ============================================================
export default {
  id: 'sage',
  title: 'Sage Event — Prototype',

  characters: [{
    key: CHARACTER_KEY,
    displayName: CHARACTER_DISPLAY_NAME,
    // TODO: tune voice. browserPrefs is an ordered list of macOS/system voice
    // names to try. pitch/rate adjust browser TTS. elevenLabsId is optional —
    // remove if you're not using ElevenLabs for this character.
    browserPrefs: ['Daniel', 'Oliver', 'Google UK English Male'],
    pitch: 1.0,
    rate: 1.0,
    elevenLabsId: 'uDsPstFWFBUXjIBimV7s',
    volume: 1.0,
  }],

  storytellerSystem: STORYTELLER_SYSTEM,

  async run(engine) {
    const { player } = engine;
    let lastReply = null;
    let endedNaturally = false;

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      const isFinal = turn === MAX_TURNS;

      // Per-turn instruction. The phase hint ("arrival" / "continue" /
      // "wind down") helps the storyteller pace the arc.
      let instruction;
      if (turn === 1) {
        // TODO: describe how the character first appears — where, what
        // they're doing, how they greet ${player.name}.
        instruction =
          `Generate the OPENING beat. ${player.name} has just encountered ${CHARACTER_DISPLAY_NAME} for the first time. ` +
          `The narrator sets the scene. ${CHARACTER_DISPLAY_NAME} greets ${player.name} in their characteristic manner. ` +
          `End the beat at the moment ${player.name} must respond.`;
      } else if (isFinal) {
        instruction =
          `${player.name} just said: "${lastReply}". ` +
          `This is the FINAL exchange (turn ${turn} of ${MAX_TURNS}). Generate ${CHARACTER_DISPLAY_NAME}'s response and have them depart in-fiction — wind the conversation down naturally and have them leave the scene. Close the scene cleanly. Set scene_complete: true.`;
      } else {
        instruction =
          `${player.name} just said: "${lastReply}". ` +
          `Generate ${CHARACTER_DISPLAY_NAME}'s response (turn ${turn} of up to ${MAX_TURNS}). Continue the conversation. ` +
          `End the beat at the moment ${player.name} must respond next. ` +
          `If the conversation has reached a natural close, you may have ${CHARACTER_DISPLAY_NAME} depart and set scene_complete: true.`;
      }

      const { segments, sceneComplete } = await engine.callStoryteller(instruction);
      const els = engine.renderBeat(segments);

      if (sceneComplete || isFinal) {
        engine.end(`<strong>Conversation ended.</strong>`, 1);
        await engine.playSegments(els);
        endedNaturally = true;
        break;
      }

      engine.playSegments(els); // non-blocking — player can read/reply while audio plays

      lastReply = await engine.askText({
        prompt: `Reply to ${CHARACTER_DISPLAY_NAME}:`,
        placeholder: '(say anything)',
      });
      engine.setPhoneLoading(`${CHARACTER_DISPLAY_NAME} considers your words…`);
    }

    if (!endedNaturally) {
      engine.end(`<strong>Conversation ended.</strong>`, 1);
    }
  },
};
