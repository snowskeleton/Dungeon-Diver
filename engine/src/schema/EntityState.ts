import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { EntityStateView } from "shared";

export class EntityState extends Observable implements EntityStateView {
  @tracked("number") x: number = 0;
  @tracked("number") y: number = 0;
  @tracked("number") health: number = 100;
  @tracked("number") speedMultiplier: number = 1;
  // True while knocked back / in hitstun. Shared by players and enemies so both
  // can drive a client flinch and so their AI/input freezes while set.
  @tracked("boolean") stunned: boolean = false;
  // Airborne height in px above the ground plane; 0 = grounded. Shared by every
  // entity: a flying enemy cruises here, a swoop drives it to 0 and back, and a
  // Vaulting player arcs it up and down. The client lifts the sprite by this and
  // scales a shadow; the server reads it for the elevation band (GROUND vs AIR)
  // that gates whether ground-only attacks connect. See shared/combat/elevation.
  @tracked("number") airHeight: number = 0;
}
