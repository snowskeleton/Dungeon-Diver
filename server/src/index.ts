import { Server } from "colyseus";
import { createServer } from "http";
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

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on ws://0.0.0.0:${port}`);
});
