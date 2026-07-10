#!/usr/bin/env node
// Splits weapon-icons.png into individual weapon PNGs and writes per-weapon
// TypeScript definition files into shared/src/weapons/{category}/{id}/.
// Run via: node assets/generate-weapons.js

const sharp = require("../node_modules/sharp");
const fs    = require("fs");
const path  = require("path");

const SHEET     = path.join(__dirname, "weapon-icons.png");
const OUT_ROOT  = path.join(__dirname, "..", "shared", "src", "weapons");
const CELL      = 16;   // source icon size
const SCALE     = 2;    // exported PNG size = 32×32

// ─── All weapons: [id, name, category, catDir, iconRow, iconCol, statOverrides] ──

const WEAPONS = [
  // Swords
  ["short-sword",    "Short Sword",    "sword", "swords",    0, 0, {}],
  ["broadsword",     "Broadsword",     "sword", "swords",    0, 1, {}],
  ["flamberge",      "Flamberge",      "sword", "swords",    0, 2, { damage: 22 }],
  ["ornate-sword",   "Ornate Sword",   "sword", "swords",    0, 3, {}],
  ["crimson-blade",  "Crimson Blade",  "sword", "swords",    0, 4, { damage: 24 }],
  ["frost-blade",    "Frost Blade",    "sword", "swords",    0, 5, { damage: 24 }],
  ["gold-blade",     "Gold Blade",     "sword", "swords",    2, 4, { damage: 26 }],
  ["mystic-blade",   "Mystic Blade",   "sword", "swords",    2, 5, { damage: 28 }],
  ["wood-sword",     "Wooden Sword",   "sword", "swords",    3, 5, { damage: 12, attackCooldownMs: 450 }],
  ["sabre",          "Sabre",          "sword", "swords",    3, 6, { attackCooldownMs: 420 }],
  ["gilded-sword",   "Gilded Sword",   "sword", "swords",    3, 7, { damage: 23 }],
  ["stiletto",       "Stiletto",       "sword", "swords",    4, 0, { attackCooldownMs: 400 }],
  ["serpent-blade",  "Serpent Blade",  "sword", "swords",    4, 1, { damage: 22 }],
  ["teal-blade",     "Teal Blade",     "sword", "swords",    4, 2, {}],
  ["crystal-blade",  "Crystal Blade",  "sword", "swords",    4, 3, { damage: 25 }],
  ["inferno-blade",  "Inferno Blade",  "sword", "swords",    4, 4, { damage: 27 }],
  ["shadow-blade",   "Shadow Blade",   "sword", "swords",    4, 5, { damage: 26, attackCooldownMs: 450 }],
  ["lightning-blade","Lightning Blade","sword", "swords",    4, 6, { damage: 28 }],

  // Axes
  ["battle-axe",  "Battle Axe", "axe", "axes", 0, 6, {}],
  ["hatchet",     "Hatchet",    "axe", "axes", 0, 7, { damage: 18, attackCooldownMs: 500 }],
  ["moon-axe",    "Moon Axe",   "axe", "axes", 1, 0, { damage: 24 }],
  ["double-axe",  "Double Axe", "axe", "axes", 1, 1, { damage: 26, attackCooldownMs: 700 }],
  ["war-axe",     "War Axe",    "axe", "axes", 1, 2, { damage: 25 }],
  ["dark-axe",    "Dark Axe",   "axe", "axes", 1, 3, { damage: 28, attackCooldownMs: 650 }],

  // Spears
  ["javelin", "Javelin", "spear", "spears", 1, 4, { attackCooldownMs: 500 }],
  ["lance",   "Lance",   "spear", "spears", 1, 5, { damage: 22 }],
  ["spear",   "Spear",   "spear", "spears", 1, 6, {}],
  ["trident", "Trident", "spear", "spears", 1, 7, { damage: 20, attackForce: 9 }],

  // Rapiers
  ["blue-rapier",   "Blue Rapier",   "rapier", "rapiers", 2, 0, {}],
  ["silver-rapier", "Silver Rapier", "rapier", "rapiers", 2, 1, { damage: 17 }],
  ["teal-rapier",   "Teal Rapier",   "rapier", "rapiers", 2, 2, { attackCooldownMs: 300 }],

  // Maces
  ["star-mace",    "Star Mace",    "mace", "maces", 2, 6, {}],
  ["morning-star", "Morning Star", "mace", "maces", 2, 7, { damage: 28, attackForce: 14 }],
  ["flail",        "Flail",        "mace", "maces", 3, 0, { damage: 27, attackForce: 13 }],
  ["club",         "Club",         "mace", "maces", 3, 1, { damage: 20, attackCooldownMs: 480 }],
  ["orb-mace",     "Orb Mace",     "mace", "maces", 3, 2, { damage: 30 }],

  // Daggers
  ["kris",          "Kris",          "dagger", "daggers", 3, 3, {}],
  ["curved-dagger", "Curved Dagger", "dagger", "daggers", 3, 4, { damage: 17, attackCooldownMs: 280 }],

  // Hammers
  ["war-hammer", "War Hammer", "hammer", "hammers", 4, 7, {}],

  // Bows
  ["shortbow", "Shortbow", "bow", "bows", 5, 0, {}],
  ["longbow",  "Longbow",  "bow", "bows", 5, 2, { damage: 24, attackCooldownMs: 550 }],

  // Crossbows
  ["crossbow", "Crossbow", "crossbow", "crossbows", 5, 4, {}],

  // Staves
  ["oak-staff",     "Oak Staff",     "staff", "staves", 6, 4, {}],
  ["cane",          "Cane",          "staff", "staves", 6, 5, { damage: 22, attackCooldownMs: 500 }],
  ["arcane-staff",  "Arcane Staff",  "staff", "staves", 6, 6, { damage: 35 }],
  ["ruby-staff",    "Ruby Staff",    "staff", "staves", 6, 7, { damage: 32, attackCooldownMs: 550 }],
  ["emerald-staff", "Emerald Staff", "staff", "staves", 7, 0, { damage: 33 }],
  ["crystal-wand",  "Crystal Wand",  "staff", "staves", 7, 1, { damage: 38, attackCooldownMs: 700 }],
];

// Class name per category
const CLASS_NAME = {
  sword: "Sword", axe: "Axe", spear: "Spear", rapier: "Rapier",
  mace: "Mace", dagger: "Dagger", hammer: "Hammer",
  bow: "Bow", crossbow: "Crossbow", staff: "Staff",
};

function buildOverrideLines(overrides) {
  return Object.entries(overrides)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join("\n");
}

function tsContent(id, name, category, overrides) {
  const cls = CLASS_NAME[category];
  const lines = buildOverrideLines(overrides);
  const overrideBlock = lines ? `\n${lines}\n` : "";
  return `import { ${cls} } from "../base";

export default new ${cls}({
  id: "${id}",
  name: "${name}",${overrideBlock}
});
`;
}

async function run() {
  let created = 0;
  for (const [id, name, category, catDir, row, col, overrides] of WEAPONS) {
    const dir = path.join(OUT_ROOT, catDir, id);
    fs.mkdirSync(dir, { recursive: true });

    // Extract + scale PNG
    const pngPath = path.join(dir, `${id}.png`);
    await sharp(SHEET)
      .extract({ left: col * CELL, top: row * CELL, width: CELL, height: CELL })
      .resize(CELL * SCALE, CELL * SCALE, { kernel: "nearest" })
      .png()
      .toFile(pngPath);

    // Write TypeScript definition
    const tsPath = path.join(dir, "index.ts");
    if (!fs.existsSync(tsPath)) {
      fs.writeFileSync(tsPath, tsContent(id, name, category, overrides));
    }

    console.log(`✓ ${catDir}/${id}`);
    created++;
  }
  console.log(`\nDone — ${created} weapons generated.`);
}

run().catch((err) => { console.error(err); process.exit(1); });
