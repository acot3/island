require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const {
  pickStartingCorner,
  NODES, neighborsOf, neighborsWithMeta,
  buildMapPayload, buildLocationPayload,
} = require('./lib/map');
const { categorizeAction } = require('./lib/categorizer');
const { resolveAction } = require('./lib/resolver');

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
  rooms.set(code, {
    hostSocket: null,
    players: new Map(), // name -> { socketId, pronouns, mbti }
    phase: 'lobby',     // 'lobby' | 'started'
    day: 1,
  });
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

// Triggered by the host pressing "Categorize". Calls the categorizer for
// every currently-submitted action that is not a Move or an Assist; emits
// results to the host's debug panel as they return. Skips players who
// haven't submitted yet.
function runCategorizer(room) {
  for (const [name, p] of room.players) {
    const action = p.chosenAction;
    if (action === null) continue;
    if (/^Move to /.test(action) || /^Assist /.test(action)) continue;
    const biome = NODES[p.nodeId]?.biome;
    if (!biome) continue;

    categorizeAction({ action, biome })
      .then((result) => {
        const outcome = resolveAction(result);
        if (room.hostSocket) {
          io.to(room.hostSocket).emit('categorizer-result', {
            player: name, action, biome, result, outcome,
          });
        }
      })
      .catch((err) => {
        if (room.hostSocket) {
          io.to(room.hostSocket).emit('categorizer-error', {
            player: name, action, error: err.message,
          });
        }
      });
  }
}

function moveActionLabel(fromNodeId, targetNodeId) {
  const meta = neighborsWithMeta(fromNodeId).find((n) => n.nodeId === targetNodeId);
  if (!meta) return null;
  const biome = meta.biome.charAt(0).toUpperCase() + meta.biome.slice(1);
  return `Move to ${biome} (${meta.direction})`;
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
      chosenAction: null, isPublic: false,
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
    room.startNodeId = pickStartingCorner();
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

    // Cascade-cancel anyone assisting this player
    for (const [name, p] of room.players) {
      if (name === currentName) continue;
      if (p.chosenAction === `Assist ${currentName}`) {
        p.chosenAction = null;
        p.isPublic = false;
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

  socket.on('categorize-now', () => {
    if (!isHost || !currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'started') return;
    runCategorizer(room);
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
