import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { getHTML } from "./ui.mjs";

const client = new Anthropic();
const app = express();
app.use(express.json());

const gameState = { hp: 60, inventory: [], day: 1, time: "AM" };

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
      },
      required: ["hp_change", "add_items", "remove_items"],
    },
  },
];

function buildSystem() {
  const inv = gameState.inventory.length
    ? gameState.inventory.join(", ")
    : "empty";
  return `You are the narrator and game master for a solo island survival game. A player named Albert has just washed ashore on a mysterious island. Narrate in third-person present tense. Keep responses to 1 brief paragraph.

CURRENT GAME STATE:
Day ${gameState.day}, ${gameState.time}
HP: ${gameState.hp}/100
Inventory: ${inv}

After narrating, ALWAYS call the update_game_state tool to reflect any changes to HP or inventory. Even if nothing changed, call it with hp_change: 0 and empty arrays.`;
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

function applyStateChange({ hp_change, add_items, remove_items }) {
  gameState.hp = Math.max(0, Math.min(100, gameState.hp + hp_change));
  for (const item of add_items) gameState.inventory.push(item);
  for (const item of remove_items) {
    const idx = gameState.inventory.indexOf(item);
    if (idx !== -1) gameState.inventory.splice(idx, 1);
  }
  advanceTime();
}

async function turn(userMessage) {
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
  res.send(getHTML(openingNarrative, gameState));
});

app.post("/action", async (req, res) => {
  const { action } = req.body;
  const narrative = await turn(action);
  res.json({ narrative, gameState });
});

app.listen(3000, () => {
  console.log("Island game running at http://localhost:3000");
});
