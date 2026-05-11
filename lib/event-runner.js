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
        });
      }
      const flat = item.segments.map((s) => s.text).join(' ').trim();
      if (flat) room.narrative += flat + '\n\n';
    } else if (item.kind === 'phone') {
      if (player.socketId) io.to(player.socketId).emit('event-phone', item.payload);
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
  // player's reply via the central 'event-input' handler.
  function phoneAwait(payload) {
    return new Promise((resolve) => {
      room.activeEvent.pendingResolver = resolve;
      const item = { kind: 'phone', payload };
      if (released) flushOne(item);
      else buffer.push(item);
    });
  }

  const engine = {
    player,
    room,

    // --- AI ----------------------------------------------------------------

    async callStoryteller(instruction) {
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
      const segments = toolUse.input.segments;
      const sceneComplete = !!toolUse.input.scene_complete;
      // Auto-emit the beat to the host so events can call callStoryteller
      // without remembering to also call emitBeat.
      engine.emitBeat(segments);
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

    emitBeat(segments) {
      const item = { kind: 'beat', segments };
      if (released) flushOne(item);
      else buffer.push(item);
    },

    // --- Phone I/O ---------------------------------------------------------

    setPhoneLoading(text) {
      const item = { kind: 'phone', payload: { kind: 'loading', payload: { text } } };
      if (released) flushOne(item);
      else buffer.push(item);
    },

    setPhonePicker({ prompt, items, allowDecline = true }) {
      return phoneAwait({ kind: 'picker', payload: { prompt, items, allowDecline } });
    },

    setPhonePrompt({ prompt, placeholder }) {
      return phoneAwait({ kind: 'prompt', payload: { prompt, placeholder } });
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

    // --- End ---------------------------------------------------------------

    end({ summary } = {}) {
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
