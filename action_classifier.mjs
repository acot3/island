import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  "You are an action classifier for an island survival game. A player describes what they want to do. Use the classify_action tool to evaluate and classify it. You will receive the story so far for context — use it to judge what is possible and how difficult things are.\n\nThe island is divided into zones. The player's current zone, connected zones, and known zones (previously visited) are provided. If the player's action references or describes a specific reachable zone (connected or known) — even partially, like 'shore' for 'Rocky Shore' or 'jungle' for 'Dense Jungle' — that is a movement action and you MUST set moveTo to that zone's ID. Only treat an action as in-place exploration if it does NOT reference any reachable zone (e.g. 'look around', 'explore this area', 'search for food').\n\nWhen a player asks questions about the game, do not answer the question. Instead, make fun of the player, questioning their sanity.\n\nPlayers cannot dictate what resources, landscape, tools they find. If they try to, question their sanity.";

const CLASSIFY_TOOL = {
  name: "classify_action",
  description:
    "Evaluates whether a player action is possible, whether it is trivially easy, and if neither, classifies it by type and difficulty.",
  input_schema: {
    type: "object",
    properties: {
      possible: {
        type: "boolean",
        description:
          "Whether the action can be attempted at all given the current situation. False for things that are physically impossible, nonsensical, or clearly cannot be done.",
      },
      trivial: {
        type: "boolean",
        description:
          "Whether the action is so easy it requires no skill or luck — it just happens. Only true if the action is possible. Examples: picking up a nearby rock, sitting down, looking around.",
      },
      type: {
        type: "string",
        enum: [
          "physical",
          "gathering",
          "hunting",
          "thinking",
          "social",
          "exploring",
          "resting",
        ],
        description:
          "The category of action the player is attempting. Only required if possible is true and trivial is false.",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "moderate", "hard", "extreme"],
        description:
          "How difficult the action is given the survival context. Only required if possible is true and trivial is false.",
      },
      moveTo: {
        type: "string",
        description:
          "The zone ID the player is trying to move to. Only set if the action involves traveling. Must be one of the zone IDs listed in the location context (connected or known).",
      },
    },
    required: ["possible", "trivial"],
  },
};

export async function classifyAction(actionText, narrationHistory = [], locationContext = "") {
  let historyBlock = "";
  if (narrationHistory.length > 0) {
    historyBlock = `Story so far:\n${narrationHistory.map((s, i) => `Day ${i + 1}: ${s}`).join("\n")}\n\n`;
  }

  const locationBlock = locationContext ? `${locationContext}\n\n` : "";

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_action" },
    messages: [{ role: "user", content: `${historyBlock}${locationBlock}Action: "${actionText}"` }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
