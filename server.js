require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { getFullMap, pickStartingCorner } = require('./lib/map');

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

function buildMapPayload(room) {
  const players = Array.from(room.players.entries())
    .filter(([, p]) => p.nodeId)
    .map(([name, p]) => ({ name, color: p.color, nodeId: p.nodeId }));
  return { ...getFullMap(), players };
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
    room.players.set(name, { socketId: socket.id, pronouns, mbti, color });
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
    for (const [, p] of room.players) p.nodeId = room.startNodeId;
    io.to(currentRoom).emit('game-started', { day: room.day });
    if (room.hostSocket) {
      io.to(room.hostSocket).emit('map-state', buildMapPayload(room));
    }
    console.log(`[Room ${currentRoom}] started with ${room.players.size} player(s) at ${room.startNodeId}`);
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
