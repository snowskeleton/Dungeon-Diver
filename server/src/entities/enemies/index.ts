import { EnemyClass } from "../Enemy";
import { GooGreen } from "./GooGreen";
import { GooBlue } from "./GooBlue";
import { GooGold } from "./GooGold";
import { EyeBat } from "./EyeBat";
import { Smushroom } from "./Smushroom";
import { Spider } from "./Spider";
import { FrogFlower } from "./FrogFlower";
import { Bones } from "./Bones";
import { Fang } from "./Fang";
import { SwordBeast } from "./SwordBeast";
import { AxeBeast } from "./AxeBeast";
import { MaceBeast } from "./MaceBeast";
import { ArmorLancer } from "./ArmorLancer";
import { Skeleton } from "./Skeleton";
import { SkeletonMage } from "./SkeletonMage";

// One file per enemy, mirroring entities/bosses/. Shared behavior lives in its own
// files: the cast lifecycle (CastingEnemy), the close-in-then-commit AI
// (ApproachCastEnemy), weapon swinging (ArmedEnemy), directional facing
// (DirectionalEnemy), and reusable approach movements (movement.ts). Re-export every
// class here so there's a single barrel to import from (tests, GameRoom).
export { GooGreen } from "./GooGreen";
export { GooBlue } from "./GooBlue";
export { GooGold } from "./GooGold";
export { EyeBat } from "./EyeBat";
export { Smushroom } from "./Smushroom";
export { Spider } from "./Spider";
export { FrogFlower } from "./FrogFlower";
export { Bones } from "./Bones";
export { Fang } from "./Fang";
export { SwordBeast } from "./SwordBeast";
export { AxeBeast } from "./AxeBeast";
export { MaceBeast } from "./MaceBeast";
export { ArmorLancer } from "./ArmorLancer";
export { Skeleton } from "./Skeleton";
export { SkeletonMage } from "./SkeletonMage";
// The Tengu's summon-only split copy — exported for the boss that conjures it, but
// deliberately kept OUT of REGULAR_ENEMIES so it never joins the normal spawn pool.
export { TenguShade } from "./tenguShade";

export { CastingEnemy } from "./CastingEnemy";
export { ApproachCastEnemy } from "./ApproachCastEnemy";
export { ArmedEnemy } from "./ArmedEnemy";
export { DirectionalEnemy } from "./DirectionalEnemy";

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
  Skeleton, SkeletonMage,
];
