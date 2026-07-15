import Phaser from "phaser";
import { Facing } from "shared";

/** Which clip to play right now, and whether to mirror it. */
export interface EnemyClip {
  key: string;
  flipX: boolean;
  /** If set, hold this exact static frame instead of playing `key` as a clip —
   *  used to drive an animation off a synced value (the wyvern's dive frame from
   *  its airHeight) rather than a fixed frame-rate loop. */
  frame?: number;
}

/** Everything the client knows about an enemy's current state, handed to resolve()
 *  so a def can pick its clip/frame. Most enemies use only isDying + facing. */
export interface EnemyRenderState {
  isDying: boolean;
  facing: Facing;
  /** Bosses: an ability is in its readable wind-up. */
  telegraph: boolean;
  /** Bosses: an ability is mid-active-phase (channelling). */
  channeling: boolean;
  /** Bosses: which ability is telegraphing/channelling ("" if none). */
  abilityId: string;
  /** Flying bosses: airborne height in px (0 = grounded). */
  airHeight: number;
}

export interface ClientEnemyDef {
  /** Display name, e.g. for the placeholder-art report. */
  name: string;
  /** True for bosses — excludes them from the Debug menu's rabble picker (bosses
   *  only ever spawn in the boss room). */
  isBoss?: boolean;
  /** True for flying enemies — EnemyEntity lifts the sprite by airHeight and draws
   *  a shadow beneath it. */
  airborne?: boolean;
  /** Spritesheet texture key. Several enemies can share one sheet — the
   *  float-skull colours are three rows of the same PNG — so this is not
   *  always the enemy id. GameScene dedupes preloads by this. */
  textureKey: string;
  /** On-screen size in px (art is scaled to this). */
  displayW: number;
  displayH: number;
  preload: (scene: Phaser.Scene) => void;
  defineAnimations: (scene: Phaser.Scene) => void;
  /** Which clip (or static frame) to play for the given state. Most enemies pick
   *  purely from isDying/facing; bosses read abilityId/telegraph/channeling to swap
   *  to a special clip, and flying bosses read airHeight for the dive frame. */
  resolve: (state: EnemyRenderState) => EnemyClip;
}
