import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT =
  "You are a narrator for an island survival game. You receive a player's action, how it was classified, and whether it succeeded or failed. Write ONE sentence in the third person describing what happened. Be vivid but brief.";

export async function narrate(playerName, actionText, classification, outcome) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 128,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Player: ${playerName}\nAction: "${actionText}"\nType: ${classification.type}\nDifficulty: ${classification.difficulty}\nResult: ${outcome.success ? "SUCCESS" : "FAILURE"}`,
      },
    ],
  });

  return response.content[0].text;
}
