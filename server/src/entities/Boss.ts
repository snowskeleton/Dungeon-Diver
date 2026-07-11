import { Enemy, SpawnProjectile } from "./Enemy";
import { PlayerState } from "../schema/PlayerState";

// A boss's attack. Every move follows the same wind-up → strike → recovery beat
// (see docs/bosses.md): the boss telegraphs for `windUpMs` (client draws the
// tell), fires on the strike frame via `execute`, then is committed/vulnerable
// for `recoverMs` — the player's punish window — before the move goes on
// `cooldownMs`. `range` gates when the boss will even consider the ability.
export interface BossAbility {
  id: string;
  cooldownMs: number;
  windUpMs: number;
  recoverMs: number;
  range: number;
  /** How long before the strike the aim freezes. The boss tracks the player for
   *  the first (windUpMs − aimLockMs), then locks the aim point — the final
   *  aimLockMs is the player's window to step out of the line. 0 aims at the
   *  player's exact position at the moment of firing (no dodge window). */
  aimLockMs: number;
  /** Fired once, on the strike frame, at the locked aim point. */
  execute(boss: Boss, aim: AimPoint, spawn: SpawnProjectile): void;
}

/** A world-space point a boss has locked its aim onto. */
export interface AimPoint {
  x: number;
  y: number;
}

export interface TargetInfo {
  id: string;
  dist: number;
  dx: number; // target.x − boss.x
  dy: number; // target.y − boss.y
}

type BossMode = "position" | "windup" | "recover";

// Base class for the 8 bosses. Bosses deal no passive contact damage — every hit
// comes from a telegraphed ability, so a perfect player can dodge everything
// (docs/bosses.md). Subclasses override `abilities()` (their moveset) and set
// `preferredRange` (the distance they try to hold); everything else — the
// wind-up/strike/recovery loop, cooldowns, range-keeping — lives here. Boss-scale
// stats default below; a subclass overrides any it wants to tune.
export abstract class Boss extends Enemy {
  private mode: BossMode = "position";
  private phaseTimer = 0;
  private activeAbility?: BossAbility;
  private cooldowns: Record<string, number> = {};
  private cachedAbilities?: BossAbility[];
  // The current wind-up's aim point (world coords) and whether it's frozen yet.
  // The boss tracks the player into these until the ability's aimLockMs, then
  // stops updating them so a moving player can leave the line of fire.
  private aimX = 0;
  private aimY = 0;
  private aimLocked = false;
  /** Distance the boss tries to keep from its target while repositioning. */
  protected preferredRange = 180;

  // Boss-scaled placeholder stats: a big HP pool, wide aggro so it commits the
  // moment you enter, and enough knockback resistance to shrug off light hits.
  // A well-tuned boss overrides these; damage/cooldown are unused (bosses deal
  // no passive contact damage — every hit is a telegraphed ability).
  protected get maxHp(): number { return 600; }
  protected get speed(): number { return 55; }
  protected get aggroRadius(): number { return 400; }
  protected get attackRadius(): number { return 26; }
  protected get knockbackResistance(): number { return 12; }

  /** The boss's moveset. Subclasses override this. */
  protected abstract abilities(): BossAbility[];

  // Built lazily (not in the constructor) so subclass field initializers —
  // preferredRange and anything abilities() reads — are set before it runs.
  private get moveset(): BossAbility[] {
    return (this.cachedAbilities ??= this.abilities());
  }

  override tick(
    players: Map<string, PlayerState>,
    dtMs: number,
    _dealDamageToPlayer: (sessionId: string, amount: number) => void,
    spawnProjectile?: SpawnProjectile,
  ): void {
    if (this.state.isDying) return;
    // A knockback stun interrupts whatever the boss was doing (including a
    // wind-up) — a well-timed hit can cancel a telegraphed attack.
    if (this.updateStun(dtMs)) {
      this.clearTelegraph();
      this.mode = "position";
      return;
    }

    for (const key of Object.keys(this.cooldowns)) {
      if (this.cooldowns[key] > 0) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dtMs);
    }

    const closest = this.closestPlayer(players);
    if (!closest) {
      this.clearTelegraph();
      this.mode = "position";
      this.transition("patrol");
      this.state.targetId = "";
      return;
    }

    const target: TargetInfo = { id: closest.id, dist: closest.dist, dx: closest.dx, dy: closest.dy };
    this.updateFacing(target.dx, target.dy);
    this.state.targetId = target.id;

    switch (this.mode) {
      case "windup":
        // Committed to the tell — stand still. Track the player into the aim
        // point until aimLockMs before the strike, then hold it so a moving
        // player can slip out of the line before it fires.
        this.phaseTimer -= dtMs;
        if (this.activeAbility) {
          if (!this.aimLocked) {
            this.aimX = this.state.x + target.dx;
            this.aimY = this.state.y + target.dy;
            if (this.phaseTimer <= this.activeAbility.aimLockMs) this.aimLocked = true;
          }
          if (this.phaseTimer <= 0) {
            this.activeAbility.execute(this, { x: this.aimX, y: this.aimY }, spawnProjectile ?? (() => {}));
            this.cooldowns[this.activeAbility.id] = this.activeAbility.cooldownMs;
            this.mode = "recover";
            this.phaseTimer = this.activeAbility.recoverMs;
            this.clearTelegraph();
          }
        }
        return;

      case "recover":
        // Vulnerable punish window — no movement, no new attack.
        this.phaseTimer -= dtMs;
        this.transition("attack");
        if (this.phaseTimer <= 0) {
          this.mode = "position";
          this.activeAbility = undefined;
        }
        return;

      case "position": {
        const ready = this.moveset.find(
          (a) => (this.cooldowns[a.id] ?? 0) <= 0 && target.dist <= a.range,
        );
        if (ready) {
          this.activeAbility = ready;
          this.mode = "windup";
          this.phaseTimer = ready.windUpMs;
          this.aimLocked = false;
          this.aimX = this.state.x + target.dx; // start tracking from current pos
          this.aimY = this.state.y + target.dy;
          this.state.telegraph = true;
          this.state.abilityId = ready.id;
          this.transition("attack");
          return;
        }
        this.maintainRange(target);
        this.transition(target.dist <= this.aggroRadius ? "chase" : "patrol");
      }
    }
  }

  private maintainRange(target: TargetInfo): void {
    const slack = 40;
    if (target.dist > this.preferredRange + slack) {
      this.move(target.dx, target.dy, this.speed); // approach
    } else if (target.dist < this.preferredRange - slack) {
      this.move(-target.dx, -target.dy, this.speed); // back off
    }
    // else within the comfortable band — hold and keep facing the target.
  }

  private clearTelegraph(): void {
    if (this.state.telegraph) this.state.telegraph = false;
    if (this.state.abilityId) this.state.abilityId = "";
  }
}

// ── Ability builder (shared by boss subclasses) ───────────────────────────────
// A volley fires `count` projectiles fanned across `spreadDeg`, centred on the
// locked aim point. count=1 is a single aimed shot; odd counts always put one
// shot dead-on (so standing still is punished). `aimLockMs` (default 0) sets how
// early the aim freezes during the wind-up — raise it to give a moving player
// room to dodge out of the line (see BossAbility.aimLockMs / docs/bosses.md).
// This one primitive expresses every projectile move so far (breath cones, orb
// sprays, single lances); richer signatures (dash, AOE, summon) get their own.
export function volley(o: {
  id: string; ammoId: string; count: number; spreadDeg: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number;
}): BossAbility {
  return {
    id: o.id, cooldownMs: o.cooldownMs, windUpMs: o.windUpMs, recoverMs: o.recoverMs, range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    execute: (boss, aim, spawn) => {
      const base = Math.atan2(aim.y - boss.state.y, aim.x - boss.state.x);
      const spread = (o.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < o.count; i++) {
        const off = o.count === 1 ? 0 : (i / (o.count - 1) - 0.5) * spread;
        spawn(o.ammoId, boss.state.x, boss.state.y, base + off);
      }
    },
  };
}
