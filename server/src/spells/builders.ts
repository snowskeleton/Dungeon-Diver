import { RehitGate } from "../combat/RehitGate";
import { Spell, SpellEffect, DashCaster, FlightCaster, SummonCaster } from "./Spell";
import type { EnemyClass } from "../entities/Enemy";

// ── Spell builders (shared by bosses; reusable by ranged enemies / players) ────
// Each returns a persistent Spell instance. They are written against the Caster
// interface, not any concrete entity, so the same volley works for a boss or a
// future ranged enemy — only the caster's team mask (attackAffects) differs.

// A volley fires `count` projectiles fanned across `spreadDeg`, centred on the
// locked aim point. count=1 is a single aimed shot; odd counts always put one
// shot dead-on (so standing still is punished). `aimLockMs` (default 0) sets how
// early the aim freezes during the wind-up — raise it to give a moving target
// room to dodge out of the line.
export function volley(o: {
  id: string; ammoId: string; count: number; spreadDeg: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: 0,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    effect: {
      onActivate: (caster, aim) => {
        const base = Math.atan2(aim.y - caster.y, aim.x - caster.x);
        const spread = (o.spreadDeg * Math.PI) / 180;
        for (let i = 0; i < o.count; i++) {
          const off = o.count === 1 ? 0 : (i / (o.count - 1) - 0.5) * spread;
          caster.spawnProjectile(o.ammoId, caster.x, caster.y, base + off);
        }
      },
    },
  });
}

// A radial burst fires `count` projectiles in fixed world directions evenly
// spaced around 360° from the caster — NOT aimed at the target, so it dodges by
// standing between the spokes. `canHit` only fires it when the target sits in a
// spoke's lane, so a target in a safe gap doesn't draw the attack.
export function radial(o: {
  id: string; ammoId: string; count: number; offsetDeg?: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  laneHalfWidth?: number;
}): Spell {
  const offset = ((o.offsetDeg ?? 0) * Math.PI) / 180;
  const step = (Math.PI * 2) / o.count;
  const laneHalf = o.laneHalfWidth ?? 28;
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: 0,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: 0,
    canHit: (_caster, target) => inSomeSpokeLane(target.dx, target.dy, target.dist, offset, step, o.count, laneHalf),
    effect: {
      onActivate: (caster) => {
        for (let i = 0; i < o.count; i++) {
          caster.spawnProjectile(o.ammoId, caster.x, caster.y, offset + i * step);
        }
      },
    },
  });
}

// A tremor line: the caster cracks the ground and stationary shards erupt outward
// along fixed spokes, a line racing out ring-by-ring, holding, then clearing
// together. The shards are inert visual markers; the real hazard is one thick
// segment per spoke (all sharing a RehitGate so the crossing point near the
// caster is a single hit). See docs/bosses.md.
export function tremorLine(o: {
  id: string; ammoId: string; count: number; offsetDeg?: number;
  rings: number; ringSpacing: number; growthMs: number; holdMs: number;
  damage: number; hitCooldownMs: number; hazardHalfWidth?: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  laneHalfWidth?: number;
}): Spell {
  const offset = ((o.offsetDeg ?? 0) * Math.PI) / 180;
  const stepAng = (Math.PI * 2) / o.count;
  const laneHalf = o.laneHalfWidth ?? 28;
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.growthMs + o.holdMs,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true,
    canHit: (_caster, target) => inSomeSpokeLane(target.dx, target.dy, target.dist, offset, stepAng, o.count, laneHalf),
    effect: tremorEffect(o, offset, stepAng),
  });
}

// A dash: after the wind-up the caster rockets toward the telegraphed point, its
// body a contact hazard, ricocheting off walls/arena until it runs out of bounces
// or the duration expires. Reusable for any charging boss.
export function dashAttack(o: {
  id: string; windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number; speed: number; maxBounces: number; durationMs: number;
  hitRadius: number; damage: number; hitCooldownMs: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.durationMs,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    knockbackImmuneWhileActive: true,
    effect: dashEffect(o),
  });
}

// A swoop: a flying boss coils at cruise height (the wind-up tell), then dives
// along the telegraphed heading — dropping to the floor and pulling back up over
// the active phase. Its claws (a contact circle at the ground position) hurt only
// while it's low, so the dive is dodged by not being where it skims. The dive
// speed is chosen so height reaches 0 right as it passes the locked aim point.
export function swoop(o: {
  id: string;
  windUpMs: number;
  recoverMs: number;
  cooldownMs: number;
  range: number;
  aimLockMs?: number;
  /** The caster's cruising altitude in px — the top of the dive (match the flyer's
   *  own `cruiseHeight`). */
  cruiseHeight: number;
  /** Time to fall from cruise height to the floor. */
  diveMs: number;
  /** Time to climb back to cruise. */
  riseMs: number;
  hitRadius: number;
  damage: number;
  knockback?: number;
  hitCooldownMs: number;
  /** Clamp on the auto-computed dive speed (px/sec). */
  minSpeed?: number;
  maxSpeed?: number;
  /** Claws hurt while height is at or below this fraction of cruise (default 0.5). */
  hitBelowFrac?: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.diveMs + o.riseMs,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    knockbackImmuneWhileActive: true,
    effect: swoopEffect(o),
  });
}

// A whirl: a stationary spin-in-place melee that batters anything within `reach`
// (the anti-hug answer). `range` is the reach so it only triggers up close; each
// target is hit once for the whole spin.
export function whirl(o: {
  id: string; windUpMs: number; recoverMs: number; cooldownMs: number;
  durationMs: number; reach: number; damage: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.durationMs,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.reach,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true,
    effect: whirlEffect(o),
  });
}

// A nova burst: the caster charges (the wind-up tell), then detonates a stationary
// radial blast centred on itself — one hit per target over a short strike window,
// with knockback (the Tengu's Storm Nova lightning explosion). Unlike whirl (a
// sustained anti-hug spin) this is a single expanding pop that shoves you off it.
export function novaBurst(o: {
  id: string; windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  radius: number; damage: number; knockback: number; strikeMs?: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.strikeMs ?? 260,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true,
    effect: novaEffect(o),
  });
}

// A stone crash: the caster turns to stone and launches straight up (invulnerable
// and knockback-immune the whole flight — untargetable stone), drifting to hover
// over the locked aim point, hangs a beat (the shadow telegraph), then slams down
// for a big AOE crash with heavy knockback (the Tengu's Stone Crash). Dodge by not
// being under the shadow when it lands. Needs a FlightCaster (drives its height).
export function stoneDrop(o: {
  id: string; windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
  aimLockMs?: number;
  peakHeight: number; riseMs: number; hangMs: number; dropMs: number;
  radius: number; damage: number; knockback: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: o.riseMs + o.hangMs + o.dropMs,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: o.aimLockMs ?? 0,
    knockbackImmuneWhileActive: true,
    invulnerableWhileActive: true,
    effect: stoneDropEffect(o),
  });
}

// A summon: after the wind-up (the split cast tell) the caster conjures `count`
// minions of `enemy`, ringed evenly around it at `radius` (the Tengu's Mirror
// Split). Instant — the adds appear on the strike frame. Casts to a SummonCaster.
export function summonAdds(o: {
  id: string; enemy: EnemyClass; count: number; radius: number;
  windUpMs: number; recoverMs: number; cooldownMs: number; range: number;
}): Spell {
  return new Spell({
    id: o.id,
    windUpMs: o.windUpMs,
    activeMs: 0,
    recoverMs: o.recoverMs,
    cooldownMs: o.cooldownMs,
    range: o.range,
    aimLockMs: 0,
    effect: {
      onActivate: (caster) => {
        const step = (Math.PI * 2) / o.count;
        // Offset by half a step so an even count never spawns dead on the facing axis.
        for (let i = 0; i < o.count; i++) {
          const ang = i * step + step / 2;
          (caster as SummonCaster).summon(
            o.enemy,
            caster.x + Math.cos(ang) * o.radius,
            caster.y + Math.sin(ang) * o.radius,
          );
        }
      },
    },
  });
}

// ── Effects ──────────────────────────────────────────────────────────────────

function novaEffect(o: { radius: number; damage: number; knockback: number }): SpellEffect {
  const gate = new RehitGate(Infinity); // once per target for the whole burst
  return {
    onActivate: () => gate.reset(),
    onActiveTick: (caster) => {
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: o.radius },
        affects: caster.attackAffects,
        attack: { damage: o.damage, knockback: o.knockback, sourceX: caster.x, sourceY: caster.y },
        claim: (id) => gate.claim(id),
      });
    },
  };
}

function stoneDropEffect(o: {
  peakHeight: number; riseMs: number; hangMs: number; dropMs: number;
  radius: number; damage: number; knockback: number;
}): SpellEffect {
  let dirX = 0;
  let dirY = 0;
  let driftSpeed = 0; // px/sec of horizontal drift toward the landing spot
  let elapsed = 0;
  const hoverEnds = o.riseMs + o.hangMs;
  const gate = new RehitGate(Infinity); // the crash hits each target once
  return {
    onActivate: (caster, aim) => {
      const dx = aim.x - caster.x, dy = aim.y - caster.y;
      const dist = Math.hypot(dx, dy);
      dirX = dist === 0 ? 0 : dx / dist;
      dirY = dist === 0 ? 0 : dy / dist;
      // Cover the horizontal gap to the aim over the rise+hang, so it hovers over
      // the landing spot before it drops. Then the drift stops and it falls straight.
      driftSpeed = dist / (hoverEnds / 1000);
      elapsed = 0;
      gate.reset();
    },
    onActiveTick: (caster, dtMs) => {
      const fc = caster as FlightCaster;
      elapsed += dtMs;

      // Height profile: 0 → peak over the rise, hold at peak through the hang, then
      // peak → 0 over the drop.
      let frac: number;
      if (elapsed < o.riseMs) frac = elapsed / o.riseMs;
      else if (elapsed < hoverEnds) frac = 1;
      else frac = Math.max(0, 1 - (elapsed - hoverEnds) / o.dropMs);
      fc.setAirHeight(o.peakHeight * frac);

      // Drift toward the landing spot while airborne (rise + hang), reflecting off
      // arena walls; frozen once it starts dropping so the crash lands under the
      // settled shadow.
      if (elapsed < hoverEnds && (dirX !== 0 || dirY !== 0)) {
        const step = fc.dashStep(dirX, dirY, driftSpeed);
        dirX = step.dirX;
        dirY = step.dirY;
      }

      // The crash: once it has touched back down, emit the AOE. The gate keeps it to
      // a single hit per target even though the source lingers the last couple ticks.
      if (elapsed >= hoverEnds && frac <= 0) {
        caster.emitHitSource({
          shape: { kind: "circle", cx: caster.x, cy: caster.y, r: o.radius },
          affects: caster.attackAffects,
          attack: { damage: o.damage, knockback: o.knockback, sourceX: caster.x, sourceY: caster.y },
          claim: (id) => gate.claim(id),
        });
      }
      return elapsed >= o.riseMs + o.hangMs + o.dropMs;
    },
    onDeactivate: (caster) => (caster as FlightCaster).setAirHeight(0),
  };
}

function whirlEffect(o: { reach: number; damage: number }): SpellEffect {
  const gate = new RehitGate(Infinity); // once per target for the whole spin
  return {
    onActivate: () => gate.reset(),
    onActiveTick: (caster, dtMs) => {
      gate.tick(dtMs);
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: o.reach },
        affects: caster.attackAffects,
        attack: { damage: o.damage, knockback: 0, sourceX: caster.x, sourceY: caster.y },
        claim: (id) => gate.claim(id),
      });
    },
  };
}

function swoopEffect(o: {
  cruiseHeight: number;
  diveMs: number;
  riseMs: number;
  hitRadius: number;
  damage: number;
  knockback?: number;
  hitCooldownMs: number;
  minSpeed?: number;
  maxSpeed?: number;
  hitBelowFrac?: number;
}): SpellEffect {
  let dirX = 0;
  let dirY = 0;
  let speed = 0;
  let elapsed = 0;
  const gate = new RehitGate(o.hitCooldownMs);
  const hitBelow = o.hitBelowFrac ?? 0.5;
  return {
    onActivate: (caster, aim) => {
      const dx = aim.x - caster.x, dy = aim.y - caster.y;
      const dist = Math.hypot(dx, dy) || 1;
      dirX = dx / dist; dirY = dy / dist;
      // Fall onto the aim point: cover the horizontal distance over the dive, so
      // height hits 0 just as the boss passes where the target was.
      speed = Math.min(o.maxSpeed ?? 650, Math.max(o.minSpeed ?? 250, dist / (o.diveMs / 1000)));
      elapsed = 0;
      gate.reset();
    },
    onActiveTick: (caster, dtMs) => {
      const fc = caster as FlightCaster;
      elapsed += dtMs;
      // Height fraction of cruise: 1 → 0 over the dive, then 0 → 1 over the rise.
      const frac = elapsed < o.diveMs
        ? 1 - elapsed / o.diveMs
        : Math.min(1, (elapsed - o.diveMs) / o.riseMs);
      fc.setAirHeight(o.cruiseHeight * frac);

      // Keep travelling along the (wall-reflected) dive heading the whole time.
      const step = fc.dashStep(dirX, dirY, speed);
      dirX = step.dirX; dirY = step.dirY;

      // Claws are a contact hazard at the ground position, live only while low.
      gate.tick(dtMs);
      if (frac <= hitBelow) {
        caster.emitHitSource({
          shape: { kind: "circle", cx: caster.x, cy: caster.y, r: o.hitRadius },
          affects: caster.attackAffects,
          attack: { damage: o.damage, knockback: o.knockback ?? 0, sourceX: caster.x, sourceY: caster.y },
          claim: (id) => gate.claim(id),
        });
      }
      return elapsed >= o.diveMs + o.riseMs;
    },
    onDeactivate: (caster) => (caster as FlightCaster).setAirHeight(o.cruiseHeight),
  };
}

function dashEffect(o: {
  speed: number; maxBounces: number; hitRadius: number; damage: number; hitCooldownMs: number;
}): SpellEffect {
  let dirX = 0;
  let dirY = 0;
  let bounces = 0;
  const gate = new RehitGate(o.hitCooldownMs);
  return {
    onActivate: (caster, aim) => {
      const dx = aim.x - caster.x, dy = aim.y - caster.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len; dirY = dy / len;
      bounces = o.maxBounces;
      gate.reset();
    },
    onActiveTick: (caster, dtMs) => {
      gate.tick(dtMs);
      // Contact hitbox at the current (pre-move) position — one hit per
      // hitCooldownMs per target, so a single pass is a single hit.
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: o.hitRadius },
        affects: caster.attackAffects,
        attack: { damage: o.damage, knockback: 0, sourceX: caster.x, sourceY: caster.y },
        claim: (id) => gate.claim(id),
      });

      // Move + wall-bounce is the mover's job; we just carry the running heading.
      const step = (caster as DashCaster).dashStep(dirX, dirY, o.speed);
      dirX = step.dirX; dirY = step.dirY; bounces -= step.bounces;
      return bounces < 0; // spent its last ricochet → burst out into recover
    },
  };
}

function tremorEffect(
  o: {
    ammoId: string; count: number; rings: number; ringSpacing: number;
    growthMs: number; holdMs: number; damage: number; hitCooldownMs: number;
    hazardHalfWidth?: number;
  },
  offset: number,
  stepAng: number,
): SpellEffect {
  const totalMs = o.growthMs + o.holdMs;
  const ringStepMs = o.growthMs / o.rings; // gap between successive rings erupting
  const hazardHalf = o.hazardHalfWidth ?? 12;
  const dirs = Array.from({ length: o.count }, (_, s) => ({
    x: Math.cos(offset + s * stepAng),
    y: Math.sin(offset + s * stepAng),
  }));
  let elapsed = 0;
  let ringsSpawned = 0;
  // One gate for the whole ability: overlapping spokes (they cross at the caster)
  // count as a single hit per hitCooldownMs, as the old `break` did.
  const gate = new RehitGate(o.hitCooldownMs);
  return {
    onActivate: () => {
      elapsed = 0;
      ringsSpawned = 0;
      gate.reset();
    },
    onActiveTick: (caster, dtMs) => {
      elapsed += dtMs;
      // Erupt ring i once elapsed reaches its scheduled time. Each shard's lifetime
      // is (totalMs − scheduledTime) so the whole line clears together. Shards are
      // inert visuals; they only render the growing line.
      while (ringsSpawned < o.rings && elapsed >= ringsSpawned * ringStepMs) {
        const i = ringsSpawned;
        const dist = (i + 1) * o.ringSpacing;
        const life = totalMs - i * ringStepMs;
        for (const d of dirs) {
          caster.spawnProjectile(
            o.ammoId,
            caster.x + d.x * dist,
            caster.y + d.y * dist,
            Math.atan2(d.y, d.x),
            { lifetimeMs: life, inert: true },
          );
        }
        ringsSpawned++;
      }

      // The real hitbox: one thick segment per spoke, out to the erupted length.
      gate.tick(dtMs);
      const reach = ringsSpawned * o.ringSpacing;
      if (reach > 0) {
        for (const d of dirs) {
          caster.emitHitSource({
            shape: {
              kind: "segment",
              x0: caster.x,
              y0: caster.y,
              x1: caster.x + d.x * reach,
              y1: caster.y + d.y * reach,
              halfWidth: hazardHalf,
            },
            affects: caster.attackAffects,
            attack: { damage: o.damage, knockback: 0, sourceX: caster.x, sourceY: caster.y },
            claim: (id) => gate.claim(id),
          });
        }
      }
    },
  };
}

// True if (dx, dy) sits within `laneHalf` of some evenly-spaced spoke ray — the
// shared gate for radial() and tremorLine() (a target in a safe gap is left be).
function inSomeSpokeLane(
  dx: number, dy: number, dist: number,
  offset: number, step: number, count: number, laneHalf: number,
): boolean {
  const ang = Math.atan2(dy, dx);
  for (let i = 0; i < count; i++) {
    const delta = ang - (offset + i * step);
    const perp = dist * Math.sin(Math.atan2(Math.sin(delta), Math.cos(delta)));
    if (Math.abs(perp) <= laneHalf) return true;
  }
  return false;
}
