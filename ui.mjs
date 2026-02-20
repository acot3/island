export function getHTML(initialNarrative, initialState) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Island</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #000;
      color: #fff;
      font-family: monospace;
      font-size: 16px;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #status {
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      font-size: 14px;
      color: #aaa;
    }
    #narrative {
      flex: 1;
      padding: 24px 16px;
      line-height: 1.6;
      overflow-y: auto;
    }
    #input-bar {
      padding: 12px 16px;
      border-top: 1px solid #333;
      display: flex;
      gap: 8px;
    }
    #input-bar input {
      flex: 1;
      background: #111;
      color: #fff;
      border: 1px solid #333;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 16px;
      outline: none;
    }
    #input-bar input:focus { border-color: #666; }
    #input-bar button {
      background: #222;
      color: #fff;
      border: 1px solid #333;
      padding: 8px 16px;
      font-family: monospace;
      font-size: 16px;
      cursor: pointer;
    }
    #input-bar button:hover { background: #333; }
    #input-bar button:disabled { color: #555; cursor: default; }
  </style>
</head>
<body>
  <div id="status"></div>
  <div id="narrative"></div>
  <div id="input-bar">
    <input id="action" type="text" placeholder="What do you do?" autofocus />
    <button id="submit">Go</button>
  </div>
  <script>
    const statusEl = document.getElementById("status");
    const narrativeEl = document.getElementById("narrative");
    const actionEl = document.getElementById("action");
    const submitEl = document.getElementById("submit");

    let state = ${JSON.stringify(initialState)};

    let currentAudio = null;

    function stopAudio() {
      if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    }

    async function playNarration(text) {
      stopAudio();
      const res = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      currentAudio = new Audio(url);
      await currentAudio.play().catch(() => {});
    }

    function updateUI(narrative) {
      const inv = state.inventory.length ? state.inventory.join(", ") : "empty";
      statusEl.textContent = "Day " + state.day + " " + state.time + " | HP: " + state.hp + "/100 | Inventory: " + inv;
      narrativeEl.textContent = narrative;
    }

    updateUI(${JSON.stringify(initialNarrative)});
    playNarration(${JSON.stringify(initialNarrative)});

    async function submit() {
      const action = actionEl.value.trim();
      if (!action) return;
      stopAudio();
      actionEl.value = "";
      actionEl.disabled = true;
      submitEl.disabled = true;
      narrativeEl.textContent = "...";

      const res = await fetch("/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      state = data.gameState;
      updateUI(data.narrative);
      playNarration(data.narrative);

      if (state.hp <= 0) {
        actionEl.placeholder = "Game over.";
      } else {
        actionEl.disabled = false;
        submitEl.disabled = false;
        actionEl.focus();
      }
    }

    submitEl.addEventListener("click", submit);
    actionEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  </script>
</body>
</html>`;
}
