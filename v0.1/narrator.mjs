import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// const lore = readFileSync(new URL("./lore.txt", import.meta.url), "utf-8");
const rules = readFileSync(new URL("./rules.txt", import.meta.url), "utf-8");

const SYSTEM_PROMPT =
  `You are a narrator for an island survival game. You receive a player's action, how it was classified, and whether it succeeded or failed. Use the narrate_outcome tool to describe what happened and determine the consequences.

You may also receive "active narrative threads" — ongoing plot points at various stages. Weave these into the narration at the indicated urgency level. A [SEED] thread is a background detail — mention it subtly if at all. A [RISING] thread should be woven into the scene. A [CLIMAX] thread should dominate the narration. Never mention the thread system or stages directly — just tell the story.

## Rules
${rules}`;

const NARRATE_TOOL = {
  name: "narrate_outcome",
  description:
    "Narrates what happened and determines the state changes that result.",
  input_schema: {
    type: "object",
    properties: {
      narration: {
        type: "string",
        description:
          "Two to three short sentences (maximum of two clauses) in the third person describing what happened.",
      },
      healed: {
        type: "boolean",
        description: "Whether the player recovered health (e.g. from resting).",
      },
      foundFood: {
        type: "boolean",
        description: "Whether the player found or gained food.",
      },
      foundWater: {
        type: "boolean",
        description: "Whether the player found or gained water.",
      },
      itemsGained: {
        type: "array",
        items: { type: "string" },
        description:
          "Non-consumable items found or crafted — tools, materials, objects. Empty array if none. Keep items short and concrete, e.g. 'sharp rock', 'vine rope'. Do NOT include food or water here; use foundFood and foundWater instead.",
      },
      injured: {
        type: "boolean",
        description:
          "Whether the player sustained an injury. Only true on serious failures.",
      },
    },
    required: [
      "narration",
      "healed",
      "foundFood",
      "foundWater",
      "itemsGained",
      "injured",
    ],
  },
};

export async function narrateIntro(playerName, locationContext = "") {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: `You are a narrator for an island survival game.\n\n## Rules\n${rules}\n\nWrite a brief 2-3 sentence introduction in the third person. Set the scene: the player has just washed ashore on a deserted island after a shipwreck. Be vivid but concise. Write only prose narrative — no markdown formatting, headers, or bullet points. Strictly 2-3 sentences.`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${locationContext ? locationContext + "\n\n" : ""}Player: ${playerName}`,
      },
    ],
  });

  return response.content[0].text;
}

export async function narrate(playerName, actionText, classification, outcome, narrationHistory = [], locationContext = "", { failedMoveTo } = {}, plotPoints = []) {
  let historyBlock = "";
  if (narrationHistory.length > 0) {
    historyBlock = `\n\nStory so far:\n${narrationHistory.map((s, i) => `Day ${i + 1}: ${s}`).join("\n")}\n`;
  }

  const locationBlock = locationContext ? `\n\n${locationContext}` : "";

  let plotBlock = "";
  const active = plotPoints.filter((pp) => pp.stage !== "resolved");
  if (active.length > 0) {
    const lines = active.map((pp) => {
      const urgency = {
        seed: "Weave subtly as background atmosphere — a small detail the player might miss.",
        rising: "This thread is becoming unavoidable. Work it into the scene.",
        climax: "This DOMINATES the scene. It should be the central element of the narration.",
      }[pp.stage];
      return `- [${pp.stage.toUpperCase()}] "${pp.name}": ${pp.nextBeatHint}\n  (${urgency})`;
    });
    plotBlock = `\n\nActive narrative threads (weave these into the narration naturally):\n${lines.join("\n")}`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [NARRATE_TOOL],
    tool_choice: { type: "tool", name: "narrate_outcome" },
    messages: [
      {
        role: "user",
        content: `${historyBlock}${locationBlock}${plotBlock}\nPlayer: ${playerName}\nAction: "${actionText}"${classification ? `\nType: ${classification.type}\nDifficulty: ${classification.difficulty}` : ""}\nResult: ${outcome.success ? "SUCCESS" : "FAILURE"}${failedMoveTo ? `\nMovement failed: the player tried to reach ${failedMoveTo} but could not. They are still at their current location. The narration must reflect this.` : ""}`,
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
