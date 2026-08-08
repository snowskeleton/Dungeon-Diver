// ── Enemy separation steering ─────────────────────────────────────────────────
// The flow field answers "which way to the player"; on its own it funnels every
// chaser onto the one shortest path, so a pack piles into a single overlapping
// stack. This adds the second half of a boids-style steer: a per-tick spatial
// snapshot of live enemies grouped by home room, letting a chaser feel its
// neighbours and fan out to SURROUND the target instead of stacking behind it.
//
// It stays cheap because enemies are confined to one room (Enemy.confineTo):
// separation only ever consults same-room neighbours, and a room holds a handful
// of them. Rebuilt every tick from the live enemy set — never stale, no bookkeeping.

/** One enemy's contribution to the snapshot: its map id, home room, and centre. */
export interface FlockMember {
  id: string;
  roomId: string;
  x: number;
  y: number;
}

export class EnemyFlock {
  private byRoom = new Map<string, FlockMember[]>();

  /** Replace the snapshot with this tick's members. GameRoom feeds it the spawned,
   *  living enemies before the AI pass reads separation() below. */
  rebuild(members: Iterable<FlockMember>): void {
    this.byRoom.clear();
    for (const m of members) {
      const list = this.byRoom.get(m.roomId);
      if (list) list.push(m);
      else this.byRoom.set(m.roomId, [m]);
    }
  }

  /** Accumulated push-away from same-room enemies within `radius` of (x, y),
   *  excluding `selfId`. Each neighbour contributes a unit vector pointing away
   *  from it, scaled by how deep inside the radius it sits (linear falloff, 1 at
   *  contact → 0 at the rim), so the shove is strongest when bodies nearly coincide
   *  and vanishes at the edge. The result is deliberately NOT normalized — its
   *  length reflects crowd pressure (more/closer neighbours push harder), and the
   *  caller blends it against a unit desired-heading. Returns a zero vector when the
   *  enemy is alone in range. */
  separation(
    selfId: string,
    roomId: string,
    x: number,
    y: number,
    radius: number,
  ): { dx: number; dy: number } {
    const list = this.byRoom.get(roomId);
    if (!list) return { dx: 0, dy: 0 };
    let sx = 0;
    let sy = 0;
    for (const m of list) {
      if (m.id === selfId) continue;
      const dx = x - m.x;
      const dy = y - m.y;
      const d = Math.hypot(dx, dy);
      if (d >= radius) continue;
      // Coincident (d ≈ 0) has no defined push direction; skip it. Continuous
      // physics positions almost never stay exactly equal, so the pair separates on
      // a later tick once sub-pixel drift gives a direction.
      if (d < 1e-4) continue;
      const falloff = (radius - d) / radius;
      sx += (dx / d) * falloff;
      sy += (dy / d) * falloff;
    }
    return { dx: sx, dy: sy };
  }
}
