'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [isBigScreen, setIsBigScreen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const router = useRouter();

  // Detect screen size on mount and handle resize
  useEffect(() => {
    const checkScreenSize = () => {
      setIsBigScreen(window.innerWidth >= 1024);
    };

    // Check on mount
    checkScreenSize();

    // Listen for resize events
    window.addEventListener('resize', checkScreenSize);

    // Cleanup
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Generate a random 4-character code
  const generateCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  const handleStartNewGame = () => {
    const code = generateCode();
    router.push(`/game/${code}/screen`);
  };

  const handleJoinGame = () => {
    if (joinCode.trim().length === 4) {
      router.push(`/game/${joinCode.toUpperCase()}/phone`);
    }
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toUpperCase();
    // Only allow valid characters and limit to 4
    const validChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const filtered = value.split('').filter(char => validChars.includes(char)).join('').slice(0, 4);
    setJoinCode(filtered);
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
      backgroundAttachment: 'fixed',
      padding: '20px'
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
        textAlign: 'center',
        minWidth: '300px',
        maxWidth: '500px',
        width: '100%'
      }}>
        {isBigScreen ? (
          <>
            <h1 style={{ marginBottom: '30px', color: '#333' }}>Island Game - Big Screen</h1>
            <button 
              onClick={handleStartNewGame}
              style={{
                width: '100%',
                padding: '15px',
                margin: '10px 0',
                fontSize: '16px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              Start New Game
            </button>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: '30px', color: '#333' }}>Island Game</h1>
            <div style={{ marginTop: '20px' }}>
              <input
                type="text"
                placeholder="Enter 4-character code"
                value={joinCode}
                onChange={handleCodeChange}
                maxLength={4}
                style={{
                  width: '100%',
                  padding: '15px',
                  fontSize: '18px',
                  border: '2px solid #ddd',
                  borderRadius: '4px',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: '5px',
                  marginBottom: '15px',
                  fontFamily: 'monospace',
                  fontWeight: 'bold'
                }}
              />
              <button
                onClick={handleJoinGame}
                disabled={joinCode.length !== 4}
                style={{
                  width: '100%',
                  padding: '15px',
                  fontSize: '16px',
                  backgroundColor: joinCode.length === 4 ? '#4CAF50' : '#ccc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: joinCode.length === 4 ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold'
                }}
              >
                Join Game
              </button>
            </div>
          </>
        )}
      </div>
      
      <div style={{
        marginTop: '30px',
        padding: '15px',
        background: 'rgba(255, 255, 255, 0.9)',
        borderRadius: '8px',
        textAlign: 'center',
        fontSize: '14px',
        color: '#666',
        maxWidth: '500px',
        width: '100%'
      }}>
        Note: Use a large screen (TV/monitor) to host, phones to play
      </div>
    </div>
  );
}
