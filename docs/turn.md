# TURN / STUN relay for P2P

Read this when a cross-network game fails to connect, or when setting up the relay on a
deployment.

## Why

Multiplayer is host-authoritative P2P over WebRTC ([client/src/net/webrtc.ts](../client/src/net/webrtc.ts)).
Two browsers exchange offer/answer + ICE candidates through the signaling relay, then
open a direct `RTCDataChannel`. **STUN** lets each peer discover its NAT-mapped
(reflexive) address, which is enough for most home routers. But a pair where *both*
sides sit behind **symmetric NAT** can't be introduced by STUN alone — there's no direct
path. **TURN** is the fallback: a public relay both peers can reach, forwarding their
traffic. With TURN configured, connection success goes from "most networks" to
"effectively all networks".

## Architecture

- **The relay is coturn** (`coturn/coturn` image), which speaks both STUN and TURN. It
  runs as a second service in [docker-compose.yml](../docker-compose.yml), behind the
  `turn` profile so it's opt-in.
- **Credentials are ephemeral** — the coturn "TURN REST API" / `use-auth-secret` scheme.
  Nobody stores a password. The game server ([server/src/ice.ts](../server/src/ice.ts))
  derives a short-lived `username` (an expiry timestamp) + `credential`
  (`base64(HMAC-SHA1(TURN_SECRET, username))`) and hands them to the browser from
  `GET /api/ice`. coturn recomputes the same HMAC to verify. The **secret never reaches
  the client** — only the derived, expiring credential does.
- **The client fetches `/api/ice` once** ([loadRtcConfig](../client/src/net/webrtc.ts))
  before building any peer connection, and both host and guest fetch from the same
  server, so they agree on the relay. If the endpoint is unreachable or TURN isn't
  configured, it falls back to public STUN — the pre-TURN behaviour, nothing breaks.

The server and coturn only have to share one thing: `TURN_SECRET`.

## Enabling it on the deployment

1. **Create `.env`** beside `docker-compose.yml` (copy [.env.example](../.env.example)):
   ```bash
   cp .env.example .env
   # then edit .env:
   #   TURN_SECRET=<paste `openssl rand -hex 32`>
   #   TURN_HOST=game.dev.snowskeleton.net
   ```
   `.env` is gitignored — keep the real secret out of the repo.

2. **Open the firewall** to the host (coturn uses host networking, so these hit the host
   directly — Caddy does NOT proxy them, they're UDP/raw TCP, not HTTP):
   - `3478/udp` and `3478/tcp` — STUN/TURN control
   - `49160-49200/udp` — the relay media range (matches `min-port`/`max-port` in
     [turnserver.conf](../server/coturn/turnserver.conf))

3. **Bring the stack up with the profile:**
   ```bash
   docker compose --profile turn up -d --build
   ```
   Without `--profile turn`, only the game server starts (STUN-only, as before).

4. **If the host is behind NAT** (its public IP isn't on the interface coturn binds —
   uncommon for a single VPS): uncomment `external-ip=<public-ip>` in
   [turnserver.conf](../server/coturn/turnserver.conf), or relayed candidates will carry
   an unreachable address.

## Verifying

- **Credentials mint:** `curl https://game.dev.snowskeleton.net/api/ice` should return a
  `turn:` entry with a `username`/`credential` (not just the Google STUN line). If you
  only see STUN, `TURN_SECRET`/`TURN_HOST` aren't set in the server's environment.
- **Relay reachable end-to-end:** paste the `/api/ice` output into the
  [Trickle ICE test page](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
  and Gather. A `relay` candidate means TURN works; only `srflx`/`host` means the relay
  isn't reachable (usually a firewall port).
- **coturn logs:** `docker compose --profile turn logs -f coturn` — a real relay session
  logs an allocation when two peers actually fall back to it.

## Notes / limits

- **No TLS listener** (`no-tls`/`no-dtls`): the page is HTTPS but browsers accept plain
  `turn:`/`stun:` URLs, so no cert is needed. If a corporate firewall blocks 3478
  outright, add `tls-listening-port=443` + a cert to coturn and a `turns:` URL in
  `ice.ts` — TURN over TLS on 443 punches through almost anything, at the cost of running
  coturn on 443 (which then can't also be Caddy's).
- Credential TTL is 12h (`TURN_TTL_SECONDS` in `ice.ts`) — far longer than a session; the
  browser fetches a fresh set each time it starts connecting.
- Relaying costs the server bandwidth (all game traffic for a relayed pair flows through
  it). For a hobby deployment that's negligible; it only kicks in for pairs that can't
  connect directly.
