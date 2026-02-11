import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const POSSIBILITY_PROMPT =
  "You are an action evaluator for an island survival game. A player describes what they want to do. Use the check_possibility tool to determine if the action is possible given the current situation, and if so, whether it is trivially easy (requires no skill or luck). You will receive the story so far for context.";

const CLASSIFY_PROMPT =
  "You are an action classifier for an island survival game. A player describes an action that has already been deemed possible and non-trivial. Use the classify_action tool to categorize it and assess its difficulty.";

const POSSIBILITY_TOOL = {
  name: "check_possibility",
  description:
    "Determines whether a player action is possible and whether it is trivially easy.",
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
    },
    required: ["possible", "trivial"],
  },
};

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
        description:
          "How difficult the action is given the survival context.",
      },
    },
    required: ["type", "difficulty"],
  },
};

export async function checkPossibility(actionText, narrationHistory = []) {
  let historyBlock = "";
  if (narrationHistory.length > 0) {
    historyBlock = `Story so far:\n${narrationHistory.map((s, i) => `Day ${i + 1}: ${s}`).join("\n")}\n\n`;
  }

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: POSSIBILITY_PROMPT,
    tools: [POSSIBILITY_TOOL],
    tool_choice: { type: "tool", name: "check_possibility" },
    messages: [{ role: "user", content: `${historyBlock}Action: "${actionText}"` }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}

export async function classifyAction(actionText) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 256,
    system: CLASSIFY_PROMPT,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "classify_action" },
    messages: [{ role: "user", content: `Action: "${actionText}"` }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
