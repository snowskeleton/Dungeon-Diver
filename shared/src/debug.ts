import { RoomType } from "./types";
import { EnemyType } from "./enemies/base";
import { DungeonOptions } from "./dungeonGenerator";

/**
 * A debug game setup, chosen in the client's Debug menu and passed to the server
 * as a Colyseus join option. `enabled: false` means "play the real game" and the
 * rest of the fields are ignored.
 *
 * This is a FLAT object on purpose: the client's debug menu renders itself from
 * a field spec keyed on these property names (see client/src/debug/debugFields.ts),
 * so adding a knob means adding one property here and one field entry there.
 */
export interface DebugConfig {
  enabled: boolean;
  /** 0 = use the normal MAP_SEED. */
  seed: number;
  gridCols: number;
  gridRows: number;
  /** "random" = normal weighted roll; anything else forces every room to that type. */
  roomType: RoomType | "random";
  includeBoss: boolean;
  includeStairs: boolean;
  /** Empty = every enemy type. Otherwise spawns are drawn only from this list. */
  enemyTypes: EnemyType[];
  /**
   * -1 = the normal floor/player-count formula, and only combat + maze rooms are
   * populated. 0 or more forces exactly this many enemies in EVERY room, including
   * boss/shop/shrine rooms (so you can test a bat in a shop).
   */
  enemiesPerRoom: number;
}

export const DEFAULT_DEBUG_CONFIG: DebugConfig = {
  enabled: false,
  seed: 0,
  gridCols: 5,
  gridRows: 4,
  roomType: "random",
  includeBoss: true,
  includeStairs: true,
  enemyTypes: [],
  enemiesPerRoom: -1,
};

export function toDungeonOptions(cfg: DebugConfig): DungeonOptions {
  if (!cfg.enabled) return {};

  // Picking a specific room type in what would be a single room expands to a
  // 3-room showcase (plain start → chosen room → exit) so shop/shrine/boss rooms
  // are tested with a real spawn point and stairs, not a degenerate start=exit.
  const singleRoom = Math.max(1, cfg.gridCols) * Math.max(1, cfg.gridRows) === 1;
  if (singleRoom && cfg.roomType !== "random") {
    return {
      showcaseRoomType: cfg.roomType,
      includeStairs: cfg.includeStairs,
    };
  }

  const area = Math.max(1, cfg.gridCols) * Math.max(1, cfg.gridRows);
  return {
    gridCols: cfg.gridCols,
    gridRows: cfg.gridRows,
    minRooms: Math.min(4, area),
    forceRoomType: cfg.roomType === "random" ? null : cfg.roomType,
    includeBoss: cfg.includeBoss,
    includeStairs: cfg.includeStairs,
  };
}
