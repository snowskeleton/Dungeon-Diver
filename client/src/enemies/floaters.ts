import { makeSheetEnemyDef, frameRow } from "./sheetEnemy";
import { ClientEnemyDef } from "./types";

// Hovering enemies. Mirrors entities/enemies/floaters.ts.

// float-skull.png is 3 cols × 3 rows @16: one row per colour. Cols 0-1 are the
// aura pulse, col 2 is the white flash — reused as the death frame.
const floatSkull = (id: string, name: string, row: number): ClientEnemyDef =>
  makeSheetEnemyDef(id, {
    name,
    textureKey: "float-skull",
    frameWidth: 16,
    cols: 3,
    moveFrames: frameRow(3, row, 0, 2),
    death: { frames: frameRow(3, row, 2, 1), frameRate: 6 },
    frameRate: 6,
    airborne: true,
  });

export const floatEye = makeSheetEnemyDef("float-eye", { name: "Float Eye", frameWidth: 16, cols: 4, frameRate: 6, airborne: true });
export const smushroom = makeSheetEnemyDef("smushroom", { name: "Smushroom", frameWidth: 16, cols: 6 });

export const floatSkullDef = floatSkull("float-skull", "Float Skull", 0);
export const floatSkullTeal = floatSkull("float-skull-teal", "Teal Float Skull", 1);
export const floatSkullPink = floatSkull("float-skull-pink", "Pink Float Skull", 2);
