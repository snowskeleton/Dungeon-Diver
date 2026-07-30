import { makeDirectionalEnemyDef } from "./directionalEnemy";
import { EnemyType, WeaponId } from "shared";
import { ClientEnemyDef } from "./types";

// Directional enemies: 4×4 @16 sheets, one row per facing (up/right/down/left),
// never mirrored. Mirrors entities/enemies/directional.ts.
const smallDirectional = (id: EnemyType, name: string): ClientEnemyDef =>
  makeDirectionalEnemyDef(id, { name, frameRate: 8 });

// An armed directional enemy also holds its weapon in hand and swings it (the beast
// weapons + the lancer's lance) — the held-weapon wind-up is its telegraph. weaponId
// mirrors the server ArmedEnemy's weaponId for this creature.
const armedDirectional = (id: EnemyType, name: string, weaponId: WeaponId): ClientEnemyDef =>
  ({ ...smallDirectional(id, name), heldWeapon: { weaponId } });

export const bones = smallDirectional("bones", "Bones");
export const fang = smallDirectional("fang", "Fang");
export const armorLancer = armedDirectional("armor-lancer", "Armor Lancer", "lance");
export const axeBeast = armedDirectional("axe-beast", "Axe Beast", "beast-axe");
export const maceBeast = armedDirectional("mace-beast", "Mace Beast", "beast-mace");
export const swordBeast = armedDirectional("sword-beast", "Sword Beast", "beast-sword");
