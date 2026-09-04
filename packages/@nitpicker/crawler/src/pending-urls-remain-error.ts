import type { PendingUrlsRemainReason } from './types.js';

/**
 * Thrown by `CrawlerOrchestrator`'s auto-retry loop when a crawl session
 * ends with `content_items` rows still unscraped and no further retry is
 * warranted (issue #350). The archive is deliberately left un-packaged —
 * see the loop's own JSDoc for the `.nitpicker` ⟹ pending = 0 invariant this
 * enforces — so the message points the operator at the stub left behind.
 */
export class PendingUrlsRemainError extends Error {
	/** Attempts actually run before giving up (0 when `--max-auto-retry 0`). */
	readonly attemptsMade: number;
	/** The configured `--max-auto-retry` ceiling. */
	readonly maxAutoRetry: number;
	/** Pending URL count at the moment retrying was abandoned. */
	readonly pendingCount: number;
	/** Why the loop stopped. */
	readonly reason: PendingUrlsRemainReason;
	/** Absolute path of the stub (tmpDir) left behind for `--resume`/`--retry-failed`. */
	readonly stubPath: string;

	/**
	 * @param params - See the matching readonly property for each field's meaning.
	 * @param params.pendingCount
	 * @param params.attemptsMade
	 * @param params.maxAutoRetry
	 * @param params.reason
	 * @param params.stubPath
	 */
	constructor(params: {
		pendingCount: number;
		attemptsMade: number;
		maxAutoRetry: number;
		reason: PendingUrlsRemainReason;
		stubPath: string;
	}) {
		const { pendingCount, attemptsMade, maxAutoRetry, reason, stubPath } = params;
		const reasonText =
			reason === 'no-progress'
				? `an auto-retry attempt made no progress (pending count did not decrease)`
				: `all ${maxAutoRetry} auto-retry attempt(s) were exhausted`;
		super(
			`${pendingCount} page(s) remain pending after ${attemptsMade} auto-retry attempt(s) — ${reasonText}. ` +
				`The archive was left un-packaged at: ${stubPath}. ` +
				`Run \`crawl ${stubPath} --resume\` (or \`--retry-failed\` once packaged) to continue, ` +
				'or rerun with a higher --max-auto-retry.',
		);
		this.name = 'PendingUrlsRemainError';
		this.pendingCount = pendingCount;
		this.attemptsMade = attemptsMade;
		this.maxAutoRetry = maxAutoRetry;
		this.reason = reason;
		this.stubPath = stubPath;
	}
}
