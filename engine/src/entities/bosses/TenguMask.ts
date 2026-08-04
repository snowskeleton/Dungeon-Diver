import { EnemyType } from "shared";
import { Boss } from "../Boss";
import { Spell, novaBurst, stoneDrop, summonAdds } from "../../spells";
import { TenguShade } from "../enemies/tenguShade";

// 👺 Tengu Mask — the Trickster. A masked mountain spirit that fights on three
// beats: it detonates a lightning nova at anything crowding it, splits into a
// swarm of smaller shades to pile on pressure, and — its signature — turns to
// stone, launches skyward untouchable, and comes crashing down on you. Every one
// of its sheet's rows drives a move: idle, the orb/lightning cast, the split
// cast, and the stoneface (docs/bosses.md).
export class TenguMask extends Boss {
  static readonly type: EnemyType = "tengu-mask";
  static readonly lore = "A masked mountain spirit and trickster mage that bends the fight with lightning, illusory shades, and a crushing stone dive.";
  static readonly abilities = [
    { name: "Storm Nova", desc: "Charges, then detonates a ring of lightning around itself — don't be hugging it when it pops." },
    { name: "Mirror Split", desc: "Splinters into a swarm of smaller shades that chase and batter you — clear them before they overwhelm." },
    { name: "Stone Crash", desc: "Turns to stone and launches skyward, untouchable, then slams down under its shadow for a heavy crash — step off the mark." },
  ];

  // A caster: it holds mid-range and leans on the split + stone crash to reach
  // you, popping the nova only when you close in.
  protected preferredRange = 220;

  // A breath between casts so the fight has rhythm and the stone-crash recovery
  // reads as a punish window.
  protected get globalCooldownMs(): number {
    return 900;
  }

  protected abilities(): Spell[] {
    // Anti-hug lightning burst: short range so it only fires when a player crowds
    // it, knocking them back out of melee. Listed first so hugging draws it.
    const nova = novaBurst({
      id: "storm-nova",
      windUpMs: 800,
      recoverMs: 650,
      cooldownMs: 8000,
      range: 118,
      radius: 108,
      damage: 18,
      knockback: 18,
      strikeMs: 280,
    });

    // Signature. aimLock 500 on a 700ms wind-up: it tracks you for the first
    // ~200ms, then locks the landing spot so the tail of the flight (the shadow
    // settling) is your window to step off the mark. Rises untouchable, hangs,
    // then crashes down with heavy knockback.
    const crash = stoneDrop({
      id: "stone-drop",
      windUpMs: 700,
      recoverMs: 950,
      cooldownMs: 11000,
      range: 460,
      aimLockMs: 500,
      peakHeight: 150,
      riseMs: 420,
      hangMs: 480,
      dropMs: 240,
      radius: 82,
      damage: 24,
      knockback: 20,
    });

    // Splits into three shades ringed around it. A long cooldown so the arena
    // isn't perpetually flooded — clear the wave, then it splits again.
    const split = summonAdds({
      id: "mirror-split",
      enemy: TenguShade,
      count: 3,
      radius: 64,
      windUpMs: 750,
      recoverMs: 700,
      cooldownMs: 15000,
      range: 500,
    });

    // Priority: answer a hugging player with the nova, else split to keep pressure
    // on, else the stone crash reaches across the arena.
    return [nova, split, crash];
  }
}
