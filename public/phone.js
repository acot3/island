const socket = io();

let myName = '';
let myRoom = '';

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const headerEl = document.getElementById('player-header');
const contentEl = document.getElementById('player-content');
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

function renderHeader() {
  headerEl.innerHTML = `
    <div class="stats">
      <span class="player-name">${escapeHtml(myName)}</span>
    </div>
  `;
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
  } else {
    contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
  }
});

// --- Game state (started phase) ---

let currentDay = 1;
let myLocation = null;       // { nodeId, biome, color, neighbors }
let pendingMoveTarget = null; // a neighbor object the player has tapped but not confirmed

socket.on('game-started', ({ day }) => {
  currentDay = day;
  // your-location arrives in the same tick from the server. If it hasn't yet,
  // show a brief loading state — the location handler will replace it.
  if (myLocation) renderActions();
  else contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
});

socket.on('your-location', (loc) => {
  myLocation = loc;
  pendingMoveTarget = null;
  renderActions();
});

// Default action view: a "Move" button. (Other action types will land here.)
function renderActions() {
  if (!myLocation) {
    contentEl.innerHTML = '<p class="status-msg">Loading…</p>';
    return;
  }
  contentEl.innerHTML = `
    <p class="day-label">Day ${currentDay}</p>
    <p class="action-prompt">What will you do?</p>
    <button class="suggestion-btn" id="btn-move">Move</button>
  `;
  document.getElementById('btn-move').onclick = renderMolecule;
}

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
  svg.setAttribute('viewBox', '-4 -4 8 8');
  svg.setAttribute('class', 'molecule');

  // Spokes (current → each neighbor)
  for (const nb of myLocation.neighbors) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', String(nb.dx));
    line.setAttribute('y2', String(nb.dy));
    line.setAttribute('class', 'map-edge');
    svg.appendChild(line);
  }

  // Center node + player ring
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

  // Neighbors — each wrapped in a <g> with a transparent oversized hit target
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
  }

  container.innerHTML = '';
  container.appendChild(svg);
}

function onNeighborTap(neighbor) {
  pendingMoveTarget = neighbor;
  drawMolecule();

  const confirmEl = document.getElementById('move-confirm');
  const biomeLabel = neighbor.biome.charAt(0).toUpperCase() + neighbor.biome.slice(1);
  confirmEl.innerHTML = `
    <p>Move to ${biomeLabel} (${neighbor.direction})?</p>
    <div class="confirm-actions">
      <button class="suggestion-btn" id="btn-confirm-move">Confirm</button>
      <button class="btn-cancel-action" id="btn-deny-move">Cancel</button>
    </div>
  `;
  confirmEl.classList.remove('hidden');
  document.getElementById('btn-confirm-move').onclick = () => {
    socket.emit('submit-move', { targetNodeId: neighbor.nodeId });
    // Server will respond with `your-location`, which calls renderActions().
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
