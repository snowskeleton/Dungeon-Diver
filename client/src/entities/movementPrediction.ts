import { InputMessage, SERVER_TICK_MS, FOOT_OFFSET } from "shared";

// Pure client-prediction math — no Phaser, so it's unit-testable in isolation (the
// LocalPlayer that uses it is Phaser-heavy). This is the client half of the
// authoritative-server prediction loop: it reproduces the server's per-tick movement
// integration (normalize → speed → per-axis wall stop at the foot point) at the fixed
// sim dt, so replaying the inputs the server hasn't acked yet lands the prediction
// exactly where the server will once it processes them.

export type Vec = { x: number; y: number };
export type StampedInput = { seq: number; input: InputMessage };

/** One fixed-timestep movement step from `pos` under `input`, at effective `speed`
 *  (px/sec, already folded with speedMultiplier). `walkableAt` tests the foot point the
 *  server collides from; a blocked axis is held, exactly like the server's solver stop.
 *  Returns a fresh position (never mutates `pos`). */
export function stepMovement(
  pos: Vec,
  input: InputMessage,
  speed: number,
  walkableAt: (x: number, y: number) => boolean,
): Vec {
  const len = Math.hypot(input.dx, input.dy);
  if (len === 0 || speed <= 0) return { x: pos.x, y: pos.y };
  const step = speed * (SERVER_TICK_MS / 1000);
  const ux = (input.dx / len) * step;
  const uy = (input.dy / len) * step;
  let nx = pos.x;
  const tx = pos.x + ux;
  if (walkableAt(tx, pos.y + FOOT_OFFSET)) nx = tx;
  let ny = pos.y;
  const ty = pos.y + uy;
  if (walkableAt(nx, ty + FOOT_OFFSET)) ny = ty;
  return { x: nx, y: ny };
}

/** Advance an authoritative base position by a run of inputs — the predicted position
 *  is always the server position replayed forward through the still-unacked inputs. */
export function replayInputs(
  base: Vec,
  history: readonly StampedInput[],
  speed: number,
  walkableAt: (x: number, y: number) => boolean,
): Vec {
  let pos: Vec = { x: base.x, y: base.y };
  for (const h of history) pos = stepMovement(pos, h.input, speed, walkableAt);
  return pos;
}

/** True when `seq` has been processed by the server (its ack), wrap-aware for the
 *  uint16 counter: ack is "at or ahead of" seq when their forward distance is under
 *  half the range. Acked inputs are pruned from the unacked history on reconcile. */
export function seqAcked(seq: number, ack: number): boolean {
  return ((ack - seq) & 0xffff) < 0x8000;
}
