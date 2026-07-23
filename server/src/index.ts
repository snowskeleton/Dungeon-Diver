import { Server } from "colyseus";
import { createServer } from "http";
import path from "path";
import express from "express";
import { ROOM_CODE_LOOKUP_PATH, isRoomCode } from "shared";
import { GameRoom } from "./rooms/GameRoom";
import { findRoomByCode } from "./rooms/roomCodes";
import { assertUpgradesCoverAllIds } from "./upgrades";

// Fail at boot, not silently at pick time, if the shared UpgradeId union and the
// server's Upgrade classes have drifted apart.
assertUpgradesCoverAllIds();

const port = Number(process.env.PORT ?? 2567);
const app = express();

app.use(express.json());

// CORS for the custom REST routes below (the room-code lookup, healthz). In
// production the server serves the client from its own origin so this is a
// no-op, but in local dev the client runs on Vite's port (5173) and dials the
// server on 2567 — a cross-origin request the browser blocks unless we say so.
// Colyseus already sets these headers on its own /matchmake routes, which is why
// the public room LIST works cross-origin but join-by-code (this app's route)
// did not. No cookies/credentials are involved, so `*` is the right origin.
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/healthz", (_req, res) => res.send("ok"));

// Private rooms are unlisted by design, so a player holding a join code can't
// find one with Colyseus's own room listing — this is the only way in. Public
// rooms need no endpoint: the client reads them straight off `getAvailableRooms`.
app.get(`${ROOM_CODE_LOOKUP_PATH}/:code`, async (req, res) => {
  const code = String(req.params.code ?? "");
  if (!isRoomCode(code)) {
    res.status(400).json({ error: "That isn't a valid room code." });
    return;
  }
  const result = await findRoomByCode(code);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ roomId: result.roomId });
});

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });

gameServer.define("game", GameRoom);

// Serve the built client from the same origin, so one process is the whole app:
// static files here, Colyseus matchmaking + WebSocket on the same port. A reverse
// proxy in front just needs `reverse_proxy <host>:2567` — no path splitting.
// Set CLIENT_DIR to override; in the Docker image the client build lands at ../client.
// express.static only answers real files, so /matchmake/* still reaches Colyseus.
if (process.env.SERVE_CLIENT !== "false") {
  const clientDir = process.env.CLIENT_DIR ?? path.join(__dirname, "..", "client");
  app.use(express.static(clientDir));
}

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on ws://0.0.0.0:${port}`);
});
