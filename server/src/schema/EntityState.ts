import { Schema, type } from "@colyseus/schema";
import { EntityStateView } from "shared";

export class EntityState extends Schema implements EntityStateView {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") health: number = 100;
  @type("number") speedMultiplier: number = 1;
  // True while knocked back / in hitstun. Shared by players and enemies so both
  // can drive a client flinch and so their AI/input freezes while set.
  @type("boolean") stunned: boolean = false;
  // Airborne height in px above the ground plane; 0 = grounded. Shared by every
  // entity: a flying enemy cruises here, a swoop drives it to 0 and back, and a
  // Vaulting player arcs it up and down. The client lifts the sprite by this and
  // scales a shadow; the server reads it for the elevation band (GROUND vs AIR)
  // that gates whether ground-only attacks connect. See shared/combat/elevation.
  @type("number") airHeight: number = 0;
}
