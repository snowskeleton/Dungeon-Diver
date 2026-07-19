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
}
