const socket = io();

// DOM refs
const narrationContent = document.getElementById('narration-content');
const debugPanel = document.getElementById('debug');
const debugToggle = document.getElementById('debug-toggle');

let roomCode = null;
const publicActions = {}; // name -> action string
let ttsEnabled = true;
let ttsAudio = null;

// --- TTS ---

const ttsToggle = document.getElementById('tts-toggle');
ttsToggle.addEventListener('click', () => {
  ttsEnabled = !ttsEnabled;
  ttsToggle.classList.toggle('on', ttsEnabled);
  ttsToggle.classList.toggle('off', !ttsEnabled);
  ttsToggle.textContent = ttsEnabled ? 'sound on' : 'sound off';
  if (!ttsEnabled && ttsAudio) {
    ttsAudio.pause();
    ttsAudio = null;
  }
});

function playTTS() {
  if (!ttsEnabled || !roomCode) { debug('TTS skipped (disabled)', 'info'); return Promise.resolve(); }
  debug('TTS fetching pregenerated audio...', 'api');
  return fetch(`/tts/${roomCode}`)
    .then(res => {
      debug(`TTS response: ${res.status}`, 'api');
      if (!res.ok) throw new Error(`TTS server returned ${res.status}`);
      return res.blob();
    })
    .then(blob => {
      debug(`TTS audio received (${(blob.size / 1024).toFixed(1)} KB)`, 'api');
      if (!ttsEnabled) { debug('TTS cancelled (toggled off)', 'info'); return; }
      const url = URL.createObjectURL(blob);
      ttsAudio = new Audio(url);
      ttsAudio.addEventListener('ended', () => { URL.revokeObjectURL(url); ttsAudio = null; debug('TTS ended', 'api'); });
      ttsAudio.addEventListener('error', (e) => { debug(`TTS playback error: ${e.message || 'unknown'}`, 'error'); });
      return ttsAudio.play()
        .then(() => debug('TTS playing', 'api'))
        .catch(err => debug(`TTS play blocked: ${err.message}`, 'error'));
    })
    .catch(err => debug(`TTS error: ${err.message}`, 'error'));
}

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

// --- Render helpers ---

function setNarration(html) {
  narrationContent.innerHTML = html;
}

// --- Lobby ---

document.getElementById('btn-create').addEventListener('click', () => {
  socket.emit('create-room');
});

socket.on('room-created', ({ code, plotSeed }) => {
  roomCode = code;
  debug(`Room created: ${code}`, 'phase');
  if (plotSeed) debug(`Plot: ${plotSeed.split('\n')[0]}`, 'phase');
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
  if (waitMsg && players.length >= 1) {
    waitMsg.innerHTML = `${players.length} players joined. <button id="btn-start">Start Game</button>`;
    document.getElementById('btn-start').addEventListener('click', function() {
      socket.emit('start-game');
      this.disabled = true;
      this.textContent = 'Loading...';
    });
  }
});

// --- Loading ---

socket.on('phase', ({ phase, day }) => {
  if (phase === 'loading') {
    debug('Loading...', 'api');
    if (day) {
      setNarration(`
        <h1>Day ${day} on the Island</h1>
        <p class="loading-text">Loading...</p>
      `);
    }
  }
});

// --- Morning ---

socket.on('morning', ({ day, narration, groupFood, playerNames }) => {
  Object.keys(publicActions).forEach(k => delete publicActions[k]);
  currentAssists = {};
  debug(`Day ${day} morning`, 'phase');

  function showMorning() {
    setNarration(`
      <div class="group-food">Food: ${groupFood}</div>
      <p class="food-count">Day ${day}</p>
      <p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>
      <div id="action-status" class="status-list"></div>
    `);
    renderActionStatus(playerNames.map(n => ({ name: n, submitted: false })));
  }

  if (!ttsEnabled) {
    showMorning();
  } else {
    playTTS().then(showMorning);
  }
});

let currentAssists = {}; // assisterName -> assistedName

function renderActionStatus(statuses, assists) {
  const el = document.getElementById('action-status');
  if (!el) return;

  if (assists) currentAssists = assists;

  const allSubmitted = statuses.every(s => s.submitted);

  // Build groups: primary players (not assisting anyone) with assisters below them
  const assistedBy = {}; // assistedName -> [assisterName, ...]
  const isAssister = new Set();
  for (const [assister, assisted] of Object.entries(currentAssists)) {
    if (!assistedBy[assisted]) assistedBy[assisted] = [];
    assistedBy[assisted].push(assister);
    isAssister.add(assister);
  }

  const groups = statuses
    .filter(s => !isAssister.has(s.name))
    .map(s => {
      const pub = publicActions[s.name];
      const label = s.submitted
        ? (pub ? `<span class="status-name">${s.name}:</span> <span class="status-public-action">${pub}</span>` : `${s.name}: ready`)
        : `${s.name}: choosing...`;
      const assisters = (assistedBy[s.name] || []).map(a =>
        `<div class="status-assist">with ${a}</div>`
      ).join('');
      return `<div class="status-group"><div class="status-item ${s.submitted ? 'submitted' : 'pending'}">${label}</div>${assisters}</div>`;
    });

  el.innerHTML = `
    <div class="status-players">
      ${groups.join('')}
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

socket.on('action-status', ({ submitted, pending, assists }) => {
  const statuses = [
    ...submitted.map(n => ({ name: n, submitted: true })),
    ...pending.map(n => ({ name: n, submitted: false })),
  ];
  renderActionStatus(statuses, assists || {});
  debug(`Actions: ${submitted.length} submitted, ${pending.length} pending`, 'action');
});

socket.on('action-public', ({ name, action }) => {
  publicActions[name] = action;
  debug(`${name} made action public: "${action}"`, 'action');
  // Re-render status to reflect public action
  const el = document.getElementById('action-status');
  if (el) {
    const items = el.querySelectorAll('.status-item');
    items.forEach(item => {
      if (item.textContent.startsWith(name + ':')) {
        item.innerHTML = `<span class="status-name">${name}:</span> <span class="status-public-action">${action}</span>`;
      }
    });
  }
});

socket.on('action-unpublic', ({ name }) => {
  delete publicActions[name];
  debug(`${name} cancelled public action`, 'action');
});

// --- Day narration ---

socket.on('day-narration', ({ day, narration, groupFood, freshWater }) => {
  debug(`Day ${day} narration | Water: ${freshWater ? 'yes' : 'no'}`, 'phase');
  window._freshWater = freshWater;

  function showDayNarration() {
    setNarration(`
      <div class="group-food">Food: ${groupFood}</div>
      <p class="food-count">Day ${day}</p>
      <p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>
      <button id="btn-fire">Light the Fire</button>
    `);
    document.getElementById('btn-fire').addEventListener('click', () => {
      socket.emit('start-campfire');
    });
  }

  if (!ttsEnabled) {
    showDayNarration();
  } else {
    playTTS().then(showDayNarration);
  }
});

// --- Campfire ---

socket.on('campfire-start', ({ day, groupFood, playerCount, freshWater }) => {
  debug('Campfire phase', 'phase');
  if (freshWater !== undefined) window._freshWater = freshWater;
  const waterHtml = window._freshWater
    ? '<p class="water-status water-ok">The group has access to fresh water.</p>'
    : '<p class="water-status water-warning">The group lacks access to fresh water. −1 HP</p>';
  setNarration(`
    <p class="food-count">Day ${day} — Campfire</p>
    <p>The fire crackles. What will you share?</p>
    <img src="/campfire.png" class="campfire-img" alt="">
    <div class="campfire-food">
      <div class="campfire-food-label">Food</div>
      <div class="campfire-food-number" id="campfire-pool-num">${groupFood}</div>
    </div>
    <p id="hungry-warning" class="hungry-warning" style="display:${groupFood < playerCount ? 'block' : 'none'}">The group will go hungry tonight. −1 HP</p>
    <p id="food-ok" class="water-status food-ok" style="display:${groupFood >= playerCount ? 'block' : 'none'}">The group has enough food for everyone.</p>
    ${waterHtml}
    <div id="campfire-log" class="campfire-log"></div>
    <div class="campfire-actions">
      <button id="btn-next" disabled>Next Day</button>
    </div>
  `);
  window._campfirePlayerCount = playerCount;
  playTTS();
  document.getElementById('btn-next').addEventListener('click', function() {
    socket.emit('next-day');
    this.disabled = true;
    this.textContent = 'Loading...';
  });
});

function updateHungryWarning(groupFood) {
  const playerCount = window._campfirePlayerCount || 0;
  const hungry = groupFood < playerCount;
  const warn = document.getElementById('hungry-warning');
  if (warn) warn.style.display = hungry ? 'block' : 'none';
  const ok = document.getElementById('food-ok');
  if (ok) ok.style.display = hungry ? 'none' : 'block';
}

socket.on('campfire-update', ({ name, shared, groupFood, playerCount, allReady }) => {
  debug(`${name} shared ${shared} food (pool: ${groupFood})`, 'food');
  if (playerCount != null) window._campfirePlayerCount = playerCount;

  const num = document.getElementById('campfire-pool-num');
  if (num) num.textContent = groupFood;
  updateHungryWarning(groupFood);

  const log = document.getElementById('campfire-log');
  if (log) {
    const entry = document.createElement('p');
    entry.id = `campfire-entry-${name}`;
    entry.dataset.shared = shared;
    entry.dataset.took = 0;
    entry.textContent = `${name} shared ${shared} food.`;
    log.appendChild(entry);
  }

  const btnNext = document.getElementById('btn-next');
  if (btnNext && allReady) btnNext.disabled = false;
});

socket.on('campfire-take', ({ name, groupFood, playerCount }) => {
  debug(`${name} took an extra portion (pool: ${groupFood})`, 'food');
  if (playerCount != null) window._campfirePlayerCount = playerCount;

  const num = document.getElementById('campfire-pool-num');
  if (num) num.textContent = groupFood;
  updateHungryWarning(groupFood);

  const entry = document.getElementById(`campfire-entry-${name}`);
  if (entry) {
    const took = (parseInt(entry.dataset.took, 10) || 0) + 1;
    entry.dataset.took = took;
    const shared = entry.dataset.shared;
    entry.textContent = `${name} shared ${shared} food. Took ${took} extra portion${took > 1 ? 's' : ''}.`;
  }
});

// --- Game Over (all players dead) ---

socket.on('game-over', ({ narration }) => {
  debug('Game over — all players dead', 'phase');
  let html = '';
  if (narration) {
    html += `<p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>`;
  }
  html += `
    <h1 class="game-over">GAME OVER</h1>
    <p>All players have perished on the island.</p>
    <button id="btn-play-again">Play Again</button>
  `;
  setNarration(html);
  document.getElementById('btn-play-again').addEventListener('click', () => {
    window.location.href = '/';
  });
});

// --- Game End (Day 10 conclusion) ---

socket.on('game-end', ({ day, narration }) => {
  debug(`Game ended on Day ${day}`, 'phase');
  setNarration(`
    <p class="food-count">Day ${day}</p>
    <p>${narration.replace(/(\\n|\n)+/g, '<br><br>')}</p>
    <button id="btn-play-again">Play Again</button>
  `);
  document.getElementById('btn-play-again').addEventListener('click', () => {
    window.location.href = '/';
  });
});

// --- Errors ---

socket.on('error', ({ message }) => {
  debug(`Error: ${message}`, 'error');
});
