import { makeDirectionalEnemyDef } from "./directionalEnemy";
import { EnemyType } from "shared";
import { ClientEnemyDef } from "./types";

// Directional enemies: 4×4 @16 sheets, one row per facing (up/right/down/left),
// never mirrored. Mirrors entities/enemies/directional.ts.
const smallDirectional = (id: EnemyType, name: string): ClientEnemyDef =>
  makeDirectionalEnemyDef(id, { name, frameRate: 8 });

export const bones = smallDirectional("bones", "Bones");
export const armorLancer = smallDirectional("armor-lancer", "Armor Lancer");
export const axeBeast = smallDirectional("axe-beast", "Axe Beast");
export const maceBeast = smallDirectional("mace-beast", "Mace Beast");
export const swordBeast = smallDirectional("sword-beast", "Sword Beast");
export const fang = smallDirectional("fang", "Fang");
