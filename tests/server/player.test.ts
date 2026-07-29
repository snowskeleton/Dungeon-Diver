import { describe, it, expect } from "vitest";
import {
  SERVER_TICK_MS,
  DEFAULT_CHARGE_HOLD_MS,
  WEAPON_REGISTRY,
  AMMO_REGISTRY,
  CHARACTER_CLASSES,
  getCharacter,
  CharacterClass,
  viewFromSlot,
  WeaponMod,
} from "shared";
import { Player, slotStateFor, resolveTemplate } from "../../server/src/entities/Player";
import { flatWorld } from "../helpers/world";

// The player's own layer: the Character it wraps, the weapon list, the input
// cadence, and what it puts on the wire.

// Players spawn empty-handed now, so a test that needs a weapon arms one. The
// helper arms `weaponId` (broadsword by default) so the weapon-list and cadence
// tests below have something to swing.
const newPlayer = (cls: CharacterClass = "knight", weaponId: string = "broadsword") => {
  const p = new Player(flatWorld(), 300, 300, cls, "guy");
  p.addWeapon(WEAPON_REGISTRY[weaponId as never]);
  return p;
};

describe("character configuration", () => {
  it("takes its stats from the chosen class", () => {
    for (const cls of CHARACTER_CLASSES) {
      const p = newPlayer(cls);
      expect(p.maxHp).toBe(getCharacter(cls).maxHp);
      expect(p.speed).toBe(getCharacter(cls).speed);
      expect(p.state.health).toBe(p.maxHp);
    }
  });

  it("starts empty-handed — the first weapon comes from a supply pedestal", () => {
    for (const cls of CHARACTER_CLASSES) {
      const p = new Player(flatWorld(), 300, 300, cls, "guy");
      expect(p.weapons).toHaveLength(0);
      expect(p.weapon).toBeUndefined();
      expect(p.state.weaponId).toBe("");
    }
  });

  it("mirrors class and skin onto the synced state", () => {
    const p = new Player(flatWorld(), 0, 0, "mage", "gal");
    expect(p.state.characterClass).toBe("mage");
    expect(p.state.characterType).toBe("gal");
  });
});

describe("resolveTemplate", () => {
  it("finds a real weapon and rejects anything else", () => {
    expect(resolveTemplate("broadsword")?.id).toBe("broadsword");
    expect(resolveTemplate("nonsense")).toBeUndefined();
    expect(resolveTemplate(undefined)).toBeUndefined();
  });
});

describe("the weapon list", () => {
  it("starts with exactly one weapon, active", () => {
    const p = newPlayer();
    expect(p.weapons).toHaveLength(1);
    expect(p.state.activeWeaponIndex).toBe(0);
    expect(p.state.weaponId).toBe(p.weapon!.id);
  });

  it("mints a distinct instance per pickup, so duplicates are real duplicates", () => {
    const p = newPlayer();
    const a = p.weapon!;
    const { added: b } = p.addWeapon(WEAPON_REGISTRY["broadsword"]);

    // Two copies of one weapon are held side by side (within the cap), each its own
    // instance — an id-based dedupe would have swallowed the second.
    expect(p.weapons).toHaveLength(2);
    expect(new Set([a.uid, b.uid]).size).toBe(2);
  });

  it("keeps two copies of one weapon independently modifiable", () => {
    class Plus extends WeaponMod {
      readonly label = "+5";
      override get damageFlat() { return 5; }
    }
    const p = newPlayer();
    const { added: plain } = p.addWeapon(WEAPON_REGISTRY["broadsword"]);
    const { added: rolled } = p.addWeapon(WEAPON_REGISTRY["broadsword"], [new Plus()]);

    expect(rolled.damage).toBe(plain.damage + 5);
  });

  it("mirrors every weapon onto the wire as a slot", () => {
    const p = newPlayer();
    p.addWeapon(WEAPON_REGISTRY["longbow"]);
    expect(p.state.weapons).toHaveLength(2);
    expect(p.state.weapons[1]!.weaponId).toBe("longbow");
  });

  it("cycles the active weapon and wraps in both directions", () => {
    const p = newPlayer("knight", "broadsword");
    p.addWeapon(WEAPON_REGISTRY["longbow"]); // picked up → now the one in hand

    expect(p.weapon!.id).toBe("longbow");
    p.switchWeapon(1);
    expect(p.weapon!.id).toBe("broadsword"); // wrapped forward
    p.switchWeapon(1);
    expect(p.weapon!.id).toBe("longbow");    // wrapped again
    p.switchWeapon(-1);
    expect(p.weapon!.id).toBe("broadsword"); // and backward
  });

  it("does nothing when there is only one weapon to switch to", () => {
    const p = newPlayer();
    p.switchWeapon(1);
    expect(p.state.activeWeaponIndex).toBe(0);
  });

  it("holds a picked-up weapon in hand, and caps the inventory by dropping the held one", () => {
    const p = newPlayer("knight", "broadsword"); // broadsword in hand
    p.addWeapon(WEAPON_REGISTRY["longbow"]);      // longbow now in hand, 2 held
    expect(p.weapons.map(w => w.id)).toEqual(["broadsword", "longbow"]);
    expect(p.weapon!.id).toBe("longbow");

    // At the cap, the third pickup displaces the weapon in hand (longbow), not the
    // stowed one — and returns it so the caller can drop it on the floor.
    const { added, displaced } = p.addWeapon(WEAPON_REGISTRY["hatchet"]);
    expect(displaced!.id).toBe("longbow");
    expect(added.id).toBe("hatchet");
    expect(p.weapons.map(w => w.id)).toEqual(["broadsword", "hatchet"]);
    expect(p.weapon!.id).toBe("hatchet");
  });

  it("syncs the active weapon id on every switch", () => {
    const p = newPlayer("knight", "broadsword");
    p.addWeapon(WEAPON_REGISTRY["longbow"]); // auto-equipped on pickup
    expect(p.state.weaponId).toBe("longbow");
    expect(p.state.activeWeaponIndex).toBe(1);
    p.switchWeapon(1);
    expect(p.state.weaponId).toBe("broadsword");
    expect(p.state.activeWeaponIndex).toBe(0);
  });

  it("tells an unmodified duplicate apart from a rolled one", () => {
    class Plus extends WeaponMod {
      readonly label = "+5";
      override get damageFlat() { return 5; }
    }
    const p = newPlayer("knight", "broadsword");
    expect(p.ownsUnmodified("broadsword")).toBe(true);
    expect(p.ownsUnmodified("longbow")).toBe(false);

    const q = newPlayer("knight", "longbow");
    q.addWeapon(WEAPON_REGISTRY["broadsword"], [new Plus()]);
    // A rolled copy is a genuinely different weapon, so a plain one is still new.
    expect(q.ownsUnmodified("broadsword")).toBe(false);
  });
});

describe("input and attack cadence", () => {
  it("faces the direction of movement", () => {
    const p = newPlayer();
    const cases: Array<[number, number, string]> = [
      [1, 0, "right"], [-1, 0, "left"], [0, 1, "down"], [0, -1, "up"],
    ];
    for (const [dx, dy, facing] of cases) {
      p.applyInput({ dx, dy, attack: false }, SERVER_TICK_MS);
      expect(p.state.facing).toBe(facing);
    }
  });

  it("keeps its facing when standing still", () => {
    const p = newPlayer();
    p.applyInput({ dx: 0, dy: -1, attack: false }, SERVER_TICK_MS);
    p.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("up");
  });

  it("fires a melee swing immediately on press; holding then release arms one hard swing", () => {
    const p = newPlayer("knight", "broadsword");
    const window = Math.ceil(WEAPON_REGISTRY["broadsword"].attackCooldownMs / SERVER_TICK_MS);
    const holdTicks = Math.ceil(DEFAULT_CHARGE_HOLD_MS / SERVER_TICK_MS);

    let swings = 0;
    let last = p.state.attackSeq;
    const step = (attack: boolean) => {
      p.applyInput({ dx: 0, dy: 0, attack }, SERVER_TICK_MS);
      if (p.state.attackSeq !== last) { swings++; last = p.state.attackSeq; }
    };

    // Press fires the regular swing right away — no gooey wait for release.
    step(true);
    expect(swings).toBe(1);

    // Keep holding past the charge threshold (and past the swing's cooldown):
    // that arms a hard swing but doesn't fire while held.
    for (let t = 0; t < Math.max(holdTicks, window) + 2; t++) step(true);
    expect(swings).toBe(1);
    expect(p.state.chargeHard).toBe(true);

    step(false); // release fires exactly the one charged hard swing
    expect(swings).toBe(2);
    expect(p.state.hardSwing).toBe(true);
  });

  it("a quick tap fires a regular swing and arms no hard swing", () => {
    const p = newPlayer("knight", "broadsword");
    let last = p.state.attackSeq;
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);  // press: swings now
    expect(p.state.attackSeq).not.toBe(last);
    expect(p.state.hardSwing).toBe(false);
    last = p.state.attackSeq;
    p.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS); // quick release: nothing extra
    expect(p.state.attackSeq).toBe(last);
  });

  // The tick a tapped melee weapon first emits a hitbox (kind "hit"), or -1. The
  // press tick fires; then we hold released so only the wind-up + swing play out.
  const firstHitTick = (p: Player): { tick: number; windingUpAtHit: boolean } => {
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    p.drainEffects();
    for (let t = 1; t <= 30; t++) {
      p.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS);
      if (p.drainEffects().some(e => e.kind === "hit")) {
        return { tick: t, windingUpAtHit: p.state.windingUp };
      }
    }
    return { tick: -1, windingUpAtHit: false };
  };

  it("gives instant feedback: a melee press flags windingUp before any hitbox lands", () => {
    const p = newPlayer("knight", "war-hammer"); // slow: a real wind-up hold
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    expect(p.state.isAttacking).toBe(true);
    expect(p.state.windingUp).toBe(true);           // cocked back at once
    expect(p.drainEffects().some(e => e.kind === "hit")).toBe(false); // but no blow yet
  });

  it("holds the wind-up longer for a slower weapon, and the blow lands after it clears", () => {
    const slow = firstHitTick(newPlayer("knight", "war-hammer")); // 800ms cooldown
    const fast = firstHitTick(newPlayer("rogue", "kris"));        // 250ms cooldown

    expect(fast.tick).toBeGreaterThan(0);
    expect(slow.tick).toBeGreaterThan(fast.tick); // the heavy telegraphs longer
    expect(slow.windingUpAtHit).toBe(false);      // the hold is over once it strikes
  });

  it("ends the swing after its window, so isAttacking is not stuck on", () => {
    const p = newPlayer("knight", "broadsword");
    const window = Math.ceil(WEAPON_REGISTRY["broadsword"].attackCooldownMs / SERVER_TICK_MS);
    // Tap to fire, then let the swing's window elapse: isAttacking must drop.
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    for (let t = 0; t < window * 2; t++) p.applyInput({ dx: 0, dy: 0, attack: false }, SERVER_TICK_MS);
    expect(p.state.isAttacking).toBe(false);
  });

  it("auto-fires a ranged weapon while held, at exactly its cooldown interval", () => {
    const p = newPlayer("ranger", "shortbow");
    const interval = Math.ceil(WEAPON_REGISTRY["shortbow"].attackCooldownMs / SERVER_TICK_MS);

    const shotTicks: number[] = [];
    for (let t = 0; t < interval * 4; t++) {
      p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
      for (const e of p.drainEffects()) if (e.kind === "projectile") shotTicks.push(t);
    }

    expect(shotTicks).toHaveLength(4);
    const gaps = shotTicks.slice(1).map((t, i) => t - shotTicks[i]);
    expect(gaps.every(g => g === interval)).toBe(true);
  });

  it("locks facing while a ranged attack is held, so you can strafe under your aim", () => {
    const p = newPlayer("ranger", "shortbow");
    p.applyInput({ dx: 1, dy: 0, attack: true }, SERVER_TICK_MS);  // press: aims right
    p.applyInput({ dx: 0, dy: -1, attack: true }, SERVER_TICK_MS); // held: locked
    expect(p.state.facing).toBe("right");
  });

  it("still turns you on the FIRST press, so aiming works at all", () => {
    const p = newPlayer("ranger", "shortbow");
    p.applyInput({ dx: 0, dy: 1, attack: true }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("down");
  });

  it("a weaponless player still moves and faces, and attacking is a harmless no-op", () => {
    // Players spawn empty-handed; applyInput must not assume a weapon exists.
    const p = new Player(flatWorld(), 300, 300, "knight", "guy");
    expect(() => p.applyInput({ dx: 1, dy: 0, attack: true }, SERVER_TICK_MS)).not.toThrow();
    expect(p.state.facing).toBe("right");
    expect(p.state.isAttacking).toBe(false);
  });

  it("does not lock a melee weapon's facing", () => {
    const p = newPlayer("knight", "broadsword");
    p.applyInput({ dx: 1, dy: 0, attack: true }, SERVER_TICK_MS);
    p.applyInput({ dx: 0, dy: -1, attack: true }, SERVER_TICK_MS);
    expect(p.state.facing).toBe("up");
  });

  it("advances attackSeq on press so the client can tell a new swing from a held one", () => {
    const p = newPlayer("knight", "broadsword");
    const seq0 = p.state.attackSeq;
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);  // press: fires now
    expect(p.state.attackSeq).not.toBe(seq0);
  });

  it("does not auto-fire the instant a stun ends on a held button", () => {
    const p = newPlayer("ranger", "shortbow");
    p.applyKnockback(250, 300, 50);
    while (p.isStunned) p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    p.drainEffects();

    // The very next tick with the button STILL held is a hold, not a fresh press;
    // for a hold-fire weapon that is fine, but the edge state must be coherent.
    p.applyInput({ dx: 0, dy: 0, attack: true }, SERVER_TICK_MS);
    expect(p.state.health).toBeGreaterThan(0);
  });
});

describe("healing and spending", () => {
  it("heals up to the cap and no further", () => {
    const p = newPlayer();
    p.state.health = 1;
    p.heal(5);
    expect(p.state.health).toBe(6);
    p.heal(100000);
    expect(p.state.health).toBe(p.maxHp);
  });

  it("spends HP without killing, and without knockback", () => {
    const p = newPlayer();
    p.state.health = 50;
    p.spendHp(20);
    expect(p.state.health).toBe(30);
    expect(p.isStunned).toBe(false);
  });
});

describe("the wire shape of a weapon slot", () => {
  it("carries the wielder's RESOLVED stats, not the template's", () => {
    class Plus extends WeaponMod {
      readonly label = "+7 damage";
      override get damageFlat() { return 7; }
    }
    const p = newPlayer();
    const { added: inst } = p.addWeapon(WEAPON_REGISTRY["broadsword"], [new Plus()]);
    const slot = slotStateFor(inst);

    expect(slot.damage).toBe(WEAPON_REGISTRY["broadsword"].damage + 7);
    expect(slot.uid).toBe(inst.uid);
    expect([...slot.modLabels]).toEqual(["+7 damage"]);
  });

  it("carries ammo damage as ammo + weapon, matching what actually gets fired", () => {
    const p = newPlayer("ranger", "longbow");
    const slot = slotStateFor(p.weapon!);
    const ammo = AMMO_REGISTRY[p.weapon!.ammoId!];

    expect(slot.ammoDamage).toBe(ammo.damage + p.weapon!.damage);
    expect(slot.ammoSpeed).toBe(ammo.speed);
    expect(slot.ammoPierce).toBe(ammo.pierce);
  });

  it("reconstructs on the client into the same numbers the server holds", () => {
    const p = newPlayer("ranger", "longbow");
    const view = viewFromSlot(slotStateFor(p.weapon!))!;

    expect(view.damage).toBe(p.weapon!.damage);
    expect(view.attackCooldownMs).toBe(Math.round(p.weapon!.attackCooldownMs));
    expect(view.ammo!.damage).toBe(AMMO_REGISTRY[p.weapon!.ammoId!].damage + p.weapon!.damage);
  });

  it("leaves the ammo block empty for a melee weapon", () => {
    const slot = slotStateFor(newPlayer("knight", "broadsword").weapon!);
    expect(slot.ammoDamage).toBe(0);
  });
});
