import { ComboSwing, Weapon } from "shared";
import { PlayerStateView } from "shared";

/**
 * The cocked-back pose the client holds for a melee weapon, as the argument tuple
 * for `Entity.setChargePose(active, hard, swing)`. Two distinct poses share it:
 *
 * - **windingUp** — the swing's OWN wind-up, BEFORE the blow. The server spends the
 *   weapon's cooldown here (a hammer rears back for a while, a dagger barely
 *   pauses), so the character holds the first swing frame of the swing now in
 *   flight (`comboStep`, or the hard swing if this one is a heavy).
 * - **charging** — the heavy charge held AFTER a swing while the button stays down;
 *   the pose anticipates the queued heavy (`chargeHard`) or the next tap.
 *
 * windingUp wins when both are set (a swing can't be mid-wind-up and mid-charge at
 * once, but reading it first keeps the in-flight swing's icon correct).
 */
export function meleeWindupPose(
  state: PlayerStateView,
  weapon: Weapon,
): [boolean, boolean, ComboSwing | null] {
  const swings = weapon.comboSwings;
  if (state.windingUp) {
    const swing = state.hardSwing ? weapon.hardSwing : swings[state.comboStep % swings.length];
    return [true, state.hardSwing, swing ?? null];
  }
  const swing = state.chargeHard ? weapon.hardSwing : swings[0];
  return [state.charging, state.chargeHard, swing ?? null];
}
