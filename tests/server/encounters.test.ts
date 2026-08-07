import { describe, it, expect } from "vitest";
import { makeRng } from "shared";
import { REGULAR_ENEMIES } from "../../engine/src/entities/enemies";
import { BOSSES } from "../../engine/src/entities/bosses";
import { EnemyRole } from "../../engine/src/entities/Enemy";
import {
  ENCOUNTERS, profileFor, enemiesByRole, pickRole, EncounterProfile,
  EncounterContext, EnemyPick, RoomGeometry,
} from "../../engine/src/encounters";
import { Swarm } from "../../engine/src/encounters/profiles/Swarm";
import { Ambush } from "../../engine/src/encounters/profiles/Ambush";
import { BrutePack } from "../../engine/src/encounters/profiles/BrutePack";

const ROLES: EnemyRole[] = ["melee", "ranged", "swarm", "brute"];

// A wide-open room: a horizontal line of candidate tiles with the single doorway at
// the far left (x = 0). "Back" is the right end, "front" (doorway) is the left.
function geometry(): RoomGeometry {
  const candidates = [];
  for (let x = 0; x <= 640; x += 32) candidates.push({ x, y: 256 });
  return {
    candidates,
    center: { x: 320, y: 256 },
    doorwayAnchors: [{ x: 0, y: 256 }],
  };
}

function ctx(over: Partial<EncounterContext> = {}): EncounterContext {
  return {
    roomType: "combat",
    floor: 1,
    partySize: 1,
    rng: makeRng(42),
    geometry: geometry(),
    ...over,
  };
}

const threatOf = (picks: EnemyPick[]) => picks.reduce((s, p) => s + p.cls.threat, 0);

describe("role resolver", () => {
  it("buckets every rank-and-file enemy under exactly its declared role", () => {
    const total = ROLES.reduce((n, r) => n + enemiesByRole[r].length, 0);
    expect(total).toBe(REGULAR_ENEMIES.length);
    for (const cls of REGULAR_ENEMIES) {
      expect(enemiesByRole[cls.role]).toContain(cls);
    }
  });

  it("never buckets a boss (bosses aren't in the rabble pool)", () => {
    for (const r of ROLES) {
      for (const cls of enemiesByRole[r]) expect(BOSSES).not.toContain(cls as never);
    }
  });

  it("has at least one enemy for every role the profiles request", () => {
    // If a role empties out, profiles fall back — but the shipping roster fills all.
    for (const r of ROLES) expect(enemiesByRole[r].length).toBeGreaterThan(0);
  });

  it("pickRole returns a class of the requested role", () => {
    const cls = pickRole(makeRng(1), "brute");
    expect(cls?.role).toBe("brute");
  });
});

describe("compose — budget discipline", () => {
  const budget = 8;
  for (const profile of ENCOUNTERS) {
    it(`${profile.id} never exceeds its threat budget and fields something`, () => {
      const picks = profile.compose(ctx(), budget);
      expect(picks.length).toBeGreaterThan(0);
      expect(threatOf(picks)).toBeLessThanOrEqual(budget);
    });
  }

  it("a swarm fields strictly more bodies than a brute pack at equal budget", () => {
    const b = 12;
    const swarm = new Swarm().compose(ctx(), b);
    const brutes = new BrutePack().compose(ctx(), b);
    expect(swarm.length).toBeGreaterThan(brutes.length);
  });

  it("an ambush fields at least one ranged unit", () => {
    // Averaged over seeds: ranged is the ambush's whole identity, so it must appear.
    let sawRanged = false;
    for (let seed = 0; seed < 20 && !sawRanged; seed++) {
      const picks = new Ambush().compose(ctx({ rng: makeRng(seed) }), 8);
      sawRanged = picks.some((p) => p.role === "ranged");
    }
    expect(sawRanged).toBe(true);
  });

  it("a brute pack anchors on a brute", () => {
    const picks = new BrutePack().compose(ctx(), 8);
    expect(picks[0].role).toBe("brute");
  });
});

describe("placement", () => {
  it("only ever places enemies on walkable in-room candidate tiles", () => {
    const c = ctx();
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const allowed = new Set(c.geometry.candidates.map(key));
    for (const profile of ENCOUNTERS) {
      const placed = profile.place(c, profile.compose(c, 8));
      for (const s of placed) expect(allowed.has(key(s))).toBe(true);
    }
  });

  it("an ambush puts ranged units farther from the doorway than its melee blockers", () => {
    const c = ctx();
    const picks: EnemyPick[] = [
      { cls: enemiesByRole.ranged[0], role: "ranged" },
      { cls: enemiesByRole.melee[0], role: "melee" },
    ];
    const placed = new Ambush().place(c, picks);
    const door = c.geometry.doorwayAnchors[0];
    const dist = (s: { x: number; y: number }) => Math.abs(s.x - door.x);
    const rangedSpot = placed.find((s) => s.cls === picks[0].cls)!;
    const meleeSpot = placed.find((s) => s.cls === picks[1].cls)!;
    expect(dist(rangedSpot)).toBeGreaterThan(dist(meleeSpot));
  });
});

describe("profileFor", () => {
  it("returns a profile for every rank-and-file room type", () => {
    for (const roomType of ["combat", "dark", "maze"] as const) {
      expect(profileFor(ctx({ roomType }))).toBeInstanceOf(EncounterProfile);
    }
  });

  it("is deterministic: same seed and context yield the same profile", () => {
    const a = profileFor(ctx({ rng: makeRng(7) }));
    const b = profileFor(ctx({ rng: makeRng(7) }));
    expect(a).toBe(b);
  });
});

describe("determinism", () => {
  it("same seed yields identical composition and placement", () => {
    const run = () => {
      const c = ctx({ rng: makeRng(99) });
      const p = profileFor(c);
      return p.place(c, p.compose(c, 10)).map((s) => `${s.cls.type}@${s.x},${s.y}`);
    };
    expect(run()).toEqual(run());
  });
});
