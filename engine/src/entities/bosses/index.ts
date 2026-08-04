import { EnemyType } from "shared";
import { PhysicsWorld } from "../../physics/PhysicsWorld";
import { Boss } from "../Boss";
import { TurtleDragon } from "./TurtleDragon";
import { Wyvern } from "./Wyvern";
import { WyvernGreen } from "./WyvernGreen";
import { WyvernGrey } from "./WyvernGrey";
import { CentaurKnight } from "./CentaurKnight";
import { BigBeast } from "./BigBeast";
import { TenguMask } from "./TenguMask";
import { BatwingButtstomper } from "./BatwingButtstomper";

/** A concrete boss class: `new`-able and carrying its id + bestiary text as
 *  statics. Typing the BOSSES array with this forces every entry to declare a
 *  `static type` — the compiler's stand-in for an id→class lookup table. */
export type BossClass = {
  new (physics: PhysicsWorld, x: number, y: number): Boss;
  readonly type: EnemyType;
  readonly lore: string;
  readonly abilities: { name: string; desc: string }[];
};

// The bosses, in the order the boss room rotates through them by floor. Add a
// boss by writing its class and dropping it in here — no registry to update.
export const BOSSES: BossClass[] = [
  TurtleDragon,
  Wyvern,
  WyvernGreen,
  WyvernGrey,
  CentaurKnight,
  BigBeast,
  TenguMask,
  BatwingButtstomper,
];
