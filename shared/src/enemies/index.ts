import { EnemyType, EnemyConfig } from "./base";
import { GOO_GREEN_CONFIG } from "./GooGreen";
import { GOO_BLUE_CONFIG }  from "./GooBlue";
import { GOO_GOLD_CONFIG }  from "./GooGold";
import { BAT_CONFIG }       from "./Bat";

export const ENEMY_REGISTRY: Record<EnemyType, EnemyConfig> = {
  "goo-green": GOO_GREEN_CONFIG,
  "goo-blue":  GOO_BLUE_CONFIG,
  "goo-gold":  GOO_GOLD_CONFIG,
  "bat":       BAT_CONFIG,
};

export * from "./base";
export { GOO_GREEN_CONFIG } from "./GooGreen";
export { GOO_BLUE_CONFIG }  from "./GooBlue";
export { GOO_GOLD_CONFIG }  from "./GooGold";
export { BAT_CONFIG }       from "./Bat";
