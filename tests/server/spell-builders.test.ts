import { describe, it, expect } from "vitest";
import { Facing, Attack, ENEMY_ATTACK_AFFECTS, Layer, canAffect, shapeHitsPoint } from "shared";
import {
  volley,
  radial,
  tremorLine,
  dashAttack,
  swoop,
  whirl,
  novaBurst,
  stoneDrop,
  summonAdds,
} from "../../server/src/spells/builders";
import { Spell, AttackStats, FlightCaster } from "../../server/src/spells/Spell";
import { SpellCaster } from "../../server/src/spells/SpellCaster";
import { HitSource } from "../../server/src/combat/HitSource";
import { EnemyClass, SpawnOpts } from "../../server/src/entities/Enemy";
import { GooGreen } from "../../server/src/entities/enemies/goos";

// The reusable ability shapes every boss is assembled from. Each is driven
// through a real SpellCaster and asserted on the SHAPE of what it produces —
// how many shots, in what directions, where the hazard lands — never on a
// particular boss's damage number.

/** A caster with every optional capability, recording everything a spell does. */
class FullCaster implements FlightCaster {
  x = 0;
  y = 0;
  facing: Facing = "right";
  attackAffects = ENEMY_ATTACK_AFFECTS;
  sources: HitSource[] = [];
  shots: Array<{ ammoId: string; x: number; y: number; angle: number; opts?: SpawnOpts }> = [];
  summons: Array<{ enemy: EnemyClass; x: number; y: number }> = [];
  heights: number[] = [];
  dashes: Array<{ dirX: number; dirY: number; pxPerSec: number }> = [];
  /** Set to make dashStep report a wall bounce. */
  bounceOn = -1;
  private dashCount = 0;

  emitHitSource(source: HitSource) { this.sources.push(source); }
  spawnProjectile = (ammoId: string, x: number, y: number, angle: number, opts?: SpawnOpts) => {
    this.shots.push({ ammoId, x, y, angle, opts });
  };
  summon(enemy: EnemyClass, x: number, y: number) { this.summons.push({ enemy, x, y }); }
  setAirHeight(px: number) { this.heights.push(px); }
  scaleAttack(base: AttackStats): AttackStats { return base; }
  buildAttack(base: AttackStats, sourceX: number, sourceY: number): Attack {
    return { damage: base.damage, knockback: base.knockback, sourceX, sourceY };
  }
  dashStep(dirX: number, dirY: number, pxPerSec: number) {
    this.dashes.push({ dirX, dirY, pxPerSec });
    const bounced = this.dashCount++ === this.bounceOn;
    if (bounced) { dirX = -dirX; dirY = -dirY; }
    this.x += dirX * pxPerSec * 0.05;
    this.y += dirY * pxPerSec * 0.05;
    return { dirX, dirY, bounces: bounced ? 1 : 0 };
  }
}

/** Run a spell to completion, returning the caster it acted on. */
function cast(spell: Spell, caster = new FullCaster(), aim = { x: 100, y: 0 }, maxTicks = 400): FullCaster {
  const sc = new SpellCaster();
  sc.begin(spell, aim);
  for (let i = 0; i < maxTicks && sc.busy; i++) sc.update(caster, 50, aim);
  return caster;
}

const deg = (rad: number) => ((rad * 180) / Math.PI + 360) % 360;

describe("volley", () => {
  const build = (count: number, spreadDeg: number) => volley({
    id: "v",
    ammoId: "fireball",
    count,
    spreadDeg,
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 500,
    range: 400,
  });

  it("fires exactly `count` shots of its ammo", () => {
    const c = cast(build(5, 40));
    expect(c.shots).toHaveLength(5);
    for (const s of c.shots) expect(s.ammoId).toBe("fireball");
  });

  it("aims a single shot dead at the target", () => {
    const c = cast(build(1, 60), new FullCaster(), { x: 0, y: 100 });
    expect(deg(c.shots[0].angle)).toBeCloseTo(90, 4);
  });

  it("puts one shot dead-on for an odd count, so standing still is punished", () => {
    const c = cast(build(3, 60));
    const angles = c.shots.map(s => deg(s.angle));
    expect(angles).toContain(0);
  });

  it("fans the shots evenly across the spread, centred on the aim", () => {
    const c = cast(build(3, 60));
    const angles = c.shots.map(s => ((deg(s.angle) + 180) % 360) - 180).sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-30, 4);
    expect(angles[1]).toBeCloseTo(0, 4);
    expect(angles[2]).toBeCloseTo(30, 4);
  });

  it("fires from the caster's own position", () => {
    const caster = new FullCaster();
    caster.x = 500;
    caster.y = 400;
    cast(build(1, 0), caster, { x: 600, y: 400 });
    expect(caster.shots[0].x).toBe(500);
    expect(caster.shots[0].y).toBe(400);
  });

  it("fires on the strike frame, not during the wind-up", () => {
    const caster = new FullCaster();
    const sc = new SpellCaster();
    sc.begin(build(3, 40), { x: 100, y: 0 });
    sc.update(caster, 50, { x: 100, y: 0 });
    expect(caster.shots).toHaveLength(0);
    sc.update(caster, 50, { x: 100, y: 0 });
    expect(caster.shots).toHaveLength(3);
  });
});

describe("radial", () => {
  const build = (count: number, offsetDeg = 0) => radial({
    id: "r",
    ammoId: "fireball",
    count,
    offsetDeg,
    windUpMs: 0,
    recoverMs: 0,
    cooldownMs: 500,
    range: 400,
  });

  it("fires evenly around the full circle, ignoring where the target is", () => {
    const c = cast(build(8), new FullCaster(), { x: 0, y: 999 });
    expect(c.shots).toHaveLength(8);
    const angles = c.shots.map(s => deg(s.angle)).sort((a, b) => a - b);
    for (let i = 0; i < 8; i++) expect(angles[i]).toBeCloseTo(i * 45, 4);
  });

  it("rotates the whole burst by its offset", () => {
    const c = cast(build(4, 45));
    const angles = c.shots.map(s => deg(s.angle)).sort((a, b) => a - b);
    expect(angles).toEqual([45, 135, 225, 315].map(a => expect.closeTo(a, 4)));
  });

  it("only fires when the target stands in a spoke's lane", () => {
    const spell = build(4); // spokes at 0/90/180/270
    const caster = new FullCaster();
    // Dead on the 0° spoke.
    expect(spell.canHit(caster, { id: "t", dist: 200, dx: 200, dy: 0 })).toBe(true);
    // Squarely in the 45° gap — a safe pocket, so it doesn't draw the attack.
    expect(spell.canHit(caster, { id: "t", dist: 200, dx: 141, dy: 141 })).toBe(false);
  });

  it("widens its lane test with a wider laneHalfWidth", () => {
    const narrow = radial({ id: "n", ammoId: "fireball", count: 4, laneHalfWidth: 5, windUpMs: 0, recoverMs: 0, cooldownMs: 0, range: 400 });
    const wide = radial({ id: "w", ammoId: "fireball", count: 4, laneHalfWidth: 200, windUpMs: 0, recoverMs: 0, cooldownMs: 0, range: 400 });
    const caster = new FullCaster();
    const target = { id: "t", dist: 200, dx: 141, dy: 141 };
    expect(narrow.canHit(caster, target)).toBe(false);
    expect(wide.canHit(caster, target)).toBe(true);
  });
});

describe("tremorLine", () => {
  const build = () => tremorLine({
    id: "t",
    ammoId: "rock-shard",
    count: 4,
    rings: 5,
    ringSpacing: 40,
    growthMs: 400,
    holdMs: 300,
    damage: 20,
    hitCooldownMs: 500,
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 300,
  });

  it("runs for its growth plus its hold", () => {
    expect(build().activeMs).toBe(700);
  });

  it("plants inert shards — they render but carry no hitbox of their own", () => {
    const c = cast(build());
    expect(c.shots.length).toBeGreaterThan(0);
    for (const s of c.shots) expect(s.opts?.inert).toBe(true);
  });

  it("plants shards further out as the line races outward", () => {
    const caster = new FullCaster();
    const sc = new SpellCaster();
    sc.begin(build(), { x: 100, y: 0 });
    const distances: number[] = [];
    for (let i = 0; i < 30 && sc.busy; i++) {
      const before = caster.shots.length;
      sc.update(caster, 50, { x: 100, y: 0 });
      for (const s of caster.shots.slice(before)) {
        distances.push(Math.hypot(s.x - caster.x, s.y - caster.y));
      }
    }
    expect(Math.max(...distances)).toBeGreaterThan(Math.min(...distances));
  });

  it("emits one thick segment per spoke as the real hazard", () => {
    const c = cast(build());
    const segments = c.sources.filter(s => s.shape.kind === "segment");
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].attack.damage).toBe(20);
  });

  it("hits a target near the crossing point only once, not once per spoke", () => {
    // All four spokes share one RehitGate precisely so standing at the centre
    // isn't four times the damage.
    const c = cast(build());
    const tick = c.sources.filter(s => s.shape.kind === "segment");
    const claimed = tick.map(s => s.claim("p1")).filter(Boolean);
    expect(claimed.length).toBeLessThanOrEqual(2); // one per re-hit window, not 4/tick
  });

  it("cannot be shoved off mid-cast", () => {
    expect(build().knockbackImmuneWhileActive).toBe(true);
  });

  it("leaves a target sitting in a safe gap alone", () => {
    const caster = new FullCaster();
    expect(build().canHit(caster, { id: "t", dist: 200, dx: 141, dy: 141 })).toBe(false);
  });
});

describe("dashAttack", () => {
  const build = (over: Partial<Parameters<typeof dashAttack>[0]> = {}) => dashAttack({
    id: "d",
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 400,
    speed: 600,
    maxBounces: 2,
    durationMs: 600,
    hitRadius: 30,
    damage: 25,
    hitCooldownMs: 400,
    ...over,
  });

  it("charges toward the telegraphed point", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 500, y: 0 });
    expect(caster.dashes.length).toBeGreaterThan(0);
    expect(caster.dashes[0].dirX).toBeGreaterThan(0);
    expect(caster.x).toBeGreaterThan(0);
  });

  it("makes its body a contact hazard for the whole charge", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 500, y: 0 });
    const circles = caster.sources.filter(s => s.shape.kind === "circle");
    expect(circles.length).toBeGreaterThan(0);
    expect(circles[0].attack.damage).toBe(25);
  });

  it("cannot be shoved out of its charge", () => {
    expect(build().knockbackImmuneWhileActive).toBe(true);
  });

  it("ends early once it has spent its bounces", () => {
    const caster = new FullCaster();
    caster.bounceOn = 0; // ricochet on the first step
    const short = cast(build({ maxBounces: 0, durationMs: 5000 }), caster, { x: 500, y: 0 });
    expect(short.dashes.length).toBeLessThan(20); // stopped well short of 5000ms
  });

  it("runs its full duration when it never hits anything", () => {
    const caster = new FullCaster();
    cast(build({ durationMs: 600 }), caster, { x: 500, y: 0 });
    expect(caster.dashes.length).toBeGreaterThanOrEqual(600 / 50 - 1);
  });
});

describe("swoop", () => {
  const build = () => swoop({
    id: "s",
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 400,
    cruiseHeight: 40,
    diveMs: 300,
    riseMs: 300,
    hitRadius: 30,
    damage: 20,
    hitCooldownMs: 400,
  });

  it("dives to the floor and climbs back to cruise", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });

    expect(Math.min(...caster.heights)).toBeLessThan(5);      // reached the floor
    expect(caster.heights[caster.heights.length - 1]).toBeCloseTo(40, 0); // back up
  });

  it("only claws while it is low, so the dive is dodged by not being there", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });

    // Hazard ticks are strictly fewer than the total active ticks.
    const activeTicks = (300 + 300) / 50;
    expect(caster.sources.length).toBeGreaterThan(0);
    expect(caster.sources.length).toBeLessThan(activeTicks);
  });

  it("moves along the telegraphed heading", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });
    expect(caster.x).toBeGreaterThan(0);
  });

  it("cannot be shoved mid-dive", () => {
    expect(build().knockbackImmuneWhileActive).toBe(true);
  });
});

describe("whirl", () => {
  const build = () => whirl({
    id: "w",
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    durationMs: 500,
    reach: 60,
    damage: 15,
  });

  it("triggers only up close — its range IS its reach", () => {
    expect(build().range).toBe(60);
  });

  it("batters a circle around the caster for the whole spin", () => {
    const c = cast(build());
    expect(c.sources.length).toBeGreaterThan(1);
    const shape = c.sources[0].shape as { kind: string; r: number };
    expect(shape.kind).toBe("circle");
    expect(shape.r).toBe(60);
  });

  it("hits each target once for the whole spin, not once per tick", () => {
    const c = cast(build());
    expect(c.sources.map(s => s.claim("p1")).filter(Boolean)).toHaveLength(1);
  });

  it("cannot be shoved off", () => {
    expect(build().knockbackImmuneWhileActive).toBe(true);
  });
});

describe("novaBurst", () => {
  const build = () => novaBurst({
    id: "n",
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 200,
    radius: 90,
    damage: 30,
    knockback: 18,
  });

  it("detonates a circle centred on the caster", () => {
    const caster = new FullCaster();
    caster.x = 400;
    caster.y = 300;
    cast(build(), caster);
    const shape = caster.sources[0].shape as { kind: string; cx: number; cy: number; r: number };
    expect(shape).toEqual({ kind: "circle", cx: 400, cy: 300, r: 90 });
  });

  it("shoves what it hits, unlike a plain spin", () => {
    const c = cast(build());
    expect(c.sources[0].attack.knockback).toBe(18);
    expect(c.sources[0].attack.damage).toBe(30);
  });

  it("hits each target exactly once per detonation", () => {
    const c = cast(build());
    expect(c.sources.map(s => s.claim("p1")).filter(Boolean)).toHaveLength(1);
  });

  it("reaches players, never other enemies", () => {
    const c = cast(build());
    expect(canAffect(c.sources[0].affects, Layer.PLAYER)).toBe(true);
    expect(canAffect(c.sources[0].affects, Layer.ENEMY)).toBe(false);
  });
});

describe("stoneDrop", () => {
  const build = () => stoneDrop({
    id: "sd",
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 400,
    peakHeight: 200,
    riseMs: 300,
    hangMs: 200,
    dropMs: 200,
    radius: 100,
    damage: 40,
    knockback: 25,
  });

  it("is untouchable stone for the whole flight", () => {
    const spell = build();
    expect(spell.invulnerableWhileActive).toBe(true);
    expect(spell.knockbackImmuneWhileActive).toBe(true);
  });

  it("rises, hangs, and comes back down to the ground", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });

    expect(Math.max(...caster.heights)).toBeCloseTo(200, 0);
    expect(caster.heights[caster.heights.length - 1]).toBe(0);
  });

  it("drifts over the locked aim point before slamming", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });
    // Most of the way there (the stub caster integrates in whole 50ms steps, so
    // it lands a step short of exact); the point is that it TRACKS the aim.
    expect(caster.x).toBeGreaterThan(240);
    expect(caster.x).toBeLessThanOrEqual(300);
  });

  it("slams for one big AOE hit at the end, not throughout", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });

    expect(caster.sources).toHaveLength(1);
    const shape = caster.sources[0].shape as { kind: string; r: number };
    expect(shape.kind).toBe("circle");
    expect(shape.r).toBe(100);
    expect(caster.sources[0].attack.damage).toBe(40);
    expect(caster.sources[0].attack.knockback).toBe(25);
  });

  it("lands the blast where it hovered, so the shadow is honest", () => {
    const caster = new FullCaster();
    cast(build(), caster, { x: 300, y: 0 });
    // The blast is centred where the boss actually is when it lands, and its
    // 100px radius still covers the telegraphed point — the shadow doesn't lie.
    const shape = caster.sources[0].shape as { cx: number; cy: number };
    expect(shape.cx).toBe(caster.x);
    expect(shapeHitsPoint(caster.sources[0].shape, 300, 0)).toBe(true);
  });
});

describe("summonAdds", () => {
  const build = (count: number) => summonAdds({
    id: "sa",
    enemy: GooGreen,
    count,
    radius: 60,
    windUpMs: 100,
    recoverMs: 0,
    cooldownMs: 1000,
    range: 300,
  });

  it("conjures exactly `count` minions of the named class", () => {
    const c = cast(build(3));
    expect(c.summons).toHaveLength(3);
    for (const s of c.summons) expect(s.enemy).toBe(GooGreen);
  });

  it("rings them evenly at its radius around the caster", () => {
    const caster = new FullCaster();
    caster.x = 500;
    caster.y = 400;
    cast(build(4), caster);

    for (const s of caster.summons) {
      expect(Math.hypot(s.x - 500, s.y - 400)).toBeCloseTo(60, 4);
    }
    const angles = caster.summons.map(s => deg(Math.atan2(s.y - 400, s.x - 500))).sort((a, b) => a - b);
    for (let i = 1; i < angles.length; i++) expect(angles[i] - angles[i - 1]).toBeCloseTo(90, 4);
  });

  it("offsets by half a step so an even count never lands on the facing axis", () => {
    // Two adds without the offset would sit at 0° and 180° — directly in front
    // of and behind the boss. The half-step puts them beside it instead.
    const c = cast(build(2));
    const angles = c.summons.map(s => deg(Math.atan2(s.y, s.x))).sort((a, b) => a - b);
    expect(angles).toEqual([90, 270].map(a => expect.closeTo(a, 4)));
  });

  it("appears on the strike frame — the split is instant", () => {
    const caster = new FullCaster();
    const sc = new SpellCaster();
    sc.begin(build(2), { x: 100, y: 0 });
    sc.update(caster, 50, { x: 100, y: 0 });
    expect(caster.summons).toHaveLength(0); // still winding up
    sc.update(caster, 50, { x: 100, y: 0 });
    expect(caster.summons).toHaveLength(2);
  });
});

describe("every builder", () => {
  const all: Array<[string, Spell]> = [
    ["volley", volley({ id: "v", ammoId: "fireball", count: 3, spreadDeg: 30, windUpMs: 100, recoverMs: 50, cooldownMs: 500, range: 300 })],
    ["radial", radial({ id: "r", ammoId: "fireball", count: 6, windUpMs: 100, recoverMs: 50, cooldownMs: 500, range: 300 })],
    ["whirl", whirl({ id: "w", windUpMs: 100, recoverMs: 50, cooldownMs: 500, durationMs: 300, reach: 60, damage: 10 })],
    ["novaBurst", novaBurst({ id: "n", windUpMs: 100, recoverMs: 50, cooldownMs: 500, range: 200, radius: 80, damage: 10, knockback: 5 })],
  ];

  it.each(all)("%s telegraphs with a wind-up before it does anything", (_name, spell) => {
    expect(spell.windUpMs).toBeGreaterThan(0);
  });

  it.each(all)("%s owns a real recast cooldown", (_name, spell) => {
    expect(spell.cooldownMs).toBeGreaterThan(0);
    spell.markCast(0);
    expect(spell.isReady(spell.cooldownMs - 1)).toBe(false);
    expect(spell.isReady(spell.cooldownMs)).toBe(true);
  });

  it.each(all)("%s only ever hurts the caster's opposing team", (_name, spell) => {
    const c = cast(spell);
    for (const s of c.sources) {
      expect(canAffect(s.affects, Layer.ENEMY)).toBe(false);
    }
  });
});
