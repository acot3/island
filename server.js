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
  return { socketId: null, food: 0, pendingFood: 0, pendingDescription: '', hp: 6, chosenAction: null, suggestions: [], campfireReady: false, shareFood: 0 };
}

// --- Model helper ---

const NARRATOR_SYSTEM = `You are the narrator of an island survival game. Players are stranded on a deserted tropical island.

Narration must be from the third-person perspective and in present tense. Vary sentence structure and length. Aim for a cheeky tone.

You are building an unfolding story involving survival pressure, island magic, and personal discovery. You are the game master of this world. You control its geography, history, and contents. Players declare intentions — you decide what happens. If a player attempts to visit or use something you have not established, do not validate it. Redirect the action: they wander, they search, they find what the island actually contains. Perhaps make fun of the players in such situations.

Make sure interesting, specific plotlines emerge and develop.`;

async function callModel(params) {
  try {
    const message = await anthropic.messages.create(params);
    const toolUse = message.content.find(b => b.type === 'tool_use');
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

    let openaiToolChoice;
    if (params.tool_choice && params.tool_choice.type === 'tool') {
      openaiToolChoice = { type: 'function', function: { name: params.tool_choice.name } };
    }

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
  socket.on('join-room', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim();
    const room = rooms.get(code);

    if (!room) return socket.emit('join-error', { message: 'Room not found.' });
    if (room.phase !== 'lobby') return socket.emit('join-error', { message: 'Game already in progress.' });
    if (!name) return socket.emit('join-error', { message: 'Name is required.' });
    if (room.players.has(name)) return socket.emit('join-error', { message: 'Name already taken.' });

    const player = newPlayerState();
    player.socketId = socket.id;
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
    if (!room || room.players.size < 2) return;

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
      playerNames.forEach(name => {
        const p = room.players.get(name);
        p.suggestions = data.suggestions[name] || [];
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
    for (const [name, p] of room.players) {
      if (p.chosenAction !== null) submitted.push(name);
      else pending.push(name);
    }
    io.to(room.hostSocket).emit('action-status', { submitted, pending });
    console.log(`[Room ${currentRoom}] ${currentName} chose: "${action}"`);
  });

  // Player makes their action public (assist)
  socket.on('make-public', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'action') return;

    const player = room.players.get(currentName);
    if (!player || player.chosenAction === null) return;

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
        narration: data.narration,
        actions,
        food: Object.fromEntries(playerNames.map(n => [n, data.food[n]?.units || 0])),
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

    io.to(room.hostSocket).emit('campfire-start', { day: room.day, groupFood: room.groupFood });

    playerNames.forEach(name => {
      const p = room.players.get(name);
      io.to(p.socketId).emit('campfire-turn', {
        hp: p.hp,
        food: p.food,
        pendingFood: p.pendingFood,
      });
    });
  });

  // Player submits campfire share
  socket.on('submit-campfire', ({ amount }) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    if (!player || player.campfireReady) return;

    let val = parseInt(amount, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > player.pendingFood) val = player.pendingFood;

    player.shareFood = val;
    player.food -= val;
    player.campfireReady = true;
    room.sharedFood += val;
    room.groupFood += val;

    socket.emit('campfire-confirmed', { shared: val, food: player.food, groupFood: room.groupFood });

    // Notify host
    io.to(room.hostSocket).emit('campfire-update', {
      name: currentName,
      shared: val,
      groupFood: room.groupFood,
      allReady: Array.from(room.players.values()).every(p => p.campfireReady),
    });

    // Broadcast pool to all phones
    for (const [, p] of room.players) {
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood });
    }

    console.log(`[Room ${currentRoom}] ${currentName} shared ${val} food`);
  });

  // Player takes a portion from the communal pool
  socket.on('take-portion', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    if (!player || room.groupFood <= 0) return;

    room.groupFood--;
    player.food++;

    socket.emit('stats-update', { hp: player.hp, food: player.food });

    // Notify host
    io.to(room.hostSocket).emit('campfire-take', { name: currentName, groupFood: room.groupFood });

    // Broadcast pool to all phones
    for (const [, p] of room.players) {
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood });
    }

    console.log(`[Room ${currentRoom}] ${currentName} took a portion (pool: ${room.groupFood})`);
  });

  // Host advances to next day
  socket.on('next-day', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Each day costs 1 HP (half a heart)
    const playerNames = Array.from(room.players.keys());
    playerNames.forEach(name => {
      const p = room.players.get(name);
      p.hp = Math.max(0, p.hp - 1);
    });

    room.day++;
    room.sharedFood = 0;
    playerNames.forEach(name => {
      const p = room.players.get(name);
      p.suggestions = [];
      p.chosenAction = null;
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

      playerNames.forEach(name => {
        const p = room.players.get(name);
        p.suggestions = data.suggestions[name] || [];
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

async function callMorning(room, playerNames) {
  const suggestionProperties = {};
  playerNames.forEach(name => {
    suggestionProperties[name] = {
      type: 'array',
      items: { type: 'string' },
      description: `Three suggested survival actions for ${name}. Short phrases (2-5 words) consistent with the narration so far.`,
    };
  });

  const isDay1 = room.day === 1;
  const history = room.history.slice(-5);

  const historyBlock = history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}: ${h.narration} (Actions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')})`).join('\n')}\n</history>`
    : '';

  const morningPrompt = isDay1
    ? `<task>
Write the opening scene of the game — how ${playerNames.join(' and ')} arrived on this island. Max 100 words. Include a vivid description of a wild storm and the shipwreck of Skipper's small boat. The players must find Skipper, who mentions that he has been to the island before and remarks ominously that "the island... she remembers." Skipper then dies.
</task>`
    : `<context>
It is Day ${room.day}. The players are: ${playerNames.join(', ')}.${historyBlock}
</context>

<task>
Write a morning narration (1 or 2 sentences) — weather, atmosphere, and a thread from recent events if relevant. Then suggest three varied survival actions for each player, informed by the story so far.
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: morningPrompt }],
    tool_choice: { type: 'tool', name: 'morning_report' },
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

  const history = room.history.slice(-5);
  const historyBlock = history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}: ${h.narration} (Actions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')})`).join('\n')}\n</history>`
    : '';

  const morningBlock = room.morningNarration ? `\n<morning>\n${room.morningNarration}\n</morning>` : '';

  const dayPrompt = `<context>
It is Day ${room.day}.${historyBlock}${morningBlock}
</context>

<actions>
${playerLines}
</actions>

<task>
Write a narration (2-4 sentences, 2 paragraphs) weaving both actions into one cohesive story. Build on previous events. The day ends at the campfire, so make sure nothing you say is inconsistent with that.

As part of the narration, decide whether each player found food. Food should be rare unless the action was explicitly about foraging or hunting. The narration should naturally reflect the food outcomes — if someone found food, work it into the story; if not, that should be consistent too.

Then, for each player, also return the structured food data: a unit count (0-5) and a short private description shown only to that player. The description should match what happened in the narration. If units is 0, the description must be exactly: "You found nothing."
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: dayPrompt }],
    tool_choice: { type: 'tool', name: 'day_report' },
    tools: [{
      name: 'day_report',
      description: 'Report the day narration and food findings for each player.',
      input_schema: {
        type: 'object',
        properties: {
          narration: { type: 'string', description: 'A 2-4 sentence (2 paragraphs) shared narration of the day.' },
          food: { type: 'object', properties: foodProperties, required: playerNames },
        },
        required: ['narration', 'food'],
      },
    }],
  });

  console.log(`[API] Day OK [${provider}]`);

  // Consistency check: does the narration contradict the food outcomes?
  const foodSummary = playerNames.map(name => {
    const f = result.food[name] || { units: 0 };
    return `${name}: ${f.units > 0 ? `found ${f.units} food` : 'found no food'}`;
  }).join(', ');

  const consistencyPrompt = `<narration>
${result.narration}
</narration>

<food_outcomes>
${foodSummary}
</food_outcomes>

<task>
Check if the narration contradicts the food outcomes. For example: does the narration say someone found nothing when they actually found food, or vice versa? If there is a contradiction, rewrite the narration to be consistent with the food outcomes while keeping the same tone and style. If there is no contradiction, return the narration unchanged.
</task>`;

  const { result: fixedResult, provider: fixProvider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: NARRATOR_SYSTEM,
    messages: [{ role: 'user', content: consistencyPrompt }],
    tool_choice: { type: 'tool', name: 'consistency_check' },
    tools: [{
      name: 'consistency_check',
      description: 'Return the narration, corrected if needed.',
      input_schema: {
        type: 'object',
        properties: {
          narration: { type: 'string', description: 'The narration, fixed for consistency or unchanged if already consistent.' },
        },
        required: ['narration'],
      },
    }],
  });

  console.log(`[API] Consistency OK [${fixProvider}]`);
  result.narration = fixedResult.narration;

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
