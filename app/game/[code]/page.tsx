'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { io, Socket } from 'socket.io-client';

interface Player {
  id: string;
  name: string;
  mbtiType?: string;
  isReady: boolean;
  health: number;
  joinedAt: number;
  injured?: boolean;
}

export default function GameRoom() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;
  const [playerName, setPlayerName] = useState('');
  const [mbtiType, setMbtiType] = useState('');
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
  const [originalNarration, setOriginalNarration] = useState('');
  const [choices, setChoices] = useState<Array<{
    id: string;
    text: string;
    type: string;
    resource?: string;
  }>>([]);
  const [exploringMode, setExploringMode] = useState(false);
  const [firstTileSelected, setFirstTileSelected] = useState<string | null>(null);
  const [secondTileSelected, setSecondTileSelected] = useState<string | null>(null);
  const [explorationComplete, setExplorationComplete] = useState(false);
  const [hasExploredToday, setHasExploredToday] = useState(false);
  const [resourceSelectionMode, setResourceSelectionMode] = useState(false);
  const [resourceType, setResourceType] = useState<'food' | 'water' | null>(null);
  const [selectedResourceTile, setSelectedResourceTile] = useState<string | null>(null);
  const [resourceGatheringComplete, setResourceGatheringComplete] = useState(false);
  const [foodGathered, setFoodGathered] = useState<number | null>(null);
  const [waterGathered, setWaterGathered] = useState<number | null>(null);
  const justAdvancedDayRef = useRef(false);
  const gameStartedRef = useRef(false);
  const [isInjured, setIsInjured] = useState(false);
  const [resourceStates, setResourceStates] = useState<Record<string, boolean>>({});
  const [isInitializing, setIsInitializing] = useState(false);
  const [showIntroVideo, setShowIntroVideo] = useState(false);
  const [videoPageOpacity, setVideoPageOpacity] = useState(0);
  const [gamePageOpacity, setGamePageOpacity] = useState(0);
  const [lobbyPageOpacity, setLobbyPageOpacity] = useState(1);
  
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
    if (socketInstance.id) {
      setMyPlayerId(socketInstance.id);
    }

    // Listen for room updates
    socketInstance.on('room-update', ({ players, gameStarted, currentDay, food, water }) => {
      console.log('Room update received:', players);
      setPlayers(players);
      setGameStarted(gameStarted);
      gameStartedRef.current = gameStarted; // Update ref
      if (currentDay) setCurrentDay(currentDay);
      if (food !== undefined) setFood(food);
      if (water !== undefined) setWater(water);
      
      // Check if all players are ready - if so, show intro video immediately
      // (API call happens in parallel while video plays)
      const allReady = players.length > 0 && players.every((p: Player) => p.isReady);
      if (allReady && !gameStarted) {
        console.log('Setting isInitializing to true from room-update - all players ready, showing video');
        setIsInitializing(true);
        // Fade out lobby, then fade in video
        setLobbyPageOpacity(0);
        setTimeout(() => {
          setShowIntroVideo(true); // Show video immediately while API processes
          setVideoPageOpacity(1);
        }, 500); // Wait for lobby fade out
      }
      // Don't clear isInitializing here - only clear it when game-start is received
      
      // Sync injury state from server
      const myPlayer = players.find((p: Player) => p.id === socketInstance.id);
      if (myPlayer) {
        setIsInjured(myPlayer.injured || false);
      }
    });

    // Listen for game start (this happens in parallel while video is playing)
    socketInstance.on('game-start', ({ players, narration, choices: gameChoices, mapData: serverMapData, resourceStates: serverResourceStates }) => {
      console.log('Game starting!', players);
      setPlayers(players);
      setGameStarted(true);
      gameStartedRef.current = true; // Update ref for video end handler
      console.log('Clearing isInitializing - game data received');
      setIsInitializing(false); // Clear loading state when game data arrives
      // Don't set showIntroVideo here - it's already showing if all players were ready
      setCurrentDay(1); // Reset to day 1 when game starts
      if (narration) setNarration(narration);
      if (gameChoices) setChoices(gameChoices);
      
      // Reset exploration state
      setHasExploredToday(false);
      setExploringMode(false);
      setFirstTileSelected(null);
      setSecondTileSelected(null);
      setExplorationComplete(false);
      setIsInjured(false);
      // Reset resource gathering state
      setResourceSelectionMode(false);
      setResourceType(null);
      setSelectedResourceTile(null);
      setResourceGatheringComplete(false);
      setFoodGathered(null);
      setWaterGathered(null);

      // Set resource states
      if (serverResourceStates) {
        setResourceStates(serverResourceStates);
      }
      
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
    socketInstance.on('day-advanced', async ({ currentDay, players, food, water, narration, choices: dayChoices }) => {
      console.log('Day advanced to:', currentDay, 'with', dayChoices?.length || 0, 'choices:', dayChoices);
      
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
      
      // Always use server's narration (it's the source of truth with accurate state)
      if (narration) setNarration(narration);
      if (dayChoices) setChoices(dayChoices);
      
      // Sync injury state from server (injury persists through one day advance)
      const myPlayer = players.find((p: Player) => p.id === socketInstance.id);
      if (myPlayer) {
        setIsInjured(myPlayer.injured || false);
      } else {
        setIsInjured(false);
      }
      
      // Reset exploration state for new day
      setHasExploredToday(false);
      setExploringMode(false);
      setFirstTileSelected(null);
      setSecondTileSelected(null);
      setExplorationComplete(false);
      // Reset resource gathering state for new day
      setResourceSelectionMode(false);
      setResourceType(null);
      setSelectedResourceTile(null);
      setResourceGatheringComplete(false);
      setFoodGathered(null);
      setWaterGathered(null);
      setOriginalNarration('');
    });

    // Listen for resource updates
    socketInstance.on('resource-updated', ({ food: updatedFood, water: updatedWater, resourceStates: updatedResourceStates }) => {
      console.log('Resource update received:', { food: updatedFood, water: updatedWater });
      if (updatedFood !== undefined) {
        setFood(updatedFood);
      }
      if (updatedWater !== undefined) {
        setWater(updatedWater);
      }
      if (updatedResourceStates) {
        setResourceStates(updatedResourceStates);
      }
    });

    // Listen for map updates (after exploration)
    socketInstance.on('map-updated', ({ mapData: updatedMapData, resourceStates: updatedResourceStates }) => {
      console.log('Map updated');
      if (updatedMapData) {
        setMapData({
          landTiles: new Set(updatedMapData.landTiles),
          waterTiles: new Set(updatedMapData.waterTiles),
          startingTile: updatedMapData.startingTile,
          resourceTiles: updatedMapData.resourceTiles,
          exploredTiles: updatedMapData.exploredTiles,
        });
        
        // Update resource states
        if (updatedResourceStates) {
          setResourceStates(updatedResourceStates);
        }
        
        // Don't exit exploration mode here - let the flow continue
        // The explorationComplete state and narration will handle the UI
      }
    });

    // Cleanup on unmount
    return () => {
      socketInstance.disconnect();
    };
  }, []);

  // Watch for when all players become ready (show intro video immediately)
  useEffect(() => {
    if (!gameStarted && players.length > 0) {
      const allReady = players.every((p: Player) => p.isReady);
      if (allReady) {
        console.log('All players ready detected in useEffect - showing intro video');
        setIsInitializing(true);
        // Fade out lobby, then fade in video
        setLobbyPageOpacity(0);
        setTimeout(() => {
          setShowIntroVideo(true); // Show video immediately while API processes in background
          setVideoPageOpacity(1);
        }, 500); // Wait for lobby fade out
      } else {
        // If not all ready, clear initialization state
        setIsInitializing(false);
        setShowIntroVideo(false);
        setVideoPageOpacity(0);
        setLobbyPageOpacity(1);
      }
    }
  }, [players, gameStarted]);

  // Handle fade transition when video page should hide
  useEffect(() => {
    if (!showIntroVideo && videoPageOpacity > 0) {
      // Fade out video page
      setVideoPageOpacity(0);
      // After fade out, fade in game page
      setTimeout(() => {
        if (gameStarted) {
          setGamePageOpacity(1);
        }
      }, 500); // Wait for fade out to complete
    }
  }, [showIntroVideo, gameStarted]);

  // Handle fade in game page when game starts (if video already ended)
  useEffect(() => {
    if (gameStarted && !showIntroVideo && gamePageOpacity === 0) {
      // Fade in game page
      setTimeout(() => setGamePageOpacity(1), 10);
    }
  }, [gameStarted, showIntroVideo, gamePageOpacity]);

  const handleJoinRoom = () => {
    if (playerName.trim() && mbtiType && socket) {
      setHasJoined(true);
      
      // Send join request to server
      socket.emit('join-room', {
        roomCode: code,
        playerName: playerName.trim(),
        mbtiType: mbtiType,
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
      const myPlayer = players.find((p: Player) => p.id === socket.id);
      const iAmReady = myPlayer?.isReady || false;
      
      // Optimistically update local players state to reflect the toggle
      // This will trigger the useEffect to check if all players are ready
      setPlayers(prevPlayers => {
        const updated = prevPlayers.map(p => 
          p.id === socket.id ? { ...p, isReady: !iAmReady } : p
        );
        
        // Check if all players will be ready after this toggle
        const allReady = updated.length > 0 && updated.every(p => p.isReady);
        if (allReady && !gameStarted) {
          console.log('All players will be ready after toggle - showing video immediately');
          setIsInitializing(true);
          // Fade out lobby, then fade in video
          setLobbyPageOpacity(0);
          setTimeout(() => {
            setShowIntroVideo(true); // Show video immediately while API processes
            setVideoPageOpacity(1);
          }, 500); // Wait for lobby fade out
        }
        
        return updated;
      });
      
      socket.emit('toggle-ready');
    }
  };

  const handleAdvanceDay = async () => {
    if (socket) {
      const oldDay = currentDay;
      const newDay = currentDay + 1;
      
      // Mark that this player initiated the day change
      justAdvancedDayRef.current = true;
      
      // Send event to server IMMEDIATELY so it can start processing (API call) in parallel
      // while we show the animation
      socket.emit('advance-day');
      
      // Show day transition animation while server processes
      await showDayTransitionAnimation(oldDay, newDay);
      
      // After animation, we'll receive the 'day-advanced' event from server with narration
      // The narration should be ready (or nearly ready) by now since server was processing in parallel
    }
  };

  const handleChoiceSelect = (choice: { id: string; text: string; type: string; resource?: string }) => {
    if (socket) {
      console.log('Player selected choice:', choice);
      
      if (choice.type === 'explore') {
        // Check if player has already explored today or is injured
        if (hasExploredToday || isInjured) {
          return; // Can't explore twice in one day or when injured
        }
        
        // Enter exploration mode
        setOriginalNarration(narration); // Save original narration
        setExploringMode(true);
        setFirstTileSelected(null);
        setSecondTileSelected(null);
        setExplorationComplete(false);
        setNarration('Where do you want to explore? Click a tile adjacent to the starting point.');
      } else if (choice.type === 'collect' && choice.resource) {
        // Enter resource selection mode
        setOriginalNarration(narration); // Save original narration
        setResourceSelectionMode(true);
        setResourceType(choice.resource as 'food' | 'water');
        setSelectedResourceTile(null);
        setResourceGatheringComplete(false);
        setFoodGathered(null);
        setWaterGathered(null);
        setNarration(`Select a ${choice.resource === 'food' ? 'food' : 'water'} resource to ${choice.resource === 'food' ? 'gather' : 'collect'} from.`);
      } else {
        // For other choices, send to server
        socket.emit('select-choice', {
          choiceId: choice.id,
          choiceType: choice.type,
          resource: choice.resource
        });
      }
    }
  };

  // Helper function to check if two tiles are adjacent (including diagonal)
  const areTilesAdjacent = (tile1: string, tile2: string): boolean => {
    const [row1, col1] = tile1.split(',').map(Number);
    const [row2, col2] = tile2.split(',').map(Number);
    const rowDiff = Math.abs(row1 - row2);
    const colDiff = Math.abs(col1 - col2);
    return rowDiff <= 1 && colDiff <= 1 && (rowDiff > 0 || colDiff > 0);
  };

  // Generate narration for a discovered tile
  const getTileDiscoveryNarration = (tileKey: string): string => {
    if (!mapData) return '';
    
    const isWater = mapData.waterTiles.has(tileKey);
    const isLand = mapData.landTiles.has(tileKey);
    
    if (isWater) {
      return 'In this direction is only the open sea.';
    }
    
    if (isLand) {
      const [row, col] = tileKey.split(',').map(Number);
      const isBeach = isBeachTile(row, col, mapData.landTiles, mapData.waterTiles);
      
      if (isBeach) {
        return 'You discover a new stretch of shoreline.';
      } else {
        return 'You discover an open plain of grass.';
      }
    }
    
    return '';
  };

  // Helper function to check if a resource is depleted
  const isResourceDepleted = (tileKey: string): boolean => {
    if (!mapData || !resourceStates) return false;
    
    const resources = mapData.resourceTiles;
    const isSpring = tileKey === resources.spring;
    
    // Spring is infinite, never depleted
    if (isSpring) return false;
    
    // Check if this resource is marked as depleted
    if (tileKey === resources.herbs) {
      return resourceStates['herbs'] || false;
    } else if (tileKey === resources.deer) {
      return resourceStates['deer'] || false;
    } else if (tileKey === resources.coconut) {
      return resourceStates['coconut'] || false;
    } else if (tileKey === resources.bottle) {
      return resourceStates['bottle'] || false;
    } else if (resources.clams?.includes(tileKey)) {
      return resourceStates[`clams_${tileKey}`] || false;
    }
    
    return false;
  };

  // Handle resource tile click during resource selection
  const handleResourceTileClick = (row: number, col: number) => {
    if (!resourceSelectionMode || !mapData || !resourceType || resourceGatheringComplete) return;

    const tileKey = `${row},${col}`;
    const resources = mapData.resourceTiles;
    
    // Check if this tile has the correct resource type
    let isValidResource = false;
    if (resourceType === 'food') {
      const hasClams = resources.clams?.includes(tileKey) || false;
      isValidResource = tileKey === resources.herbs || 
                       tileKey === resources.deer || 
                       tileKey === resources.coconut ||
                       hasClams;
    } else if (resourceType === 'water') {
      isValidResource = tileKey === resources.bottle || 
                       tileKey === resources.spring;
    }
    
    if (!isValidResource) {
      return; // Not a valid resource for this type
    }
    
    // Check if resource is depleted (spring is never depleted)
    if (isResourceDepleted(tileKey)) {
      return; // Can't gather from depleted resources
    }
    
    // Check if tile is explored
    const isExplored = mapData.exploredTiles?.includes(tileKey) || false;
    if (!isExplored) {
      return; // Can't gather from unexplored tiles
    }
    
    // Select the resource tile
    setSelectedResourceTile(tileKey);
    setResourceGatheringComplete(true);
    
    // Update narration
    const actionText = resourceType === 'food' ? 'gathering some food' : 'collecting some water';
    setNarration(`You spend the day ${actionText} from the nearby area.`);
    
    // Optimistically update resources on client side
    let foodAmount: number | undefined = undefined;
    let waterAmount: number | undefined = undefined;
    if (resourceType === 'food') {
      // Randomly select 2-4 food
      foodAmount = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
      setFoodGathered(foodAmount);
      setFood(prevFood => {
        const newFood = prevFood + foodAmount!;
        console.log('Optimistically updating food from', prevFood, 'to', newFood, `(+${foodAmount})`);
        return newFood;
      });
    } else if (resourceType === 'water') {
      // Randomly select 2-4 water
      waterAmount = Math.floor(Math.random() * 3) + 2; // 2, 3, or 4
      setWaterGathered(waterAmount);
      setWater(prevWater => {
        const newWater = prevWater + waterAmount!;
        console.log('Optimistically updating water from', prevWater, 'to', newWater, `(+${waterAmount})`);
        return newWater;
      });
    }
    
    // Send to server to update resources
    if (socket) {
      console.log('Emitting gather-resource:', { resourceType, tileKey, foodAmount, waterAmount });
      socket.emit('gather-resource', {
        resourceType: resourceType,
        tileKey: tileKey,
        foodAmount: foodAmount,
        waterAmount: waterAmount
      });
    }
  };

  // Handle map tile click during exploration
  const handleMapTileClick = (row: number, col: number) => {
    if (!exploringMode || !mapData || explorationComplete || isInjured) return;
    
    const tileKey = `${row},${col}`;
    const startingTile = mapData.startingTile;
    
    // Check if tile exists (must be either land or water)
    const tileExists = mapData.landTiles.has(tileKey) || mapData.waterTiles.has(tileKey);
    if (!tileExists) {
      return; // Tile doesn't exist
    }
    
    if (!firstTileSelected) {
      // First click: must be adjacent to starting tile (can be already explored)
      if (areTilesAdjacent(tileKey, startingTile)) {
        // Check for injury on first tile selection (25% chance)
        const firstInjuryRoll = Math.random();
        if (firstInjuryRoll < 0.25) {
          // Player is injured
          setIsInjured(true);
          setNarration('You sprain your ankle trying to navigate the hazardous terrain. With great difficulty, you make your way back to camp.');
          setExplorationComplete(true);
          setHasExploredToday(true);
          
          // Notify server of injury
          if (socket) {
            socket.emit('player-injured', {});
          }
          
          return; // Don't proceed with tile reveal
        }
        
        setFirstTileSelected(tileKey);
        console.log('First tile selected:', tileKey);
        
        // Check if first tile is already explored
        const firstIsExplored = mapData.exploredTiles?.includes(tileKey) || false;
        if (firstIsExplored) {
          setNarration('You make your way through familiar territory. Now choose a second tile to explore.');
        } else {
          // Reveal the first tile immediately if it's unrevealed
          const tilesToExplore = [tileKey];
          console.log('Exploring first tile:', tileKey);
          
          if (socket) {
            socket.emit('explore-tiles', {
              tiles: tilesToExplore
            });
          }
          
          // Update local state immediately for better UX
          if (mapData.exploredTiles) {
            const updatedExploredTiles = [...mapData.exploredTiles, tileKey];
            setMapData({
              ...mapData,
              exploredTiles: updatedExploredTiles
            });
          }
          
          // Generate narration for first tile discovery
          const discoveryNarration = getTileDiscoveryNarration(tileKey);
          setNarration(`${discoveryNarration} Now choose a second tile adjacent to this one.`);
        }
      } else {
        console.log('First tile must be adjacent to starting tile');
      }
    } else if (!secondTileSelected) {
      // Second click: must be adjacent to first tile
      if (areTilesAdjacent(tileKey, firstTileSelected)) {
        // Check for injury on second tile selection (25% chance)
        const secondInjuryRoll = Math.random();
        if (secondInjuryRoll < 0.25) {
          // Player is injured
          setIsInjured(true);
          setNarration('You sprain your ankle trying to navigate the hazardous terrain. With great difficulty, you make your way back to camp.');
          setExplorationComplete(true);
          setHasExploredToday(true);
          
          // Notify server of injury
          if (socket) {
            socket.emit('player-injured', {});
          }
          
          return; // Don't proceed with tile reveal
        }
        
        const isAlreadyExplored = mapData.exploredTiles?.includes(tileKey);
        
        setSecondTileSelected(tileKey);
        
        if (isAlreadyExplored) {
          // Already explored tile - show waste message
          setNarration('You\'ve already been here. What a waste of energy.');
          setExplorationComplete(true);
          setHasExploredToday(true);
        } else {
          // Generate narration for second tile discovery
          const discoveryNarration = getTileDiscoveryNarration(tileKey);
          setNarration(discoveryNarration);
          
          // Only explore the second tile (first was already explored when selected)
          const tilesToExplore = [tileKey];
          
          console.log('Exploring second tile:', tileKey);
          
          if (socket) {
            socket.emit('explore-tiles', {
              tiles: tilesToExplore
            });
          }
          
          // Update local state immediately for better UX
          if (mapData.exploredTiles) {
            const updatedExploredTiles = [...mapData.exploredTiles, tileKey];
            setMapData({
              ...mapData,
              exploredTiles: updatedExploredTiles
            });
          }
          
          // Mark exploration as complete (narration stays as discovery message)
          setExplorationComplete(true);
          setHasExploredToday(true);
        }
      } else {
        console.log('Second tile must be adjacent to first tile');
      }
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
  const myPlayer = players.find((p: Player) => p.id === socket?.id);
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
            Enter your information to join:
          </p>

          <input
            type="text"
            placeholder="Your name"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '16px',
              border: '2px solid #ddd',
              borderRadius: '4px',
              marginBottom: '15px'
            }}
          />

          <select
            value={mbtiType}
            onChange={(e) => setMbtiType(e.target.value)}
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '16px',
              border: '2px solid #ddd',
              borderRadius: '4px',
              marginBottom: '15px',
              backgroundColor: 'white',
              cursor: 'pointer'
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

          <button
            onClick={handleJoinRoom}
            disabled={!playerName.trim() || !mbtiType}
            style={{
              width: '100%',
              padding: '15px',
              fontSize: '16px',
              backgroundColor: (playerName.trim() && mbtiType) ? '#4CAF50' : '#ccc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: (playerName.trim() && mbtiType) ? 'pointer' : 'not-allowed',
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

  // Show intro video if it should be displayed (either game started or all players ready)
  if (showIntroVideo) {
      return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            width: '100vw',
            backgroundColor: '#7a6a5b', // Video page background
            opacity: videoPageOpacity,
            transition: 'opacity 0.5s ease-in-out',
          }}>
          <video
            src="/intro2.mp4"
            autoPlay
            onEnded={() => {
              // Video ended - proceed to game if data is ready, otherwise wait
              if (gameStartedRef.current) {
                setShowIntroVideo(false);
              } else {
                // Video ended but game data not ready yet - wait a bit
                // The game-start event will set gameStartedRef.current, then we can proceed
                const checkInterval = setInterval(() => {
                  if (gameStartedRef.current) {
                    setShowIntroVideo(false);
                    clearInterval(checkInterval);
                  }
                }, 100);
                // Safety timeout - proceed after 5 seconds even if data not ready
                setTimeout(() => {
                  clearInterval(checkInterval);
                  setShowIntroVideo(false);
                }, 5000);
              }
            }}
            style={{
              maxWidth: '90%',
              maxHeight: '90vh',
              width: 'auto',
              height: 'auto',
              border: '40px solid #402812', // Video border color
              borderRadius: '4px',
            }}
          />
        </div>
      );
  }

  // If game has started, show game screen (after video ends)
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
          overflow: 'hidden',
          opacity: gamePageOpacity,
          transition: 'opacity 0.5s ease-in-out',
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
              marginTop: '15px',
              marginBottom: choices.length > 0 ? '20px' : '0'
            }}>
              {isInjured && !exploringMode && !explorationComplete ? 'You need to rest in order to recover from your injury.' : (narration || 'Click "Next Day" to begin your journey...')}
            </p>
            
            {/* Ankle image - shown when injury occurs during exploration */}
            {isInjured && explorationComplete && narration.includes('sprain your ankle') && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                marginTop: '15px',
                marginBottom: '20px'
              }}>
                <img 
                  src="/ankle.png" 
                  alt="Sprained ankle"
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'contain'
                  }}
                />
              </div>
            )}
            
            {/* Food gathering display - show carrot icon and +[#] when food is gathered */}
            {resourceType === 'food' && resourceGatheringComplete && foodGathered !== null && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                marginTop: '15px',
                marginBottom: '20px'
              }}>
                <img 
                  src="/carrot.png" 
                  alt="Food"
                  style={{
                    width: '40px',
                    height: '40px',
                    objectFit: 'contain'
                  }}
                />
                <span style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#4CAF50'
                }}>
                  +{foodGathered}
                </span>
              </div>
            )}

            {/* Water gathering display - show water icon and +[#] when water is gathered */}
            {resourceType === 'water' && resourceGatheringComplete && waterGathered !== null && (
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '10px',
                marginTop: '15px',
                marginBottom: '20px'
              }}>
                <img
                  src="/water.png"
                  alt="Water"
                  style={{
                    width: '40px',
                    height: '40px',
                    objectFit: 'contain'
                  }}
                />
                <span style={{
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#2196F3'
                }}>
                  +{waterGathered}
                </span>
              </div>
            )}

            {/* Choices - hidden during exploration, resource selection, after completion, and when injured */}
            {choices.length > 0 && !exploringMode && !explorationComplete && !resourceSelectionMode && !resourceGatheringComplete && !isInjured && (
              <div style={{
                marginTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <h3 style={{ 
                  color: '#333', 
                  fontSize: '18px', 
                  marginBottom: '10px',
                  fontWeight: 'bold'
                }}>
                  What do you want to do?
                </h3>
                {choices.map((choice) => {
                  const isDisabled = (choice.type === 'explore' && (hasExploredToday || isInjured));
                  return (
                    <button
                      key={choice.id}
                      onClick={() => handleChoiceSelect(choice)}
                      disabled={isDisabled}
                      style={{
                        padding: '12px 20px',
                        fontSize: '16px',
                        backgroundColor: isDisabled ? '#ccc' : '#2196F3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        transition: 'background-color 0.2s',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                        opacity: isDisabled ? 0.6 : 1
                      }}
                      onMouseEnter={(e) => {
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = '#1976D2';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isDisabled) {
                          e.currentTarget.style.backgroundColor = '#2196F3';
                        }
                      }}
                    >
                      {choice.text}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Exploration instructions - shown during exploration but not after completion or injury */}
            {exploringMode && !explorationComplete && !isInjured && (
              <div style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: '#fff3cd',
                border: '2px solid #ffc107',
                borderRadius: '6px'
              }}>
                <p style={{ 
                  color: '#856404', 
                  fontSize: '16px', 
                  margin: '0 0 10px 0',
                  fontWeight: 'bold'
                }}>
                  {firstTileSelected 
                    ? 'Now click a second tile adjacent to your first selection.'
                    : 'Click a tile adjacent to the starting tile to begin exploring.'}
                </p>
                <button
                  onClick={() => {
                    setExploringMode(false);
                    setFirstTileSelected(null);
                    setSecondTileSelected(null);
                    if (originalNarration) {
                      setNarration(originalNarration);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel Exploration
                </button>
              </div>
            )}

            {/* Go to sleep button - shown after exploration is complete or when injured */}
            {(explorationComplete || isInjured) && (
              <div style={{
                marginTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                {!isInjured && (
                  <p style={{ 
                    color: '#333', 
                    fontSize: '16px', 
                    lineHeight: '1.6',
                    marginTop: '15px',
                    marginBottom: '10px'
                  }}>
                    You're tired from the day's exploration.
                  </p>
                )}
                <button
                  onClick={handleAdvanceDay}
                  style={{
                    padding: '12px 20px',
                    fontSize: '16px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#45a049';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#4CAF50';
                  }}
                >
                  Go to sleep
                </button>
              </div>
            )}

            {/* Resource selection instructions - shown during resource selection but not after completion */}
            {resourceSelectionMode && !resourceGatheringComplete && (
              <div style={{
                marginTop: '20px',
                padding: '15px',
                backgroundColor: '#fff3cd',
                border: '2px solid #ffc107',
                borderRadius: '6px'
              }}>
                <p style={{ 
                  color: '#856404', 
                  fontSize: '16px', 
                  margin: '0 0 10px 0',
                  fontWeight: 'bold'
                }}>
                  Click a {resourceType === 'food' ? 'food' : 'water'} resource tile to {resourceType === 'food' ? 'gather' : 'collect'} from.
                </p>
                <button
                  onClick={() => {
                    setResourceSelectionMode(false);
                    setResourceType(null);
                    setSelectedResourceTile(null);
                    if (originalNarration) {
                      setNarration(originalNarration);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '14px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Go to sleep button - shown after resource gathering is complete */}
            {resourceGatheringComplete && (
              <div style={{
                marginTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <button
                  onClick={handleAdvanceDay}
                  style={{
                    padding: '12px 20px',
                    fontSize: '16px',
                    backgroundColor: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#45a049';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#4CAF50';
                  }}
                >
                  Go to sleep
                </button>
              </div>
            )}
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
                      
                      // Check if tile is explored (fog of war)
                      const isExplored = mapData.exploredTiles?.includes(tileKey) || false;
                      
                      // Check if this tile has a resource
                      const resources = mapData.resourceTiles;
                      const isHerbs = tileKey === resources.herbs;
                      const isDeer = tileKey === resources.deer;
                      const isBottle = tileKey === resources.bottle;
                      const isCoconut = tileKey === resources.coconut;
                      const isSpring = tileKey === resources.spring;
                      const isClams = resources.clams?.includes(tileKey) || false;
                      
                      // Check if tile is clickable during exploration
                      let isClickable = false;
                      let isHighlighted = false;
                      const tileExists = isLand || isWater;
                      if (exploringMode && tileExists) {
                        if (!firstTileSelected) {
                          // First click: must be adjacent to starting tile (can be explored)
                          isClickable = areTilesAdjacent(tileKey, mapData.startingTile);
                        } else {
                          // Second click: must be adjacent to first tile (can be explored or not)
                          isClickable = areTilesAdjacent(tileKey, firstTileSelected);
                        }
                        isHighlighted = isClickable;
                      }
                      
                      // Check if tile is clickable during resource selection
                      let isResourceClickable = false;
                      let isResourceHighlighted = false;
                      if (resourceSelectionMode && resourceType && isExplored) {
                        // Check if resource is depleted (spring is never depleted)
                        const isDepleted = isResourceDepleted(tileKey);
                        
                        if (!isDepleted) {
                          if (resourceType === 'food') {
                            isResourceClickable = isHerbs || isDeer || isCoconut || (isClams || false);
                          } else if (resourceType === 'water') {
                            isResourceClickable = isBottle || isSpring;
                          }
                        }
                        isResourceHighlighted = isResourceClickable && !resourceGatheringComplete;
                      }
                      
                      // Check if this is the selected first tile
                      const isFirstSelected = tileKey === firstTileSelected;
                      
                      // Fog of war: if not explored, show dark grey fog
                      let backgroundColor = '#424242'; // Default fog color
                      if (isExplored) {
                        // Only show actual colors if explored
                        if (isWater) {
                          backgroundColor = '#4a90e2'; // Water - blue
                        } else if (isBeach) {
                          backgroundColor = '#e6d1b5'; // Beach - tan
                        } else {
                          backgroundColor = '#4ea354'; // Grass - green
                        }
                      }
                      
                      // Determine which image to show (priority order) - only if explored
                      let resourceImage: string | null = null;
                      let resourceImageOpacity = 1.0;
                      if (isExplored) {
                        if (isStartingTile) resourceImage = '/shipwreck.png';
                        else if (isHerbs) {
                          resourceImage = '/herbs.png';
                          if (isResourceDepleted(tileKey)) resourceImageOpacity = 0.4;
                        } else if (isDeer) {
                          resourceImage = '/deer.png';
                          if (isResourceDepleted(tileKey)) resourceImageOpacity = 0.4;
                        } else if (isBottle) {
                          resourceImage = '/bottle.png';
                          if (isResourceDepleted(tileKey)) resourceImageOpacity = 0.4;
                        } else if (isCoconut) {
                          resourceImage = '/coconut.png';
                          if (isResourceDepleted(tileKey)) resourceImageOpacity = 0.4;
                        } else if (isSpring) {
                          resourceImage = '/spring.png';
                          // Spring is never depleted
                        } else if (isClams) {
                          resourceImage = '/clams.png';
                          if (isResourceDepleted(tileKey)) resourceImageOpacity = 0.4;
                        }
                      }
                      
                      // Check if this is a selected exploration tile
                      const isSecondSelected = tileKey === secondTileSelected;
                      
                      // Determine border style
                      // During exploration, red border "moves" from starting tile → first selected → second selected
                      // Only one tile has red border at a time
                      let borderStyle = '1px solid #999';
                      if (exploringMode) {
                        // During exploration mode
                        if (isSecondSelected) {
                          // Second tile selected - only this one gets red border
                          borderStyle = '3px solid #c94d57'; // Red border on second selected (matches starting tile color)
                        } else if (isFirstSelected && !secondTileSelected) {
                          // First tile selected, but second not yet selected - first gets red border
                          borderStyle = '3px solid #c94d57'; // Red border on first selected (matches starting tile color)
                        } else if (isHighlighted && !explorationComplete) {
                          // Only show yellow border if exploration is not complete
                          borderStyle = '3px solid #FFD700'; // Yellow border for clickable tiles
                        }
                        // Starting tile doesn't get red border during exploration
                      } else if (resourceSelectionMode) {
                        // During resource selection mode
                        if (isResourceHighlighted && !resourceGatheringComplete) {
                          borderStyle = '3px solid #FFD700'; // Yellow border for clickable resource tiles
                        } else if (tileKey === selectedResourceTile) {
                          borderStyle = '3px solid #c94d57'; // Red border on selected resource tile
                        } else if (isStartingTile && isExplored) {
                          borderStyle = '1px solid #999'; // Normal border for starting tile during resource selection
                        }
                      } else {
                        // Not in exploration or resource selection mode - normal borders
                        if (isStartingTile && isExplored) {
                          borderStyle = '3px solid #c94d57'; // Red border for starting tile
                        } else if (isHighlighted) {
                          borderStyle = '3px solid #FFD700'; // Yellow border for clickable tiles
                        }
                      }
                      
                      // Determine which click handler to use
                      const handleTileClick = resourceSelectionMode 
                        ? () => handleResourceTileClick(row, col)
                        : () => handleMapTileClick(row, col);
                      
                      // Determine if tile should be clickable
                      const tileClickable = resourceSelectionMode 
                        ? isResourceClickable && !resourceGatheringComplete
                        : isClickable;
                      
                      return (
                        <div
                          key={tileKey}
                          onClick={handleTileClick}
                          style={{
                            width: '65px',
                            height: '65px',
                            backgroundColor,
                            border: borderStyle,
                            position: 'relative',
                            boxSizing: 'border-box',
                            opacity: isExplored ? 1 : 0.6, // Slightly dim fogged tiles
                            cursor: tileClickable ? 'pointer' : 'default',
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
                  color: '#333',
                  position: 'relative'
                }}>
                  {player.name}
                  {player.name === playerName && (
                    <span style={{ color: '#666', fontSize: '18px', marginLeft: '8px', fontWeight: 'normal' }}>(you)</span>
                  )}
                  {(player.injured || (player.id === socket?.id && isInjured)) && (
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
      backgroundAttachment: 'fixed',
      opacity: lobbyPageOpacity,
      transition: 'opacity 0.5s ease-in-out',
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
          {players.length === 1 && !isInitializing && (
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
          disabled={isInitializing}
          style={{
            width: '100%',
            padding: '15px',
            fontSize: '18px',
            fontWeight: 'bold',
            backgroundColor: isInitializing ? '#ccc' : (isReady ? '#f44336' : '#4CAF50'),
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isInitializing ? 'not-allowed' : 'pointer',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px'
          }}
        >
          {isInitializing ? (
            <>
              Loading
              <span className="loading-spinner" style={{
                display: 'inline-block',
                width: '18px',
                height: '18px',
                border: '2px solid rgba(255, 255, 255, 0.3)',
                borderTop: '2px solid white',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
                flexShrink: 0
              }}></span>
            </>
          ) : (
            isReady ? 'Not Ready' : 'Ready'
          )}
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
