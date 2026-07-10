export type EnemyType = "goo-green" | "goo-blue" | "goo-gold" | "bat";

export interface EnemyConfig {
  maxHp: number;
  speed: number;
  aggroRadius: number;
  attackRadius: number;       // center-to-center; must exceed 2×ENTITY_RADIUS (10px)
  attackDamage: number;
  attackCooldownMs: number;
  knockbackResistance: number; // 0 = full knockback; higher absorbs more force
}
