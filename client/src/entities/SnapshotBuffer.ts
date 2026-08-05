/**
 * Render-in-the-past interpolation for entities the client does NOT simulate — remote
 * players and enemies. Their authoritative position arrives at the sim's tick rate
 * (20 Hz) and, for a P2P guest, a transport round-trip late.
 *
 * The predecessor (Extrapolator) projected the last sample FORWARD by its measured
 * velocity, so it rendered "where the entity is now" — at the cost of overshooting every
 * stop and direction-reversal (it can't know an entity stopped until a later sample says
 * so). That overshoot is the "mushy controls / co-op drift" bug: one character halts
 * instantly (locally predicted) while its twin coasts past (extrapolated).
 *
 * This instead renders the entity slightly in the PAST (`now - delay`), always
 * INTERPOLATING between two samples we have already received. It never guesses the
 * future, so it can never overshoot: when the entity stops, the newest sample sits on
 * the stop point and we interpolate exactly onto it and hold. The cost is a small,
 * constant render delay — invisible for teammates, and the whole point (no drift) for
 * the stop the user was chasing.
 *
 * Two wrinkles this handles:
 *   - Colyseus patches at 60 Hz while true position only changes at 20 Hz, so `push` is
 *     called ~3× per real move with duplicate coords. We enqueue only DISTINCT positions,
 *     keeping keyframes at the true ~50ms motion cadence (a compressed segment would make
 *     interpolation jitter — fast jump, then flat).
 *   - An entity that rests then moves leaves an ancient last-keyframe; interpolating
 *     across that whole idle gap would crawl. `sampleAt` caps the segment it will span
 *     (`MAX_SEG_MS`) so the sprite races to the fresh keyframe instead.
 */

/** How far apart two coords must be to count as a distinct keyframe (px). Collapses the
 *  60 Hz duplicate patches and a held-still position into one sample. */
const MOVE_EPSILON = 0.05;

/** Longest segment `sampleAt` will interpolate across. A normal move segment is ~50ms
 *  (one sim tick); anything longer is an idle-then-move gap, and we clamp the segment
 *  start so the sprite catches up to the new keyframe within this window rather than
 *  crawling across seconds of stale time. */
const MAX_SEG_MS = 120;

/** Samples older than this are dropped — we never look back further than a couple of
 *  render delays, so a long history is dead weight. */
const MAX_HISTORY_MS = 500;

interface Snapshot {
  x: number;
  y: number;
  t: number;
}

export class SnapshotBuffer {
  private samples: Snapshot[] = [];

  /** Feed one authoritative position sample (timestamped by arrival). Duplicate coords
   *  (same position re-sent by the 60 Hz patch stream, or a held-still entity) are
   *  ignored so stored samples stay true ~50ms motion keyframes. */
  push(x: number, y: number, t: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < MOVE_EPSILON) return;
    this.samples.push({ x, y, t });
    // Trim history relative to the newest sample's clock (not `now` — callers pass the
    // same `performance.now()` for both, but keeping it self-contained is tidier).
    const cutoff = t - MAX_HISTORY_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** The interpolated position at `renderTime` (the caller passes `now - delay`).
   *  Interpolates between the two bracketing samples; holds the newest when starved
   *  (a dropped patch) and the oldest when asked for a time before our history. Never
   *  extrapolates past the newest sample, so it can never overshoot a stop. */
  sampleAt(renderTime: number): { x: number; y: number } {
    const s = this.samples;
    if (s.length === 0) return { x: 0, y: 0 };
    if (s.length === 1) return { x: s[0].x, y: s[0].y };

    const newest = s[s.length - 1];
    // Past the newest sample: hold it (a stop, or a dropped patch). No projection.
    if (renderTime >= newest.t) return { x: newest.x, y: newest.y };
    // Before our oldest sample: hold the oldest.
    if (renderTime <= s[0].t) return { x: s[0].x, y: s[0].y };

    // Find the segment [a, b] straddling renderTime.
    let a = s[0];
    let b = s[1];
    for (let i = 1; i < s.length; i++) {
      if (s[i].t >= renderTime) {
        a = s[i - 1];
        b = s[i];
        break;
      }
    }

    // Cap the span so an idle-then-move gap doesn't crawl: treat the segment as starting
    // no earlier than MAX_SEG_MS before its end.
    const start = Math.max(a.t, b.t - MAX_SEG_MS);
    const span = b.t - start;
    const alpha = span <= 0 ? 1 : Math.min(1, Math.max(0, (renderTime - start) / span));
    return {
      x: a.x + (b.x - a.x) * alpha,
      y: a.y + (b.y - a.y) * alpha,
    };
  }

  /** Hard-anchor to a single position with no history — for a teleport, floor change,
   *  enemy revive, or the first sample, where interpolating across the jump is wrong. */
  reset(x: number, y: number, t: number): void {
    this.samples = [{ x, y, t }];
  }

  get hasSample(): boolean {
    return this.samples.length > 0;
  }
}
