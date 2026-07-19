import { RoomData, ConnectionData, roomInteriorContains } from "shared";
import { PhysicsWorld } from "../physics/PhysicsWorld";

/** Which of a connection's two barriers: the one out of the parent room, or the
 *  one back out of the child room. */
type BarrierSide = "parent" | "child";

/** The physics body id for one barrier. The only place the "bp_"/"bc_" prefixes
 *  are spelled — they were previously inlined at nine call sites. */
function barrierBodyId(connId: string, side: BarrierSide): string {
  return `${side === "parent" ? "bp" : "bc"}_${connId}`;
}

export class FloorManager {
  private rooms: RoomData[];
  private connections: ConnectionData[];
  private physics: PhysicsWorld;

  private enemyHomeRoom = new Map<string, string>();
  private roomEnemyIds = new Map<string, Set<string>>();
  private clearedRooms = new Set<string>();
  // Tracks which child rooms players have already entered (barrierChild locked)
  private enteredChildRooms = new Set<string>();
  /** Which of a connection's two barriers are currently standing. One entry per
   *  connection, replacing the two parallel active-maps; raise()/drop() below own
   *  both this bookkeeping and the physics-id naming. */
  private barriers = new Map<string, { parent: boolean; child: boolean }>();

  constructor(rooms: RoomData[], connections: ConnectionData[], physics: PhysicsWorld) {
    this.rooms = rooms;
    this.connections = connections;
    this.physics = physics;

    for (const room of rooms) this.roomEnemyIds.set(room.id, new Set());

    // Start with barrierParent standing on all connections: player must clear each room to advance.
    for (const conn of connections) {
      this.barriers.set(conn.id, { parent: false, child: false });
      this.raise(conn, "parent");
    }
  }

  /**
   * Put up one of a connection's barriers. Returns false if it was already
   * standing, so callers can use it as "did this change anything".
   *
   * `parent` blocks advancing OUT of the parent room (dropped when that room is
   * cleared); `child` blocks retreating back out of the child room (raised on
   * entry). The "bp_"/"bc_" physics-id prefixes exist only in here.
   */
  private raise(conn: ConnectionData, side: BarrierSide): boolean {
    const state = this.barriers.get(conn.id);
    if (!state || state[side]) return false;
    const rect = side === "parent" ? conn.barrierParent : conn.barrierChild;
    this.physics.addBarrier(barrierBodyId(conn.id, side), rect.cx, rect.cy, rect.w, rect.h);
    state[side] = true;
    return true;
  }

  /** Take one of a connection's barriers down. Returns false if it wasn't
   *  standing, which is what lets every caller below read as a plain loop of
   *  "drop it, and if that did something, report the id". */
  private drop(conn: ConnectionData, side: BarrierSide): boolean {
    const state = this.barriers.get(conn.id);
    if (!state || !state[side]) return false;
    this.physics.removeBarrier(barrierBodyId(conn.id, side));
    state[side] = false;
    return true;
  }

  assignEnemy(enemyId: string, x: number, y: number): void {
    const room = this.roomAt(x, y);
    if (!room) return;
    this.enemyHomeRoom.set(enemyId, room.id);
    this.roomEnemyIds.get(room.id)!.add(enemyId);
  }

  // Called after all enemies have been assigned. Pre-clears rooms with no enemies so players
  // can advance through them freely and aren't locked in on entry.
  // Returns connection IDs whose barrierParent was removed (for client visual update).
  finalizeEmptyRooms(): string[] {
    const parentUnlocked: string[] = [];
    for (const room of this.rooms) {
      const ids = this.roomEnemyIds.get(room.id);
      if (!ids || ids.size > 0) continue;
      this.clearedRooms.add(room.id);
      for (const conn of this.connections) {
        if (conn.parentRoomId === room.id && this.drop(conn, "parent")) {
          parentUnlocked.push(conn.id);
        }
      }
    }
    return parentUnlocked;
  }

  // Called each tick with a player position. Returns connectionIds for newly locked entry barriers.
  // barrierChild activates the first time any player fully enters a child room's interior,
  // but only if that room has enemies — empty rooms never lock the retreat path.
  checkPlayerEnteredRoom(x: number, y: number): string[] {
    const room = this.roomAt(x, y);
    if (!room) return [];
    if (this.enteredChildRooms.has(room.id)) return [];

    // Don't lock entry to rooms with no enemies — player should be free to retreat.
    const enemyIds = this.roomEnemyIds.get(room.id);
    if (!enemyIds || enemyIds.size === 0) return [];

    const activated: string[] = [];
    for (const conn of this.connections) {
      if (conn.childRoomId === room.id && this.raise(conn, "child")) {
        this.enteredChildRooms.add(room.id);
        activated.push(conn.id);
        break; // A room has exactly one parent connection
      }
    }
    return activated;
  }

  // Returns which connection IDs had barriers removed (split by type so client can update visuals).
  onEnemyMaybeCleared(
    enemyId: string,
    getIsDying: (id: string) => boolean,
  ): { parentUnlocked: string[]; childUnlocked: string[] } {
    const roomId = this.enemyHomeRoom.get(enemyId);
    if (!roomId || this.clearedRooms.has(roomId)) return { parentUnlocked: [], childUnlocked: [] };

    const ids = this.roomEnemyIds.get(roomId);
    if (!ids || ids.size === 0) return { parentUnlocked: [], childUnlocked: [] };
    if (![...ids].every(id => getIsDying(id))) return { parentUnlocked: [], childUnlocked: [] };

    this.clearedRooms.add(roomId);
    const parentUnlocked: string[] = [];
    const childUnlocked: string[] = [];

    // Remove barrierParent for connections FROM this room → player can advance to child rooms.
    for (const conn of this.connections) {
      if (conn.parentRoomId === roomId && this.drop(conn, "parent")) {
        parentUnlocked.push(conn.id);
      }
    }

    // Remove barrierChild for connections INTO this room → player can retreat to parent room.
    for (const conn of this.connections) {
      if (conn.childRoomId === roomId && this.drop(conn, "child")) {
        childUnlocked.push(conn.id);
      }
    }

    return { parentUnlocked, childUnlocked };
  }

  // Softlock guard, called each tick with all living players' positions: if a locked,
  // uncleared room has no player inside (the only occupant died and respawned at start,
  // or disconnected), remove its entry barrier and forget the entry so the room re-locks
  // normally on the next entry. Returns connection IDs whose barrierChild was removed.
  releaseAbandonedRooms(playerPositions: Array<{ x: number; y: number }>): string[] {
    const childUnlocked: string[] = [];
    for (const roomId of [...this.enteredChildRooms]) {
      if (this.clearedRooms.has(roomId)) continue;
      const occupied = playerPositions.some(p => this.roomAt(p.x, p.y)?.id === roomId);
      if (occupied) continue;
      for (const conn of this.connections) {
        if (conn.childRoomId === roomId && this.drop(conn, "child")) {
          childUnlocked.push(conn.id);
        }
      }
      this.enteredChildRooms.delete(roomId);
    }
    return childUnlocked;
  }

  isRoomCleared(roomId: string): boolean {
    return this.clearedRooms.has(roomId);
  }

  getEnemyRoom(enemyId: string): string | undefined {
    return this.enemyHomeRoom.get(enemyId);
  }

  // A player is protected from an enemy only if they are in a passageway that does NOT
  // touch the enemy's room (so enemies in the source room still aggro into the corridor).
  isProtectedFromRoom(px: number, py: number, enemyRoomId: string | undefined): boolean {
    if (!enemyRoomId) return false;
    for (const conn of this.connections) {
      if (this.inPassageway(px, py, conn)) {
        if (conn.parentRoomId !== enemyRoomId && conn.childRoomId !== enemyRoomId) {
          return true;
        }
      }
    }
    return false;
  }

  private inPassageway(x: number, y: number, conn: ConnectionData): boolean {
    return x >= conn.passXMin && x <= conn.passXMax &&
           y >= conn.passYMin && y <= conn.passYMax;
  }

  /** The room whose interior contains this point, or null (a wall or a
   *  passageway). The geometry itself lives in shared — see
   *  roomInteriorContains, and note the 1-tile inset it documents. */
  roomAt(x: number, y: number): RoomData | null {
    return this.rooms.find((room) => roomInteriorContains(room, x, y)) ?? null;
  }

  dispose(): void {
    for (const conn of this.connections) {
      this.drop(conn, "parent");
      this.drop(conn, "child");
    }
  }
}
