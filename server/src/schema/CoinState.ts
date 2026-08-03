import { Observable, ObservableMap, ObservableList, tracked } from "shared";
import { CoinStateView } from "shared";

/** A gold coin on the floor. Not an EntityState — a coin has no health, no
 *  collision body, and no stun; it's a kinematic pickup the server drives
 *  directly (see the Coin entity), so it carries only position and value. */
export class CoinState extends Observable implements CoinStateView {
  @tracked("number") x: number = 0;
  @tracked("number") y: number = 0;
  @tracked("uint16") value: number = 0;
}
