import { createServer } from "http";
import path from "path";
import express from "express";
import { assertClassesHaveFirstRollPool } from "shared";
import { assertUpgradesCoverAllIds } from "./upgrades";

// Fail at boot, not silently at pick time, if the shared UpgradeId union and the
// server's Upgrade classes have drifted apart.
assertUpgradesCoverAllIds();
// Likewise fail at boot if a class has no unique weapon category to roll its first
// weapon from (its supply pedestal would be empty).
assertClassesHaveFirstRollPool();

// The authoritative simulation now runs IN THE CLIENT: in-process for solo (the
// LocalAuthority) and host-authoritative peer-to-peer for multiplayer. This process
// is no longer a game server — it serves the static client build and will host the
// P2P signaling endpoint (Phase 5). The whole tick loop moved to
// server/src/rooms/GameRoom (now a transport-agnostic LocalRoom) + the shared sim
// tree, which the client imports directly.

const port = Number(process.env.PORT ?? 2567);
const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.send("ok"));

// Serve the built client from the same origin, so one process is the whole app.
// Set CLIENT_DIR to override; in the Docker image the client build lands at ../client.
if (process.env.SERVE_CLIENT !== "false") {
  const clientDir = process.env.CLIENT_DIR ?? path.join(__dirname, "..", "client");
  app.use(express.static(clientDir));
}

const httpServer = createServer(app);
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] static/signaling server on :${port}`);
});
