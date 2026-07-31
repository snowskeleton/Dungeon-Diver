import { makeSheetEnemyDef } from "./sheetEnemy";

// The Eye Bat — a fast, fragile flyer on a 6-frame 16px strip. Mirrors the server's
// EyeBat. Bats collapse mid-flap rather than rewinding the whole cycle.
const BAT_DEATH = { frames: [5, 4, 3], frameRate: 8 };

export const eyeBat = makeSheetEnemyDef("eye-bat", { name: "Eye Bat", frameRate: 10, death: BAT_DEATH, airborne: true });
