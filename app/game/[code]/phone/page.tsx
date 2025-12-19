'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  health?: number;
}

interface Stats {
  strength: number;
  intelligence: number;
  charisma: number;
}

export default function PhoneLobby() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  // Form state
  const [name, setName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [stats, setStats] = useState<Stats>({
    strength: 0,
    intelligence: 0,
    charisma: 0
  });
  const [mbtiType, setMbtiType] = useState('');

  // Game state
  const [hasJoined, setHasJoined] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameStarted, setGameStarted] = useState(false);

  // Calculate remaining points
  const totalPoints = stats.strength + stats.intelligence + stats.charisma;
  const remainingPoints = 6 - totalPoints;

  // Validation
  const canJoin = name.trim().length > 0 && 
                  pronouns.trim().length > 0 && 
                  totalPoints === 6;

  useEffect(() => {
    // Connect to Socket.io server (same origin as Next.js app)
    const socketInstance = io(typeof window !== 'undefined' ? window.location.origin : '');

    socketInstance.on('connect', () => {
      console.log('Phone connected to socket');
    });

    // Listen for room updates
    socketInstance.on('room-update', (data: { players: Player[] }) => {
      console.log('Room update received:', data);
      setPlayers(data.players || []);
      
      // Sync ready state from server
      const currentPlayerId = socketInstance.id;
      if (currentPlayerId && data.players) {
        const currentPlayer = data.players.find(p => p.id === currentPlayerId);
        if (currentPlayer) {
          setIsReady(currentPlayer.isReady);
        }
      }
    });

    // Listen for game start
    socketInstance.on('game-start', (data: { players: Player[] }) => {
      console.log('Game starting!');
      setGameStarted(true);
      if (data.players) {
        setPlayers(data.players);
      }
    });

    socketInstance.on('all-players-ready', () => {
      console.log('All players ready!');
    });

    // Listen for day advancement to update player health
    socketInstance.on('day-advanced', (data: { players: Player[] }) => {
      if (data.players) {
        setPlayers(data.players);
      }
    });

    socketInstance.on('disconnect', () => {
      console.log('Phone disconnected from socket');
    });

    socketInstance.on('connect_error', (error) => {
      console.error('Connection error:', error);
    });

    setSocket(socketInstance);

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, []);

  const handleStatChange = (stat: keyof Stats, delta: number) => {
    const newValue = stats[stat] + delta;
    const newTotal = totalPoints - stats[stat] + newValue;

    // Prevent going below 0 or exceeding 6 total points
    if (newValue >= 0 && newTotal <= 6) {
      setStats({ ...stats, [stat]: newValue });
    }
  };

  const handleJoinGame = () => {
    if (socket && canJoin) {
      socket.emit('join-room', {
        roomCode: code,
        playerName: name.trim(),
        pronouns: pronouns.trim(),
        stats: {
          strength: stats.strength,
          intelligence: stats.intelligence,
          charisma: stats.charisma
        },
        mbtiType: mbtiType || undefined
      });
      setHasJoined(true);
    }
  };

  const handleToggleReady = () => {
    if (socket) {
      socket.emit('toggle-ready');
      // Don't update local state - wait for server confirmation via room-update
    }
  };

  if (!hasJoined) {
    return (
      <div style={{
        minHeight: '100vh',
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
        padding: '20px'
      }}>
        <div style={{
          background: 'white',
          padding: '30px',
          borderRadius: '12px',
          boxShadow: '0 2px 15px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '400px'
        }}>
          {/* Room Code Header */}
          <div style={{
            textAlign: 'center',
            marginBottom: '25px'
          }}>
            <div style={{
              fontSize: '14px',
              color: '#666',
              marginBottom: '8px'
            }}>
              Room Code
            </div>
            <div style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#333',
              letterSpacing: '5px',
              fontFamily: 'monospace'
            }}>
              {code}
            </div>
          </div>

          {/* Name Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              color: '#333',
              marginBottom: '8px',
              fontWeight: '500'
            }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 20))}
              placeholder="Enter your name"
              maxLength={20}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Pronouns Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              color: '#333',
              marginBottom: '8px',
              fontWeight: '500'
            }}>
              Pronouns *
            </label>
            <input
              type="text"
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value.slice(0, 20))}
              placeholder="she/her, he/him, they/them, etc."
              maxLength={20}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* Stats Distribution */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '12px'
            }}>
              <label style={{
                fontSize: '14px',
                color: '#333',
                fontWeight: '500'
              }}>
                Distribute Stats
              </label>
              <div style={{
                fontSize: '14px',
                color: remainingPoints === 0 ? '#4CAF50' : '#FF9800',
                fontWeight: 'bold'
              }}>
                Points remaining: {remainingPoints}
              </div>
            </div>

            {/* Strength */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: '#f9f9f9',
              borderRadius: '6px',
              marginBottom: '10px'
            }}>
              <span style={{ fontSize: '16px', color: '#333', fontWeight: '500' }}>
                STR
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button
                  onClick={() => handleStatChange('strength', -1)}
                  disabled={stats.strength === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: stats.strength === 0 ? '#e0e0e0' : '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: stats.strength === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  −
                </button>
                <span style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#333',
                  minWidth: '30px',
                  textAlign: 'center'
                }}>
                  {stats.strength}
                </span>
                <button
                  onClick={() => handleStatChange('strength', 1)}
                  disabled={remainingPoints === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: remainingPoints === 0 ? '#e0e0e0' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: remainingPoints === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Intelligence */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: '#f9f9f9',
              borderRadius: '6px',
              marginBottom: '10px'
            }}>
              <span style={{ fontSize: '16px', color: '#333', fontWeight: '500' }}>
                INT
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button
                  onClick={() => handleStatChange('intelligence', -1)}
                  disabled={stats.intelligence === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: stats.intelligence === 0 ? '#e0e0e0' : '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: stats.intelligence === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  −
                </button>
                <span style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#333',
                  minWidth: '30px',
                  textAlign: 'center'
                }}>
                  {stats.intelligence}
                </span>
                <button
                  onClick={() => handleStatChange('intelligence', 1)}
                  disabled={remainingPoints === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: remainingPoints === 0 ? '#e0e0e0' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: remainingPoints === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Charisma */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px',
              background: '#f9f9f9',
              borderRadius: '6px'
            }}>
              <span style={{ fontSize: '16px', color: '#333', fontWeight: '500' }}>
                CHA
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <button
                  onClick={() => handleStatChange('charisma', -1)}
                  disabled={stats.charisma === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: stats.charisma === 0 ? '#e0e0e0' : '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: stats.charisma === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  −
                </button>
                <span style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#333',
                  minWidth: '30px',
                  textAlign: 'center'
                }}>
                  {stats.charisma}
                </span>
                <button
                  onClick={() => handleStatChange('charisma', 1)}
                  disabled={remainingPoints === 0}
                  style={{
                    width: '44px',
                    height: '44px',
                    fontSize: '24px',
                    backgroundColor: remainingPoints === 0 ? '#e0e0e0' : '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: remainingPoints === 0 ? 'not-allowed' : 'pointer',
                    fontWeight: 'bold'
                  }}
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* MBTI Dropdown */}
          <div style={{ marginBottom: '25px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              color: '#333',
              marginBottom: '8px',
              fontWeight: '500'
            }}>
              MBTI Type (Optional)
            </label>
            <select
              value={mbtiType}
              onChange={(e) => setMbtiType(e.target.value)}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                backgroundColor: 'white',
                boxSizing: 'border-box'
              }}
            >
              <option value="">Select MBTI Type</option>
              <option value="INTJ">INTJ - The Architect</option>
              <option value="INTP">INTP - The Logician</option>
              <option value="ENTJ">ENTJ - The Commander</option>
              <option value="ENTP">ENTP - The Debater</option>
              <option value="INFJ">INFJ - The Advocate</option>
              <option value="INFP">INFP - The Mediator</option>
              <option value="ENFJ">ENFJ - The Protagonist</option>
              <option value="ENFP">ENFP - The Campaigner</option>
              <option value="ISTJ">ISTJ - The Logistician</option>
              <option value="ISFJ">ISFJ - The Defender</option>
              <option value="ESTJ">ESTJ - The Executive</option>
              <option value="ESFJ">ESFJ - The Consul</option>
              <option value="ISTP">ISTP - The Virtuoso</option>
              <option value="ISFP">ISFP - The Adventurer</option>
              <option value="ESTP">ESTP - The Entrepreneur</option>
              <option value="ESFP">ESFP - The Entertainer</option>
            </select>
          </div>

          {/* Join Button */}
          <button
            onClick={handleJoinGame}
            disabled={!canJoin}
            style={{
              width: '100%',
              padding: '16px',
              fontSize: '18px',
              fontWeight: 'bold',
              backgroundColor: canJoin ? '#4CAF50' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: canJoin ? 'pointer' : 'not-allowed',
              minHeight: '54px'
            }}
          >
            Join Game
          </button>

          {!canJoin && (
            <div style={{
              marginTop: '12px',
              fontSize: '12px',
              color: '#f44336',
              textAlign: 'center'
            }}>
              {!name.trim() && 'Name required. '}
              {!pronouns.trim() && 'Pronouns required. '}
              {totalPoints !== 6 && `Must use all 6 stat points (${6 - totalPoints} remaining). `}
            </div>
          )}
        </div>
      </div>
    );
  }

  // After game starts - Show placeholder
  if (gameStarted) {
    const myPlayer = players.find(p => p.id === socket?.id);
    
    return (
      <div style={{
        minHeight: '100vh',
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
        padding: '20px'
      }}>
        <div style={{
          background: 'white',
          padding: '40px',
          borderRadius: '12px',
          boxShadow: '0 2px 15px rgba(0,0,0,0.1)',
          width: '100%',
          maxWidth: '400px',
          textAlign: 'center'
        }}>
          {/* Player Info */}
          {myPlayer && (
            <div style={{
              marginBottom: '30px',
              padding: '20px',
              background: '#f9f9f9',
              borderRadius: '8px'
            }}>
              <div style={{
                fontSize: '24px',
                fontWeight: 'bold',
                color: '#333',
                marginBottom: '15px'
              }}>
                {myPlayer.name}
              </div>
              {myPlayer.health !== undefined && (
                <>
                  <div style={{
                    fontSize: '16px',
                    color: '#666',
                    marginBottom: '10px'
                  }}>
                    Health: {myPlayer.health}/10
                  </div>
                  <div style={{
                    width: '100%',
                    height: '24px',
                    backgroundColor: '#e0e0e0',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    border: '1px solid #999'
                  }}>
                    <div style={{
                      width: `${(myPlayer.health / 10) * 100}%`,
                      height: '100%',
                      backgroundColor: '#c94d57',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Placeholder Message */}
          <div style={{
            fontSize: '20px',
            color: '#666',
            marginBottom: '20px',
            fontWeight: '500',
            lineHeight: '1.6'
          }}>
            Events are happening on-screen
          </div>

          <div style={{
            fontSize: '14px',
            color: '#999',
            fontStyle: 'italic'
          }}>
            Watch the big screen to see the game unfold
          </div>
        </div>
      </div>
    );
  }

  // After joining - Waiting lobby
  return (
    <div style={{
      minHeight: '100vh',
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
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        padding: '30px',
        borderRadius: '12px',
        boxShadow: '0 2px 15px rgba(0,0,0,0.1)',
        width: '100%',
        maxWidth: '400px'
      }}>
        {/* Room Code */}
        <div style={{
          textAlign: 'center',
          marginBottom: '25px'
        }}>
          <div style={{
            fontSize: '14px',
            color: '#666',
            marginBottom: '8px'
          }}>
            Room Code
          </div>
          <div style={{
            fontSize: '28px',
            fontWeight: 'bold',
            color: '#333',
            letterSpacing: '5px',
            fontFamily: 'monospace'
          }}>
            {code}
          </div>
        </div>

        {/* Status Message */}
        <div style={{
          textAlign: 'center',
          fontSize: '18px',
          color: '#666',
          marginBottom: '25px',
          fontWeight: '500'
        }}>
          Waiting for other players...
        </div>

        {/* Player List */}
        <div style={{ marginBottom: '25px' }}>
          <div style={{
            fontSize: '14px',
            color: '#666',
            marginBottom: '12px',
            fontWeight: '500'
          }}>
            Players in Room:
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            {players.length === 0 ? (
              <div style={{
                padding: '12px',
                background: '#f9f9f9',
                borderRadius: '6px',
                textAlign: 'center',
                color: '#999',
                fontSize: '14px'
              }}>
                No other players yet
              </div>
            ) : (
              players.map((player) => (
                <div
                  key={player.id}
                  style={{
                    padding: '12px',
                    background: '#f9f9f9',
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span style={{ fontSize: '16px', color: '#333' }}>
                    {player.name}
                  </span>
                  {player.isReady && (
                    <span style={{ color: '#4CAF50', fontSize: '18px', fontWeight: 'bold' }}>
                      ✓
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Ready Button */}
        <button
          onClick={handleToggleReady}
          style={{
            width: '100%',
            padding: '16px',
            fontSize: '18px',
            fontWeight: 'bold',
            backgroundColor: isReady ? '#f44336' : '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            minHeight: '54px',
            marginBottom: '15px'
          }}
        >
          {isReady ? 'Not Ready' : 'Ready'}
        </button>

        {/* Waiting Message */}
        <div style={{
          textAlign: 'center',
          fontSize: '14px',
          color: '#666',
          fontStyle: 'italic'
        }}>
          Waiting for all players to be ready...
        </div>
      </div>
    </div>
  );
}
