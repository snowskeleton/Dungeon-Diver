import { describe, it, expect } from "vitest";
import { InputMessage, SERVER_TICK_MS } from "shared";
import {
  stepMovement,
  replayInputs,
  seqAcked,
  StampedInput,
} from "../../client/src/entities/movementPrediction";

// The client half of the authoritative-server prediction loop. These pin the contract
// that keeps a P2P guest from rubber-banding: replaying N unacked inputs from a fresh
// server position lands exactly where N fixed server steps would, acked inputs are
// pruned, and a blocked axis holds (no predicting through walls). Behaviour and
// relationships only — the shipping dt is read from SERVER_TICK_MS, never a literal.

const SPEED = 120; // px/sec
const open = () => true; // everywhere walkable
const move = (dx: number, dy: number): InputMessage => ({ dx, dy, attack: false, ability: false });
const stamp = (seq: number, dx: number, dy: number): StampedInput => ({ seq, input: move(dx, dy) });
const perStep = SPEED * (SERVER_TICK_MS / 1000); // px moved by one fixed step at full speed

describe("stepMovement", () => {
  it("advances one fixed step along the normalized input at the sim dt", () => {
    const p = stepMovement({ x: 0, y: 0 }, move(1, 0), SPEED, open);
    expect(p.x).toBeCloseTo(perStep, 6);
    expect(p.y).toBe(0);
  });

  it("normalizes so a diagonal moves at the same speed, not faster", () => {
    const diag = stepMovement({ x: 0, y: 0 }, move(1, 1), SPEED, open);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(perStep, 6);
  });

  it("is a no-op with no input or no speed, and never mutates the input position", () => {
    const base = { x: 5, y: 7 };
    expect(stepMovement(base, move(0, 0), SPEED, open)).toEqual(base);
    expect(stepMovement(base, move(1, 0), 0, open)).toEqual(base);
    expect(base).toEqual({ x: 5, y: 7 }); // untouched
  });

  it("holds the blocked axis independently (per-axis wall stop)", () => {
    // A wall to the right of x=10 (foot point): rightward is blocked, downward is free.
    const wallAt = (x: number, _y: number) => x <= 10;
    const p = stepMovement({ x: 10, y: 0 }, move(1, 1), SPEED, wallAt);
    expect(p.x).toBe(10); // x pinned by the wall
    expect(p.y).toBeGreaterThan(0); // y still advanced
  });
});

describe("replayInputs", () => {
  it("replaying N unacked inputs equals N fixed steps from the base", () => {
    const base = { x: 100, y: 100 };
    const history = [stamp(1, 1, 0), stamp(2, 1, 0), stamp(3, 1, 0)];
    const replayed = replayInputs(base, history, SPEED, open);
    expect(replayed.x).toBeCloseTo(100 + 3 * perStep, 6);
    expect(replayed.y).toBe(100);
  });

  it("re-basing onto a new server position and replaying the remainder is exact", () => {
    // Predict 5 inputs from origin; the server acks the first 2 and reports where it
    // put us. Replaying the remaining 3 from that authoritative base must match having
    // predicted all 5 from origin (open space → prediction and server agree).
    const all = [1, 2, 3, 4, 5].map((s) => stamp(s, 1, 0));
    const fullPredict = replayInputs({ x: 0, y: 0 }, all, SPEED, open);
    const serverAfter2 = replayInputs({ x: 0, y: 0 }, all.slice(0, 2), SPEED, open);
    const reconciled = replayInputs(serverAfter2, all.slice(2), SPEED, open);
    expect(reconciled.x).toBeCloseTo(fullPredict.x, 6);
  });

  it("an empty history leaves the base untouched", () => {
    expect(replayInputs({ x: 3, y: 4 }, [], SPEED, open)).toEqual({ x: 3, y: 4 });
  });
});

describe("seqAcked (wrap-aware uint16)", () => {
  it("treats seqs at or below the ack as processed", () => {
    expect(seqAcked(5, 5)).toBe(true);
    expect(seqAcked(4, 5)).toBe(true);
    expect(seqAcked(6, 5)).toBe(false); // still in flight
  });

  it("handles the uint16 wrap: a low seq after the counter rolled is still acked", () => {
    // ack has wrapped to 2; seq 65534 (just before the wrap) is behind it.
    expect(seqAcked(65534, 2)).toBe(true);
    // but a seq just ahead of the wrapped ack is not yet acked.
    expect(seqAcked(4, 2)).toBe(false);
  });

  it("pruning a history by the ack drops exactly the processed prefix", () => {
    const history: StampedInput[] = [1, 2, 3, 4].map((s) => stamp(s, 1, 0));
    const ack = 2;
    const kept = history.filter((h) => !seqAcked(h.seq, ack));
    expect(kept.map((h) => h.seq)).toEqual([3, 4]);
  });
});
