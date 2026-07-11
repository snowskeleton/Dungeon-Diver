#!/usr/bin/env node
// The Snakes art ships as three separate per-direction strips (up / down / side)
// instead of one sheet. Compose each snake into the standard directional layout
// this project expects: 4 rows of 4 frames — up, right, down, left — where the
// "left" row is the side strip mirrored per-frame.
//
// Run via: node assets/generate-snake-sheets.js
// Requires `sharp`, which is NOT a project dependency:
//   npm install --no-save sharp
//
// Only needs re-running if the source art changes; the composed PNGs are
// committed to assets/.

const sharp = require("sharp");
const path = require("path");

const SRC = "/Users/snow/Downloads/Super Overhead Adventure 2/Characters/Small/Snakes";
const OUT = __dirname;
const CELL = 16;
const COLS = 4;

// [outputName, sourceFolder, filePrefix]
const SNAKES = [
  ["fang", "Fang", "fang"],
  ["hood-fang", "HoodFang", "hoodfang"],
];

async function mirrorRow(file) {
  // Flip each frame in place — flipping the whole strip would also reverse
  // frame order, desyncing the walk cycle.
  const frames = [];
  for (let c = 0; c < COLS; c++) {
    frames.push({
      input: await sharp(file)
        .extract({ left: c * CELL, top: 0, width: CELL, height: CELL })
        .flop()
        .png()
        .toBuffer(),
      left: c * CELL,
      top: 0,
    });
  }
  return sharp({
    create: { width: COLS * CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames)
    .png()
    .toBuffer();
}

(async () => {
  for (const [name, folder, prefix] of SNAKES) {
    const up = `${SRC}/${folder}/${prefix} up.png`;
    const down = `${SRC}/${folder}/${prefix} down.png`;
    const side = `${SRC}/${folder}/${prefix} side.png`;

    // Row order must match ROW in client/src/enemies/directionalEnemy.ts.
    const rows = [
      { input: up, top: 0 * CELL },
      { input: side, top: 1 * CELL },            // right
      { input: down, top: 2 * CELL },
      { input: await mirrorRow(side), top: 3 * CELL }, // left
    ].map((r) => ({ ...r, left: 0 }));

    const out = path.join(OUT, `${name}.png`);
    await sharp({
      create: { width: COLS * CELL, height: 4 * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite(rows)
      .png()
      .toFile(out);
    console.log(`Composed ${name}.png (${COLS * CELL}x${4 * CELL})`);
  }
})();
