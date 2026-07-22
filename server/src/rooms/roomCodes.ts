import { matchMaker } from "colyseus";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, RoomMetadata } from "shared";

/**
 * Short join codes for private rooms.
 *
 * A private room is absent from `getAvailableRooms` (that is what private MEANS
 * to Colyseus), so a client holding a code cannot resolve it — only the server
 * can, by scanning the matchmaker's own listing. That scan is the reason the
 * code lives in room METADATA rather than in room state: metadata is on the
 * listing, so finding a room by code costs one driver query and no room joins.
 */

const ROOM_NAME = "game";

function randomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Every code currently in use, public and private alike. */
async function takenCodes(): Promise<Set<string>> {
  const listings = await matchMaker.query({ name: ROOM_NAME });
  const taken = new Set<string>();
  for (const listing of listings) {
    const code = (listing.metadata as RoomMetadata | undefined)?.code;
    if (code) taken.add(code);
  }
  return taken;
}

/**
 * A code no live room is using. Retries rather than trusting randomness: the
 * space is ~1M but a collision would silently send a player to a stranger's
 * run, which is the one failure mode a join code must not have. After enough
 * tries it gives up and returns a random one — at that point the server is
 * holding a six-figure number of rooms and the collision is the lesser problem.
 */
export async function allocateRoomCode(): Promise<string> {
  const taken = await takenCodes();
  for (let attempt = 0; attempt < 24; attempt++) {
    const code = randomCode();
    if (!taken.has(code)) return code;
  }
  return randomCode();
}

/** What the code-lookup endpoint answers with. */
export type CodeLookup =
  | { ok: true; roomId: string }
  | { ok: false; status: number; error: string };

/**
 * Resolve a join code to a room id.
 *
 * The three "no" answers are kept distinct because they are three different
 * things for a player to do next: mistyped, too late, or wait for a seat.
 * Started and full are told apart by METADATA rather than by `locked`, because
 * Colyseus locks a room for both reasons — starting the run (D12's lobby-only
 * joins) and filling the last seat.
 */
export async function findRoomByCode(rawCode: string): Promise<CodeLookup> {
  const code = rawCode.trim().toUpperCase();
  const listings = await matchMaker.query({ name: ROOM_NAME });
  const match = listings.find((l) => (l.metadata as RoomMetadata | undefined)?.code === code);

  if (!match) return { ok: false, status: 404, error: `No room with code ${code}.` };
  if ((match.metadata as RoomMetadata | undefined)?.phase === "run") {
    return { ok: false, status: 409, error: "That run has already started — you can only join from the lobby." };
  }
  if (match.locked) return { ok: false, status: 409, error: "That room is full." };
  return { ok: true, roomId: match.roomId };
}
