import { AiState, SERVER_TICK_MS, EnemyType, EnemyFacingMode, ENEMY_BODY_PROFILE, AIRBORNE_ENEMY_BODY_PROFILE, ENEMY_ATTACK_AFFECTS , ENEMY_HURT_BOUNDS, PLAYER_HURT_BOUNDS, HurtBounds, ENEMY_SPAWN_EMERGE_MS, TILE_SIZE, Elevation, ELEVATION_ALL } from "shared";
import { EnemyState } from "../schema/EnemyState";
import { PlayerState } from "../schema/PlayerState";
import { Entity } from "./Entity";
import { HitSource } from "../combat/HitSource";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import type { AttackStats } from "../spells/Spell";

/** The interior box an enemy is confined to — see Enemy.confineTo. */
export type RoomBounds = { xMin: number; xMax: number; yMin: number; yMax: number };

/** What an enemy needs from the flow-field pathfinder to navigate its room. The
 *  interface (rather than importing FlowFieldSystem directly) keeps Enemy testable
 *  with a hand-rolled navigator, and mirrors how bosses take injected behaviours. */
export interface EnemyNavigator {
  /** Downhill tile-delta toward `sessionId`, or null (no field / already adjacent). */
  sample(
    kind: "ground" | "air",
    roomId: string,
    sessionId: string,
    x: number,
    y: number,
  ): { dx: number; dy: number } | null;
  /** Is the straight line to (x1,y1) unobstructed for `kind`? */
  lineOfSight(kind: "ground" | "air", roomId: string, x0: number, y0: number, x1: number, y1: number): boolean;
}

const PATROL_RANGE = 64;

// ── Aggro tuning ──────────────────────────────────────────────────────────────
// A player's pull on an enemy blends proximity with accumulated recent-damage
// THREAT. Score = PROX_WEIGHT·(1 − dist/aggroRadius) + THREAT_WEIGHT·threat. The
// proximity term is in [0,1]; THREAT_WEIGHT is small so it takes a real chunk of
// damage to pull an enemy off a much closer player — but focus-fire eventually
// wins. With zero threat everywhere this is exactly "chase the nearest player".
const AGGRO_PROX_WEIGHT = 1;
const AGGRO_THREAT_WEIGHT = 0.02;
// Threat is a leaky bucket: it halves every THREAT_HALF_LIFE_MS, so a player who
// stops dealing damage loses the enemy's attention over a few seconds.
const THREAT_HALF_LIFE_MS = 3000;
// Below this the decayed threat is dropped from the table (housekeeping).
const THREAT_EPSILON = 0.5;

/** Per-spawn overrides for a projectile a boss emits. `lifetimeMs` lets a timed
 *  ground hazard (tremor shards) clear a whole staggered batch on one tick.
 *  `inert` makes the projectile a pure visual/telegraph marker — it renders and
 *  expires but never hit-tests, because the ability's channel owns a single
 *  consolidated hitbox instead of one per marker (the Turtle Dragon's tremor). */
export interface SpawnOpts {
  lifetimeMs?: number;
  inert?: boolean;
  /** Pre-resolved attack payload overriding the ammo's own damage/knockback. A
   *  projectile has no link back to the weapon that fired it or the player who
   *  drew it, so any per-wielder scaling has to be computed at the muzzle and ride
   *  along on the shot. Omitted (enemy shots) = the ammo's own numbers. */
  attack?: AttackStats;
}

/** Lets an enemy emit a projectile during its tick (bosses' ranged attacks).
 *  The owner id is the enemy's own map key; `affects` is stamped by GameRoom. */
export type SpawnProjectile = (
  ammoId: string,
  x: number,
  y: number,
  angleRad: number,
  opts?: SpawnOpts,
) => void;

/** A concrete enemy class: `new`-able and carrying its `EnemyType` id statically,
 *  so the spawn lists in entities/enemies can be plain arrays of classes that the
 *  compiler still checks — no id→class lookup table. */
export type EnemyClass = { new (physics: PhysicsWorld, x: number, y: number): Enemy; readonly type: EnemyType };

// Base class for every enemy. Behaviour lives here and in subclasses — never in a
// data blob steered by a lookup table (see the engineering-approach note in
// CLAUDE.md). The default tick is the standard chase-and-melee AI; a subclass
// that wants something else (a boss's telegraphed moveset) overrides tick().
//
// Stats are plain getters with functional placeholder defaults: a brand-new
// enemy is a working chaser out of the box, and tuning it — or giving it a
// distinct stat — is a one-line getter override, all compiler-checked. Bosses
// and specific enemies override what they need.
export abstract class Enemy extends Entity {
  state: EnemyState;
  // Set true the first tick after isDying so GameRoom runs the room-clear check
  // once per death.
  clearCheckDone = false;
  // Deferred spawning: an enemy minted by the floor pass starts UNSPAWNED — it is
  // constructed, confined, and registered with FloorManager (so its room locks and
  // is never pre-cleared), but it is not in the synced state, does not tick, deals
  // no contact damage, and cannot be hit. It reveals — with a puff of smoke on the
  // client — the first time a player walks into its home room (SpawnDirector.spawnRoom).
  // Defaults to TRUE so an enemy built directly against a bare PhysicsWorld (unit
  // tests) or summoned mid-fight is active immediately, no FloorManager required.
  private _spawned = true;
  // Counts down while the enemy is EMERGING — revealed and visible in its dust puff
  // but not yet acting. reveal() sets it; GameRoom holds the enemy still and off its
  // AI until it hits 0, and contactHitSource stays silent meanwhile. A summon or a
  // test-built enemy (both revealed via the _spawned default, never reveal()) leaves
  // this at 0, so it acts immediately — matching how they skip the deferred pass.
  private emergeRemainingMs = 0;
  protected patrolOriginX: number;
  protected patrolOriginY: number;
  private patrolAngle: number = Math.random() * Math.PI * 2;
  private attackCooldown: number = 0;

  // ── Stats (override per enemy) ──────────────────────────────────────────────
  protected get maxHp(): number { return 60; }
  protected get speed(): number { return 50; }
  protected get aggroRadius(): number { return 360; }
  // Center-to-center; must exceed 2×ENTITY_RADIUS (10px) or attacks never land.
  protected get attackRadius(): number { return 14; }
  protected get attackDamage(): number { return 10; }
  protected get attackCooldownMs(): number { return 1200; }
  /** 0 = full knockback; higher absorbs more force. */
  protected get knockbackResistance(): number { return 3; }
  /** This enemy's share of the floor's gold budget, relative to its peers. The
   *  SpawnDirector sums every spawned enemy's weight and hands each a slice of the
   *  budget in proportion — so gold is never priced per-enemy here, and enemy or
   *  room counts can change without re-tuning any payout. A tougher enemy (or a
   *  boss) overrides this higher. */
  get goldWeight(): number { return 1; }
  /** "horizontal" art has one side view (flipX for left); "directional" has a
   *  row per facing. Must match the client visual def for this enemy. */
  protected get facingMode(): EnemyFacingMode { return "horizontal"; }
  /** Airborne cruising height in px above the ground plane; 0 = grounded (default).
   *  Any flyer — a bat, a floater, or a flying boss — overrides this. The base tick
   *  keeps state.airHeight here every tick (a dive spell overrides it during its
   *  active phase); the client lifts the sprite by it and draws a shadow beneath.
   *  The collision body stays at the ground point, so height is purely visual. */
  protected get cruiseHeight(): number { return 0; }

  /** Which Elevation band(s) this enemy's attacks reach. A grounded enemy hits
   *  only the GROUND band, so a Vaulting player (AIR) sails over its touch and
   *  ground slams; a flyer (cruiseHeight > 0) reaches BOTH bands, so it still
   *  catches an airborne player. GameRoom stamps this onto the enemy's drained
   *  hit sources; contactHitSource sets it directly. */
  get elevationReach(): number {
    return this.cruiseHeight > 0 ? ELEVATION_ALL : Elevation.GROUND;
  }

  /** This enemy's id, read from the concrete subclass's `static readonly type`. */
  protected get typeId(): EnemyType {
    return (this.constructor as unknown as { type: EnemyType }).type;
  }

  constructor(physics: PhysicsWorld, startX: number, startY: number) {
    super();
    this.state = new EnemyState();
    this.state.x = startX;
    this.state.y = startY;
    this.state.health = this.maxHp;
    this.state.maxHealth = this.maxHp;
    this.state.enemyType = this.typeId;
    // Mirrored into state so the client's debug overlay can draw the true ranges
    // without a second copy of the numbers.
    this.state.aggroRadius = this.aggroRadius;
    this.state.attackRadius = this.attackRadius;
    this.patrolOriginX = startX;
    this.patrolOriginY = startY;
    // A flyer (cruiseHeight > 0) uses the airborne body profile so it collides
    // with structural walls but flies OVER interior cover blocks. cruiseHeight is
    // a constant getter, so it's safe to read here during construction.
    this.attachBody(
      physics,
      startX,
      startY,
      this.cruiseHeight > 0 ? AIRBORNE_ENEMY_BODY_PROFILE : ENEMY_BODY_PROFILE,
    );
  }

  get isDying(): boolean {
    return this.state.isDying;
  }

  /** Gold this enemy drops on death, assigned once at spawn by SpawnDirector out
   *  of the floor budget (see goldWeight). 0 for anything spawned outside the
   *  budgeted floor pass — a boss summon, or a test-built enemy — which simply
   *  drops nothing. */
  goldValue = 0;

  /** Whether this enemy has been revealed (see the _spawned note). GameRoom skips
   *  the AI and contact-damage passes for an unspawned enemy, and it is not a
   *  combat target (damageable is false), so it sits inert in its sealed room. */
  get spawned(): boolean {
    return this._spawned;
  }

  /** Mark this enemy as unspawned — called by SpawnDirector for the deferred floor
   *  pass, right after construction and before it is handed out. */
  markUnspawned(): void {
    this._spawned = false;
  }

  /** Reveal this enemy. SpawnDirector calls it when a player first enters the home
   *  room, then adds the enemy to the synced state so the client shows it (with a
   *  smoke puff on the state add). The enemy then EMERGES over ENEMY_SPAWN_EMERGE_MS
   *  — visible in the puff but stationary and harmless — before it starts acting.
   *  Idempotent on _spawned, but only the first reveal arms the emerge timer. */
  reveal(): void {
    if (this._spawned) return;
    this._spawned = true;
    this.emergeRemainingMs = ENEMY_SPAWN_EMERGE_MS;
  }

  /** True while the enemy is still rising out of its spawn puff. GameRoom holds it
   *  in place and skips its AI + contact damage until this clears — see advanceEmerge. */
  get emerging(): boolean {
    return this.emergeRemainingMs > 0;
  }

  /** Tick the emerge timer down. GameRoom calls this (instead of the AI tick) each
   *  tick the enemy is still emerging, so the hold works even for bosses and other
   *  subclasses that override tick(). Keeps a flyer at its cruise height meanwhile. */
  advanceEmerge(dtMs: number): void {
    this.emergeRemainingMs -= dtMs;
    this.applyFlightBaseline();
  }

  /** Scale this enemy's health pool by a multiplier decided at spawn time (party-
   *  size scaling — see SpawnDirector). Applied to BOTH max and current HP right
   *  after construction, while current === max, so the enemy simply spawns tougher.
   *  Rounded to a whole HP. A multiplier of 1 (solo, or any test that builds an
   *  enemy directly rather than through SpawnDirector) is an exact no-op. */
  scaleMaxHp(multiplier: number): void {
    if (multiplier === 1) return;
    const scaled = Math.round(this.maxHp * multiplier);
    this.state.maxHealth = scaled;
    this.state.health = scaled;
  }

  /** Confine this enemy to its home room's interior (playtest B6/B14). Set by
   *  SpawnDirector from the room it spawned in; unset for anything spawned
   *  outside a room, and unset for an enemy built directly against a
   *  PhysicsWorld — which is why such an enemy wanders freely. */
  confineTo(rect: RoomBounds): void {
    this.homeBounds = rect;
  }

  private homeBounds: RoomBounds | null = null;

  /** Safety net against being knocked clean out of the world. move() clips walking
   *  intent at the interior edge, but knockback is (deliberately) NOT clipped — a
   *  hard enough hit can shove an enemy through a wall into the void between rooms,
   *  where the flow field can't pull it back and no player can reach it, softlocking
   *  the floor (you can never clear the room). So each tick we hard-clamp any enemy
   *  that has ended up past its home room's OUTER extent back to that edge. The
   *  extent is the interior box grown by one tile, so a knockback can still blast a
   *  creature into the wall ring / a doorway (the intended combat feel) — it just
   *  can't leave the room entirely. */
  private containToHome(): void {
    const b = this.homeBounds;
    if (!b) return;
    const m = TILE_SIZE;
    const x = Math.min(Math.max(this.state.x, b.xMin - m), b.xMax + m);
    const y = Math.min(Math.max(this.state.y, b.yMin - m), b.yMax + m);
    if (x !== this.state.x || y !== this.state.y) this.teleport(x, y);
  }

  // ── Navigation + aggro ──────────────────────────────────────────────────────
  // The flow-field navigator and this enemy's home room id, both set by
  // SpawnDirector alongside confineTo. Null for an enemy built directly against a
  // PhysicsWorld (unit tests) or spawned outside a room — such an enemy simply
  // beelines, which is why the bare-world tests still pass.
  private nav: EnemyNavigator | null = null;
  private homeRoomId: string | null = null;
  // Per-player accumulated threat (recent damage this enemy took from each), the
  // aggro system's memory. Decays every tick — see decayThreat.
  private threat = new Map<string, number>();

  /** Wire this enemy to the floor's flow-field pathfinder and record which room's
   *  field it should read. Called at the SpawnDirector.addEnemy choke point. */
  setNavigation(nav: EnemyNavigator, roomId: string): void {
    this.nav = nav;
    this.homeRoomId = roomId;
  }

  /** Record damage this enemy took from a player, raising that player's threat.
   *  Fed from the combat resolver's HitEvents (GameRoom), so any source — melee,
   *  projectile, AOE — contributes; pickTarget() reads the result. */
  registerThreat(sessionId: string, damage: number): void {
    if (damage <= 0) return;
    this.threat.set(sessionId, (this.threat.get(sessionId) ?? 0) + damage);
  }

  /** Leak every player's threat toward zero (half-life THREAT_HALF_LIFE_MS) so a
   *  player who stops attacking gradually loses this enemy's attention. */
  private decayThreat(dtMs: number): void {
    if (this.threat.size === 0) return;
    const factor = Math.pow(0.5, dtMs / THREAT_HALF_LIFE_MS);
    for (const [id, v] of this.threat) {
      const next = v * factor;
      if (next < THREAT_EPSILON) this.threat.delete(id);
      else this.threat.set(id, next);
    }
  }

  /** Movement intent is clipped at the room edge so a wandering or chasing enemy
   *  can't leave. Per-axis so an enemy sliding along the boundary still slides
   *  rather than sticking. Knockback is deliberately NOT clipped — being blasted
   *  into a doorway is combat feel, and the enemy walks itself back in. */
  move(dx: number, dy: number, speed: number): void {
    const b = this.homeBounds;
    if (b) {
      if (dx < 0 && this.state.x <= b.xMin) dx = 0;
      if (dx > 0 && this.state.x >= b.xMax) dx = 0;
      if (dy < 0 && this.state.y <= b.yMin) dy = 0;
      if (dy > 0 && this.state.y >= b.yMax) dy = 0;
    }
    super.move(dx, dy, speed);
  }

  /** Set the airborne height (px) the client renders the sprite at. Public so a
   *  dive spell (see FlightCaster) can drive it during a swoop. Guarded so a
   *  steady hover doesn't re-flag the schema field every tick. */
  setAirHeight(px: number): void {
    if (this.state.airHeight !== px) this.state.airHeight = px;
  }

  /** Re-assert the cruising altitude each tick — 0 when dying, so a flyer falls to
   *  the ground for its death animation. Called at the top of tick() before the AI
   *  runs, so a dive spell's active phase can override it for the same tick. */
  protected applyFlightBaseline(): void {
    this.setAirHeight(this.state.isDying ? 0 : this.cruiseHeight);
  }

  /** Measured from this enemy's own spritesheet — see the generator. No enemy
   *  declares a hurt size by hand; adding one to the EnemyType union without art
   *  is a compile error in the generated table. */
  override get hurtBounds(): HurtBounds {
    return ENEMY_HURT_BOUNDS[this.typeId];
  }

  /** A dying enemy plays its death animation but takes no further hits; an
   *  unspawned one isn't in the world yet, so it can't be hit either. */
  override get damageable(): boolean {
    return !this.state.isDying && this._spawned;
  }

  // A contact/touch attack: while alive, un-stunned, and off cooldown, the enemy's
  // body is a hazard out to attackRadius. Emitted each tick to the combat resolver
  // (see GameRoom.tick); the claim consumes the shared attack cooldown so one
  // eruption lands on exactly one player per cooldown. Bosses deal no passive
  // contact damage and override this to null.
  contactHitSource(id: string): HitSource | null {
    if (this.emerging || this.state.isDying || this.state.stunned || this.attackCooldown > 0 || this.attackDamage <= 0) {
      return null;
    }
    let claimed = false;
    return {
      // `attackRadius` is CENTER-TO-CENTER reach (see the getter), but the
      // resolver now tests against the target's measured hurt BOX rather than a
      // bare centre point. Subtracting the player's half-width here keeps
      // the effective reach exactly attackRadius, so giving creatures real hurt
      // bounds did not silently hand every enemy 10px of extra grab range. Floors
      // at 0: a contact circle of r=0 still lands the moment the player's drawn
      // sprite overlaps the enemy's centre.
      shape: {
        kind: "circle",
        cx: this.state.x,
        cy: this.state.y,
        r: Math.max(0, this.attackRadius - PLAYER_HURT_BOUNDS.halfW),
      },
      affects: ENEMY_ATTACK_AFFECTS,
      reaches: this.elevationReach,
      ownerId: id,
      // Contact deals no knockback to players — only telegraphed attacks shove.
      attack: { damage: this.attackDamage, knockback: 0, sourceX: this.state.x, sourceY: this.state.y },
      claim: () => {
        if (claimed) return false;
        claimed = true;
        this.attackCooldown = this.attackCooldownMs;
        return true;
      },
    };
  }

  // Returns damage actually dealt; a corpse absorbs nothing, so hitting one
  // reports 0 and can't feed lifesteal.
  takeDamage(amount: number): number {
    if (this.state.isDying) return 0;
    const dealt = super.takeDamage(amount);
    if (this.state.health <= 0) {
      this.state.isDying = true;
      // Corpse must not block (or be shoved by) other entities while it
      // plays its 5s death animation; it still respects walls.
      this.physics.setEntityDead(this.body);
    }
    return dealt;
  }

  // Standard enemy AI: patrol until a player is in aggro range, chase, and melee
  // in attack range. Bosses override this entirely. This drives only movement and
  // the attack animation — the damage itself is emitted as a HitSource
  // (contactHitSource) and applied by the combat resolver.
  tick(players: Map<string, PlayerState>, dtMs: number): void {
    this.applyFlightBaseline();
    this.containToHome();
    if (this.state.isDying) return;
    if (this.updateStun(dtMs)) return;

    if (this.attackCooldown > 0) this.attackCooldown -= dtMs;
    this.decayThreat(dtMs);

    // Aggro-weighted target selection is separate from HOW we reach it: pickTarget
    // chooses whom to chase (proximity + threat), pathToward navigates there.
    const target = this.pickTarget(players);
    if (!target) {
      this.transition("patrol");
      this.state.targetId = "";
      this.patrol(dtMs);
      return;
    }

    if (target.dist <= this.attackRadius) {
      this.transition("attack");
      this.state.targetId = target.id;
    } else {
      this.transition("chase");
      this.state.targetId = target.id;
      this.pathToward(target);
    }
  }

  /** The player this enemy should go after: the highest aggro score among players
   *  within aggroRadius, or null (none in range → patrol). Score blends proximity
   *  with accumulated threat (see the aggro tuning constants), so it reduces to
   *  "nearest player" until someone builds threat by dealing damage. */
  protected pickTarget(
    players: Map<string, PlayerState>,
  ): { id: string; dist: number; dx: number; dy: number } | null {
    let best: { id: string; dist: number; dx: number; dy: number } | null = null;
    let bestScore = -Infinity;
    players.forEach((p, id) => {
      const dx = p.x - this.state.x;
      const dy = p.y - this.state.y;
      const dist = Math.hypot(dx, dy);
      if (dist > this.aggroRadius) return;
      const prox = 1 - dist / this.aggroRadius;
      const score = AGGRO_PROX_WEIGHT * prox + AGGRO_THREAT_WEIGHT * (this.threat.get(id) ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = { id, dist, dx, dy };
      }
    });
    return best;
  }

  /** Move toward the chosen target, routing around obstacles. With a clear line of
   *  sight we beeline (precise tracking of a moving player); when a wall or cover
   *  block is in the way we follow the flow-field gradient around it. Without a
   *  navigator (test-built enemy) it's always a beeline. */
  protected pathToward(target: { id: string; dx: number; dy: number }): void {
    const kind = this.cruiseHeight > 0 ? "air" : "ground";
    if (this.nav && this.homeRoomId) {
      // Navigate the COLLISION body, which sits at the feet (FOOT_OFFSET below the
      // sprite centre) — that's what actually squeezes past a wall. Sampling on the
      // sprite centre would send an enemy through a gap its feet don't fit through
      // (a 1-tile corridor is a foot-tall slit once the offset is applied).
      const fx = this.footX;
      const fy = this.footY;
      const tx = this.footX + target.dx;
      const ty = this.footY + target.dy;
      if (!this.nav.lineOfSight(kind, this.homeRoomId, fx, fy, tx, ty)) {
        const heading = this.nav.sample(kind, this.homeRoomId, target.id, fx, fy);
        if (heading) {
          this.chase(heading.dx, heading.dy);
          return;
        }
      }
    }
    this.chase(target.dx, target.dy);
  }

  // Reusable movement helpers subclasses (e.g. bosses) can call.
  protected chase(dx: number, dy: number): void {
    this.move(dx, dy, this.speed);
    this.updateFacing(dx, dy);
  }

  protected patrol(dtMs: number): void {
    this.patrolAngle += 0.4 * (dtMs / 1000);
    const tx = this.patrolOriginX + Math.cos(this.patrolAngle) * PATROL_RANGE;
    const ty = this.patrolOriginY + Math.sin(this.patrolAngle) * PATROL_RANGE;
    const dx = tx - this.state.x;
    const dy = ty - this.state.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    // Clamp so one tick's step never overshoots the orbit target; unclamped
    // velocity would oscillate around it.
    const speed = Math.min(this.speed * 0.5, dist / (SERVER_TICK_MS / 1000));
    this.move(dx, dy, speed);
    this.updateFacing(dx, dy);
  }

  protected closestPlayer(
    players: Map<string, PlayerState>,
  ): { id: string; dist: number; dx: number; dy: number } | null {
    let best: { id: string; dist: number; dx: number; dy: number } | null = null;
    players.forEach((p, id) => {
      const dx = p.x - this.state.x;
      const dy = p.y - this.state.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!best || dist < best.dist) best = { id, dist, dx, dy };
    });
    return best;
  }

  protected transition(next: AiState): void {
    this.state.aiState = next;
  }

  // Directional art has a row per facing, so track all four. Horizontal art only
  // has a side view, so never face up/down (the client would have no frame).
  protected updateFacing(dx: number, dy: number): void {
    if (this.facingMode === "directional") {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.state.facing = dx > 0 ? "right" : "left";
      } else if (dy !== 0) {
        this.state.facing = dy > 0 ? "down" : "up";
      }
    } else if (dx !== 0) {
      this.state.facing = dx > 0 ? "right" : "left";
    }
  }
}
