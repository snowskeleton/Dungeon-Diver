/**
 * The room-shaped surface the client consumes, independent of transport. A
 * `LocalAuthority` seat (solo/couch, in-process) satisfies it today; a guest's
 * `RemoteAuthority` over a WebRTC transport (P2P) will satisfy the same interface,
 * so `Party` / `GameScene` / `LocalPlayer` read one interface and neither knows nor
 * cares whether a socket is involved.
 *
 * This is the seam the whole single-client migration turns on: for solo there is no
 * serialization at all — `state` is the live Observable GameState the sim mutates,
 * and its onAdd/onChange callbacks fire in-process.
 */
export interface RoomLike {
  /** The synced state (read by the client as GameStateView via the one boundary cast). */
  readonly state: unknown;
  /** This seat's id — the sim's key for its player. */
  readonly sessionId: string;
  readonly roomId: string;
  /** Client → sim: a command (input, buy, startRun, …). */
  send(type: string, payload?: unknown): void;
  /** Sim → client: broadcasts and directed sends (hits, floor_change, loot_error, …). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMessage(type: string, cb: (payload: any) => void): void;
  /** Fired when the synced state may have changed — the lobby refreshes off this.
   *  (Colyseus fires per patch; local fires per command/seat change, which is when
   *  lobby state moves.) */
  onStateChange(cb: () => void): void;
  /** Fired if the room goes away under the client (a server teardown). Never fires
   *  for a local authority — there is nothing to disconnect from. */
  onLeave(cb: () => void): void;
  leave(): void | Promise<number>;
}
