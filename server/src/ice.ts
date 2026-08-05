import { createHmac } from "crypto";

/**
 * The ICE server list handed to a browser before it opens a WebRTC peer connection.
 *
 * A public STUN server is always included so peers can discover their reflexive
 * (NAT-mapped) address. When a TURN relay is configured (this same deployment can run
 * one — see docs/turn.md), we ALSO mint short-lived TURN credentials here and add the
 * relay, so a pair behind symmetric NATs (which STUN alone can't traverse) falls back
 * to relaying through the server instead of failing to connect.
 *
 * The credentials are the coturn "TURN REST API" scheme (`use-auth-secret`): the
 * username is an expiry timestamp and the password is HMAC-SHA1(secret, username),
 * base64-encoded. coturn recomputes the same HMAC to verify — so nothing long-lived is
 * stored anywhere, no per-user accounts exist, and a credential leaked from a client is
 * useless once it expires. The server and coturn just have to share TURN_SECRET.
 */

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// Short-lived on purpose: the browser fetches a fresh set each time it starts
// connecting, and a co-op session's WebRTC handshake completes in seconds. Keeping this
// tight means a credential scraped from a client (or the network tab) is useless almost
// immediately, so anyone wanting to abuse the relay has to keep coming back through
// /api/ice — the one place a gate/rate-limit can live — rather than minting once and
// relaying for hours. coturn allows a modest clock skew, so 10 min is safely above any
// handshake without leaving a long reuse window.
const TURN_TTL_SECONDS = 10 * 60;

export function iceServers(): IceServer[] {
  const servers: IceServer[] = [
    // Public STUN as the baseline — enough for the common same-NAT / cone-NAT case.
    { urls: "stun:stun.l.google.com:19302" },
  ];

  const secret = process.env.TURN_SECRET;
  const host = process.env.TURN_HOST;
  // Only advertise TURN when this deployment actually runs one. Missing config
  // degrades cleanly to STUN-only (the pre-TURN behaviour), never a broken entry.
  if (secret && host) {
    const username = String(Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS);
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    // Our own STUN on the relay host (no credentials needed for STUN)…
    servers.push({ urls: `stun:${host}:3478` });
    // …and the authenticated TURN relay over both UDP and TCP (TCP helps when UDP is
    // blocked outright).
    servers.push({
      urls: [
        `turn:${host}:3478?transport=udp`,
        `turn:${host}:3478?transport=tcp`,
      ],
      username,
      credential,
    });
  }

  return servers;
}
