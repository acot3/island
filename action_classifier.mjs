import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  "You are an action classifier for an island survival game. A player describes what they want to do. Use the classify_action tool to evaluate and classify it. You will receive the story so far for context — use it to judge what is possible and how difficult things are.";

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
    },
    required: ["possible", "trivial"],
  },
};

export async function classifyAction(actionText, narrationHistory = []) {
  let historyBlock = "";
  if (narrationHistory.length > 0) {
    historyBlock = `Story so far:\n${narrationHistory.map((s, i) => `Day ${i + 1}: ${s}`).join("\n")}\n\n`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_action" },
    messages: [{ role: "user", content: `${historyBlock}Action: "${actionText}"` }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
