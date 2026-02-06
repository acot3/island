import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  "You are an action classifier for an island survival game. A player describes what they want to do. Use the classify_action tool to classify it.";

const CLASSIFY_TOOL = {
  name: "classify_action",
  description: "Classifies a player action into a type and difficulty.",
  input_schema: {
    type: "object",
    properties: {
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
        description: "The category of action the player is attempting.",
      },
      difficulty: {
        type: "string",
        enum: ["easy", "moderate", "hard", "extreme"],
        description: "How difficult the action is given the survival context.",
      },
    },
    required: ["type", "difficulty"],
  },
};

export async function classifyAction(actionText) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_action" },
    messages: [{ role: "user", content: actionText }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
