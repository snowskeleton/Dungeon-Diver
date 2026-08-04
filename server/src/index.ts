import { createServer } from "http";
import path from "path";
import express from "express";
import { attachSignaling } from "./signaling";
import { iceServers } from "./ice";

// This process is no longer a game server. The authoritative simulation runs IN THE
// CLIENT — in-process for solo (the LocalAuthority) and host-authoritative peer-to-peer
// for multiplayer (the host peer runs the engine). This process only:
//   - serves the static client build (below), and
//   - hosts the P2P signaling relay + room registry (added in Milestone 2).
// It holds no game state and imports no game code (see engine/ for the simulation).

const port = Number(process.env.PORT ?? 2567);
const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.send("ok"));

// The ICE server list (STUN + short-lived TURN credentials) a client fetches before
// dialling a peer. Kept server-side so the TURN secret never reaches the browser —
// only the derived, expiring credential does. See server/src/ice.ts + docs/turn.md.
app.get("/api/ice", (_req, res) => res.json({ iceServers: iceServers() }));

// Serve the built client from the same origin, so one process is the whole app.
// Set CLIENT_DIR to override; in the Docker image the client build lands at ../client.
if (process.env.SERVE_CLIENT !== "false") {
  const clientDir = process.env.CLIENT_DIR ?? path.join(__dirname, "..", "client");
  app.use(express.static(clientDir));
}

const httpServer = createServer(app);

// The P2P signaling relay + room registry share this http server (path /ws), so one
// origin is the whole app: static client, room discovery, and WebRTC brokering.
attachSignaling(httpServer);

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`[server] static + P2P signaling server on :${port}`);
});
