import { EnemyClass } from "../Enemy";
import { GooGreen, GooBlue, GooGold } from "./goos";
import { Bat, BrownBat, EyeBat, GoldEye } from "./bats";
import { FloatEye, FloatSkull, FloatSkullTeal, FloatSkullPink, Smushroom } from "./floaters";
import { Rat, Spider, FrogFlower, FrogFlowerBlack, Swarm1, Swarm2, Swarm3 } from "./critters";
import {
  Bones, BonesBlader, Kultist, ArmorLancer,
  Beast, AxeBeast, MaceBeast, SwordBeast, Fang, HoodFang,
} from "./directional";

// The rank-and-file enemies that populate combat rooms. Bosses are deliberately
// NOT here — they only ever spawn in the boss room (see bosses/index.ts), so a
// boss can never leak into the normal spawn pool as a plain contact enemy. Add
// an enemy by writing its class and listing it here; no id→class map to keep in
// sync, and the EnemyClass[] type makes the compiler check each entry.
export const REGULAR_ENEMIES: EnemyClass[] = [
  GooGreen, GooBlue, GooGold,
  Bat, BrownBat, EyeBat, GoldEye,
  FloatEye, FloatSkull, FloatSkullTeal, FloatSkullPink, Smushroom,
  Rat, Spider, FrogFlower, FrogFlowerBlack, Swarm1, Swarm2, Swarm3,
  Bones, BonesBlader, Kultist, ArmorLancer,
  Beast, AxeBeast, MaceBeast, SwordBeast, Fang, HoodFang,
];
