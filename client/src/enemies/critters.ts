import { makeSheetEnemyDef } from "./sheetEnemy";

// Small horizontal-facing critters. Mirrors entities/enemies/critters.ts.
//
// Frame layout — cell size, which rows are the locomotion clip, display size —
// lives in spriteGeometry.ts, because the hurtbox generator has to read the same
// numbers. These specs carry only behaviour.

export const rat = makeSheetEnemyDef("rat", { name: "Rat", frameRate: 12 });

export const spider = makeSheetEnemyDef("spider", { name: "Spider", frameRate: 10 });

export const frogFlower = makeSheetEnemyDef("frog-flower", { name: "Frog Flower", frameRate: 6 });
export const frogFlowerBlack = makeSheetEnemyDef("frog-flower-black", {
  name: "Black Frog Flower",
  frameRate: 6,
});

export const swarm1 = makeSheetEnemyDef("swarm-1", { name: "Small Swarm", frameRate: 12 });
export const swarm2 = makeSheetEnemyDef("swarm-2", { name: "Swarm", frameRate: 12 });
export const swarm3 = makeSheetEnemyDef("swarm-3", { name: "Dense Swarm", frameRate: 12 });
