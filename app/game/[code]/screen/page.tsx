'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  isReady: boolean;
}

export default function ScreenLobby() {
  const params = useParams();
  const code = params.code as string;
  const [players, setPlayers] = useState<Player[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Connect to Socket.io server (same origin as Next.js app)
    const socketInstance = io(typeof window !== 'undefined' ? window.location.origin : '');

    socketInstance.on('connect', () => {
      console.log('Screen connected to socket');
      // Join the room with the code
      socketInstance.emit('join-room', { roomCode: code, isScreen: true });
    });

    // Listen for room updates
    socketInstance.on('room-update', (data: { players: Player[] }) => {
      console.log('Room update received:', data);
      setPlayers(data.players || []);
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
      socketInstance.disconnect();
    };
  }, [code]);

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
