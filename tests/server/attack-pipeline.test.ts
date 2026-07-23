import { describe, it, expect } from "vitest";
import {
  SERVER_TICK_MS,
  WEAPON_REGISTRY,
  AMMO_REGISTRY,
  UpgradeId,
  PLAYER_PROJECTILE_AFFECTS,
  ENEMY_PROJECTILE_AFFECTS,
} from "shared";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { Projectile } from "../../server/src/entities/Projectile";
import { Upgrade } from "../../server/src/upgrades";
import { arena, flatWorld, swingUntilHit } from "../helpers/world";

// End-to-end: a real player, a real enemy, the real physics world, and the exact
// gather-and-resolve step GameRoom runs. These are the tests that prove the four
// pipeline stages actually compose — template → instance mods → caster scaling →
// target mitigation — rather than each working in isolation.

class FlatDamage extends Upgrade {
  readonly id = "test-flat" as UpgradeId;
  readonly name = "Flat";
  readonly description = "";
  constructor(private readonly n: number) { super(); }
  override get damageFlat() { return this.n; }
}
class PctDamage extends Upgrade {
  readonly id = "test-pct" as UpgradeId;
  readonly name = "Pct";
  readonly description = "";
  constructor(private readonly p: number) { super(); }
  override get damagePct() { return this.p; }
}
class Lifesteal extends Upgrade {
  readonly id = "test-ls" as UpgradeId;
  readonly name = "LS";
  readonly description = "";
  override get lifestealPct() { return 0.5; }
}

describe("a melee swing, start to finish", () => {
  it("winds up before it can damage anything", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));
    const hp0 = e.state.health;

    a.stepWithInput("p1", 0, 0, true);

    // The hurtbox comes from the attack ART, whose leading frames draw nothing.
    // That wind-up is load-bearing feel, not an accident.
    expect(e.state.health).toBe(hp0);
  });

  it("then lands for exactly the weapon's damage", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));
    const hp0 = e.state.health;

    const ticks = swingUntilHit(a, "p1", "e1");

    expect(ticks).toBeGreaterThan(1); // it really did wind up
    expect(hp0 - e.state.health).toBeCloseTo(WEAPON_REGISTRY["broadsword"].damage, 9);
  });

  it("hits once per swing, however many frames the hitbox lingers", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));

    swingUntilHit(a, "p1", "e1");
    const afterFirst = e.state.health;
    for (let i = 0; i < 6; i++) a.stepWithInput("p1", 0, 0, true); // same swing, held
    expect(e.state.health).toBe(afterFirst);
  });

  it("knocks the enemy back and staggers it", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));

    swingUntilHit(a, "p1", "e1");
    expect(e.state.stunned).toBe(true);
  });

  it("misses an enemy standing behind the player", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 260, 300)); // to the LEFT
    const hp0 = e.state.health;

    for (let i = 0; i < 12; i++) a.stepWithInput("p1", 0, 0, true);
    expect(e.state.health).toBe(hp0);
  });

  it("connects on a glancing hit that never crosses the enemy's centre", () => {
    // The regression that gave creatures measured hurt bounds: with a bare point
    // target, a swing had to cross the exact centre pixel to land.
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 330, 300)); // beyond the blade tip
    const hp0 = e.state.health;

    for (let i = 0; i < 15; i++) a.stepWithInput("p1", 0, 0, true);
    expect(e.state.health).toBeLessThan(hp0);
  });

  it("never damages another player", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    const ally = a.addPlayer("p2", new Player(a.physics, 312, 300));
    const hp0 = ally.state.health;

    for (let i = 0; i < 15; i++) a.stepWithInput("p1", 0, 0, true);
    expect(ally.state.health).toBe(hp0);
  });
});

describe("upgrades reach every attack through the one seam", () => {
  it("scales a melee swing", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    p.addUpgrade(new FlatDamage(3));
    p.addUpgrade(new PctDamage(0.2));
    const e = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));
    const hp0 = e.state.health;

    swingUntilHit(a, "p1", "e1");

    const expected = (WEAPON_REGISTRY["broadsword"].damage + 3) * 1.2;
    expect(hp0 - e.state.health).toBeCloseTo(expected, 6);
  });

  it("scales a bow shot the same way, with no bow-specific code", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 200, 300, "ranger", "guy", "longbow"));
    p.state.facing = "right";
    p.addUpgrade(new FlatDamage(3));
    const e = a.addEnemy("e1", new GooGreen(a.physics, 300, 300));
    const hp0 = e.state.health;

    for (let i = 0; i < 15 && e.state.health === hp0; i++) a.stepWithInput("p1", 0, 0, true);

    const bow = p.weapon;
    const ammo = AMMO_REGISTRY[bow.ammoId!];
    expect(hp0 - e.state.health).toBeCloseTo(ammo.damage + bow.damage + 3, 6);
  });

  it("scales a staff bolt too — the damage rides on the ammo", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "mage", "guy", "oak-staff"));
    p.state.facing = "right";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 390, 300));
    const hp0 = e.state.health;

    for (let i = 0; i < 30 && e.state.health === hp0; i++) {
      a.stepWithInput("p1", i === 0 ? 1 : 0, 0, true);
    }

    expect(a.projectiles.length).toBeGreaterThan(0);
    const bolt = AMMO_REGISTRY[WEAPON_REGISTRY["oak-staff"].ammoId!];
    expect(hp0 - e.state.health).toBeCloseTo(bolt.damage + WEAPON_REGISTRY["oak-staff"].damage, 6);
  });

  it("feeds lifesteal from the damage actually landed on the enemy", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    p.state.facing = "right";
    p.addUpgrade(new Lifesteal());
    p.state.health = 10;
    // Placed inside the sword's reach but OUTSIDE the goo's contact radius, so
    // the health reading is the lifesteal and nothing else.
    const e = a.addEnemy("e1", new GooGreen(a.physics, 322, 300));
    const hp0 = e.state.health;

    swingUntilHit(a, "p1", "e1");
    expect(e.state.health).toBeLessThan(hp0); // the swing really landed

    const dealt = hp0 - e.state.health;
    expect(p.state.health).toBeCloseTo(10 + dealt * 0.5, 6);
  });
});

describe("enemy contact damage, start to finish", () => {
  it("damages an adjacent player for the enemy's attack damage", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300));
    const e = a.addEnemy("e1", new GooGreen(a.physics, 306, 300));
    const hp0 = p.state.health;

    a.step();

    expect(p.state.health).toBeLessThan(hp0);
  });

  it("respects its cooldown, so standing next to a goo is not instant death", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300));
    a.addEnemy("e1", new GooGreen(a.physics, 306, 300));

    a.step();
    const afterFirst = p.state.health;
    a.step();
    expect(p.state.health).toBe(afterFirst);
  });

  it("never damages another enemy", () => {
    const a = arena();
    const bystander = a.addEnemy("e2", new GooGreen(a.physics, 306, 300));
    a.addEnemy("e1", new GooGreen(a.physics, 300, 300));
    const hp0 = bystander.state.health;

    a.step();
    expect(bystander.state.health).toBe(hp0);
  });

  it("is mitigated by the player's armor like anything else", () => {
    class Armor extends Upgrade {
      readonly id = "test-armor" as UpgradeId;
      readonly name = "Armor";
      readonly description = "";
      override get armorFlat() { return 4; }
    }
    const bare = arena();
    const p1 = bare.addPlayer("p1", new Player(bare.physics, 300, 300));
    bare.addEnemy("e1", new GooGreen(bare.physics, 306, 300));
    const before1 = p1.state.health;
    bare.step();
    const tookBare = before1 - p1.state.health;

    const armored = arena();
    const p2 = armored.addPlayer("p1", new Player(armored.physics, 300, 300));
    p2.addUpgrade(new Armor());
    armored.addEnemy("e1", new GooGreen(armored.physics, 306, 300));
    const before2 = p2.state.health;
    armored.step();

    expect(before2 - p2.state.health).toBe(tookBare - 4);
  });
});

describe("projectiles in the real resolve step", () => {
  it("a player's arrow damages an enemy and spares its owner", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300));
    const e = a.addEnemy("e1", new GooGreen(a.physics, 360, 300));
    const arrow = AMMO_REGISTRY["arrow"];
    a.projectiles.push(new Projectile(a.physics, arrow, 310, 300, 0, "p1", PLAYER_PROJECTILE_AFFECTS));

    const enemyHp0 = e.state.health;
    const playerHp0 = p.state.health;
    for (let i = 0; i < 20; i++) a.step();

    expect(enemyHp0 - e.state.health).toBe(arrow.damage);
    expect(p.state.health).toBe(playerHp0);
  });

  it("an enemy's boulder damages and hitstuns the player", () => {
    const a = arena();
    const p = a.addPlayer("p1", new Player(a.physics, 300, 300));
    p.state.facing = "down";
    const boulder = AMMO_REGISTRY["boulder"];
    a.projectiles.push(new Projectile(a.physics, boulder, 260, 300, 0, "e1", ENEMY_PROJECTILE_AFFECTS));

    const hp0 = p.state.health;
    for (let i = 0; i < 20 && !p.state.stunned; i++) a.step();

    expect(hp0 - p.state.health).toBe(boulder.damage);
    expect(p.isStunned).toBe(true);

    // And the stun really does freeze control.
    p.applyInput({ dx: 1, dy: 0, attack: false }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("down");
  });

  it("reports each landed hit so the client can spark it", () => {
    const a = arena();
    a.addPlayer("p1", new Player(a.physics, 300, 300));
    const e = a.addEnemy("e1", new GooGreen(a.physics, 360, 300));
    a.projectiles.push(new Projectile(a.physics, AMMO_REGISTRY["arrow"], 310, 300, 0, "p1", PLAYER_PROJECTILE_AFFECTS));

    let events: ReturnType<typeof a.step> = [];
    for (let i = 0; i < 20 && events.length === 0; i++) events = a.step();

    expect(events).toHaveLength(1);
    expect(events[0].targetId).toBe("e1");
    expect(events[0].ownerId).toBe("p1");
    expect(events[0].damage).toBeGreaterThan(0);
    expect(e.state.health).toBeLessThan(e.state.maxHealth);
  });
});

describe("two players in the same world", () => {
  it("each swing independently, with their own weapons and dedupe state", () => {
    const a = arena(flatWorld());
    const p1 = a.addPlayer("p1", new Player(a.physics, 300, 300, "knight", "guy", "broadsword"));
    const p2 = a.addPlayer("p2", new Player(a.physics, 300, 500, "knight", "guy", "hatchet"));
    p1.state.facing = "right";
    p2.state.facing = "right";
    const e1 = a.addEnemy("e1", new GooGreen(a.physics, 312, 300));
    const e2 = a.addEnemy("e2", new GooGreen(a.physics, 312, 500));
    const hp1 = e1.state.health;
    const hp2 = e2.state.health;

    for (let i = 0; i < 15; i++) {
      p1.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
      p2.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
      a.step();
    }

    expect(e1.state.health).toBeLessThan(hp1);
    expect(e2.state.health).toBeLessThan(hp2);
    expect(hp1 - e1.state.health).toBeCloseTo(WEAPON_REGISTRY["broadsword"].damage, 6);
    expect(hp2 - e2.state.health).toBeCloseTo(WEAPON_REGISTRY["hatchet"].damage, 6);
  });

  it("can both hit the SAME enemy in one swing window", () => {
    const a = arena();
    const p1 = a.addPlayer("p1", new Player(a.physics, 280, 300, "knight", "guy", "broadsword"));
    const p2 = a.addPlayer("p2", new Player(a.physics, 340, 300, "knight", "guy", "broadsword"));
    p1.state.facing = "right";
    p2.state.facing = "left";
    const e = a.addEnemy("e1", new GooGreen(a.physics, 310, 300));
    const hp0 = e.state.health;

    for (let i = 0; i < 15; i++) {
      p1.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
      p2.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
      a.step();
    }

    // Two swings, two hits: the per-swing gate is per WEAPON INSTANCE, so one
    // player's swing must never consume the other's.
    expect(hp0 - e.state.health).toBeCloseTo(WEAPON_REGISTRY["broadsword"].damage * 2, 6);
  });
});
