'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const router = useRouter();

  // Generate a random 4-character code
  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0, O, I, 1
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleCreateGame = () => {
    const code = generateCode();
    router.push(`/game/${code}`);
  };

  const handleJoinGame = () => {
    if (joinCode.trim().length === 4) {
      router.push(`/game/${joinCode.toUpperCase()}`);
    }
  };

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
        <h1 style={{ marginBottom: '30px', color: '#333' }}>Island Game</h1>
        
        <button 
          onClick={handleCreateGame}
          style={{
            width: '100%',
            padding: '15px',
            margin: '10px 0',
            fontSize: '16px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Create New Game
        </button>

        <button 
          onClick={() => setShowJoinInput(!showJoinInput)}
          style={{
            width: '100%',
            padding: '15px',
            margin: '10px 0',
            fontSize: '16px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Join Existing Game
        </button>

        {showJoinInput && (
          <div style={{ marginTop: '20px' }}>
            <input
              type="text"
              placeholder="Enter 4-digit code"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={4}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '16px',
                border: '2px solid #ddd',
                borderRadius: '4px',
                textAlign: 'center',
                textTransform: 'uppercase',
                letterSpacing: '3px',
                marginBottom: '10px'
              }}
            />
            <button
              onClick={handleJoinGame}
              disabled={joinCode.length !== 4}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: '16px',
                backgroundColor: joinCode.length === 4 ? '#4CAF50' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: joinCode.length === 4 ? 'pointer' : 'not-allowed'
              }}
            >
              Join
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
