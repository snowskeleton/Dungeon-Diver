import {
  CharacterClass, Layer,
  CHARGE_SPEED, CHARGE_DURATION_MS, CHARGE_COOLDOWN_MS, CHARGE_DAMAGE, CHARGE_KNOCKBACK, CHARGE_HIT_RADIUS,
  BLINK_DISTANCE, BLINK_COOLDOWN_MS,
  DASH_SPEED, DASH_DURATION_MS, DASH_COOLDOWN_MS,
  VAULT_SPEED, VAULT_DURATION_MS, VAULT_COOLDOWN_MS, VAULT_PEAK_HEIGHT,
} from "shared";
import { RehitGate } from "../combat/RehitGate";
import { Spell, SpellEffect, Caster, AimPoint } from "./Spell";

// ── Class movement abilities ──────────────────────────────────────────────────
// The four per-class movement kits, each a Spell like every other ability. They
// cast to a MovementCaster — the small surface a moving player exposes on top of
// Caster: drive a raw dash step, teleport a Blink, arc a Vault's height, and
// phase through chosen layers for the active window. The Player implements it;
// the builders never touch matter-js or the schema.
//
// Verbs, one per class: Charge = break (an offensive rush), Blink = teleport,
// Dash = dodge (i-frames), Vault = leap (rise to the AIR band). Which class gets
// which is the exhaustive switch at the bottom — the sanctioned OO seam (like
// GameRoom.challengeFor), since a shared Character can't build a server Spell.

export interface MovementCaster extends Caster {
  /** Travel a fixed-speed step this tick along (dirX, dirY); physics stops it at
   *  walls. Used by the channelled dashes (Charge / Dash / Vault). */
  dashDrive(dirX: number, dirY: number, pxPerSec: number): void;
  /** Instantly relocate along (dirX, dirY) up to `dist`, clamped to the furthest
   *  walkable point before any wall/barrier (Blink). */
  blinkAlong(dirX: number, dirY: number, dist: number): void;
  /** Set the airborne height (px); a Vault arcs this up and back to 0. */
  setAirHeight(px: number): void;
  /** Drop these Layer bits from the body's solid mask for the active phase, so the
   *  dash phases through them (ENEMY for Dash; ENEMY|COVER for Vault). Cleared by
   *  endPhase. GameRoom reads the drop each tick when it recomputes the mask. */
  beginPhase(dropMask: number): void;
  endPhase(): void;
}

// Extract a unit heading from the aim point (aim = caster pos + heading·k).
function heading(caster: Caster, aim: AimPoint): { x: number; y: number } {
  const dx = aim.x - caster.x;
  const dy = aim.y - caster.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

// Charge (Knight): a committed offensive rush. Plows forward at CHARGE_SPEED for
// the duration, its body a contact hazard (damage + knockback, once per target
// per pass via the gate), stopped by walls/barriers like any move. No phasing —
// the point is to slam INTO things.
function charge(): Spell {
  let dirX = 0;
  let dirY = 0;
  const gate = new RehitGate(Infinity); // each enemy takes one hit per charge
  const effect: SpellEffect = {
    onActivate: (caster, aim) => {
      const h = heading(caster, aim);
      dirX = h.x;
      dirY = h.y;
      gate.reset();
    },
    onActiveTick: (caster) => {
      const mc = caster as MovementCaster;
      // Contact hitbox at the current position, then move — so a target the rush
      // is already touching is hit before it's shoved out of the way.
      caster.emitHitSource({
        shape: { kind: "circle", cx: caster.x, cy: caster.y, r: CHARGE_HIT_RADIUS },
        affects: caster.attackAffects,
        attack: caster.buildAttack({ damage: CHARGE_DAMAGE, knockback: CHARGE_KNOCKBACK }, caster.x, caster.y),
        claim: (id) => gate.claim(id),
      });
      mc.dashDrive(dirX, dirY, CHARGE_SPEED);
    },
  };
  return new Spell({
    id: "charge",
    windUpMs: 0,
    activeMs: CHARGE_DURATION_MS,
    recoverMs: 0,
    cooldownMs: CHARGE_COOLDOWN_MS,
    range: 0,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true, // can't be shoved off its own rush
    fireMode: "press",
    effect,
  });
}

// Blink (Mage): an instant teleport. No active phase — the whole effect is the
// relocation on the strike frame, clamped so it never lands in a wall or past a
// shut door (but happily crosses a bar or gap in between).
function blink(): Spell {
  const effect: SpellEffect = {
    onActivate: (caster, aim) => {
      const h = heading(caster, aim);
      (caster as MovementCaster).blinkAlong(h.x, h.y, BLINK_DISTANCE);
    },
  };
  return new Spell({
    id: "blink",
    windUpMs: 0,
    activeMs: 0,
    recoverMs: 0,
    cooldownMs: BLINK_COOLDOWN_MS,
    range: 0,
    aimLockMs: 0,
    fireMode: "press",
    effect,
  });
}

// Dash (Rogue): a short, spammable dodge. Invulnerable for the whole (brief)
// active window (the true i-frame — dodges EVERYTHING, ground or air) and phasing
// through enemy bodies so it can slip into or out of a surround. No damage.
function dash(): Spell {
  let dirX = 0;
  let dirY = 0;
  const effect: SpellEffect = {
    onActivate: (caster, aim) => {
      const h = heading(caster, aim);
      dirX = h.x;
      dirY = h.y;
      (caster as MovementCaster).beginPhase(Layer.ENEMY);
    },
    onActiveTick: (caster) => {
      (caster as MovementCaster).dashDrive(dirX, dirY, DASH_SPEED);
    },
    onDeactivate: (caster) => (caster as MovementCaster).endPhase(),
  };
  return new Spell({
    id: "dash",
    windUpMs: 0,
    activeMs: DASH_DURATION_MS,
    recoverMs: 0,
    cooldownMs: DASH_COOLDOWN_MS,
    range: 0,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true,
    invulnerableWhileActive: true, // Dash's i-frames — Player reads this to gate damageable
    fireMode: "press",
    effect,
  });
}

// Vault (Ranger): an arced leap. Rises to the AIR elevation band over the arc, so
// it dodges GROUND attacks (a slam, fire, a grounded enemy's touch) but a FLYING
// enemy still catches it — the mechanic the elevation model buys. Phases over
// cover blocks and enemy bodies while airborne. NOT blanket-invulnerable: that's
// what keeps it distinct from the Dash.
function vault(): Spell {
  let dirX = 0;
  let dirY = 0;
  let elapsed = 0;
  const effect: SpellEffect = {
    onActivate: (caster, aim) => {
      const h = heading(caster, aim);
      dirX = h.x;
      dirY = h.y;
      elapsed = 0;
      (caster as MovementCaster).beginPhase(Layer.ENEMY | Layer.COVER);
    },
    onActiveTick: (caster, dtMs) => {
      const mc = caster as MovementCaster;
      elapsed += dtMs;
      // Height arc: 0 → peak → 0 over the duration (a smooth sine hump), so the
      // AIR band is held through the middle of the leap.
      const frac = Math.min(1, elapsed / VAULT_DURATION_MS);
      mc.setAirHeight(Math.sin(frac * Math.PI) * VAULT_PEAK_HEIGHT);
      mc.dashDrive(dirX, dirY, VAULT_SPEED);
    },
    onDeactivate: (caster) => {
      const mc = caster as MovementCaster;
      mc.setAirHeight(0); // land
      mc.endPhase();
    },
  };
  return new Spell({
    id: "vault",
    windUpMs: 0,
    activeMs: VAULT_DURATION_MS,
    recoverMs: 0,
    cooldownMs: VAULT_COOLDOWN_MS,
    range: 0,
    aimLockMs: 0,
    knockbackImmuneWhileActive: true,
    fireMode: "press",
    effect,
  });
}

/** The movement Spell for a class. An exhaustive switch on CharacterClass — the
 *  sanctioned OO seam for wiring a per-class ability, since a shared Character
 *  can't construct a server-side Spell. Adding a class makes this a compile error
 *  until its ability is chosen. Built once per Player and cached (the Spell owns
 *  its cooldown, which must persist across casts). */
export function movementSpellFor(cls: CharacterClass): Spell {
  switch (cls) {
    case "knight": return charge();
    case "mage":   return blink();
    case "rogue":  return dash();
    case "ranger": return vault();
  }
}
