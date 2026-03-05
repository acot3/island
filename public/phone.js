const socket = io();

let myName = '';
let myHp = 6;
let myFood = 0;

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const headerEl = document.getElementById('player-header');
const contentEl = document.getElementById('player-content');
const joinError = document.getElementById('join-error');

// --- Hearts ---

function renderHearts(hp) {
  let html = '<span class="hearts">';
  for (let i = 0; i < 3; i++) {
    const heartHp = Math.max(0, Math.min(2, hp - i * 2));
    if (heartHp === 2) html += '<span class="heart full">\u2665</span>';
    else if (heartHp === 1) html += '<span class="heart half">\u2665</span>';
    else html += '<span class="heart empty">\u2661</span>';
  }
  html += '</span>';
  return html;
}

function renderHeader() {
  const canEat = myFood > 0 && myHp < 6;
  const eatBtn = canEat ? ' <button class="btn-eat" id="btn-eat">Eat</button>' : '';
  headerEl.innerHTML = `
    <div class="stats">
      <span class="player-name">${myName}</span>
      ${renderHearts(myHp)}
      <span class="food-count">Food: ${myFood}</span>
      ${eatBtn}
    </div>
  `;
  const eat = document.getElementById('btn-eat');
  if (eat) {
    eat.addEventListener('click', () => {
      socket.emit('eat-food');
    });
  }
}

// --- Picker dropdowns ---

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

socket.on('join-ok', ({ name }) => {
  myName = name;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  renderHeader();
  contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
});

// --- Loading ---

socket.on('phase', ({ phase }) => {
  if (phase === 'loading') {
    contentEl.innerHTML = '<p class="status-msg">Loading...</p>';
  }
});

// --- Your turn (action selection) ---

socket.on('your-turn', ({ day, suggestions, hp, food }) => {
  myHp = hp;
  myFood = food;
  renderHeader();

  let html = `<p class="day-label">Day ${day}</p>`;
  html += '<div class="suggestions">';
  suggestions.forEach((s, i) => {
    html += `<button class="suggestion-btn" data-index="${i}">${s}</button>`;
  });
  html += '</div>';
  html += `
    <div class="custom-action">
      <input type="text" id="custom-input" placeholder="Or type your own...">
      <button id="custom-submit">Go</button>
    </div>
  `;
  contentEl.innerHTML = html;

  // Bind suggestion buttons
  contentEl.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => submitAction(btn.textContent));
  });

  // Bind custom action
  document.getElementById('custom-submit').addEventListener('click', () => {
    const val = document.getElementById('custom-input').value.trim();
    if (val) submitAction(val);
  });
  document.getElementById('custom-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) submitAction(val);
    }
  });
});

function submitAction(action) {
  socket.emit('submit-action', { action });
}

socket.on('action-confirmed', ({ action }) => {
  contentEl.innerHTML = `
    <p class="status-msg">Action chosen:</p>
    <p style="color:#fff; margin-top:8px;">${action}</p>
    <button id="btn-make-public" class="btn-make-public">Make Public</button>
    <p class="status-msg" style="margin-top:16px;">Waiting for other players...</p>
  `;
  document.getElementById('btn-make-public').addEventListener('click', function() {
    socket.emit('make-public');
    this.textContent = 'Shared';
    this.disabled = true;
  });
});

// --- Assist option from another player ---

socket.on('assist-option', ({ name, action }) => {
  // Only add if we're still choosing (suggestions visible)
  const suggestions = contentEl.querySelector('.suggestions');
  if (!suggestions) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'assist-wrapper';
  const btn = document.createElement('button');
  btn.className = 'suggestion-btn assist-btn';
  btn.textContent = action;
  btn.addEventListener('click', () => submitAction(`Assist ${name}`));
  const label = document.createElement('div');
  label.className = 'assist-label';
  label.textContent = `Assist ${name}`;
  wrapper.appendChild(btn);
  wrapper.appendChild(label);
  suggestions.appendChild(wrapper);
});

// --- Day result (private food) ---

socket.on('day-result', ({ hp, food, pendingFood, pendingDescription }) => {
  myHp = hp;
  myFood = food;
  renderHeader();

  let html = '<div class="food-result">';
  html += `<p>${pendingDescription}</p>`;
  if (pendingFood > 0) {
    html += `<p class="amount">+${pendingFood} food</p>`;
  }
  html += '</div>';
  html += '<p class="status-msg">Waiting for campfire...</p>';
  contentEl.innerHTML = html;
});

// --- Campfire ---

socket.on('campfire-turn', ({ hp, food, pendingFood }) => {
  myHp = hp;
  myFood = food;
  renderHeader();

  let html = '<p class="day-label">Campfire</p>';
  if (pendingFood > 0) {
    html += `
      <p>You have ${pendingFood} food to share.</p>
      <div class="campfire-share">
        <label>Share:</label>
        <input type="number" id="share-amount" min="0" max="${pendingFood}" value="${pendingFood}">
        <span>/ ${pendingFood}</span>
        <button id="btn-share">Share</button>
      </div>
    `;
  } else {
    html += '<p>You have no food to share.</p>';
    html += '<div class="campfire-share"><button id="btn-share">Continue</button></div>';
  }
  contentEl.innerHTML = html;

  document.getElementById('btn-share').addEventListener('click', () => {
    const input = document.getElementById('share-amount');
    const amount = input ? parseInt(input.value, 10) || 0 : 0;
    socket.emit('submit-campfire', { amount });
  });
});

socket.on('campfire-confirmed', ({ shared, food, groupFood }) => {
  myFood = food;
  renderHeader();
  contentEl.innerHTML = `
    <p>Shared ${shared} food with the group.</p>
    <button id="btn-take" class="btn-take">Take a portion</button>
    <p class="status-msg" id="pool-status">Pool: ${groupFood}</p>
  `;
  document.getElementById('btn-take').addEventListener('click', () => {
    socket.emit('take-portion');
  });
});

socket.on('campfire-pool', ({ groupFood }) => {
  const btn = document.getElementById('btn-take');
  if (btn) {
    btn.disabled = groupFood <= 0;
    if (groupFood <= 0) btn.textContent = 'Pool empty';
  }
  const status = document.getElementById('pool-status');
  if (status) status.textContent = `Pool: ${groupFood}`;
});

// --- Stats update (from eating) ---

socket.on('stats-update', ({ hp, food }) => {
  myHp = hp;
  myFood = food;
  renderHeader();
});
