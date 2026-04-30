const socket = io();

initMinimap(socket, document.getElementById('minimap'));

const narrationContent = document.getElementById('narration-content');
const debugPanel = document.getElementById('debug');
const debugToggle = document.getElementById('debug-toggle');

let roomCode = null;

// --- Debug console ---

debugToggle.addEventListener('click', () => {
  const visible = debugPanel.style.display !== 'none';
  debugPanel.style.display = visible ? 'none' : 'block';
  debugToggle.textContent = visible ? 'Show Debug Console' : 'Hide Debug Console';
  if (!visible) debugPanel.scrollTop = debugPanel.scrollHeight;
});

function debug(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `debug-line debug-${type}`;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${ts}] ${msg}`;
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

function setNarration(html) {
  narrationContent.innerHTML = html;
}

// --- Reconnection ---

const savedCode = sessionStorage.getItem('island-host-code');

socket.on('connect', () => {
  if (roomCode) {
    debug('Reconnected — rejoining room', 'phase');
    socket.emit('rejoin-host', { code: roomCode });
  } else if (savedCode) {
    debug('Restoring host session', 'phase');
    roomCode = savedCode;
    socket.emit('rejoin-host', { code: savedCode });
  }
});

// --- Lobby ---

document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('create-room');
});

function renderLobby(code, players) {
  setNarration(`
    <h1>ISLAND</h1>
    <p class="room-info">Join at <strong>${location.host}/play</strong></p>
    <div class="room-code">${code}</div>
    <div id="player-list" class="player-list"></div>
    <p class="room-info" id="waiting-msg">Waiting for players...</p>
  `);
  renderPlayers(players || []);
}

function renderPlayers(players) {
  const listEl = document.getElementById('player-list');
  if (!listEl) return;
  listEl.innerHTML = players.map(p => `<span>${escapeHtml(p.name)}</span>`).join('');

  const waitMsg = document.getElementById('waiting-msg');
  if (!waitMsg) return;
  if (players.length >= 1) {
    waitMsg.innerHTML = `${players.length} ${players.length === 1 ? 'player' : 'players'} joined. <button id="btn-start">Start Game</button>`;
    document.getElementById('btn-start').addEventListener('click', function () {
      socket.emit('start-game');
      this.disabled = true;
      this.textContent = 'Starting...';
    });
  } else {
    waitMsg.textContent = 'Waiting for players...';
  }
}

socket.on('room-created', ({ code }) => {
  roomCode = code;
  sessionStorage.setItem('island-host-code', code);
  debug(`Room created: ${code}`, 'phase');
  renderLobby(code, []);
});

socket.on('players-update', ({ players }) => {
  debug(`Players: ${players.map(p => p.name).join(', ') || '(none)'}`, 'action');
  renderPlayers(players);
});

socket.on('host-state', ({ code, phase, day, players }) => {
  roomCode = code;
  sessionStorage.setItem('island-host-code', code);
  debug(`Host state restored: ${phase}`, 'phase');
  if (phase === 'started') {
    renderStarted(day);
  } else {
    renderLobby(code, players);
  }
});

// --- Started (placeholder) ---

function renderStarted(day) {
  setNarration(`
    <p class="day-label">Day ${day}</p>
    <h1>Hello, world.</h1>
    <p>Game state placeholder. Subsystems will hook in here.</p>
  `);
}

socket.on('game-started', ({ day }) => {
  debug(`Game started — day ${day}`, 'phase');
  renderStarted(day);
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
