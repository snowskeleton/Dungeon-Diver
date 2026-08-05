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
   # then edit .env — only the durable, non-secret config lives here:
   #   TURN_HOST=game.dev.snowskeleton.net   (also gates /api/ice to https://<this host>)
   ```
   `.env` is gitignored. There's no secret to store: `TURN_SECRET` is generated at boot
   (step 3).

2. **Open the firewall** to the host (coturn uses host networking, so these hit the host
   directly — Caddy does NOT proxy them, they're UDP/raw TCP, not HTTP):
   - `3478/udp` and `3478/tcp` — STUN/TURN control
   - `49160-49200/udp` — the relay media range (matches `min-port`/`max-port` in
     [turnserver.conf](../server/coturn/turnserver.conf))

3. **Bring the stack up**, generating a fresh shared secret at boot (coturn is part of the
   default stack now):
   ```bash
   TURN_SECRET=$(openssl rand -hex 32) docker compose up -d --build
   ```
   `TURN_SECRET` is only a shared key between the server and coturn; it needn't be durable
   (sessions die on restart anyway), so nothing stores it — compose injects that one value
   into both services, and a crash-restart of either keeps its baked-in copy so they stay
   in sync. Bring **both** up together (a plain `up` always does); never recreate just one.
   coturn aborts at startup if `TURN_SECRET` is somehow unset, so a misconfigured deploy
   fails loud rather than running an unauthenticatable relay.

4. **If the host is behind NAT** (its public IP isn't on the interface coturn binds —
   uncommon for a single VPS): uncomment `external-ip=<public-ip>` in
   [turnserver.conf](../server/coturn/turnserver.conf), or relayed candidates will carry
   an unreachable address.

## Verifying

- **Credentials mint:** the origin gate means a bare `curl` now gets `403` — pass your
  page's `Origin` to mint:
  ```bash
  curl -H "Origin: https://game.dev.snowskeleton.net" https://game.dev.snowskeleton.net/api/ice
  ```
  should return a `turn:` entry with a `username`/`credential` (not just the Google STUN
  line). A bare `curl …/api/ice` returning `403` confirms the gate works; if it returns
  credentials anyway, neither `ALLOWED_ORIGINS` nor `TURN_HOST` is set. If you only see
  STUN (no `turn:` entry), `TURN_SECRET`/`TURN_HOST` aren't set in the server's environment.
- **Relay reachable end-to-end:** paste the `/api/ice` output into the
  [Trickle ICE test page](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)
  and Gather. A `relay` candidate means TURN works; only `srflx`/`host` means the relay
  isn't reachable (usually a firewall port).
- **coturn logs:** `docker compose logs -f coturn` — a real relay session
  logs an allocation when two peers actually fall back to it.

## Notes / limits

- **No TLS listener** (`no-tls`/`no-dtls`): the page is HTTPS but browsers accept plain
  `turn:`/`stun:` URLs, so no cert is needed. If a corporate firewall blocks 3478
  outright, add `tls-listening-port=443` + a cert to coturn and a `turns:` URL in
  `ice.ts` — TURN over TLS on 443 punches through almost anything, at the cost of running
  coturn on 443 (which then can't also be Caddy's).
- Credential TTL is 10 min (`TURN_TTL_SECONDS` in `ice.ts`) — safely above any WebRTC
  handshake but short enough that a scraped credential expires almost immediately; the
  browser fetches a fresh set each time it starts connecting.
- **Abuse containment.** The relay only ever forwards our game traffic, so coturn caps
  each allocation at `max-bps` (~1 Mbps, ~2× a busy floor) plus `user-quota`/`total-quota`
  and an aggregate `bps-capacity` ceiling ([turnserver.conf](../server/coturn/turnserver.conf)).
  This makes the relay useless for bulk data no matter how many credentials get minted.
  Separately, `/api/ice` refuses credential requests that don't carry your page's `Origin`
  — by default `https://<TURN_HOST>`, so setting `TURN_HOST` configures both the relay host
  and the gate. Override with `ALLOWED_ORIGINS` (comma-separated) only for a different or
  multiple page origins. It's a lightweight gate against other sites' pages and plain
  `curl` (a non-browser client can still set the header by hand, which is why the coturn
  caps are the real backstop).
- Relaying costs the server bandwidth (all game traffic for a relayed pair flows through
  it). For a hobby deployment that's negligible; it only kicks in for pairs that can't
  connect directly.
