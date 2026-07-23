import { describe, it, expect } from "vitest";
import {
  AMMO_CLASSES,
  AMMO_REGISTRY,
  FX_HURTBOX_FRAMES,
  FX_FRAME_MS,
  fxHurtboxAt,
  swingDurationMs,
  StripFXType,
  ENEMY_HURT_BOUNDS,
  PLAYER_HURT_BOUNDS,
  ENTITY_RADIUS,
  RectHitRegion,
} from "shared";

const ammo = AMMO_CLASSES.map(A => new A());

describe("ammo registry", () => {
  it("derives one entry per class with no id collisions", () => {
    const ids = ammo.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(AMMO_REGISTRY)).toHaveLength(ammo.length);
  });

  it("keeps every projectile stat physically sensible", () => {
    for (const a of ammo) {
      expect(a.damage, `${a.id} damage`).toBeGreaterThanOrEqual(0);
      expect(a.speed, `${a.id} speed`).toBeGreaterThanOrEqual(0);
      expect(a.pierce, `${a.id} pierce`).toBeGreaterThanOrEqual(1);
      expect(a.lifetimeMs, `${a.id} lifetime`).toBeGreaterThan(0);
      expect(a.hitRadiusForward, `${a.id} forward`).toBeGreaterThan(0);
      expect(a.hitRadiusSide, `${a.id} side`).toBeGreaterThan(0);
    }
  });

  it("nests categorised ammo under its folder and keeps one-offs flat", () => {
    for (const a of ammo) {
      const expected = a.category
        ? `/sprites/ammo/${a.category}/${a.id}/${a.id}.png`
        : `/sprites/ammo/${a.id}/${a.id}.png`;
      expect(a.spritePath).toBe(expected);
    }
  });

  it("gives a boomerang a return time inside its own lifetime", () => {
    const boomerangs = ammo.filter(a => a.returnsAtMs !== undefined);
    expect(boomerangs.length).toBeGreaterThan(0);
    for (const b of boomerangs) {
      expect(b.returnsAtMs!, `${b.id}`).toBeGreaterThan(0);
      expect(b.returnsAtMs!, `${b.id} returns after it despawns`).toBeLessThan(b.lifetimeMs);
    }
  });

  it("keeps spin and fixed-angle mutually exclusive, as documented", () => {
    for (const a of ammo) {
      expect(a.spinDegPerSec > 0 && a.fixedAngle, `${a.id}`).toBe(false);
    }
  });
});

// ── Melee geometry generated from the attack art ─────────────────────────────

describe("FX hurtbox table", () => {
  const strips = Object.keys(FX_HURTBOX_FRAMES) as StripFXType[];

  it("covers every strip FX type with frames", () => {
    expect(strips.length).toBeGreaterThan(0);
    for (const fx of strips) {
      expect(FX_HURTBOX_FRAMES[fx].length, fx).toBeGreaterThan(0);
    }
  });

  it("starts every swing with empty wind-up frames — a swing is not instant", () => {
    for (const fx of strips) {
      expect(fxHurtboxAt(fx, 0, 0, 0, "right"), `${fx} hits on frame 0`).toBeNull();
    }
  });

  it("draws a real region somewhere in the middle of the swing", () => {
    for (const fx of strips) {
      const frames = FX_HURTBOX_FRAMES[fx];
      const anyDrawn = frames.some((_, i) => fxHurtboxAt(fx, i * FX_FRAME_MS + 1, 0, 0, "right"));
      expect(anyDrawn, `${fx} never draws a hitbox`).toBe(true);
    }
  });

  it("ends the hitbox when the animation ends", () => {
    for (const fx of strips) {
      expect(fxHurtboxAt(fx, swingDurationMs(fx), 0, 0, "right"), fx).toBeNull();
      expect(fxHurtboxAt(fx, swingDurationMs(fx) + 500, 0, 0, "right"), fx).toBeNull();
    }
  });

  it("has no hitbox before the swing starts", () => {
    for (const fx of strips) {
      expect(fxHurtboxAt(fx, -1, 0, 0, "right"), fx).toBeNull();
    }
  });

  it("derives swing duration from the frame count", () => {
    for (const fx of strips) {
      expect(swingDurationMs(fx)).toBe(FX_HURTBOX_FRAMES[fx].length * FX_FRAME_MS);
    }
  });
});

describe("hurtbox rotation", () => {
  // Pick a frame that actually draws, so there's a region to rotate.
  const fx: StripFXType = "slash";
  const drawnMs = (() => {
    const frames = FX_HURTBOX_FRAMES[fx];
    for (let i = 0; i < frames.length; i++) {
      if (fxHurtboxAt(fx, i * FX_FRAME_MS + 1, 0, 0, "right")) return i * FX_FRAME_MS + 1;
    }
    throw new Error("slash never draws");
  })();

  const at = (facing: "up" | "down" | "left" | "right") =>
    fxHurtboxAt(fx, drawnMs, 1000, 1000, facing) as RectHitRegion;

  it("reaches right when facing right and left when facing left", () => {
    expect(at("right").x + at("right").w).toBeGreaterThan(1000);
    expect(at("left").x).toBeLessThan(1000);
  });

  it("reaches down when facing down and up when facing up", () => {
    expect(at("down").y + at("down").h).toBeGreaterThan(1000);
    expect(at("up").y).toBeLessThan(1000);
  });

  it("rotates by quarter turns, so the box stays axis-aligned and swaps extents", () => {
    const right = at("right");
    const down = at("down");
    expect(down.w).toBe(right.h);
    expect(down.h).toBe(right.w);
  });

  it("mirrors left/right and up/down about the caster to the same reach", () => {
    const right = at("right");
    const left = at("left");
    // The rightward reach past the caster equals the leftward reach.
    expect(right.x + right.w - 1000).toBeCloseTo(1000 - left.x, 9);
    expect(right.w).toBe(left.w);

    const up = at("up");
    const down = at("down");
    expect(down.y + down.h - 1000).toBeCloseTo(1000 - up.y, 9);
  });

  it("translates with the caster rather than being absolute", () => {
    const a = fxHurtboxAt(fx, drawnMs, 0, 0, "right") as RectHitRegion;
    const b = fxHurtboxAt(fx, drawnMs, 500, 300, "right") as RectHitRegion;
    expect(b.x - a.x).toBe(500);
    expect(b.y - a.y).toBe(300);
  });

  it("moves the box frame by frame, tracking the drawn blade", () => {
    // The point of a per-frame hurtbox: the region must actually differ between
    // frames, or it is just a rectangle bolted on for the swing's duration. (For
    // `slash` the two drawn frames happen to share a max reach of x+24 — the arc
    // sweeps down and in rather than further out — so compare the whole box.)
    for (const strip of Object.keys(FX_HURTBOX_FRAMES) as StripFXType[]) {
      const drawn = FX_HURTBOX_FRAMES[strip]
        .map((_, i) => fxHurtboxAt(strip, i * FX_FRAME_MS + 1, 0, 0, "right") as RectHitRegion | null)
        .filter((r): r is RectHitRegion => r !== null);
      if (drawn.length < 2) continue; // long-stab draws on a single frame
      const shapes = new Set(drawn.map(r => `${r.x},${r.y},${r.w},${r.h}`));
      expect(shapes.size, `${strip} draws an identical box on every frame`).toBeGreaterThan(1);
    }
  });
});

describe("measured creature hurt bounds", () => {
  it("gives every enemy a box with real extent", () => {
    for (const [id, b] of Object.entries(ENEMY_HURT_BOUNDS)) {
      expect(b.halfW, `${id}`).toBeGreaterThan(0);
      expect(b.halfH, `${id}`).toBeGreaterThan(0);
    }
  });

  it("keeps hurt bounds larger than the collision body — you can hit what you see", () => {
    for (const [id, b] of Object.entries(ENEMY_HURT_BOUNDS)) {
      expect(Math.max(b.halfW, b.halfH), `${id}`).toBeGreaterThan(ENTITY_RADIUS);
    }
    expect(Math.max(PLAYER_HURT_BOUNDS.halfW, PLAYER_HURT_BOUNDS.halfH))
      .toBeGreaterThan(ENTITY_RADIUS);
  });

  it("does not force non-square art into a square box", () => {
    // The whole reason bounds are a box rather than a radius. At least one
    // creature must actually be non-square, or the box buys nothing.
    const anyNonSquare = Object.values(ENEMY_HURT_BOUNDS).some(b => b.halfW !== b.halfH);
    expect(anyNonSquare).toBe(true);
  });
});
