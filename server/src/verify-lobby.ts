/**
 * Live check of the lobby rules against a running server (default ws://localhost:2567):
 *   1. a hosted room is listed, with its metadata
 *   2. a second client joins it and appears in the roster
 *   3. the host cannot start while someone is unready
 *   4. once ready, startRun flips phase, spawns enemies, and LOCKS the room
 *   5. a locked room is neither listed, joinable by id, nor resolvable by code
 *   6. a private room is unlisted but reachable by code
 */
import { Client } from "colyseus.js";
import { generateDungeon } from "shared";

const WS = process.env.WS ?? "ws://localhost:2567";
const HTTP = WS.replace(/^ws/, "http");

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
  if (!ok) failures++;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const client = new Client(WS);

  // 1. host a public room
  const host = await client.create("game", {
    roomName: "verify run",
    isPrivate: false,
    playerName: "Hostie",
    characterClass: "knight",
  });
  await sleep(300);
  const hostState = host.state as any;
  check(hostState.phase === "lobby", "a new room opens in its lobby phase", hostState.phase);
  check(hostState.roomCode?.length === 4, "the room has a join code", hostState.roomCode);
  check(hostState.hostSessionId === host.sessionId, "the first player in is the host");
  check(hostState.enemies.size === 0, "nothing has spawned yet", `enemies=${hostState.enemies.size}`);

  const listed = await client.getAvailableRooms("game");
  const mine = listed.find((r: any) => r.roomId === host.roomId);
  check(!!mine, "a public lobby is listed");
  check((mine?.metadata as any)?.hostName === "Hostie", "the listing names the host",
    String((mine?.metadata as any)?.hostName));

  // 2. a second player joins
  const guest = await client.joinById(host.roomId, {
    playerName: "Guest",
    characterClass: "mage",
    weaponId: "ruby-staff",
  });
  await sleep(300);
  check(hostState.players.size === 2, "the guest appears in the host's roster",
    `players=${hostState.players.size}`);
  const guestSeat = hostState.players.get(guest.sessionId);
  check(guestSeat?.ready === false, "a remote guest arrives unready");

  // 3. the host cannot start while the guest is unready
  const refusals: string[] = [];
  host.onMessage("lobby_error", (msg: any) => refusals.push(msg.reason));
  host.send("startRun");
  await sleep(300);
  check(hostState.phase === "lobby", "start is refused while someone is unready");
  check(refusals.some((r: any) => r.includes("Guest")), "the refusal names who we're waiting on",
    refusals.join(" / "));

  // 4. ready up and start
  guest.send("setReady", { ready: true });
  await sleep(200);
  host.send("startRun");
  await sleep(600);
  check(hostState.phase === "run", "the run starts once everyone is ready", hostState.phase);
  check(hostState.enemies.size > 0, "enemies spawn at start, not at join",
    `enemies=${hostState.enemies.size}`);

  // 4b. the barrier snapshot — the thing a client entering from the lobby has to
  //     ask for, because the pre-clear broadcast fired while it was still there.
  let snapshot: any = null;
  host.onMessage("barrier_state", (msg: any) => { snapshot = msg; });
  host.send("requestBarrierState");
  await sleep(300);
  const connections = generateDungeon(hostState.seed, JSON.parse(hostState.dungeonOpts)).connections;
  check(snapshot !== null, "the server answers a barrier-state request");
  check(
    Array.isArray(snapshot?.parentStanding) && snapshot.parentStanding.length < connections.length,
    "the snapshot reports empty rooms as already unlocked",
    `${snapshot?.parentStanding.length}/${connections.length} parents standing`,
  );

  // 5. a started run is closed
  const afterStart = await client.getAvailableRooms("game");
  check(!afterStart.some((r: any) => r.roomId === host.roomId), "a started run leaves the room list");

  let joinRejected = false;
  try {
    await client.joinById(host.roomId, { playerName: "Latecomer" });
  } catch {
    joinRejected = true;
  }
  check(joinRejected, "joining a started run by id is rejected");

  const codeLookup = await fetch(`${HTTP}/api/rooms/by-code/${hostState.roomCode}`);
  const codeBody: any = await codeLookup.json();
  check(codeLookup.status === 409, "the code lookup reports the run as started",
    `${codeLookup.status} ${codeBody.error ?? ""}`);

  // a lobby-only message is refused after the start
  refusals.length = 0;
  host.send("setReady", { ready: false });
  await sleep(250);
  check(refusals.length > 0, "lobby messages are refused mid-run", refusals.join(" / "));

  await host.leave();
  await guest.leave();

  // 6. private rooms: unlisted, but reachable by code
  const secret = await client.create("game", {
    roomName: "secret",
    isPrivate: true,
    playerName: "Hermit",
  });
  await sleep(300);
  const secretCode = (secret.state as any).roomCode;
  const publicList = await client.getAvailableRooms("game");
  check(!publicList.some((r: any) => r.roomId === secret.roomId), "a private room is unlisted");

  const found: any = await (await fetch(`${HTTP}/api/rooms/by-code/${secretCode}`)).json();
  check(found.roomId === secret.roomId, "a private room resolves from its code", secretCode);

  const missing = await fetch(`${HTTP}/api/rooms/by-code/ZZZZ`);
  check(missing.status === 404, "an unknown code is a clean 404", String(missing.status));

  await secret.leave();
  await sleep(200);

  console.log(failures === 0 ? "\n✅ LOBBY RULES OK" : `\n❌ ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
