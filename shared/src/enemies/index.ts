import { EnemyType, EnemyConfig } from "./base";
import { GOO_GREEN_CONFIG }         from "./GooGreen";
import { GOO_BLUE_CONFIG }          from "./GooBlue";
import { GOO_GOLD_CONFIG }          from "./GooGold";
import { BAT_CONFIG }               from "./Bat";
import { BROWN_BAT_CONFIG }         from "./BrownBat";
import { EYE_BAT_CONFIG }           from "./EyeBat";
import { GOLD_EYE_CONFIG }          from "./GoldEye";
import { SMUSHROOM_CONFIG }         from "./Smushroom";
import { FLOAT_EYE_CONFIG }         from "./FloatEye";
import { SWARM_1_CONFIG }           from "./Swarm1";
import { SWARM_2_CONFIG }           from "./Swarm2";
import { SWARM_3_CONFIG }           from "./Swarm3";
import { RAT_CONFIG }               from "./Rat";
import { SPIDER_CONFIG }            from "./Spider";
import { FROG_FLOWER_CONFIG }       from "./FrogFlower";
import { FROG_FLOWER_BLACK_CONFIG } from "./FrogFlowerBlack";
import { FLOAT_SKULL_CONFIG }       from "./FloatSkull";
import { FLOAT_SKULL_TEAL_CONFIG }  from "./FloatSkullTeal";
import { FLOAT_SKULL_PINK_CONFIG }  from "./FloatSkullPink";
import { BONES_CONFIG }             from "./Bones";
import { BONES_BLADER_CONFIG }      from "./BonesBlader";
import { KULTIST_CONFIG }           from "./Kultist";
import { ARMOR_LANCER_CONFIG }      from "./ArmorLancer";
import { BEAST_CONFIG }             from "./Beast";
import { AXE_BEAST_CONFIG }         from "./AxeBeast";
import { MACE_BEAST_CONFIG }        from "./MaceBeast";
import { SWORD_BEAST_CONFIG }       from "./SwordBeast";
import { FANG_CONFIG }              from "./Fang";
import { HOOD_FANG_CONFIG }         from "./HoodFang";
import { TURTLE_DRAGON_CONFIG }      from "./TurtleDragon";
import { WYVERN_CONFIG }             from "./Wyvern";
import { WYVERN_GREEN_CONFIG }       from "./WyvernGreen";
import { WYVERN_GREY_CONFIG }        from "./WyvernGrey";
import { CENTAUR_KNIGHT_CONFIG }     from "./CentaurKnight";
import { BIG_BEAST_CONFIG }          from "./BigBeast";
import { TENGU_MASK_CONFIG }         from "./TenguMask";
import { BATWING_BUTTSTOMPER_CONFIG } from "./BatwingButtstomper";

export const ENEMY_REGISTRY: Record<EnemyType, EnemyConfig> = {
  "goo-green":         GOO_GREEN_CONFIG,
  "goo-blue":          GOO_BLUE_CONFIG,
  "goo-gold":          GOO_GOLD_CONFIG,
  "bat":               BAT_CONFIG,
  "brown-bat":         BROWN_BAT_CONFIG,
  "eye-bat":           EYE_BAT_CONFIG,
  "gold-eye":          GOLD_EYE_CONFIG,
  "smushroom":         SMUSHROOM_CONFIG,
  "float-eye":         FLOAT_EYE_CONFIG,
  "swarm-1":           SWARM_1_CONFIG,
  "swarm-2":           SWARM_2_CONFIG,
  "swarm-3":           SWARM_3_CONFIG,
  "rat":               RAT_CONFIG,
  "spider":            SPIDER_CONFIG,
  "frog-flower":       FROG_FLOWER_CONFIG,
  "frog-flower-black": FROG_FLOWER_BLACK_CONFIG,
  "float-skull":       FLOAT_SKULL_CONFIG,
  "float-skull-teal":  FLOAT_SKULL_TEAL_CONFIG,
  "float-skull-pink":  FLOAT_SKULL_PINK_CONFIG,
  "bones":             BONES_CONFIG,
  "bones-blader":      BONES_BLADER_CONFIG,
  "kultist":           KULTIST_CONFIG,
  "armor-lancer":      ARMOR_LANCER_CONFIG,
  "beast":             BEAST_CONFIG,
  "axe-beast":         AXE_BEAST_CONFIG,
  "mace-beast":        MACE_BEAST_CONFIG,
  "sword-beast":       SWORD_BEAST_CONFIG,
  "fang":              FANG_CONFIG,
  "hood-fang":         HOOD_FANG_CONFIG,

  // Bosses
  "turtle-dragon":       TURTLE_DRAGON_CONFIG,
  "wyvern":              WYVERN_CONFIG,
  "wyvern-green":        WYVERN_GREEN_CONFIG,
  "wyvern-grey":         WYVERN_GREY_CONFIG,
  "centaur-knight":      CENTAUR_KNIGHT_CONFIG,
  "big-beast":           BIG_BEAST_CONFIG,
  "tengu-mask":          TENGU_MASK_CONFIG,
  "batwing-buttstomper": BATWING_BUTTSTOMPER_CONFIG,
};

export * from "./base";
export { GOO_GREEN_CONFIG }         from "./GooGreen";
export { GOO_BLUE_CONFIG }          from "./GooBlue";
export { GOO_GOLD_CONFIG }          from "./GooGold";
export { BAT_CONFIG }               from "./Bat";
export { BROWN_BAT_CONFIG }         from "./BrownBat";
export { EYE_BAT_CONFIG }           from "./EyeBat";
export { GOLD_EYE_CONFIG }          from "./GoldEye";
export { SMUSHROOM_CONFIG }         from "./Smushroom";
export { FLOAT_EYE_CONFIG }         from "./FloatEye";
export { SWARM_1_CONFIG }           from "./Swarm1";
export { SWARM_2_CONFIG }           from "./Swarm2";
export { SWARM_3_CONFIG }           from "./Swarm3";
export { RAT_CONFIG }               from "./Rat";
export { SPIDER_CONFIG }            from "./Spider";
export { FROG_FLOWER_CONFIG }       from "./FrogFlower";
export { FROG_FLOWER_BLACK_CONFIG } from "./FrogFlowerBlack";
export { FLOAT_SKULL_CONFIG }       from "./FloatSkull";
export { FLOAT_SKULL_TEAL_CONFIG }  from "./FloatSkullTeal";
export { FLOAT_SKULL_PINK_CONFIG }  from "./FloatSkullPink";
export { BONES_CONFIG }             from "./Bones";
export { BONES_BLADER_CONFIG }      from "./BonesBlader";
export { KULTIST_CONFIG }           from "./Kultist";
export { ARMOR_LANCER_CONFIG }      from "./ArmorLancer";
export { BEAST_CONFIG }             from "./Beast";
export { AXE_BEAST_CONFIG }         from "./AxeBeast";
export { MACE_BEAST_CONFIG }        from "./MaceBeast";
export { SWORD_BEAST_CONFIG }       from "./SwordBeast";
export { FANG_CONFIG }              from "./Fang";
export { HOOD_FANG_CONFIG }         from "./HoodFang";
export { TURTLE_DRAGON_CONFIG }      from "./TurtleDragon";
export { WYVERN_CONFIG }             from "./Wyvern";
export { WYVERN_GREEN_CONFIG }       from "./WyvernGreen";
export { WYVERN_GREY_CONFIG }        from "./WyvernGrey";
export { CENTAUR_KNIGHT_CONFIG }     from "./CentaurKnight";
export { BIG_BEAST_CONFIG }          from "./BigBeast";
export { TENGU_MASK_CONFIG }         from "./TenguMask";
export { BATWING_BUTTSTOMPER_CONFIG } from "./BatwingButtstomper";
