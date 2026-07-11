export type EnemyType =
  // Horizontal, single-row strips
  | "goo-green"
  | "goo-blue"
  | "goo-gold"
  | "bat"
  | "brown-bat"
  | "eye-bat"
  | "gold-eye"
  | "smushroom"
  | "float-eye"
  | "swarm-1"
  | "swarm-2"
  | "swarm-3"
  | "rat"
  // Horizontal, multi-row sheets
  | "spider"
  | "frog-flower"
  | "frog-flower-black"
  | "float-skull"
  | "float-skull-teal"
  | "float-skull-pink"
  // Directional (up/right/down/left rows)
  | "bones"
  | "bones-blader"
  | "kultist"
  | "armor-lancer"
  | "beast"
  | "axe-beast"
  | "mace-beast"
  | "sword-beast"
  | "fang"
  | "hood-fang"
  // Bosses — never in the random spawn pool; one is placed in the boss room
  | "turtle-dragon"
  | "wyvern"
  | "wyvern-green"
  | "wyvern-grey"
  | "centaur-knight"
  | "big-beast"
  | "tengu-mask"
  | "batwing-buttstomper";

/** "horizontal" art has one side view, mirrored with flipX (goos, bats, spiders).
 *  "directional" art has an up/right/down/left row per facing (bones, beasts).
 *  Must match the client visual def registered for the same enemy id. */
export type EnemyFacingMode = "horizontal" | "directional";

export interface EnemyConfig {
  maxHp: number;
  speed: number;
  aggroRadius: number;
  attackRadius: number;       // center-to-center; must exceed 2×ENTITY_RADIUS (10px)
  attackDamage: number;
  attackCooldownMs: number;
  knockbackResistance: number; // 0 = full knockback; higher absorbs more force
  /** Defaults to "horizontal". */
  facingMode?: EnemyFacingMode;
  /** Bosses are excluded from the random spawn pool — GameRoom places one in the
   *  floor's boss room instead. */
  boss?: boolean;
}

/** Untuned stand-in stats for freshly imported art — a copy of GooGreen's block.
 *  Every enemy that spreads this plays identically, which is the point: the ones
 *  nobody has balanced yet are obvious. To tune an enemy, replace the spread in
 *  its config file with real numbers. */
export const PLACEHOLDER_ENEMY_CONFIG: EnemyConfig = {
  maxHp: 60,
  speed: 70,
  aggroRadius: 160,
  attackRadius: 14,
  attackDamage: 10,
  attackCooldownMs: 1200,
  knockbackResistance: 3,
};

/** Likewise untuned, but scaled so a boss reads as a boss: a big HP pool, a wide
 *  aggro radius so it commits the moment you enter, a reach that matches its
 *  larger sprite, and enough knockback resistance to shrug off light hits. */
export const PLACEHOLDER_BOSS_CONFIG: EnemyConfig = {
  maxHp: 600,
  speed: 55,
  aggroRadius: 400,
  attackRadius: 26,
  attackDamage: 22,
  attackCooldownMs: 1500,
  knockbackResistance: 12,
  boss: true,
};
