import { Bolt } from "../base";

// Arcane Staff: the "just better" bolt — faster and harder-hitting than the
// starter with no drawback, which is what makes the Arcane Staff a clean upgrade
// rather than a sidegrade. Violet tint matches the nova's arcane palette.
export default new Bolt({
  id: "arcane-bolt", name: "Arcane Bolt",
  damage: 20,
  speed: 460,
  tint: 0x9d6bff,
});
