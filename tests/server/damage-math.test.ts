import { describe, it, expect } from "vitest";
import { Attack, UpgradeId } from "shared";
import { Upgrade } from "../../server/src/upgrades";
import { Player } from "../../server/src/entities/Player";
import { GooGreen } from "../../server/src/entities/enemies/goos";
import { flatWorld } from "../helpers/world";

// The arithmetic of taking a hit, asserted as arithmetic. These tests are written
// against RELATIONSHIPS (10 damage removes 10 HP; 15 through 7 armor removes 8),
// never against a shipping balance number, so retuning a weapon or a goo's HP
// pool cannot make them fail.

/** Test-local upgrades: a stat contributor of an exact size, so the assertions
 *  can use round numbers instead of whatever the live upgrade set happens to
 *  grant. Upgrades are OO, so a bespoke one is just a subclass. */
class FlatArmor extends Upgrade {
  readonly id = "test-armor" as UpgradeId;
  readonly name = "Test Armor";
  readonly description = "";
  constructor(private readonly n: number) { super(); }
  override get armorFlat() { return this.n; }
}

class PctArmor extends Upgrade {
  readonly id = "test-armor-pct" as UpgradeId;
  readonly name = "Test Armor %";
  readonly description = "";
  constructor(private readonly p: number) { super(); }
  override get armorPct() { return this.p; }
}

class Lifesteal extends Upgrade {
  readonly id = "test-lifesteal" as UpgradeId;
  readonly name = "Test Lifesteal";
  readonly description = "";
  constructor(private readonly p: number) { super(); }
  override get lifestealPct() { return this.p; }
}

class FlatDamage extends Upgrade {
  readonly id = "test-damage" as UpgradeId;
  readonly name = "Test Damage";
  readonly description = "";
  constructor(private readonly n: number) { super(); }
  override get damageFlat() { return this.n; }
}

class PctDamage extends Upgrade {
  readonly id = "test-damage-pct" as UpgradeId;
  readonly name = "Test Damage %";
  readonly description = "";
  constructor(private readonly p: number) { super(); }
  override get damagePct() { return this.p; }
}

class MaxHp extends Upgrade {
  readonly id = "test-maxhp" as UpgradeId;
  readonly name = "Test Max HP";
  readonly description = "";
  constructor(private readonly flat: number, private readonly pct = 0) { super(); }
  override get maxHpFlat() { return this.flat; }
  override get maxHpPct() { return this.pct; }
}

const hit = (damage: number): Attack => ({ damage, knockback: 0, sourceX: 0, sourceY: 0 });

const newPlayer = () => new Player(flatWorld(), 300, 300);

describe("taking damage", () => {
  it("removes exactly the damage dealt", () => {
    const enemy = new GooGreen(flatWorld(), 0, 0);
    const before = enemy.state.health;

    const dealt = enemy.takeHit(hit(10));

    expect(dealt).toBe(10);
    expect(enemy.state.health).toBe(before - 10);
  });

  it("accumulates across hits", () => {
    const enemy = new GooGreen(flatWorld(), 0, 0);
    const before = enemy.state.health;

    enemy.takeHit(hit(3));
    enemy.takeHit(hit(4));

    expect(enemy.state.health).toBe(before - 7);
  });

  it("reports only the HP it could actually remove when a hit overkills", () => {
    const enemy = new GooGreen(flatWorld(), 0, 0);
    enemy.state.health = 4;

    // A 1000-damage blow on a 4 HP enemy dealt 4 — the number lifesteal must see.
    expect(enemy.takeHit(hit(1000))).toBe(4);
    expect(enemy.state.health).toBe(0);
  });

  it("never drives health below zero", () => {
    const enemy = new GooGreen(flatWorld(), 0, 0);
    enemy.takeHit(hit(99999));
    expect(enemy.state.health).toBe(0);
  });

  it("absorbs nothing once already dying — a corpse can't be farmed", () => {
    const enemy = new GooGreen(flatWorld(), 0, 0);
    enemy.takeHit(hit(99999));
    expect(enemy.isDying).toBe(true);

    expect(enemy.takeHit(hit(10))).toBe(0);
  });
});

describe("armor", () => {
  it("subtracts flat armor: 15 damage through 7 armor lands as 8", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatArmor(7));
    p.state.health = p.maxHp;

    const took = p.takeHit(hit(15));

    expect(took).toBe(8);
    expect(p.state.health).toBe(p.maxHp - 8);
  });

  it("does nothing at all when the player has no armor", () => {
    const p = newPlayer();
    expect(p.takeHit(hit(15))).toBe(15);
  });

  it("sums flat armor from several sources", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatArmor(4));
    p.addUpgrade(new FlatArmor(3));

    expect(p.takeHit(hit(15))).toBe(8); // 15 − (4+3)
  });

  it("applies percent armor BEFORE flat armor", () => {
    const p = newPlayer();
    p.addUpgrade(new PctArmor(0.5));
    p.addUpgrade(new FlatArmor(2));

    // 20 × (1 − 0.5) = 10, then − 2 = 8. The other order would give 9.
    expect(p.takeHit(hit(20))).toBe(8);
  });

  it("floors every hit at 1 damage, no matter how much armor is stacked", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatArmor(1000));

    expect(p.takeHit(hit(15))).toBe(1);
    expect(p.takeHit(hit(1))).toBe(1);
  });

  it("does not mitigate knockback — being shoved is a positioning problem", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatArmor(1000));
    p.state.x = 300;

    p.takeHit({ damage: 15, knockback: 20, sourceX: 200, sourceY: 300 });

    expect(p.isStunned).toBe(true);
  });
});

describe("lifesteal", () => {
  it("heals a fraction of the damage actually dealt", () => {
    const p = newPlayer();
    p.addUpgrade(new Lifesteal(0.1));
    p.state.health = p.maxHp - 5;

    p.onDamageDealt(20);

    expect(p.state.health).toBeCloseTo(p.maxHp - 3, 9); // healed 2
  });

  it("cannot overheal past max HP", () => {
    const p = newPlayer();
    p.addUpgrade(new Lifesteal(0.1));
    p.state.health = p.maxHp - 1;

    p.onDamageDealt(1000);

    expect(p.state.health).toBe(p.maxHp);
  });

  it("heals nothing without the upgrade", () => {
    const p = newPlayer();
    p.state.health = 10;
    p.onDamageDealt(100);
    expect(p.state.health).toBe(10);
  });

  it("heals nothing from a hit that dealt nothing", () => {
    const p = newPlayer();
    p.addUpgrade(new Lifesteal(0.5));
    p.state.health = 10;
    p.onDamageDealt(0);
    expect(p.state.health).toBe(10);
  });
});

describe("outgoing damage scaling", () => {
  it("is the identity for a player with no upgrades", () => {
    const p = newPlayer();
    expect(p.scaleAttack({ damage: 10, knockback: 5 })).toEqual({ damage: 10, knockback: 5 });
  });

  it("adds flat before multiplying percent", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatDamage(3));
    p.addUpgrade(new PctDamage(0.2));

    // (10 + 3) × 1.2 = 15.6. Multiplying first would give 15.
    expect(p.scaleAttack({ damage: 10, knockback: 0 }).damage).toBeCloseTo(15.6, 9);
  });

  it("sums percentages rather than compounding them", () => {
    const p = newPlayer();
    p.addUpgrade(new PctDamage(0.5));
    p.addUpgrade(new PctDamage(0.5));

    // 10 × (1 + 0.5 + 0.5) = 20, not 10 × 1.5 × 1.5 = 22.5.
    expect(p.scaleAttack({ damage: 10, knockback: 0 }).damage).toBeCloseTo(20, 9);
  });

  it("gives the same result regardless of pickup order", () => {
    const a = newPlayer();
    a.addUpgrade(new FlatDamage(3));
    a.addUpgrade(new PctDamage(0.2));

    const b = newPlayer();
    b.addUpgrade(new PctDamage(0.2));
    b.addUpgrade(new FlatDamage(3));

    expect(a.scaleAttack({ damage: 10, knockback: 0 }).damage)
      .toBe(b.scaleAttack({ damage: 10, knockback: 0 }).damage);
  });

  it("leaves knockback untouched", () => {
    const p = newPlayer();
    p.addUpgrade(new FlatDamage(100));
    expect(p.scaleAttack({ damage: 1, knockback: 5 }).knockback).toBe(5);
  });
});

describe("max health changes", () => {
  it("grants the delta to current health rather than preserving the ratio", () => {
    const p = newPlayer();
    const base = p.maxHp;
    p.state.health = 10; // nearly dead

    p.addUpgrade(new MaxHp(20));

    expect(p.maxHp).toBe(base + 20);
    expect(p.state.health).toBe(30); // a +max-HP pick is a real heal at 10 HP
  });

  it("clamps current health down when max health drops", () => {
    const p = newPlayer();
    const base = p.maxHp;

    p.addUpgrade(new MaxHp(0, -0.15));

    expect(p.maxHp).toBeLessThan(base);
    expect(p.state.health).toBe(p.maxHp);
  });

  it("mirrors max health onto the synced state", () => {
    const p = newPlayer();
    p.addUpgrade(new MaxHp(20));
    expect(p.state.maxHp).toBe(p.maxHp);
  });

  it("never folds below 1 max HP", () => {
    const p = newPlayer();
    p.addUpgrade(new MaxHp(-100000));
    expect(p.maxHp).toBe(1);
  });

  it("spendHp is never lethal — the store cannot kill you", () => {
    const p = newPlayer();
    p.spendHp(100000);
    expect(p.state.health).toBe(1);
  });
});
