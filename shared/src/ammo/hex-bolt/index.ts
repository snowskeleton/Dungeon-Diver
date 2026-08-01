import { Ammo } from "../base";

// The skeleton-mage's staff projectile. An ENEMY-owned bolt, kept separate from
// the player Mage's magic-bolt so its damage/speed/knockback tune the skeleton-mage
// in isolation — retuning the player's Oak Staff can't touch it, and vice versa.
// This is where the mage's ranged damage lives.
//
// It's a flat enemy projectile (like fireball / magic-orb) rather than a player
// Bolt, but tuned to READ: a touch slower than a player bolt and a long-ish life so
// it crosses the room from the mage's firing range, and clearly dodgeable — the
// same telegraph-and-react philosophy as the armed enemies' wind-ups. It reuses the
// magic-bolt orb art (no dedicated PNG), tinted sickly green to mark it as a hex.
export class HexBolt extends Ammo {
  readonly id = "hex-bolt";
  readonly name = "Hex Bolt";
  get knockback() { return 2; }
  get damage() { return 4; }
  get speed() { return 120; }
  get pierce() { return 1; }
  get lifetimeMs() { return 1800; }
  get tint() { return 0x8fdc7a; }
  get spriteAngle() { return 0; }

  // Reuse the player magic-bolt's orb sprite — same round art, no new asset.
  get spritePath() { return "/sprites/ammo/bolts/magic-bolt/magic-bolt.png"; }
}
