/**
 * The engine package's public surface — the authoritative simulation the client
 * runs in-process (solo) or on the host peer (P2P). This barrel names the wire
 * boundary the client wraps; internally the client deep-imports (`@engine/...`),
 * so this exists mainly to make `engine` an honest, importable package.
 *
 * The engine is transport-free: it knows nothing about sockets, WebRTC, or the
 * signaling server. Everything transport-specific lives in the client's net layer
 * (the Authority that wraps a room) and in server/ (the process that serves).
 */
import { assertClassesHaveFirstRollPool } from "shared";
import { assertUpgradesCoverAllIds } from "./upgrades";

export { GameRoom } from "./rooms/GameRoom";
export { LocalRoom } from "./rooms/LocalRoom";
export type { RoomClient } from "./rooms/LocalRoom";
export { GameState } from "./schema/GameState";

/**
 * Boot-time integrity checks for the simulation — fail loudly at startup, not
 * silently at pick time, if the content classes and their shared id-unions have
 * drifted apart. These used to run in the old game-server process; the sim now
 * boots in the client, so the client's authority calls this once. Idempotent.
 */
export function assertEngineInvariants(): void {
  // The shared UpgradeId union and the engine's Upgrade classes must agree.
  assertUpgradesCoverAllIds();
  // Every character class must have a unique weapon category to roll its first
  // weapon from, or its supply pedestal would be empty.
  assertClassesHaveFirstRollPool();
}
