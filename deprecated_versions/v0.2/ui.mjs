export function getHTML(initialNarrative, initialState, initialMap) {
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
      align-items: center;
    }
    #status {
      width: 100%;
      padding: 12px 16px;
      border-bottom: 1px solid #333;
      font-size: 14px;
      color: #aaa;
      text-align: center;
    }
    #main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #map {
      white-space: pre;
      line-height: 1.4;
      font-size: 48px;
    }
    #narrative {
      padding: 16px;
      line-height: 1.6;
      max-width: 90vw;
      text-align: center;
      color: #aaa;
    }
    #narrative.hidden { display: none; }
    #controls {
      width: 100%;
      padding: 12px 16px;
      border-top: 1px solid #333;
      display: flex;
      justify-content: center;
      gap: 8px;
    }
    #controls input {
      width: 400px;
      max-width: 60vw;
      background: #111;
      color: #fff;
      border: 1px solid #333;
      padding: 8px 12px;
      font-family: monospace;
      font-size: 16px;
      outline: none;
    }
    #controls input:focus { border-color: #666; }
    #controls button {
      background: #222;
      color: #fff;
      border: 1px solid #333;
      padding: 8px 16px;
      font-family: monospace;
      font-size: 16px;
      cursor: pointer;
    }
    #controls button:hover { background: #333; }
    #controls button:disabled { color: #555; cursor: default; }
    #toggle {
      color: #555;
      cursor: pointer;
      font-size: 12px;
      padding: 4px 8px;
    }
    #toggle:hover { color: #888; }
  </style>
</head>
<body>
  <div id="status"></div>
  <div id="main">
    <div id="map"></div>
    <div id="narrative" class="hidden"></div>
    <div id="toggle">show narration</div>
  </div>
  <div id="controls">
    <input id="action" type="text" placeholder="What do you do?" autofocus />
    <button id="submit">Go</button>
  </div>
  <script>
    const statusEl = document.getElementById("status");
    const mapEl = document.getElementById("map");
    const narrativeEl = document.getElementById("narrative");
    const toggleEl = document.getElementById("toggle");
    const actionEl = document.getElementById("action");
    const submitEl = document.getElementById("submit");

    let state = ${JSON.stringify(initialState)};
    let showNarration = false;
    let started = false;

    toggleEl.textContent = "Begin";
    toggleEl.addEventListener("click", () => {
      if (!started) {
        started = true;
        playNarration(${JSON.stringify(initialNarrative)});
        toggleEl.textContent = "show narration";
        return;
      }
      showNarration = !showNarration;
      narrativeEl.classList.toggle("hidden", !showNarration);
      toggleEl.textContent = showNarration ? "hide narration" : "show narration";
    });

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

    let currentMap = ${JSON.stringify(initialMap)};

    const segmenter = new Intl.Segmenter();
    function cellBg(c) {
      if (c.includes("\\uD83C\\uDF0A")) return "#1a6ea0"; // ocean
      if (c.trim() === "" || c === "\\u3000") return "#d2b48c"; // beach
      if (c.includes("\\uD83D\\uDE42")) { // player 🙂 — match underlying terrain
        const t = state.terrain;
        if (t === " ") return "#d2b48c";
        return "#90c47d";
      }
      return "#90c47d"; // grass, forest, mountain
    }
    function renderMapHTML(mapStr) {
      return mapStr.split("\\n").map(row => {
        const cells = [...segmenter.segment(row)].map(s => s.segment);
        return cells.map(c => {
          return '<span style="background:' + cellBg(c) + '">' + c + '</span>';
        }).join("");
      }).join("<br>");
    }

    function updateUI(narrative) {
      const inv = state.inventory.length ? state.inventory.join(", ") : "empty";
      statusEl.textContent = "Day " + state.day + " " + state.time + " | HP: " + state.hp + "/100 | Inventory: " + inv;
      mapEl.innerHTML = renderMapHTML(currentMap);
      narrativeEl.textContent = narrative;
    }

    updateUI(${JSON.stringify(initialNarrative)});

    async function submit() {
      const action = actionEl.value.trim();
      if (!action) return;
      stopAudio();
      actionEl.value = "";
      actionEl.disabled = true;
      submitEl.disabled = true;

      const res = await fetch("/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      state = data.gameState;
      currentMap = data.map;
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
