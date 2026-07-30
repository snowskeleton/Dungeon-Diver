// GENERATED FILE — do not edit by hand.
// Produced by assets/generate-enemy-hurtboxes.ts from the enemy spritesheets.
// Re-run that script after adding an enemy or replacing a sheet.

import { EnemyType } from "./base";

/** An entity's damageable region: a box centred on its sprite, in world px.
 *  Half-extents plus an offset from the sprite centre (state.x/y), because most
 *  creature art doesn't sit centred in its cell. */
export interface HurtBounds {
  halfW: number;
  halfH: number;
  offsetX: number;
  offsetY: number;
}

/** Measured from the union of each enemy's own animation frames — stable, so a
 *  creature can't dodge by animating. */
export const ENEMY_HURT_BOUNDS: Record<EnemyType, HurtBounds> = {
  "goo-green": { halfW: 9, halfH: 9.5, offsetX: 0, offsetY: -1.5 },
  "goo-blue": { halfW: 9, halfH: 9.5, offsetX: 0, offsetY: -1.5 },
  "goo-gold": { halfW: 9, halfH: 9.5, offsetX: 0, offsetY: -1.5 },
  "eye-bat": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "smushroom": { halfW: 16, halfH: 14, offsetX: 0, offsetY: 2 },
  "spider": { halfW: 15, halfH: 7.5, offsetX: 0, offsetY: 0.5 },
  "frog-flower": { halfW: 9.5, halfH: 10.5, offsetX: 1.5, offsetY: -2.5 },
  "tengu-shade": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "bones": { halfW: 14, halfH: 16, offsetX: 0, offsetY: 0 },
  "armor-lancer": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "axe-beast": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "mace-beast": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "sword-beast": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "fang": { halfW: 16, halfH: 16, offsetX: 0, offsetY: 0 },
  "turtle-dragon": { halfW: 32, halfH: 30, offsetX: 0, offsetY: 2 },
  "wyvern": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "wyvern-green": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "wyvern-grey": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "centaur-knight": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "big-beast": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "tengu-mask": { halfW: 32, halfH: 32, offsetX: 0, offsetY: 0 },
  "batwing-buttstomper": { halfW: 40, halfH: 32, offsetX: 0, offsetY: 0 },
};

/** The player's damageable region: the union across all humanoid skins, so a
 *  costume choice can never change how easy someone is to hit. */
export const PLAYER_HURT_BOUNDS: HurtBounds = { halfW: 11, halfH: 10, offsetX: 0, offsetY: 0 };
