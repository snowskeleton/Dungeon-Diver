import { Schema, type } from "@colyseus/schema";

// A room's active objective, keyed in GameState.challenges by room id.
//
// Deliberately generic: one pre-formatted banner line, not wave-specific fields.
// A wave room reports "Wave 2 / 3" and a timed room "Time 0:32" — those don't
// share a progress/goal shape, and formatting server-side keeps both the wire
// shape and the client banner fixed as more RoomChallenge subclasses land.
//
// GameRoom only assigns `text` when it actually changes, so a per-tick countdown
// still only produces one sync per second.

export class RoomChallengeState extends Schema {
  @type("string") roomId: string = "";
  @type("string") text: string = "";
  @type("boolean") complete: boolean = false;
}
