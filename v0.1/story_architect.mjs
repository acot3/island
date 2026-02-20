// import { readFileSync } from "fs";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// const lore = readFileSync(new URL("./lore.txt", import.meta.url), "utf-8");

const SYSTEM_PROMPT = `You are the Story Architect for an island survival game. You do NOT write narration — that has already been written. Your job is to observe what just happened in the story and manage the underlying plot structure.

You manage "plot points" — persistent narrative threads that evolve over multiple turns. Each has a stage: seed → rising → climax → resolved.

## Stage Definitions
- **seed**: A subtle detail, a background oddity. The narrator should mention it as atmosphere — easy to miss.
- **rising**: The thread becomes undeniable. The narrator should weave it into the scene even if the player isn't pursuing it.
- **climax**: This thread dominates the scene. The narrator should make it the central event.
- **resolved**: The thread has concluded — satisfyingly or tragically.

## Pacing Rules
- A plot point must stay at **seed** for at least 2 days before it can advance to rising.
- A plot point must stay at **rising** for at least 3 days before it can advance to climax.
- A plot point should only advance a stage when the player's action or location **directly connects** to it. If the player is foraging for food and the plot point is about strange carvings in the ruins, do NOT advance it — just leave it unchanged.
- Most turns, the right move is to do nothing to existing plot points. Advancing a stage is a significant narrative event, not routine.
- The only exception is the staleness rule: if a plot point hasn't had a beat in 5+ days, advance or resolve it regardless — the island forces the issue.

## Other Rules
1. After each narration, you may advance existing plot points, create new ones, resolve old ones, or — most commonly — do nothing.
2. Cap active (non-resolved) plot points at 3. If you need to create a new one and are at the cap, resolve or drop the stalest one first.
3. New plot points should emerge naturally from what just happened — not be invented from nothing.
4. The nextBeatHint you write is crucial: it tells the narrator what to weave in next turn. Make it specific and evocative.
5. Do NOT create a new plot point every turn. Only seed one when the narration genuinely opens a new thread. Many turns should produce no new plot points.
6. Plot points should create tension and mystery. They should feel like the island is alive and reacting.`;

const EVOLVE_PLOT_TOOL = {
  name: "evolve_plot",
  description:
    "Analyzes the latest narration and returns the updated set of plot points.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "Brief internal reasoning about what plot developments this narration enables or advances. 1-2 sentences max.",
      },
      plotPoints: {
        type: "array",
        description:
          "The complete list of all plot points (active and newly resolved). Omit any plot points that were previously resolved more than 2 turns ago.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Unique snake_case identifier. Use the existing id for existing plot points.",
            },
            name: {
              type: "string",
              description: "Short evocative name for this narrative thread.",
            },
            stage: {
              type: "string",
              enum: ["seed", "rising", "climax", "resolved"],
              description: "Current stage of this plot point.",
            },
            seedDay: {
              type: "number",
              description: "The day this plot point was first created.",
            },
            lastBeatDay: {
              type: "number",
              description:
                "The day the most recent beat occurred. Set to current day if advancing.",
            },
            seed: {
              type: "string",
              description:
                "The original seed narration or detail that started this thread.",
            },
            beats: {
              type: "array",
              items: { type: "string" },
              description:
                "Chronological list of beat descriptions, prefixed with 'Day N: '.",
            },
            nextBeatHint: {
              type: "string",
              description:
                "Specific, evocative guidance for the narrator about what should happen next with this thread. Empty string if resolved.",
            },
          },
          required: [
            "id",
            "name",
            "stage",
            "seedDay",
            "lastBeatDay",
            "seed",
            "beats",
            "nextBeatHint",
          ],
        },
      },
    },
    required: ["reasoning", "plotPoints"],
  },
};

export async function evolve(latestNarration, currentPlotPoints, context) {
  const { day, playerName, location, hp, injured, food, water, items, narrationHistory } = context;

  let plotSummary = "None active.";
  if (currentPlotPoints.length > 0) {
    plotSummary = currentPlotPoints
      .map((pp) => {
        const staleDays = day - pp.lastBeatDay;
        const staleWarning =
          staleDays >= 4
            ? ` [STALE — ${staleDays} days since last beat, must advance or resolve]`
            : "";
        return `- "${pp.name}" (${pp.id}) | stage: ${pp.stage} | seeded day ${pp.seedDay} | last beat day ${pp.lastBeatDay}${staleWarning}\n  beats: ${pp.beats.join(" → ")}\n  next hint: ${pp.nextBeatHint}`;
      })
      .join("\n");
  }

  const stateBlock = `Day: ${day} | Player: ${playerName} | Location: ${location} | HP: ${hp}${injured ? " (injured)" : ""} | Food: ${food} | Water: ${water}${items.length > 0 ? ` | Items: ${items.join(", ")}` : ""}`;

  const recentHistory = narrationHistory
    .slice(-5)
    .map((s, i) => {
      const dayNum = narrationHistory.length - 5 + i + 1;
      return `Day ${dayNum > 0 ? dayNum : i + 1}: ${s}`;
    })
    .join("\n");

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [EVOLVE_PLOT_TOOL],
    tool_choice: { type: "tool", name: "evolve_plot" },
    messages: [
      {
        role: "user",
        content: `${stateBlock}\n\nRecent story:\n${recentHistory}\n\nLatest narration (just written):\n"${latestNarration}"\n\nCurrent plot points:\n${plotSummary}\n\nAnalyze the latest narration. Return the updated plot points.`,
      },
    ],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  return toolBlock.input;
}
