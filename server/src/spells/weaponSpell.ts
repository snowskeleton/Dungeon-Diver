import { WeaponInstance, HitShape, AMMO_REGISTRY } from "shared";
import { RehitGate } from "../combat/RehitGate";
import { Spell, SpellOpts, SpellEffect, Caster, AttackStats } from "./Spell";

// A player's weapon attack expressed as a Spell — the "a basic swing is a
// zero-wind-up spell" unification. A melee weapon's spell has an active phase
// equal to the swing window (the weapon's attack cooldown) that emits the
// weapon's facing-relative hurtbox each tick, hitting each enemy once per swing.
// A ranged weapon's spell is instant: it spawns its ammo on the strike frame and
// then holds its active phase for the same window so `isAttacking` reads true
// throughout. The active phase is the re-fire gate, so cooldownMs is 0.
//
// Everything here takes a WeaponInstance, not a Weapon template: the numbers it
// reads (damage, force, cooldown) are the wielder's own modified values, and it
// reads them LIVE — see WeaponSpell below for why that matters.

/**
 * A Spell whose timing follows its weapon instance instead of being frozen at
 * construction. Player caches one spell per weapon for the run, so a modifier
 * acquired later (an attack-speed roll, a weapon upgrade) has to be visible to a
 * spell that was built before it existed. Reading through to the instance on every
 * access is what makes that work.
 */
// How far ahead of the shooter a projectile is born, so its swept-ellipse tail
// clears the shooter's own body (see rangedWeaponSpell). Roughly the entity
// radius plus a margin — far enough to free the player's tile, near enough that
// a point-blank shot still overlaps an enemy pressed against them.
const MUZZLE_OFFSET = 18;

class WeaponSpell extends Spell {
  constructor(
    protected readonly inst: WeaponInstance,
    opts: SpellOpts,
  ) {
    super(opts);
  }

  /** The swing window IS the weapon's cooldown, so it tracks attack-speed mods. */
  override get activeMs(): number {
    return this.inst.attackCooldownMs;
  }
}

/** An AOE weapon paces itself by cooldown rather than by its (fixed) blast length. */
class AoeWeaponSpell extends WeaponSpell {
  override get activeMs(): number {
    return this.baseActiveMs; // blastMs — the blast's own duration, not the cooldown
  }
  override get cooldownMs(): number {
    return this.inst.attackCooldownMs;
  }
}

/** Build the Spell a weapon casts. Cached per weapon INSTANCE by the caster. */
export function weaponSpell(inst: WeaponInstance): Spell {
  if (inst.isAoe) return aoeWeaponSpell(inst);
  return inst.isRanged ? rangedWeaponSpell(inst) : meleeWeaponSpell(inst);
}

// The Mage's staff: a brief wind-up telegraph, then a damaging nova around the
// caster for `blastMs`, hitting each enemy once. Auto-casts while held, paced by
// the weapon's cooldown.
function aoeWeaponSpell(inst: WeaponInstance): Spell {
  const aoe = inst.aoe!;
  return new AoeWeaponSpell(inst, {
    id: `weapon:${inst.id}`,
    windUpMs: aoe.windUpMs,
    activeMs: aoe.blastMs,
    recoverMs: 0,
    cooldownMs: inst.attackCooldownMs,
    range: 0,
    aimLockMs: 0,
    fireMode: "hold",
    effect: aoeEffect(inst, aoe.radius),
  });
}

function aoeEffect(inst: WeaponInstance, radius: number): SpellEffect {
  const gate = new RehitGate(Infinity); // one hit per enemy per blast
  return {
    onActivate: () => gate.reset(),
    onActiveTick: (caster, dtMs) => {
      gate.tick(dtMs);
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: radius },
        affects: caster.attackAffects,
        attack: casterAttack(caster, inst),
        claim: (id) => gate.claim(id),
        onDealt: (_, dmg) => caster.onDamageDealt?.(dmg),
      });
    },
  };
}

function meleeWeaponSpell(inst: WeaponInstance): Spell {
  return new WeaponSpell(inst, {
    id: `weapon:${inst.id}`,
    windUpMs: 0,
    activeMs: inst.attackCooldownMs,
    recoverMs: 0,
    cooldownMs: 0,
    range: 0,
    aimLockMs: 0,
    fireMode: "press", // one swing per key press
    effect: meleeEffect(inst),
  });
}

function meleeEffect(inst: WeaponInstance): SpellEffect {
  const gate = new RehitGate(Infinity); // one hit per target for the whole swing

  // Elapsed time into the ATTACK ANIMATION, which is not the same clock as the
  // spell's active phase: the FX strip always plays at its own frame rate, while
  // activeMs is the weapon's cooldown. A slow weapon holds isAttacking long after
  // its animation (and so its hitbox) has finished — which is correct, and is why
  // this counter is kept here rather than read off the spell's phase progress.
  let swingMs = 0;

  // Emit the hurtbox for the animation frame currently on screen. Returns null on
  // a wind-up frame (the strips' first two frames draw nothing) and once the
  // animation is over, so damage is live exactly while the blade is visible.
  const emit = (caster: Caster) => {
    const box = inst.getHurtbox(caster.x, caster.y, caster.facing, swingMs);
    if (!box) return;
    const shape: HitShape = box.shape === "rect"
      ? { kind: "rect", x: box.x, y: box.y, w: box.w, h: box.h }
      : { kind: "circle", cx: box.cx, cy: box.cy, r: box.r };
    caster.emitHitSource({
      shape,
      affects: caster.attackAffects,
      attack: casterAttack(caster, inst),
      claim: (id) => gate.claim(id),
      onDealt: (_, dmg) => caster.onDamageDealt?.(dmg),
    });
  };
  return {
    onActivate: (caster) => {
      gate.reset();
      swingMs = 0;
      emit(caster);
    },
    onActiveTick: (caster, dtMs) => {
      swingMs += dtMs;
      emit(caster);
    },
  };
}

function rangedWeaponSpell(inst: WeaponInstance): Spell {
  return new WeaponSpell(inst, {
    id: `weapon:${inst.id}`,
    windUpMs: 0,
    activeMs: inst.attackCooldownMs, // holds isAttacking for the cooldown window
    recoverMs: 0,
    cooldownMs: 0,
    range: 0,
    aimLockMs: 0,
    fireMode: "hold", // auto-fires while the button is held
    effect: {
      onActivate: (caster, aim) => {
        const angle = Math.atan2(aim.y - caster.y, aim.x - caster.x);
        // Spawn AHEAD of the shooter, not at their centre. The projectile's hit
        // shape is a swept ellipse whose tail sits at the spawn point, so a shot
        // born at caster.x/y drags a hitbox across the shooter's own body — every
        // enemy merely *touching* the player got clipped on the spawn tick,
        // regardless of aim (most obvious firing up while a mob crowds you from
        // below). Offsetting past the body radius keeps point-blank shots landing
        // while freeing the shooter's own tile.
        const mx = caster.x + Math.cos(angle) * MUZZLE_OFFSET;
        const my = caster.y + Math.sin(angle) * MUZZLE_OFFSET;
        // The shot's damage is resolved HERE, at the muzzle, and carried on the
        // projectile — a projectile in flight has no link back to the bow that
        // fired it or the player who drew it, so the scaling has to ride along.
        caster.spawnProjectile(inst.ammoId!, mx, my, angle, {
          attack: rangedAttack(caster, inst),
        });
      },
    },
  });
}

/** Stage 2 → 3: the weapon instance's own numbers, scaled by whoever swings it. */
function casterAttack(caster: Caster, inst: WeaponInstance) {
  return caster.buildAttack(
    { damage: inst.damage, knockback: inst.attackForce },
    caster.x,
    caster.y,
  );
}

/** Same, for a shot: the ammo carries the base damage and the weapon adds to it.
 *  Only the STATS are resolved here — the blow's origin is wherever the projectile
 *  happens to be when it connects, which only the projectile knows. */
function rangedAttack(caster: Caster, inst: WeaponInstance): AttackStats {
  const ammo = AMMO_REGISTRY[inst.ammoId!];
  return caster.scaleAttack({
    damage: (ammo?.damage ?? 0) + inst.damage,
    knockback: ammo?.knockback ?? 0,
  });
}
