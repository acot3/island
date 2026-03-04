import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import express from "express";
import { getHTML } from "./ui.mjs";

const client = new Anthropic();
const openai = new OpenAI();
const app = express();
app.use(express.json());

// prettier-ignore
const map = [
  ["🌊","🌊","🌊","🌊","🌊","🌊","🌊","🌊","🌊"],
  ["🌊"," "," ","🌿","🌲","🌲","🌿"," ","🌊"],
  ["🌊"," ","🌿","🌲","🌲","⛰️","🌿"," ","🌊"],
  ["🌊","🌿","🌲","🌲","🌿","🌿","🌿","🌿","🌊"],
  ["🌊","🌿","🌿","🌿","🌲","🌿","🌲","🌿","🌊"],
  ["🌊"," ","🌿","🌿","🌿","🌿","🌲","⛰️","🌊"],
  ["🌊"," ","🌲","🌿","🌿","⛰️","⛰️"," ","🌊"],
  ["🌊"," "," ","🌿","🌿","🌿"," "," ","🌊"],
  ["🌊","🌊","🌊","🌊","🌊","🌊","🌊","🌊","🌊"],
];

const LEGEND = "(blank) = beach, 🌿 = grassland, 🌲 = forest, ⛰️ = mountain, 🌊 = ocean (impassable), 🙂 = player";

const gameState = { hp: 60, inventory: [], day: 1, time: "AM", x: 1, y: 7, terrain: " " };

function renderMap() {
  return map.map((row, y) =>
    row.map((cell, x) => {
      if (x === gameState.x && y === gameState.y) return "🙂";
      if (cell === " ") return "\u3000"; // fullwidth space to match emoji width
      return cell;
    }).join("")
  ).join("\n");
}

// Text version for the AI (easier to reason about coordinates)
function renderMapForAI() {
  const symbols = { "🌊": "~", " ": ".", "🌿": ",", "🌲": "#", "⛰️": "^" };
  return map.map((row, y) =>
    row.map((cell, x) => (x === gameState.x && y === gameState.y ? "@" : (symbols[cell] || "?"))).join(" ")
  ).join("\n");
}

const tools = [
  {
    name: "update_game_state",
    description:
      "Update the player's game state after narrating. Call this EVERY turn to reflect what happened.",
    input_schema: {
      type: "object",
      properties: {
        hp_change: {
          type: "number",
          description:
            "Amount to add or subtract from HP (e.g. -10 for damage, +5 for healing). Use 0 if unchanged.",
        },
        add_items: {
          type: "array",
          items: { type: "string" },
          description: "Items the player gained this turn. Empty array if none.",
        },
        remove_items: {
          type: "array",
          items: { type: "string" },
          description:
            "Items the player lost or consumed this turn. Empty array if none.",
        },
        direction: {
          type: "string",
          enum: ["north", "south", "east", "west", "none"],
          description:
            "Direction to move the player on the map. Use 'none' if the player doesn't move this turn.",
        },
      },
      required: ["hp_change", "add_items", "remove_items", "direction"],
    },
  },
];

function buildSystem() {
  const inv = gameState.inventory.length
    ? gameState.inventory.join(", ")
    : "empty";
  return `You are the narrator and game master for a solo island survival game. A player named Albert has just washed ashore on a mysterious island. Narrate in third-person present tense. Keep responses to two brief sentences. Reflect the day and time state changes given to you in the game state when you narrate.

MAP (${LEGEND}):
${renderMapForAI()}
Player is at row ${gameState.y}, col ${gameState.x}. . = beach, , = grass, # = forest, ^ = mountain, ~ = ocean (impassable).

CURRENT GAME STATE:
Day ${gameState.day}, ${gameState.time}
HP: ${gameState.hp}/100
Inventory: ${inv}

After narrating, ALWAYS call the update_game_state tool. Include a direction to move the player on the map, or "none" if they stay put. The player cannot move into ocean (~).`;
}

const messages = [];

function advanceTime() {
  if (gameState.time === "AM") {
    gameState.time = "PM";
  } else {
    gameState.time = "AM";
    gameState.day++;
  }
}

const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

function applyStateChange({ hp_change, add_items, remove_items, direction }) {
  gameState.hp = Math.max(0, Math.min(100, gameState.hp + hp_change));
  for (const item of add_items) gameState.inventory.push(item);
  for (const item of remove_items) {
    const idx = gameState.inventory.indexOf(item);
    if (idx !== -1) gameState.inventory.splice(idx, 1);
  }
  if (direction && direction !== "none") {
    const [dx, dy] = DIRS[direction] || [0, 0];
    const nx = gameState.x + dx;
    const ny = gameState.y + dy;
    if (map[ny]?.[nx] && map[ny][nx] !== "🌊") {
      gameState.x = nx;
      gameState.y = ny;
      gameState.terrain = map[ny][nx];
    }
  }
}

let firstTurn = true;
async function turn(userMessage) {
  if (!firstTurn) advanceTime();
  firstTurn = false;
  messages.push({ role: "user", content: userMessage });
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: buildSystem(),
    tools,
    messages,
  });

  let narrative = "";
  let toolUseId = null;
  let toolInput = null;

  for (const block of response.content) {
    if (block.type === "text") narrative = block.text;
    if (block.type === "tool_use") {
      toolUseId = block.id;
      toolInput = block.input;
    }
  }

  messages.push({ role: "assistant", content: response.content });

  if (toolInput) {
    applyStateChange(toolInput);
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          content: "State updated.",
        },
      ],
    });
  }

  return narrative;
}

// Cache the opening narrative so it's ready when the page loads
let openingNarrative = null;
const openingReady = turn(
  "Start the game. Describe Albert waking up on the shore."
).then((n) => {
  openingNarrative = n;
});

app.get("/", async (_req, res) => {
  await openingReady;
  res.send(getHTML(openingNarrative, gameState, renderMap()));
});

app.post("/action", async (req, res) => {
  const { action } = req.body;
  const narrative = await turn(action);
  res.json({ narrative, gameState, map: renderMap() });
});

app.post("/tts", async (req, res) => {
  const { text } = req.body;
  const mp3 = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "ash",
    input: text.slice(0, 4096),
    instructions:
      "Voice Affect: Silly.",
  });
  const buffer = Buffer.from(await mp3.arrayBuffer());
  res.set("Content-Type", "audio/mpeg").send(buffer);
});

app.listen(3000, () => {
  console.log("Island game running at http://localhost:3000");
});
