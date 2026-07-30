import { Enemy } from "../Enemy";
import { SpellCaster } from "../../spells";

// The shared base for every rank-and-file enemy that carries a SpellCaster and
// drives a telegraphed ability (armed swings, the skeleton-mage's staff bolt, the
// frog's leap, the eye-bat's dive, the smushroom's cloud). It owns the caster, the
// schema mirroring, and the interrupt rule — the bits every casting enemy repeats —
// so subclasses only write their own AI/targeting. Bosses stay on their own base
// (Boss); this is the rabble counterpart.
//
// It deliberately does NOT own tick(): casting enemies differ wildly in HOW they
// approach (melee range, hop, spiral, cloud), so each writes its own AI and calls
// these helpers. What they share is the cast lifecycle, not the movement.
export abstract class CastingEnemy extends Enemy {
  protected readonly caster = new SpellCaster();

  // Mirror the cast phase onto the schema the same way Boss does, so the client's
  // telegraph (wind-up) and channel (mid-strike) reads light up for free — the
  // held-weapon visual and any per-creature tell key off these fields.
  protected syncCastState(): void {
    this.state.telegraph = this.caster.windingUp;
    this.state.channeling = this.caster.phase === "active";
    this.state.abilityId = this.caster.activeSpellId;
  }

  // Interrupt an in-flight cast when the enemy is staggered OR merely shoved this
  // tick. A stagger already stuns (updateStun), but a light hit that only nudges
  // must still break the wind-up — that's what consumeKnockback catches. An active
  // phase flagged knockback-immune (a spin) is left alone: you can't cancel it.
  //
  // Returns true while the enemy is stunned, so callers skip the rest of their AI
  // tick (the knockback impulse rides out via commitVelocity). updateStun is called
  // EXACTLY once here, so a subclass must route its stun check through this and not
  // call updateStun itself.
  protected interruptOnHit(dtMs: number): boolean {
    const stunned = this.updateStun(dtMs);
    const shoved = this.consumeKnockback();
    if ((stunned || shoved) && !this.caster.knockbackImmuneActive) {
      this.caster.interrupt();
    }
    return stunned;
  }
}
