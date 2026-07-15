import { EnemyType } from "shared";
import { ClientEnemyDef } from "./types";
import { gooGreen, gooBlue, gooGold } from "./goos";
import { bat, brownBat, eyeBat, goldEye } from "./bats";
import { floatEye, smushroom, floatSkullDef, floatSkullTeal, floatSkullPink } from "./floaters";
import {
  rat, spider, frogFlower, frogFlowerBlack,
  swarm1, swarm2, swarm3,
} from "./critters";
import {
  bones, bonesBlader, kultist, armorLancer,
  beast, axeBeast, maceBeast, swordBeast, fang, hoodFang,
} from "./directional";
import { turtleDragon } from "./bosses/TurtleDragon";
import { wyvern, wyvernGreen, wyvernGrey } from "./bosses/Wyvern";
import { tenguMask, tenguShade } from "./bosses/TenguMask";
import { centaurKnight, bigBeast, batwingButtstomper } from "./bosses/simple";

export * from "./types";

// Every enemy's visual def lives in a small group module co-located with its
// siblings, mirroring the server's entities/enemies/*.ts + entities/bosses/*.ts.
// This file is pure wiring: the Record<EnemyType, …> annotation makes the compiler
// enforce that every id has exactly one def. To add an enemy, define it in the
// matching group module and add the one line here — nothing else in this file.
export const CLIENT_ENEMY_REGISTRY: Record<EnemyType, ClientEnemyDef> = {
  // ── Horizontal, single-row strips ────────────────────────────────────────
  "goo-green": gooGreen,
  "goo-blue": gooBlue,
  "goo-gold": gooGold,

  "bat": bat,
  "brown-bat": brownBat,
  "eye-bat": eyeBat,
  "gold-eye": goldEye,

  "smushroom": smushroom,
  "float-eye": floatEye,

  "swarm-1": swarm1,
  "swarm-2": swarm2,
  "swarm-3": swarm3,

  "rat": rat,

  // ── Horizontal, multi-row sheets ─────────────────────────────────────────
  "spider": spider,
  "frog-flower": frogFlower,
  "frog-flower-black": frogFlowerBlack,

  "float-skull": floatSkullDef,
  "float-skull-teal": floatSkullTeal,
  "float-skull-pink": floatSkullPink,

  // ── Directional ──────────────────────────────────────────────────────────
  "bones": bones,
  "bones-blader": bonesBlader,
  "kultist": kultist,
  "armor-lancer": armorLancer,
  "beast": beast,
  "axe-beast": axeBeast,
  "mace-beast": maceBeast,
  "sword-beast": swordBeast,
  "fang": fang,
  "hood-fang": hoodFang,

  // ── Bosses ───────────────────────────────────────────────────────────────
  "turtle-dragon": turtleDragon,
  "wyvern": wyvern,
  "wyvern-green": wyvernGreen,
  "wyvern-grey": wyvernGrey,
  "centaur-knight": centaurKnight,
  "big-beast": bigBeast,
  "tengu-mask": tenguMask,
  "tengu-shade": tenguShade, // the Tengu's Mirror Split copy (summon-only)
  "batwing-buttstomper": batwingButtstomper,
};

export const ENEMY_TYPES = Object.keys(CLIENT_ENEMY_REGISTRY) as EnemyType[];
