import { type } from "@colyseus/schema";
import { AiState } from "shared";
import { EntityState } from "./EntityState";

export class EnemyState extends EntityState {
  @type("string") aiState: AiState = "patrol";
  @type("string") targetId: string = "";
  @type("string") facing: string = "right";
  @type("boolean") isDying: boolean = false;
  @type("boolean") stunned: boolean = false;
  @type("string") enemyType: string = "";
  // Self-describing stats so the client needs no copy of the enemy's numbers:
  // maxHealth scales the HP bar; the radii drive the debug hitbox overlay. Set
  // once at spawn from the enemy class.
  @type("number") maxHealth: number = 0;
  @type("number") aggroRadius: number = 0;
  @type("number") attackRadius: number = 0;
  // Bosses only: true during an attack's wind-up so the client can draw a
  // telegraph (the readable "tell" before a strike). `abilityId` names which
  // move is charging so different telegraphs can render differently.
  @type("boolean") telegraph: boolean = false;
  @type("string") abilityId: string = "";
}
