'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
  health?: number;
  injured?: boolean;
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
  const [narration, setNarration] = useState('');
  const [isInjured, setIsInjured] = useState(false);
  
  // Action input state
  const [playerAction, setPlayerAction] = useState('');
  const [hasSubmittedAction, setHasSubmittedAction] = useState(false);
  const [submittedPlayers, setSubmittedPlayers] = useState<Set<string>>(new Set());
  const [privateOutcome, setPrivateOutcome] = useState<{
    narration: string;
    resourcesFound: { food: number; water: number };
    itemsFound: string[];
    factsLearned: string[];
    hpChange: number;
  } | null>(null);
  const [mapData, setMapData] = useState<{
    landTiles: Set<string>;
    waterTiles: Set<string>;
    startingTile: string;
    resourceTiles: any;
    exploredTiles: string[];
  } | null>(null);

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
      
      // Sync ready state and injury status from server
      const currentPlayerId = socketInstance.id;
      if (currentPlayerId && data.players) {
        const currentPlayer = data.players.find(p => p.id === currentPlayerId);
        if (currentPlayer) {
          setIsReady(currentPlayer.isReady);
          setIsInjured(currentPlayer.injured || false);
        }
      }
    });

    // Listen for game start
    socketInstance.on('game-start', (data: { players: Player[]; narration?: string }) => {
      console.log('Game starting!');
      setGameStarted(true);
      if (data.players) {
        setPlayers(data.players);
        // Sync injury status
        const currentPlayerId = socketInstance.id;
        if (currentPlayerId) {
          const currentPlayer = data.players.find(p => p.id === currentPlayerId);
          if (currentPlayer) {
            setIsInjured(currentPlayer.injured || false);
          }
        }
      }
      if (data.narration) {
        setNarration(data.narration);
      }
      // Reset action submission state when game starts
      setHasSubmittedAction(false);
      setSubmittedPlayers(new Set());
    });

    socketInstance.on('all-players-ready', () => {
      console.log('All players ready!');
    });

    // Listen for day advancement to update player health
    socketInstance.on('day-advanced', (data: { players: Player[]; narration?: string }) => {
      if (data.players) {
        setPlayers(data.players);
        // Sync injury status
        const currentPlayerId = socketInstance.id;
        if (currentPlayerId) {
          const currentPlayer = data.players.find(p => p.id === currentPlayerId);
          if (currentPlayer) {
            setIsInjured(currentPlayer.injured || false);
          }
        }
      }
      if (data.narration) {
        setNarration(data.narration);
      }
      // Reset action submission state when day advances
      setHasSubmittedAction(false);
      setSubmittedPlayers(new Set());
      // Clear private outcome when day advances
      setPrivateOutcome(null);
    });

    // Listen for action submissions
    socketInstance.on('action-submitted', ({ playerId, playerName, totalSubmitted, totalPlayers }) => {
      console.log(`${playerName} submitted action. ${totalSubmitted}/${totalPlayers} submitted.`);
      setSubmittedPlayers(prev => new Set([...prev, playerId]));
    });

    // Listen for all actions submitted
    socketInstance.on('all-actions-submitted', () => {
      console.log('All players have submitted actions!');
      // For now, just log - Phase 3 will handle resolution
    });

    // Listen for action resolution starting
    socketInstance.on('resolving-actions', () => {
      console.log('Actions are being resolved...');
      // Show loading state
      setNarration('Resolving actions...');
    });

    // Listen for actions resolved
    socketInstance.on('actions-resolved', ({ publicNarration, players, food, water, mapData: newMapData }) => {
      console.log('Actions resolved!');
      
      // Update game state
      setNarration(publicNarration);
      setPlayers(players);
      if (newMapData) {
        setMapData({
          landTiles: new Set(newMapData.landTiles),
          waterTiles: new Set(newMapData.waterTiles),
          startingTile: newMapData.startingTile,
          resourceTiles: newMapData.resourceTiles,
          exploredTiles: newMapData.exploredTiles
        });
      }
      
      // Reset action input
      setPlayerAction('');
      setHasSubmittedAction(false);
    });

    // Listen for private outcome
    socketInstance.on('private-outcome', ({ privateNarration, resourcesFound, itemsFound, factsLearned, hpChange }) => {
      console.log('Private outcome received:', { resourcesFound, hpChange });
      
      // Display private outcome to player
      setPrivateOutcome({
        narration: privateNarration,
        resourcesFound,
        itemsFound,
        factsLearned,
        hpChange
      });
    });

    // Listen for resolution failure
    socketInstance.on('resolution-failed', ({ message }) => {
      console.error('Action resolution failed:', message);
      // Could show an error message to the user here
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
      socketInstance.off('room-update');
      socketInstance.off('game-start');
      socketInstance.off('all-players-ready');
      socketInstance.off('day-advanced');
      socketInstance.off('action-submitted');
      socketInstance.off('all-actions-submitted');
      socketInstance.off('resolving-actions');
      socketInstance.off('actions-resolved');
      socketInstance.off('private-outcome');
      socketInstance.off('resolution-failed');
      socketInstance.off('disconnect');
      socketInstance.off('connect_error');
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

  const handleSubmitAction = () => {
    if (!playerAction.trim() || hasSubmittedAction || isInjured) return;
    
    if (socket) {
      socket.emit('submit-action', {
        action: playerAction.trim()
      });
      setHasSubmittedAction(true);
      // Immediately add current player to submitted set for instant feedback
      if (socket.id) {
        setSubmittedPlayers(prev => new Set([...prev, socket.id!]));
      }
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

  // After game starts - Show game-playing UI
  if (gameStarted) {
    const myPlayer = players.find(p => p.id === socket?.id);
    const canSubmitAction = playerAction.trim().length > 0 && !hasSubmittedAction && !isInjured;
    
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
          maxWidth: '400px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          {/* Narration Display Area */}
          <div style={{
            padding: '20px',
            background: '#e3f2fd',
            borderRadius: '8px',
            border: '2px solid #2196F3',
            minHeight: '120px',
            maxHeight: '200px',
            overflow: 'auto'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#333',
              marginBottom: '12px',
              marginTop: '0'
            }}>
              Story
            </h3>
            <p style={{
              color: '#333',
              fontSize: '14px',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              margin: '0'
            }}>
              {narration || 'The story begins...'}
            </p>
          </div>

          {/* Private Outcome Display */}
          {privateOutcome && (
            <div style={{
              marginTop: '0',
              padding: '15px',
              backgroundColor: '#e8f5e9',
              border: '2px solid #4CAF50',
              borderRadius: '6px'
            }}>
              <h4 style={{ margin: '0 0 10px 0', color: '#2e7d32', fontSize: '16px', fontWeight: 'bold' }}>Your Results:</h4>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px', lineHeight: '1.6', color: '#333' }}>{privateOutcome.narration}</p>
              
              {(privateOutcome.resourcesFound.food > 0 || privateOutcome.resourcesFound.water > 0) && (
                <div style={{ marginTop: '10px', fontSize: '14px', color: '#2e7d32' }}>
                  {privateOutcome.resourcesFound.food > 0 && (
                    <div style={{ marginBottom: '4px' }}>✓ Found {privateOutcome.resourcesFound.food} food</div>
                  )}
                  {privateOutcome.resourcesFound.water > 0 && (
                    <div>✓ Found {privateOutcome.resourcesFound.water} water</div>
                  )}
                </div>
              )}
              
              {privateOutcome.hpChange !== 0 && (
                <div style={{ 
                  marginTop: '10px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: privateOutcome.hpChange > 0 ? '#2e7d32' : '#c62828'
                }}>
                  HP: {privateOutcome.hpChange > 0 ? '+' : ''}{privateOutcome.hpChange}
                </div>
              )}
            </div>
          )}

          {/* Action Input Section */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            {/* Injury Indicator */}
            {isInjured && (
              <div style={{
                padding: '12px',
                background: '#ffe0b2',
                borderRadius: '6px',
                border: '1px solid #ff9800',
                fontSize: '14px',
                color: '#e65100',
                textAlign: 'center'
              }}>
                You are injured and cannot act this turn. Rest and recover.
              </div>
            )}

            {/* Status Indicator */}
            {hasSubmittedAction && (
              <div style={{
                padding: '12px',
                background: '#c8e6c9',
                borderRadius: '6px',
                border: '1px solid #4CAF50',
                fontSize: '14px',
                color: '#2e7d32',
                textAlign: 'center',
                fontWeight: '500'
              }}>
                ✓ Action submitted - waiting for other players...
              </div>
            )}

            {/* Textarea */}
            <textarea
              value={playerAction}
              onChange={(e) => setPlayerAction(e.target.value.slice(0, 500))}
              placeholder="What do you do? (e.g., 'I explore the jungle' or 'I search for food')"
              maxLength={500}
              rows={4}
              disabled={hasSubmittedAction || isInjured}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '6px',
                boxSizing: 'border-box',
                fontFamily: 'Arial, sans-serif',
                resize: 'vertical',
                backgroundColor: hasSubmittedAction || isInjured ? '#f5f5f5' : 'white',
                color: hasSubmittedAction || isInjured ? '#999' : '#333'
              }}
            />

            {/* Character Counter */}
            <div style={{
              fontSize: '12px',
              color: playerAction.length > 400 ? '#ff9800' : '#666',
              textAlign: 'right',
              marginTop: '-8px'
            }}>
              {playerAction.length} / 500 characters
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmitAction}
              disabled={!canSubmitAction}
              style={{
                width: '100%',
                padding: '16px',
                fontSize: '18px',
                fontWeight: 'bold',
                backgroundColor: canSubmitAction ? '#4CAF50' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: canSubmitAction ? 'pointer' : 'not-allowed',
                minHeight: '54px',
                transition: 'background-color 0.2s'
              }}
            >
              Submit Action
            </button>
          </div>

          {/* Player Status Indicator */}
          <div style={{
            padding: '16px',
            background: '#f9f9f9',
            borderRadius: '8px',
            border: '1px solid #ddd'
          }}>
            <div style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#333',
              marginBottom: '12px'
            }}>
              Player Status
            </div>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {players.map((player) => {
                const isSubmitted = submittedPlayers.has(player.id);
                const isInjuredPlayer = player.injured || false;
                const isCurrentPlayer = player.id === socket?.id;
                
                return (
                  <div
                    key={player.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: isCurrentPlayer ? '#e3f2fd' : 'white',
                      borderRadius: '6px',
                      border: isCurrentPlayer ? '1px solid #2196F3' : '1px solid #e0e0e0'
                    }}
                  >
                    <span style={{
                      fontSize: '14px',
                      color: '#333',
                      fontWeight: isCurrentPlayer ? '600' : '400'
                    }}>
                      {player.name}{isCurrentPlayer ? ' (You)' : ''}
                    </span>
                    <div style={{
                      fontSize: '18px',
                      display: 'flex',
                      alignItems: 'center'
                    }}>
                      {isInjuredPlayer ? (
                        <span style={{ color: '#f44336' }}>✗</span>
                      ) : isSubmitted ? (
                        <span style={{ color: '#4CAF50' }}>✓</span>
                      ) : (
                        <span style={{ color: '#999' }}>○</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Player Health Card */}
          {myPlayer && (
            <div style={{
              padding: '20px',
              background: '#f9f9f9',
              borderRadius: '8px',
              border: '1px solid #ddd'
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#333',
                marginBottom: '15px',
                textAlign: 'center'
              }}>
                {myPlayer.name}
              </div>
              {myPlayer.health !== undefined && (
                <>
                  <div style={{
                    fontSize: '16px',
                    color: '#666',
                    marginBottom: '10px',
                    textAlign: 'center'
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
