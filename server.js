const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Always bind to all interfaces
const port = parseInt(process.env.PORT || '3000', 10);

// Create Next.js app
const app = next({ dev });
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

// Calculate distance between two tiles (Manhattan distance)
function getTileDistance(tile1, tile2) {
  const [r1, c1] = tile1.split(',').map(Number);
  const [r2, c2] = tile2.split(',').map(Number);
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

// Get all tiles adjacent to a given tile (including diagonals)
function getAdjacentTiles(tileKey) {
  const [row, col] = tileKey.split(',').map(Number);
  const adjacent = [];
  
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue; // Skip the tile itself
      adjacent.push(`${row + dr},${col + dc}`);
    }
  }
  
  return adjacent;
}

// Calculate which tiles can be explored (within range of explored tiles)
function getExplorableTiles(mapData) {
  if (!mapData || !mapData.exploredTiles) return [];
  
  const allTiles = new Set([...mapData.landTiles, ...mapData.waterTiles]);
  const explored = new Set(mapData.exploredTiles);
  const explorable = new Set();
  
  // For each explored tile, add its adjacent unexplored tiles
  for (const exploredTile of mapData.exploredTiles) {
    const adjacent = getAdjacentTiles(exploredTile);
    for (const tile of adjacent) {
      if (allTiles.has(tile) && !explored.has(tile)) {
        explorable.add(tile);
      }
    }
  }
  
  return Array.from(explorable);
}

// Helper function to calculate map state for choice generation
const calculateMapState = (mapData, resourceStates = {}) => {
  if (!mapData) return null;
  
  const exploredSet = new Set(mapData.exploredTiles);
  const allTiles = new Set([...mapData.landTiles, ...mapData.waterTiles]);
  
  // Check for nearby unexplored tiles (within 2 spaces, including diagonal)
  const [startRow, startCol] = mapData.startingTile.split(',').map(Number);
  let nearbyUnexplored = false;
  
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const row = startRow + dr;
      const col = startCol + dc;
      const tileKey = `${row},${col}`;
      
      // Check if tile exists and is not explored
      if (allTiles.has(tileKey) && !exploredSet.has(tileKey)) {
        nearbyUnexplored = true;
        break;
      }
    }
    if (nearbyUnexplored) break;
  }
  
  // Check for revealed resources
  const revealedResources = [];
  const resourceTiles = mapData.resourceTiles || {};
  
  // Check each resource type
  const resourceTypes = {
    herbs: 'herbs',
    deer: 'deer',
    coconut: 'coconut',
    clams: 'clams',
    spring: 'spring',
    bottle: 'bottle'
  };
  
  for (const [key, type] of Object.entries(resourceTypes)) {
    const tile = resourceTiles[key];
    if (tile) {
      // Handle clams which is an array
      if (Array.isArray(tile)) {
        tile.forEach(clamTile => {
          if (exploredSet.has(clamTile)) {
            const collected = resourceStates[`clams_${clamTile}`] || false;
            // Only include if not collected (depleted) - spring is never depleted
            if (!collected || key === 'clams') {
              revealedResources.push({
                type: 'clams',
                tile: clamTile,
                collected: collected
              });
            }
          }
        });
      } else {
        if (exploredSet.has(tile)) {
          const collected = resourceStates[key] || false;
          // Only include if not collected (depleted) - spring is never depleted
          if (!collected || key === 'spring') {
            revealedResources.push({
              type: type,
              tile: tile,
              collected: collected
            });
          }
        }
      }
    }
  }
  
  return {
    exploredTiles: mapData.exploredTiles.length,
    totalTiles: mapData.landTiles.length + mapData.waterTiles.length,
    startingTile: mapData.startingTile,
    nearbyUnexplored: nearbyUnexplored,
    revealedResources: revealedResources
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
    socket.on('join-room', ({ roomCode, playerName, pronouns, stats, mbtiType, isScreen }) => {
      // Skip validation for screen connections
      if (isScreen) {
        socket.join(roomCode);
        socket.data.roomCode = roomCode;
        socket.data.isScreen = true;
        console.log(`Screen connected to room ${roomCode}`);
        
        // Send current room state to the screen
        if (gameRooms.has(roomCode)) {
          const room = gameRooms.get(roomCode);
          socket.emit('room-update', {
            players: room.players,
            gameStarted: room.gameStarted,
            currentDay: room.currentDay,
            food: room.food,
            water: room.water,
          });
        }
        return;
      }

      console.log(`${playerName} (${mbtiType}) joining room ${roomCode}`);
      
      // Validate stats if provided
      if (stats) {
        const totalStats = (stats.strength || 0) + (stats.intelligence || 0) + (stats.charisma || 0);
        if (totalStats !== 6) {
          socket.emit('error', { event: 'error', message: 'Invalid stats distribution' });
          console.log(`Player ${playerName} rejected: stats sum to ${totalStats}, must be 6`);
          return;
        }
      }
      
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
          resourceStates: {},
          storyNotes: [],        // Legacy: persistent narrative canon (keeping during migration)
          storyThreads: {}, // NEW: keyed narrative threads (persistent canon)
          pendingActions: {}, // Actions submitted by players for the current turn
          createdAt: Date.now(),
        });
      }

      const room = gameRooms.get(roomCode);
      
      // Add player to room
      const player = {
        id: socket.id,
        name: playerName,
        pronouns: pronouns || '',
        mbtiType: mbtiType || 'INTJ', // Default to INTJ if not provided
        stats: {
          strength: stats?.strength || 0,
          intelligence: stats?.intelligence || 0,
          charisma: stats?.charisma || 0
        },
        isReady: false,
        health: 10,
        joinedAt: Date.now(),
        injured: false,
        injuredOnDay: null,
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
          
          // Broadcast room update to all players
          io.to(roomCode).emit('room-update', {
            players: room.players,
            gameStarted: room.gameStarted,
            currentDay: room.currentDay,
            food: room.food,
            water: room.water
          });
          
          if (allReady && !room.gameStarted) {
            // Emit event to all players to show intro video
            io.to(roomCode).emit('all-players-ready', {});
            
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
              // Initialize resource states if not exists
              if (!room.resourceStates) {
                room.resourceStates = {};
              }
              
              const mapState = calculateMapState(mapData, room.resourceStates);
              
              // TEMPORARY CANARY TEST — remove after verification
              if (!room.storyThreads || Object.keys(room.storyThreads).length === 0) {
                const firstPlayer = room.players[0];
                if (firstPlayer) {
                  const canaryId = `thread_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                  room.storyThreads = {
                    [canaryId]: {
                      title: `${firstPlayer.name}'s Secret Discovery`,
                      status: 'active',
                      beats: [`${firstPlayer.name} has discovered something among the wreckage and is keeping it secret.`]
                    }
                  };
                }
              }
              
              // Use localhost for internal API calls (works both locally and on Render)
              const apiUrl = `http://localhost:${port}/api/generate-narration`;
              const narrationResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  currentDay: 1,
                  players: room.players,
                  food: room.food,
                  water: room.water,
                  mapState: mapState,
                  storyThreads: room.storyThreads,
                })
              });
              
              if (narrationResponse.ok) {
                const data = await narrationResponse.json();
                narration = data.narration || narration;
                
                // Merge thread updates into room.storyThreads
                if (!room.storyThreads) room.storyThreads = {};
                const updates = Array.isArray(data.threadUpdates) ? data.threadUpdates : [];
                
                for (const u of updates) {
                  if (!u || typeof u !== 'object') continue;
                  
                  let id = u.thread_id;
                  if (id === 'NEW') {
                    id = `thread_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                    room.storyThreads[id] = { title: u.title_if_new || 'Untitled thread', status: 'active', beats: [] };
                  }
                  
                  if (!room.storyThreads[id]) {
                    room.storyThreads[id] = { title: u.title_if_new || 'Untitled thread', status: 'active', beats: [] };
                  }
                  
                  if (typeof u.beat === 'string' && u.beat.trim()) {
                    room.storyThreads[id].beats.push(u.beat.trim());
                    room.storyThreads[id].beats = room.storyThreads[id].beats.slice(-10); // cap per thread
                  }
                  
                  if (u.update_type === 'resolve') {
                    room.storyThreads[id].status = 'resolved';
                  } else {
                    room.storyThreads[id].status = 'active';
                  }
                }
                
                console.log(`[${roomCode}] storyThreads:`, JSON.stringify(room.storyThreads, null, 2));
                console.log('Generated Day 1 narration');
              } else {
                const errorText = await narrationResponse.text().catch(() => 'Could not read error response');
                console.error('Failed to generate Day 1 narration:', narrationResponse.status, errorText);
              }
            } catch (error) {
              console.error('Error generating Day 1 narration:', error.message || error);
            }
            
            io.to(roomCode).emit('game-start', {
              players: room.players,
              narration: narration,
              mapData: mapData,
              resourceStates: room.resourceStates || {},
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
        // Reset pending actions when day advances
        room.pendingActions = {};
        
        // Subtract 1 health from each player (minimum 0) and handle injuries
        room.players.forEach(player => {
          player.health = Math.max(0, player.health - 1);
          // Injuries persist through one day advance, then clear on the next
          // If injured, check if it's been at least 2 days since injury
          if (player.injured && player.injuredOnDay !== null) {
            if (room.currentDay > player.injuredOnDay + 1) {
              // Injury has persisted for a full day, now clear it
              player.injured = false;
              player.injuredOnDay = null;
            }
            // Otherwise, keep the injury (it persists through this day advance)
          }
        });
        
        // Consumption mechanic: food and water
        const numPlayers = room.players.length;
        
        // Food consumption: if enough food for all players, consume and restore 1 health
        if (room.food >= numPlayers) {
          room.food -= numPlayers;
          room.players.forEach(player => {
            player.health = Math.min(10, player.health + 1); // Cap at 10
          });
        }
        
        // Water consumption: if enough water for all players, consume (no health change)
        // If not enough water, reduce health by 1
        if (room.water >= numPlayers) {
          room.water -= numPlayers;
        } else {
          // Not enough water - reduce health by 1 (happens after food replenishment)
          room.players.forEach(player => {
            player.health = Math.max(0, player.health - 1);
          });
        }
        
        console.log(`Room ${roomCode} advancing to day ${room.currentDay}`);
        
        // Generate narration
        let narration = 'The sun rises on another day...';
        try {
          // Initialize resource states if not exists
          if (!room.resourceStates) {
            room.resourceStates = {};
          }
          
          const mapState = room.mapData ? calculateMapState(room.mapData, room.resourceStates) : null;
          console.log('Server mapState:', JSON.stringify(mapState, null, 2));
          console.log('Server resourceStates:', JSON.stringify(room.resourceStates, null, 2));
          
          // Use localhost for internal API calls (works both locally and on Render)
          const apiUrl = `http://localhost:${port}/api/generate-narration`;
          const narrationResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              currentDay: room.currentDay,
              players: room.players,
              food: room.food,
              water: room.water,
              mapState: mapState,
              storyThreads: room.storyThreads,
            })
          });
          
          if (narrationResponse.ok) {
            const data = await narrationResponse.json();
            narration = data.narration || narration;
            
            // Merge thread updates into room.storyThreads
            if (!room.storyThreads) room.storyThreads = {};
            const updates = Array.isArray(data.threadUpdates) ? data.threadUpdates : [];
            
            for (const u of updates) {
              if (!u || typeof u !== 'object') continue;
              
              let id = u.thread_id;
              if (id === 'NEW') {
                id = `thread_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                room.storyThreads[id] = { title: u.title_if_new || 'Untitled thread', status: 'active', beats: [] };
              }
              
              if (!room.storyThreads[id]) {
                room.storyThreads[id] = { title: u.title_if_new || 'Untitled thread', status: 'active', beats: [] };
              }
              
              if (typeof u.beat === 'string' && u.beat.trim()) {
                room.storyThreads[id].beats.push(u.beat.trim());
                room.storyThreads[id].beats = room.storyThreads[id].beats.slice(-10); // cap per thread
              }
              
              if (u.update_type === 'resolve') {
                room.storyThreads[id].status = 'resolved';
              } else {
                room.storyThreads[id].status = 'active';
              }
            }
            
            console.log(`[${roomCode}] storyThreads:`, JSON.stringify(room.storyThreads, null, 2));
            console.log(`Generated narration for day ${room.currentDay}`);
          } else {
            const errorText = await narrationResponse.text().catch(() => 'Could not read error response');
            console.error('Failed to generate narration:', narrationResponse.status, errorText);
          }
        } catch (error) {
          console.error('Error generating narration:', error.message || error);
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


    // Handle resource gathering
    socket.on('gather-resource', ({ resourceType, tileKey, foodAmount, waterAmount }) => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        const player = room.players.find(p => p.id === socket.id);

        if (player && room.gameStarted && room.mapData) {
          console.log(`${player.name} gathering ${resourceType} from tile ${tileKey}`);
          console.log('Current room resources:', { food: room.food, water: room.water });
          console.log('Food amount received from client:', foodAmount, 'Type:', typeof foodAmount);
          console.log('Map resource tiles:', JSON.stringify(room.mapData.resourceTiles, null, 2));
          console.log('Explored tiles:', room.mapData.exploredTiles);

          // Validate the tile has the correct resource
          const resources = room.mapData.resourceTiles;
          let isValidResource = false;
          
          if (resourceType === 'food') {
            isValidResource = tileKey === resources.herbs || 
                             tileKey === resources.deer || 
                             tileKey === resources.coconut ||
                             (resources.clams && resources.clams.includes(tileKey));
            console.log(`Food resource check: herbs=${tileKey === resources.herbs}, deer=${tileKey === resources.deer}, coconut=${tileKey === resources.coconut}, clams=${resources.clams && resources.clams.includes(tileKey)}`);
          } else if (resourceType === 'water') {
            isValidResource = tileKey === resources.bottle || 
                             tileKey === resources.spring;
            console.log(`Water resource check: bottle=${tileKey === resources.bottle}, spring=${tileKey === resources.spring}`);
          }

          // Check if tile is explored
          const isExplored = room.mapData.exploredTiles && room.mapData.exploredTiles.includes(tileKey);
          console.log(`Tile ${tileKey} is explored: ${isExplored}, isValidResource: ${isValidResource}`);
          
          if (isValidResource && isExplored) {
            // Check if resource is already depleted (except spring which is infinite)
            const isSpring = tileKey === resources.spring;
            let resourceKey = '';
            
            // Determine the resource key for tracking depletion
            if (tileKey === resources.herbs) {
              resourceKey = 'herbs';
            } else if (tileKey === resources.deer) {
              resourceKey = 'deer';
            } else if (tileKey === resources.coconut) {
              resourceKey = 'coconut';
            } else if (tileKey === resources.bottle) {
              resourceKey = 'bottle';
            } else if (resources.clams && resources.clams.includes(tileKey)) {
              resourceKey = `clams_${tileKey}`;
            }
            
            // Check if resource is already depleted (spring is never depleted)
            const isDepleted = resourceKey && room.resourceStates[resourceKey];
            if (isDepleted && !isSpring) {
              console.log(`Resource ${resourceKey} at ${tileKey} is already depleted`);
              return; // Can't gather from depleted resources
            }
            
            // Increment the appropriate resource
            if (resourceType === 'food') {
              // Use foodAmount from client, or default to 2-4 if not provided (for backwards compatibility)
              // Ensure foodAmount is a valid number
              const parsedAmount = typeof foodAmount === 'number' && foodAmount > 0 ? foodAmount : null;
              const amount = parsedAmount !== null
                ? parsedAmount
                : (Math.floor(Math.random() * 3) + 2);
              console.log(`Adding ${amount} food to room (current: ${room.food}, foodAmount param: ${foodAmount}, parsedAmount: ${parsedAmount})`);
              const previousFood = room.food;
              room.food += amount;
              console.log(`Food gathered: ${amount} (previous: ${previousFood}, new total: ${room.food})`);
            } else if (resourceType === 'water') {
              // Use waterAmount from client, or default to 2-4 if not provided (for backwards compatibility)
              // Ensure waterAmount is a valid number
              const parsedAmount = typeof waterAmount === 'number' && waterAmount > 0 ? waterAmount : null;
              const amount = parsedAmount !== null
                ? parsedAmount
                : (Math.floor(Math.random() * 3) + 2);
              console.log(`Adding ${amount} water to room (current: ${room.water}, waterAmount param: ${waterAmount}, parsedAmount: ${parsedAmount})`);
              const previousWater = room.water;
              room.water += amount;
              console.log(`Water gathered: ${amount} (previous: ${previousWater}, new total: ${room.water})`);
            }

            // Mark resource as depleted (except spring which is infinite)
            if (resourceKey && !isSpring) {
              room.resourceStates[resourceKey] = true;
              console.log(`Resource ${resourceKey} at ${tileKey} is now depleted`);
            }

            console.log(`Resource gathered. ${resourceType}: ${room[resourceType]}`);
            console.log(`Broadcasting resource update: food=${room.food}, water=${room.water}`);

            // Broadcast updated resources and resource states to all players
            io.to(roomCode).emit('resource-updated', {
              food: room.food,
              water: room.water,
              resourceStates: room.resourceStates
            });
          } else {
            console.log(`Invalid resource gathering attempt: ${resourceType} from ${tileKey}`);
            console.log(`Validation failed - isValidResource: ${isValidResource}, isExplored: ${isExplored}`);
            if (!isValidResource) {
              console.log(`Resource validation failed. Expected ${resourceType} resource at ${tileKey}`);
              console.log(`Available resources:`, {
                herbs: resources.herbs,
                deer: resources.deer,
                coconut: resources.coconut,
                clams: resources.clams,
                bottle: resources.bottle,
                spring: resources.spring
              });
            }
            if (!isExplored) {
              console.log(`Tile ${tileKey} is not explored. Explored tiles:`, room.mapData.exploredTiles);
            }
          }
        }
      }
    });

    // Handle player injury
    socket.on('player-injured', () => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        const player = room.players.find(p => p.id === socket.id);
        
        if (player && room.gameStarted) {
          player.injured = true;
          player.injuredOnDay = room.currentDay; // Track the day when injury occurred
          console.log(`${player.name} is now injured on day ${room.currentDay}`);
          
          // Broadcast updated player state to all players
          io.to(roomCode).emit('room-update', {
            players: room.players,
            gameStarted: room.gameStarted,
            currentDay: room.currentDay,
            food: room.food,
            water: room.water,
          });
        }
      }
    });

    // Handle action submission
    socket.on('submit-action', async ({ action }) => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        const player = room.players.find(p => p.id === socket.id);
        
        if (player && room.gameStarted && !player.injured) {
          console.log(`${player.name} submitted action: ${action}`);
          
          // Store the action
          if (!room.pendingActions) {
            room.pendingActions = {};
          }
          room.pendingActions[socket.id] = action;
          
          // Broadcast to all players who has submitted
          io.to(roomCode).emit('action-submitted', {
            playerId: socket.id,
            playerName: player.name,
            totalSubmitted: Object.keys(room.pendingActions).length,
            totalPlayers: room.players.filter(p => !p.injured).length
          });
          
          // Check if all non-injured players have submitted
          const nonInjuredPlayers = room.players.filter(p => !p.injured);
          const allSubmitted = nonInjuredPlayers.every(p => room.pendingActions[p.id]);
          
          if (allSubmitted && nonInjuredPlayers.length > 0) {
            console.log('All players have submitted actions - resolving...');
            
            // Notify players that resolution is starting
            io.to(roomCode).emit('resolving-actions', {});
            
            // Prepare data for action resolution
            const playersWithActions = nonInjuredPlayers.map(player => ({
              id: player.id,
              name: player.name,
              pronouns: player.pronouns,
              mbtiType: player.mbtiType,
              stats: player.stats,
              hp: player.health,
              action: room.pendingActions[player.id]
            }));
            
            const explorableTiles = getExplorableTiles(room.mapData);
            
            try {
              // Call action resolution API
              const apiUrl = `http://127.0.0.1:${port}/api/resolve-actions`;
              const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  currentDay: room.currentDay,
                  players: playersWithActions,
                  mapData: {
                    landTiles: room.mapData.landTiles,
                    waterTiles: room.mapData.waterTiles,
                    startingTile: room.mapData.startingTile,
                    exploredTiles: room.mapData.exploredTiles,
                    explorableTiles: explorableTiles,
                    resourceTiles: room.mapData.resourceTiles
                  },
                  groupInventory: {
                    food: room.food,
                    water: room.water,
                    items: [], // We don't have items yet
                    facts: [] // We don't have facts yet
                  },
                  storyThreads: room.storyThreads || {}
                })
              });
              
              if (response.ok) {
                const data = await response.json();
                console.log(`[${roomCode}] Action resolution response received:`, {
                  hasPublicNarration: !!data.publicNarration,
                  outcomesCount: data.outcomes?.length || 0,
                  threadUpdatesCount: data.threadUpdates?.length || 0
                });
                
                // Process outcomes
                for (const outcome of data.outcomes) {
                  const player = room.players.find(p => p.id === outcome.playerId);
                  if (player) {
                    // Update player HP
                    player.health = Math.max(0, Math.min(10, player.health + outcome.hpChange));
                    
                    // Update resources (group inventory)
                    room.food += outcome.resourcesFound.food;
                    room.water += outcome.resourcesFound.water;
                  }
                  
                  // Update explored tiles
                  if (outcome.tilesRevealed && outcome.tilesRevealed.length > 0) {
                    const newTiles = outcome.tilesRevealed.filter(t => 
                      !room.mapData.exploredTiles.includes(t)
                    );
                    room.mapData.exploredTiles.push(...newTiles);
                  }
                }
                
                // Update story threads
                if (data.threadUpdates) {
                  if (!room.storyThreads) room.storyThreads = {};
                  for (const update of data.threadUpdates) {
                    let id = update.thread_id;
                    if (id === 'NEW') {
                      id = `thread_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
                      room.storyThreads[id] = { 
                        title: update.title_if_new || 'Untitled thread', 
                        status: 'active', 
                        beats: [] 
                      };
                    }
                    
                    if (!room.storyThreads[id]) {
                      room.storyThreads[id] = { 
                        title: update.title_if_new || 'Untitled thread', 
                        status: 'active', 
                        beats: [] 
                      };
                    }
                    
                    if (update.beat) {
                      room.storyThreads[id].beats.push(update.beat);
                      room.storyThreads[id].beats = room.storyThreads[id].beats.slice(-10);
                    }
                    
                    if (update.update_type === 'resolve') {
                      room.storyThreads[id].status = 'resolved';
                    } else {
                      room.storyThreads[id].status = 'active';
                    }
                  }
                }
                
                // Send private outcomes to each player FIRST (before public narration)
                console.log(`[${roomCode}] Sending private outcomes to ${data.outcomes.length} players`);
                for (const outcome of data.outcomes) {
                  console.log(`[${roomCode}] Sending private outcome to player ${outcome.playerId}`);
                  io.to(outcome.playerId).emit('private-outcome', {
                    privateNarration: outcome.privateNarration,
                    resourcesFound: outcome.resourcesFound,
                    itemsFound: outcome.itemsFound,
                    factsLearned: outcome.factsLearned,
                    hpChange: outcome.hpChange
                  });
                }

                // Send public narration to everyone
                console.log(`[${roomCode}] Emitting actions-resolved to room (${room.players.length} players)`);
                io.to(roomCode).emit('actions-resolved', {
                  publicNarration: data.publicNarration,
                  players: room.players, // Updated with new HP from actions
                  food: room.food,
                  water: room.water,
                  mapData: room.mapData // Updated with new explored tiles
                });

                // Day advancement now happens manually via "Next Day" button
                // This allows players to see action results before advancing

              } else {
                console.error('Action resolution failed:', response.status);
                // Fallback: just notify players
                io.to(roomCode).emit('resolution-failed', {
                  message: 'Failed to resolve actions, please try again'
                });
              }
            } catch (error) {
              console.error('Error resolving actions:', error);
              io.to(roomCode).emit('resolution-failed', {
                message: 'Error resolving actions'
              });
            }
            
            // Clear pending actions
            room.pendingActions = {};
          }
        }
      }
    });


    // Handle tile exploration
    socket.on('explore-tiles', ({ tiles }) => {
      const roomCode = socket.data.roomCode;
      if (roomCode && gameRooms.has(roomCode)) {
        const room = gameRooms.get(roomCode);
        const player = room.players.find(p => p.id === socket.id);
        
        if (player && room.gameStarted && room.mapData) {
          console.log(`${player.name} exploring tiles:`, tiles);
          
          // Validate tiles exist and are not already explored
          const validTiles = tiles.filter(tile => {
            const isLand = room.mapData.landTiles.includes(tile);
            const isWater = room.mapData.waterTiles.includes(tile);
            const tileExists = isLand || isWater;
            const alreadyExplored = room.mapData.exploredTiles.includes(tile);
            return tileExists && !alreadyExplored;
          });
          
          if (validTiles.length > 0) {
            // Add new tiles to explored list
            const newExploredTiles = [...new Set([...room.mapData.exploredTiles, ...validTiles])];
            room.mapData.exploredTiles = newExploredTiles;
            
            console.log(`Tiles explored. Total explored: ${newExploredTiles.length}`);
            
            // Broadcast updated map to all players
            io.to(roomCode).emit('map-updated', {
              mapData: room.mapData,
              resourceStates: room.resourceStates || {}
            });
          }
        }
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
    .listen(port, hostname, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
    });
});
