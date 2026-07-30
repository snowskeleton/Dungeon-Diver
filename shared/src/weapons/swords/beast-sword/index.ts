import { Sword } from "../base";
// A beast's crude blade — the sword the sword-beast swings (art from the SOA2 pack).
// It lives in the main catalog like any other sword, so a class that can wield
// swords may also roll/equip it; the beast just happens to spawn holding it.
export class BeastSword extends Sword {
  readonly id = "beast-sword";
  readonly name = "Beast Sword";
}
