import { Server } from "colyseus";
import { createServer } from "http";
import path from "path";
import express from "express";
import { GameRoom } from "./rooms/GameRoom";
import { assertUpgradesCoverAllIds } from "./upgrades";

// Fail at boot, not silently at pick time, if the shared UpgradeId union and the
// server's Upgrade classes have drifted apart.
assertUpgradesCoverAllIds();

const port = Number(process.env.PORT ?? 2567);
const app = express();

app.use(express.json());
app.get("/healthz", (_req, res) => res.send("ok"));

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
