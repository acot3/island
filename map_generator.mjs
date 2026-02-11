const COASTAL_ZONES = [
  { id: "tidepools", name: "Tidepools", description: "Shallow pools carved into dark rock, teeming with small sea creatures.", resourceBias: "food", danger: "low" },
  { id: "rocky_shore", name: "Rocky Shore", description: "Jagged rocks jutting from the surf, battered by waves.", resourceBias: null, danger: "moderate" },
  { id: "cove", name: "Sheltered Cove", description: "A quiet inlet where the water is calm and clear.", resourceBias: "water", danger: "low" },
];

const JUNGLE_ZONES = [
  { id: "dense_jungle", name: "Dense Jungle", description: "Thick canopy blocks most sunlight. Vines and roots tangle underfoot.", resourceBias: "food", danger: "moderate" },
  { id: "jungle_clearing", name: "Jungle Clearing", description: "A rare gap in the canopy where sunlight floods a grassy patch.", resourceBias: "food", danger: "low" },
  { id: "river", name: "River Basin", description: "A freshwater river cuts through the landscape, its banks muddy and lush.", resourceBias: "water", danger: "low" },
  { id: "waterfall", name: "Waterfall", description: "Water crashes down mossy rocks into a deep pool below.", resourceBias: "water", danger: "moderate" },
];

const INTERIOR_ZONES = [
  { id: "cliffs", name: "Cliffs", description: "Sheer rock faces overlook the island. The view stretches to the horizon.", resourceBias: null, danger: "high" },
  { id: "plateau", name: "Plateau", description: "A flat expanse of windswept grass high above the jungle.", resourceBias: null, danger: "moderate" },
  { id: "cave", name: "Cave System", description: "Dark tunnels wind into the rock. The air is cool and damp.", resourceBias: null, danger: "high" },
  { id: "ruins", name: "Ancient Ruins", description: "Crumbling stone structures covered in moss. Something was built here long ago.", resourceBias: null, danger: "moderate" },
  { id: "volcanic_ridge", name: "Volcanic Ridge", description: "Black rock and sulfur vents. The ground is warm to the touch.", resourceBias: null, danger: "high" },
];

const BEACH = { id: "beach", name: "Beach", description: "White sand stretches along the shore. Wreckage from the ship litters the waterline.", resourceBias: null, danger: "low" };
const HEART = { id: "heart", name: "The Heart", description: "A clearing that never overgrows. An ancient fire pit sits at its center, cold and waiting.", resourceBias: null, danger: "high" };

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

function connect(zones, a, b) {
  if (!zones[a].connections.includes(b)) {
    zones[a].connections.push(b);
  }
  if (!zones[b].connections.includes(a)) {
    zones[b].connections.push(a);
  }
}

export function generateMap() {
  const coastal = pick(COASTAL_ZONES, 2);
  const jungle = pick(JUNGLE_ZONES, 2);
  const interior = pick(INTERIOR_ZONES, 2);

  const allZones = [BEACH, ...coastal, ...jungle, ...interior, HEART];

  const zones = {};
  for (const z of allZones) {
    zones[z.id] = { ...z, connections: [] };
  }

  // Beach → both coastal zones
  for (const c of coastal) {
    connect(zones, "beach", c.id);
  }

  // Coastal → jungle (each to one, plus one cross-link)
  connect(zones, coastal[0].id, jungle[0].id);
  connect(zones, coastal[1].id, jungle[1].id);
  connect(zones, coastal[0].id, jungle[1].id);

  // Jungle → interior
  connect(zones, jungle[0].id, interior[0].id);
  connect(zones, jungle[1].id, interior[1].id);

  // Interior zones connect to each other and to the heart
  connect(zones, interior[0].id, interior[1].id);
  connect(zones, interior[0].id, "heart");
  connect(zones, interior[1].id, "heart");

  return { zones };
}

export function getLocationContext(map, zoneId) {
  const zone = map.zones[zoneId];
  const connections = zone.connections.map((id) => {
    const z = map.zones[id];
    return `${z.name} (id: ${z.id}) — ${z.description}`;
  });
  return `Current location: ${zone.name} — ${zone.description}\nConnected zones:\n${connections.join("\n")}`;
}
