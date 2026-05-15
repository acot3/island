// ============================================================
// Event runner
//
// Drives a scene event (multi-beat dialogue with player choices). Each event
// module exports an async `run(engine)` function. The runner builds an
// engine that wraps:
//   - Anthropic calls for storyteller beats and tool judgments.
//   - Socket emits to the host (scene prose) and the triggering player's
//     phone (custom UI), with promises that resolve when the phone replies.
//   - Inventory mutation hooks against the room's player record.
//
// Phase model: while an event runs, room.phase === 'event' and
// room.activeEvent is set. The runner listens for 'event-input' messages
// from the player; the server's central socket handler routes those to
// room.activeEvent.pendingResolver.
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');
const { annotateNode, replaceNodeAnnotations } = require('./map');

const anthropic = new Anthropic({ maxRetries: 1 });

const DEFAULT_MODEL = 'claude-sonnet-4-6';

function buildEmitBeatTool(voiceKeys) {
  return {
    name: 'emit_beat',
    description: 'Emit the next beat of the host-screen script as an ordered list of voice segments.',
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
        },
        scene_complete: {
          type: 'boolean',
          description: 'Set true if this beat naturally closes the scene.',
        },
      },
      required: ['segments'],
    },
  };
}

// Run a scene event end-to-end. Returns when event.run() returns. The
// caller is responsible for setting room.phase before calling and clearing
// it after.
async function runEvent({ room, event, player, io }) {
  const voiceKeys = ['narrator', ...event.characters.map((c) => c.key)];
  const emitBeatTool = buildEmitBeatTool(voiceKeys);
  const storytellerMessages = [];
  let lastToolUseId = null;

  // Buffered mode: emits go to a queue until release() is called. Lets us
  // start fetching the first beat in parallel with day narration so the
  // event is ready the instant the host clicks Proceed.
  let released = false;
  const buffer = [];
  function flushOne(item) {
    if (item.kind === 'beat') {
      if (room.hostSocket) {
        io.to(room.hostSocket).emit('event-beat', {
          eventId: event.id, segments: item.segments,
          // When true, the host clears the on-screen scene prose before
          // rendering this beat — a "page turn" rather than an append.
          replace: !!item.replace,
          // When true, the host signals back with event-render-complete
          // after this beat actually paints. The server uses that signal
          // to gate post-scene actions (e.g. broadcasting game-won).
          sceneComplete: !!item.sceneComplete,
        });
      }
      const flat = item.segments.map((s) => s.text).join(' ').trim();
      if (flat) room.narrative += flat + '\n\n';
    } else if (item.kind === 'phone') {
      if (player.socketId) io.to(player.socketId).emit('event-phone', item.payload);
    } else if (item.kind === 'host-status') {
      if (room.hostSocket) io.to(room.hostSocket).emit('event-status', { text: item.text });
    }
  }
  function release() {
    if (released) return;
    released = true;
    for (const item of buffer) flushOne(item);
    buffer.length = 0;
  }
  // Surface the release function on the active-event handle so the host's
  // proceed-event handler can flip it.
  if (!room.activeEvent) room.activeEvent = {};
  room.activeEvent.release = release;

  // Send a phone payload now (or buffer it until release) and wait for the
  // player's reply via the central 'event-input' handler. The payload is
  // also stashed on the active-event handle as `pendingPhone` so the server
  // can re-send it verbatim if the player's phone reconnects mid-scene.
  function phoneAwait(payload, hostStatus) {
    return new Promise((resolve) => {
      room.activeEvent.pendingPhone = payload;
      room.activeEvent.pendingResolver = (value) => {
        room.activeEvent.pendingPhone = null;
        resolve(value);
      };
      // Optional host-screen status line shown while the player answers
      // (e.g. "Jack is speaking with Skipper…"). Buffered ahead of the phone
      // item so it lands in order, right after the beat that precedes it.
      if (hostStatus) {
        const statusItem = { kind: 'host-status', text: hostStatus };
        if (released) flushOne(statusItem);
        else buffer.push(statusItem);
      }
      const item = { kind: 'phone', payload };
      if (released) flushOne(item);
      else buffer.push(item);
    });
  }

  const engine = {
    player,
    room,

    // --- AI ----------------------------------------------------------------

    async callStoryteller(instruction, { replace = false } = {}) {
      // Each beat is a tool_use; we ack the prior one with a tool_result.
      if (lastToolUseId) {
        storytellerMessages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: lastToolUseId, content: 'ok' },
            { type: 'text', text: instruction },
          ],
        });
      } else {
        storytellerMessages.push({ role: 'user', content: instruction });
      }
      const result = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 1024,
        system: event.storytellerSystem,
        messages: storytellerMessages,
        tools: [emitBeatTool],
        tool_choice: { type: 'tool', name: 'emit_beat' },
      });
      const toolUse = result.content.find((b) => b.type === 'tool_use');
      if (!toolUse) throw new Error('Storyteller did not emit a beat');
      storytellerMessages.push({ role: 'assistant', content: result.content });
      lastToolUseId = toolUse.id;
      const sceneComplete = !!toolUse.input.scene_complete;
      // Apply the event's per-voice audio tags (e.g. ElevenLabs expressive
      // tags for a character voice). The tag goes into a separate `ttsText`
      // field — `text` stays clean so it drives the host-screen prose and
      // the canonical narrative without the bracketed tags showing. The
      // host uses `ttsText` only for the ElevenLabs request. Tagged onto a
      // COPY so the storyteller's own conversation history stays clean too.
      //
      // Defensive: the model occasionally returns `segments` as a STRING
      // containing a stringified JSON array, rather than a real array.
      // Try to recover it before falling back to a single narrator segment.
      const rawSegments = toolUse.input.segments;
      let parsedSegments = null;
      if (Array.isArray(rawSegments)) {
        parsedSegments = rawSegments;
      } else if (typeof rawSegments === 'string') {
        try {
          const parsed = JSON.parse(rawSegments);
          if (Array.isArray(parsed)) parsedSegments = parsed;
        } catch (_) { /* fall through to fallback */ }
      }

      const voiceTags = event.voiceTags || {};
      let segments;
      if (parsedSegments) {
        segments = parsedSegments.map((s) => {
          const tag = voiceTags[s.voice];
          return tag ? { ...s, ttsText: `${tag}${s.text}` } : s;
        });
      } else {
        console.error(
          `[callStoryteller] segments not recoverable as an array: ${JSON.stringify(toolUse.input).slice(0, 500)}`
        );
        const fallbackText = typeof toolUse.input.narration === 'string'
          ? toolUse.input.narration
          : '(the storyteller returned a malformed beat; the scene continues)';
        segments = [{ voice: 'narrator', text: fallbackText }];
      }
      // Auto-emit the beat to the host so events can call callStoryteller
      // without remembering to also call emitBeat. `replace` turns the beat
      // into a page turn (clears prior scene prose on the host).
      // `sceneComplete` flows through so the host can recognize the final
      // beat and signal back when it has rendered.
      engine.emitBeat(segments, { replace, sceneComplete });
      return { segments, sceneComplete };
    },

    async callTool({ system, userMessage, tool, max_tokens = 256 }) {
      const result = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens,
        system,
        messages: [{ role: 'user', content: userMessage }],
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
      });
      const toolUse = result.content.find((b) => b.type === 'tool_use');
      if (!toolUse) throw new Error(`Tool "${tool.name}" returned no result`);
      return toolUse.input;
    },

    // --- Host display ------------------------------------------------------

    emitBeat(segments, { replace = false, sceneComplete = false } = {}) {
      const item = { kind: 'beat', segments, replace, sceneComplete };
      if (released) flushOne(item);
      else buffer.push(item);
    },

    // --- Phone I/O ---------------------------------------------------------

    setPhoneLoading(text) {
      const payload = { kind: 'loading', payload: { text } };
      // Stash so a mid-scene reconnect restores the loading state too.
      room.activeEvent.pendingPhone = payload;
      const item = { kind: 'phone', payload };
      if (released) flushOne(item);
      else buffer.push(item);
    },

    setPhonePicker({ prompt, items, allowDecline = true, hostStatus }) {
      return phoneAwait({ kind: 'picker', payload: { prompt, items, allowDecline } }, hostStatus);
    },

    setPhonePrompt({ prompt, placeholder, hostStatus }) {
      return phoneAwait({ kind: 'prompt', payload: { prompt, placeholder } }, hostStatus);
    },

    // --- Inventory ---------------------------------------------------------

    removeItem(name) {
      const idx = player.inventory.findIndex((s) => s.name === name);
      if (idx < 0) return;
      const slot = player.inventory[idx];
      if (slot.type === 'food' && slot.count > 1) slot.count -= 1;
      else player.inventory.splice(idx, 1);
    },

    replaceItem(oldName, newName) {
      engine.removeItem(oldName);
      // New item from a scene event is treated as an item, count 1.
      player.inventory.push({ name: newName, count: 1, type: 'item' });
    },

    // Annotate the given node (defaults to the active player's current
    // node) with a short authored fact. Subsequent narration + action
    // categorization treat the fact as ground truth about that node.
    annotateNode(text, nodeId) {
      annotateNode(room, nodeId || player.nodeId, text);
    },

    // Replace the entire annotation list on a node. Use this when a
    // stateful fact transitions (e.g. "chest is locked" → "chest is open"
    // and the old statement would contradict the new one).
    replaceNodeAnnotations(texts, nodeId) {
      replaceNodeAnnotations(room, nodeId || player.nodeId, texts);
    },

    // --- End ---------------------------------------------------------------

    end({ summary } = {}) {
      if (room.activeEvent) room.activeEvent.pendingPhone = null;
      if (room.hostSocket) {
        io.to(room.hostSocket).emit('event-end', { eventId: event.id, summary });
      }
      if (player.socketId) {
        io.to(player.socketId).emit('event-phone', { kind: 'end', payload: {} });
      }
    },
  };

  await event.run(engine);
}

module.exports = { runEvent };
