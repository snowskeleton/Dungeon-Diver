/**
 * Dead-reckoning for entities the client does NOT simulate — remote players and
 * enemies. Their authoritative position arrives at the sim's tick rate (20 Hz) and,
 * for a P2P guest, a transport round-trip late; a view that only lerped toward the
 * last sample would always trail by that whole gap and feel laggy.
 *
 * So instead of chasing a stale point, we chase a PROJECTED one: measure the
 * entity's velocity from successive samples and extend the last known position
 * forward by the time elapsed since it arrived. This is deliberately NOT an attempt
 * to reproduce enemy pathing — we never run the flow field or AI here. It's a
 * one-segment linear guess that the next authoritative sample corrects, which is all
 * "good enough" motion needs and can never desync (every sample re-anchors it).
 *
 * The projection is bounded (`maxLeadMs`): a dropped update or a sudden stop can't
 * fling the sprite away, because we never lead by more than a couple of ticks — the
 * sprite holds a hair ahead and snaps true on the next sample. The caller still lerps
 * its sprite toward `target()`, so the correction is smoothed, never a visible pop.
 */
export class Extrapolator {
  private hasSample = false;
  private lastX = 0;
  private lastY = 0;
  private vx = 0; // px per ms
  private vy = 0;
  private hasVelocity = false;
  private lastTime = 0;

  /** @param maxLeadMs How far ahead of the last sample we ever project. ~2.4 sim
   *  ticks: enough to bridge transport jitter or one dropped delta, short enough
   *  that a stop overshoots by only a few px before the next sample corrects it. */
  constructor(private readonly maxLeadMs = 120) {}

  /** Feed one authoritative position sample (from a state patch).
   *
   *  A patch that carries no positional change (e.g. an HP-only hit) arrives with the
   *  same x/y, and several patches can land within one tick; both would corrupt the
   *  velocity estimate. So samples closer than a tick apart are ignored as duplicates,
   *  and a same-position sample bleeds velocity toward zero rather than recomputing it
   *  (that IS the "the entity stopped" signal). */
  sample(x: number, y: number, now: number): void {
    if (!this.hasSample) {
      this.reset(x, y, now);
      return;
    }
    const dt = now - this.lastTime;
    // Multiple patches within one tick — treat as duplicates of one sample.
    if (dt < 8) return;
    const moved = Math.hypot(x - this.lastX, y - this.lastY);
    if (moved > 0.05) {
      const instVx = (x - this.lastX) / dt;
      const instVy = (y - this.lastY) / dt;
      if (this.hasVelocity) {
        // EMA-smooth so a jittery inter-patch dt doesn't make the projection twitch.
        this.vx = this.vx * 0.4 + instVx * 0.6;
        this.vy = this.vy * 0.4 + instVy * 0.6;
      } else {
        // First measured velocity: adopt it directly, so motion right after a spawn
        // or reset projects at true speed instead of a damped fraction of it.
        this.vx = instVx;
        this.vy = instVy;
        this.hasVelocity = true;
      }
    } else {
      // Held position — decay the heading so we stop projecting a stale one.
      this.vx *= 0.5;
      this.vy *= 0.5;
    }
    this.lastX = x;
    this.lastY = y;
    this.lastTime = now;
  }

  /** The projected position at `now`: last sample + velocity × (bounded) lead. */
  target(now: number): { x: number; y: number } {
    if (!this.hasSample) return { x: this.lastX, y: this.lastY };
    const lead = Math.min(Math.max(0, now - this.lastTime), this.maxLeadMs);
    return { x: this.lastX + this.vx * lead, y: this.lastY + this.vy * lead };
  }

  /** Hard-anchor to a position with no inferred velocity — for a teleport, floor
   *  change, or the first sample, where a projected heading would be wrong. */
  reset(x: number, y: number, now: number): void {
    this.hasSample = true;
    this.lastX = x;
    this.lastY = y;
    this.lastTime = now;
    this.vx = 0;
    this.vy = 0;
    this.hasVelocity = false;
  }
}
