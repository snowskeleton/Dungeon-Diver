import { describe, it, expect } from "vitest";
import {
  Elevation, ELEVATION_ALL, Layer, TILE,
  BLINK_DISTANCE, BLINK_HIDDEN_MS, VAULT_PEAK_HEIGHT, AIRBORNE_HEIGHT_THRESHOLD,
  SERVER_TICK_MS, TILE_SIZE, TileId,
} from "shared";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { Bat } from "../../server/src/entities/enemies/bats";
import { CombatSystem } from "../../server/src/combat/CombatSystem";
import { flatWorld, worldWithTile, arena, physicsTick, COLS, ROWS } from "../helpers/world";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";

// Movement abilities are class Spells run through the Player's second SpellCaster.
// These assert the BEHAVIOUR (i-frames, elevation dodge, teleport clamp, cooldown
// gating), never the tuned numbers.

// A press is a rising edge, so ability must go false→true. `press` fires it on the
// first tick; hold ability false afterwards to let a channel run to completion.
function pressAbility(a: ReturnType<typeof arena>, id: string, dx: number, dy: number) {
  a.stepWithInput(id, dx, dy, false, true);
}

// Blink is no longer instant: the Mage vanishes on the press, is gone for the
// BLINK_HIDDEN_MS gap, then teleports as that gap ends. Fire the press, then hold
// ability false long enough for the gap to run out and the relocation to land.
function castBlink(a: ReturnType<typeof arena>, id: string, dx: number, dy: number) {
  pressAbility(a, id, dx, dy);
  const gapTicks = Math.ceil(BLINK_HIDDEN_MS / SERVER_TICK_MS) + 1;
  for (let t = 0; t < gapTicks; t++) a.stepWithInput(id, dx, dy, false, false);
}

describe("elevation: which band an attack reaches", () => {
  it("a grounded enemy's contact reaches GROUND only; a flyer's reaches both bands", () => {
    const w = flatWorld();
    const goo = new GooGreen(w, 300, 300);
    const bat = new Bat(w, 300, 300);
    expect(goo.elevationReach).toBe(Elevation.GROUND);
    expect(goo.contactHitSource("g")!.reaches).toBe(Elevation.GROUND);
    expect(bat.elevationReach).toBe(ELEVATION_ALL);
    expect(bat.contactHitSource("b")!.reaches).toBe(ELEVATION_ALL);
  });

  it("an airborne player dodges a ground attack but a flyer still connects", () => {
    const w = flatWorld();
    const combat = new CombatSystem();
    const player = new Player(w, 300, 300, "ranger", "colt");
    const players = new Map([["p", player]]);
    const groups = [{ layer: Layer.PLAYER, targets: players as never }];

    // Fresh enemies per resolve — a landed contact consumes the enemy's attack
    // cooldown, so reusing one would return no source the second time.
    const grounded = () => new GooGreen(w, 300, 300).contactHitSource("g")!;
    const flyer = () => new Bat(w, 300, 300).contactHitSource("b")!;

    // Grounded player: the ground attack lands.
    player.state.airHeight = 0;
    const hp0 = player.state.health;
    combat.resolve([grounded()], groups);
    expect(player.state.health).toBeLessThan(hp0);

    // Airborne player: the ground attack whiffs, the flyer connects.
    player.state.health = 100;
    player.state.airHeight = VAULT_PEAK_HEIGHT;
    expect(player.elevation).toBe(Elevation.AIR);
    combat.resolve([grounded()], groups);
    expect(player.state.health).toBe(100); // ground attack dodged
    combat.resolve([flyer()], groups);
    expect(player.state.health).toBeLessThan(100); // flyer still hits
  });

  it("an airborne player takes no fire-tile damage", () => {
    // A fire (damage) tile under the player.
    const col = 9;
    const row = 9;
    const w = worldWithTile(col, row, TILE.FIRE);
    const player = new Player(w, col * TILE_SIZE + 16, row * TILE_SIZE + 16, "ranger", "colt");

    // Grounded: the fire tile burns over its damage intervals.
    player.state.airHeight = 0;
    const before = player.state.health;
    for (let i = 0; i < 40; i++) player.applyTileEffects(50);
    expect(player.state.health).toBeLessThan(before);

    // Airborne over the same fire: no damage at all — leapt clean over it.
    player.state.health = 100;
    player.state.airHeight = VAULT_PEAK_HEIGHT;
    for (let i = 0; i < 40; i++) player.applyTileEffects(50);
    expect(player.state.health).toBe(100);
  });
});

describe("Blink (Mage): delayed clamped teleport", () => {
  it("relocates roughly the blink distance along the heading", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "mage", "skeleton-mage");
    a.addPlayer("m", p);
    castBlink(a, "m", 1, 0);
    expect(p.state.x).toBeGreaterThan(300 + BLINK_DISTANCE * 0.8);
    expect(p.state.y).toBeCloseTo(300, 0);
  });

  it("is gone (hidden + frozen at the origin) during the gap, then jumps", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "mage", "skeleton-mage");
    a.addPlayer("m", p);
    // The press starts the gap: hidden, still at the origin (no teleport yet).
    pressAbility(a, "m", 1, 0);
    expect(p.state.blinkHidden).toBe(true);
    expect(p.state.x).toBeCloseTo(300, 0);
    // Run the gap out — reappears at the destination, no longer hidden.
    const gapTicks = Math.ceil(BLINK_HIDDEN_MS / SERVER_TICK_MS) + 1;
    for (let t = 0; t < gapTicks; t++) a.stepWithInput("m", 1, 0, false, false);
    expect(p.state.blinkHidden).toBe(false);
    expect(p.state.x).toBeGreaterThan(300 + BLINK_DISTANCE * 0.8);
  });

  it("never lands inside a wall — clamps short", () => {
    const map: TileId[][] = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => TILE.FLOOR),
    );
    // Wall column just ahead of the player, within blink range.
    const startCol = 9;
    const wallCol = startCol + 3;
    for (let r = 0; r < ROWS; r++) map[r][wallCol] = TILE.WALL;
    const physics = new PhysicsWorld(map, COLS, ROWS);
    const a = arena(physics);
    const startX = startCol * TILE_SIZE + 16;
    const p = new Player(physics, startX, 300, "mage", "skeleton-mage");
    a.addPlayer("m", p);
    castBlink(a, "m", 1, 0);
    // Landed short of the wall, and on a walkable tile.
    expect(p.state.x).toBeLessThan(wallCol * TILE_SIZE);
    expect(p.state.x).toBeGreaterThan(startX); // still moved some
  });

  it("respects its cooldown — a second immediate press does nothing", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "mage", "skeleton-mage");
    a.addPlayer("m", p);
    castBlink(a, "m", 1, 0);
    const afterFirst = p.state.x;
    expect(p.state.abilityCooldownFrac).toBeLessThan(1); // on cooldown now
    // Press again immediately — still cooling down, so no second teleport.
    castBlink(a, "m", 1, 0);
    expect(p.state.x).toBeCloseTo(afterFirst, 0);
  });

  it("cannot be cast while downed", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "mage", "skeleton-mage");
    a.addPlayer("m", p);
    p.setDowned(true);
    pressAbility(a, "m", 1, 0);
    expect(p.state.x).toBeCloseTo(300, 0);
  });
});

describe("Dash (Rogue): i-frames + phase through enemies", () => {
  it("takes no damage from a touching enemy during the dash", () => {
    // Control: a stationary rogue overlapping a goo takes contact damage.
    const control = arena();
    const cp = new Player(control.physics, 300, 300, "rogue", "guy");
    control.addPlayer("r", cp);
    control.addEnemy("g", new GooGreen(control.physics, 300, 300));
    const cpFull = cp.state.health;
    control.step(); // enemy contact resolves against the grounded, non-dashing player
    expect(cp.state.health).toBeLessThan(cpFull);

    // With the dash: press it and hold through the (short) active window — the
    // player is invulnerable, so the overlapping goo deals nothing. No physicsTick,
    // so the two stay overlapping and only the i-frames spare the player.
    const a = arena();
    const p = new Player(a.physics, 300, 300, "rogue", "guy");
    a.addPlayer("r", p);
    a.addEnemy("g", new GooGreen(a.physics, 300, 300));
    const full = p.state.health; // Rogue's own max (not 100) — capture it
    pressAbility(a, "r", 1, 0); // dash begins; phase becomes active this tick
    // Assert invulnerability on every tick the dash is active. The check runs at
    // the START of each iteration (reading the previous tick's resolved health), so
    // we only ever assert on fully-active ticks — the tick the dash ENDS resolves
    // after the phase flips and is out of scope, which is correct.
    let activeChecks = 0;
    for (let i = 0; i < 8; i++) {
      if (p.state.abilityId !== "dash") break;
      expect(p.state.health).toBe(full); // untouched while the dash is active
      activeChecks++;
      a.stepWithInput("r", 1, 0, false, false);
    }
    expect(activeChecks).toBeGreaterThan(0); // the dash really was active across ticks
  });

  it("drops ENEMY from the solid mask while dashing (phase-through)", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "rogue", "guy");
    a.addPlayer("r", p);
    pressAbility(a, "r", 1, 0);
    expect(p.activeMovementMaskDrop & Layer.ENEMY).toBe(Layer.ENEMY);
  });
});

describe("Charge (Knight): an offensive rush", () => {
  it("damages an enemy in its path", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "knight", "guy");
    a.addPlayer("k", p);
    const goo = new GooGreen(a.physics, 336, 300); // just ahead, to the right
    a.addEnemy("g", goo);
    const hp0 = goo.state.health;
    pressAbility(a, "k", 1, 0);
    for (let i = 0; i < 6; i++) {
      a.stepWithInput("k", 1, 0, false, false);
      physicsTick(a.physics, [p, goo]);
    }
    expect(goo.state.health).toBeLessThan(hp0);
  });
});

describe("Vault (Ranger): an arced leap", () => {
  it("rises above the airborne threshold then lands back down", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "ranger", "colt");
    a.addPlayer("v", p);
    pressAbility(a, "v", 1, 0);
    let peak = 0;
    let sawGround = false;
    for (let i = 0; i < 14; i++) {
      a.stepWithInput("v", 1, 0, false, false);
      peak = Math.max(peak, p.state.airHeight);
      if (p.state.abilityId === "" && p.state.airHeight === 0) sawGround = true;
    }
    expect(peak).toBeGreaterThan(AIRBORNE_HEIGHT_THRESHOLD); // genuinely airborne mid-arc
    expect(sawGround).toBe(true); // and back on the floor after the arc
  });

  it("phases over cover AND enemies while airborne (mask drop)", () => {
    const a = arena();
    const p = new Player(a.physics, 300, 300, "ranger", "colt");
    a.addPlayer("v", p);
    pressAbility(a, "v", 1, 0);
    a.stepWithInput("v", 1, 0, false, false); // into the active arc
    const drop = p.activeMovementMaskDrop;
    expect(drop & Layer.ENEMY).toBe(Layer.ENEMY);
    expect(drop & Layer.COVER).toBe(Layer.COVER);
  });

  it("is NOT blanket-invulnerable — a flyer catches it, a ground attack whiffs, mid-leap", () => {
    const a = arena();
    const combat = new CombatSystem();
    const p = new Player(a.physics, 300, 300, "ranger", "colt");
    a.addPlayer("v", p);
    const groups = [{ layer: Layer.PLAYER, targets: a.players as never }];
    pressAbility(a, "v", 1, 0);
    // On the first genuinely-airborne tick, a fresh flyer's BOTH-band contact lands
    // while a fresh grounded contact whiffs — the whole point of the Vault vs Dash.
    let tested = false;
    for (let i = 0; i < 12 && !tested; i++) {
      a.stepWithInput("v", 0, 0, false, false);
      if (p.state.airHeight <= AIRBORNE_HEIGHT_THRESHOLD) continue;
      const hpA = p.state.health;
      combat.resolve([new Bat(a.physics, p.state.x, p.state.y).contactHitSource("bx")!], groups);
      expect(p.state.health).toBeLessThan(hpA); // flyer connects mid-leap
      const hpB = p.state.health;
      combat.resolve([new GooGreen(a.physics, p.state.x, p.state.y).contactHitSource("gx")!], groups);
      expect(p.state.health).toBe(hpB); // ground attack whiffs mid-leap
      tested = true;
    }
    expect(tested).toBe(true);
  });
});
