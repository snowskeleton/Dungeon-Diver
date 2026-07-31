import { makeSheetEnemyDef } from "./sheetEnemy";

// Mirrors the server's FrogFlower. airborne: the leap arc is driven by its synced
// airHeight (0 at rest, so no lift/shadow while grounded; it rises and slams during
// a leap or a locomotion hop).
export const frogFlower = makeSheetEnemyDef("frog-flower", { name: "Frog Flower", frameRate: 6, airborne: true });
