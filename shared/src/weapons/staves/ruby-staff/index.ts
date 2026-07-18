import { Staff } from "../base";

// Fire: a slow, heavy flame bolt on a slower fire interval — big hits, low cadence.
export default new Staff({
  id: "ruby-staff",
  name: "Ruby Staff",
  ammoId: "flame-bolt",
  attackCooldownMs: 620,
});
