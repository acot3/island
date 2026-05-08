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

// --- Started (action phase) ---

const publicActions = {};   // name -> action string
let currentAssists = {};    // assisterName -> assistedName
let currentDay = 1;
let currentChunk = null;    // { kind, day, text } — the latest narration to show
let fullNarrative = '';     // the entire story so far
let showingFull = false;    // toggle: current chunk vs full doc

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
    <div class="phase-controls">
      <button id="btn-proceed" class="temp-btn" style="display:none">Proceed</button>
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
  // Day narration has published → swap the action-selection UI for the End
  // Day control. The prompt + per-player status list stay hidden until the
  // next day begins.
  if (kind === 'day') {
    const endBtn = document.getElementById('btn-end-day');
    if (endBtn) endBtn.style.display = '';
  }
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
  const dayLabel = document.querySelector('#narration-content .day-label');
  if (dayLabel) dayLabel.textContent = `Day ${day}`;
  // Reset for the new day: both phase buttons hidden, prompt and status
  // list back in view. Proceed reappears once every player submits; End
  // Day reappears once the day's narration publishes.
  const proceedBtn = document.getElementById('btn-proceed');
  const endBtn = document.getElementById('btn-end-day');
  const prompt = document.querySelector('.action-prompt-host');
  const status = document.getElementById('action-status');
  if (proceedBtn) proceedBtn.style.display = 'none';
  if (endBtn) endBtn.style.display = 'none';
  if (prompt) prompt.style.display = '';
  if (status) status.style.display = '';
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
