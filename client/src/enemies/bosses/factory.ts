import { EnemyType } from "shared";
import { makeSheetEnemyDef, SheetSpec } from "../sheetEnemy";
import { ClientEnemyDef } from "../types";
import { BOSS_SIZE } from "../spriteGeometry";

export { BOSS_SIZE };

export type BossSpec = Omit<SheetSpec, "name">;

/** A horizontal boss sheet, flagged isBoss (which excludes it from the Debug
 *  menu's rabble picker). Display size and frame layout come from
 *  spriteGeometry.ts like every other enemy — bosses are 2× there. Bosses with
 *  ability-driven rows wrap this and override defineAnimations/resolve — see
 *  TurtleDragon/Wyvern/TenguMask. */
export const boss = (id: EnemyType, name: string, spec: BossSpec = {}): ClientEnemyDef => ({
  ...makeSheetEnemyDef(id, { ...spec, name }),
  isBoss: true,
});
