/**
 * `SetupProgressCallbacks.onPhase` labels announced only from a failure
 * path — never part of the ordered success-path sequences
 * (`RESUME_SETUP_PHASES` / `APPEND_SETUP_PHASES` / `RETRY_FAILED_SETUP_PHASES` /
 * `INVENTORY_SETUP_PHASES`) those static methods otherwise announce in order.
 *
 * The CLI's setup task list treats any `onPhase` label in this set as
 * unplanned: instead of advancing to the next pre-built row, it inserts a
 * new row for it (`ctx.insertNext`) so the recovery copy's byte progress
 * stays visible, rather than trying to guess in advance where in the
 * success-path sequence a failure might interrupt it.
 *
 * - `'Restoring archive from backup'` — `append` / `inventory` / `recrawl` /
 *   `retryFailed` take this path when a failure that is NOT
 *   `PendingUrlsRemainError` occurs from the post-backup setup step through
 *   the crawl itself.
 * - `'Leaving crawl state for --resume'` — all four of the above instead
 *   take this path once the failure is specifically `PendingUrlsRemainError`
 *   (issue #350's auto-retry loop giving up with pages still pending): the
 *   `.bak` is deleted (nothing to restore — `write()` never ran, so the
 *   original `.nitpicker` was never touched) and the stub tmpDir is left
 *   intact instead, so the operator recovers via `crawl --resume` /
 *   `--retry-failed`. `inventory` / `recrawl` additionally reach this same
 *   label for any OTHER scrape-phase failure once their pre-insert + audit
 *   row has committed (`ingestionComplete`) — restoring the pre-inventory
 *   `.bak` at that point would silently wipe the already-committed seeds.
 *   The archive is deliberately NOT packaged in either case (see
 *   `CrawlerOrchestrator`'s `.nitpicker` ⟹ pending = 0 invariant).
 */
export const SETUP_RECOVERY_PHASE_LABELS = [
	'Restoring archive from backup',
	'Leaving crawl state for --resume',
] as const;
