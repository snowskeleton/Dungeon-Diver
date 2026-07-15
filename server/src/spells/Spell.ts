import { Facing } from "shared";
import { HitSource } from "../combat/HitSource";
import { SpawnProjectile } from "../entities/Enemy";

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
// Entity — an effect buffer). Everything that used to live here as boss-shaped
// hooks was removed by inverting the dependency: the SpellCaster no longer pushes
// telegraph/channel/knockback state INTO the entity — it just owns its phase, and
// the entity READS that phase to drive its own animation/immunity (see Boss.tick).
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
}

// A caster that can charge across the room. Movement + wall-bounce is the mover's
// job (physics layer), not the effect's: the effect asks for one dash step and is
// handed back the possibly-reflected heading, so it never queries walls itself.
// Only bosses implement this (they self-move a static body); dash spells cast to
// it. Keeps the base Caster free of movement/collision concerns.
export interface DashCaster extends Caster {
  dashStep(dirX: number, dirY: number, pxPerSec: number): { dirX: number; dirY: number; bounces: number };
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
// This single shape replaces the old execute-XOR-channel split.
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
  readonly activeMs: number;
  readonly recoverMs: number;
  readonly cooldownMs: number;
  readonly range: number;
  readonly aimLockMs: number;
  readonly knockbackImmuneWhileActive: boolean;
  readonly fireMode: "press" | "hold";
  private readonly effect: SpellEffect;
  private readonly canHitFn?: (caster: Caster, target: TargetInfo) => boolean;
  // Caster clock time (ms) of the last cast; -Infinity = never cast → ready.
  private lastCastAt = -Infinity;

  constructor(opts: SpellOpts) {
    this.id = opts.id;
    this.windUpMs = opts.windUpMs;
    this.activeMs = opts.activeMs;
    this.recoverMs = opts.recoverMs;
    this.cooldownMs = opts.cooldownMs;
    this.range = opts.range;
    this.aimLockMs = opts.aimLockMs;
    this.knockbackImmuneWhileActive = opts.knockbackImmuneWhileActive ?? false;
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
