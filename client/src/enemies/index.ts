import { EnemyType } from "shared";
import { ClientEnemyDef } from "./types";
import { gooGreen, gooBlue, gooGold } from "./goos";
import { eyeBat } from "./bats";
import { smushroom } from "./floaters";
import { spider, frogFlower } from "./critters";
import {
  bones, armorLancer,
  axeBeast, maceBeast, swordBeast, fang,
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

  "eye-bat": eyeBat,

  "smushroom": smushroom,

  // ── Horizontal, multi-row sheets ─────────────────────────────────────────
  "spider": spider,
  "frog-flower": frogFlower,

  // ── Directional ──────────────────────────────────────────────────────────
  "bones": bones,
  "armor-lancer": armorLancer,
  "axe-beast": axeBeast,
  "mace-beast": maceBeast,
  "sword-beast": swordBeast,
  "fang": fang,

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
