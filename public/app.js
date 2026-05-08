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
  } else if (phase === 'campfire') {
    // The campfire-start event arrives in the same tick and rebuilds the
    // view in full. Don't render the lobby in the meantime — leave the
    // existing content (whatever was there before reload).
  } else {
    renderLobby(code, players);
  }
});

// --- Started (action phase) ---

const publicActions = {};   // name -> action string
let currentAssists = {};    // assisterName -> assistedName
let currentDay = 1;
let currentChunk = null;    // { kind, day, text } — the latest narration to show
let fullNarrative = '';     // the entire story so far
let showingFull = false;    // toggle: current chunk vs full doc
let inCampfireView = false; // narration content is currently the campfire screen

function renderStarted(day) {
  currentDay = day;
  setNarration(`
    <p class="day-label">Day ${day}</p>
    <div id="narration-prose" class="narration-prose"></div>
    <div class="narration-controls">
      <button id="btn-toggle-full" class="link-btn"></button>
    </div>
    <p class="action-prompt-host">What will you do?</p>
    <div id="action-status" class="status-list"></div>
    <p id="phase-note" class="phase-note" style="display:none"></p>
    <div class="phase-controls">
      <button id="btn-proceed" class="temp-btn" style="display:none">Proceed</button>
      <button id="btn-light-fire" class="temp-btn" style="display:none">Light the Fire</button>
      <button id="btn-end-day" class="temp-btn" style="display:none">End Day</button>
    </div>
  `);
  renderNarration();
  document.getElementById('btn-toggle-full').addEventListener('click', () => {
    showingFull = !showingFull;
    renderNarration();
  });
  document.getElementById('btn-proceed').addEventListener('click', () => {
    socket.emit('proceed-day');
    debug('Proceed requested', 'phase');
  });
  document.getElementById('btn-light-fire').addEventListener('click', () => {
    socket.emit('light-fire');
    debug('Light the fire', 'phase');
  });
  document.getElementById('btn-end-day').addEventListener('click', () => {
    socket.emit('end-day');
    debug('End day requested', 'phase');
  });
}

function renderNarration() {
  const proseEl = document.getElementById('narration-prose');
  const toggleEl = document.getElementById('btn-toggle-full');
  if (!proseEl) return;

  if (showingFull) {
    proseEl.classList.add('full');
    proseEl.textContent = fullNarrative || '(no narration yet)';
  } else {
    proseEl.classList.remove('full');
    proseEl.textContent = currentChunk ? currentChunk.text : 'Loading…';
  }

  if (toggleEl) {
    toggleEl.textContent = showingFull ? 'Show current only' : 'Show full story';
    toggleEl.style.display = fullNarrative ? '' : 'none';
  }
}

function renderActionStatus(statuses, assists) {
  const el = document.getElementById('action-status');
  if (!el) return;
  if (assists) currentAssists = assists;

  // Group assisters under the players they're assisting
  const assistedBy = {}; // assistedName -> [assisterName, ...]
  const isAssister = new Set();
  for (const [assister, assisted] of Object.entries(currentAssists)) {
    if (!assistedBy[assisted]) assistedBy[assisted] = [];
    assistedBy[assisted].push(assister);
    isAssister.add(assister);
  }

  const groups = statuses
    .filter((s) => !isAssister.has(s.name))
    .map((s) => {
      const pub = publicActions[s.name];
      const label = s.submitted
        ? (pub
            ? `<span class="status-name">${escapeHtml(s.name)}:</span> <span class="status-public-action">${escapeHtml(pub)}</span>`
            : `${escapeHtml(s.name)}: ready`)
        : `${escapeHtml(s.name)}: choosing...`;
      const assisters = (assistedBy[s.name] || [])
        .map((a) => `<div class="status-assist">with ${escapeHtml(a)}</div>`)
        .join('');
      return `<div class="status-group"><div class="status-item ${s.submitted ? 'submitted' : 'pending'}">${label}</div>${assisters}</div>`;
    });

  el.innerHTML = `<div class="status-players">${groups.join('')}</div>`;

  const proceedBtn = document.getElementById('btn-proceed');
  if (proceedBtn) {
    const allSubmitted = statuses.length > 0 && statuses.every((s) => s.submitted);
    proceedBtn.style.display = allSubmitted ? '' : 'none';
  }
}

socket.on('game-started', ({ day }) => {
  debug(`Game started — day ${day}`, 'phase');
  Object.keys(publicActions).forEach((k) => delete publicActions[k]);
  currentAssists = {};
  currentChunk = null;
  fullNarrative = '';
  showingFull = false;
  renderStarted(day);
});

socket.on('narration-pending', ({ kind, day }) => {
  debug(`Narrator pending: ${kind} (day ${day})`, 'api');
  // Show a placeholder if we don't yet have any prose for the new state.
  if (!currentChunk || currentChunk.day !== day || currentChunk.kind !== kind) {
    currentChunk = { kind, day, text: 'Loading…' };
    renderNarration();
  }
  // While narration is generating, hide the action-selection chrome.
  const prompt = document.querySelector('.action-prompt-host');
  const status = document.getElementById('action-status');
  if (prompt) prompt.style.display = 'none';
  if (status) status.style.display = 'none';
  // Day narration in flight → Proceed has done its job; hide it so the host
  // doesn't see two phase buttons at once. End Day waits until prose lands.
  if (kind === 'day') {
    const proceedBtn = document.getElementById('btn-proceed');
    if (proceedBtn) proceedBtn.style.display = 'none';
  }
});

socket.on('narration-chunk', ({ kind, day, text, full }) => {
  debug(`Narrator: ${kind} (day ${day}) — ${text.length} chars`, 'api');
  currentChunk = { kind, day, text };
  fullNarrative = full;
  renderNarration();
  speakNarration(text);
  // Day narration has published → the day-resolution-options event will tell
  // us which phase button to show (Light the Fire vs End Day). Nothing to do
  // here for that.
  // Morning narration has published → the action-selection round for the
  // new day is open. Re-show the prompt and status list (hidden during the
  // morning generation).
  if (kind === 'morning') {
    const prompt = document.querySelector('.action-prompt-host');
    const status = document.getElementById('action-status');
    if (prompt) prompt.style.display = '';
    if (status) status.style.display = '';
  }
});

// Day narration has finished resolving. Server tells us which players (if
// any) are alive at the wreckage so the host can decide whether to offer the
// campfire or skip straight to the next day.
socket.on('day-resolution-options', ({ playersAtCamp }) => {
  const lightBtn = document.getElementById('btn-light-fire');
  const endBtn = document.getElementById('btn-end-day');
  const note = document.getElementById('phase-note');
  if (playersAtCamp && playersAtCamp.length > 0) {
    if (lightBtn) lightBtn.style.display = '';
    if (endBtn) endBtn.style.display = 'none';
    if (note) note.style.display = 'none';
  } else {
    if (lightBtn) lightBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = '';
    if (note) {
      note.textContent = 'Nobody is at the camp to light the fire.';
      note.style.display = '';
    }
  }
});

// Campfire phase has begun. Replace the entire narration panel with the
// v0.3-style campfire view: image, group food pool, fed/hungry status,
// transfer log, and an End Day button. Deposit/withdraw lands next push.
socket.on('campfire-start', ({ day, playersAtCamp, cache, meal, portionsNeeded }) => {
  debug(`Campfire: ${playersAtCamp.join(', ')}`, 'phase');
  inCampfireView = true;
  setNarration(`
    <p class="day-label">Day ${day} — Campfire</p>
    <p>The fire crackles. What will you share?</p>
    <div class="campfire-top">
      <img src="/campfire.png" class="campfire-img" alt="">
      <div id="campfire-log" class="campfire-log"></div>
    </div>
    <p class="phase-note">Around the fire: ${playersAtCamp.map(escapeHtml).join(', ')}.</p>
    <div class="campfire-grid">
      <div class="campfire-col">
        <p class="campfire-food-label">Today's Meal</p>
        <div class="campfire-food-box">
          <span class="meal-need-num" id="campfire-pool-num">${portionsNeeded}</span>
          <span class="meal-need-label">portions needed</span>
          <p id="hungry-warning" class="meal-status meal-status-warning">The group will go hungry tonight (-1 HP).</p>
          <p id="food-ok" class="meal-status meal-status-ok">The group has enough food for everyone.</p>
        </div>
        <div id="campfire-meal" class="campfire-meal"></div>
      </div>
      <div class="campfire-col">
        <p class="campfire-food-label">Stockpile</p>
        <div id="campfire-cache" class="campfire-cache"></div>
      </div>
    </div>
    <div class="campfire-actions">
      <button id="btn-end-day-campfire" class="temp-btn">End Day</button>
    </div>
  `);
  renderCampfireCache(cache || []);
  renderCampfireMeal(meal || []);
  applyMealStatus(portionsNeeded);
  document.getElementById('btn-end-day-campfire').addEventListener('click', () => {
    socket.emit('end-day');
    debug('End day requested', 'phase');
  });
});

function applyMealStatus(portionsNeeded) {
  const num = document.getElementById('campfire-pool-num');
  if (num) num.textContent = portionsNeeded;
  const hungry = document.getElementById('hungry-warning');
  const ok = document.getElementById('food-ok');
  if (hungry) hungry.style.display = portionsNeeded > 0 ? 'block' : 'none';
  if (ok) ok.style.display = portionsNeeded > 0 ? 'none' : 'block';
}

function renderCampfireCache(cache) {
  const el = document.getElementById('campfire-cache');
  if (!el) return;
  if (!cache.length) {
    el.innerHTML = '<div class="cache-slot empty">—</div>';
    return;
  }
  el.innerHTML = cache.map((s) => {
    const label = s.type === 'food'
      ? `${escapeHtml(s.name)} [${s.count}]`
      : escapeHtml(s.name);
    if (s.type === 'food') {
      return `<button class="cache-slot meal-add" data-name="${escapeHtml(s.name)}">${label}</button>`;
    }
    return `<div class="cache-slot">${label}</div>`;
  }).join('');
  el.querySelectorAll('.cache-slot.meal-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('meal-add', { name: btn.dataset.name });
    });
  });
}

function renderCampfireMeal(meal) {
  const el = document.getElementById('campfire-meal');
  if (!el) return;
  if (!meal.length) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = meal.map((s) => {
    const label = `${escapeHtml(s.name)} [${s.count}]`;
    return `<button class="cache-slot meal-remove" data-name="${escapeHtml(s.name)}">${label}</button>`;
  }).join('');
  el.querySelectorAll('.cache-slot.meal-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('meal-remove', { name: btn.dataset.name });
    });
  });
}

// Live updates from any deposit/withdraw/meal-stage at the campfire.
socket.on('campfire-state', ({ cache, meal, portionsNeeded }) => {
  applyMealStatus(portionsNeeded);
  renderCampfireCache(cache || []);
  renderCampfireMeal(meal || []);
});

socket.on('campfire-log', ({ name, action, what }) => {
  const log = document.getElementById('campfire-log');
  if (!log) return;
  const verb = action === 'shared' ? 'shared' : 'took';
  const entry = document.createElement('p');
  entry.textContent = `${name} ${verb} ${what}.`;
  log.insertBefore(entry, log.firstChild);
});

socket.on('feeding-result', ({ fed, deaths }) => {
  if (fed) debug('Camp pool fed everyone.', 'phase');
  else debug(`Pool insufficient — everyone alive lost 1 HP.${deaths.length ? ' Deaths: ' + deaths.join(', ') : ''}`, 'phase');
});

socket.on('game-over', ({ day }) => {
  debug(`Game over — day ${day}`, 'phase');
  setNarration(`
    <h1>THE END</h1>
    <p class="room-info">All players have died.</p>
    <p class="room-info">Day ${day}.</p>
  `);
});

// --- TTS ---

const ELEVENLABS_VOICE_ID = 'USEQXnsXRJlw2k9LUzG4';
const elAudioCache = new Map(); // text -> blob URL
let currentAudio = null;
let browserVoice = null;

const ttsModeEl = document.getElementById('tts-mode');
const ttsVoiceEl = document.getElementById('tts-browser-voice');

function syncVoicePickerVisibility() {
  ttsVoiceEl.style.display = ttsModeEl.value === 'browser' ? '' : 'none';
}
ttsModeEl.addEventListener('change', syncVoicePickerVisibility);
syncVoicePickerVisibility();

function loadBrowserVoices() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices.length) return;
  ttsVoiceEl.innerHTML = '';
  for (const v of voices) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    ttsVoiceEl.appendChild(opt);
  }
  // Prefer an English voice by default
  const preferred = voices.find(v => /en[-_]?US/i.test(v.lang) && /samantha|daniel|alex|google/i.test(v.name))
    || voices.find(v => /^en/i.test(v.lang))
    || voices[0];
  if (preferred) {
    ttsVoiceEl.value = preferred.name;
    browserVoice = preferred;
  }
}
ttsVoiceEl.addEventListener('change', () => {
  const voices = window.speechSynthesis?.getVoices() || [];
  browserVoice = voices.find(v => v.name === ttsVoiceEl.value) || null;
});
if (window.speechSynthesis) {
  loadBrowserVoices();
  window.speechSynthesis.addEventListener('voiceschanged', loadBrowserVoices);
}

function stopAudio() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (currentAudio) {
    try { currentAudio.pause(); } catch {}
    currentAudio = null;
  }
}

function speakBrowser(text) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(text);
  if (browserVoice) utter.voice = browserVoice;
  utter.rate = 1.0;
  synth.speak(utter);
}

async function speakElevenLabs(text) {
  let blobUrl = elAudioCache.get(text);
  if (!blobUrl) {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voice_id: ELEVENLABS_VOICE_ID, text }),
    });
    if (!resp.ok) {
      debug(`[TTS] HTTP ${resp.status}`, 'error');
      return;
    }
    const blob = await resp.blob();
    blobUrl = URL.createObjectURL(blob);
    elAudioCache.set(text, blobUrl);
  }
  currentAudio = new Audio(blobUrl);
  currentAudio.play().catch((e) => debug(`[TTS] play failed: ${e.message}`, 'error'));
}

function speakNarration(text) {
  const mode = ttsModeEl.value;
  if (mode === 'off' || !text) return;
  stopAudio();
  if (mode === 'elevenlabs') return speakElevenLabs(text);
  return speakBrowser(text);
}

socket.on('narration-error', ({ kind, day, error }) => {
  debug(`Narrator error: ${kind} (day ${day}) — ${error}`, 'error');
});

socket.on('narration-debug', ({ kind, day, raw }) => {
  debug(`Narrator raw (${kind}, day ${day}): ${raw}`, 'api');
});

socket.on('day-changed', ({ day }) => {
  currentDay = day;
  // If we were on the campfire screen, rebuild the action UI from scratch.
  // Otherwise just update the day label and reset the phase chrome.
  if (inCampfireView) {
    inCampfireView = false;
    currentChunk = null;
    showingFull = false;
    Object.keys(publicActions).forEach((k) => delete publicActions[k]);
    currentAssists = {};
    renderStarted(day);
  } else {
    const dayLabel = document.querySelector('#narration-content .day-label');
    if (dayLabel) dayLabel.textContent = `Day ${day}`;
    const proceedBtn = document.getElementById('btn-proceed');
    const lightBtn = document.getElementById('btn-light-fire');
    const endBtn = document.getElementById('btn-end-day');
    const prompt = document.querySelector('.action-prompt-host');
    const status = document.getElementById('action-status');
    const note = document.getElementById('phase-note');
    if (proceedBtn) proceedBtn.style.display = 'none';
    if (lightBtn) lightBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'none';
    if (note) note.style.display = 'none';
    if (prompt) prompt.style.display = '';
    if (status) status.style.display = '';
  }
  debug(`Day → ${day}`, 'phase');
});

socket.on('action-status', ({ submitted, pending, assists }) => {
  const statuses = [
    ...submitted.map((n) => ({ name: n, submitted: true })),
    ...pending.map((n) => ({ name: n, submitted: false })),
  ];
  renderActionStatus(statuses, assists || {});
  debug(`Actions: ${submitted.length} submitted, ${pending.length} pending`, 'action');
});

socket.on('action-public', ({ name, action }) => {
  publicActions[name] = action;
  debug(`${name} made action public: "${action}"`, 'action');
  const el = document.getElementById('action-status');
  if (el) {
    el.querySelectorAll('.status-item').forEach((item) => {
      if (item.textContent.startsWith(name + ':')) {
        item.innerHTML = `<span class="status-name">${escapeHtml(name)}:</span> <span class="status-public-action">${escapeHtml(action)}</span>`;
      }
    });
  }
});

socket.on('categorizer-result', ({ player, action, location, result, outcome }) => {
  const possible = result.possible ? 'possible' : 'impossible';
  const seeking = Array.isArray(result.seeking) && result.seeking.length ? result.seeking.join(',') : 'none';
  let line = `[CAT] ${player} at ${location}: "${action}" → ${possible} | ${result.attribute} | ${result.difficulty} | seeking:${seeking} — ${result.rationale}`;
  if (outcome.reason === 'impossible') {
    line += `\n      → auto-fail (impossible)`;
  } else if (outcome.kind === 'search') {
    if (!outcome.results.length) {
      line += `\n      → search: nothing to roll on this scene`;
    } else {
      for (const r of outcome.results) {
        const pct = (r.chance * 100).toFixed(0);
        const verdict = r.success ? `FOUND ${r.found || '(unknown)'}` : 'miss';
        line += `\n      → ${r.category} @ ${pct}% → ${verdict}`;
      }
    }
  } else {
    const r = outcome.roll;
    line += `\n      → roll ${r.d20} + ${r.modifier} = ${r.total} vs DC ${r.dc} → ${outcome.success ? 'SUCCESS' : 'FAIL'}`;
  }
  debug(line, 'api');
});

socket.on('categorizer-error', ({ player, action, error }) => {
  debug(`[CAT-ERR] ${player}: "${action}" — ${error}`, 'error');
});

socket.on('action-unpublic', ({ name }) => {
  delete publicActions[name];
  debug(`${name} cancelled public action`, 'action');
  const el = document.getElementById('action-status');
  if (el) {
    el.querySelectorAll('.status-item').forEach((item) => {
      if (item.textContent.startsWith(name + ':')) {
        item.innerHTML = `${escapeHtml(name)}: ready`;
      }
    });
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// --- Reset ---

document.getElementById('btn-reset').addEventListener('click', () => {
  if (!confirm('Reset the game and disconnect all players?')) return;
  if (roomCode) socket.emit('reset-room');
  sessionStorage.removeItem('island-host-code');
  location.reload();
});
