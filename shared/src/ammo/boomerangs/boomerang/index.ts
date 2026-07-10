import { Boomerang } from "../base";

// speed (500) and lifetimeMs (500) come from the Boomerang defaults; returnsAtMs
// auto-derives to half the lifetime (250).
export default new Boomerang({
  id: "boomerang", name: "Boomerang",
  damage: 15,
});
