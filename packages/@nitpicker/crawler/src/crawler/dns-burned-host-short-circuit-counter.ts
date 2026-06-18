/**
 * Session-scoped counter for how many URL fetches were short-circuited by the
 * {@link dnsBurnedHostCache}. The orchestrator reads this at crawl shutdown
 * to emit a `[preload] Short-circuited N URL(s)` summary line, then
 * {@link clearDnsBurnedHostCache} zeroes it for the next session.
 *
 * Exposed as a mutable object (not a plain `let`) so that the counter remains
 * a single shared reference across crawler / orchestrator imports — `let`
 * bindings cannot be mutated from another module.
 */
export const dnsBurnedHostShortCircuitCounter = { count: 0 };
