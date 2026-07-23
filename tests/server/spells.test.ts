import { describe, it, expect, vi } from "vitest";
import { Facing, Attack, PLAYER_ATTACK_AFFECTS, WEAPON_REGISTRY, WeaponInstance, WeaponMod, WeaponId, Weapon, WeaponCategory, AMMO_REGISTRY } from "shared";
import { Spell, SpellOpts, Caster, AttackStats } from "../../server/src/spells/Spell";
import { SpellCaster } from "../../server/src/spells/SpellCaster";
import { weaponSpell } from "../../server/src/spells/weaponSpell";
import { HitSource } from "../../server/src/combat/HitSource";

// The cast lifecycle is the one runner every attack in the game goes through, so
// its phase machine is tested directly rather than inferred from a boss fight.

/** A minimal Caster that records what a spell produced. */
class RecordingCaster implements Caster {
  x = 0;
  y = 0;
  facing: Facing = "right";
  attackAffects = PLAYER_ATTACK_AFFECTS;
  sources: HitSource[] = [];
  shots: Array<{ ammoId: string; x: number; y: number; angle: number; opts?: unknown }> = [];
  healed: number[] = [];
  /** Multiplier applied by scaleAttack, so the pipeline can be traced. */
  scale = 1;

  emitHitSource(source: HitSource): void {
    this.sources.push(source);
  }

  spawnProjectile = (ammoId: string, x: number, y: number, angle: number, opts?: unknown) => {
    this.shots.push({ ammoId, x, y, angle, opts });
  };

  scaleAttack(base: AttackStats): AttackStats {
    return { damage: base.damage * this.scale, knockback: base.knockback };
  }

  buildAttack(base: AttackStats, sourceX: number, sourceY: number): Attack {
    const s = this.scaleAttack(base);
    return { damage: s.damage, knockback: s.knockback, sourceX, sourceY };
  }

  onDamageDealt(damage: number): void {
    this.healed.push(damage);
  }
}

const AIM = { x: 100, y: 0 };

function spell(over: Partial<SpellOpts> = {}): Spell {
  return new Spell({
    id: "test",
    windUpMs: 0,
    activeMs: 0,
    recoverMs: 0,
    cooldownMs: 0,
    range: 100,
    aimLockMs: 0,
    effect: {},
    ...over,
  });
}

describe("SpellCaster lifecycle", () => {
  it("starts idle and not busy", () => {
    const sc = new SpellCaster();
    expect(sc.phase).toBe("idle");
    expect(sc.busy).toBe(false);
    expect(sc.activeSpellId).toBe("");
  });

  it("runs windup → active → recover → idle in order", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ windUpMs: 100, activeMs: 100, recoverMs: 100 }), AIM);

    expect(sc.phase).toBe("windup");
    sc.update(caster, 100, AIM);
    expect(sc.phase).toBe("active");
    sc.update(caster, 100, AIM);
    expect(sc.phase).toBe("recover");
    const finished = sc.update(caster, 100, AIM);
    expect(sc.phase).toBe("idle");
    expect(finished).toBe(true); // reported exactly once, on the finishing tick
  });

  it("fires onActivate exactly once, on the strike frame", () => {
    const onActivate = vi.fn();
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ windUpMs: 100, activeMs: 200, effect: { onActivate } }), AIM);

    sc.update(caster, 50, AIM);
    expect(onActivate).not.toHaveBeenCalled(); // still winding up
    sc.update(caster, 50, AIM);
    expect(onActivate).toHaveBeenCalledTimes(1);
    sc.update(caster, 50, AIM);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("skips the active phase entirely for an instant spell", () => {
    const onActiveTick = vi.fn();
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ windUpMs: 0, activeMs: 0, recoverMs: 100, effect: { onActiveTick } }), AIM);

    sc.update(caster, 10, AIM);
    expect(sc.phase).toBe("recover");
    expect(onActiveTick).not.toHaveBeenCalled();
  });

  it("goes straight to idle when there is no recovery, so a hold can re-fire", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ windUpMs: 0, activeMs: 0, recoverMs: 0 }), AIM);

    sc.update(caster, 10, AIM);
    expect(sc.phase).toBe("idle");
    expect(sc.busy).toBe(false);
  });

  it("ticks the active phase each tick until its timer expires", () => {
    const onActiveTick = vi.fn();
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ activeMs: 300, effect: { onActiveTick } }), AIM);

    // The strike happens on the first update (begin only arms the wind-up), so
    // the active phase starts one tick in and needs four updates to run 300ms.
    for (let i = 0; i < 4; i++) sc.update(caster, 100, AIM);
    expect(onActiveTick).toHaveBeenCalledTimes(3);
    expect(sc.phase).toBe("idle");
  });

  it("lets an effect end its active phase early by returning true", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ activeMs: 10_000, effect: { onActiveTick: () => true } }), AIM);

    sc.update(caster, 50, AIM); // strike → active
    sc.update(caster, 50, AIM); // first active tick asks to stop
    expect(sc.phase).toBe("idle");
  });

  it("calls onDeactivate once when the active phase ends", () => {
    const onDeactivate = vi.fn();
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ activeMs: 100, recoverMs: 100, effect: { onDeactivate } }), AIM);

    sc.update(caster, 100, AIM); // strike → active
    expect(onDeactivate).not.toHaveBeenCalled();
    sc.update(caster, 100, AIM); // active expires
    expect(onDeactivate).toHaveBeenCalledTimes(1);
    sc.update(caster, 100, AIM);
    expect(onDeactivate).toHaveBeenCalledTimes(1);
  });

  it("tracks a moving aim during wind-up, then freezes it aimLockMs before the strike", () => {
    let struckAt = { x: 0, y: 0 };
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({
      windUpMs: 300,
      aimLockMs: 100,
      effect: { onActivate: (_c, aim) => { struckAt = { ...aim }; } },
    }), { x: 0, y: 0 });

    sc.update(caster, 100, { x: 10, y: 0 }); // timer 200 — still tracking
    sc.update(caster, 100, { x: 20, y: 0 }); // timer 100 — locks at this value
    sc.update(caster, 100, { x: 99, y: 0 }); // strike; the late move is ignored

    expect(struckAt.x).toBe(20);
  });

  it("reports knockback immunity only while mid-active-phase of an immune spell", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ windUpMs: 100, activeMs: 100, knockbackImmuneWhileActive: true }), AIM);

    expect(sc.knockbackImmuneActive).toBe(false); // winding up: still vulnerable
    sc.update(caster, 100, AIM);
    expect(sc.knockbackImmuneActive).toBe(true);
    sc.update(caster, 100, AIM);
    expect(sc.knockbackImmuneActive).toBe(false);
  });

  it("reports invulnerability the same way", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ activeMs: 100, invulnerableWhileActive: true }), AIM);
    expect(sc.invulnerableActive).toBe(false); // wind-up, however brief
    sc.update(caster, 100, AIM);
    expect(sc.invulnerableActive).toBe(true);
    sc.update(caster, 100, AIM);
    expect(sc.invulnerableActive).toBe(false);
  });

  it("does not claim immunity for a spell that never asked for it", () => {
    const sc = new SpellCaster();
    sc.begin(spell({ activeMs: 100 }), AIM);
    expect(sc.knockbackImmuneActive).toBe(false);
    expect(sc.invulnerableActive).toBe(false);
  });

  it("exposes the current spell's id while casting, for the animation", () => {
    const sc = new SpellCaster();
    const caster = new RecordingCaster();
    sc.begin(spell({ id: "stone-crash", activeMs: 100 }), AIM);
    expect(sc.activeSpellId).toBe("stone-crash");
    sc.update(caster, 100, AIM); // strike → active, still casting
    expect(sc.activeSpellId).toBe("stone-crash");
    sc.update(caster, 100, AIM); // done
    expect(sc.activeSpellId).toBe("");
  });

  it("interrupt aborts the cast immediately", () => {
    const sc = new SpellCaster();
    sc.begin(spell({ windUpMs: 1000 }), AIM);
    sc.interrupt();
    expect(sc.busy).toBe(false);
    expect(sc.phase).toBe("idle");
  });

  it("does nothing on update when no spell was begun", () => {
    const sc = new SpellCaster();
    expect(sc.update(new RecordingCaster(), 100, AIM)).toBe(false);
  });

  it("advances its clock independently of any cast", () => {
    const sc = new SpellCaster();
    sc.tickClock(100);
    sc.tickClock(50);
    expect(sc.now).toBe(150);
  });
});

describe("spell cooldowns are owned by the spell", () => {
  it("is ready before it has ever been cast", () => {
    expect(spell({ cooldownMs: 1000 }).isReady(0)).toBe(true);
  });

  it("blocks a recast until the cooldown has elapsed", () => {
    const s = spell({ cooldownMs: 1000 });
    s.markCast(500);
    expect(s.isReady(500)).toBe(false);
    expect(s.isReady(1499)).toBe(false);
    expect(s.isReady(1500)).toBe(true);
  });

  it("reports the remaining cooldown, clamped at zero", () => {
    const s = spell({ cooldownMs: 1000 });
    s.markCast(0);
    expect(s.cooldownRemaining(250)).toBe(750);
    expect(s.cooldownRemaining(5000)).toBe(0);
  });

  it("starts the cooldown when the effect FINISHES, not when it began", () => {
    const s = spell({ windUpMs: 100, activeMs: 100, cooldownMs: 1000 });
    const sc = new SpellCaster();
    const caster = new RecordingCaster();

    sc.tickClock(0);
    sc.begin(s, AIM);
    sc.tickClock(100); sc.update(caster, 100, AIM); // strike
    sc.tickClock(100); sc.update(caster, 100, AIM); // active ends → markCast at 200

    expect(s.isReady(1199)).toBe(false);
    expect(s.isReady(1200)).toBe(true);
  });

  it("allows any target when no canHit gate was supplied", () => {
    const s = spell();
    expect(s.canHit(new RecordingCaster(), { id: "t", dist: 10, dx: 10, dy: 0 })).toBe(true);
  });

  it("consults a canHit gate when one was supplied", () => {
    const s = spell({ canHit: (_c, t) => t.dist < 50 });
    const caster = new RecordingCaster();
    expect(s.canHit(caster, { id: "t", dist: 10, dx: 10, dy: 0 })).toBe(true);
    expect(s.canHit(caster, { id: "t", dist: 90, dx: 90, dy: 0 })).toBe(false);
  });
});

// ── Weapon attacks, expressed as spells ──────────────────────────────────────

class Faster extends WeaponMod {
  readonly label = "faster";
  override get attackSpeedPct() { return 1; }
}

describe("weaponSpell", () => {
  const sword = WEAPON_REGISTRY["broadsword"];
  const bow = WEAPON_REGISTRY["longbow"];

  it("builds a melee swing whose active window IS the weapon's cooldown", () => {
    const inst = new WeaponInstance(sword, "a");
    const s = weaponSpell(inst);
    expect(s.windUpMs).toBe(0);
    expect(s.activeMs).toBe(inst.attackCooldownMs);
    expect(s.fireMode).toBe("press"); // one swing per press
  });

  it("makes a ranged weapon auto-fire while held", () => {
    expect(weaponSpell(new WeaponInstance(bow, "a")).fireMode).toBe("hold");
  });

  it("reads its weapon's stats LIVE, so a later attack-speed roll still applies", () => {
    // The stale-capture regression: Player caches one spell per weapon for the
    // whole run, so a spell built before a modifier existed must still see it.
    const base = weaponSpell(new WeaponInstance(sword, "a"));
    const hasted = weaponSpell(new WeaponInstance(sword, "b", [new Faster()]));

    expect(base.activeMs).toBe(sword.attackCooldownMs);
    expect(hasted.activeMs).toBeCloseTo(sword.attackCooldownMs / 2, 9);
  });

  it("emits nothing on a melee wind-up frame, then a hurtbox once the blade is drawn", () => {
    const caster = new RecordingCaster();
    const s = weaponSpell(new WeaponInstance(sword, "a"));
    const sc = new SpellCaster();
    sc.begin(s, AIM);

    sc.update(caster, 50, AIM);
    expect(caster.sources).toHaveLength(0); // leading strip frames draw nothing

    for (let i = 0; i < 10 && caster.sources.length === 0; i++) sc.update(caster, 50, AIM);
    expect(caster.sources.length).toBeGreaterThan(0);
  });

  it("hits each target only once per swing, however many frames it lingers", () => {
    const caster = new RecordingCaster();
    const sc = new SpellCaster();
    sc.begin(weaponSpell(new WeaponInstance(sword, "a")), AIM);
    for (let i = 0; i < 12; i++) sc.update(caster, 50, AIM);

    const claims = caster.sources.map(s => s.claim("enemy-1"));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("scales the swing's damage through the caster, not around it", () => {
    const caster = new RecordingCaster();
    caster.scale = 2;
    const inst = new WeaponInstance(sword, "a");
    const sc = new SpellCaster();
    sc.begin(weaponSpell(inst), AIM);
    for (let i = 0; i < 12 && caster.sources.length === 0; i++) sc.update(caster, 50, AIM);

    expect(caster.sources[0].attack.damage).toBe(inst.damage * 2);
    expect(caster.sources[0].attack.knockback).toBe(inst.attackForce);
  });

  it("routes lifesteal back through the caster when a swing lands", () => {
    const caster = new RecordingCaster();
    const sc = new SpellCaster();
    sc.begin(weaponSpell(new WeaponInstance(sword, "a")), AIM);
    for (let i = 0; i < 12 && caster.sources.length === 0; i++) sc.update(caster, 50, AIM);

    caster.sources[0].onDealt!("e1", 7);
    expect(caster.healed).toEqual([7]);
  });

  it("spawns one shot per ranged cast, ahead of the shooter", () => {
    const caster = new RecordingCaster();
    const inst = new WeaponInstance(bow, "a");
    const sc = new SpellCaster();
    sc.begin(weaponSpell(inst), { x: 100, y: 0 }); // aiming right
    sc.update(caster, 10, { x: 100, y: 0 });

    expect(caster.shots).toHaveLength(1);
    expect(caster.shots[0].ammoId).toBe(inst.ammoId);
    expect(caster.shots[0].angle).toBeCloseTo(0, 6);
    // Born past the shooter's own body, or the swept tail clips whatever is
    // touching them regardless of aim.
    expect(caster.shots[0].x).toBeGreaterThan(caster.x);
  });

  it("aims the shot at the aim point, in every direction", () => {
    const cases: Array<[{ x: number; y: number }, number]> = [
      [{ x: 100, y: 0 }, 0],
      [{ x: 0, y: 100 }, Math.PI / 2],
      [{ x: -100, y: 0 }, Math.PI],
      [{ x: 0, y: -100 }, -Math.PI / 2],
    ];
    for (const [aim, angle] of cases) {
      const caster = new RecordingCaster();
      const sc = new SpellCaster();
      sc.begin(weaponSpell(new WeaponInstance(bow, "a")), aim);
      sc.update(caster, 10, aim);
      expect(caster.shots[0].angle).toBeCloseTo(angle, 6);
    }
  });

  it("resolves the shot's damage at the muzzle — ammo + weapon, scaled", () => {
    const caster = new RecordingCaster();
    caster.scale = 2;
    const inst = new WeaponInstance(bow, "a");
    const ammo = AMMO_REGISTRY[inst.ammoId!];
    const sc = new SpellCaster();
    sc.begin(weaponSpell(inst), AIM);
    sc.update(caster, 10, AIM);

    const carried = (caster.shots[0].opts as { attack: AttackStats }).attack;
    expect(carried.damage).toBe((ammo.damage + inst.damage) * 2);
    expect(carried.knockback).toBe(ammo.knockback);
  });

  it("emits no melee hurtbox for a ranged weapon", () => {
    const caster = new RecordingCaster();
    const sc = new SpellCaster();
    sc.begin(weaponSpell(new WeaponInstance(bow, "a")), AIM);
    for (let i = 0; i < 12; i++) sc.update(caster, 50, AIM);
    expect(caster.sources).toHaveLength(0);
  });

  it("builds a wind-up + blast from an AOE weapon, paced by its cooldown", () => {
    // No shipping weapon carries an AoeSpec (the Mage's nova is built but not
    // equipped), so this guards weaponSpell's AOE branch from rotting.
    // Extends Weapon rather than Staff: a Staff always carries an ammoId (it
    // fires an elemental bolt), and an AOE weapon by definition does not.
    class NovaStaff extends Weapon {
      readonly id = "test-nova" as WeaponId;
      readonly name = "Nova";
      get category(): WeaponCategory { return "staff"; }
      override get attackCooldownMs() { return 900; }
      override get aoe() { return { radius: 76, windUpMs: 260, blastMs: 130 }; }
    }
    const inst = new WeaponInstance(new NovaStaff(), "a");
    const s = weaponSpell(inst);

    expect(s.windUpMs).toBe(260);
    expect(s.activeMs).toBe(130);   // the blast's own length, not the cooldown
    expect(s.cooldownMs).toBe(900); // ...which paces the recast instead
    expect(s.fireMode).toBe("hold");
  });

  it("erupts an AOE circle centred on the caster, hitting each enemy once", () => {
    class NovaStaff extends Weapon {
      readonly id = "test-nova2" as WeaponId;
      readonly name = "Nova";
      get category(): WeaponCategory { return "staff"; }
      override get aoe() { return { radius: 76, windUpMs: 0, blastMs: 200 }; }
    }
    const caster = new RecordingCaster();
    caster.x = 500;
    caster.y = 400;
    const sc = new SpellCaster();
    sc.begin(weaponSpell(new WeaponInstance(new NovaStaff(), "a")), AIM);
    for (let i = 0; i < 4; i++) sc.update(caster, 50, AIM);

    expect(caster.sources.length).toBeGreaterThan(1);
    expect(caster.sources[0].shape).toEqual({ kind: "circle", cx: 500, cy: 400, r: 76 });
    expect(caster.sources.map(s => s.claim("e1")).filter(Boolean)).toHaveLength(1);
  });
});
