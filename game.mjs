import "dotenv/config";
import { createInterface } from "readline";
import { classifyAction } from "./action_classifier.mjs";
import { determineSuccess } from "./success_determiner.mjs";

const state = {
  day: 1,
  players: [
    {
      name: "Albert",
      pronouns: "he/him",
      stats: { strength: 1, intelligence: 4, charisma: 1},
      hp: 100,
      injured: false,
    },
  ],
  group: {
    food: 0,
    water: 0,
    items: [],
  },
  storyBeats: [],
};

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function printState() {
  console.log(`\n--- Day ${state.day} ---`);
  for (const p of state.players) {
    console.log(`  ${p.name} | HP: ${p.hp} | STR: ${p.stats.strength} INT: ${p.stats.intelligence} CHA: ${p.stats.charisma}`);
  }
  console.log(`  Food: ${state.group.food} | Water: ${state.group.water}`);
  if (state.group.items.length > 0) {
    console.log(`  Items: ${state.group.items.join(", ")}`);
  }
}

function prompt() {
  rl.question("\nWhat do you do? ", async (input) => {
    if (!input || input === "quit") {
      rl.close();
      return;
    }

    const classification = await classifyAction(input);
    const outcome = determineSuccess(classification.difficulty);

    console.log(`\n  Type: ${classification.type}`);
    console.log(`  Difficulty: ${classification.difficulty}`);
    console.log(`  Roll: ${outcome.roll} vs ${outcome.threshold} needed`);
    console.log(`  Result: ${outcome.success ? "SUCCESS" : "FAILURE"}`);

    printState();
    prompt();
  });
}

console.log("Island survival. Describe your action.\n");
printState();
prompt();
