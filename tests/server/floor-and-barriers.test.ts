import { describe, it, expect } from "vitest";
import {
  generateDungeon,
  TILE_SIZE,
  PLAYER_BODY_PROFILE,
  roomInteriorRect,
  ConnectionData,
  RoomData,
  DungeonResult,
} from "shared";
import type Matter from "matter-js";
import { PhysicsWorld } from "../../server/src/physics/PhysicsWorld";
import { FloorManager } from "../../server/src/floor/FloorManager";
import { GooBlue } from "../../server/src/entities/enemies/goos";
import { physicsTick } from "../helpers/world";

// The lock/unlock rules that decide whether a party can move through the floor.
// These are the ones hardest to eyeball in play, and the ones whose failure mode
// is a softlock rather than a wrong number.

/** A real floor with at least one connection to test a doorway on. */
function floorWithConnection(): { seed: number; dungeon: DungeonResult } {
  for (let seed = 1; seed < 50; seed++) {
    const d = generateDungeon(seed);
    if (d.connections.length > 0) return { seed, dungeon: d };
  }
  throw new Error("no seed produced a connected floor");
}

function centreOf(room: RoomData) {
  const r = roomInteriorRect(room);
  return { x: (r.xMin + r.xMax) / 2, y: (r.yMin + r.yMax) / 2 };
}

function setup() {
  const { dungeon } = floorWithConnection();
  const conn = dungeon.connections[0];
  const child = dungeon.rooms.find(r => r.id === conn.childRoomId)!;
  const parent = dungeon.rooms.find(r => r.id === conn.parentRoomId)!;
  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const floor = new FloorManager(dungeon.rooms, dungeon.connections, physics);
  return { dungeon, conn, child, parent, physics, floor, childCentre: centreOf(child) };
}

/** Drive a body straight at a point, the way GameRoom drives a player. */
function pushToward(physics: PhysicsWorld, body: Matter.Body, tx: number, ty: number, steps: number) {
  for (let i = 0; i < steps; i++) {
    const dx = tx - body.position.x;
    const dy = ty - body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    physics.setVelocityPxPerSec(body, (dx / len) * 200, (dy / len) * 200);
    physics.step();
  }
  return { x: body.position.x, y: body.position.y };
}

const gateOf = (conn: ConnectionData) => ({ x: conn.barrierChild.cx, y: conn.barrierChild.cy });

const insideBox = (
  p: { x: number; y: number },
  b: { xMin: number; xMax: number; yMin: number; yMax: number },
  slack: number,
) => p.x >= b.xMin - slack && p.x <= b.xMax + slack && p.y >= b.yMin - slack && p.y <= b.yMax + slack;

describe("locking a room on entry", () => {
  it("starts with every advance barrier standing", () => {
    const { floor, dungeon } = setup();
    const snap = floor.barrierSnapshot();
    expect(snap.parentStanding).toHaveLength(dungeon.connections.length);
    expect(snap.childStanding).toHaveLength(0);
  });

  it("raises the exit barrier when a player enters a room with enemies", () => {
    const { floor, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);

    const locked = floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    expect(locked).toEqual([conn.id]);
    expect(floor.barrierSnapshot().childStanding).toContain(conn.id);
  });

  it("locks a room only once, however many players walk in", () => {
    const { floor, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    expect(floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y)).toHaveLength(1);
    expect(floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y)).toHaveLength(0);
  });

  it("never locks the retreat path out of an empty room", () => {
    const { floor, childCentre } = setup();
    // No enemies assigned at all.
    expect(floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y)).toHaveLength(0);
  });

  it("ignores a position that is in no room's interior", () => {
    const { floor } = setup();
    expect(floor.checkPlayerEnteredRoom(-500, -500)).toHaveLength(0);
    expect(floor.roomAt(-500, -500)).toBeNull();
  });
});

describe("clearing a room", () => {
  it("pre-clears every empty room and opens its advance barrier", () => {
    const { floor, dungeon, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);

    const opened = floor.finalizeEmptyRooms();

    for (const room of dungeon.rooms) {
      const hasEnemy = room.id === conn.childRoomId;
      expect(floor.isRoomCleared(room.id), room.id).toBe(!hasEnemy);
    }
    expect(opened.length).toBeGreaterThan(0);
  });

  it("does not open a room's doors until the LAST enemy is down", () => {
    const { floor, conn, childCentre } = setup();
    const dying = new Set<string>();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.assignEnemy("e2", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    dying.add("e1");
    expect(floor.onEnemyMaybeCleared("e1", id => dying.has(id)).childUnlocked).toHaveLength(0);
    expect(floor.isRoomCleared(conn.childRoomId)).toBe(false);

    dying.add("e2");
    const result = floor.onEnemyMaybeCleared("e2", id => dying.has(id));
    expect(result.childUnlocked).toContain(conn.id);
    expect(floor.isRoomCleared(conn.childRoomId)).toBe(true);
  });

  it("opens both the retreat and the advance barriers on clear", () => {
    const { floor, dungeon, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    // Give the room something to advance INTO, if the floor has it.
    const onward = dungeon.connections.filter(c => c.parentRoomId === conn.childRoomId);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    const r = floor.onEnemyMaybeCleared("e1", () => true);

    expect(r.childUnlocked).toContain(conn.id);
    expect(r.parentUnlocked.sort()).toEqual(onward.map(c => c.id).sort());
  });

  it("reports nothing on a second clear of the same room", () => {
    const { floor, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.onEnemyMaybeCleared("e1", () => true);

    const again = floor.onEnemyMaybeCleared("e1", () => true);
    expect(again.parentUnlocked).toHaveLength(0);
    expect(again.childUnlocked).toHaveLength(0);
  });

  it("ignores an enemy that was never homed to a room", () => {
    const { floor } = setup();
    expect(floor.onEnemyMaybeCleared("ghost", () => true).parentUnlocked).toHaveLength(0);
  });

  it("remembers which room each enemy belongs to", () => {
    const { floor, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    expect(floor.getEnemyRoom("e1")).toBe(conn.childRoomId);
    expect(floor.getEnemyRoom("nobody")).toBeUndefined();
  });
});

describe("the softlock guard", () => {
  it("releases a locked room nobody is standing in any more", () => {
    const { floor, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    // Everyone left (died and respawned at start, or disconnected).
    const released = floor.releaseAbandonedRooms([{ x: 0, y: 0 }]);

    expect(released).toContain(conn.id);
    expect(floor.barrierSnapshot().childStanding).not.toContain(conn.id);
  });

  it("leaves a locked room alone while someone is still in it", () => {
    const { floor, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    expect(floor.releaseAbandonedRooms([childCentre])).toHaveLength(0);
  });

  it("lets the room lock again the next time someone walks in", () => {
    const { floor, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);
    floor.releaseAbandonedRooms([{ x: 0, y: 0 }]);

    expect(floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y)).toEqual([conn.id]);
  });
});

describe("room occupancy and dormancy", () => {
  it("reports the room a player is standing in", () => {
    const { floor, conn, childCentre } = setup();
    expect(floor.occupiedRoomIds([childCentre])).toEqual(new Set([conn.childRoomId]));
  });

  it("counts a player in a passageway as present in BOTH rooms it joins", () => {
    // So creatures you are walking towards are already awake, rather than
    // snapping to life once you are through the door.
    const { floor, conn } = setup();
    const gate = gateOf(conn);
    const occupied = floor.occupiedRoomIds([gate]);

    expect(occupied.has(conn.parentRoomId)).toBe(true);
    expect(occupied.has(conn.childRoomId)).toBe(true);
  });

  it("reports nothing when the party is nowhere near a room", () => {
    const { floor } = setup();
    expect(floor.occupiedRoomIds([{ x: -999, y: -999 }]).size).toBe(0);
  });

  it("shields a player in an unrelated passageway from a room's enemies", () => {
    const { floor, dungeon, conn } = setup();
    const gate = gateOf(conn);
    const otherRoom = dungeon.rooms.find(r => r.id !== conn.parentRoomId && r.id !== conn.childRoomId)!;

    expect(floor.isProtectedFromRoom(gate.x, gate.y, otherRoom.id)).toBe(true);
    // ...but NOT from the rooms that passageway actually touches.
    expect(floor.isProtectedFromRoom(gate.x, gate.y, conn.childRoomId)).toBe(false);
    expect(floor.isProtectedFromRoom(gate.x, gate.y, conn.parentRoomId)).toBe(false);
  });

  it("shields nobody from an enemy with no home room", () => {
    const { floor, conn } = setup();
    const gate = gateOf(conn);
    expect(floor.isProtectedFromRoom(gate.x, gate.y, undefined)).toBe(false);
  });
});

describe("commitment (what makes the exit barrier one-way)", () => {
  it("reads a player inside a locked, uncleared room as committed", () => {
    const { floor, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);

    expect(floor.isCommittedAt(childCentre.x, childCentre.y)).toBe(true);
  });

  it("drops commitment the moment the room is cleared", () => {
    const { floor, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);
    floor.onEnemyMaybeCleared("e1", () => true);

    expect(floor.isCommittedAt(childCentre.x, childCentre.y)).toBe(false);
  });

  it("never commits a player standing in the doorway itself", () => {
    // Load-bearing: a body that gained the barrier bit while overlapping the
    // barrier would be squeezed out to an arbitrary side.
    const { floor, conn, childCentre } = setup();
    floor.assignEnemy("e1", childCentre.x, childCentre.y);
    floor.checkPlayerEnteredRoom(childCentre.x, childCentre.y);
    const gate = gateOf(conn);

    expect(floor.isCommittedAt(gate.x, gate.y)).toBe(false);
  });

  it("never commits a player in an unlocked room", () => {
    const { floor, childCentre } = setup();
    expect(floor.isCommittedAt(childCentre.x, childCentre.y)).toBe(false);
  });
});

describe("the one-way barrier, in physics", () => {
  function raisedGate() {
    const s = setup();
    s.floor.assignEnemy("probe", s.childCentre.x, s.childCentre.y);
    s.floor.checkPlayerEnteredRoom(s.childCentre.x, s.childCentre.y);
    return { ...s, gate: gateOf(s.conn) };
  }

  it("lets an UNCOMMITTED player walk in through a standing exit barrier", () => {
    const { physics, gate } = raisedGate();
    const body = physics.createEntityBody(
      gate.x, gate.y - TILE_SIZE * 2 - 8,
      PLAYER_BODY_PROFILE.layer, PLAYER_BODY_PROFILE.solidMask,
    );
    const startDist = Math.hypot(body.position.x - gate.x, body.position.y - gate.y);
    const end = pushToward(physics, body, gate.x, gate.y, 40);

    expect(Math.hypot(end.x - gate.x, end.y - gate.y)).toBeLessThan(startDist * 0.5);
  });

  it("stops a COMMITTED body on the very same approach — the A/B that proves one-way", () => {
    const { physics, gate } = raisedGate();
    const free = physics.createEntityBody(
      gate.x, gate.y - TILE_SIZE * 2 - 8,
      PLAYER_BODY_PROFILE.layer, PLAYER_BODY_PROFILE.solidMask,
    );
    const freeEnd = pushToward(physics, free, gate.x, gate.y, 40);
    const freeDist = Math.hypot(freeEnd.x - gate.x, freeEnd.y - gate.y);
    physics.removeBody(free);

    const held = physics.createEntityBody(
      gate.x, gate.y - TILE_SIZE * 2 - 8,
      PLAYER_BODY_PROFILE.layer, PLAYER_BODY_PROFILE.solidMask,
    );
    physics.setPlayerCommitted(held, true);
    const heldEnd = pushToward(physics, held, gate.x, gate.y, 40);

    expect(Math.hypot(heldEnd.x - gate.x, heldEnd.y - gate.y)).toBeGreaterThan(freeDist + 4);
  });

  it("holds a committed player inside the room, and lets them out once cleared", () => {
    const { physics, floor, gate, child, childCentre } = raisedGate();
    const rect = roomInteriorRect(child);
    const body = physics.createEntityBody(
      childCentre.x, childCentre.y,
      PLAYER_BODY_PROFILE.layer, PLAYER_BODY_PROFILE.solidMask,
    );
    physics.setPlayerCommitted(body, true);
    const beyond = { x: gate.x + (gate.x - childCentre.x) * 2, y: gate.y + (gate.y - childCentre.y) * 2 };

    const stopped = pushToward(physics, body, beyond.x, beyond.y, 80);
    expect(insideBox(stopped, rect, TILE_SIZE * 1.5), "walked out of a locked room").toBe(true);

    // Clearing the room releases the hold.
    floor.onEnemyMaybeCleared("probe", () => true);
    physics.setPlayerCommitted(body, false);
    const freed = pushToward(physics, body, beyond.x, beyond.y, 80);
    expect(Math.hypot(freed.x - stopped.x, freed.y - stopped.y)).toBeGreaterThan(TILE_SIZE);
  });

  it("blocks projectiles from BOTH sides — one-way applies to walking only", () => {
    const { physics, gate } = raisedGate();
    expect(physics.barrierAt(gate.x, gate.y)).toBe(true);
  });

  it("stops registering as solid once the barrier comes down", () => {
    const { physics, floor, gate } = raisedGate();
    floor.onEnemyMaybeCleared("probe", () => true);
    expect(physics.barrierAt(gate.x, gate.y)).toBe(false);
  });

  it("removes every barrier on dispose", () => {
    const { physics, floor, gate } = raisedGate();
    floor.dispose();
    expect(physics.barrierAt(gate.x, gate.y)).toBe(false);
    expect(floor.barrierSnapshot()).toEqual({ parentStanding: [], childStanding: [] });
  });
});

describe("enemy containment on a real floor", () => {
  it("keeps a confined enemy inside its home room however hard it chases", () => {
    const { physics, child, childCentre, conn } = setup();
    const rect = roomInteriorRect(child);
    const enemy = new GooBlue(physics, childCentre.x, childCentre.y);
    enemy.confineTo(rect);
    const gate = gateOf(conn);
    const beyond = { x: gate.x + (gate.x - childCentre.x) * 2, y: gate.y + (gate.y - childCentre.y) * 2 };

    for (let i = 0; i < 120; i++) {
      (enemy as unknown as { move(dx: number, dy: number, s: number): void })
        .move(beyond.x - enemy.state.x, beyond.y - enemy.state.y, 120);
      physicsTick(physics, [enemy]);
    }

    expect(insideBox({ x: enemy.state.x, y: enemy.state.y }, rect, 8)).toBe(true);
  });
});
