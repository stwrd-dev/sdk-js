/**
 * Back-channel logout bookkeeping: ending a local session and remembering the
 * notice's `jti`, so the same notice is never accepted twice.
 *
 * The order is the contract: the session is deleted FIRST and the `jti` is
 * marked SECOND. The IdP retries a 5xx and does not retry a 4xx; if the `jti`
 * were marked first and the deletion then failed, the retry would find a seen
 * `jti` and answer 400 "replay", and the local session would stay alive for
 * good. A sink that cannot do both (a store that is down) throws and marks
 * nothing.
 */

import type { SessionStore } from "./sessions.js";

export interface BackChannelSink {
  /** Ends `sessionId` (when the notice names a session) and marks `jti` as
   * seen until `untilS` (epoch seconds, the notice's own `exp`: afterwards it
   * cannot pass validation anyway). `"replay"` when `jti` was already seen; in
   * that case nothing is deleted. Throws when the store cannot be reached. */
  terminate(sessionId: string | null, jti: string, untilS: number): Promise<"terminated" | "replay">;
}

/** The default sink: process-local `jti` memory in front of a `SessionStore`.
 * With several processes each one remembers its own; a sink that spans them
 * (one transaction in the store) is the adapter's to provide. */
export class MemoryBackChannelSink implements BackChannelSink {
  private readonly seen = new Map<string, number>();

  constructor(private readonly sessions: SessionStore) {}

  async terminate(sessionId: string | null, jti: string, untilS: number): Promise<"terminated" | "replay"> {
    const now = Date.now() / 1000;
    for (const [seenJti, until] of this.seen) {
      if (until <= now) {
        this.seen.delete(seenJti);
      }
    }
    if (this.seen.has(jti)) {
      return "replay";
    }
    // The store is keyed by the BFF's own id and the notice only carries
    // `sid`, so the id was derived (`sessionIdForSid`) and the deletion is the
    // plain `delete(id)` of the store contract: every store, third-party ones
    // included, terminates sessions correctly with no extra method.
    if (sessionId) {
      await this.sessions.delete(sessionId);
    }
    this.seen.set(jti, untilS);
    return "terminated";
  }
}
