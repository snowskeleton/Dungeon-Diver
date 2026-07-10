import Phaser from "phaser";
import { CharacterType } from "shared";
import { CharacterSpriteConfig } from "../entities/Entity";
import {
  preloadHumanoid,
  defineHumanoidAnimations,
  makeHumanoidSpriteConfig,
} from "../entities/HumanoidSprites";

export interface ClientCharacterVisualDef {
  preload: (scene: Phaser.Scene) => void;
  defineAnimations: (scene: Phaser.Scene) => void;
  spriteConfig: CharacterSpriteConfig;
}

export const CLIENT_CHARACTER_VISUAL_REGISTRY: Record<CharacterType, ClientCharacterVisualDef> = {
  guy: {
    preload: (s) => preloadHumanoid(s, "guy"),
    defineAnimations: (s) => defineHumanoidAnimations(s, "guy"),
    spriteConfig: makeHumanoidSpriteConfig("guy"),
  },
  gal: {
    preload: (s) => preloadHumanoid(s, "gal"),
    defineAnimations: (s) => defineHumanoidAnimations(s, "gal"),
    spriteConfig: makeHumanoidSpriteConfig("gal"),
  },
  skeleton: {
    preload: (s) => preloadHumanoid(s, "skeleton"),
    defineAnimations: (s) => defineHumanoidAnimations(s, "skeleton"),
    spriteConfig: makeHumanoidSpriteConfig("skeleton"),
  },
  "skeleton-mage": {
    preload: (s) => preloadHumanoid(s, "skeleton-mage"),
    defineAnimations: (s) => defineHumanoidAnimations(s, "skeleton-mage"),
    spriteConfig: makeHumanoidSpriteConfig("skeleton-mage"),
  },
};
