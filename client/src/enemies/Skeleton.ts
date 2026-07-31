import { makeHumanoidEnemyDef } from "./humanoidEnemy";

// A humanoid enemy drawn from the 15×4 player sheets, holding a real catalog weapon
// (see heldWeapon). Mirrors the server's Skeleton.
export const skeleton = makeHumanoidEnemyDef("skeleton", "Skeleton", "broadsword");
