import { EnemyType } from "shared";
import { PlayerState } from "../../schema/PlayerState";
import { Spell, lingeringCloud } from "../../spells";
import { CastingEnemy } from "./CastingEnemy";

// Cloud tuning — shared shape for both the walk-up cloud and the death cloud.
const CLOUD_RADIUS = 60;
const CLOUD_DURATION_MS = 6000; // full 0–2s, fades out by 6s (fade is client-side)
const CLOUD_REHIT_MS = 500; // ticks damage every 0.5s to anyone still inside

// The Smushroom: walks up to the player and releases a lingering damage CLOUD it
// tries to catch you in, and releases the same cloud on death (a parting gift). The
// cloud is its ONLY damage — no passive contact. It's caster-anchored (centred on
// the smushroom), so the body stays put while it lingers and, on death, the corpse
// lingers too before fading — no detached hazard entity.
//
// It extends CastingEnemy directly (not ApproachCastEnemy): it drags the cloud while
// casting, gates on cloud.isReady rather than a rest timer, and runs a death cloud —
// genuinely its own AI, so forcing it into the approach-cast driver would be a dead
// abstraction. What it DOES share: the caster, selfAim, and the no-contact default.
export class Smushroom extends CastingEnemy {
  static readonly type: EnemyType = "smushroom";

  /** Distance at which it stops and gasses you. */
  private get cloudRange(): number { return CLOUD_RADIUS * 0.9; }

  private _cloud?: Spell;
  private get cloud(): Spell {
    if (!this._cloud) {
      this._cloud = lingeringCloud({
        id: "smushroom-cloud",
        radius: CLOUD_RADIUS,
        damage: 6,
        durationMs: CLOUD_DURATION_MS,
        hitCooldownMs: CLOUD_REHIT_MS,
        // Long enough that it doesn't chain gas nonstop; it re-clouds after a lull.
        cooldownMs: CLOUD_DURATION_MS + 1500,
      });
    }
    return this._cloud;
  }

  override tick(players: Map<string, PlayerState>, dtMs: number): void {
    this.applyFlightBaseline();
    this.containToHome();
    if (this.state.isDying) return; // death cloud runs via deathTick
    this.caster.tickClock(dtMs);

    // The cloud is knockback-immune, so interruptOnHit won't cancel it; it only
    // matters for the stun skip while walking up.
    if (this.interruptOnHit(dtMs)) {
      this.syncCastState();
      return;
    }

    const target = this.pickTarget(players);

    // Already gassing: keep shambling toward the player so the caster-anchored cloud
    // is dragged onto them (it's not a stationary drop). The cloud runs regardless.
    if (this.caster.busy) {
      if (target) this.pathToward(target);
      this.caster.update(this, dtMs, this.selfAim);
      this.syncCastState();
      return;
    }

    if (!target) {
      this.transition("patrol");
      this.state.targetId = "";
      this.patrol(dtMs);
      this.syncCastState();
      return;
    }

    this.state.targetId = target.id;
    if (target.dist <= this.cloudRange && this.cloud.isReady(this.caster.now)) {
      this.transition("attack");
      this.caster.begin(this.cloud, this.selfAim);
      this.caster.update(this, dtMs, this.selfAim);
    } else {
      this.transition("chase");
      this.pathToward(target);
    }
    this.syncCastState();
  }

  // On death, release the same cloud as a parting gift (see deathTick to run it).
  protected override onDeath(): void {
    this.caster.interrupt();
    this.caster.begin(this.cloud, this.selfAim);
  }

  // Keep the death cloud ticking while the corpse lingers (GameRoom skips the
  // normal AI tick for a dying enemy).
  override deathTick(dtMs: number): void {
    this.caster.tickClock(dtMs);
    if (this.caster.busy) this.caster.update(this, dtMs, this.selfAim);
    this.syncCastState();
  }
}
