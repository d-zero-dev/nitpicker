/**
 * Session-scoped counter for how many operator-network outages were
 * confirmed, and their total duration. The orchestrator accumulates into
 * this at every `networkOutageRecovered` event, reads it at crawl shutdown
 * to emit a `[network] N outage(s), Ms total` summary line, then zeroes it
 * for the next session (mirrors `dnsBurnedHostShortCircuitCounter`'s
 * lifecycle, including its known limitation: two `CrawlerOrchestrator`
 * crawls running concurrently in the same process would accumulate into and
 * zero the same shared counter, cross-contaminating each other's summary.
 * The CLI only ever runs one crawl per process, so this has never been
 * observed in practice; fixing it would mean threading per-session state
 * through both counters together, out of scope here).
 *
 * Exposed as a mutable object (not a plain `let`) so the counter remains a
 * single shared reference across crawler / orchestrator imports — `let`
 * bindings cannot be mutated from another module.
 */
export const networkOutageSummaryCounter = { confirmedCount: 0, totalDurationMs: 0 };
