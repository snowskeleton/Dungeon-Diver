import { EnemyType } from "shared";
import { Enemy } from "../Enemy";

// A standard chaser on the default patrol → chase → contact-melee AI. Nothing
// special beyond its art.
export class Spider extends Enemy {
  static readonly type: EnemyType = "spider";
  static readonly role = "swarm" as const;
}
