import { RoomChallenge, ChallengeContext } from "./RoomChallenge";

/** How many rooms-worth of enemies the whole horde is. `enemiesPerRoom()` sets both
 *  the initial batch (already placed by the floor pass) and the concurrent cap, so a
 *  ×3 horde is three normal rooms of enemies fed through a one-room-sized doorway. */
const HORDE_MULTIPLIER = 3;

/** A room of continuous attrition. The floor's ordinary rank-and-file pass places
 *  the first batch, so the room locks and reads like a combat room on entry. From
 *  there it is NOT discrete waves: a fixed total of enemies is fed in, and every
 *  time one dies a fresh one takes its place — up to a concurrent cap — until the
 *  reserve is spent and the last of them falls. So it plays as a timed/attrition
 *  fight sized by the enemy TOTAL rather than by a wave count.
 *
 *  FloorManager needs no special case, for the same reason the old wave room didn't:
 *  its clear rule is "every enemy in the room's set is dying", and `onEnemyDown` runs
 *  BEFORE that check — a just-spawned replacement is already in the set by the time it
 *  evaluates, so the room stays locked until the reserve runs out. */
export class WaveChallenge extends RoomChallenge {
  private inited = false;
  private total = 0;
  private reserve = 0; // enemies not yet introduced
  private slain = 0;
  private done = false;

  get bannerText(): string {
    if (!this.inited) return "Horde";
    return `Horde ${this.slain} / ${this.total}`;
  }

  get isComplete(): boolean {
    return this.done;
  }

  /** Fix the horde size once, from the floor/party-scaled per-room count. Called
   *  from both tick and onEnemyDown so the total is known before the party arrives
   *  (the banner) and the moment the first enemy dies (the refill). */
  private ensureInit(ctx: ChallengeContext): void {
    if (this.inited) return;
    const perRoom = ctx.enemiesPerRoom();
    this.total = perRoom * HORDE_MULTIPLIER;
    // The floor pass already placed one room's worth as the opening batch.
    this.reserve = Math.max(0, this.total - perRoom);
    this.inited = true;
  }

  tick(_dtMs: number, ctx: ChallengeContext): void {
    if (this.done) return;
    this.ensureInit(ctx);
  }

  onEnemyDown(ctx: ChallengeContext): void {
    if (this.done) return;
    this.ensureInit(ctx);
    this.slain++;

    const pool = ctx.enemyPool();
    // livingEnemyCount excludes the enemy that just died (the caller flags it first).
    let living = ctx.livingEnemyCount(ctx.roomId);
    const cap = ctx.enemiesPerRoom();
    // Refill up to the concurrent cap, drawing from the reserve, so the room stays
    // full rather than thinning out as the fight goes on.
    while (this.reserve > 0 && living < cap && pool.length > 0) {
      ctx.spawnEnemyInRoom(ctx.roomId, pool[Math.floor(Math.random() * pool.length)]);
      this.reserve--;
      living++;
    }

    // The horde is beaten only when nothing is left to introduce AND the floor is
    // clear of the living — that last kill is what opens the door.
    if (this.reserve === 0 && living === 0) this.done = true;
  }
}
