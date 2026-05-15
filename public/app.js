const socket = io();

initMinimap(socket, document.getElementById('minimap'));

const narrationContent = document.getElementById('narration-content');
const debugPanel = document.getElementById('debug');
const debugToggle = document.getElementById('debug-toggle');

let roomCode = null;
let roomMode = 'normal'; // 'normal' | 'sandbox'

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

document.getElementById('btn-sandbox').addEventListener('click', () => {
  socket.emit('create-sandbox');
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

socket.on('room-created', ({ code, mode }) => {
  roomCode = code;
  roomMode = mode || 'normal';
  sessionStorage.setItem('island-host-code', code);
  debug(`Room created: ${code}${mode ? ' (' + mode + ')' : ''}`, 'phase');
  renderLobby(code, []);
});

socket.on('players-update', ({ players }) => {
  debug(`Players: ${players.map(p => p.name).join(', ') || '(none)'}`, 'action');
  renderPlayers(players);
});

socket.on('host-state', ({ code, phase, day, mode, players }) => {
  roomCode = code;
  roomMode = mode || 'normal';
  sessionStorage.setItem('island-host-code', code);
  debug(`Host state restored: ${phase}${mode ? ' (' + mode + ')' : ''}`, 'phase');
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
let campfireMealFull = false; // set per campfire-state; gates meal-add clicks

function renderStarted(day) {
  currentDay = day;
  const sandbox = roomMode === 'sandbox';
  // Sandbox keeps the full normal UI — narration prose still shows on the
  // host — and adds a #sandbox-debug panel at the bottom that surfaces
  // each react() call's outputs plus the growing character histories.
  const sandboxPanel = sandbox
    ? `<div id="sandbox-debug" class="sandbox-debug">
         <p class="sandbox-label">Sandbox</p>
         <p class="sandbox-empty">Run a day to see react() outputs and character history.</p>
       </div>`
    : '';
  setNarration(`
    <p class="day-label">Day ${day}${sandbox ? ' — Sandbox' : ''}</p>
    <div id="narration-prose" class="narration-prose"></div>
    <div class="narration-controls">
      <button id="btn-toggle-full" class="link-btn"></button>
    </div>
    <p class="action-prompt-host">What will you do?</p>
    <div id="action-status" class="status-list"></div>
    <p id="phase-note" class="phase-note" style="display:none"></p>
    <div class="phase-controls">
      <button id="btn-proceed" class="temp-btn" style="display:none">Proceed</button>
      <button id="btn-proceed-event" class="temp-btn" style="display:none">Proceed</button>
      <button id="btn-light-fire" class="temp-btn" style="display:none">Light the Fire</button>
      <button id="btn-end-day" class="temp-btn" style="display:none">End Day</button>
    </div>
    ${sandboxPanel}
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
  document.getElementById('btn-proceed-event').addEventListener('click', () => {
    socket.emit('proceed-event');
    document.getElementById('btn-proceed-event').style.display = 'none';
    debug('Proceed to event', 'phase');
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
  } else if (sceneBeats.length > 0) {
    // Scene event in progress — render each segment as its own element.
    // Character voices get curly quotes; narrator stays plain.
    proseEl.classList.remove('full');
    proseEl.innerHTML = '';
    for (const seg of sceneBeats) {
      const div = document.createElement('div');
      div.className = `segment voice-${seg.voice}`;
      div.dataset.text = seg.text;
      let display = seg.text;
      if (seg.voice !== 'narrator') {
        const stripped = seg.text.replace(/^["“”'']+|["“”'']+$/g, '').trim();
        display = `“${stripped}”`;
      }
      div.textContent = display;
      proseEl.appendChild(div);
    }
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

socket.on('narration-chunk', async ({ kind, day, text, segments, voices, full }) => {
  const charCount = segments ? segments.reduce((n, s) => n + s.text.length, 0) : (text ? text.length : 0);
  debug(`Narrator: ${kind} (day ${day}) — ${charCount} chars`, 'api');
  // Register any character voice configs the day narrator might use.
  if (voices) for (const v of voices) sceneVoices[v.key] = v;
  const mode = ttsModeEl.value;

  if (segments) {
    // Day narrator emits segments now — multi-voice if a character spoke.
    let blobUrls = null;
    if (mode === 'elevenlabs') {
      blobUrls = await mapLimit(segments, TTS_CONCURRENCY, (seg) => {
        const cfg = sceneVoices[seg.voice];
        const id = cfg?.elevenLabsId || ELEVENLABS_VOICE_ID;
        return prefetchElevenLabs(seg.ttsText || seg.text, id, cfg);
      });
    }
    sceneBeats = segments.slice();
    currentChunk = { kind, day, segments };
    fullNarrative = full;
    renderNarration();
    if (mode === 'elevenlabs' && blobUrls) {
      stopAudio();
      for (let i = 0; i < blobUrls.length; i++) {
        if (!blobUrls[i]) continue;
        const cfg = sceneVoices[segments[i].voice];
        await playBlobAwait(blobUrls[i], cfg?.volume ?? 1);
        // Breathing room before the next segment — a voice's pauseAfterMs
        // overrides the default paragraph gap. No pause after the last one.
        if (i < blobUrls.length - 1) {
          await new Promise((r) => setTimeout(r, cfg?.pauseAfterMs ?? SEGMENT_GAP_MS));
        }
      }
    } else if (mode === 'browser') {
      speakSegments(segments);
    }
  } else {
    // Morning narrator (and any flat-text caller) emits a single string.
    let blobUrl = null;
    if (mode === 'elevenlabs') {
      blobUrl = await prefetchElevenLabs(text, ELEVENLABS_VOICE_ID);
    }
    sceneBeats = [];
    currentChunk = { kind, day, text };
    fullNarrative = full;
    renderNarration();
    if (mode === 'elevenlabs' && blobUrl) {
      stopAudio();
      currentAudio = new Audio(blobUrl);
      currentAudio.play().catch((e) => debug(`[TTS] play failed: ${e.message}`, 'error'));
    } else if (mode === 'browser') {
      speakBrowser(text);
    }
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
      <div class="campfire-log-wrap">
        <p class="campfire-food-label">Log</p>
        <div class="campfire-log-frame">
          <div id="campfire-log" class="campfire-log"></div>
          <div id="campfire-scroll" class="campfire-scroll" aria-hidden="true">
            <div id="campfire-scroll-thumb" class="campfire-scroll-thumb"></div>
          </div>
        </div>
      </div>
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
  campfireMealFull = portionsNeeded <= 0;
  renderCampfireCache(cache || []);
  renderCampfireMeal(meal || []);
  applyMealStatus(portionsNeeded);
  document.getElementById('btn-end-day-campfire').addEventListener('click', () => {
    socket.emit('end-day');
    debug('End day requested', 'phase');
  });
  // Custom scrollbar wiring (replaces macOS overlay native scrollbar that
  // hides on idle). Listen for scroll + window resize; recompute on insert.
  const log = document.getElementById('campfire-log');
  if (log) {
    log.addEventListener('scroll', updateCampfireScroll);
    window.addEventListener('resize', updateCampfireScroll);
    updateCampfireScroll();
  }
});

function updateCampfireScroll() {
  const log = document.getElementById('campfire-log');
  const scroll = document.getElementById('campfire-scroll');
  const thumb = document.getElementById('campfire-scroll-thumb');
  if (!log || !scroll || !thumb) return;
  const frame = log.parentElement;
  const overflow = log.scrollHeight > log.clientHeight + 1;
  if (frame) frame.classList.toggle('has-overflow', overflow);
  if (!overflow) return;
  const trackH = scroll.clientHeight;
  const ratio = log.clientHeight / log.scrollHeight;
  const thumbH = Math.max(20, trackH * ratio);
  const scrollMax = log.scrollHeight - log.clientHeight;
  const trackMax = trackH - thumbH;
  const top = scrollMax > 0 ? (log.scrollTop / scrollMax) * trackMax : 0;
  thumb.style.height = `${thumbH}px`;
  thumb.style.top = `${top}px`;
}

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
      const disabled = campfireMealFull ? ' disabled' : '';
      return `<button class="cache-slot meal-add" data-name="${escapeHtml(s.name)}"${disabled}>${label}</button>`;
    }
    return `<div class="cache-slot">${label}</div>`;
  }).join('');
  el.querySelectorAll('.cache-slot.meal-add:not([disabled])').forEach((btn) => {
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
  campfireMealFull = portionsNeeded <= 0;
  applyMealStatus(portionsNeeded);
  renderCampfireCache(cache || []);
  renderCampfireMeal(meal || []);
});

socket.on('campfire-log', ({ name, action, what }) => {
  const log = document.getElementById('campfire-log');
  if (!log) return;
  const verb = action === 'shared' ? 'shared' : 'took';
  const entry = document.createElement('p');
  entry.textContent = `${name} ${verb}: ${what}`;
  log.insertBefore(entry, log.firstChild);
  updateCampfireScroll();
});

// --- Scene event state ---
// sceneBeats: array of { voice, text } currently on-screen for the active
//   event. Cleared on event-start (or new day).
// sceneVoices: keyed voice config map (key → character config) for TTS.
let sceneBeats = [];
let sceneVoices = {};
// event-beat defers its prose render behind TTS prefetch. A host-status
// line arrives right after its beat in the stream, so rendering it
// immediately would beat the prose to screen. eventBeatPending is true
// while a beat is mid-render; if a status lands then, it's stashed in
// pendingEventStatus and applied once the beat actually paints.
let eventBeatPending = false;
let pendingEventStatus = null;
// Same deferral for the arrival scene's hand-back to the action phase:
// event-end arrives right behind the final beat, which may still be
// painting. Restore the action chrome only once that beat is on screen.
let pendingArrivalChrome = false;

function applyEventStatus(text) {
  const note = document.getElementById('phase-note');
  if (!note) return;
  note.textContent = text || '';
  note.style.display = text ? '' : 'none';
}

// Bring back Day 1's action-selection chrome that a scene event hid.
function restoreActionChrome() {
  const prompt = document.querySelector('.action-prompt-host');
  const status = document.getElementById('action-status');
  const note = document.getElementById('phase-note');
  if (prompt) prompt.style.display = '';
  if (status) status.style.display = '';
  if (note) note.style.display = 'none';
}

// The arrival scene's final beat is on screen now: restore the host chrome
// AND tell the server, which is parked waiting on this before it releases
// the phones into Day 1's action picker.
function finishArrival() {
  restoreActionChrome();
  socket.emit('event-render-complete');
}

// Day narration is in view; the server is waiting for the host to advance
// into the scene event. Show the Proceed button. Capture voice configs so
// TTS is ready the moment Proceed is clicked.
socket.on('event-pending', ({ playerNames, characters }) => {
  debug(`Event pending: ${playerNames.join(', ')}`, 'phase');
  sceneVoices = {};
  for (const c of characters || []) sceneVoices[c.key] = c;
  const btn = document.getElementById('btn-proceed-event');
  if (btn) btn.style.display = '';
});

// Scene event begins. Clear the displayed day prose so the scene takes
// over the narration area; the canonical narrative document still keeps
// the day prose, the visual just starts fresh.
socket.on('event-start', ({ characters }) => {
  if (characters) {
    for (const c of characters) sceneVoices[c.key] = c;
  }
  sceneBeats = [];
  renderNarration();
  const btn = document.getElementById('btn-proceed-event');
  if (btn) btn.style.display = 'none';
  // The scene owns the screen now — hide the action-selection chrome
  // ("What will you do?" + the per-player status list).
  const prompt = document.querySelector('.action-prompt-host');
  const status = document.getElementById('action-status');
  const note = document.getElementById('phase-note');
  if (prompt) prompt.style.display = 'none';
  if (status) status.style.display = 'none';
  if (note) note.style.display = 'none';
});

// Host-screen status line during a scene event — e.g. shown while the
// active player is answering a character's prompt. Rendered into the
// shared #phase-note element; cleared by the next beat or by event-end.
// If a beat is still painting, defer until it lands (see eventBeatPending).
socket.on('event-status', ({ text }) => {
  if (eventBeatPending) {
    pendingEventStatus = text || '';
  } else {
    applyEventStatus(text);
  }
});

// Scene event beats. Prefetch all segment audio first (if ElevenLabs),
// then render the beat and start playback together.
socket.on('event-beat', async ({ segments, replace }) => {
  if (!segments || !segments.length) return;
  // A beat landing means any "player is answering" status is now stale.
  eventBeatPending = true;
  pendingEventStatus = null;
  const note = document.getElementById('phase-note');
  if (note) note.style.display = 'none';
  const mode = ttsModeEl.value;
  let blobUrls = null;
  if (mode === 'elevenlabs') {
    blobUrls = await mapLimit(segments, TTS_CONCURRENCY, (seg) => {
      const cfg = sceneVoices[seg.voice];
      const id = cfg?.elevenLabsId || ELEVENLABS_VOICE_ID;
      // ttsText carries audio tags (e.g. [dying]) for the voice model only;
      // seg.text stays clean for the on-screen prose.
      return prefetchElevenLabs(seg.ttsText || seg.text, id, cfg);
    });
  }
  // A "page turn" beat replaces the on-screen scene prose instead of
  // appending to it. The full-story document (fullNarrative) still grows.
  if (replace) sceneBeats = [];
  for (const seg of segments) sceneBeats.push(seg);
  fullNarrative += segments.map((s) => s.text).join(' ') + '\n\n';
  renderNarration();
  // The beat's prose is on screen now — apply anything that was deferred
  // until it painted: a host-status line, or the arrival scene's hand-back
  // to the action phase.
  eventBeatPending = false;
  if (pendingEventStatus !== null) {
    applyEventStatus(pendingEventStatus);
    pendingEventStatus = null;
  }
  if (pendingArrivalChrome) {
    finishArrival();
    pendingArrivalChrome = false;
  }
  if (mode === 'off') return;
  if (mode === 'elevenlabs') {
    stopAudio();
    for (let i = 0; i < blobUrls.length; i++) {
      if (!blobUrls[i]) continue;
      const cfg = sceneVoices[segments[i].voice];
      await playBlobAwait(blobUrls[i], cfg?.volume ?? 1);
      // Breathing room before the next segment — a voice's pauseAfterMs
      // overrides the default paragraph gap. No pause after the last one.
      if (i < blobUrls.length - 1) {
        await new Promise((r) => setTimeout(r, cfg?.pauseAfterMs ?? SEGMENT_GAP_MS));
      }
    }
  } else {
    speakSegments(segments);
  }
});

socket.on('event-end', ({ eventId, summary }) => {
  if (summary) debug(`Event ended: ${summary}`, 'phase');
  // The arrival scene hands straight back to Day 1's action phase — restore
  // the action-selection chrome it hid. Other events (e.g. King Krab) hand
  // off to day-resolution instead, so leave their chrome alone.
  if (eventId === 'arrival') {
    // Defer the hand-back if the final beat is still painting, so "What
    // will you do?" + the player list (and the phones) don't reappear
    // before Skipper's death narration is on screen.
    if (eventBeatPending) pendingArrivalChrome = true;
    else finishArrival();
  }
});

// Sandbox-only payload: this day's react() calls + the full character state
// for every character that has ever fired. Replaces the narration prose
// view in sandbox mode.
socket.on('sandbox-debug', ({ day, reactions, characterState }) => {
  const el = document.getElementById('sandbox-debug');
  if (!el) return;
  const reactionBlock = (reactions && reactions.length)
    ? reactions.map((r) => {
        const outs = (r.outputs || []).length
          ? r.outputs.map((o) => `<li><span class="kind-${o.kind}">${o.kind}</span> ${escapeHtml(o.text)}</li>`).join('')
          : '<li class="empty">(no visible reaction — character chose silence)</li>';
        return `
          <div class="sandbox-reaction">
            <p class="sandbox-h"><strong>${escapeHtml(r.characterName)}</strong> reacted to ${escapeHtml(r.playerName)}: "${escapeHtml(r.action)}"</p>
            <ul class="sandbox-outputs">${outs}</ul>
          </div>
        `;
      }).join('')
    : '<p class="sandbox-empty">No react() calls this day.</p>';

  const historyBlock = Object.entries(characterState || {}).map(([key, state]) => {
    const entries = (state.history || []).map((h) => `
      <div class="sandbox-history-entry">
        <p class="sandbox-memory">Day ${h.day}: ${escapeHtml(h.memory || '')}</p>
      </div>
    `).join('');
    return `
      <div class="sandbox-character">
        <p class="sandbox-label">${escapeHtml(key)} — memories (${(state.history || []).length})</p>
        ${entries || '<p class="sandbox-empty">(empty)</p>'}
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <p class="sandbox-label">Day ${day} — react()</p>
    ${reactionBlock}
    <p class="sandbox-label" style="margin-top:24px">Character state</p>
    ${historyBlock || '<p class="sandbox-empty">(no characters have reacted yet)</p>'}
  `;
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
  const blobUrl = await prefetchElevenLabs(text, ELEVENLABS_VOICE_ID);
  if (!blobUrl) return;
  currentAudio = new Audio(blobUrl);
  currentAudio.play().catch((e) => debug(`[TTS] play failed: ${e.message}`, 'error'));
}

// Resolve to a playable blob URL for the given text+voice. Cached after
// the first fetch. Used to gate visual narration on audio readiness.
// `voiceConfig` (optional) provides per-character model_id + voice_settings.
async function prefetchElevenLabs(text, voiceId, voiceConfig) {
  const settingsKey = voiceConfig
    ? JSON.stringify({ m: voiceConfig.elevenLabsModel, s: voiceConfig.elevenLabsSettings })
    : '';
  const key = `${voiceId}|${settingsKey}|${text}`;
  let blobUrl = elAudioCache.get(key);
  if (blobUrl) return blobUrl;
  const body = { voice_id: voiceId, text };
  if (voiceConfig?.elevenLabsModel) body.model_id = voiceConfig.elevenLabsModel;
  if (voiceConfig?.elevenLabsSettings) body.voice_settings = voiceConfig.elevenLabsSettings;
  // Retry once on a 429 (ElevenLabs concurrency cap) after a short backoff.
  // mapLimit keeps a single beat under the cap, but a stray overlap can
  // still trip it — the retry mops that up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.ok) {
      const blob = await resp.blob();
      blobUrl = URL.createObjectURL(blob);
      elAudioCache.set(key, blobUrl);
      return blobUrl;
    }
    if (resp.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 800));
      continue;
    }
    debug(`[TTS] HTTP ${resp.status}`, 'error');
    return null;
  }
  return null;
}

// Run async `fn` over `items` with at most `limit` in flight at once — keeps
// TTS prefetch under ElevenLabs' per-subscription concurrency cap (5 on the
// Creator plan). Preserves input order in the results array.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Max concurrent TTS prefetches (under the ElevenLabs cap of 5, with margin).
const TTS_CONCURRENCY = 4;
// Default gap between consecutive narration segments (paragraphs) so the
// reader doesn't jump straight into the next one. A voice's pauseAfterMs
// overrides this.
const SEGMENT_GAP_MS = 700;

// Shared Web Audio context, created lazily on first non-unity-gain playback.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  return audioCtx;
}

// Play a TTS blob to completion. `volume` routes playback through a Web
// Audio gain node so values ABOVE 1.0 are possible — HTMLAudioElement.volume
// is hard-capped at 1.0, which can't lift a quiet character voice to match
// the narrator. volume === 1 skips Web Audio entirely (plain playback).
function playBlobAwait(blobUrl, volume = 1) {
  return new Promise((resolve) => {
    currentAudio = new Audio(blobUrl);
    currentAudio.onended = resolve;
    currentAudio.onerror = resolve;
    if (volume !== 1) {
      const ctx = getAudioCtx();
      if (ctx) {
        try {
          const src = ctx.createMediaElementSource(currentAudio);
          const gain = ctx.createGain();
          gain.gain.value = volume;
          src.connect(gain).connect(ctx.destination);
          if (ctx.state === 'suspended') ctx.resume();
        } catch {
          // Routing failed — fall back to plain element volume (≤ 1.0).
          currentAudio.volume = Math.min(1, volume);
        }
      } else {
        currentAudio.volume = Math.min(1, volume);
      }
    }
    currentAudio.play().catch(() => resolve());
  });
}

function speakNarration(text) {
  const mode = ttsModeEl.value;
  if (mode === 'off' || !text) return;
  stopAudio();
  if (mode === 'elevenlabs') return speakElevenLabs(text);
  return speakBrowser(text);
}

// Speak event-beat segments in order with per-voice configs. Awaits each
// segment's audio so the prose reads back as a coherent scene.
async function speakSegments(segments) {
  const mode = ttsModeEl.value;
  if (mode === 'off' || !segments?.length) return;
  stopAudio();
  for (const seg of segments) {
    const cfg = sceneVoices[seg.voice];
    if (mode === 'elevenlabs') {
      const id = cfg?.elevenLabsId || ELEVENLABS_VOICE_ID;
      await speakElevenLabsAwait(seg.text, id, cfg);
    } else {
      await speakBrowserAwait(seg.text, cfg);
    }
  }
}

async function speakElevenLabsAwait(text, voiceId, voiceConfig) {
  const blobUrl = await prefetchElevenLabs(text, voiceId, voiceConfig);
  if (!blobUrl) return;
  return playBlobAwait(blobUrl, voiceConfig?.volume ?? 1);
}

async function speakBrowserAwait(text, voiceConfig) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    if (browserVoice) utter.voice = browserVoice;
    if (voiceConfig?.pitch != null) utter.pitch = voiceConfig.pitch;
    if (voiceConfig?.rate != null) utter.rate = voiceConfig.rate;
    if (voiceConfig?.volume != null) utter.volume = voiceConfig.volume;
    utter.onend = resolve;
    utter.onerror = resolve;
    synth.speak(utter);
  });
}

socket.on('narration-error', ({ kind, day, error }) => {
  debug(`Narrator error: ${kind} (day ${day}) — ${error}`, 'error');
});

// Raw narration is noisy in the debug console. The prose itself displays
// on the host; if you need to inspect the structured form, check the
// sandbox panel (sandbox mode) or server logs.
socket.on('narration-debug', () => {});

socket.on('day-changed', ({ day }) => {
  currentDay = day;
  sceneBeats = [];
  sceneVoices = {};
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
    const proceedEventBtn = document.getElementById('btn-proceed-event');
    const lightBtn = document.getElementById('btn-light-fire');
    const endBtn = document.getElementById('btn-end-day');
    const prompt = document.querySelector('.action-prompt-host');
    const status = document.getElementById('action-status');
    const note = document.getElementById('phase-note');
    if (proceedBtn) proceedBtn.style.display = 'none';
    if (proceedEventBtn) proceedEventBtn.style.display = 'none';
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
  const involves = result.involves || 'none';
  let line = `[CAT] ${player} at ${location}: "${action}" → ${possible} | ${result.attribute} | ${result.difficulty} | seeking:${seeking} | involves:${involves} — ${result.rationale}`;
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
