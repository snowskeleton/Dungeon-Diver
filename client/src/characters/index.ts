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

const humanoid = (type: CharacterType): ClientCharacterVisualDef => ({
  preload: (s) => preloadHumanoid(s, type),
  defineAnimations: (s) => defineHumanoidAnimations(s, type),
  spriteConfig: makeHumanoidSpriteConfig(type),
});

export const CLIENT_CHARACTER_VISUAL_REGISTRY: Record<CharacterType, ClientCharacterVisualDef> = {
  guy: humanoid("guy"),
  "guy-blue": humanoid("guy-blue"),
  gal: humanoid("gal"),
  "gal-green": humanoid("gal-green"),
  skeleton: humanoid("skeleton"),
  "skeleton-mage": humanoid("skeleton-mage"),
  colt: humanoid("colt"),
  "the-fool": humanoid("the-fool"),
  gigante: humanoid("gigante"),
  reptile: humanoid("reptile"),
  kobold: humanoid("kobold"),
  scaleless: humanoid("scaleless"),
};
