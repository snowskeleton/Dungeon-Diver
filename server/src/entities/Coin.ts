import {
  COIN_IDLE_MS, COIN_MAGNET_SPEED, COIN_PICKUP_RADIUS,
} from "shared";
import { CoinState } from "../schema/CoinState";
import { PlayerState } from "../schema/PlayerState";

// A gold coin lying on the floor. Like a Projectile it is kinematic — no matter-js
// body — so the server just integrates its position directly and the client lerps
// to it. A coin lies still for COIN_IDLE_MS, then homes toward the nearest player
// from anywhere on the floor (no distance gate — the whole floor's gold comes to
// you once the delay passes). Either way, the instant a player is within
// COIN_PICKUP_RADIUS it is swept up (walking over a fresh coin collects it before
// the homing ever starts), its value added to the shared purse.
export class Coin {
  readonly state = new CoinState();
  private idleRemainingMs = COIN_IDLE_MS;

  constructor(x: number, y: number, value: number) {
    this.state.x = x;
    this.state.y = y;
    this.state.value = value;
  }

  /** Advance one tick. Returns true once collected — GameRoom then adds `value` to
   *  the purse and removes the coin. Collection is checked every tick regardless of
   *  the idle phase, so walking over a just-dropped coin picks it up immediately. */
  update(dtMs: number, players: Map<string, PlayerState>): boolean {
    const nearest = this.nearestPlayer(players);
    if (nearest && nearest.dist <= COIN_PICKUP_RADIUS) return true;

    if (this.idleRemainingMs > 0) {
      this.idleRemainingMs -= dtMs;
      return false;
    }

    // Homing: once the idle passes, the coin pulls toward the nearest player from
    // anywhere on the floor — no distance gate. It tracks straight-line and may
    // cross walls on its way in; that's the intended "all the gold zooms to me" feel.
    if (nearest && nearest.dist > 0) {
      const step = COIN_MAGNET_SPEED * (dtMs / 1000);
      const t = Math.min(1, step / nearest.dist);
      this.state.x += nearest.dx * t;
      this.state.y += nearest.dy * t;
    }
    return false;
  }

  private nearestPlayer(
    players: Map<string, PlayerState>,
  ): { dist: number; dx: number; dy: number } | null {
    let best: { dist: number; dx: number; dy: number } | null = null;
    players.forEach((p) => {
      const dx = p.x - this.state.x;
      const dy = p.y - this.state.y;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { dist, dx, dy };
    });
    return best;
  }
}
