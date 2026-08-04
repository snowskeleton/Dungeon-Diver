/**
 * Where the client reaches the serving process — both protocols, from one decision.
 *
 * The process serves this page AND the P2P signaling endpoint (the ws relay that
 * brokers WebRTC connections and the room registry). The ws:// endpoint and any
 * http:// origin beside it must agree: resolving them separately is how you end up
 * with the signaling socket on one host and an API call on another.
 *
 *   1. VITE_SERVER_URL, if set, wins outright (a full ws:// or wss:// endpoint).
 *   2. Served over HTTPS (production): one origin serves the page AND signaling,
 *      so connect same-origin — `wss://<host>`. A reverse proxy in front just
 *      forwards everything; no port, path, or CORS.
 *   3. Plain HTTP (local dev): talk straight to the server port. Override it with
 *      VITE_SERVER_PORT to run an isolated instance without a clash.
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

/** The signaling endpoint (`ws://` or `wss://`). */
export const SERVER_URL = resolveServerUrl();

/** The same process's HTTP origin, for any plain-REST endpoint beside signaling. */
export const SERVER_HTTP_URL = SERVER_URL.replace(/^ws/, "http");
