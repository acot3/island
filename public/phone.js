const socket = io();

let myName = '';
let myHp = null;
let myInventory = null; // null = pre-game; once game starts it becomes [].
let myDead = false;
let myCampfireMode = false; // true while host is in campfire phase and we're at camp
let myCache = [];           // group inventory while in campfire mode
let myFinding = null;       // private one-sentence note from the findings narrator
const INVENTORY_SIZE = 3;
const MAX_HP = 6;
let myRoom = '';

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const headerEl = document.getElementById('player-header');
const contentEl = document.getElementById('player-content');
const inventoryEl = document.getElementById('player-inventory');
const joinError = document.getElementById('join-error');

// --- Reconnection ---

const saved = sessionStorage.getItem('island-phone');
if (saved) {
  try {
    const parsed = JSON.parse(saved);
    myRoom = parsed.code || '';
    myName = parsed.name || '';
  } catch {}
}

socket.on('connect', () => {
  if (myRoom && myName) {
    socket.emit('rejoin-room', { code: myRoom, name: myName });
  }
});

socket.on('rejoin-fail', () => {
  sessionStorage.removeItem('island-phone');
  myRoom = '';
  myName = '';
});

socket.on('room-closed', () => {
  sessionStorage.removeItem('island-phone');
  location.reload();
});

// --- Header ---

// HP is measured in half-hearts (0..6). Render as 3 hearts: each one shows
// full / half / empty depending on the player's remaining halves.
function renderHearts(hp) {
  let html = '<span class="hearts">';
  for (let i = 0; i < 3; i++) {
    const heartHp = Math.max(0, Math.min(2, hp - i * 2));
    if (heartHp === 2) html += '<span class="heart full">♥</span>';
    else if (heartHp === 1) html += '<span class="heart half">♥</span>';
    else html += '<span class="heart empty">♡</span>';
  }
  html += '</span>';
  return html;
}

function renderHeader() {
  const hearts = myHp === null ? '' : renderHearts(myHp);
  headerEl.innerHTML = `
    <div class="stats">
      <span class="player-name">${escapeHtml(myName)}</span>
      ${hearts}
    </div>
  `;
}

// Inventory: always renders INVENTORY_SIZE slots once the game has started.
// Empty slots show a dash. Slots are { name, count, type }; food slots show
// the count in brackets (daily portions, not literal item count). Items
// don't show a count — duplicates simply open a new slot.
function renderInventory() {
  if (!inventoryEl) return;
  if (myInventory === null || myDead) {
    inventoryEl.innerHTML = '';
    return;
  }
  const canEatHp = typeof myHp === 'number' && myHp < MAX_HP;
  // In campfire mode, slots are tap-to-deposit. Food slots additionally get
  // an inline "Eat (+1 HP)" button when the player isn't at full health.
  const slots = [];
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const it = myInventory[i];
    if (!it) {
      slots.push(`<div class="inventory-slot empty">—</div>`);
      continue;
    }
    const safeName = escapeHtml(it.name);
    if (it.type === 'food') {
      const label = `${safeName} [${it.count}]`;
      const foodEl = myCampfireMode
        ? `<button class="inventory-slot food-text deposit" data-name="${safeName}">${label}</button>`
        : `<div class="inventory-slot food-text">${label}</div>`;
      const eatEl = canEatHp && it.count > 0
        ? `<button class="inventory-slot eat-slot" data-name="${safeName}">Eat</button>`
        : '';
      slots.push(`<div class="inventory-row">${foodEl}${eatEl}</div>`);
    } else if (myCampfireMode) {
      slots.push(`<button class="inventory-slot deposit" data-name="${safeName}">${safeName}</button>`);
    } else {
      slots.push(`<div class="inventory-slot">${safeName}</div>`);
    }
  }
  const title = myCampfireMode ? 'Inventory (tap to share)' : 'Inventory';
  inventoryEl.innerHTML = `
    <p class="action-prompt">${title}</p>
    <div class="inventory">${slots.join('')}</div>
  `;
  // Eat buttons (always wired when present).
  inventoryEl.querySelectorAll('.eat-slot').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      socket.emit('eat-food', { name: btn.dataset.name });
    });
  });
  // Deposit clicks (only in campfire mode). For food rows, the inline Eat
  // button stops propagation so the row click only fires for non-Eat taps.
  if (myCampfireMode) {
    inventoryEl.querySelectorAll('.inventory-slot.deposit').forEach((el) => {
      el.addEventListener('click', () => {
        socket.emit('campfire-deposit', { name: el.dataset.name });
      });
    });
  }
}

// Group inventory list (cache) shown in #player-content during campfire.
// Each cache slot is a tap-to-withdraw button. Empty cache renders one
// dimmed row so the player sees the section is there.
function renderCampfireGroup() {
  const slots = myCache.map((s) => {
    const label = s.type === 'food'
      ? `${escapeHtml(s.name)} [${s.count}]`
      : escapeHtml(s.name);
    return `<button class="inventory-slot withdraw" data-name="${escapeHtml(s.name)}">${label}</button>`;
  });
  const list = slots.length
    ? slots.join('')
    : '<div class="inventory-slot empty">—</div>';
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    <p class="action-prompt">Stockpile (tap to take)</p>
    <div class="inventory">${list}</div>
  `;
  contentEl.querySelectorAll('.inventory-slot.withdraw').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('campfire-withdraw', { name: btn.dataset.name });
    });
  });
}

// --- Picker overlay ---

function openPicker(options, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'picker-overlay';
  const list = document.createElement('div');
  list.className = 'picker-list';
  options.forEach(({ value, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-option';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      onSelect(value, label);
      overlay.remove();
    });
    list.appendChild(btn);
  });
  overlay.appendChild(list);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

const pronounsOptions = [
  { value: 'she/her', label: 'she / her' },
  { value: 'he/him', label: 'he / him' },
  { value: 'they/them', label: 'they / them' },
];

const mbtiOptions = [
  { value: 'INTJ', label: 'INTJ — The Architect' },
  { value: 'INTP', label: 'INTP — The Logician' },
  { value: 'ENTJ', label: 'ENTJ — The Commander' },
  { value: 'ENTP', label: 'ENTP — The Debater' },
  { value: 'INFJ', label: 'INFJ — The Advocate' },
  { value: 'INFP', label: 'INFP — The Mediator' },
  { value: 'ENFJ', label: 'ENFJ — The Protagonist' },
  { value: 'ENFP', label: 'ENFP — The Campaigner' },
  { value: 'ISTJ', label: 'ISTJ — The Logistician' },
  { value: 'ISFJ', label: 'ISFJ — The Defender' },
  { value: 'ESTJ', label: 'ESTJ — The Executive' },
  { value: 'ESFJ', label: 'ESFJ — The Consul' },
  { value: 'ISTP', label: 'ISTP — The Virtuoso' },
  { value: 'ISFP', label: 'ISFP — The Adventurer' },
  { value: 'ESTP', label: 'ESTP — The Entrepreneur' },
  { value: 'ESFP', label: 'ESFP — The Entertainer' },
];

document.getElementById('trigger-pronouns').addEventListener('click', () => {
  openPicker(pronounsOptions, (value, label) => {
    document.getElementById('input-pronouns').value = value;
    const trigger = document.getElementById('trigger-pronouns');
    trigger.textContent = label;
    trigger.classList.add('selected');
  });
});

document.getElementById('trigger-mbti').addEventListener('click', () => {
  openPicker(mbtiOptions, (value, label) => {
    document.getElementById('input-mbti').value = value;
    const trigger = document.getElementById('trigger-mbti');
    trigger.textContent = label;
    trigger.classList.add('selected');
  });
});

// --- Join ---

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = document.getElementById('input-code').value.trim();
  const name = document.getElementById('input-name').value.trim();
  const pronouns = document.getElementById('input-pronouns').value;
  const mbti = document.getElementById('input-mbti').value;
  if (!code || !name) {
    joinError.textContent = 'Enter room code and name.';
    return;
  }
  if (!pronouns) {
    joinError.textContent = 'Select your pronouns.';
    return;
  }
  joinError.textContent = '';
  socket.emit('join-room', { code, name, pronouns, mbti });
}

socket.on('join-error', ({ message }) => {
  joinError.textContent = message;
});

socket.on('join-ok', ({ name, code }) => {
  myName = name;
  myRoom = code;
  sessionStorage.setItem('island-phone', JSON.stringify({ code, name }));
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  renderHeader();
  contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
});

socket.on('rejoin-state', ({ name, code, phase, day }) => {
  myName = name;
  myRoom = code;
  currentDay = day || 1;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  renderHeader();
  if (phase === 'started') {
    // your-location will arrive next; render placeholder until it does.
    if (myLocation) renderActions();
    else contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
  } else if (phase === 'campfire') {
    // The follow-up events (campfire-turn for camp players, day-narrated
    // for everyone else) will populate the view. Show a placeholder until
    // they land.
    contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
  } else {
    contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
  }
});

// --- Game state (started phase) ---

let currentDay = 1;
let myLocation = null;       // { nodeId, biome, color, neighbors }
let pendingMoveTarget = null; // a neighbor object the player has tapped but not confirmed
let assistOptions = [];      // [{ name, action }] from publicly-shared actions
let actionInputOpen = false; // is the "Take action here" input expanded?

socket.on('day-changed', ({ day }) => {
  currentDay = day;
  // action-cancelled (sent right after) will trigger renderActions() with the new day.
});

socket.on('game-started', ({ day }) => {
  currentDay = day;
  // your-location arrives in the same tick from the server. If it hasn't yet,
  // show a brief loading state — the location handler will replace it.
  if (myLocation) renderActions();
  else contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
});

socket.on('your-location', (loc) => {
  if (myDead) return;
  myLocation = loc;
  pendingMoveTarget = null;
  if (typeof loc.hp === 'number') {
    myHp = loc.hp;
    renderHeader();
  }
  if (Array.isArray(loc.inventory)) {
    myInventory = loc.inventory;
    renderInventory();
  }
  // If the phone is currently in the chosen-action view, just refresh the
  // location data quietly. The follow-up `action-cancelled` (sent by the
  // server right after) will re-render the selection screen with fresh
  // neighbors. This prevents the chosen-action box from flickering away
  // when End Day primes new locations mid-state.
  if (contentEl.querySelector('.chosen-action')) return;
  assistOptions = [];
  actionInputOpen = false;
  renderActions();
});

function renderActions() {
  if (!myLocation) {
    contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
    return;
  }
  let html = `<p class="day-label">Day ${currentDay}</p>`;
  html += `<p class="action-prompt">What will you do?</p>`;
  if (actionInputOpen) {
    html += `
      <div class="custom-action">
        <input type="text" id="custom-input" maxlength="50" autocomplete="off">
        <button id="custom-submit">Go</button>
      </div>
    `;
  } else {
    html += `<button class="suggestion-btn" id="btn-take-action">Take action here</button>`;
  }
  html += `<p class="action-prompt">OR</p>`;
  html += `<button class="suggestion-btn" id="btn-move">Move</button>`;

  if (assistOptions.length > 0) {
    html += `<p class="action-prompt">OR</p>`;
    html += `<div class="assists">`;
    assistOptions.forEach((opt, i) => {
      html += `<div class="assist-wrapper">
        <button class="suggestion-btn assist-btn" data-index="${i}">${escapeHtml(opt.action)}</button>
        <div class="assist-label">Assist ${escapeHtml(opt.name)}</div>
      </div>`;
    });
    html += `</div>`;
  }

  contentEl.innerHTML = html;

  if (actionInputOpen) {
    const input = document.getElementById('custom-input');
    input.focus();
    const go = () => {
      const val = input.value.trim();
      if (!val || val.length > 50) return;
      socket.emit('submit-action', { action: val });
    };
    document.getElementById('custom-submit').onclick = go;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  } else {
    document.getElementById('btn-take-action').onclick = () => {
      actionInputOpen = true;
      renderActions();
    };
  }
  document.getElementById('btn-move').onclick = renderMolecule;

  contentEl.querySelectorAll('.assist-btn').forEach((btn) => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.index, 10);
      const opt = assistOptions[i];
      if (opt) socket.emit('submit-action', { action: `Assist ${opt.name}` });
    };
  });
}

function renderActionConfirmed(action, isPublic) {
  const isAssist = /^Assist .+$/.test(action);
  const cls = isAssist ? 'assist' : (isPublic ? 'public' : '');
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    <div class="chosen-action ${cls}">${escapeHtml(action)}</div>
    ${(!isAssist && !isPublic) ? '<button id="btn-make-public" class="btn-make-public">Make public</button>' : ''}
    <button id="btn-cancel-action" class="btn-cancel-action">Cancel</button>
  `;
  const mp = document.getElementById('btn-make-public');
  if (mp) {
    mp.onclick = function () {
      socket.emit('make-public');
      this.remove();
      const box = contentEl.querySelector('.chosen-action');
      if (box) box.classList.add('public');
    };
  }
  document.getElementById('btn-cancel-action').onclick = () => {
    socket.emit('cancel-action');
  };
}

socket.on('action-confirmed', ({ action, isPublic }) => {
  actionInputOpen = false;
  renderActionConfirmed(action, !!isPublic);
});

socket.on('action-cancelled', () => {
  if (myDead) return;
  // Leaving any campfire state — back to the action picker for the new day.
  myCampfireMode = false;
  myCache = [];
  myFinding = null; // yesterday's finding doesn't carry into the new day
  actionInputOpen = false;
  renderActions();
  renderInventory();
});

// The host clicked Proceed. Actions are committed and uncancellable, but
// narrations are still loading. Show a Loading screen until day-narrated
// arrives with the finished prose.
socket.on('day-locked', () => {
  if (myDead) return;
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    <p class="status-msg">Loading…</p>
  `;
});

// Day narration (and any private finding) has finished generating. Swap
// the loading screen for the waiting screen, with the player's private
// finding above the wait message.
socket.on('day-narrated', () => {
  if (myDead) return;
  renderWaiting();
});

function renderWaiting() {
  const finding = myFinding
    ? `<p class="private-narration">${escapeHtml(myFinding)}</p>`
    : '';
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    ${finding}
    <p class="status-msg">Waiting for the next day…</p>
  `;
}

// Private one-sentence finding prose for searching players. Lands shortly
// after day-narrated. Only shown on the waiting view — the campfire view
// hides it (camp UI takes priority during that phase).
socket.on('private-narration', ({ text }) => {
  myFinding = text;
  if (myDead || myCampfireMode) return;
  renderWaiting();
});

// The host lit the fire. Players at the wreckage receive this event with
// their personal inventory + the cache. Render the group inventory in the
// main content area (tap to withdraw); the personal inventory below
// becomes tap-to-deposit (handled in renderInventory via myCampfireMode).
socket.on('campfire-turn', ({ cache }) => {
  if (myDead) return;
  myCampfireMode = true;
  myCache = Array.isArray(cache) ? cache : [];
  renderCampfireGroup();
  renderInventory();
});

// Live updates after any deposit/withdraw at the campfire.
socket.on('campfire-state', ({ cache }) => {
  if (!myCampfireMode || myDead) return;
  myCache = Array.isArray(cache) ? cache : [];
  renderCampfireGroup();
  // Personal inventory updates ride on your-location, which fires for the
  // affected player. Re-render to refresh tap targets.
  renderInventory();
});

// The player has died. Replace the entire game UI with a death notice.
socket.on('you-died', ({ deathDay }) => {
  myDead = true;
  contentEl.innerHTML = `
    <p class="day-label">Day ${deathDay}</p>
    <p class="status-msg">You have died.</p>
  `;
  if (inventoryEl) inventoryEl.innerHTML = '';
});

socket.on('assist-option', ({ name, action }) => {
  if (assistOptions.some((o) => o.name === name)) return;
  assistOptions.push({ name, action });
  if (!contentEl.querySelector('.chosen-action')) renderActions();
});

socket.on('assist-removed', ({ name }) => {
  assistOptions = assistOptions.filter((o) => o.name !== name);
  if (!contentEl.querySelector('.chosen-action')) renderActions();
});

// Molecule view: current node centered, neighbors arrayed at their real
// relative offsets. Tap a neighbor → inline confirm panel.
function renderMolecule() {
  if (!myLocation) return;
  pendingMoveTarget = null;
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    <p class="action-prompt">Choose a destination</p>
    <div id="molecule-container"></div>
    <div id="move-confirm" class="hidden"></div>
    <button class="btn-cancel-action" id="btn-cancel-move">Cancel</button>
  `;
  drawMolecule();
  document.getElementById('btn-cancel-move').onclick = renderActions;
}

function drawMolecule() {
  const container = document.getElementById('molecule-container');
  if (!container || !myLocation) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'molecule');

  const fogNodes = myLocation.fogNodes || [];
  const fogEdges = myLocation.fogEdges || [];
  const neighborsById = Object.fromEntries(
    (myLocation.neighbors || []).map((nb) => [nb.nodeId, nb])
  );
  const fogById = Object.fromEntries(fogNodes.map((n) => [n.id, n]));

  // ViewBox sized to fit every revealed node, with the player at (0,0).
  let max = 1.5;
  for (const n of fogNodes) {
    const m = Math.max(Math.abs(n.dx), Math.abs(n.dy));
    if (m > max) max = m;
  }
  const pad = 1;
  const span = (max + pad) * 2;
  svg.setAttribute('viewBox', `${-(max + pad)} ${-(max + pad)} ${span} ${span}`);

  // Edges first so nodes paint on top.
  for (const e of fogEdges) {
    const a = fogById[e.from];
    const b = fogById[e.to];
    if (!a || !b) continue;
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(a.dx));
    line.setAttribute('y1', String(a.dy));
    line.setAttribute('x2', String(b.dx));
    line.setAttribute('y2', String(b.dy));
    line.setAttribute('class', `map-edge ${e.kind || 'partial'}`);
    svg.appendChild(line);
  }

  // Non-neighbor nodes: visible but not tappable.
  for (const n of fogNodes) {
    if (n.id === myLocation.nodeId) continue;
    if (neighborsById[n.id]) continue;
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(n.dx));
    c.setAttribute('cy', String(n.dy));
    c.setAttribute('r', '0.25');
    const dim = n.visited ? '' : ' unvisited';
    c.setAttribute('class', `map-node biome-${n.biome}${dim}`);
    svg.appendChild(c);
  }

  // Center (player) node + player ring.
  const center = document.createElementNS(SVG_NS, 'circle');
  center.setAttribute('cx', '0');
  center.setAttribute('cy', '0');
  center.setAttribute('r', '0.25');
  center.setAttribute('class', `map-node biome-${myLocation.biome}`);
  svg.appendChild(center);

  if (myLocation.color) {
    const ring = document.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('cx', '0');
    ring.setAttribute('cy', '0');
    ring.setAttribute('r', '0.4');
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', myLocation.color);
    ring.setAttribute('stroke-width', '0.08');
    svg.appendChild(ring);
  }

  const wreckage = myLocation.wreckageNodeId;
  if (wreckage && myLocation.nodeId === wreckage) {
    svg.appendChild(makeCampIcon(0, 0));
  }

  // Tappable neighbors.
  for (const nb of myLocation.neighbors) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'neighbor-tap');
    g.setAttribute('data-id', nb.nodeId);

    const tap = document.createElementNS(SVG_NS, 'circle');
    tap.setAttribute('cx', String(nb.dx));
    tap.setAttribute('cy', String(nb.dy));
    tap.setAttribute('r', '0.8');
    tap.setAttribute('fill', 'transparent');
    g.appendChild(tap);

    const visual = document.createElementNS(SVG_NS, 'circle');
    visual.setAttribute('cx', String(nb.dx));
    visual.setAttribute('cy', String(nb.dy));
    visual.setAttribute('r', '0.25');
    const dim = nb.visited ? '' : ' unvisited';
    visual.setAttribute('class', `map-node biome-${nb.biome}${dim}`);
    g.appendChild(visual);

    if (pendingMoveTarget && pendingMoveTarget.nodeId === nb.nodeId) {
      const halo = document.createElementNS(SVG_NS, 'circle');
      halo.setAttribute('cx', String(nb.dx));
      halo.setAttribute('cy', String(nb.dy));
      halo.setAttribute('r', '0.45');
      halo.setAttribute('fill', 'none');
      halo.setAttribute('stroke', '#fff');
      halo.setAttribute('stroke-width', '0.06');
      g.appendChild(halo);
    }

    g.addEventListener('click', () => onNeighborTap(nb));
    svg.appendChild(g);

    if (wreckage && nb.nodeId === wreckage) {
      svg.appendChild(makeCampIcon(nb.dx, nb.dy));
    }
  }

  // Campfire icon for non-neighbor visible wreckage too.
  if (wreckage && myLocation.nodeId !== wreckage && !neighborsById[wreckage]) {
    const w = fogById[wreckage];
    if (w) svg.appendChild(makeCampIcon(w.dx, w.dy));
  }

  container.innerHTML = '';
  container.appendChild(svg);
}

function makeCampIcon(cx, cy) {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const size = 0.4;
  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '/campfire.png');
  img.setAttribute('href', '/campfire.png');
  img.setAttribute('x', String(cx - size / 2));
  img.setAttribute('y', String(cy - size / 2));
  img.setAttribute('width', String(size));
  img.setAttribute('height', String(size));
  img.setAttribute('class', 'map-camp-icon');
  // Clicks on the icon should fall through to the underlying tap target.
  img.style.pointerEvents = 'none';
  return img;
}

function onNeighborTap(neighbor) {
  pendingMoveTarget = neighbor;
  drawMolecule();

  const confirmEl = document.getElementById('move-confirm');
  const label = neighbor.label || `${neighbor.biome} (${neighbor.direction})`;
  confirmEl.innerHTML = `
    <p>Move to ${escapeHtml(label)}?</p>
    <div class="confirm-actions">
      <button class="suggestion-btn" id="btn-confirm-move">Confirm</button>
      <button class="btn-cancel-action" id="btn-deny-move">Cancel</button>
    </div>
  `;
  confirmEl.classList.remove('hidden');
  document.getElementById('btn-confirm-move').onclick = () => {
    socket.emit('submit-move', { targetNodeId: neighbor.nodeId });
  };
  document.getElementById('btn-deny-move').onclick = () => {
    pendingMoveTarget = null;
    drawMolecule();
    confirmEl.classList.add('hidden');
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
