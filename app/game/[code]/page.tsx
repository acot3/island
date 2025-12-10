'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  joinedAt: number;
}

export default function GameRoom() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;
  const [playerName, setPlayerName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  
  // Map state
  const [mapData, setMapData] = useState<{
    landTiles: Set<string>;
    waterTiles: Set<string>;
    startingTile: string;
  } | null>(null);

  // Initialize Socket.io connection
  useEffect(() => {
    const socketInstance = io();
    setSocket(socketInstance);
    setMyPlayerId(socketInstance.id);

    // Listen for room updates
    socketInstance.on('room-update', ({ players, gameStarted }) => {
      console.log('Room update received:', players);
      setPlayers(players);
      setGameStarted(gameStarted);
    });

    // Listen for game start
    socketInstance.on('game-start', ({ players }) => {
      console.log('Game starting!', players);
      setPlayers(players);
      setGameStarted(true);
    });

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const handleJoinRoom = () => {
    if (playerName.trim() && socket) {
      setHasJoined(true);
      
      // Send join request to server
      socket.emit('join-room', {
        roomCode: code,
        playerName: playerName.trim(),
      });
    }
  };

  const handleLeaveRoom = () => {
    if (socket) {
      socket.emit('leave-room');
    }
    router.push('/');
  };

  const handleToggleReady = () => {
    if (socket) {
      socket.emit('toggle-ready');
    }
  };

  // Get current player's ready state
  const myPlayer = players.find(p => p.id === socket?.id);
  const isReady = myPlayer?.isReady || false;

  // Map generation functions
  const generateMap = () => {
    const mapSize = 5;
    const getTileKey = (row: number, col: number) => `${row},${col}`;
    
    // Flood fill to check if all land tiles are connected (cardinal directions only)
    const isConnected = (landTiles: Set<string>) => {
      if (landTiles.size === 0) return false;
      
      const visited = new Set<string>();
      const queue: string[] = [];
      
      // Start from first land tile
      const startTile = landTiles.values().next().value;
      queue.push(startTile);
      visited.add(startTile);
      
      while (queue.length > 0) {
        const current = queue.shift()!;
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
    const allTilesHaveTwoNeighbors = (landTiles: Set<string>) => {
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
    
    // Keep trying until we get a connected island
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
      const landTiles = new Set<string>();
      const waterTiles = new Set<string>();
      
      // Start with all tiles as land
      for (let row = 0; row < mapSize; row++) {
        for (let col = 0; col < mapSize; col++) {
          landTiles.add(getTileKey(row, col));
        }
      }
      
      // Get all edge tiles
      const edgeTiles: string[] = [];
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
        // Find all beach tiles
        const beachTiles: string[] = [];
        for (const tile of landTiles) {
          const [row, col] = tile.split(',').map(Number);
          if (isBeachTile(row, col, landTiles, waterTiles)) {
            beachTiles.push(tile);
          }
        }
        
        // Randomly select a starting tile from beach tiles
        const startingTile = beachTiles.length > 0 
          ? beachTiles[Math.floor(Math.random() * beachTiles.length)]
          : landTiles.values().next().value; // Fallback to any land tile
        
        return { landTiles, waterTiles, startingTile };
      }
      
      attempts++;
    }
    
    // Fallback: return a simple connected island (all edges are land)
    const landTiles = new Set<string>();
    const waterTiles = new Set<string>();
    for (let row = 0; row < mapSize; row++) {
      for (let col = 0; col < mapSize; col++) {
        landTiles.add(getTileKey(row, col));
      }
    }
    const startingTile = getTileKey(0, 0); // Fallback starting position
    return { landTiles, waterTiles, startingTile };
  };
  
  // Check if a land tile touches water (making it a beach)
  // Only checks cardinal directions (up, down, left, right) - NOT diagonals
  const isBeachTile = (row: number, col: number, landTiles: Set<string>, waterTiles: Set<string>) => {
    const getTileKey = (r: number, c: number) => `${r},${c}`;
    const mapSize = 5;
    
    // Check only 4 cardinal directions (not diagonals)
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
  
  // Generate map when game starts
  useEffect(() => {
    if (gameStarted && !mapData) {
      const map = generateMap();
      setMapData(map);
    }
  }, [gameStarted, mapData]);

  // If player hasn't entered their name yet
  if (!hasJoined) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        justifyContent: 'center', 
        minHeight: '100vh',
        fontFamily: 'Arial, sans-serif',
        backgroundImage: 'url(/bg.png)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed'
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center',
          minWidth: '300px'
        }}>
          <h1 style={{ marginBottom: '10px', color: '#333' }}>Game Room</h1>
          <h2 style={{ 
            fontSize: '32px', 
            color: '#4CAF50', 
            letterSpacing: '5px',
            marginBottom: '30px'
          }}>
            {code}
          </h2>

          <p style={{ marginBottom: '20px', color: '#666' }}>
            Enter your name to join:
          </p>

          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleJoinRoom()}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '16px',
              border: '2px solid #ddd',
              borderRadius: '4px',
              marginBottom: '15px'
            }}
          />

          <button
            onClick={handleJoinRoom}
            disabled={!playerName.trim()}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              backgroundColor: playerName.trim() ? '#4CAF50' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: playerName.trim() ? 'pointer' : 'not-allowed',
              marginBottom: '15px'
            }}
          >
            Join Game
          </button>

          <button
            onClick={() => router.push('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#2196F3',
              textDecoration: 'none',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            ← Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  // If game has started, show game screen
  if (gameStarted) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f5f5f5',
        overflow: 'hidden'
      }}>
        {/* Top section - 75% height, split into left (66.67%) and right (33.33%) */}
        <div style={{
          display: 'flex',
          height: '75%',
          width: '100%'
        }}>
          {/* Left section - 2/3 width */}
          <div style={{
            width: '66.67%',
            height: '100%',
            backgroundColor: '#e3f2fd',
            border: '2px solid #2196F3',
            padding: '20px',
            overflow: 'auto',
            boxSizing: 'border-box'
          }}>
            <h2 style={{ color: '#333', marginBottom: '10px' }}>Main Game Area</h2>
            <p style={{ color: '#666' }}>Map, exploration, etc. will go here</p>
          </div>

          {/* Right section - 1/3 width, split into top and bottom halves */}
          <div style={{
            width: '33.33%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* Right Top - 66.67% of right panel (2:1 ratio) - MAP */}
            <div style={{
              height: '66.67%',
              backgroundColor: '#f3e5f5',
              border: '2px solid #9C27B0',
              padding: '20px',
              overflow: 'auto',
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}>
              <h2 style={{ color: '#333', marginBottom: '15px', fontSize: '18px' }}>Island Map</h2>
              
              {mapData ? (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 65px)',
                  gridTemplateRows: 'repeat(5, 65px)',
                  gap: '0px',
                  border: '2px solid #333'
                }}>
                  {Array.from({ length: 5 }, (_, row) =>
                    Array.from({ length: 5 }, (_, col) => {
                      const tileKey = `${row},${col}`;
                      const isWater = mapData.waterTiles.has(tileKey);
                      const isLand = mapData.landTiles.has(tileKey);
                      const isBeach = isLand && isBeachTile(row, col, mapData.landTiles, mapData.waterTiles);
                      const isStartingTile = tileKey === mapData.startingTile;
                      
                      let backgroundColor = '#424242'; // Default (shouldn't happen)
                      if (isWater) {
                        backgroundColor = '#4a90e2'; // Water - blue
                      } else if (isBeach) {
                        backgroundColor = '#e6d1b5'; // Beach - tan
                      } else {
                        backgroundColor = '#4ea354'; // Grass - green
                      }
                      
                      return (
                        <div
                          key={tileKey}
                          style={{
                            width: '65px',
                            height: '65px',
                            backgroundColor,
                            border: isStartingTile ? '3px solid #c94d57' : '1px solid #999',
                            position: 'relative',
                            boxSizing: 'border-box'
                          }}
                        >
                          {isStartingTile && (
                            <img 
                              src="/shipwreck.png" 
                              alt="Shipwreck"
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'contain',
                                position: 'absolute',
                                top: 0,
                                left: 0
                              }}
                            />
                          )}
                        </div>
                      );
                    })
                  ).flat()}
                </div>
              ) : (
                <p style={{ color: '#666' }}>Generating map...</p>
              )}
            </div>

            {/* Right Bottom - 33.33% of right panel (2:1 ratio) */}
            <div style={{
              height: '33.33%',
              backgroundColor: '#e8f5e9',
              border: '2px solid #4CAF50',
              padding: '20px',
              overflow: 'auto',
              boxSizing: 'border-box'
            }}>
              <h2 style={{ color: '#333', marginBottom: '15px', fontSize: '18px' }}>Players</h2>
              {players.map((player) => (
                <div 
                  key={player.id}
                  style={{
                    padding: '8px',
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    fontSize: '14px'
                  }}
                >
                  <span style={{ color: '#4CAF50', fontWeight: 'bold' }}>●</span> {player.name}
                  {player.name === playerName && (
                    <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>(you)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom section - 25% height */}
        <div style={{
          height: '25%',
          width: '100%',
          backgroundColor: '#fff3e0',
          border: '2px solid #FF9800',
          padding: '20px',
          overflow: 'auto',
          boxSizing: 'border-box'
        }}>
          <h2 style={{ color: '#333', marginBottom: '10px' }}>Bottom Action Bar</h2>
          <p style={{ color: '#666' }}>Actions, controls, current activity info will go here</p>
          <button
            onClick={handleLeaveRoom}
            style={{
              marginTop: '10px',
              padding: '10px 20px',
              fontSize: '14px',
              backgroundColor: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Leave Game
          </button>
        </div>
      </div>
    );
  }

  // After player has joined (but game hasn't started yet)
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      fontFamily: 'Arial, sans-serif',
      backgroundImage: 'url(/bg.png)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed'
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        textAlign: 'center',
        minWidth: '400px'
      }}>
        <h1 style={{ marginBottom: '10px', color: '#333' }}>Game Room</h1>
        <h2 style={{ 
          fontSize: '32px', 
          color: '#4CAF50', 
          letterSpacing: '5px',
          marginBottom: '30px'
        }}>
          {code}
        </h2>

        <div style={{
          padding: '20px',
          backgroundColor: '#f9f9f9',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <h3 style={{ marginBottom: '15px', color: '#333' }}>
            Players in Lobby ({players.length}):
          </h3>
          {players.map((player) => (
            <div 
              key={player.id}
              style={{
                padding: '10px',
                backgroundColor: player.isReady ? '#e8f5e9' : 'white',
                border: player.isReady ? '2px solid #4CAF50' : '2px solid transparent',
                borderRadius: '4px',
                marginBottom: '10px',
                textAlign: 'left',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <span style={{ color: '#4CAF50', fontWeight: 'bold' }}>●</span> {player.name}
                {player.name === playerName && (
                  <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>(you)</span>
                )}
              </div>
              {player.isReady && (
                <span style={{ color: '#4CAF50', fontSize: '20px' }}>✓</span>
              )}
            </div>
          ))}
          {players.length === 1 && (
            <p style={{ 
              fontSize: '14px', 
              color: '#666',
              marginTop: '15px'
            }}>
              Waiting for other players to join...
            </p>
          )}
        </div>

        <button
          onClick={handleToggleReady}
          style={{
            width: '100%',
            padding: '15px',
            fontSize: '18px',
            fontWeight: 'bold',
            backgroundColor: isReady ? '#f44336' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            marginBottom: '20px'
          }}
        >
          {isReady ? 'Not Ready' : 'Ready'}
        </button>

        <div style={{
          padding: '15px',
          backgroundColor: '#e3f2fd',
          borderRadius: '4px',
          marginBottom: '20px'
        }}>
          <p style={{ fontSize: '14px', color: '#333', marginBottom: '5px' }}>
            Share this code with friends:
          </p>
          <p style={{ 
            fontSize: '24px', 
            fontWeight: 'bold',
            letterSpacing: '3px',
            color: '#2196F3'
          }}>
            {code}
          </p>
        </div>

        <button
          onClick={handleLeaveRoom}
          style={{
            background: 'none',
            border: 'none',
            color: '#f44336',
            textDecoration: 'none',
            fontSize: '14px',
            cursor: 'pointer'
          }}
        >
          Leave Game
        </button>
      </div>
    </div>
  );
}
