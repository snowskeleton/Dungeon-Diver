import { Weapon, HitShape } from "shared";
import { RehitGate } from "../combat/RehitGate";
import { Spell, SpellEffect, Caster } from "./Spell";

// A player's weapon attack expressed as a Spell — the "a basic swing is a
// zero-wind-up spell" unification. A melee weapon's spell has an active phase
// equal to the swing window (the weapon's attack cooldown) that emits the
// weapon's facing-relative hurtbox each tick, hitting each enemy once per swing.
// A ranged weapon's spell is instant: it spawns its ammo on the strike frame and
// then holds its active phase for the same window so `isAttacking` reads true
// throughout (matching the old attack-cooldown behaviour). The active phase is the
// re-fire gate, so cooldownMs is 0.

/** Build the Spell a weapon casts. Cached per weapon by the caster. */
export function weaponSpell(weapon: Weapon): Spell {
  if (weapon.isAoe) return aoeWeaponSpell(weapon);
  return weapon.isRanged ? rangedWeaponSpell(weapon) : meleeWeaponSpell(weapon);
}

// The Mage's staff: a brief wind-up telegraph, then a damaging nova around the
// caster for `blastMs`, hitting each enemy once. The very first player spell with
// a real wind-up — validating that the shared SpellCaster serves players, not just
// bosses. Auto-casts while held, paced by the weapon's cooldown.
function aoeWeaponSpell(weapon: Weapon): Spell {
  const aoe = weapon.aoe!;
  return new Spell({
    id: `weapon:${weapon.id}`,
    windUpMs: aoe.windUpMs,
    activeMs: aoe.blastMs,
    recoverMs: 0,
    cooldownMs: weapon.attackCooldownMs,
    range: 0,
    aimLockMs: 0,
    fireMode: "hold",
    effect: aoeEffect(weapon, aoe.radius),
  });
}

function aoeEffect(weapon: Weapon, radius: number): SpellEffect {
  const gate = new RehitGate(Infinity); // one hit per enemy per blast
  return {
    onActivate: () => gate.reset(),
    onActiveTick: (caster, dtMs) => {
      gate.tick(dtMs);
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: radius },
        affects: caster.attackAffects,
        attack: {
          damage: weapon.damage,
          knockback: weapon.attackForce,
          sourceX: caster.x,
          sourceY: caster.y,
        },
        claim: (id) => gate.claim(id),
      });
    },
  };
}

function meleeWeaponSpell(weapon: Weapon): Spell {
  return new Spell({
    id: `weapon:${weapon.id}`,
    windUpMs: 0,
    activeMs: weapon.attackCooldownMs,
    recoverMs: 0,
    cooldownMs: 0,
    range: 0,
    aimLockMs: 0,
    fireMode: "press", // one swing per key press
    effect: meleeEffect(weapon),
  });
}

function meleeEffect(weapon: Weapon): SpellEffect {
  const gate = new RehitGate(Infinity); // one hit per target for the whole swing
  // Emit the weapon's facing-relative hurtbox for this tick. Called on the strike
  // frame AND every active tick, so the swing is live from its very first frame.
  const emit = (caster: Caster) => {
    const box = weapon.getHurtbox(caster.x, caster.y, caster.facing);
    if (!box) return; // (ranged weapons return null, but they don't use this spell)
    const shape: HitShape = box.shape === "rect"
      ? { kind: "rect", x: box.x, y: box.y, w: box.w, h: box.h }
      : { kind: "circle", cx: box.cx, cy: box.cy, r: box.r };
    caster.emitHitSource({
      shape,
      affects: caster.attackAffects,
      attack: {
        damage: weapon.damage,
        knockback: weapon.attackForce,
        sourceX: caster.x,
        sourceY: caster.y,
      },
      claim: (id) => gate.claim(id),
    });
  };
  return {
    onActivate: (caster) => { gate.reset(); emit(caster); },
    onActiveTick: (caster) => emit(caster),
  };
}

function rangedWeaponSpell(weapon: Weapon): Spell {
  const ammoId = weapon.ammoId!;
  return new Spell({
    id: `weapon:${weapon.id}`,
    windUpMs: 0,
    activeMs: weapon.attackCooldownMs, // holds isAttacking for the cooldown window
    recoverMs: 0,
    cooldownMs: 0,
    range: 0,
    aimLockMs: 0,
    fireMode: "hold", // auto-fires while the button is held
    effect: {
      onActivate: (caster, aim) => {
        const angle = Math.atan2(aim.y - caster.y, aim.x - caster.x);
        caster.spawnProjectile(ammoId, caster.x, caster.y, angle);
      },
    },
  });
}
