import { TILE_PROPS, TileId, Facing, FOOT_OFFSET, ENTITY_RADIUS, SERVER_TICK_MS, ENEMY_ATTACK_AFFECTS } from "shared";
import { Enemy, EnemyClass } from "./Enemy";
import { PlayerState } from "../schema/PlayerState";
import { Spell, SpellCaster, DashCaster, SummonCaster, AimPoint } from "../spells";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { MovementBehavior, approachAbility } from "./bosses/movement";

// Base class for the 8 bosses. Bosses deal no passive contact damage — every hit
// comes from a telegraphed Spell, so a perfect player can dodge everything
// (docs/bosses.md). A boss is a Caster: it hands its spells to a shared
// SpellCaster that runs the wind-up → strike → recovery beat, and it decides
// (here) WHICH spell to cast — the highest-priority one that's off cooldown, in
// range, and able to hit — repositioning via a movement behaviour otherwise.
//
// Subclasses override `abilities()` (their Spell list), optionally `movement()`
// and `phaseKey()` (HP-gated phase switches). Spell instances persist per phase
// (built once, cached) so each spell's cooldown state survives; everything else —
// the cast lifecycle, aim-lock, range-keeping — lives in Boss/SpellCaster.
export abstract class Boss extends Enemy implements DashCaster, SummonCaster {
  private readonly spellCaster = new SpellCaster();
  // Enforced lull after each attack (see globalCooldownMs): while > 0 the boss
  // repositions but starts no new spell, so the fight breathes.
  private restTimer = 0;
  // Persistent per-phase spell lists / movers, so spell cooldown state survives.
  private readonly movesetByPhase = new Map<string, Spell[]>();
  private readonly moverByPhase = new Map<string, MovementBehavior>();
  // While true, applyKnockback is ignored. Derived each tick from the SpellCaster
  // (true during a knockback-immune spell's active phase) — the boss owns the flag
  // rather than the SpellCaster pushing it.
  private knockbackImmune = false;
  // While true the boss takes no damage — derived each tick from the SpellCaster
  // (an invulnerable spell's active phase, e.g. the Tengu's stone flight). Gates
  // `damageable` so the combat resolver skips it entirely.
  private invulnerable = false;
  // Pixel rectangle the boss is confined to (its room). Because the body is
  // static and moves by setPosition, it would otherwise teleport straight
  // through doorways and the FloorManager's barrier bodies (the tile map only
  // has walls). All movement clamps/ricochets off this. Unset = unconfined.
  private arenaMinX = -Infinity;
  private arenaMinY = -Infinity;
  private arenaMaxX = Infinity;
  private arenaMaxY = Infinity;
  /** Distance the boss tries to keep from its target while repositioning. */
  protected preferredRange = 180;

  // Boss-scaled placeholder stats: a big HP pool, wide aggro so it commits the
  // moment you enter, and enough knockback resistance to shrug off light hits.
  // A well-tuned boss overrides these; attack damage/cooldown are unused (bosses
  // deal no passive contact damage — every hit is a telegraphed spell).
  protected get maxHp(): number { return 600; }
  protected get speed(): number { return 55; }
  protected get aggroRadius(): number { return 400; }
  protected get attackRadius(): number { return 26; }
  protected get knockbackResistance(): number { return 12; }

  constructor(physics: PhysicsWorld, x: number, y: number) {
    super(physics, x, y);
    // Boss bodies are STATIC: the matter solver never displaces a static body,
    // so a player who walks into one is shoved out instead of pushing it
    // (docs/bosses.md's "light shove"). High mass alone doesn't hold — matter's
    // Verlet integrator drifts even a 1e12-mass body under sustained contact.
    // The boss moves ITSELF by setEntityPosition (walk/rush), which still sweeps
    // players aside; the cost is that knockback no longer physically shoves the
    // boss (but a hit still STUNS it, cancelling a wind-up — the mechanic that
    // matters). See PhysicsWorld.setBodyStatic.
    this.physics.setBodyStatic(this.body, true);
  }

  /** A mandatory rest (ms) after every attack finishes recovering, before the
   *  boss may start another — the global cooldown that keeps it from chaining
   *  moves back-to-back. Per-spell `cooldownMs` gates each move individually;
   *  this gates the boss as a whole. Default 0 (no rest); subclasses raise it. */
  protected get globalCooldownMs(): number {
    return 0;
  }

  /** The boss's moveset, highest priority first. Subclasses override. Re-read per
   *  phase (see phaseKey) so an enrage can hand back a different list. */
  protected abstract abilities(): Spell[];

  /** How the boss repositions between attacks. Defaults to the smart range-keeper
   *  that closes to whatever spell it wants to use next. Subclasses override with
   *  any behaviour from ./bosses/movement. */
  protected movement(): MovementBehavior {
    return approachAbility();
  }

  /** A key identifying the current combat phase. When it changes the boss uses a
   *  different (persistent) moveset — the hook for HP-threshold enrages. Crossing
   *  a phase gives that phase's spells fresh cooldowns (they're distinct objects);
   *  since HP only falls, this is a one-way base → enrage step. Default = one phase. */
  protected phaseKey(): string {
    return "base";
  }

  // Built once per phase (not in the constructor) so subclass field initializers —
  // preferredRange and anything abilities() reads — run first, and so each spell's
  // cooldown state persists across ticks.
  private get moveset(): Spell[] {
    const key = this.phaseKey();
    let m = this.movesetByPhase.get(key);
    if (!m) { m = this.abilities(); this.movesetByPhase.set(key, m); }
    return m;
  }
  private get mover(): MovementBehavior {
    const key = this.phaseKey();
    let m = this.moverByPhase.get(key);
    if (!m) { m = this.movement(); this.moverByPhase.set(key, m); }
    return m;
  }

  /** Fraction of max HP remaining (1 → 0). Subclasses use it in phaseKey(). */
  protected get hpFraction(): number {
    return this.state.health / this.maxHp;
  }

  /** The distance a boss holds when it has no specific spell to set up. */
  get idealRange(): number {
    return this.preferredRange;
  }

  // ── Caster / DashCaster interface ────────────────────────────────────────────
  // x / y come from Entity; emitHitSource / spawnProjectile come from Entity.
  get attackAffects(): number {
    return ENEMY_ATTACK_AFFECTS;
  }
  get facing(): Facing {
    return this.state.facing as Facing;
  }

  /** One dash step: advance along (dirX, dirY), reflecting off any wall/arena edge
   *  hit this step. Collision + reflection are the mover's job here, so the dash
   *  spell never queries walls — it just carries the heading we hand back. */
  dashStep(dirX: number, dirY: number, pxPerSec: number): { dirX: number; dirY: number; bounces: number } {
    // Look a little ahead so we turn before the (static-body) mover clamps us.
    const look = ENTITY_RADIUS + 8;
    let bounces = 0;
    if (dirX !== 0 && this.isBoundaryAt(this.state.x + dirX * look, this.state.y)) { dirX = -dirX; bounces++; }
    if (dirY !== 0 && this.isBoundaryAt(this.state.x, this.state.y + dirY * look)) { dirY = -dirY; bounces++; }
    this.moveAtSpeed(dirX, dirY, pxPerSec);
    return { dirX, dirY, bounces };
  }

  // ── Self-movement (static body) ──────────────────────────────────────────────
  /** Move at the boss's base speed in a world direction (need not be normalized).
   *  speedScale lets a behaviour crawl (0.5) or hustle (1). Used by movement
   *  behaviours. Position-based (the body is static) — see moveAtSpeed. */
  walk(dx: number, dy: number, speedScale = 1): void {
    this.moveAtSpeed(dx, dy, this.speed * speedScale);
  }

  /** Move at an explicit px/sec — dashes rush far faster than base speed. */
  rush(dx: number, dy: number, pxPerSec: number): void {
    this.moveAtSpeed(dx, dy, pxPerSec);
  }

  // Advance the static body one tick's worth of travel along (dx, dy). Because
  // the body is static, movement is a wall-clamped setPosition, not a velocity —
  // matter still shoves any player the boss sweeps into.
  private moveAtSpeed(dx: number, dy: number, pxPerSec: number): void {
    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const dist = pxPerSec * (SERVER_TICK_MS / 1000);
    this.stepBy((dx / len) * dist, (dy / len) * dist);
  }

  // Reposition by a px delta, clamped per-axis so the boss never crosses a wall
  // or its arena edge (it slides along one instead of stopping dead on a diagonal).
  private stepBy(px: number, py: number): void {
    let nx = this.state.x;
    let ny = this.state.y;
    if (px !== 0 && !this.isBoundaryAt(this.state.x + px + Math.sign(px) * ENTITY_RADIUS, this.state.y)) {
      nx = this.state.x + px;
    }
    if (py !== 0 && !this.isBoundaryAt(nx, this.state.y + py + Math.sign(py) * ENTITY_RADIUS)) {
      ny = this.state.y + py;
    }
    if (nx === this.state.x && ny === this.state.y) return;
    this.physics.setEntityPosition(this.body, nx, ny);
    this.state.x = nx;
    this.state.y = ny;
  }

  /** True if (x, y) in world px lands on a non-walkable (wall) tile — used by
   *  dash spells to ricochet off walls without fighting the matter solver. */
  isWallAt(x: number, y: number): boolean {
    const tile = this.physics.tileAt(x, y);
    return tile === null || !TILE_PROPS[tile as TileId].walkable;
  }

  /** Confine the boss to a pixel rectangle (its room) — see arenaMin/Max. */
  setArena(minX: number, minY: number, maxX: number, maxY: number): void {
    this.arenaMinX = minX;
    this.arenaMinY = minY;
    this.arenaMaxX = maxX;
    this.arenaMaxY = maxY;
  }

  /** True if the sprite-centre point (cx, cy) is blocked — a wall tile (probed at
   *  the foot) or outside the arena. Dash ricochets and slow movement both
   *  reflect/clamp on this so the boss can't leave its room through a doorway. */
  isBoundaryAt(cx: number, cy: number): boolean {
    if (cx < this.arenaMinX || cx > this.arenaMaxX || cy < this.arenaMinY || cy > this.arenaMaxY) {
      return true;
    }
    return this.isWallAt(cx, cy + FOOT_OFFSET);
  }

  // Bosses deal NO passive contact damage — every hit is a telegraphed spell
  // (docs/bosses.md), so a player can body-check a boss safely. Opt out of the
  // base enemy's contact hitbox.
  override contactHitSource(): null {
    return null;
  }

  override applyKnockback(fromX: number, fromY: number, force: number): void {
    if (this.knockbackImmune) return;
    super.applyKnockback(fromX, fromY, force);
  }

  // Invulnerable during an invulnerable spell's active phase (stone flight): the
  // resolver checks damageable and skips the hit, and this guards any other source
  // (tile damage) too.
  override get damageable(): boolean {
    return super.damageable && !this.invulnerable;
  }
  override takeDamage(amount: number): void {
    if (this.invulnerable) return;
    super.takeDamage(amount);
  }

  // SummonCaster: a summon spell (Mirror Split) buffers a minion into the effect
  // queue GameRoom drains, which places it in this boss's room.
  summon(enemy: EnemyClass, x: number, y: number): void {
    this.emitSummon(enemy, x, y);
  }

  // The boss AI: advance any in-flight cast, or pick the next spell / reposition.
  // The wind-up/strike/recover beat itself lives in the shared SpellCaster; the
  // boss just mirrors that cast state onto its schema (telegraph/channel flags +
  // knockback immunity) each tick, reading the phase rather than being pushed it.
  override tick(players: Map<string, PlayerState>, dtMs: number): void {
    // Hold the cruising altitude (0 for grounded bosses); a flying boss's dive
    // spell overrides it during think() below. See Enemy.applyFlightBaseline.
    this.applyFlightBaseline();
    if (this.state.isDying) return;
    this.spellCaster.tickClock(dtMs);
    this.think(players, dtMs);
    this.syncCastState();
  }

  private think(players: Map<string, PlayerState>, dtMs: number): void {
    // A knockback stun interrupts a wind-up — a well-timed hit cancels a
    // telegraphed attack. Channels are knockback-immune, so they aren't hit here.
    if (this.updateStun(dtMs)) {
      this.spellCaster.interrupt();
      return;
    }

    if (this.restTimer > 0) this.restTimer = Math.max(0, this.restTimer - dtMs);

    const closest = this.closestPlayer(players);
    if (!closest) {
      this.spellCaster.interrupt();
      this.transition("patrol");
      this.state.targetId = "";
      return;
    }

    const target = { id: closest.id, dist: closest.dist, dx: closest.dx, dy: closest.dy };
    // The boss aims at the current target position; the SpellCaster freezes it
    // aimLockMs before the strike.
    const aim: AimPoint = { x: this.state.x + target.dx, y: this.state.y + target.dy };
    this.updateFacing(target.dx, target.dy);
    this.state.targetId = target.id;

    // Mid-cast: advance it. When it fully finishes recovering, take the global
    // rest before the boss may act again.
    if (this.spellCaster.busy) {
      const finished = this.spellCaster.update(this, dtMs, aim);
      if (finished) this.restTimer = this.globalCooldownMs;
      this.transition("attack");
      return;
    }

    // Resting between attacks: reposition but start nothing new.
    if (this.restTimer > 0) {
      this.mover({ boss: this, target, players, dtMs, intended: undefined });
      this.transition(target.dist <= this.aggroRadius ? "chase" : "patrol");
      return;
    }

    // Cast the highest-priority spell that's off cooldown, in range, and (if it
    // gates on it) actually able to hit; otherwise let movement set up the one it
    // wants next.
    const now = this.spellCaster.now;
    const ready = this.moveset.find(
      (s) => target.dist <= s.range && s.isReady(now) && s.canHit(this, target),
    );
    if (ready) {
      this.spellCaster.begin(ready, aim);
      this.transition("attack");
      return;
    }
    const intended = this.moveset.find((s) => s.isReady(now));
    this.mover({ boss: this, target, players, dtMs, intended });
    this.transition(target.dist <= this.aggroRadius ? "chase" : "patrol");
  }

  // Mirror the SpellCaster's phase onto the schema (drives the client's tell /
  // action animation) and onto our own knockback immunity. Telegraph and channel
  // are just "which phase of the move we're in" — derived, not pushed.
  private syncCastState(): void {
    const phase = this.spellCaster.phase;
    this.state.telegraph = phase === "windup";
    this.state.channeling = phase === "active";
    this.state.abilityId = this.spellCaster.activeSpellId;
    this.knockbackImmune = this.spellCaster.knockbackImmuneActive;
    this.invulnerable = this.spellCaster.invulnerableActive;
  }
}
