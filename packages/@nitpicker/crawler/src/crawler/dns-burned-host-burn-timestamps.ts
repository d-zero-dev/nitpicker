/**
 * Companion to `dnsBurnedHostCache`: records the epoch-ms timestamp of each
 * host burned by THIS session's `#sendHeadRequest` `onGiveUp` path (the
 * `shouldBurnHost`-gated write in `crawler.ts`).
 *
 * Deliberately NOT populated by `#preloadDnsBurnedHostCache`'s seeding from
 * a previous session's `crawl_errors` — those entries represent hosts
 * already proven dead across sessions and must never be evicted just
 * because THIS session's network happened to recover from an outage. Since
 * `dnsBurnedHostCache`'s value (`ErrorKind`) carries no provenance of its
 * own (preload-seeded and session-learned burns are indistinguishable by
 * value alone), this separate timestamp map is what lets
 * `evict-outage-tainted-dns-burns.ts` tell them apart: only hosts present
 * HERE are eligible for eviction, and only if their burn timestamp falls
 * inside the just-recovered outage's window.
 */
export const dnsBurnedHostBurnTimestamps = new Map<string, number>();
