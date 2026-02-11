import "dotenv/config";
import { createInterface } from "readline";
import { classifyAction } from "./action_classifier.mjs";
import { determineSuccess } from "./success_determiner.mjs";
import { narrate, narrateIntro } from "./narrator.mjs";

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
  narration: [],
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

    const classification = await classifyAction(input, state.narration);

    let outcome;

    if (!classification.possible) {
      console.log(`\n  Impossible — auto FAILURE`);
      outcome = { success: false };
    } else if (classification.trivial) {
      console.log(`\n  Trivial — auto SUCCESS`);
      outcome = { success: true };
    } else {
      outcome = determineSuccess(classification.difficulty);
      console.log(`\n  Type: ${classification.type}`);
      console.log(`  Difficulty: ${classification.difficulty}`);
      console.log(`  Roll: ${outcome.roll} vs ${outcome.threshold} needed`);
      console.log(`  Result: ${outcome.success ? "SUCCESS" : "FAILURE"}`);
    }

    const narrateClassification = classification.type ? classification : null;
    const result = await narrate(state.players[0].name, input, narrateClassification, outcome, state.narration);
    console.log(`\n  ${result.narration}`);

    state.narration.push(result.narration);

    const player = state.players[0];
    player.hp = Math.max(0, Math.min(100, player.hp + result.hpChange));
    player.injured = result.injured;
    state.group.food = Math.max(0, state.group.food + result.foodChange);
    state.group.water = Math.max(0, state.group.water + result.waterChange);
    for (const item of result.itemsGained) {
      state.group.items.push(item);
    }

    // Day-pass costs
    for (const p of state.players) {
      p.hp = Math.max(0, p.hp - 15);
    }
    state.group.food = Math.max(0, state.group.food - state.players.length);
    state.group.water = Math.max(0, state.group.water - state.players.length);

    state.day++;
    printState();

    const dead = state.players.find((p) => p.hp <= 0);
    if (dead) {
      console.log(`\n  ${dead.name} has perished. Game over.`);
      rl.close();
      return;
    }

    prompt();
  });
}

async function start() {
  console.log("Island survival.\n");
  const intro = await narrateIntro(state.players[0].name);
  console.log(`  ${intro}`);
  state.narration.push(intro);
  printState();
  prompt();
}

start();
