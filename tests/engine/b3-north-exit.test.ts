import { describe, it, expect } from "vitest";
import {
  FOOT_OFFSET,
  PLAYER_BODY_PROFILE,
  generateDungeon,
  roomInteriorRect,
  roomInteriorContains,
  RoomData,
  ConnectionData,
  DungeonResult,
} from "shared";
import type { PhysicsBody } from "../../engine/src/physics/PhysicsWorld";
import { PhysicsWorld } from "../../engine/src/physics/PhysicsWorld";
import { FloorManager } from "../../engine/src/floor/FloorManager";

// B3: a player could walk OUT of an uncleared room through its NORTH exit while the
// fight was still on. The exit barrier itself holds in every direction (see
// floor-and-barriers.test.ts) — the leak was the softlock guard. This replays it
// end-to-end against real floors: drive a committed body straight at a north exit
// and confirm the barrier stays up and the player never crosses out.

function northConn(d: DungeonResult): { conn: ConnectionData; parent: RoomData; child: RoomData } | null {
  const rooms = new Map(d.rooms.map(r => [r.id, r]));
  for (const c of d.connections) {
    const parent = rooms.get(c.parentRoomId)!;
    const child = rooms.get(c.childRoomId)!;
    if (parent.tileRow < child.tileRow) return { conn: c, parent, child }; // retreat = north
  }
  return null;
}

// The exact per-tick sequence GameRoom.tick runs around the one-way barrier:
// commit from the sprite position (sticky), re-lock on entry, step the body, then
// run the softlock guard with the SETTLED sprite position.
function driveNorth(physics: PhysicsWorld, floor: FloorManager, body: PhysicsBody, ticks: number) {
  let committedRoom: string | undefined;
  const spriteOf = () => ({ x: body.x, y: body.y - FOOT_OFFSET });
  for (let i = 0; i < ticks; i++) {
    const s = spriteOf();
    if (committedRoom) {
      const interior = floor.roomAt(s.x, s.y);
      if (floor.isRoomCleared(committedRoom) || (interior && interior.id !== committedRoom)) {
        committedRoom = undefined;
      }
    }
    if (!committedRoom && floor.isCommittedAt(s.x, s.y)) committedRoom = floor.roomAt(s.x, s.y)!.id;
    physics.setPlayerCommitted(body, committedRoom !== undefined);

    floor.checkPlayerEnteredRoom(s.x, s.y);

    physics.setVelocityPxPerSec(body, 0, -200);
    physics.step();

    floor.releaseAbandonedRooms([spriteOf()]);
  }
  return spriteOf();
}

describe("B3: cannot walk out of an uncleared room to the NORTH", () => {
  it("keeps a committed player in, and the barrier up, across real floors", () => {
    let tested = 0;
    for (let seed = 1; seed < 40 && tested < 3; seed++) {
      const d = generateDungeon(seed);
      const nc = northConn(d);
      if (!nc) continue;
      const { conn, parent, child } = nc;

      const physics = new PhysicsWorld(d.mapData, d.cols, d.rows);
      const floor = new FloorManager(d.rooms, d.connections, physics);
      const rect = roomInteriorRect(child);
      const centre = { x: (rect.xMin + rect.xMax) / 2, y: (rect.yMin + rect.yMax) / 2 };
      floor.assignEnemy("probe", centre.x, centre.y);

      const body = physics.createEntityBody(
        centre.x, centre.y,
        PLAYER_BODY_PROFILE.layer, PLAYER_BODY_PROFILE.solidMask,
      );
      const end = driveNorth(physics, floor, body, 120);
      tested++;

      expect(roomInteriorContains(parent, end.x, end.y), `leaked NORTH into parent (seed ${seed})`).toBe(false);
      expect(floor.isRoomCleared(child.id)).toBe(false);
      expect(floor.barrierSnapshot().childStanding, `barrier dropped under player (seed ${seed})`)
        .toContain(conn.id);
    }
    expect(tested, "no seed produced a NORTH-retreat room to test").toBeGreaterThan(0);
  });
});
