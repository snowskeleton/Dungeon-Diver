import { makeHumanoidEnemyDef } from "./humanoidEnemy";

// Humanoid enemies drawn from the 15×4 player sheets. Mirrors the server's
// entities/enemies/skeletons.ts. Each holds a real catalog weapon (see heldWeapon).
export const skeleton = makeHumanoidEnemyDef("skeleton", "Skeleton", "broadsword");
export const skeletonMage = makeHumanoidEnemyDef("skeleton-mage", "Skeleton Mage", "oak-staff");
