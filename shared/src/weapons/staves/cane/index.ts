import { Staff } from "../base";

// Fires the same starter bolt as the Oak Staff but noticeably faster — the
// low-damage, high-cadence option.
export default new Staff({
  id: "cane",
  name: "Cane",
  attackCooldownMs: 440,
});
