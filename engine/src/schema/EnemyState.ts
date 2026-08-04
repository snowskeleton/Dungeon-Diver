import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { AiState, Facing, EnemyStateView } from "shared";
import { EntityState } from "./EntityState";

export class EnemyState extends EntityState implements EnemyStateView {
  @tracked("string") aiState: AiState = "patrol";
  @tracked("string") targetId: string = "";
  @tracked("string") facing: Facing = "right";
  @tracked("boolean") isDying: boolean = false;
  @tracked("string") enemyType: string = "";
  // Self-describing stats so the client needs no copy of the enemy's numbers:
  // maxHealth scales the HP bar; the radii drive the debug hitbox overlay. Set
  // once at spawn from the enemy class.
  @tracked("number") maxHealth: number = 0;
  @tracked("number") aggroRadius: number = 0;
  @tracked("number") attackRadius: number = 0;
  // Bosses only: true during an attack's wind-up so the client can draw a
  // telegraph (the readable "tell" before a strike). `abilityId` names which
  // move is charging (during wind-up) or executing (during a channel) so the
  // client can render a distinct telegraph and pick the matching action clip.
  @tracked("boolean") telegraph: boolean = false;
  @tracked("string") abilityId: string = "";
  // Bosses only: true while a channelled ability (e.g. the spin dash) is in its
  // extended active phase — the boss is mid-strike, not winding up. Drives the
  // client's action animation (spin) separately from the wind-up tint.
  @tracked("boolean") channeling: boolean = false;
  // airHeight moved up to EntityState — a flyer cruises there, a swoop drives it
  // to 0 and back, and now a Vaulting player uses the same field.
}
