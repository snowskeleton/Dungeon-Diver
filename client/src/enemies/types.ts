import Phaser from "phaser";
import { Facing } from "shared";

/** Which clip to play right now, and whether to mirror it. */
export interface EnemyClip {
  key: string;
  flipX: boolean;
}

export interface ClientEnemyDef {
  /** Display name, e.g. for the placeholder-art report. */
  name: string;
  /** True for bosses — excludes them from the Debug menu's rabble picker (bosses
   *  only ever spawn in the boss room). */
  isBoss?: boolean;
  /** Spritesheet texture key. Several enemies can share one sheet — the
   *  float-skull colours are three rows of the same PNG — so this is not
   *  always the enemy id. GameScene dedupes preloads by this. */
  textureKey: string;
  /** On-screen size in px (art is scaled to this). */
  displayW: number;
  displayH: number;
  preload: (scene: Phaser.Scene) => void;
  defineAnimations: (scene: Phaser.Scene) => void;
  /** Which clip to play. `action` (bosses only) names an ability the boss is
   *  actively channelling (e.g. "shell-spin") so it can swap to a special clip;
   *  most enemies ignore it and pick purely from isDying/facing. */
  resolve: (isDying: boolean, facing: Facing, action?: string) => EnemyClip;
}
