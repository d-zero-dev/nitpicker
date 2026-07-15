import type { RetryCallOptions } from '@d-zero/shared/retry';

/**
 * Default retry options shared by every `Database.*` op that wraps its
 * knex work in {@link ../../../utils/error/emit-error-with-retry.ts}
 * (`emitErrorAndRetry`) or {@link ../../../utils/error/emit-error.ts}
 * (`emitError`, no retry). Three retries at 300 ms intervals covers the
 * transient libsql failure modes (WAL contention, brief lock waits)
 * without letting a genuinely broken query hang the crawler for long.
 *
 * Two ops deliberately do NOT use these settings and instead wrap
 * `retryCall` themselves so they can override `label` (`getResourceByUrl`)
 * or opt out entirely (`checkpoint`, `destroy`, `getKnex`, `addOrderField`,
 * `setUrlOrder`, the `constructor`, and `Database.connect`). See the
 * corresponding op files for the reasoning at each site.
 */
export const retrySetting: RetryCallOptions = {
	interval: 300,
	retries: 3,
};
