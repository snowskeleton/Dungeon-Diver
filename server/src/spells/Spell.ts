import { Facing, Attack } from "shared";
import { HitSource } from "../combat/HitSource";
import type { SpawnProjectile, EnemyClass } from "../entities/Enemy";

// Stage 2 of the attack pipeline: the raw offensive numbers a weapon/ammo produces,
// BEFORE the caster's own scaling is folded in. Kept as its own type so the future
// damage-type axis (slashing/fire/blunt) has an obvious home — adding a field here
// reaches every attack in the game without touching a single spell builder.
export interface AttackStats {
  damage: number;
  knockback: number;
}

// A world-space point a cast has aimed at (the locked target position).
export interface AimPoint {
  x: number;
  y: number;
}

// The current target a caster is aiming at, relative to the caster.
export interface TargetInfo {
  id: string;
  dist: number;
  dx: number; // target.x − caster.x
  dy: number; // target.y − caster.y
}

// The minimal surface a Spell needs from whoever casts it — its pose, which team
// it hurts, and the two ways it produces effects. Deliberately tiny so a player
// implements it with ZERO no-ops (it already has a position, a facing, and — via
// Entity — an effect buffer). Note the direction of the dependency: the SpellCaster
// never pushes telegraph/channel/knockback state INTO the entity — it owns its
// phase, and the entity READS that phase to drive its animation/immunity (Boss.tick).
export interface Caster {
  readonly x: number;
  readonly y: number;
  /** Which way the caster is posed — melee spells build a facing-relative hurtbox. */
  readonly facing: Facing;
  /** Which Layer(s) this caster's spells damage (its team's attack mask). */
  readonly attackAffects: number;

  /** Register a transient hit region for this tick (swing / channel hitboxes). */
  emitHitSource(source: HitSource): void;
  /** Fire a projectile / inert visual marker (shots, tremor shards). */
  spawnProjectile: SpawnProjectile;

  /**
   * Fold this caster's own offensive scaling into a set of raw weapon/ammo stats.
   * `Entity` implements the identity (pass the numbers straight through), so
   * enemies and bosses are unaffected; `Player` overrides THIS ONE METHOD to apply
   * its upgrades. It returns stats rather than a finished Attack because a
   * projectile needs the scaled numbers now but its blow's origin only later, at
   * the moment of impact.
   */
  scaleAttack(base: AttackStats): AttackStats;

  /**
   * scaleAttack + an origin, giving the finished Attack a hitbox delivers. Spell
   * builders call this instead of hand-constructing an Attack, which is what lets a
   * modifier reach every ability without any builder knowing modifiers exist.
   */
  buildAttack(base: AttackStats, sourceX: number, sourceY: number): Attack;

  /**
   * Called with the damage actually dealt, once a hit lands. Optional because only
   * a Player currently cares (lifesteal); enemies leave it undefined.
   */
  onDamageDealt?(damage: number): void;
}

// A caster that can charge across the room. Movement + wall-bounce is the mover's
// job (physics layer), not the effect's: the effect asks for one dash step and is
// handed back the possibly-reflected heading, so it never queries walls itself.
// Only bosses implement this (they self-move a static body); dash spells cast to
// it. Keeps the base Caster free of movement/collision concerns.
export interface DashCaster extends Caster {
  dashStep(dirX: number, dirY: number, pxPerSec: number): { dirX: number; dirY: number; bounces: number };
}

// A caster that can conjure minions — a boss whose ability spawns adds (the
// Tengu's Mirror Split). Only bosses implement it (they buffer the summon into the
// effect queue GameRoom drains); the summon spell casts to this narrower surface.
export interface SummonCaster extends Caster {
  /** Spawn one minion of `enemy` at (x, y) in the caster's room. */
  summon(enemy: EnemyClass, x: number, y: number): void;
}

// A caster that can dive: on top of dashStep (horizontal movement) it drives its
// own airborne height. Any Enemy already has setAirHeight; a flying boss also has
// dashStep, so it satisfies this. The swoop effect lowers the height to the floor
// and back over its active phase (the caster's cruising altitude is a spell param).
export interface FlightCaster extends DashCaster {
  /** Set the current airborne height in px (0 = grounded, claws at the floor). */
  setAirHeight(px: number): void;
}

// The effect a spell produces over its lifecycle. `onActivate` fires once on the
// strike frame — for an INSTANT spell (activeMs 0) it IS the whole effect (a
// volley spawns its projectiles here); for a CHANNEL it sets up the active phase
// (compute a dash heading, reset a RehitGate). `onActiveTick` runs each tick of
// the active phase (emit hitboxes, move the body); return true to end early.
export interface SpellEffect {
  onActivate?(caster: Caster, aim: AimPoint): void;
  onActiveTick?(caster: Caster, dtMs: number, aim: AimPoint): boolean | void;
  onDeactivate?(caster: Caster): void;
}

export interface SpellOpts {
  id: string;
  /** Telegraph time before the strike (0 = no wind-up, e.g. a player swing). */
  windUpMs: number;
  /** Length of the active phase (0 = instant strike, no channel). */
  activeMs: number;
  /** Committed/vulnerable recovery after the effect — the punish window. */
  recoverMs: number;
  /** How long before the spell may be cast again. Owned here, not by the caster. */
  cooldownMs: number;
  /** How close the target must be for the caster to choose this spell. */
  range: number;
  /** How long before the strike the aim freezes (dodge window); 0 = aim at fire. */
  aimLockMs: number;
  /** Ignore knockback for the whole active phase (a spin can't be shoved off). */
  knockbackImmuneWhileActive?: boolean;
  /** Take no damage for the whole active phase — the caster reads this to gate its
   *  `damageable` (the Tengu is untouchable stone while airborne mid-Stone Crash). */
  invulnerableWhileActive?: boolean;
  /** How a holder (a player) triggers this: "press" fires once per key press,
   *  "hold" auto-fires while held. Ignored by AI casters (bosses). Default press. */
  fireMode?: "press" | "hold";
  /** Optional gate beyond `range`: only cast when this returns true for the target
   *  (fixed-pattern moves use it so they don't fire into a safe gap). */
  canHit?: (caster: Caster, target: TargetInfo) => boolean;
  effect: SpellEffect;
}

// A castable ability — a boss move, an enemy attack, a player's weapon swing or
// spell (see docs/bosses.md, docs/loadout.md). One shape for all of them: a
// wind-up → strike → (optional channel) → recover beat, driven by a shared
// SpellCaster. Crucially the spell OWNS its recast cooldown (isReady/markCast) —
// nothing external tracks it. Spell instances persist for the caster's lifetime
// so that cooldown state survives; the effect is a plain object it delegates to.
export class Spell {
  readonly id: string;
  readonly windUpMs: number;
  readonly recoverMs: number;
  readonly range: number;
  // activeMs/cooldownMs are getters rather than fields so a subclass can derive
  // them from live state. A weapon's swing window IS its attack cooldown, and that
  // is modifiable per weapon instance (an attack-speed roll) — baking it in at
  // construction would freeze the pre-modifier value forever, since spells are
  // cached for the caster's lifetime. SpellCaster reads them once per cast when it
  // enters a phase, so a mid-swing change can't retime a swing already in flight.
  protected readonly baseActiveMs: number;
  protected readonly baseCooldownMs: number;

  get activeMs(): number { return this.baseActiveMs; }
  get cooldownMs(): number { return this.baseCooldownMs; }
  readonly aimLockMs: number;
  readonly knockbackImmuneWhileActive: boolean;
  readonly invulnerableWhileActive: boolean;
  readonly fireMode: "press" | "hold";
  private readonly effect: SpellEffect;
  private readonly canHitFn?: (caster: Caster, target: TargetInfo) => boolean;
  // Caster clock time (ms) of the last cast; -Infinity = never cast → ready.
  private lastCastAt = -Infinity;

  constructor(opts: SpellOpts) {
    this.id = opts.id;
    this.windUpMs = opts.windUpMs;
    this.baseActiveMs = opts.activeMs;
    this.recoverMs = opts.recoverMs;
    this.baseCooldownMs = opts.cooldownMs;
    this.range = opts.range;
    this.aimLockMs = opts.aimLockMs;
    this.knockbackImmuneWhileActive = opts.knockbackImmuneWhileActive ?? false;
    this.invulnerableWhileActive = opts.invulnerableWhileActive ?? false;
    this.fireMode = opts.fireMode ?? "press";
    this.effect = opts.effect;
    this.canHitFn = opts.canHit;
  }

  /** Off cooldown at caster-clock time `now`? */
  isReady(now: number): boolean {
    return now - this.lastCastAt >= this.cooldownMs;
  }

  /** Remaining cooldown (ms) at `now` — for anyone that wants to display it. */
  cooldownRemaining(now: number): number {
    return Math.max(0, this.cooldownMs - (now - this.lastCastAt));
  }

  /** Start the cooldown running (called when the effect finishes). */
  markCast(now: number): void {
    this.lastCastAt = now;
  }

  /** Extra targeting gate beyond range (default: always allowed). */
  canHit(caster: Caster, target: TargetInfo): boolean {
    return !this.canHitFn || this.canHitFn(caster, target);
  }

  // ── Effect lifecycle (driven by SpellCaster) ────────────────────────────────
  activate(caster: Caster, aim: AimPoint): void {
    this.effect.onActivate?.(caster, aim);
  }
  /** Returns true when the active phase should end early. */
  activeTick(caster: Caster, dtMs: number, aim: AimPoint): boolean {
    return this.effect.onActiveTick?.(caster, dtMs, aim) === true;
  }
  deactivate(caster: Caster): void {
    this.effect.onDeactivate?.(caster);
  }
}
