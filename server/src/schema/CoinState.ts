import { Schema, type } from "@colyseus/schema";
import { CoinStateView } from "shared";

/** A gold coin on the floor. Not an EntityState — a coin has no health, no
 *  collision body, and no stun; it's a kinematic pickup the server drives
 *  directly (see the Coin entity), so it carries only position and value. */
export class CoinState extends Schema implements CoinStateView {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("uint16") value: number = 0;
}
