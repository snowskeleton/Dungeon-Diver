import { makeSheetEnemyDef } from "./sheetEnemy";

// Bats collapse mid-flap rather than rewinding the whole cycle.
const BAT_DEATH = { frames: [5, 4, 3], frameRate: 8 };

// Fast, fragile flyers — 6-frame 16px strips. Mirrors entities/enemies/bats.ts.
export const bat = makeSheetEnemyDef("bat", { name: "Bat", frameRate: 10, death: BAT_DEATH, airborne: true });
export const brownBat = makeSheetEnemyDef("brown-bat", { name: "Brown Bat", frameRate: 10, death: BAT_DEATH, airborne: true });
export const eyeBat = makeSheetEnemyDef("eye-bat", { name: "Eye Bat", frameRate: 10, death: BAT_DEATH, airborne: true });
export const goldEye = makeSheetEnemyDef("gold-eye", { name: "Gold Eye", frameRate: 10, death: BAT_DEATH, airborne: true });
