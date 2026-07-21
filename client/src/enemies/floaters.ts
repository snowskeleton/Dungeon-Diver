import { makeSheetEnemyDef, frameRow } from "./sheetEnemy";
import { EnemyType } from "shared";
import { ClientEnemyDef } from "./types";
import { ENEMY_SPRITE_GEOMETRY } from "./spriteGeometry";

// Hovering enemies. Mirrors entities/enemies/floaters.ts.

// float-skull.png is one row per colour (see spriteGeometry): cols 0-1 are the
// aura pulse, col 2 the white flash — reused here as the death frame. The row is
// recovered from the geometry's first frame so the layout stays defined once.
const floatSkull = (id: EnemyType, name: string): ClientEnemyDef => {
  const geo = ENEMY_SPRITE_GEOMETRY[id];
  const row = Math.floor(geo.frames[0] / geo.cols);
  return makeSheetEnemyDef(id, {
    name,
    death: { frames: frameRow(geo.cols, row, 2, 1), frameRate: 6 },
    frameRate: 6,
    airborne: true,
  });
};

export const floatEye = makeSheetEnemyDef("float-eye", { name: "Float Eye", frameRate: 6, airborne: true });
export const smushroom = makeSheetEnemyDef("smushroom", { name: "Smushroom" });

export const floatSkullDef = floatSkull("float-skull", "Float Skull");
export const floatSkullTeal = floatSkull("float-skull-teal", "Teal Float Skull");
export const floatSkullPink = floatSkull("float-skull-pink", "Pink Float Skull");
