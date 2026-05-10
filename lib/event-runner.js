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
      if (!room.hostSocket) return;
      io.to(room.hostSocket).emit('event-beat', {
        eventId: event.id,
        segments,
      });
      // Also append a flat text version to the canonical narrative so the
      // story-so-far document carries the scene forward into future days.
      const flat = segments.map((s) => s.text).join(' ').trim();
      if (flat) room.narrative += flat + '\n\n';
    },

    // --- Phone I/O ---------------------------------------------------------

    setPhoneLoading(text) {
      if (!player.socketId) return;
      io.to(player.socketId).emit('event-phone', {
        kind: 'loading',
        payload: { text },
      });
    },

    setPhonePicker({ prompt, items, allowDecline = true }) {
      return _phoneAwait(room, player, io, {
        kind: 'picker',
        payload: { prompt, items, allowDecline },
      });
    },

    setPhonePrompt({ prompt, placeholder }) {
      return _phoneAwait(room, player, io, {
        kind: 'prompt',
        payload: { prompt, placeholder },
      });
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

// Send a phone payload and wait for the player's reply. The reply arrives
// via the server's central 'event-input' handler, which calls the resolver
// stored on room.activeEvent.
function _phoneAwait(room, player, io, payload) {
  return new Promise((resolve) => {
    if (!room.activeEvent) room.activeEvent = {};
    room.activeEvent.pendingResolver = resolve;
    if (player.socketId) {
      io.to(player.socketId).emit('event-phone', payload);
    }
  });
}

module.exports = { runEvent };
