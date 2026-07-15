import { makeDirectionalEnemyDef } from "./directionalEnemy";
import { ClientEnemyDef } from "./types";

// Directional enemies: 4×4 @16 sheets, one row per facing (up/right/down/left),
// never mirrored. Mirrors entities/enemies/directional.ts.
const smallDirectional = (id: string, name: string): ClientEnemyDef =>
  makeDirectionalEnemyDef(id, { name, frameSize: 16, cols: 4, frameRate: 8 });

export const bones = smallDirectional("bones", "Bones");
export const bonesBlader = smallDirectional("bones-blader", "Bones Blader");
export const kultist = smallDirectional("kultist", "Kultist");
export const armorLancer = smallDirectional("armor-lancer", "Armor Lancer");
export const beast = smallDirectional("beast", "Beast");
export const axeBeast = smallDirectional("axe-beast", "Axe Beast");
export const maceBeast = smallDirectional("mace-beast", "Mace Beast");
export const swordBeast = smallDirectional("sword-beast", "Sword Beast");
export const fang = smallDirectional("fang", "Fang");
export const hoodFang = smallDirectional("hood-fang", "Hood Fang");
