import { makeSheetEnemyDef } from "./sheetEnemy";

// The goos — slow, tanky blobs, one horizontal 6-frame strip each. Mirrors the
// server's entities/enemies/goos.ts.
export const gooGreen = makeSheetEnemyDef("goo-green", { name: "Green Goo", frameWidth: 32, cols: 6 });
export const gooBlue = makeSheetEnemyDef("goo-blue", { name: "Blue Goo", frameWidth: 32, cols: 6 });
export const gooGold = makeSheetEnemyDef("goo-gold", { name: "Gold Goo", frameWidth: 32, cols: 6 });
