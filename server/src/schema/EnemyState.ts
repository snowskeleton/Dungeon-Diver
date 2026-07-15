import { type } from "@colyseus/schema";
import { AiState } from "shared";
import { EntityState } from "./EntityState";

export class EnemyState extends EntityState {
  @type("string") aiState: AiState = "patrol";
  @type("string") targetId: string = "";
  @type("string") facing: string = "right";
  @type("boolean") isDying: boolean = false;
  @type("string") enemyType: string = "";
  // Self-describing stats so the client needs no copy of the enemy's numbers:
  // maxHealth scales the HP bar; the radii drive the debug hitbox overlay. Set
  // once at spawn from the enemy class.
  @type("number") maxHealth: number = 0;
  @type("number") aggroRadius: number = 0;
  @type("number") attackRadius: number = 0;
  // Bosses only: true during an attack's wind-up so the client can draw a
  // telegraph (the readable "tell" before a strike). `abilityId` names which
  // move is charging (during wind-up) or executing (during a channel) so the
  // client can render a distinct telegraph and pick the matching action clip.
  @type("boolean") telegraph: boolean = false;
  @type("string") abilityId: string = "";
  // Bosses only: true while a channelled ability (e.g. the spin dash) is in its
  // extended active phase — the boss is mid-strike, not winding up. Drives the
  // client's action animation (spin) separately from the wind-up tint.
  @type("boolean") channeling: boolean = false;
  // Flying bosses only: airborne height in px above the ground plane. The client
  // lifts the sprite by this and scales a shadow beneath (the airborne illusion);
  // a swoop drives it to 0 (claws hit the floor) and back. 0 = grounded.
  @type("number") airHeight: number = 0;
}
