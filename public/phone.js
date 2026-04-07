const socket = io();

let myName = '';
let myRoom = '';
let myHp = 6;
let myFood = 0;
let isDead = false;

const joinScreen = document.getElementById('join-screen');
const gameScreen = document.getElementById('game-screen');
const headerEl = document.getElementById('player-header');
const contentEl = document.getElementById('player-content');
const joinError = document.getElementById('join-error');

// --- Reconnection ---

socket.on('connect', () => {
  if (myRoom && myName) {
    socket.emit('rejoin-room', { code: myRoom, name: myName });
  }
});

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
  const eatBtn = canEat ? ' <button class="btn-eat" id="btn-eat">Eat for +1 HP</button>' : '';
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

socket.on('join-ok', ({ name, code }) => {
  myName = name;
  myRoom = code;
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  renderHeader();
  contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
});

// --- Loading ---

socket.on('phase', ({ phase }) => {
  if (isDead) return;
  if (phase === 'loading') {
    contentEl.innerHTML = '<p class="status-msg">Loading...</p>';
  }
});

// --- Your turn (action selection) ---

function renderYourTurn(day, suggestions) {
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

  contentEl.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => submitAction(btn.textContent));
  });
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
}

socket.on('your-turn', ({ day, suggestions, hp, food }) => {
  if (isDead) return;
  myHp = hp;
  myFood = food;
  renderHeader();
  renderYourTurn(day, suggestions);
});

function submitAction(action) {
  socket.emit('submit-action', { action });
}

function renderActionConfirmed(action, day, isPublic) {
  const isAssist = action.startsWith('Assist ');
  const existingLabel = contentEl.querySelector('.day-label');
  const dayHtml = existingLabel
    ? `<p class="day-label">${existingLabel.textContent}</p>`
    : (day ? `<p class="day-label">Day ${day}</p>` : '');
  contentEl.innerHTML = `
    ${dayHtml}
    <div class="chosen-action${isAssist ? ' assist' : ''}${isPublic ? ' public' : ''}">${action}</div>
    ${!isAssist && !isPublic ? '<button id="btn-make-public" class="btn-make-public">Make public</button>' : ''}
    <button id="btn-cancel-action" class="btn-cancel-action">Cancel</button>
  `;
  const makePublicBtn = document.getElementById('btn-make-public');
  if (makePublicBtn) {
    makePublicBtn.addEventListener('click', function() {
      socket.emit('make-public');
      this.remove();
      const box = contentEl.querySelector('.chosen-action');
      if (box) box.classList.add('public');
    });
  }
  document.getElementById('btn-cancel-action').addEventListener('click', function() {
    socket.emit('cancel-action');
  });
}

socket.on('action-confirmed', ({ action }) => {
  renderActionConfirmed(action);
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

socket.on('assist-removed', ({ name }) => {
  // Remove the assist option for this player if still choosing
  const wrappers = contentEl.querySelectorAll('.assist-wrapper');
  wrappers.forEach(w => {
    const label = w.querySelector('.assist-label');
    if (label && label.textContent === `Assist ${name}`) w.remove();
  });
  // Also remove standalone assist buttons (no wrapper)
  const btns = contentEl.querySelectorAll('.assist-btn');
  btns.forEach(btn => {
    if (btn.textContent === `Assist ${name}`) btn.remove();
  });
});

// --- Day result (private food) ---

function renderDayResult({ pendingFood, pendingDescription, injury, injuryDescription }) {
  let html = '';
  if (pendingFood > 0) {
    html += '<div class="food-result">';
    html += `<p>${pendingDescription}</p>`;
    html += `<p class="amount">+${pendingFood} food</p>`;
    html += '</div>';
  }
  if (injury > 0) {
    html += '<div class="injury-result">';
    html += `<p>${injuryDescription}</p>`;
    html += `<p class="injury-amount">\u2212${injury} HP</p>`;
    html += '</div>';
  }
  html += '<p class="status-msg">Waiting for campfire...</p>';
  contentEl.innerHTML = html;
}

socket.on('day-result', ({ hp, food, pendingFood, pendingDescription, injury, injuryDescription }) => {
  if (isDead) return;
  myHp = hp;
  myFood = food;
  renderHeader();
  renderDayResult({ pendingFood, pendingDescription, injury, injuryDescription });
});

// --- Campfire ---

let campfirePlayerCount = 0;

function renderPostShare(groupFood) {
  renderHeader();
  let html = '';
  if (groupFood > campfirePlayerCount) {
    html += `<button id="btn-take" class="btn-take">Take an extra portion</button>`;
  } else {
    html += '<p class="status-msg">Waiting for next day...</p>';
  }
  contentEl.innerHTML = html;

  const btnTake = document.getElementById('btn-take');
  if (btnTake) {
    btnTake.addEventListener('click', () => {
      socket.emit('take-portion');
    });
  }
}

let campfireShareVal = 0;

function renderCampfireShareUI() {
  const food = myFood;
  campfireShareVal = Math.min(campfireShareVal, food);

  let html = '';
  if (food > 0) {
    html += `
      <p>You have ${food} portions of food to share.</p>
      <div class="campfire-share">
        <label>Share:</label>
        <button type="button" class="share-adjust" id="share-minus">−</button>
        <span id="share-display">${campfireShareVal} / ${food}</span>
        <button type="button" class="share-adjust" id="share-plus">+</button>
        <button id="btn-share">Share</button>
      </div>
    `;
  } else {
    html += '<p>You have no food to share.</p>';
    html += '<div class="campfire-share"><button id="btn-share">Continue</button></div>';
  }
  contentEl.innerHTML = html;

  if (food > 0) {
    const display = document.getElementById('share-display');
    const update = () => { display.textContent = `${campfireShareVal} / ${food}`; };
    document.getElementById('share-minus').addEventListener('click', () => {
      if (campfireShareVal > 0) { campfireShareVal--; update(); }
    });
    document.getElementById('share-plus').addEventListener('click', () => {
      if (campfireShareVal < food) { campfireShareVal++; update(); }
    });
    document.getElementById('btn-share').addEventListener('click', () => {
      socket.emit('submit-campfire', { amount: campfireShareVal });
    });
  } else {
    document.getElementById('btn-share').addEventListener('click', () => {
      socket.emit('submit-campfire', { amount: 0 });
    });
  }
}

socket.on('campfire-turn', ({ hp, food }) => {
  if (isDead) return;
  myHp = hp;
  myFood = food;
  campfireShareVal = 0;
  renderHeader();
  renderCampfireShareUI();
});

socket.on('campfire-confirmed', ({ food, groupFood, playerCount }) => {
  if (isDead) return;
  myFood = food;
  campfirePlayerCount = playerCount;
  renderPostShare(groupFood);
});

socket.on('campfire-take-ok', ({ food, groupFood, playerCount }) => {
  if (isDead) return;
  myFood = food;
  campfirePlayerCount = playerCount;
  renderPostShare(groupFood);
});

socket.on('campfire-pool', ({ groupFood, playerCount }) => {
  if (isDead) return;
  if (playerCount != null) campfirePlayerCount = playerCount;
  const btnTake = document.getElementById('btn-take');
  const hasSurplus = groupFood > campfirePlayerCount;
  // Re-render if surplus state changed (gained or lost)
  if (btnTake && !hasSurplus) {
    renderPostShare(groupFood);
  } else if (!btnTake && hasSurplus && contentEl.querySelector('.status-msg')) {
    renderPostShare(groupFood);
  }
});

// --- Stats update (from eating) ---

socket.on('stats-update', ({ hp, food }) => {
  if (isDead) return;
  myHp = hp;
  myFood = food;
  renderHeader();
  if (document.getElementById('share-display')) {
    renderCampfireShareUI();
  }
});

// --- Rejoin (reconnection) ---

socket.on('rejoin-state', (state) => {
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  myName = state.name;
  myHp = state.hp;
  myFood = state.food;

  if (state.dead) {
    renderRIP(state.name, state.deathDay);
    return;
  }

  renderHeader();

  if (state.loading) {
    contentEl.innerHTML = '<p class="status-msg">Loading...</p>';
    return;
  }

  switch (state.phase) {
    case 'lobby':
      contentEl.innerHTML = '<p class="status-msg">Waiting for game to start...</p>';
      break;

    case 'action':
      if (state.chosenAction) {
        renderActionConfirmed(state.chosenAction, state.day, state.isPublic);
      } else {
        renderYourTurn(state.day, state.suggestions || []);
        (state.assistOptions || []).forEach(({ name, action }) => {
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
      }
      break;

    case 'narration':
      renderDayResult({
        pendingFood: state.pendingFood,
        pendingDescription: state.pendingDescription,
        injury: state.pendingInjury,
        injuryDescription: state.pendingInjuryDescription,
      });
      break;

    case 'campfire':
      campfirePlayerCount = state.playerCount;
      if (!state.campfireReady) {
        campfireShareVal = 0;
        renderCampfireShareUI();
      } else {
        renderPostShare(state.groupFood);
      }
      break;

    case 'ended':
      headerEl.innerHTML = '';
      contentEl.innerHTML = `
        <div class="game-end-screen">
          <p class="day-label">The End</p>
          <button id="btn-play-again">Play Again</button>
        </div>
      `;
      document.getElementById('btn-play-again').addEventListener('click', () => {
        window.location.href = '/play';
      });
      break;

    case 'game-over':
      headerEl.innerHTML = '';
      contentEl.innerHTML = `
        <div class="rip-screen">
          <h1>GAME OVER</h1>
          <button id="btn-play-again">Play Again</button>
        </div>
      `;
      document.getElementById('btn-play-again').addEventListener('click', () => {
        window.location.href = '/play';
      });
      break;
  }
});

// --- Death ---

function renderRIP(name, deathDay) {
  isDead = true;
  headerEl.innerHTML = '';
  contentEl.innerHTML = `
    <div class="rip-screen">
      <div class="rip-cross">RIP</div>
      <div class="rip-name">${name}</div>
      <div class="rip-dates">Day 1 &#8211; Day ${deathDay}</div>
    </div>
  `;
}

socket.on('you-died', ({ name, deathDay }) => {
  renderRIP(name, deathDay);
});

// --- Game Over (all dead) ---

socket.on('game-over', () => {
  if (!isDead) {
    // Edge case: simultaneous death + game-over
    headerEl.innerHTML = '';
  }
  contentEl.innerHTML = `
    <div class="rip-screen">
      <h1>GAME OVER</h1>
      <button id="btn-play-again">Play Again</button>
    </div>
  `;
  document.getElementById('btn-play-again').addEventListener('click', () => {
    window.location.href = '/play';
  });
});

// --- Game End (Day 10 conclusion) ---

socket.on('game-end', () => {
  if (isDead) return; // Dead players already see RIP
  headerEl.innerHTML = '';
  contentEl.innerHTML = `
    <div class="game-end-screen">
      <p class="day-label">The End</p>
      <button id="btn-play-again">Play Again</button>
    </div>
  `;
  document.getElementById('btn-play-again').addEventListener('click', () => {
    window.location.href = '/play';
  });
});
