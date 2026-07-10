import { RoomData, ConnectionData, TILE_SIZE, ROOM_W, ROOM_H } from "shared";
import { PhysicsWorld } from "../physics/PhysicsWorld";

export class FloorManager {
  private rooms: RoomData[];
  private connections: ConnectionData[];
  private physics: PhysicsWorld;

  private enemyHomeRoom = new Map<string, string>();
  private roomEnemyIds = new Map<string, Set<string>>();
  private clearedRooms = new Set<string>();
  // Tracks which child rooms players have already entered (barrierChild locked)
  private enteredChildRooms = new Set<string>();
  private barrierParentActive = new Map<string, boolean>();
  private barrierChildActive = new Map<string, boolean>();

  constructor(rooms: RoomData[], connections: ConnectionData[], physics: PhysicsWorld) {
    this.rooms = rooms;
    this.connections = connections;
    this.physics = physics;

    for (const room of rooms) this.roomEnemyIds.set(room.id, new Set());

    // Start with barrierParent active on all connections: player must clear each room to advance.
    for (const conn of connections) {
      this.barrierParentActive.set(conn.id, true);
      this.barrierChildActive.set(conn.id, false);
      const bp = conn.barrierParent;
      physics.addBarrier(`bp_${conn.id}`, bp.cx, bp.cy, bp.w, bp.h);
    }
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
        if (conn.parentRoomId === room.id && this.barrierParentActive.get(conn.id)) {
          this.physics.removeBarrier(`bp_${conn.id}`);
          this.barrierParentActive.set(conn.id, false);
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
      if (conn.childRoomId === room.id && !this.barrierChildActive.get(conn.id)) {
        this.enteredChildRooms.add(room.id);
        this.barrierChildActive.set(conn.id, true);
        const bc = conn.barrierChild;
        this.physics.addBarrier(`bc_${conn.id}`, bc.cx, bc.cy, bc.w, bc.h);
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
      if (conn.parentRoomId === roomId && this.barrierParentActive.get(conn.id)) {
        this.physics.removeBarrier(`bp_${conn.id}`);
        this.barrierParentActive.set(conn.id, false);
        parentUnlocked.push(conn.id);
      }
    }

    // Remove barrierChild for connections INTO this room → player can retreat to parent room.
    for (const conn of this.connections) {
      if (conn.childRoomId === roomId && this.barrierChildActive.get(conn.id)) {
        this.physics.removeBarrier(`bc_${conn.id}`);
        this.barrierChildActive.set(conn.id, false);
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
        if (conn.childRoomId === roomId && this.barrierChildActive.get(conn.id)) {
          this.physics.removeBarrier(`bc_${conn.id}`);
          this.barrierChildActive.set(conn.id, false);
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

  roomAt(x: number, y: number): RoomData | null {
    for (const room of this.rooms) {
      const xMin = (room.tileCol + 1) * TILE_SIZE;
      const xMax = (room.tileCol + ROOM_W - 1) * TILE_SIZE;
      const yMin = (room.tileRow + 1) * TILE_SIZE;
      const yMax = (room.tileRow + ROOM_H - 1) * TILE_SIZE;
      if (x >= xMin && x < xMax && y >= yMin && y < yMax) return room;
    }
    return null;
  }

  dispose(): void {
    for (const [connId, active] of this.barrierParentActive) {
      if (active) this.physics.removeBarrier(`bp_${connId}`);
    }
    for (const [connId, active] of this.barrierChildActive) {
      if (active) this.physics.removeBarrier(`bc_${connId}`);
    }
  }
}
