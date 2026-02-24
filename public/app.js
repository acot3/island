const state = {
  phase: 'lobby',
  day: 1,
  players: {
    Jack: { suggestions: [], chosenAction: null, food: 0, pendingFood: 0, pendingDescription: '', campfireReady: false, shareFood: 0 },
    Jill: { suggestions: [], chosenAction: null, food: 0, pendingFood: 0, pendingDescription: '', campfireReady: false, shareFood: 0 },
  },
  sharedFood: 0,
};

const PLAYERS = ['Jack', 'Jill'];

// DOM refs
const narrationContent = document.getElementById('narration-content');
const debugPanel = document.getElementById('debug');
const playerPanels = {
  Jack: document.querySelector('#player-jack .player-content'),
  Jill: document.querySelector('#player-jill .player-content'),
};

// --- Debug console ---

function debug(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `debug-line debug-${type}`;
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  line.textContent = `[${ts}] ${msg}`;
  debugPanel.appendChild(line);
  debugPanel.scrollTop = debugPanel.scrollHeight;
}

// --- API helpers ---

async function api(endpoint, body) {
  const t0 = performance.now();
  debug(`POST ${endpoint}`, 'api');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    const err = await res.json();
    debug(`${endpoint} FAILED (${elapsed}s): ${err.error}`, 'error');
    throw new Error(err.error || 'API error');
  }
  debug(`${endpoint} OK (${elapsed}s)`, 'api');
  return res.json();
}

// --- Render helpers ---

function setNarration(html) {
  narrationContent.innerHTML = html;
}

function setPlayer(name, html) {
  playerPanels[name].innerHTML = html;
}

function allActionsChosen() {
  return PLAYERS.every(p => state.players[p].chosenAction !== null);
}

function allCampfireReady() {
  return PLAYERS.every(p => state.players[p].campfireReady);
}

// --- Phase: Lobby ---

function renderLobby() {
  setNarration(`
    <h1>ISLAND</h1>
    <p>A survival story.</p>
    <button id="btn-start">Start Game</button>
  `);
  document.getElementById('btn-start').addEventListener('click', startGame);

  PLAYERS.forEach(name => {
    setPlayer(name, '<p class="status">Waiting...</p>');
  });
}

// --- Phase: Morning ---

async function startGame() {
  const prevPhase = state.phase;
  state.phase = 'morning';
  debug(`Phase: ${prevPhase} → morning (Day ${state.day})`, 'phase');
  setNarration('<p>The sun rises...</p>');
  PLAYERS.forEach(name => setPlayer(name, '<p class="status">...</p>'));

  try {
    const data = await api('/api/morning', { day: state.day, players: PLAYERS });

    setNarration(`
      <p class="food-count">Day ${state.day}</p>
      <p>${data.narration}</p>
    `);

    PLAYERS.forEach(name => {
      const suggestions = data.suggestions[name] || [];
      state.players[name].suggestions = suggestions;
      state.players[name].chosenAction = null;
      renderActionPanel(name);
    });

    state.phase = 'action';
    debug('Phase: morning → action', 'phase');
  } catch (err) {
    debug(`Error: ${err.message}`, 'error');
    setNarration(`<p>Error: ${err.message}</p>`);
  }
}

function renderActionPanel(name) {
  const p = state.players[name];
  const chosen = p.chosenAction;

  let html = `<p class="food-count">Food: ${p.food}</p>`;
  html += '<div class="suggestions">';
  p.suggestions.forEach((s, i) => {
    const sel = chosen === s ? ' selected' : '';
    const dis = chosen !== null ? ' disabled' : '';
    html += `<button class="suggestion-btn${sel}"${dis} data-player="${name}" data-index="${i}">${s}</button>`;
  });
  html += '</div>';

  if (chosen === null) {
    html += `
      <div class="custom-action">
        <input type="text" placeholder="Or type your own..." data-player="${name}">
        <button class="custom-submit" data-player="${name}">Go</button>
      </div>`;
  } else {
    html += `<p>Chosen: ${chosen}</p>`;
  }

  setPlayer(name, html);

  // Bind suggestion buttons
  playerPanels[name].querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (state.players[name].chosenAction !== null) return;
      submitAction(name, btn.textContent);
    });
  });

  // Bind custom action
  const customBtn = playerPanels[name].querySelector('.custom-submit');
  if (customBtn) {
    const input = playerPanels[name].querySelector('.custom-action input');
    customBtn.addEventListener('click', () => {
      const val = input.value.trim();
      if (val) submitAction(name, val);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) submitAction(name, val);
      }
    });
  }
}

function submitAction(name, action) {
  state.players[name].chosenAction = action;
  debug(`${name} chose: "${action}"`, 'action');
  renderActionPanel(name);

  if (allActionsChosen()) {
    showNarrateButton();
  }
}

function showNarrateButton() {
  const existing = document.getElementById('btn-narrate');
  if (existing) return;

  const btn = document.createElement('button');
  btn.id = 'btn-narrate';
  btn.textContent = 'Narrate Day';
  btn.addEventListener('click', narrateDay);
  narrationContent.appendChild(btn);
}

// --- Phase: Narration ---

async function narrateDay() {
  state.phase = 'narration';
  debug('Phase: action → narration', 'phase');
  const actions = {};
  PLAYERS.forEach(p => { actions[p] = state.players[p].chosenAction; });

  setNarration('<p>The day unfolds...</p>');

  try {
    const data = await api('/api/day', { day: state.day, actions });

    // Update private food data
    PLAYERS.forEach(name => {
      const food = data.food[name] || { units: 0, description: 'You found nothing.' };
      state.players[name].pendingFood = food.units;
      state.players[name].pendingDescription = food.description;
      state.players[name].food += food.units;
      debug(`${name}: +${food.units} food (total: ${state.players[name].food})`, 'food');
    });

    // Show shared narration + light fire button
    setNarration(`
      <p class="food-count">Day ${state.day}</p>
      <p>${data.narration}</p>
      <button id="btn-fire">Light the Fire</button>
    `);
    document.getElementById('btn-fire').addEventListener('click', startCampfire);

    // Show private food notifications on player panels
    PLAYERS.forEach(name => {
      const p = state.players[name];
      let html = `<p class="food-count">Food: ${p.food}</p>`;
      if (p.pendingFood > 0) {
        html += `<p>${p.pendingDescription}</p>`;
        html += `<p class="food-count">+${p.pendingFood} food</p>`;
      } else {
        html += `<p>${p.pendingDescription}</p>`;
      }
      setPlayer(name, html);
    });
  } catch (err) {
    debug(`Error: ${err.message}`, 'error');
    setNarration(`<p>Error: ${err.message}</p>`);
  }
}

// --- Phase: Campfire ---

function startCampfire() {
  state.phase = 'campfire';
  debug('Phase: narration → campfire', 'phase');
  state.sharedFood = 0;

  PLAYERS.forEach(name => {
    state.players[name].campfireReady = false;
    state.players[name].shareFood = 0;
    renderCampfirePanel(name);
  });

  setNarration(`
    <p class="food-count">Day ${state.day} — Campfire</p>
    <p>The fire crackles. What will you share?</p>
    <div id="shared-log"></div>
  `);
}

function renderCampfirePanel(name) {
  const p = state.players[name];

  if (p.campfireReady) {
    setPlayer(name, `
      <p class="food-count">Food: ${p.food}</p>
      <p>Shared ${p.shareFood} food with the group.</p>
    `);
    return;
  }

  let html = `<p class="food-count">Food: ${p.food}</p>`;
  if (p.pendingFood > 0) {
    html += `<p>${p.pendingDescription}</p>`;
  }
  html += `
    <div class="campfire-share">
      <label>Share:</label>
      <input type="number" min="0" max="${p.pendingFood}" value="${p.pendingFood}" data-player="${name}">
      <span>/ ${p.pendingFood}</span>
      <button class="campfire-submit" data-player="${name}">Share</button>
    </div>`;

  setPlayer(name, html);

  const submitBtn = playerPanels[name].querySelector('.campfire-submit');
  const input = playerPanels[name].querySelector('input[type="number"]');
  submitBtn.addEventListener('click', () => {
    let val = parseInt(input.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    if (val > p.pendingFood) val = p.pendingFood;
    submitCampfire(name, val);
  });
}

function submitCampfire(name, amount) {
  const p = state.players[name];
  p.shareFood = amount;
  p.campfireReady = true;
  state.sharedFood += amount;
  debug(`${name} shared ${amount} food`, 'action');

  renderCampfirePanel(name);

  // Update shared log on narration panel
  const log = document.getElementById('shared-log');
  if (log) {
    const entry = document.createElement('p');
    entry.textContent = `${name} shared ${amount} food.`;
    log.appendChild(entry);
  }

  if (allCampfireReady()) {
    showNextDayButton();
  }
}

function showNextDayButton() {
  const total = document.createElement('p');
  total.textContent = `Total shared: ${state.sharedFood} food`;
  total.style.marginTop = '12px';

  const btn = document.createElement('button');
  btn.id = 'btn-next';
  btn.textContent = 'Next Day';
  btn.style.marginTop = '8px';
  btn.addEventListener('click', nextDay);

  narrationContent.appendChild(total);
  narrationContent.appendChild(btn);
}

// --- Next day ---

function nextDay() {
  debug(`Day ${state.day} complete. Shared food total: ${state.sharedFood}`, 'phase');
  state.day++;
  PLAYERS.forEach(name => {
    state.players[name].suggestions = [];
    state.players[name].chosenAction = null;
    state.players[name].pendingFood = 0;
    state.players[name].pendingDescription = '';
    state.players[name].campfireReady = false;
    state.players[name].shareFood = 0;
  });
  state.sharedFood = 0;

  startGame();
}

// --- Init ---
renderLobby();
