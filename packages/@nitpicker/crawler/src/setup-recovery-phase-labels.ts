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
 * - `'Restoring archive from backup'` — `append` / `inventory` /
 *   `retryFailed` all take this path when anything from the post-backup
 *   setup step through the crawl itself throws.
 * - `'Persisting ingested inventory state'` — `inventory`-only: once its
 *   pre-insert + audit-row write has committed, a later failure (state
 *   rebuild or the crawl itself) must persist the ingested rows to disk
 *   instead of restoring the pre-inventory `.bak`, or they would be lost.
 */
export const SETUP_RECOVERY_PHASE_LABELS = [
	'Restoring archive from backup',
	'Persisting ingested inventory state',
] as const;
