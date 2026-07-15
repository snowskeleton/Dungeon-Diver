import { makeSheetEnemyDef, frameRow } from "./sheetEnemy";

// Small horizontal-facing critters. Mirrors entities/enemies/critters.ts.

export const rat = makeSheetEnemyDef("rat", { name: "Rat", frameWidth: 20, cols: 8, frameRate: 12 });

// spider.png is 6×3 of 32×16 cells: row 0 idle (6), row 1 walk (4), row 2 jump (4).
export const spider = makeSheetEnemyDef("spider", {
  name: "Spider",
  frameWidth: 32, frameHeight: 16, cols: 6,
  moveFrames: frameRow(6, 1, 0, 4),
  displayW: 32, displayH: 16,
  frameRate: 10,
});

// frog-flower.png is 4×3 @32: row 0 idle (4), row 1 jump (4), row 2 fall (1).
export const frogFlower = makeSheetEnemyDef("frog-flower", {
  name: "Frog Flower", frameWidth: 32, cols: 4, moveFrames: frameRow(4, 0, 0, 4), frameRate: 6,
});
export const frogFlowerBlack = makeSheetEnemyDef("frog-flower-black", {
  name: "Black Frog Flower", frameWidth: 32, cols: 4, moveFrames: frameRow(4, 0, 0, 4), frameRate: 6,
});

export const swarm1 = makeSheetEnemyDef("swarm-1", { name: "Small Swarm", frameWidth: 16, cols: 4, frameRate: 12 });
export const swarm2 = makeSheetEnemyDef("swarm-2", { name: "Swarm", frameWidth: 16, cols: 4, frameRate: 12 });
export const swarm3 = makeSheetEnemyDef("swarm-3", { name: "Dense Swarm", frameWidth: 16, cols: 4, frameRate: 12 });
