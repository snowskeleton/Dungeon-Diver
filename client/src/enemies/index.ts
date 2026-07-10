import { EnemyType } from "shared";

export interface ClientEnemyDef {
  name: string;
}

export const CLIENT_ENEMY_REGISTRY: Record<EnemyType, ClientEnemyDef> = {
  "goo-green": { name: "Green Goo" },
  "goo-blue":  { name: "Blue Goo"  },
  "goo-gold":  { name: "Gold Goo"  },
  "bat":       { name: "Bat"       },
};
