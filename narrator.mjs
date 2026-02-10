import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  "You are a narrator for an island survival game. You receive a player's action, how it was classified, and whether it succeeded or failed. Use the narrate_outcome tool to describe what happened and determine the consequences.";

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
          "One vivid sentence in the third person describing what happened.",
      },
      hpChange: {
        type: "integer",
        minimum: -20,
        maximum: 20,
        description:
          "How the player's health changed. Negative for damage, positive for recovery. 0 if no change.",
      },
      foodChange: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "How much food the group gained. 0 if none.",
      },
      waterChange: {
        type: "integer",
        minimum: 0,
        maximum: 5,
        description: "How much water the group gained. 0 if none.",
      },
      itemsGained: {
        type: "array",
        items: { type: "string" },
        description:
          "Any items found or crafted. Empty array if none. Keep items short and concrete, e.g. 'sharp rock', 'vine rope'.",
      },
      injured: {
        type: "boolean",
        description:
          "Whether the player sustained an injury. Only true on serious failures.",
      },
    },
    required: [
      "narration",
      "hpChange",
      "foodChange",
      "waterChange",
      "itemsGained",
      "injured",
    ],
  },
};

export async function narrateIntro(playerName) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system:
      "You are a narrator for an island survival game. Write a brief 2-3 sentence introduction in the third person. Set the scene: the player has just washed ashore on a deserted island after a shipwreck. Be vivid but concise.",
    messages: [
      {
        role: "user",
        content: `Player: ${playerName}`,
      },
    ],
  });

  return response.content[0].text;
}

export async function narrate(playerName, actionText, classification, outcome, narrationHistory = []) {
  let historyBlock = "";
  if (narrationHistory.length > 0) {
    historyBlock = `\n\nStory so far:\n${narrationHistory.map((s, i) => `Day ${i + 1}: ${s}`).join("\n")}\n`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [NARRATE_TOOL],
    tool_choice: { type: "tool", name: "narrate_outcome" },
    messages: [
      {
        role: "user",
        content: `${historyBlock}Player: ${playerName}\nAction: "${actionText}"\nType: ${classification.type}\nDifficulty: ${classification.difficulty}\nResult: ${outcome.success ? "SUCCESS" : "FAILURE"}`,
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
