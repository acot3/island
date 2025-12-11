'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  health: number;
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
  const [currentDay, setCurrentDay] = useState(1);
  const [showDayTransition, setShowDayTransition] = useState(false);
  const [isTransitionActive, setIsTransitionActive] = useState(false);
  const [transitionText, setTransitionText] = useState('');
  const [food, setFood] = useState(0);
  const [water, setWater] = useState(0);
  const [narration, setNarration] = useState('');
  const justAdvancedDayRef = useRef(false);
  
  // Map state
  const [mapData, setMapData] = useState<{
    landTiles: Set<string>;
    waterTiles: Set<string>;
    startingTile: string;
    resourceTiles: {
      herbs?: string;
      deer?: string;
      bottle?: string;
      coconut?: string;
      spring?: string;
      clams?: string[];
    };
    exploredTiles?: string[];
  } | null>(null);

  // Initialize Socket.io connection
  useEffect(() => {
    const socketInstance = io();
    setSocket(socketInstance);
    setMyPlayerId(socketInstance.id);

    // Listen for room updates
    socketInstance.on('room-update', ({ players, gameStarted, currentDay, food, water }) => {
      console.log('Room update received:', players);
      setPlayers(players);
      setGameStarted(gameStarted);
      if (currentDay) setCurrentDay(currentDay);
      if (food !== undefined) setFood(food);
      if (water !== undefined) setWater(water);
    });

    // Listen for game start
    socketInstance.on('game-start', ({ players, narration, mapData: serverMapData }) => {
      console.log('Game starting!', players);
      setPlayers(players);
      setGameStarted(true);
      setCurrentDay(1); // Reset to day 1 when game starts
      if (narration) setNarration(narration);
      
      // Convert server map data (arrays) to Sets for client use
      if (serverMapData) {
        setMapData({
          landTiles: new Set(serverMapData.landTiles),
          waterTiles: new Set(serverMapData.waterTiles),
          startingTile: serverMapData.startingTile,
          resourceTiles: serverMapData.resourceTiles,
          exploredTiles: serverMapData.exploredTiles,
        });
      }
      
      justAdvancedDayRef.current = true; // Prevent animation on initial load
    });

    // Listen for day advancement
    socketInstance.on('day-advanced', async ({ currentDay, players, food, water, narration }) => {
      console.log('Day advanced to:', currentDay);
      
      // Only show animation if this player didn't initiate the change AND game has already started
      if (!justAdvancedDayRef.current && currentDay > 1) {
        const oldDay = currentDay - 1;
        await showDayTransitionAnimation(oldDay, currentDay);
      }
      
      // Reset the flag
      justAdvancedDayRef.current = false;
      
      setCurrentDay(currentDay);
      setPlayers(players);
      if (food !== undefined) setFood(food);
      if (water !== undefined) setWater(water);
      if (narration) setNarration(narration);
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

  const handleAdvanceDay = async () => {
    if (socket) {
      // Trigger the animation before sending event
      const oldDay = currentDay;
      const newDay = currentDay + 1;
      
      // Mark that this player initiated the day change
      justAdvancedDayRef.current = true;
      
      // Show day transition animation
      await showDayTransitionAnimation(oldDay, newDay);
      
      // After animation, send event to server
      socket.emit('advance-day');
    }
  };

  const showDayTransitionAnimation = (oldDay: number, newDay: number): Promise<void> => {
    return new Promise((resolve) => {
      // Start: Show overlay and old day
      setTransitionText(`Day ${oldDay}`);
      setShowDayTransition(true);
      
      // After a brief moment, activate the transition (triggers fade-in)
      setTimeout(() => {
        setIsTransitionActive(true);
      }, 10);
      
      // After overlay fades in (1200ms), show text
      setTimeout(() => {
        const textElement = document.querySelector('.day-transition-text');
        if (textElement) textElement.classList.add('show');
      }, 1200);
      
      // After showing old day (800ms), switch to new day
      setTimeout(() => {
        setTransitionText(`Day ${newDay}`);
      }, 2000);
      
      // After showing new day (800ms more), fade out text
      setTimeout(() => {
        const textElement = document.querySelector('.day-transition-text');
        if (textElement) textElement.classList.remove('show');
      }, 2800);
      
      // After text fades out, fade out overlay
      setTimeout(() => {
        setIsTransitionActive(false);
        // Wait for fade out to complete, then remove from DOM
        setTimeout(() => {
          setShowDayTransition(false);
          resolve();
        }, 1200);
      }, 3300);
    });
  };

  // Get current player's ready state
  const myPlayer = players.find(p => p.id === socket?.id);
  const isReady = myPlayer?.isReady || false;

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
  
  // Map is now received from server, no need to generate locally

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
      <>
        {/* Day transition overlay - only render when active */}
        {showDayTransition && (
          <div className={`day-transition-overlay ${isTransitionActive ? 'active' : ''}`}>
            <div className="day-transition-text">
              {transitionText}
            </div>
          </div>
        )}

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
            <h2 style={{ color: '#333', marginBottom: '10px' }}>Day {currentDay}</h2>
            <p style={{ 
              color: '#333', 
              fontSize: '16px', 
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              marginTop: '15px'
            }}>
              {narration || 'Click "Next Day" to begin your journey...'}
            </p>
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
              alignItems: 'center',
              justifyContent: 'center'
            }}>
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
                      
                      // Check if this tile has a resource
                      const resources = mapData.resourceTiles;
                      const isHerbs = tileKey === resources.herbs;
                      const isDeer = tileKey === resources.deer;
                      const isBottle = tileKey === resources.bottle;
                      const isCoconut = tileKey === resources.coconut;
                      const isSpring = tileKey === resources.spring;
                      const isClams = resources.clams?.includes(tileKey);
                      
                      let backgroundColor = '#424242'; // Default (shouldn't happen)
                      if (isWater) {
                        backgroundColor = '#4a90e2'; // Water - blue
                      } else if (isBeach) {
                        backgroundColor = '#e6d1b5'; // Beach - tan
                      } else {
                        backgroundColor = '#4ea354'; // Grass - green
                      }
                      
                      // Determine which image to show (priority order)
                      let resourceImage: string | null = null;
                      if (isStartingTile) resourceImage = '/shipwreck.png';
                      else if (isHerbs) resourceImage = '/herbs.png';
                      else if (isDeer) resourceImage = '/deer.png';
                      else if (isBottle) resourceImage = '/bottle.png';
                      else if (isCoconut) resourceImage = '/coconut.png';
                      else if (isSpring) resourceImage = '/spring.png';
                      else if (isClams) resourceImage = '/clams.png';
                      
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
                          {resourceImage && (
                            <img 
                              src={resourceImage}
                              alt="Resource"
                              style={{
                                width: '75%',
                                height: '75%',
                                objectFit: 'contain',
                                position: 'absolute',
                                top: '12.5%',
                                left: '12.5%'
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
              boxSizing: 'border-box',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center'
            }}>
              <div style={{
                display: 'flex',
                gap: '35px',
                alignItems: 'center'
              }}>
                {/* Food Resource */}
                <div style={{
                  position: 'relative',
                  width: '80px',
                  height: '80px'
                }}>
                  <img 
                    src="/carrot.png" 
                    alt="Food"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '5px',
                    right: '5px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    border: '2px solid white',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}>
                    {food}
                  </div>
                </div>

                {/* Water Resource */}
                <div style={{
                  position: 'relative',
                  width: '80px',
                  height: '80px'
                }}>
                  <img 
                    src="/water.png" 
                    alt="Water"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                  />
                  <div style={{
                    position: 'absolute',
                    bottom: '5px',
                    right: '5px',
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    backgroundColor: '#2196F3',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    border: '2px solid white',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }}>
                    {water}
                  </div>
                </div>
              </div>
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
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          position: 'relative'
        }}>
          {/* Next Day button - positioned on right side, vertically centered */}
          <button
            onClick={handleAdvanceDay}
            style={{
              position: 'absolute',
              right: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 'bold',
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              zIndex: 10
            }}
          >
            Next Day →
          </button>
          
          {/* Player cards container */}
          <div style={{
            display: 'flex',
            gap: '22px',
            flexWrap: 'wrap',
            alignItems: 'center',
            height: '100%'
          }}>
            {players.map((player) => (
              <div
                key={player.id}
                style={{
                  backgroundColor: 'white',
                  padding: '22px',
                  borderRadius: '12px',
                  border: '2px solid #ddd',
                  minWidth: '200px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {/* Player name */}
                <div style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  marginBottom: '15px',
                  color: '#333'
                }}>
                  {player.name}
                  {player.name === playerName && (
                    <span style={{ color: '#666', fontSize: '18px', marginLeft: '8px', fontWeight: 'normal' }}>(you)</span>
                  )}
                </div>

                {/* Health label */}
                <div style={{
                  fontSize: '18px',
                  color: '#666',
                  marginBottom: '8px'
                }}>
                  Health: {player.health}/10
                </div>

                {/* Health bar */}
                <div style={{
                  width: '100%',
                  height: '30px',
                  backgroundColor: '#e0e0e0',
                  borderRadius: '15px',
                  overflow: 'hidden',
                  border: '1px solid #999'
                }}>
                  <div style={{
                    width: `${(player.health / 10) * 100}%`,
                    height: '100%',
                    backgroundColor: '#c94d57',
                    transition: 'width 0.3s ease, background-color 0.3s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
      </>
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
