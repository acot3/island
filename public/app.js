const socket = io();

// DOM refs
const narrationContent = document.getElementById('narration-content');
const debugPanel = document.getElementById('debug');

let roomCode = null;
const publicActions = {}; // name -> action string

// --- Debug console ---

function debug(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `debug-line debug-${type}`;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${ts}] ${msg}`;
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

// --- Render helpers ---

function setNarration(html) {
  narrationContent.innerHTML = html;
}

// --- Lobby ---

document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('create-room');
});

socket.on('room-created', ({ code }) => {
  roomCode = code;
  debug(`Room created: ${code}`, 'phase');
  setNarration(`
    <h1>ISLAND</h1>
    <p class="room-info">Join at <strong>${location.host}/play</strong></p>
    <div class="room-code">${code}</div>
    <div id="player-list" class="player-list"></div>
    <p class="room-info" id="waiting-msg">Waiting for players...</p>
  `);
});

socket.on('player-joined', ({ players }) => {
  debug(`Players: ${players.join(', ')}`, 'action');
  const listEl = document.getElementById('player-list');
  if (listEl) {
    listEl.innerHTML = players.map(n => `<span>${n}</span>`).join('');
  }
  const waitMsg = document.getElementById('waiting-msg');
  if (waitMsg && players.length >= 2) {
    waitMsg.innerHTML = `${players.length} players joined. <button id="btn-start">Start Game</button>`;
    document.getElementById('btn-start').addEventListener('click', function() {
      socket.emit('start-game');
      this.disabled = true;
      this.textContent = 'Loading...';
    });
  }
});

// --- Loading ---

socket.on('phase', ({ phase }) => {
  if (phase === 'loading') {
    debug('Loading...', 'api');
  }
});

// --- Morning ---

socket.on('morning', ({ day, narration, groupFood, playerNames }) => {
  Object.keys(publicActions).forEach(k => delete publicActions[k]);
  debug(`Day ${day} morning`, 'phase');
  setNarration(`
    <div class="group-food">Food: ${groupFood}</div>
    <p class="food-count">Day ${day}</p>
    <p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>
    <div id="action-status" class="status-list"></div>
  `);
  renderActionStatus(playerNames.map(n => ({ name: n, submitted: false })));
});

function renderActionStatus(statuses) {
  const el = document.getElementById('action-status');
  if (!el) return;

  const allSubmitted = statuses.every(s => s.submitted);

  el.innerHTML = `
    <div class="status-players">
      ${statuses.map(s => {
        const pub = publicActions[s.name];
        const label = s.submitted
          ? (pub ? `${s.name}: ${pub}` : `${s.name}: ready`)
          : `${s.name}: choosing...`;
        return `<div class="status-item ${s.submitted ? 'submitted' : 'pending'}">${label}</div>`;
      }).join('')}
    </div>
    ${allSubmitted ? '<div class="status-action"><button id="btn-narrate">Narrate Day</button></div>' : ''}
  `;

  if (allSubmitted) {
    document.getElementById('btn-narrate').addEventListener('click', function() {
      socket.emit('narrate-day');
      this.disabled = true;
      this.textContent = 'Narrating...';
    });
  }
}

socket.on('action-status', ({ submitted, pending }) => {
  const statuses = [
    ...submitted.map(n => ({ name: n, submitted: true })),
    ...pending.map(n => ({ name: n, submitted: false })),
  ];
  renderActionStatus(statuses);
  debug(`Actions: ${submitted.length} submitted, ${pending.length} pending`, 'action');
});

socket.on('action-public', ({ name, action }) => {
  publicActions[name] = action;
  debug(`${name} made action public: "${action}"`, 'action');
  // Re-render status if visible
  const el = document.getElementById('action-status');
  if (el) {
    const items = el.querySelectorAll('.status-item');
    items.forEach(item => {
      if (item.textContent.startsWith(name + ':')) {
        item.textContent = `${name}: ${action}`;
      }
    });
  }
});

// --- Day narration ---

socket.on('day-narration', ({ day, narration, groupFood }) => {
  debug(`Day ${day} narration`, 'phase');
  setNarration(`
    <div class="group-food">Food: ${groupFood}</div>
    <p class="food-count">Day ${day}</p>
    <p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>
    <button id="btn-fire">Light the Fire</button>
  `);
  document.getElementById('btn-fire').addEventListener('click', () => {
    socket.emit('start-campfire');
  });
});

// --- Campfire ---

socket.on('campfire-start', ({ day, groupFood }) => {
  debug('Campfire phase', 'phase');
  setNarration(`
    <div class="group-food">Food: ${groupFood}</div>
    <p class="food-count">Day ${day} — Campfire</p>
    <p>The fire crackles. What will you share?</p>
    <div id="campfire-log" class="campfire-log"></div>
  `);
});

socket.on('campfire-update', ({ name, shared, groupFood, allReady }) => {
  debug(`${name} shared ${shared} food (pool: ${groupFood})`, 'food');

  const gf = document.querySelector('.group-food');
  if (gf) gf.textContent = `Food: ${groupFood}`;

  const log = document.getElementById('campfire-log');
  if (log) {
    const entry = document.createElement('p');
    entry.textContent = `${name} shared ${shared} food.`;
    log.appendChild(entry);
  }

  if (allReady) {
    const btn = document.createElement('button');
    btn.id = 'btn-next';
    btn.textContent = 'Next Day';
    btn.addEventListener('click', () => {
      socket.emit('next-day');
      btn.disabled = true;
      btn.textContent = 'Loading...';
    });
    narrationContent.appendChild(btn);
  }
});

// --- Errors ---

socket.on('error', ({ message }) => {
  debug(`Error: ${message}`, 'error');
});
