import type { PlayerState } from "../../schema/PlayerState";
import type { Boss, BossAbility, TargetInfo } from "../Boss";

// ── Boss movement behaviours ──────────────────────────────────────────────────
// A boss's *ability selection* (what to do next) lives in Boss; its *movement*
// (how to stand so it can do it) lives here, as small reusable functions. The
// two cooperate rather than compete: the position loop picks the ability it
// wants next and hands it to the movement behaviour as `intended`, so the
// behaviour can close or open distance to satisfy that ability's `range`
// precondition. This is why we don't fold ability-picking into movement — a
// mover that held one fixed range would deadlock any ability whose range it
// couldn't reach (see CLAUDE.md's engineering note: behaviour on the class,
// composed from reusable functions, never a lookup table).
//
// A behaviour is called once per tick while the boss is repositioning (not
// during a wind-up/strike/recover). It moves the boss via boss.walk().

export interface MovementContext {
  boss: Boss;
  /** The closest player (the one the boss orients to). */
  target: TargetInfo;
  players: Map<string, PlayerState>;
  dtMs: number;
  /** The ability the boss intends to use next (highest-priority one off
   *  cooldown), so movement can position for its range. Undefined when every
   *  ability is on cooldown — behaviours then fall back to the boss's idealRange. */
  intended?: BossAbility;
}

export type MovementBehavior = (ctx: MovementContext) => void;

export interface HoldRangeOpts {
  /** Dead-band half-width: within ±slack of the target distance the boss holds
   *  still, so it doesn't jitter forward/back on the boundary. */
  slack?: number;
  /** Scales the boss's base speed (0.5 = a slow shuffle, 1 = full). */
  speedScale?: number;
}

/** Kite to a distance band: approach if farther than distance+slack, back off
 *  if closer than distance−slack, otherwise hold. The classic range-keeper. */
export function holdRange(distance: number, opts: HoldRangeOpts = {}): MovementBehavior {
  const slack = opts.slack ?? 40;
  const scale = opts.speedScale ?? 1;
  return ({ boss, target }) => {
    if (target.dist > distance + slack) boss.walk(target.dx, target.dy, scale);
    else if (target.dist < distance - slack) boss.walk(-target.dx, -target.dy, scale);
  };
}

/** Don't move at all — a tank that controls space and only relocates via its
 *  committed moves (the Turtle Dragon between attacks leans on this). */
export function standGround(): MovementBehavior {
  return () => {};
}

export interface ApproachAbilityOpts extends HoldRangeOpts {
  /** Sit at this fraction of the intended ability's range so the boss is
   *  comfortably inside it (0.85 ≈ just inside the max range). */
  rangeFrac?: number;
}

/** The smart general default: position so the *intended* ability is in range.
 *  Closes to rangeFrac × intended.range; with no intended ability (all on
 *  cooldown) it holds the boss's idealRange. Directly implements "get in range
 *  to use this ability". */
export function approachAbility(opts: ApproachAbilityOpts = {}): MovementBehavior {
  const frac = opts.rangeFrac ?? 0.85;
  return (ctx) => {
    const want = ctx.intended ? ctx.intended.range * frac : ctx.boss.idealRange;
    holdRange(want, opts)(ctx);
  };
}

/** Orbit the target at a fixed distance while nudging toward/away to hold it —
 *  a mobile zoner's keep-away. `dir` is +1 clockwise / −1 counter-clockwise. */
export function strafeAround(distance: number, opts: HoldRangeOpts & { dir?: 1 | -1 } = {}): MovementBehavior {
  const scale = opts.speedScale ?? 1;
  const dir = opts.dir ?? 1;
  return (ctx) => {
    const { boss, target } = ctx;
    // Tangent to the boss→target line (perpendicular), plus a radial correction.
    const tx = -target.dy * dir;
    const ty = target.dx * dir;
    const radial = target.dist > distance ? 0.5 : -0.5;
    boss.walk(tx + target.dx * radial, ty + target.dy * radial, scale);
  };
}
