import { TILE_PROPS, TileId, FOOT_OFFSET, ENTITY_RADIUS, SERVER_TICK_MS } from "shared";
import { Enemy, SpawnProjectile } from "./Enemy";
import { PlayerState } from "../schema/PlayerState";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { MovementBehavior, approachAbility } from "./bosses/movement";

// A boss's attack. Every move follows the same wind-up → strike → recovery beat
// (see docs/bosses.md): the boss telegraphs for `windUpMs` (client draws the
// tell), fires on the strike frame via `execute`, then is committed/vulnerable
// for `recoverMs` — the player's punish window — before the move goes on
// `cooldownMs`. `range` gates when the boss will even consider the ability.
//
// Most attacks are instantaneous strikes (`execute`). A `channel` turns the
// strike into an *extended* active phase (a dash, a beam) the boss runs for
// `channel.durationMs` before recovering — the boss body itself becomes the
// hazard. An ability has one or the other, never both.
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
  /** If set, the strike is an extended active phase (dash/beam) instead of a
   *  one-shot execute. `execute` is unused in that case. */
  channel?: BossChannel;
  /** Optional gate beyond `range`: the boss only starts the ability when this
   *  returns true for the current target. Fixed-pattern moves (radials) use it so
   *  they don't fire when the player sits in a safe gap the attack can't reach. */
  canHit?(boss: Boss, target: TargetInfo): boolean;
}

/** An extended active phase (dash, beam, spin) run every tick after the wind-up.
 *  The boss is mid-strike, not committed-and-still — it moves and can damage on
 *  contact. Reusable across bosses (spin, gallop, roll, thunder-dash). */
export interface BossChannel {
  /** Max length of the active phase; it also ends early if `update` returns true. */
  durationMs: number;
  /** True to ignore knockback for the duration (a spinning/charging boss can't
   *  be shoved off its line — the recover window is where it becomes vulnerable). */
  knockbackImmune?: boolean;
  /** Called once when the active phase begins, with the locked aim point. */
  start(boss: Boss, aim: AimPoint): void;
  /** Called every tick during the active phase. Return true to end it early. */
  update(boss: Boss, dtMs: number, ctx: ChannelContext): boolean | void;
  /** Called once when the active phase ends (timer or early-out), before recover. */
  end(boss: Boss): void;
}

export interface ChannelContext {
  players: Map<string, PlayerState>;
  dealDamageToPlayer: (sessionId: string, amount: number) => void;
  spawn: SpawnProjectile;
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

type BossMode = "position" | "windup" | "channel" | "recover";

// Base class for the 8 bosses. Bosses deal no passive contact damage — every hit
// comes from a telegraphed ability, so a perfect player can dodge everything
// (docs/bosses.md). Subclasses override `abilities()` (their moveset), optionally
// `movement()` (how they reposition between attacks) and `phaseKey()` (HP-gated
// phase switches); everything else — the wind-up/strike/recovery loop, cooldowns,
// channels, range-keeping — lives here. Boss-scale stats default below.
export abstract class Boss extends Enemy {
  private mode: BossMode = "position";
  private phaseTimer = 0;
  // Enforced lull after each attack (see globalCooldownMs): while > 0 the boss
  // repositions but starts no new ability, so the fight breathes.
  private restTimer = 0;
  private activeAbility?: BossAbility;
  private cooldowns: Record<string, number> = {};
  private cachedAbilities?: BossAbility[];
  private cachedMovement?: MovementBehavior;
  private lastPhaseKey = "";
  // The current wind-up's aim point (world coords) and whether it's frozen yet.
  // The boss tracks the player into these until the ability's aimLockMs, then
  // stops updating them so a moving player can leave the line of fire.
  private aimX = 0;
  private aimY = 0;
  private aimLocked = false;
  // While true, applyKnockback is ignored (set during a knockback-immune channel).
  private knockbackImmune = false;
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
  // A well-tuned boss overrides these; damage/cooldown are unused (bosses deal
  // no passive contact damage — every hit is a telegraphed ability).
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
   *  moves back-to-back. Per-ability `cooldownMs` gates each move individually;
   *  this gates the boss as a whole. Default 0 (no rest); subclasses raise it. */
  protected get globalCooldownMs(): number {
    return 0;
  }

  /** The boss's moveset. Subclasses override this. Re-read when the phase key
   *  changes (see phaseKey), so an enrage can hand back a different list. */
  protected abstract abilities(): BossAbility[];

  /** How the boss repositions between attacks. Defaults to the smart range-keeper
   *  that closes to whatever ability it wants to use next. Subclasses override
   *  with any behaviour from ./bosses/movement. */
  protected movement(): MovementBehavior {
    return approachAbility();
  }

  /** A key identifying the current combat phase. When it changes the moveset is
   *  rebuilt — the hook for HP-threshold enrages. Default = single phase. */
  protected phaseKey(): string {
    return "base";
  }

  // Built lazily (not in the constructor) so subclass field initializers —
  // preferredRange and anything abilities() reads — are set before it runs.
  private get moveset(): BossAbility[] {
    return (this.cachedAbilities ??= this.abilities());
  }
  private get mover(): MovementBehavior {
    return (this.cachedMovement ??= this.movement());
  }

  /** Fraction of max HP remaining (1 → 0). Subclasses use it in phaseKey(). */
  protected get hpFraction(): number {
    return this.state.health / this.maxHp;
  }

  /** The distance a boss holds when it has no specific ability to set up. */
  get idealRange(): number {
    return this.preferredRange;
  }

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
   *  dash channels to ricochet off walls without fighting the matter solver. */
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

  setKnockbackImmune(v: boolean): void {
    this.knockbackImmune = v;
  }

  override applyKnockback(fromX: number, fromY: number, force: number): void {
    if (this.knockbackImmune) return;
    super.applyKnockback(fromX, fromY, force);
  }

  override tick(
    players: Map<string, PlayerState>,
    dtMs: number,
    dealDamageToPlayer: (sessionId: string, amount: number) => void,
    spawnProjectile?: SpawnProjectile,
  ): void {
    if (this.state.isDying) return;
    // A knockback stun interrupts whatever the boss was doing (including a
    // wind-up) — a well-timed hit can cancel a telegraphed attack. A channel is
    // knockback-immune, so it can't be interrupted here.
    if (this.updateStun(dtMs)) {
      this.clearTelegraph();
      this.mode = "position";
      return;
    }

    for (const key of Object.keys(this.cooldowns)) {
      if (this.cooldowns[key] > 0) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dtMs);
    }
    if (this.restTimer > 0) this.restTimer = Math.max(0, this.restTimer - dtMs);

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
    const spawn = spawnProjectile ?? (() => {});

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
          if (this.phaseTimer <= 0) this.beginStrike(this.activeAbility, spawn);
        }
        return;

      case "channel": {
        // Extended active strike (dash/beam): the boss moves and hazards on
        // contact until the channel ends or its duration expires.
        this.phaseTimer -= dtMs;
        const ab = this.activeAbility;
        let done = false;
        if (ab?.channel) {
          done = ab.channel.update(this, dtMs, { players, dealDamageToPlayer, spawn }) === true;
        }
        if (done || this.phaseTimer <= 0) {
          ab?.channel?.end(this);
          this.setKnockbackImmune(false);
          this.state.channeling = false;
          if (ab) this.cooldowns[ab.id] = ab.cooldownMs;
          this.mode = "recover";
          this.phaseTimer = ab?.recoverMs ?? 0;
          this.clearTelegraph();
        }
        return;
      }

      case "recover":
        // Vulnerable punish window — no movement, no new attack.
        this.phaseTimer -= dtMs;
        this.transition("attack");
        if (this.phaseTimer <= 0) {
          this.mode = "position";
          this.activeAbility = undefined;
          this.restTimer = this.globalCooldownMs; // breathe before the next attack
        }
        return;

      case "position": {
        this.refreshPhase();
        // Resting between attacks: reposition but don't start anything new.
        if (this.restTimer > 0) {
          this.mover({ boss: this, target, players, dtMs, intended: undefined });
          this.transition(target.dist <= this.aggroRadius ? "chase" : "patrol");
          return;
        }
        // Fire the highest-priority ability that's off cooldown, in range, and
        // (if it gates on it) actually able to hit the target; otherwise let
        // movement set up the one it wants next.
        const offCooldown = this.moveset.filter((a) => (this.cooldowns[a.id] ?? 0) <= 0);
        const ready = offCooldown.find(
          (a) => target.dist <= a.range && (!a.canHit || a.canHit(this, target)),
        );
        if (ready) {
          this.startWindUp(ready, target);
          return;
        }
        this.mover({ boss: this, target, players, dtMs, intended: offCooldown[0] });
        this.transition(target.dist <= this.aggroRadius ? "chase" : "patrol");
      }
    }
  }

  // Enter the wind-up (telegraph) for an ability, starting the aim tracking.
  private startWindUp(ability: BossAbility, target: TargetInfo): void {
    this.activeAbility = ability;
    this.mode = "windup";
    this.phaseTimer = ability.windUpMs;
    this.aimLocked = false;
    this.aimX = this.state.x + target.dx; // start tracking from current pos
    this.aimY = this.state.y + target.dy;
    this.state.telegraph = true;
    this.state.abilityId = ability.id;
    this.transition("attack");
  }

  // Wind-up finished: either begin a channel (extended active phase) or fire the
  // instant strike, then go to recover.
  private beginStrike(ability: BossAbility, spawn: SpawnProjectile): void {
    const aim: AimPoint = { x: this.aimX, y: this.aimY };
    if (ability.channel) {
      this.mode = "channel";
      this.phaseTimer = ability.channel.durationMs;
      this.state.telegraph = false; // strike started; keep abilityId for the action clip
      this.state.channeling = true;
      if (ability.channel.knockbackImmune) this.setKnockbackImmune(true);
      ability.channel.start(this, aim);
      return;
    }
    ability.execute(this, aim, spawn);
    this.cooldowns[ability.id] = ability.cooldownMs;
    this.mode = "recover";
    this.phaseTimer = ability.recoverMs;
    this.clearTelegraph();
  }

  // Rebuild the moveset (and re-read movement) when the boss crosses a phase
  // threshold. Called only from `position` — a safe point where no ability is
  // mid-flight. Cooldowns carry over; abilities new this phase start ready.
  private refreshPhase(): void {
    const key = this.phaseKey();
    if (key === this.lastPhaseKey) return;
    this.lastPhaseKey = key;
    this.cachedAbilities = undefined;
    this.cachedMovement = undefined;
  }

  private clearTelegraph(): void {
    if (this.state.telegraph) this.state.telegraph = false;
    if (this.state.abilityId) this.state.abilityId = "";
    if (this.state.channeling) this.state.channeling = false;
  }
}

// ── Ability builders (shared by boss subclasses) ──────────────────────────────
// A volley fires `count` projectiles fanned across `spreadDeg`, centred on the
// locked aim point. count=1 is a single aimed shot; odd counts always put one
// shot dead-on (so standing still is punished). `aimLockMs` (default 0) sets how
// early the aim freezes during the wind-up — raise it to give a moving player
// room to dodge out of the line (see BossAbility.aimLockMs / docs/bosses.md).
export function volley(o: {
  id: string; ammoId: string; count: number; spreadDeg: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number;
}): BossAbility {
  return {
    id: o.id,
    cooldownMs: o.cooldownMs,
    windUpMs: o.windUpMs,
    recoverMs: o.recoverMs,
    range: o.range,
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

// A radial burst fires `count` projectiles in fixed world directions evenly
// spaced around 360° from the boss centre — NOT aimed at the player, so the
// player dodges by standing between the spokes (the Turtle Dragon's tremor
// cracks: 4 cardinals leave the diagonals safe; 8 forces you through the ring).
export function radial(o: {
  id: string;
  ammoId: string;
  count: number;
  offsetDeg?: number;
  windUpMs: number;
  recoverMs: number;
  cooldownMs: number;
  range: number;
  /** Half-width (px) of a spoke's danger lane, for the canHit gate — roughly the
   *  ammo's side hit radius plus slack. Default 28. */
  laneHalfWidth?: number;
}): BossAbility {
  const offset = ((o.offsetDeg ?? 0) * Math.PI) / 180;
  const step = (Math.PI * 2) / o.count;
  const laneHalf = o.laneHalfWidth ?? 28;
  return {
    id: o.id,
    cooldownMs: o.cooldownMs,
    windUpMs: o.windUpMs,
    recoverMs: o.recoverMs,
    range: o.range,
    aimLockMs: 0,
    // Only fire when the player sits in a spoke's lane: the perpendicular distance
    // from the player to some spoke ray is within laneHalf. A player in a safe gap
    // (a diagonal, for 4 cardinals) doesn't draw the attack.
    canHit: (_boss, target) => {
      const ang = Math.atan2(target.dy, target.dx);
      for (let i = 0; i < o.count; i++) {
        const delta = ang - (offset + i * step);
        const perp = target.dist * Math.sin(Math.atan2(Math.sin(delta), Math.cos(delta)));
        if (Math.abs(perp) <= laneHalf) return true;
      }
      return false;
    },
    execute: (boss, _aim, spawn) => {
      for (let i = 0; i < o.count; i++) {
        spawn(o.ammoId, boss.state.x, boss.state.y, offset + i * step);
      }
    },
  };
}

// A dash attack: after the wind-up the boss rockets toward the telegraphed point
// as a channelled active phase, its body a contact hazard. Reusable for every
// charging boss (spin, gallop, roll, thunder-dash) — tune the numbers per boss.
export function dashAttack(o: {
  id: string; windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number;
  speed: number; maxBounces: number; durationMs: number;
  hitRadius: number; damage: number; hitCooldownMs: number;
}): BossAbility {
  return {
    id: o.id,
    cooldownMs: o.cooldownMs,
    windUpMs: o.windUpMs,
    recoverMs: o.recoverMs,
    range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    execute: () => {}, // the channel does the work; no instant strike
    channel: dashChannel(o),
  };
}

// The channel behind dashAttack: aim at the locked point, rush there, ricochet
// off walls tile-by-tile (axis-separable, DVD-bounce style), and deal contact
// damage with a short per-player cooldown so one pass is one hit. Ends when it
// runs out of bounces or its duration expires; the ability's recover phase is
// the dizzy punish window.
function dashChannel(o: {
  speed: number; maxBounces: number; durationMs: number;
  hitRadius: number; damage: number; hitCooldownMs: number;
}): BossChannel {
  let dirX = 0;
  let dirY = 0;
  let bounces = 0;
  const hitAt = new Map<string, number>(); // sessionId → ms until it can be hit again
  return {
    durationMs: o.durationMs,
    knockbackImmune: true,
    start(boss, aim) {
      const dx = aim.x - boss.state.x, dy = aim.y - boss.state.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len; dirY = dy / len;
      bounces = o.maxBounces;
      hitAt.clear();
    },
    update(boss, dtMs, ctx) {
      // Reflect the axis that would drive the boss into a wall OR its arena edge
      // (a doorway is walkable floor, so only the arena stops it leaving the
      // room), one bounce spent per reflection. Checking a little ahead means we
      // turn before the matter solver ever stops us.
      const look = ENTITY_RADIUS + 8;
      if (dirX !== 0 && boss.isBoundaryAt(boss.state.x + dirX * look, boss.state.y)) { dirX = -dirX; bounces--; }
      if (dirY !== 0 && boss.isBoundaryAt(boss.state.x, boss.state.y + dirY * look)) { dirY = -dirY; bounces--; }

      for (const [id, ms] of hitAt) {
        const next = ms - dtMs;
        if (next <= 0) hitAt.delete(id); else hitAt.set(id, next);
      }
      ctx.players.forEach((p, id) => {
        if ((hitAt.get(id) ?? 0) > 0) return;
        if (Math.hypot(p.x - boss.state.x, p.y - boss.state.y) <= o.hitRadius) {
          ctx.dealDamageToPlayer(id, o.damage);
          hitAt.set(id, o.hitCooldownMs);
        }
      });

      boss.rush(dirX, dirY, o.speed);
      return bounces < 0; // spent its last ricochet → burst out into recover
    },
    end() {
      // No cleanup: the recover phase (stunned/dizzy) is handled by the loop.
    },
  };
}

// A whirl: a stationary spin-in-place melee that batters anything within `reach`
// — the boss's basic close-range answer to a player who hugs it. Reuses the
// channel primitive (the boss holds position and spins), dealing damage once per
// player over the spin. `range` is the reach, so it only triggers up close.
export function whirl(o: {
  id: string;
  windUpMs: number;
  recoverMs: number;
  cooldownMs: number;
  durationMs: number;
  reach: number;
  damage: number;
}): BossAbility {
  return {
    id: o.id,
    cooldownMs: o.cooldownMs,
    windUpMs: o.windUpMs,
    recoverMs: o.recoverMs,
    range: o.reach,
    aimLockMs: 0,
    execute: () => {}, // the channel does the work; no instant strike
    channel: whirlChannel(o),
  };
}

// The channel behind whirl: no movement — the boss spins in place and damages
// each player within reach once. Knockback-immune so a hugging player can't
// interrupt the spin by trading hits.
function whirlChannel(o: { durationMs: number; reach: number; damage: number }): BossChannel {
  const hit = new Set<string>();
  return {
    durationMs: o.durationMs,
    knockbackImmune: true,
    start() {
      hit.clear();
    },
    update(boss, _dtMs, ctx) {
      ctx.players.forEach((p, id) => {
        if (hit.has(id)) return;
        if (Math.hypot(p.x - boss.state.x, p.y - boss.state.y) <= o.reach) {
          ctx.dealDamageToPlayer(id, o.damage);
          hit.add(id);
        }
      });
    },
    end() {
      // No cleanup: the recover phase is the punish window.
    },
  };
}
