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

// Map generation functions
const getTileKey = (row, col) => `${row},${col}`;

// Check if a land tile touches water (making it a beach)
const isBeachTile = (row, col, landTiles, waterTiles, mapSize = 5) => {
  const cardinalDirections = [
    [-1, 0],  // Up
    [1, 0],   // Down
    [0, -1],  // Left
    [0, 1]    // Right
  ];
  
  for (const [dr, dc] of cardinalDirections) {
    const newRow = row + dr;
    const newCol = col + dc;
    
    // Out of bounds counts as water
    if (newRow < 0 || newRow >= mapSize || newCol < 0 || newCol >= mapSize) {
      return true;
    }
    
    // Check if neighbor is water
    const neighborKey = getTileKey(newRow, newCol);
    if (waterTiles.has(neighborKey)) {
      return true;
    }
  }
  
  return false; // No water neighbors in cardinal directions = grass/interior
};

// Flood fill to check if all land tiles are connected (cardinal directions only)
const isConnected = (landTiles) => {
  if (landTiles.size === 0) return false;
  
  const visited = new Set();
  const queue = [];
  
  // Start from first land tile
  const startTile = landTiles.values().next().value;
  queue.push(startTile);
  visited.add(startTile);
  
  while (queue.length > 0) {
    const current = queue.shift();
    const [row, col] = current.split(',').map(Number);
    
    // Check 4 cardinal neighbors
    const neighbors = [
      [row - 1, col], // Up
      [row + 1, col], // Down
      [row, col - 1], // Left
      [row, col + 1]  // Right
    ];
    
    for (const [nRow, nCol] of neighbors) {
      const neighborKey = getTileKey(nRow, nCol);
      if (landTiles.has(neighborKey) && !visited.has(neighborKey)) {
        visited.add(neighborKey);
        queue.push(neighborKey);
      }
    }
  }
  
  // All land tiles must be visited
  return visited.size === landTiles.size;
};

// Check if all land tiles have at least 2 land neighbors (cardinal directions)
const allTilesHaveTwoNeighbors = (landTiles) => {
  for (const tile of landTiles) {
    const [row, col] = tile.split(',').map(Number);
    
    // Count cardinal land neighbors
    const cardinalNeighbors = [
      [row - 1, col], // Up
      [row + 1, col], // Down
      [row, col - 1], // Left
      [row, col + 1]  // Right
    ];
    
    let landNeighborCount = 0;
    for (const [nRow, nCol] of cardinalNeighbors) {
      const neighborKey = getTileKey(nRow, nCol);
      if (landTiles.has(neighborKey)) {
        landNeighborCount++;
      }
    }
    
    // Each land tile must have at least 2 land neighbors
    if (landNeighborCount < 2) {
      return false;
    }
  }
  
  return true;
};

// Generate the island map
const generateMap = () => {
  const mapSize = 5;
  
  // Keep trying until we get a connected island
  let attempts = 0;
  const maxAttempts = 100;
  
  while (attempts < maxAttempts) {
    const landTiles = new Set();
    const waterTiles = new Set();
    
    // Start with all tiles as land
    for (let row = 0; row < mapSize; row++) {
      for (let col = 0; col < mapSize; col++) {
        landTiles.add(getTileKey(row, col));
      }
    }
    
    // Get all edge tiles
    const edgeTiles = [];
    for (let row = 0; row < mapSize; row++) {
      for (let col = 0; col < mapSize; col++) {
        if (row === 0 || row === mapSize - 1 || col === 0 || col === mapSize - 1) {
          edgeTiles.push(getTileKey(row, col));
        }
      }
    }
    
    // Randomly select 3 edge tiles to be water
    const shuffled = [...edgeTiles].sort(() => Math.random() - 0.5);
    const waterEdges = shuffled.slice(0, 3);
    
    waterEdges.forEach(tile => {
      landTiles.delete(tile);
      waterTiles.add(tile);
    });
    
    // Check if land is connected AND all tiles have at least 2 neighbors
    if (isConnected(landTiles) && allTilesHaveTwoNeighbors(landTiles)) {
      // Find all beach and grass tiles
      const beachTiles = [];
      const grassTiles = [];
      
      for (const tile of landTiles) {
        const [row, col] = tile.split(',').map(Number);
        if (isBeachTile(row, col, landTiles, waterTiles, mapSize)) {
          beachTiles.push(tile);
        } else {
          grassTiles.push(tile);
        }
      }
      
      // Randomly select a starting tile from beach tiles
      const startingTile = beachTiles.length > 0 
        ? beachTiles[Math.floor(Math.random() * beachTiles.length)]
        : landTiles.values().next().value; // Fallback to any land tile
      
      // Assign resource tiles
      const resourceTiles = {};
      
      const usedTiles = new Set([startingTile]);
      
      // 1. Herbs - random grass tile
      const availableGrass = grassTiles.filter(t => !usedTiles.has(t));
      if (availableGrass.length > 0) {
        resourceTiles.herbs = availableGrass[Math.floor(Math.random() * availableGrass.length)];
        usedTiles.add(resourceTiles.herbs);
      }
      
      // 2. Deer - different grass tile
      const availableGrass2 = grassTiles.filter(t => !usedTiles.has(t));
      if (availableGrass2.length > 0) {
        resourceTiles.deer = availableGrass2[Math.floor(Math.random() * availableGrass2.length)];
        usedTiles.add(resourceTiles.deer);
      }
      
      // 3. Bottle - beach tile adjacent to starting (diagonal ok)
      const [startRow, startCol] = startingTile.split(',').map(Number);
      const adjacentToStart = beachTiles.filter(tile => {
        if (usedTiles.has(tile)) return false;
        const [row, col] = tile.split(',').map(Number);
        const rowDiff = Math.abs(row - startRow);
        const colDiff = Math.abs(col - startCol);
        return rowDiff <= 1 && colDiff <= 1 && (rowDiff > 0 || colDiff > 0);
      });
      if (adjacentToStart.length > 0) {
        resourceTiles.bottle = adjacentToStart[Math.floor(Math.random() * adjacentToStart.length)];
        usedTiles.add(resourceTiles.bottle);
      }
      
      // 4. Coconut - random beach tile (not starting, not bottle)
      const availableBeach = beachTiles.filter(t => !usedTiles.has(t));
      if (availableBeach.length > 0) {
        resourceTiles.coconut = availableBeach[Math.floor(Math.random() * availableBeach.length)];
        usedTiles.add(resourceTiles.coconut);
      }
      
      // 5. Spring - unassigned grass tile
      const availableGrass3 = grassTiles.filter(t => !usedTiles.has(t));
      if (availableGrass3.length > 0) {
        resourceTiles.spring = availableGrass3[Math.floor(Math.random() * availableGrass3.length)];
        usedTiles.add(resourceTiles.spring);
      }
      
      // 6. Clams - two unassigned beach tiles
      const availableBeach2 = beachTiles.filter(t => !usedTiles.has(t));
      resourceTiles.clams = [];
      if (availableBeach2.length > 0) {
        const clam1 = availableBeach2[Math.floor(Math.random() * availableBeach2.length)];
        resourceTiles.clams.push(clam1);
        usedTiles.add(clam1);
        
        const availableBeach3 = beachTiles.filter(t => !usedTiles.has(t));
        if (availableBeach3.length > 0) {
          const clam2 = availableBeach3[Math.floor(Math.random() * availableBeach3.length)];
          resourceTiles.clams.push(clam2);
          usedTiles.add(clam2);
        }
      }
      
      // Convert Sets to Arrays for JSON serialization
      return {
        landTiles: Array.from(landTiles),
        waterTiles: Array.from(waterTiles),
        startingTile,
        resourceTiles,
        exploredTiles: [startingTile], // Start with just the starting tile explored
      };
    }
    
    attempts++;
  }
  
  // Fallback: return a simple connected island (all edges are land)
  const landTiles = new Set();
  const waterTiles = new Set();
  for (let row = 0; row < mapSize; row++) {
    for (let col = 0; col < mapSize; col++) {
      landTiles.add(getTileKey(row, col));
    }
  }
  const startingTile = getTileKey(0, 0); // Fallback starting position
  return {
    landTiles: Array.from(landTiles),
    waterTiles: Array.from(waterTiles),
    startingTile,
    resourceTiles: {},
    exploredTiles: [startingTile],
  };
};

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
    socket.on('toggle-ready', async () => {
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
            
            // Generate the map
            const mapData = generateMap();
            room.mapData = mapData;
            console.log(`Generated map for room ${roomCode}, starting tile: ${mapData.startingTile}`);
            
            // Generate Day 1 narration
            let narration = 'You wake up on the beach, surrounded by wreckage...';
            try {
              const narrationResponse = await fetch(`http://localhost:${port}/api/generate-narration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  currentDay: 1,
                  players: room.players,
                  food: room.food,
                  water: room.water,
                  mapState: {
                    exploredTiles: mapData.exploredTiles.length,
                    totalTiles: mapData.landTiles.length + mapData.waterTiles.length,
                    startingTile: mapData.startingTile,
                  }
                })
              });
              
              if (narrationResponse.ok) {
                const data = await narrationResponse.json();
                narration = data.narration;
                console.log('Generated Day 1 narration');
              } else {
                console.error('Failed to generate Day 1 narration:', narrationResponse.status);
              }
            } catch (error) {
              console.error('Error generating Day 1 narration:', error);
            }
            
            io.to(roomCode).emit('game-start', {
              players: room.players,
              narration: narration,
              mapData: mapData,
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
    socket.on('advance-day', async () => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        room.currentDay += 1;
        
        // Subtract 1 health from each player (minimum 0)
        room.players.forEach(player => {
          player.health = Math.max(0, player.health - 1);
        });
        
        console.log(`Room ${roomCode} advancing to day ${room.currentDay}`);
        
        // Generate narration
        let narration = 'The sun rises on another day...';
        try {
          const mapState = room.mapData ? {
            exploredTiles: room.mapData.exploredTiles.length,
            totalTiles: room.mapData.landTiles.length + room.mapData.waterTiles.length,
            startingTile: room.mapData.startingTile,
          } : null;
          
          const narrationResponse = await fetch(`http://localhost:${port}/api/generate-narration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentDay: room.currentDay,
              players: room.players,
              food: room.food,
              water: room.water,
              mapState: mapState,
            })
          });
          
          if (narrationResponse.ok) {
            const data = await narrationResponse.json();
            narration = data.narration;
            console.log(`Generated narration for day ${room.currentDay}`);
          } else {
            console.error('Failed to generate narration:', narrationResponse.status);
          }
        } catch (error) {
          console.error('Error generating narration:', error);
        }
        
        // Notify all players of new day
        io.to(roomCode).emit('day-advanced', {
          currentDay: room.currentDay,
          players: room.players,
          food: room.food,
          water: room.water,
          narration: narration,
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
