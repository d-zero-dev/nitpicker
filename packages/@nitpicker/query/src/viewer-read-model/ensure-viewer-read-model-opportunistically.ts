import type { EnsureViewerReadModelOpportunisticallyOptions } from '../types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { Archive, acquireArchiveLock, ArchiveLockError } from '@nitpicker/crawler';

import { ensureViewerReadModel } from './ensure-viewer-read-model.js';

/**
 * Suffix appended to `accessor.tmpDir` before handing it to
 * `acquireArchiveLock`, which publishes the lock as a sibling
 * `<target>.lock` directory. Nesting it under `tmpDir` (rather than
 * alongside it, like the crawler's own archive lock) keeps the lock
 * confined to — and reclaimed together with — the cache directory it
 * protects.
 */
const LOCK_TARGET_BASENAME = '.viewer-read-model';

/**
 * Builds the viewer read model into an already-extracted, writable-capable
 * cache directory (issue #112's on-open build path), without ever failing
 * the read-only open that triggered it.
 *
 * **This runs synchronously as part of that open** — it does not detach into
 * the background — so the caller awaiting `ArchiveManager.open()` /
 * `Archive.openCached()` blocks for the build's duration. That is
 * intentional for the same reason the crawl-completion build is allowed to
 * take minutes on a 400k-page archive (see `docs/viewer-implementation-plan.md`
 * Phase 5): once built, the read model is cached in the tar-cache directory
 * and every subsequent open of the same archive — from any process — skips
 * straight to the fast path. This on-open path only ever fires once per
 * archive (persistent builds at crawl completion, and `nitpicker
 * viewer-build`, cover the steady state) — see the "explicit build command"
 * note in `ARCHITECTURE.md`'s `/api/pages` section for callers that want to
 * pay this cost ahead of time instead.
 *
 * Intended for exactly one caller shape: `ArchiveManager`/`Archive.openCached`
 * consumers (viewer, MCP server, query CLI) that just obtained a read-only
 * `accessor` backed by the OS-temp tar cache and found
 * `isViewerReadModelCurrent(accessor)` false. This function then:
 *
 * 1. Tries to acquire a dedicated build lock scoped to `accessor.tmpDir` —
 *    reusing `acquireArchiveLock`'s mkdir-atomic + stale-PID-recovery
 *    primitive, not the crawler's own archive lock (which guards the
 *    source* `.nitpicker`/tmpDir, an unrelated resource). If another
 *    process is already building the same cache directory's read model
 *    concurrently, this call is a silent no-op: the current request simply
 *    falls back to the legacy `listPages` path, rather than waiting.
 * 2. Verifies `accessor.tmpDir`'s `db.sqlite` still exists, then opens a
 *    second, writable connection to the SAME `tmpDir` via
 *    `Archive.connect(tmpDir, null, { readOnly: false })` — safe because
 *    `tmpDir` here is always the disposable tar-cache extraction, never a
 *    live/interrupted crawl's tmpDir (stub mode never reaches this
 *    function; see the module doc on `ArchiveManager`). The existence check
 *    matters because `Archive.connect`'s *writable* mode (unlike its default
 *    read-only mode) has no TOCTOU guard of its own: `Database.connect`'s
 *    writer branch happily `mkdir`s and re-initialises a fresh, empty
 *    schema at a missing path instead of throwing — exactly the "phantom
 *    tmpDir" scenario the read-only path's own guard exists to prevent (see
 *    `Archive.connect`'s JSDoc). Without this check, a cache directory
 *    reclaimed by OS temp cleanup (or quarantined by a concurrent
 *    `extractArchiveToCache` re-extraction) between `Archive.openCached`
 *    returning and this reconnect would silently "succeed" with a
 *    zero-row read model instead of surfacing the missing directory.
 * 3. Delegates to `ensureViewerReadModel`, then closes the writable
 *    connection and releases the lock.
 *
 * Never throws: a lock conflict, a missing tmpDir, a build failure, or any
 * other error is reported through `options.onWarn` and swallowed, because a
 * missing read model already has a working fallback (`listPages`) — failing
 * the open itself would violate issue #112's "build failures must not
 * corrupt the archive" requirement.
 * @param accessor - The read-only accessor from `Archive.openCached`, whose
 *   `tmpDir` points at the tar-cache extraction to build into.
 * @param options - Build options, forwarded to `ensureViewerReadModel`, plus
 *   `onWarn` for skip/failure reporting.
 * @example
 * // Inside ArchiveManager's cache-enabled open path:
 * const accessor = await Archive.openCached(realPath);
 * if (!(await isViewerReadModelCurrent(accessor))) {
 *   await ensureViewerReadModelOpportunistically(accessor, { onWarn });
 * }
 */
export async function ensureViewerReadModelOpportunistically(
	accessor: ArchiveAccessor,
	options: EnsureViewerReadModelOpportunisticallyOptions = {},
): Promise<void> {
	const { onWarn, onProgress } = options;
	const lockTarget = `${accessor.tmpDir}/${LOCK_TARGET_BASENAME}`;

	let releaseLock: (() => Promise<void>) | undefined;
	try {
		releaseLock = await acquireArchiveLock(lockTarget);
	} catch (error) {
		if (error instanceof ArchiveLockError) {
			onWarn?.(
				'[nitpicker] viewer read model build already in progress elsewhere, using the legacy read path for this request.',
			);
			return;
		}
		onWarn?.(
			`[nitpicker] could not acquire the viewer read model build lock, continuing without it: ${describeError(error)}`,
		);
		return;
	}

	try {
		// `Archive.connect`'s writable mode has no TOCTOU guard of its own —
		// see this function's JSDoc — so check the extraction is still
		// there ourselves before handing it a `readOnly: false` connection
		// that would otherwise silently re-initialise a phantom empty db.
		const dbPath = path.join(accessor.tmpDir, Archive.SQLITE_DB_FILE_NAME);
		if (!existsSync(dbPath)) {
			throw new Error(
				`tar-cache directory vanished before the writable reconnect: ${dbPath}`,
			);
		}

		const writable = await Archive.connect(accessor.tmpDir, null, { readOnly: false });
		try {
			await ensureViewerReadModel(writable, { onProgress });
		} finally {
			await writable.close();
		}
	} catch (error) {
		onWarn?.(
			`[nitpicker] viewer read model build failed, continuing without it: ${describeError(error)}`,
		);
	} finally {
		await releaseLock();
	}
}

/**
 * Coerces an unknown thrown value into a human-readable message.
 * @param error - The caught value.
 * @returns The error's message, or its string form when it isn't an `Error`.
 */
function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
