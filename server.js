require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const {
  CORNERS,
  NODES, neighborsOf, nodeLabel,
  buildMapPayload, buildLocationPayload,
  distributeScenes, findSceneNode, getNodeView,
} = require('./lib/map');
const { categorizeAction } = require('./lib/categorizer');
const { resolveAction } = require('./lib/resolver');
const { narrateMorning, narrateDay } = require('./lib/narrator');

const PLAYER_COLORS = [
  '#5b9eda', '#d65b9e', '#b87bd6', '#f08c42', '#ffffff', '#6a6a6a',
];

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'phone.html')));

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
    players: new Map(), // name -> { socketId, pronouns, mbti }
    phase: 'lobby',     // 'lobby' | 'started'
    day: 1,
    narrative: '',          // the canonical growing prose document
    currentChunk: null,     // { kind: 'morning' | 'day', day, text }
    narratorBusy: false,    // single-flight guard
    nodeState: null,        // { [nodeId]: { sceneId, foundItems } }
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

// Build a snapshot of player profiles passed to every narrator call.
function narratorPlayers(room) {
  return Array.from(room.players.entries()).map(([name, p]) => ({
    name, pronouns: p.pronouns, mbti: p.mbti,
  }));
}

// Build a snapshot of where every player currently is. The narrator uses
// nodeId to judge co-location and biome to describe scenery; it never sees
// the human-readable label, which would leak compass info into the prose.
function locationsSnapshot(room) {
  return Array.from(room.players.entries())
    .filter(([, p]) => p.nodeId)
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
        const outcome = resolveAction(verdict, sceneContext);
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
        return {
          player: name, action, type: 'free',
          nodeId: fromNodeId, biome: fromBiome,
          possible: verdict.possible,
          attribute: verdict.attribute,
          difficulty: verdict.difficulty,
          rationale: verdict.rationale,
          success: summarySuccess,
          reason: summaryReason,
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
    const { chunk } = await narrateDay({
      narrative: room.narrative,
      day: room.day,
      players: narratorPlayers(room),
      locations: locationsSnapshot(room), // post-move snapshot
      actionReports,
    });
    appendNarrationChunk(room, 'day', chunk + '\n\n');
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
    if (room.phase === 'started' && player.nodeId) {
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
    if (!player || !player.nodeId) return;
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
    if (!player || player.chosenAction !== null) return;

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
    if (!player || player.chosenAction === null || player.isPublic) return;
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
    if (!player || player.chosenAction === null) return;

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
    if (room.players.size === 0) return;
    for (const [, p] of room.players) {
      if (p.chosenAction === null) return; // not all submitted
    }
    runDayNarration(room);
  });

  socket.on('end-day', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
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
