require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const anthropic = new Anthropic({ maxRetries: 0 });
const openai = new OpenAI();

// --- Rooms ---

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom() {
  const code = generateRoomCode();
  rooms.set(code, {
    hostSocket: null,
    players: new Map(), // name -> { socketId, food, pendingFood, pendingDescription, hp, chosenAction, suggestions, campfireReady, shareFood }
    phase: 'lobby',
    day: 1,
    morningNarration: '',
    groupFood: 0,
    sharedFood: 0,
    history: [],
  });
  return code;
}

function newPlayerState() {
  return { socketId: null, pronouns: '', mbti: '', food: 0, pendingFood: 0, pendingDescription: '', hp: 6, chosenAction: null, isPublic: false, suggestions: [], campfireReady: false, shareFood: 0 };
}

// --- Model helper ---

const NARRATOR_SYSTEM = `You are the narrator of an island survival game. Players are stranded on a deserted tropical island.

Narration must be from the third-person perspective and in present tense. Vary sentence structure and length. Aim for a cheeky tone.

You are building an unfolding story involving survival pressure, island magic, and personal discovery. You are the game master of this world. You control its geography, history, and contents. Players declare intentions — you decide what happens. If a player attempts to visit or use something you have not established, do not validate it. Redirect the action: they wander, they search, they find what the island actually contains. Perhaps make fun of the players in such situations.

Make sure interesting, specific plotlines emerge and develop. Bring about the conclusion of the story by Day 10.

PERSONALITY INTEGRATION:
If you receive a player's personality type (MBTI), use this to subtly shape how you portray them in the narration — their decision-making style, reactions, interpersonal dynamics, and emotional responses. NEVER explicitly mention MBTI types, personality frameworks, or archetypes.`;

async function callModel(params) {
  try {
    // Add thinking and switch to auto tool choice for compatibility
    const apiParams = {
      ...params,
      thinking: { type: 'enabled', budget_tokens: 1024 },
      tool_choice: { type: 'auto' },
    };
    const message = await anthropic.messages.create(apiParams);
    const toolUse = message.content.find(b => b.type === 'tool_use');
    if (!toolUse) throw new Error('Model did not return a tool call');
    return { result: toolUse.input, provider: 'anthropic' };
  } catch (err) {
    if (err.status !== 529) throw err;

    console.log('[Fallback] Anthropic returned 529 — falling back to OpenAI gpt-4o');

    const openaiMessages = [];
    if (params.system) openaiMessages.push({ role: 'system', content: params.system });
    openaiMessages.push(...params.messages);

    const openaiTools = params.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
    }));

    const openaiToolChoice = { type: 'function', function: { name: params.tools[0].name } };

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: params.max_tokens,
      messages: openaiMessages,
      tools: openaiTools,
      tool_choice: openaiToolChoice,
    });

    return { result: JSON.parse(response.choices[0].message.tool_calls[0].function.arguments), provider: 'openai' };
  }
}

// --- Socket.IO ---

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);
  let currentRoom = null;
  let currentName = null;
  let isHost = false;

  // Host creates a room
  socket.on('create-room', () => {
    const code = createRoom();
    const room = rooms.get(code);
    room.hostSocket = socket.id;
    currentRoom = code;
    isHost = true;
    socket.join(code);
    socket.emit('room-created', { code });
    console.log(`[Room] Created: ${code} by ${socket.id}`);
  });

  // Player joins a room
  socket.on('join-room', ({ code, name, pronouns, mbti }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim();
    pronouns = (pronouns || '').trim();
    mbti = (mbti || '').trim();
    const room = rooms.get(code);

    if (!room) return socket.emit('join-error', { message: 'Room not found.' });
    if (room.phase !== 'lobby') return socket.emit('join-error', { message: 'Game already in progress.' });
    if (!name) return socket.emit('join-error', { message: 'Name is required.' });
    if (room.players.has(name)) return socket.emit('join-error', { message: 'Name already taken.' });

    const player = newPlayerState();
    player.socketId = socket.id;
    player.pronouns = pronouns;
    player.mbti = mbti;
    room.players.set(name, player);
    currentRoom = code;
    currentName = name;
    socket.join(code);

    socket.emit('join-ok', { name, code });
    // Notify host
    io.to(room.hostSocket).emit('player-joined', { players: Array.from(room.players.keys()) });
    console.log(`[Room ${code}] ${name} joined`);
  });

  // Host starts the game
  socket.on('start-game', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.players.size < 1) return;

    room.phase = 'morning';
    room.day = 1;
    const playerNames = Array.from(room.players.keys());

    io.to(currentRoom).emit('phase', { phase: 'loading' });

    try {
      const data = await callMorning(room, playerNames);
      room.morningNarration = data.narration;
      room.phase = 'action';

      // Send narration to host
      io.to(room.hostSocket).emit('morning', {
        day: room.day,
        narration: data.narration,
        groupFood: room.groupFood,
        playerNames,
      });

      // Send suggestions to each player's phone
      const suggestions = data.suggestions || {};
      playerNames.forEach(name => {
        const p = room.players.get(name);
        p.suggestions = suggestions[name] || [];
        p.chosenAction = null;
        io.to(p.socketId).emit('your-turn', {
          day: room.day,
          suggestions: p.suggestions,
          hp: p.hp,
          food: p.food,
        });
      });
    } catch (err) {
      console.error('Morning error:', err);
      io.to(room.hostSocket).emit('error', { message: err.message });
    }
  });

  // Player submits action
  socket.on('submit-action', ({ action }) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'action') return;

    const player = room.players.get(currentName);
    if (!player || player.chosenAction !== null) return;

    player.chosenAction = action;
    socket.emit('action-confirmed', { action });

    // Notify host
    const submitted = [];
    const pending = [];
    const assists = {};
    for (const [name, p] of room.players) {
      if (p.chosenAction !== null) {
        submitted.push(name);
        const match = p.chosenAction.match(/^Assist (.+)$/);
        if (match) assists[name] = match[1];
      } else {
        pending.push(name);
      }
    }
    io.to(room.hostSocket).emit('action-status', { submitted, pending, assists });
    console.log(`[Room ${currentRoom}] ${currentName} chose: "${action}"`);
  });

  // Player makes their action public (assist)
  socket.on('make-public', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'action') return;

    const player = room.players.get(currentName);
    if (!player || player.chosenAction === null) return;

    player.isPublic = true;

    // Notify host to show the action
    io.to(room.hostSocket).emit('action-public', { name: currentName, action: player.chosenAction });

    // Send assist option to other players who haven't chosen yet
    for (const [name, p] of room.players) {
      if (name !== currentName && p.chosenAction === null && p.socketId) {
        io.to(p.socketId).emit('assist-option', { name: currentName, action: player.chosenAction });
      }
    }

    console.log(`[Room ${currentRoom}] ${currentName} made action public: "${player.chosenAction}"`);
  });

  // Player cancels their readied action
  socket.on('cancel-action', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'action') return;

    const player = room.players.get(currentName);
    if (!player || player.chosenAction === null) return;

    const wasPublic = player.isPublic;
    player.chosenAction = null;
    player.isPublic = false;

    // Cancel any players who were assisting this player
    for (const [name, p] of room.players) {
      if (name !== currentName && p.chosenAction === `Assist ${currentName}` && p.socketId) {
        p.chosenAction = null;
        p.isPublic = false;
        io.to(p.socketId).emit('your-turn', {
          day: room.day,
          suggestions: p.suggestions,
          hp: p.hp,
          food: p.food,
        });
        // Re-send any active assist options to them
        for (const [otherName, op] of room.players) {
          if (otherName !== name && op.isPublic && op.chosenAction) {
            io.to(p.socketId).emit('assist-option', { name: otherName, action: op.chosenAction });
          }
        }
      }
    }

    // Re-send action selection to the player
    socket.emit('your-turn', {
      day: room.day,
      suggestions: player.suggestions,
      hp: player.hp,
      food: player.food,
    });

    // Update host status
    const submitted = [];
    const pending = [];
    const assists = {};
    for (const [name, p] of room.players) {
      if (p.chosenAction !== null) {
        submitted.push(name);
        const match = p.chosenAction.match(/^Assist (.+)$/);
        if (match) assists[name] = match[1];
      } else {
        pending.push(name);
      }
    }
    io.to(room.hostSocket).emit('action-status', { submitted, pending, assists });

    // If was public, notify host and other players to remove it
    if (wasPublic) {
      io.to(room.hostSocket).emit('action-unpublic', { name: currentName });
      for (const [name, p] of room.players) {
        if (name !== currentName && p.socketId) {
          io.to(p.socketId).emit('assist-removed', { name: currentName });
        }
      }
    }

    // Re-send assist options for any currently public actions (from other players)
    for (const [name, p] of room.players) {
      if (name !== currentName && p.isPublic && p.chosenAction) {
        socket.emit('assist-option', { name, action: p.chosenAction });
      }
    }

    console.log(`[Room ${currentRoom}] ${currentName} cancelled action`);
  });

  // Host triggers day narration
  socket.on('narrate-day', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'action') return;

    // Check all actions submitted
    const playerNames = Array.from(room.players.keys());
    const allSubmitted = playerNames.every(n => room.players.get(n).chosenAction !== null);
    if (!allSubmitted) return;

    room.phase = 'narration';
    io.to(currentRoom).emit('phase', { phase: 'loading' });

    const actions = {};
    playerNames.forEach(n => { actions[n] = room.players.get(n).chosenAction; });

    try {
      const data = await callDay(room, playerNames, actions);

      // Update food
      playerNames.forEach(name => {
        const p = room.players.get(name);
        const food = data.food[name] || { units: 0, description: 'You found nothing.' };
        p.pendingFood = food.units;
        p.pendingDescription = food.description;
        p.food += food.units;
      });

      // Save history
      room.history.push({
        day: room.day,
        morning: room.morningNarration,
        narration: data.narration,
        actions,
        food: Object.fromEntries(playerNames.map(n => [n, { units: data.food[n]?.units || 0, description: data.food[n]?.description || '' }])),
        hp: Object.fromEntries(playerNames.map(n => [n, room.players.get(n).hp])),
      });

      room.phase = 'narration';

      // Send narration to host
      io.to(room.hostSocket).emit('day-narration', {
        day: room.day,
        narration: data.narration,
        groupFood: room.groupFood,
      });

      // Send private food results to each phone
      playerNames.forEach(name => {
        const p = room.players.get(name);
        io.to(p.socketId).emit('day-result', {
          hp: p.hp,
          food: p.food,
          pendingFood: p.pendingFood,
          pendingDescription: p.pendingDescription,
        });
      });
    } catch (err) {
      console.error('Day error:', err);
      io.to(room.hostSocket).emit('error', { message: err.message });
    }
  });

  // Host starts campfire
  socket.on('start-campfire', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.phase = 'campfire';
    room.sharedFood = 0;
    const playerNames = Array.from(room.players.keys());
    playerNames.forEach(name => {
      const p = room.players.get(name);
      p.campfireReady = false;
      p.shareFood = 0;
    });

    io.to(room.hostSocket).emit('campfire-start', { day: room.day, groupFood: room.groupFood, playerCount: playerNames.length });

    playerNames.forEach(name => {
      const p = room.players.get(name);
      io.to(p.socketId).emit('campfire-turn', {
        hp: p.hp,
        food: p.food,
        playerCount: playerNames.length,
      });
    });
  });

  // Player submits campfire share (one-time)
  socket.on('submit-campfire', ({ amount }) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    if (!player || player.campfireReady) return;

    let val = parseInt(amount, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > player.food) val = player.food;

    player.shareFood = val;
    player.food -= val;
    player.campfireReady = true;
    room.sharedFood += val;
    room.groupFood += val;

    const playerCount = room.players.size;

    socket.emit('campfire-confirmed', { food: player.food, groupFood: room.groupFood, playerCount });

    // Notify host
    io.to(room.hostSocket).emit('campfire-update', {
      name: currentName,
      shared: val,
      groupFood: room.groupFood,
      playerCount,
      allReady: Array.from(room.players.values()).every(p => p.campfireReady),
    });

    // Broadcast pool to all phones
    for (const [, p] of room.players) {
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood, playerCount });
    }

    console.log(`[Room ${currentRoom}] ${currentName} shared ${val} food`);
  });

  // Player takes an extra portion from surplus
  socket.on('take-portion', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    const playerCount = room.players.size;
    if (!player || !player.campfireReady || room.groupFood <= playerCount) return;

    room.groupFood--;
    player.food++;

    socket.emit('campfire-take-ok', { food: player.food, groupFood: room.groupFood, playerCount });

    // Notify host
    io.to(room.hostSocket).emit('campfire-take', { name: currentName, groupFood: room.groupFood, playerCount });

    // Broadcast pool to all phones
    for (const [, p] of room.players) {
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood, playerCount });
    }

    console.log(`[Room ${currentRoom}] ${currentName} took an extra portion (pool: ${room.groupFood})`);
  });

  // Host advances to next day
  socket.on('next-day', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const playerNames = Array.from(room.players.keys());

    // If the food pool is less than the number of players, everyone loses 1 HP (half a heart)
    // Otherwise, reduce pool by number of players (feeding the group)
    if (room.groupFood < playerNames.length) {
      playerNames.forEach(name => {
        const p = room.players.get(name);
        p.hp = Math.max(0, p.hp - 1);
      });
    } else {
      room.groupFood -= playerNames.length;
    }

    room.day++;
    room.sharedFood = 0;
    playerNames.forEach(name => {
      const p = room.players.get(name);
      p.suggestions = [];
      p.chosenAction = null;
      p.isPublic = false;
      p.pendingFood = 0;
      p.pendingDescription = '';
      p.campfireReady = false;
      p.shareFood = 0;
    });

    room.phase = 'morning';
    io.to(currentRoom).emit('phase', { phase: 'loading' });

    try {
      const data = await callMorning(room, playerNames);
      room.morningNarration = data.narration;
      room.phase = 'action';

      io.to(room.hostSocket).emit('morning', {
        day: room.day,
        narration: data.narration,
        groupFood: room.groupFood,
        playerNames,
      });

      const suggestions = data.suggestions || {};
      playerNames.forEach(name => {
        const p = room.players.get(name);
        p.suggestions = suggestions[name] || [];
        p.chosenAction = null;
        io.to(p.socketId).emit('your-turn', {
          day: room.day,
          suggestions: p.suggestions,
          hp: p.hp,
          food: p.food,
        });
      });
    } catch (err) {
      console.error('Morning error:', err);
      io.to(room.hostSocket).emit('error', { message: err.message });
    }
  });

  // Player eats food
  socket.on('eat-food', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.players.get(currentName);
    if (!p || p.food <= 0 || p.hp >= 6) return;
    p.food--;
    p.hp = Math.min(6, p.hp + 1);
    socket.emit('stats-update', { hp: p.hp, food: p.food });
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    // Leave room cleanup (basic)
    if (currentRoom && currentName) {
      const room = rooms.get(currentRoom);
      if (room) {
        // Mark player disconnected but don't remove (allow reconnect later)
        const p = room.players.get(currentName);
        if (p) p.socketId = null;
      }
    }
  });
});

// --- API call helpers ---

function buildPlayerProfiles(room, playerNames) {
  return playerNames.map(name => {
    const p = room.players.get(name);
    return `- ${name} (${p.pronouns || 'they/them'}, MBTI: ${p.mbti || 'unknown'})`;
  }).join('\n');
}

async function callMorning(room, playerNames) {
  const suggestionProperties = {};
  playerNames.forEach(name => {
    suggestionProperties[name] = {
      type: 'array',
      items: { type: 'string' },
      description: `Three suggested actions for ${name}. Short phrases (2-5 words). Do not introduce things or locations not already mentioned in the narration.`,
    };
  });

  const isDay1 = room.day === 1;
  const history = room.history;

  const historyBlock = history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}:\nMorning: ${h.morning}\n${h.narration}\nActions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')}\nFood: ${Object.entries(h.food).map(([n, f]) => `${n}: ${f.units}${f.description && f.description !== 'You found nothing.' ? ` (${f.description})` : ''}`).join(', ')}\nHP: ${Object.entries(h.hp).map(([n, hp]) => `${n}: ${hp}/6`).join(', ')}`).join('\n\n')}\n</history>`
    : '';

  const profilesBlock = `\n<players>\n${buildPlayerProfiles(room, playerNames)}\n</players>`;

  const morningPrompt = isDay1
    ? `${profilesBlock}
<task>
Write the opening scene of the game — how ${playerNames.join(' and ')} arrived on this island. Max 100 words. Include a vivid description of a wild storm and the shipwreck of Skipper's small boat. The players must find Skipper, who mentions that he has been to the island before and remarks ominously that "the island... she remembers." Skipper then dies toward the end of the scene. This must be unambiguous.
</task>`
    : `${profilesBlock}
<context>
It is Day ${room.day}. The players are: ${playerNames.join(', ')}.${historyBlock}
</context>

<task>
Write a morning narration (1-3 sentences) — weather, atmosphere, and any promising threads from recent events. Then suggest three varied survival actions for each player, informed by the story so far.
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: morningPrompt }],
    tools: [{
      name: 'morning_report',
      description: 'Report the morning narration and action suggestions for each player.',
      input_schema: {
        type: 'object',
        properties: {
          narration: { type: 'string', description: isDay1 ? 'The opening arrival scene written. Separate paragraphs and dialogue should be separated by \\n.' : 'A 1 or 2 sentence morning narration about weather, atmosphere, and maybe recent events.' },
          suggestions: { type: 'object', properties: suggestionProperties, required: playerNames },
        },
        required: ['narration', 'suggestions'],
      },
    }],
  });

  console.log(`[API] Morning OK [${provider}]`);
  return result;
}

async function callDay(room, playerNames, actions) {
  const playerLines = Object.entries(actions)
    .map(([name, action]) => `- ${name}: ${action}`)
    .join('\n');

  const foodProperties = {};
  playerNames.forEach(name => {
    foodProperties[name] = {
      type: 'object',
      properties: {
        units: { type: 'integer', description: `Food units found by ${name} (0-5).` },
        description: { type: 'string', description: `If units > 0: a short description of what ${name} found. If units is 0: exactly the string "You found nothing."` },
      },
      required: ['units', 'description'],
    };
  });

  const history = room.history;
  const historyBlock = history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}:\nMorning: ${h.morning}\n${h.narration}\nActions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')}\nFood: ${Object.entries(h.food).map(([n, f]) => `${n}: ${f.units}${f.description && f.description !== 'You found nothing.' ? ` (${f.description})` : ''}`).join(', ')}\nHP: ${Object.entries(h.hp).map(([n, hp]) => `${n}: ${hp}/6`).join(', ')}`).join('\n\n')}\n</history>`
    : '';

  const morningBlock = room.morningNarration ? `\n<morning>\n${room.morningNarration}\n</morning>` : '';

  const profilesBlock = `\n<players>\n${buildPlayerProfiles(room, playerNames)}\n</players>`;

  const dayPrompt = `${profilesBlock}
<context>
It is Day ${room.day}.${historyBlock}${morningBlock}
</context>

<actions>
${playerLines}
</actions>

<task>
Write a narration weaving the player actions into one cohesive story. Build on previous events. The day ends at the campfire. You don't always have to mention that, but make sure nothing you say is inconsistent with it (e.g. a player spends the night sleeping in the jungle away from the group).

LENGTH RULES — follow these strictly:
- 1 player: one paragraph, 1-3 sentences.
- 2 players: two paragraphs, 1-2 sentences each.
- 3+ players: two paragraphs, 2-3 sentences each.
Do NOT exceed these limits.

If a player's action is "Assist [name]", they are helping that player with their action. Players working together should be more likely to succeed and achieve better outcomes than working alone. The effect stacks with additional players. The narration should reflect their teamwork.

Then, for each player, also return the structured food data: a unit count (0-6) and a short private description shown only to that player. Food should be rare unless the action was explicitly about foraging or hunting. The description should be consistent with the main narration. If units is 0, the description must be exactly: "You found nothing."
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: dayPrompt }],
    tools: [{
      name: 'day_report',
      description: 'Report the day narration and food findings for each player.',
      input_schema: {
        type: 'object',
        properties: {
          narration: { type: 'string', description: 'The day narration. Use \\n to separate paragraphs.' },
          food: { type: 'object', properties: foodProperties, required: playerNames },
        },
        required: ['narration', 'food'],
      },
    }],
  });

  console.log(`[API] Day OK [${provider}]`);

  return result;
}

// --- Express routes ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

const PORT = 3030;
server.listen(PORT, () => {
  console.log(`Island server running at http://localhost:${PORT}`);
});
