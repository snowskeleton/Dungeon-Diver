/**
 * A bidirectional string channel between two peers — the one thing the P2P host and
 * guest need from the network, with the WebRTC specifics factored out. `HostSession`
 * and `RemoteAuthority` are written against this interface, so they can be driven by a
 * real RTCDataChannel in the browser (WebRTCTransport) OR an in-memory pipe in a
 * headless test (loopbackPair), and the session logic is identical either way.
 *
 * Messages are strings (JSON-encoded ChannelMsgs). Ordered, reliable delivery is
 * assumed — the WebRTC data channel is configured that way, and the loopback is
 * synchronous — so neither side re-orders or drops.
 */
export interface Transport {
  /** Send one message to the peer. */
  send(data: string): void;
  /** Subscribe to messages from the peer. One transport, one consumer. */
  onMessage(cb: (data: string) => void): void;
  /** Fired once when the channel closes (peer left, connection lost). */
  onClose(cb: () => void): void;
  /** Close from this side. */
  close(): void;
}

/** A pair of transports wired mouth-to-ear: whatever `a` sends, `b` receives, and
 *  vice-versa. Delivery is deferred to a microtask so a send during a message handler
 *  doesn't re-enter it synchronously (matching the async feel of a real channel).
 *  This is what makes the whole host/guest path testable with no browser. */
export function loopbackPair(): [Transport, Transport] {
  const make = (): Transport & { _emit(data: string): void; _peer?: Transport & { _emit(d: string): void } } => {
    let onMsg: ((data: string) => void) | null = null;
    let onClose: (() => void) | null = null;
    let closed = false;
    const t = {
      _peer: undefined as (Transport & { _emit(d: string): void }) | undefined,
      send(data: string): void {
        if (closed) return;
        t._peer?._emit(data);
      },
      onMessage(cb: (data: string) => void): void {
        onMsg = cb;
      },
      onClose(cb: () => void): void {
        onClose = cb;
      },
      close(): void {
        if (closed) return;
        closed = true;
        onClose?.();
        t._peer?.close();
      },
      _emit(data: string): void {
        if (closed) return;
        Promise.resolve().then(() => {
          if (!closed) onMsg?.(data);
        });
      },
    };
    return t;
  };
  const a = make();
  const b = make();
  a._peer = b;
  b._peer = a;
  return [a, b];
}
