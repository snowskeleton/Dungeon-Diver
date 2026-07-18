import { Staff } from "../base";

// Frost: the biggest hit and heaviest knockback in the family, paid for with the
// slowest fire interval of any staff.
export default new Staff({
  id: "crystal-wand",
  name: "Crystal Wand",
  ammoId: "frost-bolt",
  attackCooldownMs: 760,
});
