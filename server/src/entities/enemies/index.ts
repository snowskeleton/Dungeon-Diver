import { EnemyClass } from "../Enemy";
import { GooGreen, GooBlue, GooGold } from "./goos";
import { EyeBat } from "./bats";
import { Smushroom } from "./floaters";
import { Spider, FrogFlower } from "./critters";
import {
  Bones, ArmorLancer,
  AxeBeast, MaceBeast, SwordBeast, Fang,
} from "./directional";

// The rank-and-file enemies that populate combat rooms. Bosses are deliberately
// NOT here — they only ever spawn in the boss room (see bosses/index.ts), so a
// boss can never leak into the normal spawn pool as a plain contact enemy. Add
// an enemy by writing its class and listing it here; no id→class map to keep in
// sync, and the EnemyClass[] type makes the compiler check each entry.
export const REGULAR_ENEMIES: EnemyClass[] = [
  GooGreen, GooBlue, GooGold,
  EyeBat, Smushroom,
  Spider, FrogFlower,
  Bones, ArmorLancer,
  AxeBeast, MaceBeast, SwordBeast, Fang,
];
