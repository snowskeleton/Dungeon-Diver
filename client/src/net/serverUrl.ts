/**
 * Where the client dials the server — both protocols, from one decision.
 *
 * Colyseus needs a ws:// endpoint and the room-code lookup needs the matching
 * http:// origin, and they must agree: resolving them separately is how you end
 * up with a game socket on one host and an API call on another.
 *
 *   1. VITE_SERVER_URL, if set, wins outright (a full ws:// or wss:// endpoint).
 *   2. Served over HTTPS (production): the server process serves this very page
 *      AND Colyseus on one origin, so connect same-origin — `wss://<host>`. A
 *      reverse proxy in front just forwards everything; no port, path, or CORS.
 *   3. Plain HTTP (local dev): talk straight to the Colyseus port. Override the
 *      port with VITE_SERVER_PORT to run an isolated instance without a clash.
 */
function resolveServerUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_URL;
  if (explicit) return explicit;
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}`;
  }
  const port = import.meta.env.VITE_SERVER_PORT ?? "2567";
  return `ws://${window.location.hostname}:${port}`;
}

/** The Colyseus endpoint (`ws://` or `wss://`). */
export const SERVER_URL = resolveServerUrl();

/** The same server's HTTP origin, for the plain-REST endpoints beside Colyseus. */
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/, "http");
