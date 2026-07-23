import { Bolt } from "../base";

// Arcane Staff: the "just better" bolt — faster and harder-hitting than the
// starter with no drawback, which is what makes the Arcane Staff a clean upgrade
// rather than a sidegrade. Violet tint matches the nova's arcane palette.
export class ArcaneBolt extends Bolt {
  readonly id = "arcane-bolt";
  readonly name = "Arcane Bolt";
  get damage() { return 20; }
  get speed() { return 460; }
  get tint() { return 0x9d6bff; }
}
