/**
 * Shared type definitions for 0.13 migration verification.
 *
 * These are the acceptance-invariant checks that `scripts/migrate-to-0.13.mjs`
 * runs at the end of the migration to confirm that the 0.13 entity /
 * edge populates produced a consistent archive. Each check is one file
 * under `verify-migration/` and throws {@link MigrationVerificationError} on mismatch;
 * the orchestrator {@link ./verify-migration.ts} chains them in the
 * order defined by issue #194.
 * @module
 */

/**
 * Row-count snapshot collected by every successful verify run and returned
 * by {@link import('./verify-migration.js').verifyMigration}.
 * The migration script logs these on the successful path so operators can
 * eyeball migration outcomes from stdout without re-opening the archive.
 */
export interface MigrationVerificationSummary {
	/** `count(*) FROM content_items` — matches `count(pages)`. */
	readonly contentItems: number;
	/** `count(*) FROM page_meta` — matches `count(pages WHERE scraped=1)`. */
	readonly pageMeta: number;
	/** `count(*) FROM anchor_edges` — always ≤ `count(anchors)`. */
	readonly anchorEdges: number;
	/** `SUM(count) FROM anchor_edges` — matches `count(anchors)`. */
	readonly anchorEdgesSum: number;
	/** `count(*) FROM image_items` — matches `count(images)`. */
	readonly imageItems: number;
	/** `count(*) FROM resource_items` — matches `count(resources)`. */
	readonly resourceItems: number;
}

/**
 * Structured details of a single migration invariant that failed. Attached to
 * {@link MigrationVerificationError} so operators can see which check tripped
 * without parsing the error message.
 */
export interface MigrationVerificationErrorDetails {
	/**
	 * Human-readable check identifier matching issue #194's numbered list
	 * (e.g. `'#3'` for the anchor-edge dedup range check). Included in the
	 * error message so migration logs point at the exact clause.
	 */
	readonly check: string;
	/**
	 * Optional structured payload — typically `expected` / `actual` counts or
	 * the offending page id from the URL round-trip sample. Rendered into the
	 * error message so operators can diagnose without re-running the check.
	 */
	readonly context?: Readonly<Record<string, string | number | null>>;
}

/**
 * Error thrown by any 0.13 check when an invariant does not hold. The
 * migration script catches this at the top level and aborts with a non-zero
 * exit code; the enclosing transaction rolls back so the archive returns to
 * its pre-populate state (ref tables from ref populate stay populated but are
 * additive).
 *
 * Prefer a single error class with a structured {@link details} payload over
 * one subclass per check: eight subclasses would create eight nearly
 * identical constructors, and callers (script + integration test) only need
 * to distinguish "verification failed" from other error kinds.
 */
export class MigrationVerificationError extends Error {
	/**
	 * @param details - Structured description of which check failed and why.
	 *   Rendered into the error message on construction.
	 */
	constructor(readonly details: MigrationVerificationErrorDetails) {
		const contextText =
			details.context === undefined
				? ''
				: ' — ' +
					Object.entries(details.context)
						.map(
							([key, value]) =>
								// Render null as the parenthesised literal `(null)` so
								// operators reading the log can distinguish "the sample
								// query returned no rows" from a caller that passed the
								// four-character string `"null"`. Strings get quoted for
								// the same reason.
								`${key}=${formatContextValue(value)}`,
						)
						.join(', ');
		super(`migration verification failed ${details.check}${contextText}`);
		this.name = 'MigrationVerificationError';
	}
}

/**
 * Renders one context value for {@link MigrationVerificationError}'s message.
 * `null` becomes the literal `(null)`; strings are wrapped in double quotes;
 * numbers pass through as their decimal representation. The intent is to
 * make missing-vs-present distinguishable in operator logs.
 * @param value - Value from `MigrationVerificationErrorDetails.context`.
 */
function formatContextValue(value: string | number | null): string {
	if (value === null) {
		return '(null)';
	}
	if (typeof value === 'string') {
		return JSON.stringify(value);
	}
	return String(value);
}
