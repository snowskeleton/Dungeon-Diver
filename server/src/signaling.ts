import { randomUUID } from "crypto";
import { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  SIGNALING_PATH,
  ClientMessage,
  ServerMessage,
  PeerId,
  MAX_ROOM_NAME_LEN,
  MAX_PLAYER_NAME_LEN,
  MAX_CLIENTS,
} from "shared";
import { RoomRegistry } from "./registry";

/**
 * The P2P signaling relay: a WebSocket server that brokers introductions between
 * browsers. It attaches to the same http server that serves the client, so one
 * process is the whole app. It holds no game state — the RoomRegistry remembers who
 * is hosting what, and every WebRTC payload is relayed opaquely between two peers.
 *
 * Each socket gets a peer id on connect. A host's room id IS its peer id, so a guest
 * that resolved a code (or picked a listing) signals straight to the hosting socket.
 * A dropped socket takes its hosted room with it.
 */

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function clamp(text: unknown, max: number, fallback: string): string {
  if (typeof text !== "string") return fallback;
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

export interface Signaling {
  wss: WebSocketServer;
  registry: RoomRegistry;
}

export function attachSignaling(
  httpServer: HttpServer,
  registry: RoomRegistry = new RoomRegistry(),
): Signaling {
  const wss = new WebSocketServer({ server: httpServer, path: SIGNALING_PATH });
  const peers = new Map<PeerId, WebSocket>();

  wss.on("connection", (ws: WebSocket) => {
    const peerId = randomUUID();
    peers.set(peerId, ws);
    send(ws, { type: "welcome", peerId });

    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: "error", reason: "malformed message (not JSON)" });
        return;
      }
      handle(peerId, ws, msg);
    });

    ws.on("close", () => {
      peers.delete(peerId);
      registry.unregister(peerId);
    });
  });

  function handle(peerId: PeerId, ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "host-register": {
        const code = registry.register(peerId, {
          roomName: clamp(msg.roomName, MAX_ROOM_NAME_LEN, "Room"),
          hostName: clamp(msg.hostName, MAX_PLAYER_NAME_LEN, "Host"),
          isPrivate: !!msg.isPrivate,
          maxClients: Math.min(Math.max(1, msg.maxClients | 0), MAX_CLIENTS),
        });
        send(ws, { type: "registered", reqId: msg.reqId, roomId: peerId, code });
        break;
      }
      case "host-update": {
        registry.update(peerId, {
          phase: msg.phase,
          locked: msg.locked,
          clients: msg.clients,
          roomName: msg.roomName,
        });
        break;
      }
      case "unregister": {
        registry.unregister(peerId);
        break;
      }
      case "list": {
        send(ws, { type: "room-list", reqId: msg.reqId, rooms: registry.list() });
        break;
      }
      case "resolve-code": {
        send(ws, { type: "resolved", reqId: msg.reqId, result: registry.resolveCode(msg.code) });
        break;
      }
      case "signal": {
        const target = peers.get(msg.to);
        if (target) {
          send(target, { type: "signal", from: peerId, data: msg.data });
        } else {
          send(ws, { type: "error", reason: "peer is not connected" });
        }
        break;
      }
      default: {
        // Exhaustiveness: a new ClientMessage variant must be handled above.
        const _never: never = msg;
        void _never;
      }
    }
  }

  return { wss, registry };
}
