import { describe, it, expect } from "vitest";
import {
  holdRange,
  standGround,
  approachAbility,
  strafeAround,
  MovementContext,
} from "../../server/src/entities/bosses/movement";
import { Spell } from "../../server/src/spells/Spell";
import type { Boss } from "../../server/src/entities/Boss";
import type { PlayerState } from "../../server/src/schema/PlayerState";

// Boss movement is deliberately a set of small pure functions rather than a mode
// on the class, so it is tested as such: given a target at a distance, which way
// does it decide to walk?

interface Walk { dx: number; dy: number; scale: number }

/** A boss stub that only records what walk() was asked to do. */
function stubBoss(idealRange = 180) {
  const walks: Walk[] = [];
  const boss = {
    idealRange,
    walk(dx: number, dy: number, scale: number) { walks.push({ dx, dy, scale }); },
  } as unknown as Boss;
  return { boss, walks };
}

function ctx(distance: number, boss: Boss, intended?: Spell): MovementContext {
  return {
    boss,
    // Target directly to the right, at `distance`.
    target: { id: "p1", dist: distance, dx: distance, dy: 0 },
    players: new Map<string, PlayerState>(),
    dtMs: 50,
    intended,
  };
}

const spellWithRange = (range: number) => new Spell({
  id: "s",
  windUpMs: 0,
  activeMs: 0,
  recoverMs: 0,
  cooldownMs: 0,
  range,
  aimLockMs: 0,
  effect: {},
});

describe("holdRange", () => {
  it("closes when the target is beyond the band", () => {
    const { boss, walks } = stubBoss();
    holdRange(200, { slack: 40 })(ctx(400, boss));

    expect(walks).toHaveLength(1);
    expect(walks[0].dx).toBeGreaterThan(0); // toward the target
  });

  it("backs off when the target is inside the band", () => {
    const { boss, walks } = stubBoss();
    holdRange(200, { slack: 40 })(ctx(100, boss));

    expect(walks).toHaveLength(1);
    expect(walks[0].dx).toBeLessThan(0); // away from the target
  });

  it("holds still inside the dead band, so it doesn't jitter on the boundary", () => {
    const { boss, walks } = stubBoss();
    const mover = holdRange(200, { slack: 40 });
    for (const d of [161, 200, 239]) mover(ctx(d, boss));
    expect(walks).toHaveLength(0);
  });

  it("uses a default slack when none is given", () => {
    const { boss, walks } = stubBoss();
    holdRange(200)(ctx(210, boss)); // inside the default ±40 band
    expect(walks).toHaveLength(0);
  });

  it("passes its speed scale through to the walk", () => {
    const { boss, walks } = stubBoss();
    holdRange(200, { speedScale: 0.5 })(ctx(400, boss));
    expect(walks[0].scale).toBe(0.5);

    const full = stubBoss();
    holdRange(200)(ctx(400, full.boss));
    expect(full.walks[0].scale).toBe(1);
  });
});

describe("standGround", () => {
  it("never moves, whatever the target does", () => {
    const { boss, walks } = stubBoss();
    const mover = standGround();
    for (const d of [10, 200, 5000]) mover(ctx(d, boss));
    expect(walks).toHaveLength(0);
  });
});

describe("approachAbility", () => {
  it("closes to just inside the intended ability's range", () => {
    const { boss, walks } = stubBoss();
    // Wants 400 × 0.85 = 340; standing at 500 is too far.
    approachAbility()(ctx(500, boss, spellWithRange(400)));
    expect(walks[0].dx).toBeGreaterThan(0);

    const close = stubBoss();
    approachAbility()(ctx(340, close.boss, spellWithRange(400)));
    expect(close.walks).toHaveLength(0); // already in position
  });

  it("backs out of a SHORT-range ability's face when it wants a long one", () => {
    const { boss, walks } = stubBoss();
    // Intends a 400-range shot but is hugging at 50 — it should open up.
    approachAbility()(ctx(50, boss, spellWithRange(400)));
    expect(walks[0].dx).toBeLessThan(0);
  });

  it("closes for a short-range ability, which is the point of tracking `intended`", () => {
    const { boss, walks } = stubBoss(400);
    // A melee spell: the boss must come in, even though its ideal range is far.
    approachAbility({ slack: 10 })(ctx(300, boss, spellWithRange(60)));
    expect(walks[0].dx).toBeGreaterThan(0);
  });

  it("falls back to the boss's ideal range when every spell is on cooldown", () => {
    const { boss, walks } = stubBoss(180);
    approachAbility({ slack: 10 })(ctx(500, boss)); // no intended spell
    expect(walks[0].dx).toBeGreaterThan(0);

    const held = stubBoss(180);
    approachAbility({ slack: 40 })(ctx(180, held.boss));
    expect(held.walks).toHaveLength(0);
  });

  it("honours a custom rangeFrac", () => {
    const { boss, walks } = stubBoss();
    // rangeFrac 0.5 of 400 = 200; at 300 it is too far and closes.
    approachAbility({ rangeFrac: 0.5, slack: 10 })(ctx(300, boss, spellWithRange(400)));
    expect(walks[0].dx).toBeGreaterThan(0);
  });
});

describe("strafeAround", () => {
  it("circles the target rather than walking straight at it", () => {
    const { boss, walks } = stubBoss();
    strafeAround(200)(ctx(200, boss));

    expect(walks).toHaveLength(1);
    // Target is directly right (dx>0, dy=0), so a pure orbit is vertical.
    expect(Math.abs(walks[0].dy)).toBeGreaterThan(0);
  });

  it("reverses its orbit direction on request", () => {
    const cw = stubBoss();
    strafeAround(200, { dir: 1 })(ctx(200, cw.boss));
    const ccw = stubBoss();
    strafeAround(200, { dir: -1 })(ctx(200, ccw.boss));

    expect(Math.sign(cw.walks[0].dy)).toBe(-Math.sign(ccw.walks[0].dy));
  });

  it("corrects inward when it drifts too far out", () => {
    const { boss, walks } = stubBoss();
    strafeAround(200)(ctx(500, boss)); // too far
    expect(walks[0].dx).toBeGreaterThan(0); // some inward pull
  });

  it("corrects outward when the target closes in", () => {
    const { boss, walks } = stubBoss();
    strafeAround(200)(ctx(50, boss)); // too close
    expect(walks[0].dx).toBeLessThan(0); // some outward push
  });

  it("keeps moving every tick — it is a mobile zoner, not a holder", () => {
    const { boss, walks } = stubBoss();
    const mover = strafeAround(200);
    for (let i = 0; i < 5; i++) mover(ctx(200, boss));
    expect(walks).toHaveLength(5);
  });

  it("passes its speed scale through", () => {
    const { boss, walks } = stubBoss();
    strafeAround(200, { speedScale: 0.3 })(ctx(200, boss));
    expect(walks[0].scale).toBe(0.3);
  });
});
