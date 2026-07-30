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

// The PLAYER skins only. skeleton + skeleton-mage are humanoid ENEMIES now (drawn
// from the same sheets via HumanoidSprites, wired through CLIENT_ENEMY_REGISTRY).
export const CLIENT_CHARACTER_VISUAL_REGISTRY: Record<CharacterType, ClientCharacterVisualDef> = {
  guy: humanoid("guy"),
  gal: humanoid("gal"),
  colt: humanoid("colt"),
  gigante: humanoid("gigante"),
};
