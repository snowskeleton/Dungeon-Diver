import { RoomChallenge, ChallengeContext } from "./RoomChallenge";

/** Seconds on the clock at floor start. */
const TIME_LIMIT_MS = 45_000;

/** Clear the room before the clock runs out and a reward pedestal drops.
 *
 *  Missing the clock is NOT a failure state — the game has none, and inventing
 *  one here would be the first thing in the dungeon that can put a party in an
 *  unwinnable spot. The timer is a bonus condition: run it out and the room goes
 *  on being an ordinary combat room that opens when you finish killing, you just
 *  don't get the pedestal. That keeps the softlock risk at exactly zero, which is
 *  what lets this ship without a rescue path.
 *
 *  Like a wave room, the enemies come from GameRoom's ordinary rank-and-file
 *  pass, and FloorManager's normal "everything here is dying" rule does the
 *  clearing — this class only watches the clock and decides on the reward. */
export class TimedClearChallenge extends RoomChallenge {
  private remainingMs = TIME_LIMIT_MS;
  private done = false;
  private earned = false;
  // The clock only runs once someone is actually in the room. Otherwise it would
  // drain while the party is three rooms away and the reward would be gone before
  // they ever saw the door.
  private started = false;

  get bannerText(): string {
    // No "you made it" text: the banner hides the moment the room completes, and
    // the pedestal appearing is the reward's own announcement. "Out of time" does
    // show, though — the party has usually not noticed the clock die mid-fight,
    // and it explains the missing pedestal before they go looking for it.
    if (this.remainingMs <= 0) return "Out of time";
    const secs = Math.ceil(this.remainingMs / 1000);
    return `Time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  }

  get isComplete(): boolean {
    return this.done;
  }

  tick(dtMs: number, ctx: ChallengeContext): void {
    if (this.done) return;
    if (!this.started) {
      if (!ctx.playersInRoom(ctx.roomId)) return;
      this.started = true;
    }
    if (this.remainingMs > 0) this.remainingMs = Math.max(0, this.remainingMs - dtMs);
  }

  onEnemyDown(ctx: ChallengeContext): void {
    if (this.done) return;
    if (ctx.livingEnemyCount(ctx.roomId) > 0) return;

    // Room's clear. The pedestal is the whole prize for beating the clock.
    this.done = true;
    if (this.remainingMs > 0) {
      this.earned = true;
      ctx.dropReward(ctx.roomId);
    }
  }
}
