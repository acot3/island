const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = 3000;

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Store game rooms in memory
// Structure: { 
//   roomCode: { 
//     players: [{ id, name, isReady }], 
//     gameStarted: false,
//     createdAt: timestamp 
//   } 
// }
const gameRooms = new Map();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Create Socket.io server
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });

  // Handle Socket.io connections
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Handle player joining a room
    socket.on('join-room', ({ roomCode, playerName }) => {
      console.log(`${playerName} joining room ${roomCode}`);
      
      // Join the Socket.io room
      socket.join(roomCode);
      
      // Create room if it doesn't exist
      if (!gameRooms.has(roomCode)) {
        gameRooms.set(roomCode, {
          players: [],
          gameStarted: false,
          currentDay: 1,
          food: 0,
          water: 0,
          createdAt: Date.now(),
        });
      }

      const room = gameRooms.get(roomCode);
      
      // Add player to room
      const player = {
        id: socket.id,
        name: playerName,
        isReady: false,
        health: 10,
        joinedAt: Date.now(),
      };
      
      room.players.push(player);

      // Store player's current room
      socket.data.roomCode = roomCode;
      socket.data.playerName = playerName;

      // Send updated room state to everyone in the room
      io.to(roomCode).emit('room-update', {
        players: room.players,
        gameStarted: room.gameStarted,
        currentDay: room.currentDay,
        food: room.food,
        water: room.water,
      });

      console.log(`Room ${roomCode} now has ${room.players.length} players`);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        
        // Remove player from room
        room.players = room.players.filter(p => p.id !== socket.id);
        
        // If room is empty, delete it
        if (room.players.length === 0) {
          gameRooms.delete(roomCode);
          console.log(`Room ${roomCode} deleted (empty)`);
        } else {
          // Notify remaining players
          io.to(roomCode).emit('room-update', {
            players: room.players,
            gameStarted: room.gameStarted,
            currentDay: room.currentDay,
            food: room.food,
            water: room.water,
          });
          console.log(`Room ${roomCode} now has ${room.players.length} players`);
        }
      }
    });

    // Handle player ready toggle
    socket.on('toggle-ready', () => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        const player = room.players.find(p => p.id === socket.id);
        
        if (player) {
          player.isReady = !player.isReady;
          console.log(`${player.name} is now ${player.isReady ? 'ready' : 'not ready'}`);
          
          // Check if all players are ready (and there's at least 1 player)
          const allReady = room.players.length > 0 && room.players.every(p => p.isReady);
          
          if (allReady && !room.gameStarted) {
            // Start the game!
            room.gameStarted = true;
            console.log(`Game starting in room ${roomCode}!`);
            
            io.to(roomCode).emit('game-start', {
              players: room.players,
            });
          } else {
            // Just update the room
            io.to(roomCode).emit('room-update', {
              players: room.players,
              gameStarted: room.gameStarted,
              currentDay: room.currentDay,
              food: room.food,
              water: room.water,
            });
          }
        }
      }
    });

    // Handle day advancement
    socket.on('advance-day', () => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        room.currentDay += 1;
        
        // Subtract 1 health from each player (minimum 0)
        room.players.forEach(player => {
          player.health = Math.max(0, player.health - 1);
        });
        
        console.log(`Room ${roomCode} advancing to day ${room.currentDay}`);
        
        // Notify all players of new day
        io.to(roomCode).emit('day-advanced', {
          currentDay: room.currentDay,
          players: room.players,
          food: room.food,
          water: room.water,
        });
      }
    });

    // Handle player leaving voluntarily
    socket.on('leave-room', () => {
      const roomCode = socket.data.roomCode;
      if (roomCode) {
        socket.leave(roomCode);
        
        if (gameRooms.has(roomCode)) {
          const room = gameRooms.get(roomCode);
          room.players = room.players.filter(p => p.id !== socket.id);
          
          if (room.players.length === 0) {
            gameRooms.delete(roomCode);
          } else {
            io.to(roomCode).emit('room-update', {
              players: room.players,
              gameStarted: room.gameStarted,
              currentDay: room.currentDay,
              food: room.food,
              water: room.water,
            });
          }
        }
        
        socket.data.roomCode = null;
        socket.data.playerName = null;
      }
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
