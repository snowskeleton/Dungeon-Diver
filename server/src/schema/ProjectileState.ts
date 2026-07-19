import { type } from "@colyseus/schema";
import { EntityState } from "./EntityState";
import { ProjectileStateView } from "shared";

export class ProjectileState extends EntityState implements ProjectileStateView {
  // Travel direction in radians (right=0, down=+π/2, left=π, up=−π/2).
  // Clients rotate the sprite by this + the ammo's baked spriteAngle.
  @type("number") angle: number = 0;
  @type("string") ammoId: string = "arrow";
  // Session id of the player who fired it (unused client-side for now, but handy
  // for scoring / friendly-fire rules later).
  @type("string") ownerSessionId: string = "";
}
