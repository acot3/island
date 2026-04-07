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

const PLOT_SEEDS = [
  `PLOT SEED — THE CREATURE:
A strange animal seems to be shadowing the party. Some evidence of it MUST be mentioned on Day 2. If the players pursue the creature, the first result is that they just glimpse it. If they pursue it further, they can interact with it (no earlier than Day 3). Once the players get a good look at the creature, the narration MUST hint that, if hunted, it would provide a lot of food. It MUST be ambiguous to the players whether the creature is friendly or a threat: they MUST make the first move. If the players are kind toward the creature, it leads them to the center of the island, where, in a cave, is a glowing red stone that can be used to make requests of the island. Whether and how the island grants these requests is up to you, though. Make it interesting. If the players try to kill the animal, they succeed. Give them each the maximum amount of food that turn but also bestow upon each of them a specific and solitary curse according to their personality (inferred from past actions if no MBTI is provided). The players CANNOT be freed from this curse.

  If the players do not seem interested in this plot seed, let it go. Do not force the narration to revolve around it.`,

  `PLOT SEED — THE STRANGE FLOWER:
A strange flower - large, white, and solitary - is found as soon as a player explores inland. Smelling one gives a player a single magical power. One (and only one) random player per day MUST be sugggested the action "Smell strange flower" once the flower has been EXPLICITLY mentioned in the narration and until someone smells one. A player who has already been granted a power can discern no smell from the flowers. They cannot gain additional powers from them. Here are the possible powers: hold breath infinitely, start fire with your hands, animals don't fear you, cause plants to grow by touching them, invisibility for thirty seconds per day, fly for four minutes at a time, triple physical strength. 

  Besides the aforementioned rules about suggested actions, if the players do not seem interested in this plot seed, let it go. Do not force the narration to revolve around it.`,

  `PLOT SEED — THE OLD CAMP:
There are remnants of a previous camp in the jungle not far from the game's starting point. One (and only one) random player per day MUST be suggested the action "Explore inland" until the camp is found. Once the camp is found, either through that action or a similar one, one (and only one) player per day MUST be given the suggested action "Investigate the camp" until it is investigated through that action or a similar one. When the camp is investigated, two things are found: a magical weapon and a map with directions to the island's center, where, deep in a cave, is a glowing red stone that can be used to make requests of the island. Whether and how the island grants these requests is up to you, though. Make it interesting. The weapon is not related to the stone. It should have an independently interesting power.

  Besides the aforementioned rules about suggested actions, if the players do not seem interested in this plot seed, let it go. Do not force the narration to revolve around it.`,
];

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
    freshWater: false,
    history: [],
    plotSeed: PLOT_SEEDS[Math.floor(Math.random() * PLOT_SEEDS.length)],
    loading: false,
  });
  return code;
}

function newPlayerState() {
  return { socketId: null, pronouns: '', mbti: '', food: 0, pendingFood: 0, pendingDescription: '', hp: 5, chosenAction: null, isPublic: false, suggestions: [], campfireReady: false, shareFood: 0, dead: false, deathDay: null };
}

function alivePlayerNames(room) {
  return Array.from(room.players.keys()).filter(n => !room.players.get(n).dead);
}

function emitGameOver(room) {
  io.to(room.hostSocket).emit('game-over', {});
  for (const [, p] of room.players) {
    if (p.socketId) io.to(p.socketId).emit('game-over', {});
  }
}

// --- Model helper ---

const NARRATOR_SYSTEM_BASE = `You are the narrator of an island survival game. Players are stranded on a deserted tropical island.

Narration must be from the third-person perspective and in present tense. Vary sentence structure and length. This is meant for a party game, so have some fun with it. The tone should be dry and sardonic — think wry observations about the players' questionable survival instincts, not forced jokes. Poke fun at the players regularly through understated commentary on their decisions. Do not use similes or metaphors. No pop culture references. Humor comes from the situation and the characters, not from the narrator being clever.

You are building an unfolding story involving survival pressure, island magic, and personal discovery. You are the game master of this world. You control its geography, history, and contents. Players declare intentions — you decide what happens. If a player attempts to visit or use something you have not established, do not validate it. Redirect the action: they wander, they search, they find what the island actually contains. Perhaps make fun of the players in such situations.

Make sure interesting, specific plotlines emerge and develop. Bring about the conclusion of the story by Day 12.

INJURIES:
This is a dangerous island. Beginning on Day 3, players can lose up to 1 HP per turn from injuries sustained during their actions. Not every action results in injury, but risky or careless actions should have a real chance of harm. Even routine actions can go wrong sometimes, though this should only happen rarely. Report injuries privately for each player. DO NOT INJURE PLAYERS ON DAYS 1 AND 2.

FRESH WATER:
The group needs fresh water to survive. Water sources can be temporary (rain collection, a puddle that dries up) or permanent (a stream, a spring). If no player action results in finding or maintaining water access, the group does not have water. Be realistic about this — water doesn't appear without effort.

PERSONALITY INTEGRATION:
If you receive a player's personality type (MBTI), use this to shape how you portray them in the narration — their decision-making style, reactions, interpersonal dynamics, and emotional responses. Though personality and self-discovery SHOULD be major components of the story, NEVER INCLUDE THE 4-LETTER MBTI TYPE (E.G. INTJ) OR ARCHETYPE (E.G. THE ARCHITECT) IN THE NARRATION. Also, NEVER invent or reference personal histories (e.g. education, employment, personal relationships).`;

function narratorSystem(room) {
  return `${NARRATOR_SYSTEM_BASE}\n\n${room.plotSeed}`;
}

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
    socket.emit('room-created', { code, plotSeed: room.plotSeed });
    console.log(`[Room] Created: ${code} by ${socket.id} | Plot: ${room.plotSeed.split('\n')[0]}`);
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

  // Host reconnects
  socket.on('rejoin-host', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return;

    room.hostSocket = socket.id;
    currentRoom = code;
    isHost = true;
    socket.join(code);
    console.log(`[Room ${code}] Host reconnected`);

    const alive = alivePlayerNames(room);
    const allPlayers = Array.from(room.players.keys());

    // If an API call is in progress, just show loading — the result will
    // emit to the updated hostSocket when it completes
    if (room.loading) {
      socket.emit('phase', { phase: 'loading', day: room.day });
      return;
    }

    switch (room.phase) {
      case 'lobby':
        socket.emit('room-created', { code, plotSeed: room.plotSeed });
        if (allPlayers.length > 0) {
          socket.emit('player-joined', { players: allPlayers });
        }
        break;

      case 'action': {
        socket.emit('morning', {
          day: room.day, narration: room.morningNarration,
          groupFood: room.groupFood, playerNames: alive, rejoin: true,
        });
        const submitted = [], pending = [], assists = {};
        for (const [name, p] of room.players) {
          if (p.dead) continue;
          if (p.chosenAction !== null) {
            submitted.push(name);
            const match = p.chosenAction.match(/^Assist (.+)$/);
            if (match) assists[name] = match[1];
          } else {
            pending.push(name);
          }
        }
        socket.emit('action-status', { submitted, pending, assists });
        for (const [name, p] of room.players) {
          if (p.isPublic && p.chosenAction) {
            socket.emit('action-public', { name, action: p.chosenAction });
          }
        }
        break;
      }

      case 'narration': {
        const lastHistory = room.history[room.history.length - 1];
        socket.emit('day-narration', {
          day: room.day, narration: lastHistory ? lastHistory.narration : '',
          groupFood: room.groupFood, freshWater: room.freshWater, rejoin: true,
        });
        break;
      }

      case 'campfire':
        socket.emit('campfire-start', {
          day: room.day, groupFood: room.groupFood,
          playerCount: alive.length, freshWater: room.freshWater, rejoin: true,
        });
        for (const [name, p] of room.players) {
          if (p.dead || !p.campfireReady) continue;
          socket.emit('campfire-update', {
            name, shared: p.shareFood, groupFood: room.groupFood,
            playerCount: alive.length,
            allReady: alive.every(n => room.players.get(n).campfireReady),
          });
        }
        break;

      case 'ended': {
        const lastH = room.history[room.history.length - 1];
        socket.emit('game-end', { day: room.day, narration: lastH ? lastH.narration : '' });
        break;
      }

      case 'game-over':
        socket.emit('game-over', {});
        break;
    }
  });

  // Player reconnects
  socket.on('rejoin-room', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim();
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(name);
    if (!player) return;

    player.socketId = socket.id;
    currentRoom = code;
    currentName = name;
    socket.join(code);
    console.log(`[Room ${code}] ${name} reconnected`);

    const state = {
      phase: room.phase,
      day: room.day,
      name,
      hp: player.hp,
      food: player.food,
    };

    if (player.dead) {
      state.dead = true;
      state.deathDay = player.deathDay;
      socket.emit('rejoin-state', state);
      return;
    }

    if (room.loading) {
      state.loading = true;
      socket.emit('rejoin-state', state);
      return;
    }

    switch (room.phase) {
      case 'lobby':
        break;

      case 'action':
        state.suggestions = player.suggestions;
        state.chosenAction = player.chosenAction;
        state.isPublic = player.isPublic;
        state.assistOptions = [];
        for (const [otherName, p] of room.players) {
          if (otherName !== name && p.isPublic && p.chosenAction) {
            state.assistOptions.push({ name: otherName, action: p.chosenAction });
          }
        }
        break;

      case 'narration':
        state.pendingFood = player.pendingFood;
        state.pendingDescription = player.pendingDescription;
        state.pendingInjury = player.pendingInjury || 0;
        state.pendingInjuryDescription = player.pendingInjuryDescription || 'No injury.';
        break;

      case 'campfire':
        state.campfireReady = player.campfireReady;
        state.groupFood = room.groupFood;
        state.playerCount = alivePlayerNames(room).length;
        break;

      case 'ended':
      case 'game-over':
        break;
    }

    socket.emit('rejoin-state', state);
  });

  // Host starts the game
  socket.on('start-game', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.players.size < 1) return;

    room.phase = 'morning';
    room.day = 1;
    const playerNames = Array.from(room.players.keys());

    room.loading = true;
    io.to(currentRoom).emit('phase', { phase: 'loading', day: room.day });

    try {
      const data = await callMorning(room, playerNames);
      room.loading = false;
      room.morningNarration = data.narration;
      room.phase = 'action';
      pregenTTS(currentRoom, data.narration);

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
      room.loading = false;
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
    if (!player || player.dead || player.chosenAction !== null) return;

    player.chosenAction = action;
    socket.emit('action-confirmed', { action });

    // Notify host (only alive players)
    const submitted = [];
    const pending = [];
    const assists = {};
    for (const [name, p] of room.players) {
      if (p.dead) continue;
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

    // Update host status (only alive players)
    const submitted = [];
    const pending = [];
    const assists = {};
    for (const [name, p] of room.players) {
      if (p.dead) continue;
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

    // Check all alive players submitted
    const alive = alivePlayerNames(room);
    const allSubmitted = alive.every(n => room.players.get(n).chosenAction !== null);
    if (!allSubmitted) return;

    room.phase = 'narration';
    room.loading = true;
    io.to(currentRoom).emit('phase', { phase: 'loading' });

    const actions = {};
    alive.forEach(n => { actions[n] = room.players.get(n).chosenAction; });

    try {
      const data = await callDay(room, alive, actions);
      room.loading = false;

      // Process narrator-reported deaths
      const narratorDeaths = (data.deaths || []).filter(name => {
        const p = room.players.get(name);
        return p && !p.dead;
      });
      narratorDeaths.forEach(name => {
        const p = room.players.get(name);
        p.dead = true;
        p.deathDay = room.day;
        p.hp = 0;
        if (p.socketId) io.to(p.socketId).emit('you-died', { name, deathDay: room.day });
      });

      // Update fresh water status
      room.freshWater = !!data.freshWater;

      // Update food and injuries (only for alive-after-narration players)
      alive.forEach(name => {
        const p = room.players.get(name);
        if (p.dead) return; // killed by narrator this day
        const food = data.food[name] || { units: 0, description: 'You found nothing.' };
        p.pendingFood = food.units;
        p.pendingDescription = food.description;
        p.food += food.units;

        const injury = (data.injuries && data.injuries[name]) || { hp_loss: 0, description: 'No injury.' };
        const hpLoss = Math.min(1, Math.max(0, injury.hp_loss || 0));
        p.pendingInjury = hpLoss;
        p.pendingInjuryDescription = injury.description || 'No injury.';
        if (hpLoss > 0) {
          p.hp = Math.max(0, p.hp - hpLoss);
        }
      });

      // Save history
      room.history.push({
        day: room.day,
        morning: room.morningNarration,
        narration: data.narration,
        actions,
        food: Object.fromEntries(alive.map(n => [n, { units: data.food[n]?.units || 0, description: data.food[n]?.description || '' }])),
        hp: Object.fromEntries(alive.map(n => [n, room.players.get(n).hp])),
      });

      // Check if all players are dead after narrator deaths
      if (alivePlayerNames(room).length === 0) {
        room.phase = 'game-over';
        // Show the narration first, then game over
        io.to(room.hostSocket).emit('game-over', { narration: data.narration });
        for (const [, p] of room.players) {
          if (p.socketId) io.to(p.socketId).emit('game-over', {});
        }
        return;
      }

      // Day 12: game ends — show final narration + Play Again (no campfire)
      if (room.day >= 12) {
        room.phase = 'ended';
        io.to(room.hostSocket).emit('game-end', { day: room.day, narration: data.narration });
        for (const [, p] of room.players) {
          if (p.socketId) io.to(p.socketId).emit('game-end', { narration: data.narration });
        }
        return;
      }

      room.phase = 'narration';
      pregenTTS(currentRoom, data.narration);

      // Send narration to host
      io.to(room.hostSocket).emit('day-narration', {
        day: room.day,
        narration: data.narration,
        groupFood: room.groupFood,
        freshWater: room.freshWater,
        playerCount: alive.length,
      });

      // Send private food results to each alive phone
      alive.forEach(name => {
        const p = room.players.get(name);
        if (p.dead) return;
        io.to(p.socketId).emit('day-result', {
          hp: p.hp,
          food: p.food,
          pendingFood: p.pendingFood,
          pendingDescription: p.pendingDescription,
          injury: p.pendingInjury || 0,
          injuryDescription: p.pendingInjuryDescription || 'No injury.',
        });
      });
    } catch (err) {
      room.loading = false;
      console.error('Day error:', err);
      io.to(room.hostSocket).emit('error', { message: err.message });
    }
  });

  // Host starts campfire
  socket.on('start-campfire', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.day >= 12) return; // No campfire on Day 12

    room.phase = 'campfire';
    room.sharedFood = 0;
    const alive = alivePlayerNames(room);
    alive.forEach(name => {
      const p = room.players.get(name);
      p.campfireReady = false;
      p.shareFood = 0;
    });

    pregenCampfireTTS(currentRoom);
    io.to(room.hostSocket).emit('campfire-start', { day: room.day, groupFood: room.groupFood, playerCount: alive.length, freshWater: room.freshWater });

    alive.forEach(name => {
      const p = room.players.get(name);
      io.to(p.socketId).emit('campfire-turn', {
        hp: p.hp,
        food: p.food,
        playerCount: alive.length,
      });
    });
  });

  // Player submits campfire share (one-time)
  socket.on('submit-campfire', ({ amount }) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    if (!player || player.dead || player.campfireReady) return;

    let val = parseInt(amount, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > player.food) val = player.food;

    player.shareFood = val;
    player.food -= val;
    player.campfireReady = true;
    room.sharedFood += val;
    room.groupFood += val;

    const alive = alivePlayerNames(room);
    const playerCount = alive.length;

    socket.emit('campfire-confirmed', { food: player.food, groupFood: room.groupFood, playerCount });

    // Notify host
    io.to(room.hostSocket).emit('campfire-update', {
      name: currentName,
      shared: val,
      groupFood: room.groupFood,
      playerCount,
      allReady: alive.every(n => room.players.get(n).campfireReady),
    });

    // Broadcast pool to all alive phones
    alive.forEach(n => {
      const p = room.players.get(n);
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood, playerCount });
    });

    console.log(`[Room ${currentRoom}] ${currentName} shared ${val} food`);
  });

  // Player takes an extra portion from surplus
  socket.on('take-portion', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;

    const player = room.players.get(currentName);
    const alive = alivePlayerNames(room);
    const playerCount = alive.length;
    if (!player || player.dead || !player.campfireReady || room.groupFood <= playerCount) return;

    room.groupFood--;
    player.food++;

    socket.emit('campfire-take-ok', { food: player.food, groupFood: room.groupFood, playerCount });

    // Notify host
    io.to(room.hostSocket).emit('campfire-take', { name: currentName, groupFood: room.groupFood, playerCount });

    // Broadcast pool to all alive phones
    alive.forEach(n => {
      const p = room.players.get(n);
      if (p.socketId) io.to(p.socketId).emit('campfire-pool', { groupFood: room.groupFood, playerCount });
    });

    console.log(`[Room ${currentRoom}] ${currentName} took an extra portion (pool: ${room.groupFood})`);
  });

  // Host advances to next day
  socket.on('next-day', async () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    const alive = alivePlayerNames(room);

    // If the food pool is less than alive players, each alive player loses 1 HP
    // Otherwise, reduce pool by alive player count (feeding the group)
    const starvationDeaths = [];
    if (room.groupFood < alive.length) {
      alive.forEach(name => {
        const p = room.players.get(name);
        p.hp = Math.max(0, p.hp - 1);
      });
    } else {
      room.groupFood -= alive.length;
    }

    // If the group lacks fresh water, each alive player loses 1 HP
    if (!room.freshWater) {
      alive.forEach(name => {
        const p = room.players.get(name);
        p.hp = Math.max(0, p.hp - 1);
      });
    }

    // Check for deaths from starvation/dehydration
    alive.forEach(name => {
      const p = room.players.get(name);
      if (p.hp <= 0) {
        p.dead = true;
        p.deathDay = room.day;
        starvationDeaths.push(name);
      }
    });

    // Notify phones of starvation deaths
    starvationDeaths.forEach(name => {
      const p = room.players.get(name);
      if (p.socketId) io.to(p.socketId).emit('you-died', { name, deathDay: p.deathDay });
    });

    // Check if all players are dead
    if (alivePlayerNames(room).length === 0) {
      room.phase = 'game-over';
      emitGameOver(room);
      return;
    }

    room.day++;
    room.sharedFood = 0;
    // Reset per-day state for all players (alive ones get new turns, dead ones stay inert)
    for (const [, p] of room.players) {
      p.suggestions = [];
      p.chosenAction = null;
      p.isPublic = false;
      p.pendingFood = 0;
      p.pendingDescription = '';
      p.campfireReady = false;
      p.shareFood = 0;
    }

    const aliveNow = alivePlayerNames(room);

    room.phase = 'morning';
    room.loading = true;
    io.to(currentRoom).emit('phase', { phase: 'loading', day: room.day });

    try {
      const data = await callMorning(room, aliveNow, starvationDeaths);
      room.loading = false;
      room.morningNarration = data.narration;
      room.phase = 'action';
      pregenTTS(currentRoom, data.narration);

      io.to(room.hostSocket).emit('morning', {
        day: room.day,
        narration: data.narration,
        groupFood: room.groupFood,
        playerNames: aliveNow,
      });

      const suggestions = data.suggestions || {};
      aliveNow.forEach(name => {
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
      room.loading = false;
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
    if (!p || p.dead || p.food <= 0 || p.hp >= 6) return;
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

async function callMorning(room, playerNames, recentDeaths = []) {
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

  const deathBlock = recentDeaths.length > 0
    ? `\n<deaths>\nThe following players died of starvation during the night: ${recentDeaths.join(', ')}. State this explicitly. This is a notable event and should occupy most of the narration.\n</deaths>`
    : '';

  // End-game pacing instructions
  let endgameBlock = '';
  if (room.day === 9) {
    endgameBlock = `\n<pacing>
This is Day 9, and the game must end at the close of Day 12. If there is not a dramatic plotline that can conclude the game in an exciting or interesting way, introduce that now prominently. If there is already a promising plotline, advance it significantly. Possible endings of the game are (1) all players die or (2) at least one player escapes the island, either by natural or magical means. Both of these should be possible at this point, depending on player choices.
</pacing>`;
  } else if (room.day === 11) {
    endgameBlock = `\n<pacing>
This is Day 11, and the game must end at the close of Day 12. Players will take their penultimate action today. Significantly advance an existing plotline toward a dramatic conclusion. Possible endings of the game are (1) all players die or (2) at least one player escapes the island, either by natural or magical means. Both of these should be possible at this point, depending on player choices.
</pacing>`;
  } else if (room.day >= 12) {
    endgameBlock = `\n<pacing>
This is Day 12, and the game must end at the close of this day. Players will take their final action today. Significantly advance the plot and force a conclusion. Possible endings of the game are (1) all players die or (2) at least one player escapes the island, either by natural or magical means. Both of these should be possible at this point, depending on player choices.
</pacing>`;
  }

  const profilesBlock = `\n<players>\n${buildPlayerProfiles(room, playerNames)}\n</players>`;

  const morningPrompt = isDay1
    ? `${profilesBlock}
<task>
Write the opening scene of the game — how ${playerNames.join(' and ')} arrived on this island. Max 100 words. Include a vivid description of a wild storm and the shipwreck of Skipper's small boat. The players must find Skipper, who mentions that he has been to the island before and remarks ominously that "the island... she remembers." Skipper then dies toward the end of the scene. This must be unambiguous.

  The tone should be wry and understated — dry humor, not forced jokes.
</task>`
    : `${profilesBlock}
<context>
It is Day ${room.day}. The players are: ${playerNames.join(', ')}.${historyBlock}${deathBlock}${endgameBlock}
</context>

<task>
Write a morning narration (1-3 sentences) — weather, atmosphere, and any promising threads from recent events. Then suggest three varied survival actions for each player, informed by the story so far.
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: narratorSystem(room),
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
  const injuryProperties = {};
  playerNames.forEach(name => {
    foodProperties[name] = {
      type: 'object',
      properties: {
        units: { type: 'integer', description: `Food units found by ${name} (0-5).` },
        description: { type: 'string', description: `If units > 0: a short description of what ${name} found. If units is 0: exactly the string "You found nothing."` },
      },
      required: ['units', 'description'],
    };
    injuryProperties[name] = {
      type: 'object',
      properties: {
        hp_loss: { type: 'integer', description: `HP lost by ${name} due to injury this turn. 0 if uninjured, 1 if injured.` },
        description: { type: 'string', description: `If hp_loss > 0: a short description of the injury. If hp_loss is 0: exactly the string "No injury."` },
      },
      required: ['hp_loss', 'description'],
    };
  });

  const history = room.history;
  const historyBlock = history.length > 0
    ? `\n<history>\n${history.map(h => `Day ${h.day}:\nMorning: ${h.morning}\n${h.narration}\nActions: ${Object.entries(h.actions).map(([n, a]) => `${n}: ${a}`).join(', ')}\nFood: ${Object.entries(h.food).map(([n, f]) => `${n}: ${f.units}${f.description && f.description !== 'You found nothing.' ? ` (${f.description})` : ''}`).join(', ')}\nHP: ${Object.entries(h.hp).map(([n, hp]) => `${n}: ${hp}/6`).join(', ')}`).join('\n\n')}\n</history>`
    : '';

  const morningBlock = room.morningNarration ? `\n<morning>\n${room.morningNarration}\n</morning>` : '';

  const profilesBlock = `\n<players>\n${buildPlayerProfiles(room, playerNames)}\n</players>`;

  // Day 12 final resolution has special instructions
  const isFinalDay = room.day === 12;
  const campfireNote = isFinalDay
    ? 'This is the final day. The players have proposed their final actions. Resolve the story, ending with "The End."'
    : 'The day should always end with the players returning to the camp.';

  const dayPrompt = `${profilesBlock}
<context>
It is Day ${room.day}.${historyBlock}${morningBlock}
</context>

<actions>
${playerLines}
</actions>

<task>
Write a narration weaving the player actions into one cohesive story. Build on previous events. The tone should be dry and sardonic — wry observations, not forced jokes. Do not use similes or metaphors. No pop culture references. ${campfireNote}

LENGTH RULES — follow these strictly:
- 1 player: one paragraph, 1-3 sentences.
- 2 players: two paragraphs, 1-2 sentences each.
- 3+ players: two paragraphs, 2-3 sentences each.
Do NOT exceed these limits.${isFinalDay ? ' Exception: on the final day, you may write up to 4 paragraphs to properly conclude the story.' : ''}

If a player's action is "Assist [name]", they are helping that player with their action. Players working together should be more likely to succeed and achieve better outcomes than working alone. The effect stacks with additional players. The narration should reflect their teamwork.

Then, for each player, also return the structured food data: a unit count (0-6) and a short private description shown only to that player. Food should be rare unless the action was explicitly about foraging or hunting. The description should be consistent with the main narration. If units is 0, the description must be exactly: "You found nothing."

For each player, also return injury data: hp_loss (0 or 1) and a short private description. This is a dangerous island — injuries from cuts, falls, animal encounters, and mishaps are fairly common. Risky actions should frequently result in injury. Even safe-seeming actions can go wrong. If hp_loss is 0, the description must be exactly: "No injury."

You may kill players during the narration if the story demands it (e.g. a fatal encounter, sacrifice, or catastrophic failure). If a player dies, include their name in the deaths array. Only kill players when it is dramatically appropriate — not arbitrarily.

Also return whether the group has access to fresh water after this day's events. Water sources can be temporary (e.g. rain collection, a puddle) or permanent (e.g. a stream, a spring). The group ${room.freshWater ? 'currently HAS' : 'currently DOES NOT have'} access to fresh water.
</task>`;

  const { result, provider } = await callModel({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: narratorSystem(room),
    messages: [{ role: 'user', content: dayPrompt }],
    tools: [{
      name: 'day_report',
      description: 'Report the day narration, food findings, and any player deaths.',
      input_schema: {
        type: 'object',
        properties: {
          narration: { type: 'string', description: 'The day narration. Use \\n to separate paragraphs.' },
          food: { type: 'object', properties: foodProperties, required: playerNames },
          injuries: { type: 'object', properties: injuryProperties, required: playerNames, description: 'Injury data for each player. hp_loss is 0 (no injury) or 1 (injured).' },
          deaths: { type: 'array', items: { type: 'string' }, description: 'Names of players who die during this day\'s events. Empty array if no one dies.' },
          freshWater: { type: 'boolean', description: 'Whether the group has access to fresh water after this day\'s events. True if they found, collected, or still have a water source. False if they have no water source.' },
        },
        required: ['narration', 'food', 'injuries', 'deaths', 'freshWater'],
      },
    }],
  });

  console.log(`[API] Day OK [${provider}]`);

  return result;
}

// --- Express routes ---

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- TTS (ElevenLabs) ---

const ELEVENLABS_VOICE_ID = 'wyWA56cQNU2KqUW4eCsI'; // "Clyde"
const ttsCache = new Map(); // roomCode -> Promise<Buffer>

let campfireTTSBuffer = null; // cached globally — same line every game

function pregenCampfireTTS(roomCode) {
  if (campfireTTSBuffer) {
    console.log(`[TTS] Using cached campfire audio for room ${roomCode}`);
    ttsCache.set(roomCode, Promise.resolve(campfireTTSBuffer));
    return;
  }
  // First time: generate and cache globally
  const text = 'The fire crackles. What will you share?';
  const promise = fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.3, similarity_boost: 0.8, speed: 1.0 },
    }),
  })
    .then(resp => {
      if (!resp.ok) throw new Error(`ElevenLabs returned ${resp.status}`);
      return resp.arrayBuffer();
    })
    .then(ab => {
      const buf = Buffer.from(ab);
      campfireTTSBuffer = buf;
      console.log(`[TTS] Campfire audio cached globally (${(buf.length / 1024).toFixed(1)} KB)`);
      return buf;
    })
    .catch(err => {
      console.error(`[TTS] Campfire TTS failed:`, err.message);
      ttsCache.delete(roomCode);
      return null;
    });
  ttsCache.set(roomCode, promise);
}

function pregenTTS(roomCode, text) {
  const truncated = text.replace(/\\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);
  console.log(`[TTS] Pregenerating for room ${roomCode} (${truncated.length} chars)`);
  const promise = fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: truncated,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.3,
        similarity_boost: 0.8,
        speed: 1.0,
      },
    }),
  })
    .then(resp => {
      if (!resp.ok) throw new Error(`ElevenLabs returned ${resp.status}`);
      return resp.arrayBuffer();
    })
    .then(ab => {
      const buf = Buffer.from(ab);
      console.log(`[TTS] Ready for room ${roomCode} (${(buf.length / 1024).toFixed(1)} KB)`);
      return buf;
    })
    .catch(err => {
      console.error(`[TTS] Failed for room ${roomCode}:`, err.message);
      ttsCache.delete(roomCode);
      return null;
    });
  ttsCache.set(roomCode, promise);
}

app.get('/tts/:code', async (req, res) => {
  const promise = ttsCache.get(req.params.code);
  if (!promise) return res.status(404).json({ error: 'No TTS available' });

  const buf = await promise;
  if (!buf) return res.status(500).json({ error: 'TTS failed' });

  ttsCache.delete(req.params.code);
  res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
  res.send(buf);
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

const PORT = 3030;
server.listen(PORT, () => {
  console.log(`Island server running at http://localhost:${PORT}`);
});
