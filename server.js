require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const {
  CORNERS,
  NODES, neighborsOf, nodeLabel,
  buildMapPayload, buildLocationPayload,
  distributeScenes, findSceneNode, getNodeView, markItemFound,
} = require('./lib/map');
const { categorizeAction } = require('./lib/categorizer');
const { resolveAction } = require('./lib/resolver');
const { narrateMorning, narrateDay } = require('./lib/narrator');
const { narrateFinding } = require('./lib/findings');

const PLAYER_COLORS = [
  '#5b9eda', '#d65b9e', '#b87bd6', '#f08c42', '#ffffff', '#6a6a6a',
];

const INVENTORY_SIZE = 3;
const MAX_HP = 6; // half-hearts; 6 = 3 full hearts (the renderer's cap)

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'phone.html')));

app.post('/api/tts', async (req, res) => {
  try {
    const { voice_id, text } = req.body || {};
    if (!voice_id || !text) return res.status(400).json({ error: 'voice_id and text required' });
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`, {
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
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[/api/tts] ElevenLabs error', resp.status, errText);
      return res.status(resp.status).send(errText);
    }
    const ab = await resp.arrayBuffer();
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': ab.byteLength });
    res.send(Buffer.from(ab));
  } catch (err) {
    console.error('[/api/tts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
  const room = {
    hostSocket: null,
    players: new Map(), // name -> { socketId, pronouns, mbti, hp, dead, ... }
    phase: 'lobby',     // 'lobby' | 'started' | 'campfire'
    day: 1,
    narrative: '',          // the canonical growing prose document
    currentChunk: null,     // { kind: 'morning' | 'day', day, text }
    narratorBusy: false,    // single-flight guard
    nodeState: null,        // { [nodeId]: { sceneId, foundItems } }
    cache: [],              // stockpile (group inventory) at the campfire —
                            // shape { name, count, type }. Mutated by camp
                            // players via deposit/withdraw.
    meal: [],               // tonight's allocation — the host stages food
                            // here from the stockpile during campfire. Drained
                            // at end-of-day; whatever's there gets consumed.
    gameOver: false,
  };
  distributeScenes(room);
  // The wreckage is the players' arrival point and must sit on a corner.
  // If distribution dropped it on a beach side, swap it with a random corner.
  const wreckageNode = findSceneNode(room, 'wreckage-site');
  if (wreckageNode && !CORNERS.includes(wreckageNode)) {
    const target = CORNERS[Math.floor(Math.random() * CORNERS.length)];
    [room.nodeState[wreckageNode], room.nodeState[target]] =
      [room.nodeState[target], room.nodeState[wreckageNode]];
  }
  rooms.set(code, room);
  return code;
}

function playerSummary(room) {
  return Array.from(room.players.entries()).map(([name, p]) => ({
    name, pronouns: p.pronouns, mbti: p.mbti, color: p.color,
  }));
}

function computeActionStatus(room) {
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
  return { submitted, pending, assists };
}

function emitActionStatus(room) {
  if (!room.hostSocket) return;
  io.to(room.hostSocket).emit('action-status', computeActionStatus(room));
}

// --- Alive / death / feeding helpers ---

function alivePlayerEntries(room) {
  return Array.from(room.players.entries()).filter(([, p]) => !p.dead);
}

function aliveAtWreckage(room) {
  const wreckage = findSceneNode(room, 'wreckage-site');
  if (!wreckage) return [];
  return alivePlayerEntries(room).filter(([, p]) => p.nodeId === wreckage);
}

// Drop HP by `amount` half-hearts, clamped at 0. Marks the player dead and
// fires the side-effects when HP hits 0. Returns true if the player just
// died on this call.
function applyHpLoss(room, name, amount) {
  const p = room.players.get(name);
  if (!p || p.dead) return false;
  p.hp = Math.max(0, p.hp - amount);
  if (p.hp <= 0) {
    p.dead = true;
    p.deathDay = room.day;
    if (p.socketId) {
      io.to(p.socketId).emit('you-died', { name, deathDay: p.deathDay });
    }
    return true;
  }
  return false;
}

function checkGameOver(room) {
  if (room.gameOver) return;
  if (room.phase !== 'started' && room.phase !== 'campfire') return;
  if (room.players.size === 0) return;
  const anyAlive = Array.from(room.players.values()).some((p) => !p.dead);
  if (!anyAlive) {
    room.gameOver = true;
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('game-over', { day: room.day });
    }
  }
}

// Push the cache and derived counters to the host and every player who is
// currently around the fire. Called after every deposit/withdraw so all
// camp views stay in sync.
function countFoodUnits(slots) {
  return slots
    .filter((s) => s.type === 'food')
    .reduce((sum, s) => sum + s.count, 0);
}

function broadcastCampfireState(room) {
  const aliveCount = alivePlayerEntries(room).length;
  const mealUnits = countFoodUnits(room.meal);
  const payload = {
    cache: room.cache,
    meal: room.meal,
    aliveCount,
    mealUnits,
    portionsNeeded: Math.max(0, aliveCount - mealUnits),
  };
  if (room.hostSocket) io.to(room.hostSocket).emit('campfire-state', payload);
  for (const [, p] of aliveAtWreckage(room)) {
    if (p.socketId) io.to(p.socketId).emit('campfire-state', payload);
  }
}

// Add to the cache: food stacks by name, items always open a new slot.
function addToCache(room, name, type, count) {
  if (type === 'food') {
    const existing = room.cache.find((s) => s.type === 'food' && s.name === name);
    if (existing) existing.count += count;
    else room.cache.push({ name, count, type: 'food' });
  } else {
    room.cache.push({ name, count: 1, type: 'item' });
  }
}

// Add to a player's personal inventory: food stacks by name, items always
// open a new slot. Caller is expected to have verified slot availability.
function addToPersonalInventory(player, name, type, count) {
  if (type === 'food') {
    const existing = player.inventory.find(
      (s) => s.type === 'food' && s.name === name
    );
    if (existing) existing.count += count;
    else player.inventory.push({ name, count, type: 'food' });
  } else {
    player.inventory.push({ name, count: 1, type: 'item' });
  }
}

// Feeding rule: tonight's meal must cover every alive player. If meal
// units >= alive count, the meal feeds the group; everything in the meal
// is consumed (excess is wasted). Else nobody eats and every alive player
// loses 1 HP — meal is still cleared (the food was prepared regardless).
// Returns a summary the host can display.
function runFeeding(room) {
  const alive = alivePlayerEntries(room);
  const aliveCount = alive.length;
  const mealUnits = countFoodUnits(room.meal);
  let summary;
  if (mealUnits >= aliveCount && aliveCount > 0) {
    summary = { fed: true, deaths: [] };
  } else {
    const deaths = [];
    for (const [name] of alive) {
      if (applyHpLoss(room, name, 1)) deaths.push(name);
    }
    summary = { fed: false, deaths };
  }
  room.meal = []; // tonight's meal is cooked and gone, either way
  return summary;
}

// Build a snapshot of player profiles passed to every narrator call.
// Dead players are excluded from narration after their death day.
function narratorPlayers(room) {
  return Array.from(room.players.entries())
    .filter(([, p]) => !p.dead)
    .map(([name, p]) => ({ name, pronouns: p.pronouns, mbti: p.mbti }));
}

// Build a snapshot of where every alive player currently is. The narrator
// uses nodeId to judge co-location and biome to describe scenery; it never
// sees the human-readable label, which would leak compass info.
function locationsSnapshot(room) {
  return Array.from(room.players.entries())
    .filter(([, p]) => p.nodeId && !p.dead)
    .map(([name, p]) => ({ name, nodeId: p.nodeId, biome: NODES[p.nodeId].biome }));
}

// Append a chunk of prose to the room's narrative; record it as the current
// chunk so the host's narration panel can show "what just happened".
function appendNarrationChunk(room, kind, text) {
  room.narrative += text;
  room.currentChunk = { kind, day: room.day, text };
  io.to(room.hostSocket).emit('narration-chunk', {
    kind, day: room.day, text, full: room.narrative,
  });
  // Debug: visualize whitespace so we can see whether the AI emitted \n\n.
  io.to(room.hostSocket).emit('narration-debug', {
    kind, day: room.day,
    raw: JSON.stringify(text),
  });
}

// Insert "## Day N" header before each day's first chunk. System-managed.
function ensureDayHeader(room) {
  const header = `## Day ${room.day}\n\n`;
  if (!room.narrative.endsWith(header)) {
    room.narrative += (room.narrative.length === 0 ? '' : '\n\n') + header;
  }
}

async function runMorningNarration(room) {
  if (room.narratorBusy) return;
  room.narratorBusy = true;
  io.to(room.hostSocket).emit('narration-pending', { kind: 'morning', day: room.day });
  try {
    ensureDayHeader(room);
    const { chunk } = await narrateMorning({
      narrative: room.narrative,
      day: room.day,
      players: narratorPlayers(room),
      locations: locationsSnapshot(room),
    });
    appendNarrationChunk(room, 'morning', chunk + '\n\n');
  } catch (err) {
    io.to(room.hostSocket).emit('narration-error', {
      kind: 'morning', day: room.day, error: err.message,
    });
  } finally {
    room.narratorBusy = false;
  }
}

// Build action reports for every player who submitted, running the
// categorizer + resolver for free-text actions in parallel. Move and
// assist actions skip the AI/dice — they only need a label.
async function buildActionReports(room) {
  const tasks = [];
  let anyMoved = false;
  for (const [name, p] of room.players) {
    if (p.dead) continue;
    if (p.chosenAction === null) continue;
    const action = p.chosenAction;
    const fromNodeId = p.nodeId; // capture *before* applying any move
    const fromBiome = NODES[fromNodeId]?.biome;
    const fromLabel = nodeLabel(fromNodeId); // host debug panel only

    if (/^Move to /.test(action)) {
      const target = p.pendingMove;
      if (target && neighborsOf(p.nodeId).includes(target)) {
        p.nodeId = target;
        if (!p.visited) p.visited = new Set();
        p.visited.add(target);
        anyMoved = true;
      }
      p.pendingMove = null;
      tasks.push(Promise.resolve({
        player: name, action, type: 'move',
        fromNodeId, fromBiome,
        nodeId: p.nodeId, biome: NODES[p.nodeId]?.biome,
      }));
      continue;
    }
    if (/^Assist /.test(action)) {
      tasks.push(Promise.resolve({
        player: name, action, type: 'assist',
        nodeId: fromNodeId, biome: fromBiome,
      }));
      continue;
    }

    tasks.push((async () => {
      try {
        const verdict = await categorizeAction({ action, biome: fromBiome });
        const sceneContext = getNodeView(room, fromNodeId);
        const playerContext = {
          inventoryRemaining: INVENTORY_SIZE - p.inventory.length,
          existingFoodNames: p.inventory
            .filter((s) => s.type === 'food')
            .map((s) => s.name),
        };
        const outcome = resolveAction(verdict, sceneContext, playerContext);
        // Commit found items + food to the player's inventory. Items always
        // take a fresh slot and are also removed from the node's pool. Food
        // stacks by name onto an existing slot when the player already
        // carries that kind, otherwise opens a new slot.
        if (outcome.kind === 'search') {
          for (const r of outcome.results) {
            if (!r.success || !r.found) continue;
            if (r.category === 'item') {
              p.inventory.push({ name: r.found, count: 1, type: 'item' });
              markItemFound(room, fromNodeId, r.found);
            } else if (r.category === 'food') {
              const existing = p.inventory.find(
                (s) => s.type === 'food' && s.name === r.found
              );
              if (existing) existing.count += 1;
              else p.inventory.push({ name: r.found, count: 1, type: 'food' });
            }
          }
        }
        // Stream the categorizer result to the host's debug panel as before.
        if (room.hostSocket) {
          io.to(room.hostSocket).emit('categorizer-result', {
            player: name, action, location: fromLabel, result: verdict, outcome,
          });
        }
        // Synthesize a success/reason for the narrator. For search outcomes
        // this is "any hits" → success; the per-category breakdown lives in
        // outcome.results and is not wired through to the narrator yet.
        const summarySuccess = outcome.kind === 'search'
          ? outcome.results.some((r) => r.success)
          : outcome.success;
        const summaryReason = outcome.kind === 'search' ? 'searched' : outcome.reason;
        // A search-intent action — flagged by the categorizer's `seeking`
        // list — is private. Public narrator sees only that the player
        // searched; the private finding narrator handles the outcome.
        const isSearch = (verdict.seeking || []).length > 0;
        const finds = outcome.kind === 'search'
          ? outcome.results
              .filter((r) => r.success && r.found)
              .map((r) => r.found)
          : null;
        return {
          player: name, action, type: 'free',
          nodeId: fromNodeId, biome: fromBiome,
          possible: verdict.possible,
          attribute: verdict.attribute,
          difficulty: verdict.difficulty,
          rationale: verdict.rationale,
          success: summarySuccess,
          reason: summaryReason,
          isSearch,
          finds,
          sceneDescription: sceneContext ? sceneContext.description : null,
        };
      } catch (err) {
        if (room.hostSocket) {
          io.to(room.hostSocket).emit('categorizer-error', {
            player: name, action, error: err.message,
          });
        }
        // Graceful degrade: pass the raw action with no verdict; narrator
        // will treat it like a generic free-text action.
        return {
          player: name, action, type: 'free',
          nodeId: fromNodeId, biome: fromBiome,
          possible: true, success: true, reason: 'rolled',
        };
      }
    })());
  }
  const reports = await Promise.all(tasks);
  if (anyMoved && room.hostSocket) {
    io.to(room.hostSocket).emit('map-state', buildMapPayload(room));
  }
  return reports;
}

async function runDayNarration(room) {
  if (room.narratorBusy) return;
  room.narratorBusy = true;
  io.to(room.hostSocket).emit('narration-pending', { kind: 'day', day: room.day });
  try {
    const actionReports = await buildActionReports(room);

    // Fire the public day narration and each searching player's private
    // finding *in parallel*. Hold every emit until all calls have settled
    // so the host's prose and the phone's prose appear at the same moment —
    // neither sooner than the other.
    const findingCalls = [];
    for (const r of actionReports) {
      if (!r.isSearch) continue;
      const target = room.players.get(r.player);
      if (!target || target.dead || !target.socketId) continue;
      findingCalls.push(
        narrateFinding({
          description: r.sceneDescription,
          action: r.action,
          finds: r.finds || [],
        })
          .then((text) => ({ socketId: target.socketId, text }))
          .catch((err) => {
            console.error(`[Findings] ${r.player}: ${err.message}`);
            return null;
          })
      );
    }

    const [dayResult, findings] = await Promise.all([
      narrateDay({
        narrative: room.narrative,
        day: room.day,
        players: narratorPlayers(room),
        locations: locationsSnapshot(room), // post-move snapshot
        actionReports,
      }),
      Promise.all(findingCalls),
    ]);

    appendNarrationChunk(room, 'day', dayResult.chunk + '\n\n');
    for (const f of findings) {
      if (!f) continue;
      io.to(f.socketId).emit('private-narration', { day: room.day, text: f.text });
    }
    for (const [pname, pp] of room.players) {
      if (pp.socketId && !pp.dead) {
        io.to(pp.socketId).emit('your-location', buildLocationPayload(room, pname));
        io.to(pp.socketId).emit('day-narrated', { day: room.day });
      }
    }
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('day-resolution-options', {
        day: room.day,
        playersAtCamp: aliveAtWreckage(room).map(([name]) => name),
      });
    }
  } catch (err) {
    io.to(room.hostSocket).emit('narration-error', {
      kind: 'day', day: room.day, error: err.message,
    });
  } finally {
    room.narratorBusy = false;
  }
}

// Reset chosen actions, increment day, fire the morning narrator. Phones
// reset their action UI via action-cancelled.
function endDay(room) {
  // HP changes happen at the campfire (or when nobody lit it), not here.
  for (const [name, p] of room.players) {
    p.chosenAction = null;
    p.isPublic = false;
    p.pendingMove = null;
    if (p.socketId) {
      io.to(p.socketId).emit('your-location', buildLocationPayload(room, name));
      io.to(p.socketId).emit('action-cancelled');
    }
  }
  room.day += 1;
  io.to(room.hostSocket).emit('day-changed', { day: room.day });
  for (const [, p] of room.players) {
    if (p.socketId) io.to(p.socketId).emit('day-changed', { day: room.day });
  }
  emitActionStatus(room);
  runMorningNarration(room);
}

function moveActionLabel(fromNodeId, targetNodeId) {
  if (!neighborsOf(fromNodeId).includes(targetNodeId)) return null;
  return `Move to ${nodeLabel(targetNodeId)}`;
}

// --- Sockets ---

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentName = null;
  let isHost = false;

  socket.on('create-room', () => {
    const code = createRoom();
    const room = rooms.get(code);
    room.hostSocket = socket.id;
    currentRoom = code;
    isHost = true;
    socket.join(code);
    socket.emit('room-created', { code });
    console.log(`[Room ${code}] created by host ${socket.id}`);
  });

  socket.on('rejoin-host', ({ code }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return;
    room.hostSocket = socket.id;
    currentRoom = code;
    isHost = true;
    socket.join(code);
    socket.emit('host-state', {
      code, phase: room.phase, day: room.day, players: playerSummary(room),
    });
    if (room.phase === 'started') {
      socket.emit('map-state', buildMapPayload(room));
      socket.emit('action-status', computeActionStatus(room));
      for (const [name, p] of room.players) {
        if (p.isPublic && p.chosenAction) {
          socket.emit('action-public', { name, action: p.chosenAction });
        }
      }
      if (room.currentChunk) {
        socket.emit('narration-chunk', {
          kind: room.currentChunk.kind,
          day: room.currentChunk.day,
          text: room.currentChunk.text,
          full: room.narrative,
        });
      }
    } else if (room.phase === 'campfire') {
      // Replay the campfire view so the host can pick up where it left off.
      socket.emit('map-state', buildMapPayload(room));
      const aliveCount = alivePlayerEntries(room).length;
      const mealUnits = countFoodUnits(room.meal);
      const atCamp = aliveAtWreckage(room);
      socket.emit('campfire-start', {
        day: room.day,
        cache: room.cache,
        meal: room.meal,
        playersAtCamp: atCamp.map(([name]) => name),
        aliveCount,
        mealUnits,
        portionsNeeded: Math.max(0, aliveCount - mealUnits),
      });
    }
    console.log(`[Room ${code}] host reconnected`);
  });

  socket.on('join-room', ({ code, name, pronouns, mbti }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim();
    pronouns = (pronouns || '').trim();
    mbti = (mbti || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) return socket.emit('join-error', { message: 'Room not found.' });
    if (room.phase !== 'lobby') return socket.emit('join-error', { message: 'Game already in progress.' });
    if (!name) return socket.emit('join-error', { message: 'Name is required.' });
    if (room.players.has(name)) return socket.emit('join-error', { message: 'Name already taken.' });

    const color = PLAYER_COLORS[room.players.size % PLAYER_COLORS.length];
    room.players.set(name, {
      socketId: socket.id, pronouns, mbti, color,
      chosenAction: null, isPublic: false, pendingMove: null,
      hp: 5, // half-hearts; 5 = 2½ hearts. -1 per unfed day at the campfire.
      inventory: [], // up to INVENTORY_SIZE slots of { name, count, type }.
                     // Food (type:'food') stacks by name — a slot can hold
                     // multiple daily portions. Items (type:'item') always
                     // count 1 per slot.
      dead: false,
      deathDay: null,
    });
    currentRoom = code;
    currentName = name;
    socket.join(code);

    socket.emit('join-ok', { code, name });
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('players-update', { players: playerSummary(room) });
    }
    console.log(`[Room ${code}] ${name} joined (${pronouns || '—'}, ${mbti || '—'})`);
  });

  socket.on('rejoin-room', ({ code, name }) => {
    code = (code || '').toUpperCase().trim();
    name = (name || '').trim();
    const room = rooms.get(code);
    if (!room) return socket.emit('rejoin-fail', {});
    const player = room.players.get(name);
    if (!player) return socket.emit('rejoin-fail', {});

    player.socketId = socket.id;
    currentRoom = code;
    currentName = name;
    socket.join(code);
    socket.emit('rejoin-state', { code, name, phase: room.phase, day: room.day });
    if (player.dead) {
      socket.emit('you-died', { name, deathDay: player.deathDay });
    } else if (room.phase === 'started' && player.nodeId) {
      socket.emit('your-location', buildLocationPayload(room, name));
      if (player.chosenAction !== null) {
        socket.emit('action-confirmed', {
          action: player.chosenAction,
          isPublic: player.isPublic,
        });
      } else {
        for (const [otherName, p] of room.players) {
          if (otherName !== name && p.isPublic && p.chosenAction) {
            socket.emit('assist-option', { name: otherName, action: p.chosenAction });
          }
        }
      }
    } else if (room.phase === 'campfire' && player.nodeId) {
      // Restore the player's view based on whether they're at the wreckage.
      // At-camp players go back into the deposit/withdraw UI; everyone else
      // stays on the waiting screen.
      socket.emit('your-location', buildLocationPayload(room, name));
      const wreckage = findSceneNode(room, 'wreckage-site');
      if (player.nodeId === wreckage) {
        socket.emit('campfire-turn', {
          day: room.day,
          inventory: player.inventory,
          cache: room.cache,
        });
      } else {
        socket.emit('day-narrated', { day: room.day });
      }
    }
    console.log(`[Room ${code}] ${name} reconnected`);
  });

  socket.on('start-game', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'lobby') return;
    if (room.players.size < 1) return;

    room.phase = 'started';
    room.day = 1;
    room.startNodeId = findSceneNode(room, 'wreckage-site');
    for (const [, p] of room.players) {
      p.nodeId = room.startNodeId;
      p.visited = new Set([room.startNodeId]);
    }
    io.to(currentRoom).emit('game-started', { day: room.day });
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('map-state', buildMapPayload(room));
      emitActionStatus(room);
    }
    for (const [name, p] of room.players) {
      if (p.socketId) {
        io.to(p.socketId).emit('your-location', buildLocationPayload(room, name));
      }
    }
    console.log(`[Room ${currentRoom}] started with ${room.players.size} player(s) at ${room.startNodeId}`);
    runMorningNarration(room);
  });

  socket.on('submit-move', ({ targetNodeId } = {}) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const player = room.players.get(currentName);
    if (!player || player.dead || !player.nodeId) return;
    if (player.chosenAction !== null) return;
    if (!neighborsOf(player.nodeId).includes(targetNodeId)) return;

    const label = moveActionLabel(player.nodeId, targetNodeId);
    if (!label) return;

    player.chosenAction = label;
    player.isPublic = false;
    player.pendingMove = targetNodeId;
    socket.emit('action-confirmed', { action: label, isPublic: false });
    emitActionStatus(room);
    console.log(`[Room ${currentRoom}] ${currentName} chose: "${label}"`);
  });

  socket.on('submit-action', ({ action } = {}) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const player = room.players.get(currentName);
    if (!player || player.dead || player.chosenAction !== null) return;

    const text = typeof action === 'string' ? action.trim() : '';
    if (!text || text.length > 50) return;

    player.chosenAction = text;
    player.isPublic = false;
    socket.emit('action-confirmed', { action: text, isPublic: false });
    emitActionStatus(room);
    console.log(`[Room ${currentRoom}] ${currentName} chose: "${text}"`);
  });

  socket.on('make-public', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const player = room.players.get(currentName);
    if (!player || player.dead || player.chosenAction === null || player.isPublic) return;
    if (/^Assist (.+)$/.test(player.chosenAction)) return;

    player.isPublic = true;
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('action-public', { name: currentName, action: player.chosenAction });
    }
    for (const [name, p] of room.players) {
      if (name !== currentName && p.chosenAction === null && p.socketId) {
        io.to(p.socketId).emit('assist-option', { name: currentName, action: player.chosenAction });
      }
    }
    console.log(`[Room ${currentRoom}] ${currentName} made action public: "${player.chosenAction}"`);
  });

  socket.on('cancel-action', () => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const player = room.players.get(currentName);
    if (!player || player.dead || player.chosenAction === null) return;

    const wasPublic = player.isPublic;
    player.chosenAction = null;
    player.isPublic = false;
    player.pendingMove = null;

    // Cascade-cancel anyone assisting this player
    for (const [name, p] of room.players) {
      if (name === currentName) continue;
      if (p.chosenAction === `Assist ${currentName}`) {
        p.chosenAction = null;
        p.isPublic = false;
        p.pendingMove = null;
        if (p.socketId) {
          io.to(p.socketId).emit('action-cancelled');
          // Re-send still-active assist options from other public players
          for (const [otherName, op] of room.players) {
            if (otherName !== name && op.isPublic && op.chosenAction) {
              io.to(p.socketId).emit('assist-option', { name: otherName, action: op.chosenAction });
            }
          }
        }
      }
    }

    socket.emit('action-cancelled');
    // Re-send active assist options to the cancelling player
    for (const [name, p] of room.players) {
      if (name !== currentName && p.isPublic && p.chosenAction) {
        socket.emit('assist-option', { name, action: p.chosenAction });
      }
    }

    emitActionStatus(room);
    if (wasPublic) {
      if (room.hostSocket) {
        io.to(room.hostSocket).emit('action-unpublic', { name: currentName });
      }
      for (const [name, p] of room.players) {
        if (name !== currentName && p.socketId) {
          io.to(p.socketId).emit('assist-removed', { name: currentName });
        }
      }
    }
    console.log(`[Room ${currentRoom}] ${currentName} cancelled action`);
  });

  socket.on('proceed-day', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const alive = alivePlayerEntries(room);
    if (alive.length === 0) return;
    for (const [, p] of alive) {
      if (p.chosenAction === null) return; // not all alive submitted
    }
    // Lock phones into a loading screen immediately. The day's narration
    // hasn't published yet, but actions are committed and uncancellable.
    // The 'day-narrated' event fires later, once narrations are ready.
    for (const [, p] of alive) {
      if (p.socketId) io.to(p.socketId).emit('day-locked', { day: room.day });
    }
    runDayNarration(room);
  });

  // Spend 1 daily portion of a specific food kind for +1 HP. Available any
  // time the player has food and isn't at full health. If `name` is omitted
  // (back-compat), pulls from the first food slot found.
  socket.on('eat-food', ({ name } = {}) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const p = room.players.get(currentName);
    if (!p || p.dead) return;
    if (p.hp >= MAX_HP) return;
    const idx = name
      ? p.inventory.findIndex((s) => s.type === 'food' && s.name === name && s.count > 0)
      : p.inventory.findIndex((s) => s.type === 'food' && s.count > 0);
    if (idx < 0) return;
    const slot = p.inventory[idx];
    slot.count -= 1;
    if (slot.count <= 0) p.inventory.splice(idx, 1);
    p.hp = Math.min(MAX_HP, p.hp + 1);
    if (p.socketId) {
      io.to(p.socketId).emit('your-location', buildLocationPayload(room, currentName));
    }
  });

  // Move 1 unit (food) or 1 slot (item) from the player's personal
  // inventory into the camp cache. Player must be alive, at the wreckage,
  // and the room must be in campfire phase.
  socket.on('campfire-deposit', ({ name } = {}) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;
    const p = room.players.get(currentName);
    if (!p || p.dead) return;
    const wreckage = findSceneNode(room, 'wreckage-site');
    if (p.nodeId !== wreckage) return;
    const idx = p.inventory.findIndex((s) => s.name === name);
    if (idx < 0) return;
    const slot = p.inventory[idx];
    const slotName = slot.name;
    const slotType = slot.type;
    if (slotType === 'food' && slot.count > 1) {
      slot.count -= 1;
      addToCache(room, slotName, 'food', 1);
    } else {
      p.inventory.splice(idx, 1);
      addToCache(room, slotName, slotType, slotType === 'food' ? slot.count : 1);
    }
    if (p.socketId) {
      io.to(p.socketId).emit('your-location', buildLocationPayload(room, currentName));
    }
    broadcastCampfireState(room);
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('campfire-log', {
        name: currentName, action: 'shared', what: slotName,
      });
    }
  });

  // Withdraw the inverse: pull from the cache into the player's personal
  // inventory. Fails silently if the player has no slot (and no matching
  // food slot to stack onto).
  socket.on('campfire-withdraw', ({ name } = {}) => {
    if (!currentRoom || !currentName) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;
    const p = room.players.get(currentName);
    if (!p || p.dead) return;
    const wreckage = findSceneNode(room, 'wreckage-site');
    if (p.nodeId !== wreckage) return;
    const idx = room.cache.findIndex((s) => s.name === name);
    if (idx < 0) return;
    const slot = room.cache[idx];
    const slotName = slot.name;
    const slotType = slot.type;
    const remaining = INVENTORY_SIZE - p.inventory.length;
    const hasMatchingFood =
      slotType === 'food' &&
      p.inventory.some((s) => s.type === 'food' && s.name === slotName);
    const canLand = hasMatchingFood || remaining > 0;
    if (!canLand) return;
    if (slotType === 'food' && slot.count > 1) {
      slot.count -= 1;
      addToPersonalInventory(p, slotName, 'food', 1);
    } else {
      const movedCount = slotType === 'food' ? slot.count : 1;
      room.cache.splice(idx, 1);
      addToPersonalInventory(p, slotName, slotType, movedCount);
    }
    if (p.socketId) {
      io.to(p.socketId).emit('your-location', buildLocationPayload(room, currentName));
    }
    broadcastCampfireState(room);
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('campfire-log', {
        name: currentName, action: 'took', what: slotName,
      });
    }
  });

  // Host stages 1 unit of food from the stockpile into tonight's meal.
  // Items in the stockpile aren't food and can't be staged.
  socket.on('meal-add', ({ name } = {}) => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;
    const idx = room.cache.findIndex((s) => s.type === 'food' && s.name === name);
    if (idx < 0) return;
    const slot = room.cache[idx];
    if (slot.count > 1) slot.count -= 1;
    else room.cache.splice(idx, 1);
    const existing = room.meal.find((s) => s.type === 'food' && s.name === name);
    if (existing) existing.count += 1;
    else room.meal.push({ name, count: 1, type: 'food' });
    broadcastCampfireState(room);
  });

  // Host pulls 1 unit of food out of tonight's meal and back to the stockpile.
  socket.on('meal-remove', ({ name } = {}) => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'campfire') return;
    const idx = room.meal.findIndex((s) => s.type === 'food' && s.name === name);
    if (idx < 0) return;
    const slot = room.meal[idx];
    if (slot.count > 1) slot.count -= 1;
    else room.meal.splice(idx, 1);
    addToCache(room, name, 'food', 1);
    broadcastCampfireState(room);
  });

  // Host enters the campfire phase. Only valid when at least one alive
  // player is at the wreckage. Players elsewhere stay in their waiting
  // state; players at the wreckage get a campfire-turn event.
  socket.on('light-fire', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    const atCamp = aliveAtWreckage(room);
    if (atCamp.length === 0) return;
    room.phase = 'campfire';
    const aliveCount = alivePlayerEntries(room).length;
    const mealUnits = countFoodUnits(room.meal);
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('campfire-start', {
        day: room.day,
        cache: room.cache,
        meal: room.meal,
        playersAtCamp: atCamp.map(([name]) => name),
        aliveCount,
        mealUnits,
        portionsNeeded: Math.max(0, aliveCount - mealUnits),
      });
    }
    for (const [, p] of atCamp) {
      if (p.socketId) {
        io.to(p.socketId).emit('campfire-turn', {
          day: room.day,
          inventory: p.inventory,
          cache: room.cache,
        });
      }
    }
  });

  socket.on('end-day', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.phase !== 'started' && room.phase !== 'campfire') return;
    // Run the feeding rule: if cache covers everyone alive, drain it; else
    // every alive player loses 1 HP (some may die). Then advance the day.
    const summary = runFeeding(room);
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('feeding-result', summary);
    }
    checkGameOver(room);
    if (room.gameOver) return; // don't roll into a new day if everyone died
    room.phase = 'started';
    endDay(room);
  });

  socket.on('reset-room', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    for (const [, p] of room.players) {
      if (p.socketId) io.to(p.socketId).emit('room-closed');
    }
    rooms.delete(currentRoom);
    console.log(`[Room ${currentRoom}] reset by host`);
  });

  socket.on('disconnect', () => {
    if (currentRoom && currentName) {
      const room = rooms.get(currentRoom);
      if (room) {
        const p = room.players.get(currentName);
        if (p) p.socketId = null;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Island v0.5 on http://localhost:${PORT}`);
  console.log(`Phones join at http://localhost:${PORT}/play`);
});
