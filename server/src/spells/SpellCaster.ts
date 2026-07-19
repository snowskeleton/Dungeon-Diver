import { Caster, Spell, AimPoint } from "./Spell";

export type CastPhase = "idle" | "windup" | "active" | "recover";

// The shared cast-lifecycle runner, used by bosses, enemies, and players alike.
// It drives ONE spell through wind-up → strike → (optional channel) → recover and
// owns the caster clock that spell cooldowns read.
//
// It does NOT reach into the caster to set telegraph / channel / knockback flags.
// It simply OWNS its `phase` and active spell; the caster READS those each tick to
// drive its own animation and immunity (a boss mirrors phase → its schema; a
// player mirrors busy → isAttacking). That inversion is what keeps the Caster
// interface tiny. Aim is passed IN each tick — the caller decides how it's aimed
// (a boss tracks its target, a player projects its facing); the SpellCaster only
// owns the freeze-before-strike timing.
export class SpellCaster {
  private _phase: CastPhase = "idle";
  private timer = 0;
  private spell?: Spell;
  private aimX = 0;
  private aimY = 0;
  private aimLocked = false;
  // Monotonic per-caster clock (ms). Spells stamp lastCastAt against it.
  private elapsed = 0;

  /** Current clock time, for querying spell readiness (`spell.isReady(now)`). */
  get now(): number {
    return this.elapsed;
  }

  /** The current cast phase — the caster reads this to pick its animation. */
  get phase(): CastPhase {
    return this._phase;
  }

  /** The id of the spell being cast (empty when idle) — drives the action clip. */
  get activeSpellId(): string {
    return this.spell?.id ?? "";
  }

  /** True while a cast is in flight — the caller must not start another or move. */
  get busy(): boolean {
    return this._phase !== "idle";
  }

  /** True while mid-active-phase of a knockback-immune spell — the caster reads
   *  this to set its own immunity, rather than being pushed a flag. */
  get knockbackImmuneActive(): boolean {
    return this._phase === "active" && (this.spell?.knockbackImmuneWhileActive ?? false);
  }

  /** True while mid-active-phase of an invulnerable spell — the caster reads this
   *  to gate its `damageable` (the Tengu's stone flight). */
  get invulnerableActive(): boolean {
    return this._phase === "active" && (this.spell?.invulnerableWhileActive ?? false);
  }

  /** Advance the clock. Call once per tick regardless of phase. */
  tickClock(dtMs: number): void {
    this.elapsed += dtMs;
  }

  /** Begin casting `spell`, seeding the aim from `aim`. */
  begin(spell: Spell, aim: AimPoint): void {
    this.spell = spell;
    this._phase = "windup";
    this.timer = spell.windUpMs;
    this.aimLocked = false;
    this.aimX = aim.x;
    this.aimY = aim.y;
  }

  /** Advance the current cast one tick, tracking `aim` during the wind-up (until it
   *  freezes aimLockMs before the strike). Returns true on the tick a cast fully
   *  finishes recovering (so the caller can start its post-attack rest). */
  update(caster: Caster, dtMs: number, aim: AimPoint): boolean {
    const spell = this.spell;
    if (!spell) return false;

    switch (this._phase) {
      case "windup":
        this.timer -= dtMs;
        // Track the aim until aimLockMs before the strike, then hold it so a moving
        // target can slip out of the line.
        if (!this.aimLocked) {
          this.aimX = aim.x;
          this.aimY = aim.y;
          if (this.timer <= spell.aimLockMs) this.aimLocked = true;
        }
        if (this.timer <= 0) this.strike(caster, spell);
        return false;

      case "active": {
        this.timer -= dtMs;
        const done = spell.activeTick(caster, dtMs, { x: this.aimX, y: this.aimY });
        if (done || this.timer <= 0) {
          this.endActive(caster, spell);
          return !this.busy; // a zero-recover spell goes straight to idle this tick
        }
        return false;
      }

      case "recover":
        this.timer -= dtMs;
        if (this.timer <= 0) {
          this._phase = "idle";
          this.spell = undefined;
          return true; // cast fully complete this tick
        }
        return false;
    }
    return false;
  }

  // Wind-up finished: run the strike. Instant spells (activeMs 0) do their whole
  // effect in onActivate and fall straight through to recover; channels enter the
  // active phase.
  private strike(caster: Caster, spell: Spell): void {
    spell.activate(caster, { x: this.aimX, y: this.aimY });
    if (spell.activeMs > 0) {
      this._phase = "active";
      this.timer = spell.activeMs;
    } else {
      this.endActive(caster, spell);
    }
  }

  // Active phase over (or instant strike done): start the cooldown, then enter the
  // vulnerable recover window — or go straight to idle if there is no recovery
  // (player weapons), so a held attack can re-fire on this very tick.
  private endActive(caster: Caster, spell: Spell): void {
    spell.deactivate(caster);
    spell.markCast(this.elapsed); // the spell owns its cooldown; start it now
    if (spell.recoverMs > 0) {
      this._phase = "recover";
      this.timer = spell.recoverMs;
    } else {
      this._phase = "idle";
      this.spell = undefined;
    }
  }

  /** Abort the current cast (a stun mid-wind-up cancels the attack). Channels are
   *  knockback-immune, so callers only interrupt when not mid-active-phase. */
  interrupt(): void {
    this._phase = "idle";
    this.spell = undefined;
  }
}
