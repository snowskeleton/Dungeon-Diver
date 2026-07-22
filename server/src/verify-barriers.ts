/**
 * Headless checks for the playtest fixes that are hardest to eyeball:
 * one-way barriers (B1/G1), enemy room containment (B6), and the barrier's
 * effect on projectiles (B5).
 *
 * Boots the REAL PhysicsWorld + FloorManager + Enemy classes with no server and
 * no browser, and prints a pass/fail line per assertion — same shape as
 * verify-combat / verify-boss / verify-rooms.
 *
 *   npx ts-node server/src/verify-barriers.ts
 */

import {
  generateDungeon,
  TILE_SIZE,
  PLAYER_BODY_PROFILE,
  roomInteriorRect,
  ConnectionData,
} from "shared";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { FloorManager } from "./floor/FloorManager";
import { GooBlue } from "./entities/enemies/goos";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
}

/** A floor with at least one connection, so there's a doorway to test. */
function floorWithConnection() {
  for (let seed = 1; seed < 50; seed++) {
    const d = generateDungeon(seed);
    if (d.connections.length > 0) return { seed, dungeon: d };
  }
  throw new Error("no seed produced a connected floor");
}

/** Walk a body straight at a target point for `steps` ticks and report where it
 *  ended up. Uses the same commit → step → sync path GameRoom uses. */
function pushToward(
  physics: PhysicsWorld,
  body: import("matter-js").Body,
  tx: number,
  ty: number,
  steps: number,
): { x: number; y: number } {
  for (let i = 0; i < steps; i++) {
    const dx = tx - body.position.x;
    const dy = ty - body.position.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 200; // px/sec, comfortably faster than a player walks
    physics.setVelocityPxPerSec(body, (dx / len) * speed, (dy / len) * speed);
    physics.step();
  }
  return { x: body.position.x, y: body.position.y };
}

function midpoint(conn: ConnectionData) {
  const r = conn.barrierChild;
  return { x: r.cx, y: r.cy };
}

function main() {
  console.log("── one-way barriers / containment ──────────────────────────────");

  const { seed, dungeon } = floorWithConnection();
  const conn = dungeon.connections[0];
  const childRoom = dungeon.rooms.find((r) => r.id === conn.childRoomId)!;
  const parentRoom = dungeon.rooms.find((r) => r.id === conn.parentRoomId)!;
  console.log(`   seed ${seed}, connection ${conn.id}: ${parentRoom.id} → ${childRoom.id}`);

  const physics = new PhysicsWorld(dungeon.mapData, dungeon.cols, dungeon.rows);
  const floor = new FloorManager(dungeon.rooms, dungeon.connections, physics);

  // Stand the child room's exit barrier up, the way entering the room does.
  const childRect = roomInteriorRect(childRoom);
  const childCenter = {
    x: (childRect.xMin + childRect.xMax) / 2,
    y: (childRect.yMin + childRect.yMax) / 2,
  };
  floor.assignEnemy("probe", childCenter.x, childCenter.y); // room must have enemies to lock
  const locked = floor.checkPlayerEnteredRoom(childCenter.x, childCenter.y);
  check("entering a room with enemies raises its exit barrier", locked.length === 1, `(${locked.join()})`);

  // ── 1. A player who has NOT entered can still walk in ──────────────────────
  const gate = midpoint(conn);
  const outside = physics.createEntityBody(
    gate.x,
    gate.y - TILE_SIZE * 2 - 8,
    PLAYER_BODY_PROFILE.layer,
    PLAYER_BODY_PROFILE.solidMask,
  );
  const startDist = Math.hypot(outside.position.x - gate.x, outside.position.y - gate.y);
  const after = pushToward(physics, outside, gate.x, gate.y, 40);
  const endDist = Math.hypot(after.x - gate.x, after.y - gate.y);
  check(
    "an UNCOMMITTED player passes through a raised exit barrier (walks in)",
    endDist < startDist * 0.5,
    `dist ${startDist.toFixed(1)} → ${endDist.toFixed(1)}`,
  );
  physics.removeBody(outside);

  // The A/B that proves the barrier is really one-way rather than simply absent:
  // the SAME approach, from the same spot, is blocked once the body carries the
  // committed mask.
  const blocked = physics.createEntityBody(
    gate.x,
    gate.y - TILE_SIZE * 2 - 8,
    PLAYER_BODY_PROFILE.layer,
    PLAYER_BODY_PROFILE.solidMask,
  );
  physics.setPlayerCommitted(blocked, true);
  const blockedEnd = pushToward(physics, blocked, gate.x, gate.y, 40);
  const blockedDist = Math.hypot(blockedEnd.x - gate.x, blockedEnd.y - gate.y);
  check(
    "the same barrier DOES stop a body that carries the committed mask",
    blockedDist > endDist + 4,
    `committed stopped ${blockedDist.toFixed(1)}px out vs uncommitted ${endDist.toFixed(1)}px`,
  );
  physics.removeBody(blocked);

  // ── 2. A committed player cannot walk back out through the same barrier ────
  const inside = physics.createEntityBody(
    childCenter.x,
    childCenter.y,
    PLAYER_BODY_PROFILE.layer,
    PLAYER_BODY_PROFILE.solidMask,
  );
  check(
    "a player standing in the locked room reads as committed",
    floor.isCommittedAt(childCenter.x, childCenter.y),
  );
  physics.setPlayerCommitted(inside, true);
  // Aim at a point well beyond the doorway, i.e. genuinely trying to leave.
  const beyond = {
    x: gate.x + (gate.x - childCenter.x) * 2,
    y: gate.y + (gate.y - childCenter.y) * 2,
  };
  const stopped = pushToward(physics, inside, beyond.x, beyond.y, 80);
  const escaped = !insideBox(stopped, childRect, TILE_SIZE * 1.5);
  check("a COMMITTED player is held inside the room (can't walk out)", !escaped,
    `ended (${stopped.x.toFixed(0)},${stopped.y.toFixed(0)})`);

  // Clearing the room must release them.
  physics.setPlayerCommitted(inside, false);
  const freed = pushToward(physics, inside, beyond.x, beyond.y, 80);
  check(
    "clearing the room releases the hold (uncommitted can leave)",
    Math.hypot(freed.x - stopped.x, freed.y - stopped.y) > TILE_SIZE,
    `moved ${Math.hypot(freed.x - stopped.x, freed.y - stopped.y).toFixed(1)}px`,
  );
  physics.removeBody(inside);

  // ── 3. Projectiles are stopped by a raised barrier ─────────────────────────
  check("a raised barrier registers as solid to projectiles", physics.barrierAt(gate.x, gate.y));

  // ── 4. Enemy containment ──────────────────────────────────────────────────
  const enemy = new GooBlue(physics, childCenter.x, childCenter.y);
  enemy.confineTo(childRect);
  // Drive it straight at the doorway for a good long while.
  for (let i = 0; i < 120; i++) {
    (enemy as unknown as { move(dx: number, dy: number, s: number): void }).move(
      beyond.x - enemy.state.x,
      beyond.y - enemy.state.y,
      120,
    );
    enemy.commitVelocity();
    physics.step();
    enemy.syncFromBody();
  }
  check(
    "a confined enemy cannot leave its home room",
    insideBox({ x: enemy.state.x, y: enemy.state.y }, childRect, 2),
    `ended (${enemy.state.x.toFixed(0)},${enemy.state.y.toFixed(0)}) in x[${childRect.xMin}..${childRect.xMax}] y[${childRect.yMin}..${childRect.yMax}]`,
  );

  console.log("");
  if (failures === 0) console.log("✅ BARRIERS + CONTAINMENT OK");
  else console.log(`❌ ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

function insideBox(
  p: { x: number; y: number },
  b: { xMin: number; xMax: number; yMin: number; yMax: number },
  slack: number,
): boolean {
  return (
    p.x >= b.xMin - slack && p.x <= b.xMax + slack &&
    p.y >= b.yMin - slack && p.y <= b.yMax + slack
  );
}

main();
