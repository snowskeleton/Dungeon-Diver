import {
  TILE_PROPS, TileId, TILE_SIZE, FOOT_OFFSET, TILE_DAMAGE_INTERVAL_MS, InteractionProfile, Attack,
  KNOCKBACK_SCALE, KNOCKBACK_MIN_FRACTION, KNOCKBACK_STUN_MS_PER_UNIT, KNOCKBACK_STUN_MAX_MS, SERVER_TICK_MS,
  HurtBounds, PLAYER_HURT_BOUNDS, Elevation, elevationAt,
} from "shared";
import { EntityState } from "../schema/EntityState";
import { HitSource } from "../combat/HitSource";
import type { SpawnProjectile, SpawnOpts, EnemyClass } from "./Enemy";
import type { AttackStats } from "../spells/Spell";
import { PhysicsWorld, PhysicsBody, syncStateFromBody } from "../physics/PhysicsWorld";

// A damage effect an entity produced during its tick, drained by GameRoom into the
// combat resolver / projectile pool. A boss channel, a player's swing, and a
// ranged shot all queue these; GameRoom stamps team + owner at drain time.
export type PendingEffect =
  | { kind: "hit"; source: HitSource }
  | { kind: "projectile"; ammoId: string; x: number; y: number; angle: number; opts?: SpawnOpts }
  // A boss ability spawning a minion enemy (the Tengu's Mirror Split). GameRoom
  // drains it into a real enemy in the caster's room. Boss-only in practice.
  | { kind: "summon"; enemy: EnemyClass; x: number; y: number };

// Knockback velocity is multiplied by this each tick; applyKnockback solves the
// resulting geometric series backwards to hit an exact total push distance.
export const KNOCKBACK_DECAY = 0.5;
const KNOCKBACK_CUTOFF = 5; // px/sec — below this, snap to zero

export abstract class Entity {
  abstract state: EntityState;

  body!: PhysicsBody;
  protected physics!: PhysicsWorld;
  protected timeSinceLastDamage: number = 0;

  // Per-tick movement intent in px/sec; consumed by commitVelocity().
  private moveVel = { x: 0, y: 0 };
  // Decaying knockback velocity in px/sec; persists across ticks.
  private knockbackVel = { x: 0, y: 0 };
  // Remaining hitstun (ms). While > 0 the entity suspends its own control
  // (enemy AI / player input) so the knockback push isn't immediately walked off.
  protected stunMs = 0;
  // One-shot: set the tick a knockback push lands (staggering OR a sub-threshold
  // nudge), cleared by consumeKnockback(). A casting enemy reads it to cancel a
  // wind-up on ANY shove — a stagger already interrupts via stun, but a light hit
  // that only nudges should still break the swing. Independent of stun so it fires
  // even under the stun-immunity window.
  private knockedBack = false;
  // Damage effects queued this tick (swing/channel hitboxes, projectile spawns),
  // drained by GameRoom. This is the `emitHitSource`/`spawnProjectile` half of the
  // spell Caster interface — shared so players and enemies emit effects the same way.
  private pendingEffects: PendingEffect[] = [];

  protected attachBody(
    physics: PhysicsWorld,
    x: number,
    y: number,
    profile: InteractionProfile,
  ): void {
    this.physics = physics;
    this.body = physics.createEntityBody(x, y, profile.layer, profile.solidMask);
  }

  // Records diagonal-normalized movement intent. Walls and entity separation
  // are resolved by the physics step, not here.
  move(dx: number, dy: number, speed: number): void {
    if (dx === 0 && dy === 0) return;
    const len = Math.hypot(dx, dy);
    const v = speed * this.state.speedMultiplier;
    this.moveVel.x = (dx / len) * v;
    this.moveVel.y = (dy / len) * v;
  }

  addKnockback(vx: number, vy: number): void {
    this.knockbackVel.x = vx;
    this.knockbackVel.y = vy;
  }

  /** Set this tick's movement intent to a RAW px/sec vector along (dirX, dirY),
   *  bypassing speedMultiplier — used by dash/charge/vault abilities that travel a
   *  fixed, committed distance regardless of the mud they cross. Physics still
   *  resolves it against walls, so the move stops at a wall like any other. */
  driveAlong(dirX: number, dirY: number, pxPerSec: number): void {
    const len = Math.hypot(dirX, dirY);
    if (len === 0) return;
    this.moveVel.x = (dirX / len) * pxPerSec;
    this.moveVel.y = (dirY / len) * pxPerSec;
  }

  /** Set the airborne height (px above the ground plane). Drives the elevation
   *  band and the client's sprite lift. A Vault arcs this up and back down. */
  setAirHeight(px: number): void {
    if (this.state.airHeight !== px) this.state.airHeight = px;
  }

  /** Sprite-centre landing point of a teleport that starts at this body's FEET and
   *  travels up to `dist` px along (dirX, dirY), stopping at the furthest point
   *  still walkable (and before any locked barrier) — so a Blink can cross a bar or
   *  gap but never lands inside a wall or beyond a shut door. Returns the current
   *  position unchanged when the very first step is blocked (nowhere to go). */
  protected sweepBlinkTarget(dirX: number, dirY: number, dist: number): { x: number; y: number } {
    const len = Math.hypot(dirX, dirY);
    if (len === 0) return { x: this.state.x, y: this.state.y };
    const ux = dirX / len;
    const uy = dirY / len;
    const cx = this.footX;
    const cy = this.footY;
    // Sample in ≤half-tile steps so no wall can hide between two samples.
    const steps = Math.max(1, Math.ceil(dist / (TILE_SIZE / 2)));
    let bestFootX = cx;
    let bestFootY = cy;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * dist;
      const px = cx + ux * t;
      const py = cy + uy * t;
      if (this.spawnBlockedAt(px, py)) break;
      bestFootX = px;
      bestFootY = py;
    }
    // Convert the foot landing back to a sprite-centre position (teleport takes
    // sprite-centre coords; the feet sit FOOT_OFFSET below the centre).
    return { x: bestFootX, y: bestFootY - FOOT_OFFSET };
  }

  // Called once per tick by GameRoom, just before the engine step.
  commitVelocity(): void {
    this.physics.setVelocityPxPerSec(
      this.body,
      this.moveVel.x + this.knockbackVel.x,
      this.moveVel.y + this.knockbackVel.y,
    );
    this.moveVel.x = 0;
    this.moveVel.y = 0;
    this.knockbackVel.x *= KNOCKBACK_DECAY;
    this.knockbackVel.y *= KNOCKBACK_DECAY;
    if (Math.hypot(this.knockbackVel.x, this.knockbackVel.y) < KNOCKBACK_CUTOFF) {
      this.knockbackVel.x = 0;
      this.knockbackVel.y = 0;
    }
  }

  // Called once per tick by GameRoom, just after the engine step.
  syncFromBody(): void {
    syncStateFromBody(this.state, this.body);
  }

  // ── Effect emission (the Caster half shared by players + enemies) ────────────
  /** Queue a transient hit region for this tick (a swing / channel hitbox). */
  emitHitSource(source: HitSource): void {
    this.pendingEffects.push({ kind: "hit", source });
  }

  /** Queue a projectile to spawn this tick. GameRoom stamps team + owner on drain.
   *  The requested spawn point is a muzzle offset AHEAD of the caster (so the
   *  projectile's swept-ellipse tail clears the shooter's own body). Flush against
   *  a wall, that muzzle point can land inside a blocked tile and the projectile
   *  dies on its first sample — the "can't fire against a wall" bug. So we clamp
   *  the spawn back toward the caster's FEET to the furthest still-walkable point,
   *  letting a point-blank shot spawn just in front of (or at) the caster instead. */
  spawnProjectile: SpawnProjectile = (ammoId, x, y, angle, opts) => {
    const spawn = this.clampSpawnToWalkable(x, y);
    this.pendingEffects.push({
      kind: "projectile",
      ammoId,
      x: spawn.x,
      y: spawn.y,
      angle,
      opts,
    });
  };

  /** Walk from the caster's FEET toward (mx, my) and return the furthest point that
   *  is still walkable (the same wall + barrier test the Projectile uses, so a spawn
   *  we accept can't die on its first sample).
   *
   *  The anchor is the feet, NOT the sprite centre, and that distinction is the
   *  whole fix: `state.x/y` is the sprite centre, which sits FOOT_OFFSET(8) above
   *  the collision body while the body's radius is only ENTITY_RADIUS(5). Pressed
   *  against a NORTH wall the physics keeps the feet 5px clear but leaves the sprite
   *  centre ~3px INSIDE the wall tile — so a shot fired PARALLEL to that wall gets a
   *  muzzle at centre-height that is inside the wall, and anchoring the search at
   *  the centre can't recover because the centre is blocked too. The feet are the
   *  one point the physics guarantees is walkable, so they're the valid origin. */
  private clampSpawnToWalkable(mx: number, my: number): { x: number; y: number } {
    const cx = this.footX;
    const cy = this.footY;
    if (!this.spawnBlockedAt(mx, my)) return { x: mx, y: my };

    const dx = mx - cx;
    const dy = my - cy;
    const dist = Math.hypot(dx, dy);
    // Sample in ≤half-tile steps so no wall can hide between two samples.
    const steps = Math.max(1, Math.ceil(dist / (TILE_SIZE / 2)));
    let best = { x: cx, y: cy };
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = cx + dx * t;
      const py = cy + dy * t;
      if (this.spawnBlockedAt(px, py)) break;
      best = { x: px, y: py };
    }
    return best;
  }

  /** A point a projectile born here would immediately die on: off-map, a
   *  non-walkable tile, or a locked-door barrier. Mirrors Projectile.checkWalls. */
  private spawnBlockedAt(x: number, y: number): boolean {
    const tile = this.physics.tileAt(x, y);
    if (tile === null || !TILE_PROPS[tile].walkable) return true;
    return this.physics.barrierAt(x, y);
  }

  /** Queue a minion enemy to spawn this tick (a boss summon). GameRoom places it
   *  in the caster's room. Protected so only a Boss (via SummonCaster) exposes it. */
  protected emitSummon(enemy: EnemyClass, x: number, y: number): void {
    this.pendingEffects.push({ kind: "summon", enemy, x, y });
  }

  /** Hand this tick's queued effects to GameRoom and clear the buffer. */
  drainEffects(): PendingEffect[] {
    if (this.pendingEffects.length === 0) return this.pendingEffects;
    const out = this.pendingEffects;
    this.pendingEffects = [];
    return out;
  }

  teleport(x: number, y: number): void {
    this.physics.setEntityPosition(this.body, x, y);
    this.state.x = x;
    this.state.y = y;
    this.moveVel.x = 0;
    this.moveVel.y = 0;
    this.knockbackVel.x = 0;
    this.knockbackVel.y = 0;
  }

  applyTileEffects(dtMs: number): void {
    // Airborne: not touching the floor, so tile hazards (fire, slow mud) don't
    // apply — a Vaulting player leaps over fire, a flyer cruises above it. Keep
    // the speed multiplier neutral while up there.
    if (this.airborne) {
      this.state.speedMultiplier = 1;
      this.timeSinceLastDamage = 0;
      return;
    }
    const tile = this.tileAt(this.state.x, this.state.y);
    if (tile === null) return;
    const props = TILE_PROPS[tile];

    if (props.effect === "slow") {
      this.state.speedMultiplier = props.speedMultiplier ?? 0.35;
    } else {
      this.state.speedMultiplier = 1;
    }

    if (props.effect === "damage") {
      this.timeSinceLastDamage += dtMs;
      if (this.timeSinceLastDamage >= TILE_DAMAGE_INTERVAL_MS) {
        this.timeSinceLastDamage = 0;
        // effectAmount is HP per second; deal one interval's worth per trigger.
        this.takeDamage((props.effectAmount ?? 0) * (TILE_DAMAGE_INTERVAL_MS / 1000));
      }
    } else {
      this.timeSinceLastDamage = 0;
    }
  }

  /** Applies `amount` and returns how much HP was ACTUALLY removed — less than
   *  asked for when the hit overkills, which is what a lifesteal or damage-dealt
   *  readout wants to hear. */
  takeDamage(amount: number): number {
    const before = this.state.health;
    this.state.health = Math.max(0, this.state.health - amount);
    return before - this.state.health;
  }

  // ── CombatTarget: how a hit lands on this body (see combat/CombatSystem) ──────
  // Receive a resolved hit: take the damage, then get shoved + stunned away from
  // the blow's origin. Symmetric — players and enemies both flinch (the Attack's
  // knockback may be 0, e.g. plain contact, in which case there's no push).
  //
  // Returns the damage actually dealt. This is stage 4 of the attack pipeline and
  // the seam where mitigation belongs: a Player subtracts armor here, and per-enemy
  // damage-type vulnerabilities will land here too. Because the applied number is
  // returned rather than assumed, anything downstream (lifesteal) stays honest when
  // a target mitigates or is overkilled.
  takeHit(attack: Attack): number {
    const dealt = this.takeDamage(attack.damage);
    this.applyKnockback(attack.sourceX, attack.sourceY, attack.knockback);
    return dealt;
  }

  // ── Attack pipeline, stage 3: the caster's own offensive scaling ─────────────
  // The identity lives here so EVERY caster satisfies the interface for free and
  // enemies/bosses keep emitting exactly the numbers their spells computed. Only
  // Player overrides scaleAttack (to fold its upgrades); buildAttack is shared and
  // never needs overriding, since positioning a blow is the same for everyone.
  scaleAttack(base: AttackStats): AttackStats {
    return base;
  }

  buildAttack(base: AttackStats, sourceX: number, sourceY: number): Attack {
    const scaled = this.scaleAttack(base);
    return {
      damage: scaled.damage,
      knockback: scaled.knockback,
      sourceX,
      sourceY,
    };
  }

  /** How much knockback force this body absorbs before it's shoved. 0 = takes the
   *  full hit (players default). Enemies override with a per-type resistance. */
  protected get knockbackResistance(): number {
    return 0;
  }

  get isStunned(): boolean {
    return this.stunMs > 0;
  }

  // Push + stun away from (fromX, fromY). `overage = force − resistance` is how
  // much the hit cleared this body's resistance: overage ≤ 0 → fully shrugged off
  // (no push, no stun). Above the threshold, push distance = overage ×
  // KNOCKBACK_SCALE px (delivered as a decaying impulse the physics step sweeps
  // against walls) and the body is stunned for a scaled duration. A corpse/dead
  // body is never shoved.
  applyKnockback(fromX: number, fromY: number, force: number): void {
    if (this.isDead) return;
    const overage = force - this.knockbackResistance;
    // Clearing resistance is what STAGGERS (push + stun). Falling short still
    // nudges — see KNOCKBACK_MIN_FRACTION — so no weapon reads as doing nothing.
    // A zero-force source (bows/staves carry force on the ammo, not the weapon)
    // still does nothing at all, which is correct.
    const staggers = overage > 0;
    const effective = staggers ? overage : force * KNOCKBACK_MIN_FRACTION;
    if (effective <= 0) return;

    const dx = this.state.x - fromX;
    const dy = this.state.y - fromY;
    if (dx === 0 && dy === 0) return;

    // Snap the push to a single cardinal axis — the one nearest the true
    // source→target direction — rather than shoving at an arbitrary diagonal.
    // A diagonal knock slides an enemy sideways out of the shooter's line of
    // fire, which reads as evasive; a pure up/down/left/right push keeps them on
    // axis so a held stream of shots keeps connecting. Ties (perfect diagonal)
    // fall to the horizontal.
    const ux = Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0;
    const uy = ux === 0 ? Math.sign(dy) : 0;

    const push = effective * KNOCKBACK_SCALE;
    // Geometric series: total displacement = v0*dt / (1 − decay) = push.
    const v0 = (push * (1 - KNOCKBACK_DECAY)) / (SERVER_TICK_MS / 1000);
    this.addKnockback(ux * v0, uy * v0);
    this.knockedBack = true;

    // Stun resilience (playtest B7). While the immunity window is open the body
    // still gets shoved — knockback feel is preserved — but its control tick is
    // NOT interrupted. Without this, a fast enough stream of hits re-stuns on
    // every impact and the target never acts again: the tester killed a boss
    // from range that way, and it only fought back when they stopped shooting.
    // Default is 0, so ordinary enemies and players are untouched.
    if (!staggers || this.stunImmuneMs > 0) return;

    this.stunMs = Math.min(KNOCKBACK_STUN_MAX_MS, overage * KNOCKBACK_STUN_MS_PER_UNIT);
    this.state.stunned = true;
  }

  /** Returns whether a knockback push landed since the last call, and clears the
   *  flag. A casting enemy uses it to interrupt a wind-up on any shove (see
   *  CastingEnemy.interruptOnHit). Consumed once per tick by whoever cares. */
  consumeKnockback(): boolean {
    const v = this.knockedBack;
    this.knockedBack = false;
    return v;
  }

  /** How long after a hitstun ends this body cannot be stunned again. 0 (the
   *  default) means every qualifying hit stuns, which is right for rank-and-file
   *  enemies — a boss overrides it so it always gets a window to act. */
  protected get stunImmunityMs(): number { return 0; }

  private stunImmuneMs = 0;

  // Advances the hitstun timer. Returns true while still stunned — callers skip
  // the rest of their control tick so the knockback impulse (carried by
  // commitVelocity) lands cleanly. Shared by enemy AI and player input.
  updateStun(dtMs: number): boolean {
    if (this.stunImmuneMs > 0) this.stunImmuneMs -= dtMs;

    if (this.stunMs > 0) {
      this.stunMs -= dtMs;
      if (this.stunMs <= 0) {
        this.stunMs = 0;
        this.state.stunned = false;
        // Opens the moment the stun ends, so the window is time to ACT rather
        // than time that elapsed while helpless.
        this.stunImmuneMs = this.stunImmunityMs;
      }
      return true;
    }
    return false;
  }

  /** The region this body can be DAMAGED on — the drawn sprite's extent, not the
   *  physics body's. Walking bounds and hurt bounds are deliberately separate
   *  questions: ENTITY_RADIUS is a 5px circle at the feet that decides what you
   *  bump into, while this is the whole visible creature.
   *
   *  Both concrete subclasses override with numbers MEASURED FROM THEIR ART
   *  (Player → PLAYER_HURT_BOUNDS, Enemy → ENEMY_HURT_BOUNDS[type]); the humanoid
   *  box is the default so a future Entity subclass is never a bare point. */
  get hurtBounds(): HurtBounds {
    return PLAYER_HURT_BOUNDS;
  }

  /** False once dead so a corpse takes no further hits. Enemies override to gate
   *  on their death animation (isDying) rather than raw health. */
  get damageable(): boolean {
    return !this.isDead;
  }

  /** True while above the airborne threshold — used to gate tile hazards and to
   *  pick the elevation band below. Reads the synced airHeight so it tracks a
   *  swoop / vault in flight. */
  get airborne(): boolean {
    return this.elevation === Elevation.AIR;
  }

  /** The Elevation band (GROUND / AIR) this body occupies, from its airHeight.
   *  The combat resolver reaches a target only if the source's `reaches` mask
   *  includes this band (see CombatSystem / shared/combat/elevation). */
  get elevation(): number {
    return elevationAt(this.state.airHeight);
  }

  /** Sprite-centre world position (the schema x/y). Convenience for combat/spell
   *  code that shouldn't reach through `.state`. */
  get x(): number {
    return this.state.x;
  }
  get y(): number {
    return this.state.y;
  }

  /** The collision/walkability anchor: the sprite's FEET, FOOT_OFFSET below the
   *  centre. Ask for this instead of open-coding `state.y + FOOT_OFFSET` — the
   *  feet are the one point physics guarantees is walkable, so any wall/spawn/nav
   *  test should be against them, not the sprite centre (which can sit inside a
   *  wall tile when pressed against it). Mirrors PhysicsWorld's spriteToBody. */
  get footX(): number {
    return this.state.x;
  }
  get footY(): number {
    return this.state.y + FOOT_OFFSET;
  }

  get isDead(): boolean {
    return this.state.health <= 0;
  }

  private tileAt(x: number, y: number): TileId | null {
    return this.physics.tileAt(x, y);
  }
}
