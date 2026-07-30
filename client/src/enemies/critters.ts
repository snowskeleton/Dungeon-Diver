import { makeSheetEnemyDef } from "./sheetEnemy";

// Small horizontal-facing critters. Mirrors entities/enemies/critters.ts.
//
// Frame layout — cell size, which rows are the locomotion clip, display size —
// lives in spriteGeometry.ts, because the hurtbox generator has to read the same
// numbers. These specs carry only behaviour.

export const spider = makeSheetEnemyDef("spider", { name: "Spider", frameRate: 10 });

// airborne: the frog's leap arc is driven by its synced airHeight (0 at rest, so no
// lift/shadow while grounded; it rises and slams during a leap).
export const frogFlower = makeSheetEnemyDef("frog-flower", { name: "Frog Flower", frameRate: 6, airborne: true });
