'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  health: number;
  injured?: boolean;
  mbtiType?: string;
}

export default function ScreenLobby() {
  const params = useParams();
  const code = params.code as string;
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [currentDay, setCurrentDay] = useState(1);
  const [food, setFood] = useState(0);
  const [water, setWater] = useState(0);
  const [narration, setNarration] = useState('');
  const [showIntroVideo, setShowIntroVideo] = useState(false);
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
  const [resourceStates, setResourceStates] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Connect to Socket.io server (same origin as Next.js app)
    const socketInstance = io(typeof window !== 'undefined' ? window.location.origin : '');

    socketInstance.on('connect', () => {
      console.log('Screen connected to socket');
      // Join the room with the code
      socketInstance.emit('join-room', { roomCode: code, isScreen: true });
    });

    // Listen for room updates
    socketInstance.on('room-update', (data: { players: Player[]; gameStarted?: boolean; currentDay?: number; food?: number; water?: number }) => {
      console.log('Room update received:', data);
      setPlayers(data.players || []);
      if (data.gameStarted !== undefined) setGameStarted(data.gameStarted);
      if (data.currentDay) setCurrentDay(data.currentDay);
      if (data.food !== undefined) setFood(data.food);
      if (data.water !== undefined) setWater(data.water);
    });

    // Listen for all players ready (show intro video)
    socketInstance.on('all-players-ready', () => {
      console.log('All players ready - showing intro video');
      setShowIntroVideo(true);
    });

    // Listen for game start
    socketInstance.on('game-start', (data: { players: Player[]; narration: string; mapData: any; resourceStates: Record<string, boolean> }) => {
      console.log('Game starting!');
      setGameStarted(true);
      setPlayers(data.players);
      if (data.narration) setNarration(data.narration);
      
      // Convert server map data (arrays) to Sets for client use
      if (data.mapData) {
        setMapData({
          landTiles: new Set(data.mapData.landTiles),
          waterTiles: new Set(data.mapData.waterTiles),
          startingTile: data.mapData.startingTile,
          resourceTiles: data.mapData.resourceTiles,
          exploredTiles: data.mapData.exploredTiles,
        });
      }
      
      if (data.resourceStates) {
        setResourceStates(data.resourceStates);
      }
    });

    // Listen for day advancement
    socketInstance.on('day-advanced', (data: { currentDay: number; players: Player[]; food: number; water: number; narration: string }) => {
      console.log('Day advanced:', data);
      setCurrentDay(data.currentDay);
      setPlayers(data.players);
      if (data.food !== undefined) setFood(data.food);
      if (data.water !== undefined) setWater(data.water);
      if (data.narration) setNarration(data.narration);
    });

    // Listen for resource updates
    socketInstance.on('resource-updated', ({ food: updatedFood, water: updatedWater, resourceStates: updatedResourceStates }) => {
      if (updatedFood !== undefined) setFood(updatedFood);
      if (updatedWater !== undefined) setWater(updatedWater);
      if (updatedResourceStates) setResourceStates(updatedResourceStates);
    });

    // Listen for map updates
    socketInstance.on('map-updated', ({ mapData: updatedMapData, resourceStates: updatedResourceStates }) => {
      if (updatedMapData) {
        setMapData({
          landTiles: new Set(updatedMapData.landTiles),
          waterTiles: new Set(updatedMapData.waterTiles),
          startingTile: updatedMapData.startingTile,
          resourceTiles: updatedMapData.resourceTiles,
          exploredTiles: updatedMapData.exploredTiles,
        });
        
        if (updatedResourceStates) {
          setResourceStates(updatedResourceStates);
        }
      }
    });

    // Listen for actions resolved
    socketInstance.on('actions-resolved', ({ publicNarration, players, food, water, mapData: updatedMapData }) => {
      console.log('Actions resolved on screen:', { publicNarration, players, food, water });
      if (publicNarration) setNarration(publicNarration);
      if (players) setPlayers(players);
      if (food !== undefined) setFood(food);
      if (water !== undefined) setWater(water);
      if (updatedMapData) {
        setMapData({
          landTiles: new Set(updatedMapData.landTiles),
          waterTiles: new Set(updatedMapData.waterTiles),
          startingTile: updatedMapData.startingTile,
          resourceTiles: updatedMapData.resourceTiles,
          exploredTiles: updatedMapData.exploredTiles,
        });
      }
    });

    socketInstance.on('disconnect', () => {
      console.log('Screen disconnected from socket');
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.off('room-update');
      socketInstance.off('all-players-ready');
      socketInstance.off('game-start');
      socketInstance.off('day-advanced');
      socketInstance.off('resource-updated');
      socketInstance.off('map-updated');
      socketInstance.off('actions-resolved');
      socketInstance.off('disconnect');
      socketInstance.off('connect_error');
      socketInstance.disconnect();
    };
  }, [code]);

  // Check if a land tile touches water (making it a beach)
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
    
    return false;
  };

  const handleAdvanceDay = () => {
    if (socket) {
      socket.emit('advance-day');
    }
  };

  // Show intro video if triggered
  if (showIntroVideo && !gameStarted) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        width: '100vw',
        backgroundColor: '#7a6a5b',
      }}>
        <video
          src="/intro2.mp4"
          autoPlay
          onEnded={() => {
            setShowIntroVideo(false);
          }}
          style={{
            maxWidth: '90%',
            maxHeight: '90vh',
            width: 'auto',
            height: 'auto',
            border: '40px solid #402812',
            borderRadius: '4px',
          }}
        />
      </div>
    );
  }

  // Show game UI if game has started
  if (gameStarted) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#f5f5f5',
        overflow: 'hidden',
      }}>
        {/* Top section - 75% height, split into left (66.67%) and right (33.33%) */}
        <div style={{
          display: 'flex',
          height: '75%',
          width: '100%'
        }}>
          {/* Left section - 2/3 width - Narration */}
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
              marginTop: '15px',
              marginBottom: '0'
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
            {/* Right Top - 66.67% of right panel - MAP */}
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
                      
                      const isExplored = mapData.exploredTiles?.includes(tileKey) || false;
                      
                      const resources = mapData.resourceTiles;
                      const isHerbs = tileKey === resources.herbs;
                      const isDeer = tileKey === resources.deer;
                      const isBottle = tileKey === resources.bottle;
                      const isCoconut = tileKey === resources.coconut;
                      const isSpring = tileKey === resources.spring;
                      const isClams = resources.clams?.includes(tileKey) || false;
                      
                      let backgroundColor = '#424242';
                      if (isExplored) {
                        if (isWater) {
                          backgroundColor = '#4a90e2';
                        } else if (isBeach) {
                          backgroundColor = '#e6d1b5';
                        } else {
                          backgroundColor = '#4ea354';
                        }
                      }
                      
                      let resourceImage: string | null = null;
                      let resourceImageOpacity = 1.0;
                      if (isExplored) {
                        if (isStartingTile) resourceImage = '/shipwreck.png';
                        else if (isHerbs) {
                          resourceImage = '/herbs.png';
                          if (resourceStates['herbs']) resourceImageOpacity = 0.4;
                        } else if (isDeer) {
                          resourceImage = '/deer.png';
                          if (resourceStates['deer']) resourceImageOpacity = 0.4;
                        } else if (isBottle) {
                          resourceImage = '/bottle.png';
                          if (resourceStates['bottle']) resourceImageOpacity = 0.4;
                        } else if (isCoconut) {
                          resourceImage = '/coconut.png';
                          if (resourceStates['coconut']) resourceImageOpacity = 0.4;
                        } else if (isSpring) {
                          resourceImage = '/spring.png';
                        } else if (isClams) {
                          resourceImage = '/clams.png';
                          if (resourceStates[`clams_${tileKey}`]) resourceImageOpacity = 0.4;
                        }
                      }
                      
                      let borderStyle = '1px solid #999';
                      if (isStartingTile && isExplored) {
                        borderStyle = '3px solid #c94d57';
                      }
                      
                      return (
                        <div
                          key={tileKey}
                          style={{
                            width: '65px',
                            height: '65px',
                            backgroundColor,
                            border: borderStyle,
                            position: 'relative',
                            boxSizing: 'border-box',
                            opacity: isExplored ? 1 : 0.6,
                            transition: 'border-color 0.2s',
                            overflow: 'hidden'
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
                                left: '12.5%',
                                opacity: resourceImageOpacity
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

            {/* Right Bottom - 33.33% of right panel - Resources */}
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

        {/* Bottom section - 25% height - Players */}
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
          {/* Next Day button */}
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
          
          {/* Player cards */}
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
                <div style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  marginBottom: '15px',
                  color: '#333',
                  position: 'relative'
                }}>
                  {player.name}
                  {player.injured && (
                    <img 
                      src="/ankle.png" 
                      alt="Injured"
                      style={{
                        position: 'absolute',
                        top: '0',
                        right: '0',
                        width: '32px',
                        height: '32px',
                        objectFit: 'contain'
                      }}
                    />
                  )}
                </div>

                <div style={{
                  fontSize: '18px',
                  color: '#666',
                  marginBottom: '8px'
                }}>
                  Health: {player.health}/10
                </div>

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
                    transition: 'width 0.3s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Lobby view (before game starts)
  return (
    <div style={{
      minHeight: '100vh',
      minWidth: '100vw',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Arial, sans-serif',
      backgroundImage: 'url(/bg.png)',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundAttachment: 'fixed',
      padding: '40px'
    }}>
      <div style={{
        background: 'white',
        padding: '60px',
        borderRadius: '16px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        textAlign: 'center',
        maxWidth: '900px',
        width: '100%'
      }}>
        {/* Room Code - Large and prominent */}
        <div style={{
          marginBottom: '40px'
        }}>
          <h2 style={{
            fontSize: '32px',
            color: '#666',
            marginBottom: '15px',
            fontWeight: 'normal'
          }}>
            Room Code
          </h2>
          <div style={{
            fontSize: '72px',
            fontWeight: 'bold',
            color: '#333',
            letterSpacing: '15px',
            fontFamily: 'monospace',
            padding: '20px',
            background: '#f5f5f5',
            borderRadius: '12px',
            border: '3px solid #4CAF50'
          }}>
            {code}
          </div>
        </div>

        {/* Waiting Message */}
        <h3 style={{
          fontSize: '28px',
          color: '#666',
          marginBottom: '30px',
          fontWeight: 'normal'
        }}>
          Waiting for players to join...
        </h3>

        {/* Player Count */}
        <div style={{
          fontSize: '24px',
          color: '#333',
          marginBottom: '30px',
          fontWeight: 'bold'
        }}>
          Players: {players.length}
        </div>

        {/* Player List */}
        <div style={{
          marginBottom: '30px',
          minHeight: '200px'
        }}>
          {players.length === 0 ? (
            <div style={{
              fontSize: '18px',
              color: '#999',
              padding: '40px',
              fontStyle: 'italic'
            }}>
              No players yet. Waiting for players to join...
            </div>
          ) : (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '15px',
              alignItems: 'stretch'
            }}>
              {players.map((player) => (
                <div
                  key={player.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '20px 30px',
                    background: '#f9f9f9',
                    borderRadius: '8px',
                    border: '2px solid #e0e0e0',
                    fontSize: '22px'
                  }}
                >
                  <span style={{
                    color: '#333',
                    fontWeight: '500'
                  }}>
                    {player.name}
                  </span>
                  {player.isReady && (
                    <span style={{
                      color: '#4CAF50',
                      fontSize: '28px',
                      fontWeight: 'bold'
                    }}>
                      ✓
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Join Instructions */}
        <div style={{
          fontSize: '20px',
          color: '#666',
          padding: '25px',
          background: '#f0f8ff',
          borderRadius: '8px',
          border: '2px solid #2196F3',
          lineHeight: '1.6'
        }}>
          <div style={{ marginBottom: '10px', fontWeight: 'bold', color: '#2196F3' }}>
            📱 How to Join
          </div>
          <div>
            Players join at <strong style={{ fontFamily: 'monospace', fontSize: '22px' }}>
              {typeof window !== 'undefined' ? window.location.origin : ''}/game/{code}
            </strong> on their phones
          </div>
        </div>
      </div>
    </div>
  );
}
