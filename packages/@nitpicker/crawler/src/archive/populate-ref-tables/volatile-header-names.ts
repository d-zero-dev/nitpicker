/**
 * Header names — always lower-cased — that are EXCLUDED from `stable_hash`.
 * These change on every response (timestamps / request IDs / cache
 * telemetry) and would defeat the dedup goal if hashed alongside the
 * stable set.
 *
 * `set-cookie` sits here because per-session cookies rotate constantly on
 * authenticated sites — the plan's §Stable / Volatile Classification
 * table treats it as volatile even though it is technically a stable
 * security signal.
 *
 * Kept in lock-step with the plan (`docs/write-model-refactor-plan.md`
 * §Stable / Volatile Classification). Any header not in this set is
 * treated as **stable** by {@link ./header-stability.ts:isVolatileHeader}
 * — the safer default because miscounting a genuinely volatile header as
 * stable only loses dedup; miscounting a stable one as volatile could
 * split the same logical header set into multiple `header_sets` rows.
 */
export const VOLATILE_HEADER_NAMES: ReadonlySet<string> = new Set([
	'date',
	'expires',
	'last-modified',
	'etag',
	'age',
	'via',
	'x-cache',
	'cf-ray',
	'x-request-id',
	'set-cookie',
	'server-timing',
	'x-amz-request-id',
]);
