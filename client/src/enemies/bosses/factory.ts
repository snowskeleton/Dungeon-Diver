import { TILE_SIZE } from "shared";
import { makeSheetEnemyDef, SheetSpec } from "../sheetEnemy";
import { ClientEnemyDef } from "../types";

/** Bosses render at double a normal enemy so they read as a threat. */
export const BOSS_SIZE = TILE_SIZE * 2;

export type BossSpec = Omit<SheetSpec, "name" | "displayW" | "displayH"> & { displaySize?: number };

/** A horizontal boss sheet at 2× enemy size, flagged isBoss (excludes it from the
 *  Debug menu's rabble picker). Bosses with special rows wrap this and override
 *  defineAnimations/resolve — see TurtleDragon/Wyvern/TenguMask. */
export const boss = (id: string, name: string, spec: BossSpec): ClientEnemyDef => {
  const { displaySize = BOSS_SIZE, ...sheet } = spec;
  return { ...makeSheetEnemyDef(id, { ...sheet, name, displayW: displaySize, displayH: displaySize }), isBoss: true };
};
