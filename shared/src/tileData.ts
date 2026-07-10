import { TileId } from "./types";
import { generateDungeon, DUNGEON_COLS, DUNGEON_ROWS } from "./dungeonGenerator";
export { ROOM_W, ROOM_H } from "./dungeonGenerator";

export { DUNGEON_COLS as MAP_COLS, DUNGEON_ROWS as MAP_ROWS };

// Fixed seed so client and server always generate the identical map.
// Change MAP_SEED to get a different dungeon layout.
export const MAP_SEED = 1337;

const dungeon = generateDungeon(MAP_SEED);

export const MAP_DATA: TileId[][] = dungeon.mapData;

// Room-center pixel positions for player spawns, enemy spawns, etc.
export const DUNGEON_PLAYER_SPAWNS = dungeon.playerSpawns;
export const DUNGEON_ROOM_CENTERS = dungeon.roomCenters;
