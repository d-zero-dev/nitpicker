import type { ArchiveAccessor } from '@nitpicker/crawler';

import { ArchiveManager } from '@nitpicker/query';

import { archiveLog } from './debug.js';

/**
 * Result of opening an archive for reporting.
 *
 * Implements `Symbol.asyncDispose` so callers can obtain one via
 * `await using` instead of remembering to call both
 * `removeSignalHandlers()` and closing the manager by hand.
 */
export interface ReportArchiveHandle extends AsyncDisposable {
	/** Read-only accessor for query functions — the only interface `report` code may depend on. */
	readonly accessor: ArchiveAccessor;
	/** Removes the registered signal handlers. Call this when the archive is no longer in use. */
	readonly removeSignalHandlers: () => void;
}

/**
 * Opens a `.nitpicker` archive for reporting, via `@nitpicker/query`'s
 * `ArchiveManager` (the same tar-extraction cache `viewer`/`query` CLI use)
 * instead of `@nitpicker/crawler`'s `Archive.open` — report used to
 * re-extract the full tar on every run; `ArchiveManager` reuses the cache
 * across runs and returns a read-only `ArchiveAccessor`, matching report's
 * actual access pattern (it never writes back to the archive).
 *
 * Rejects anything that is not a completed `.nitpicker` file: `ArchiveManager`
 * itself accepts a live-crawl tmpDir as `mode: 'stub'` (that is a valid mode
 * for `viewer`/`query`, which must keep working during a live crawl), but a
 * stub directory has no viewer read model and no finished write-model data
 * to report on, so `report` treats it as a caller error rather than a
 * degraded-but-working mode.
 *
 * Only `accessor` — never a raw `Archive` writer instance — is exposed:
 * `ArchiveManager.open()`'s `OpenResult.archive` is populated only on the
 * legacy `NITPICKER_DISABLE_TAR_CACHE=1` writer path and is `undefined` on
 * the normal cached-read path this function always takes, so code that
 * reached for it would work in one environment and silently misbehave in
 * another. `report` has no legitimate use for write access in the first
 * place — it is a read-only consumer by design.
 *
 * `ArchiveManager.closeAll()` is used (not `close(archiveId)`) for the
 * SIGINT handler and `Symbol.asyncDispose` because it is naturally
 * idempotent — the manager holds exactly one archive per report run, and a
 * second `closeAll()` call iterates an already-empty id list as a no-op.
 * `close(archiveId)` throws on a second call ("Archive not found"), which
 * would turn the ordinary SIGINT-then-asyncDispose double-teardown into an
 * unhandled rejection.
 * @param filePath - Path to the `.nitpicker` archive file.
 * @param onExtractProgress - Forwarded to `ArchiveManager` — called during
 *   the untar step with bytes read so far and the archive's total size
 *   (issue #294: a large archive's extraction can take tens of seconds with
 *   no other signal it isn't hung). Never called on a cache hit.
 * @returns A {@link ReportArchiveHandle}.
 * @throws {Error} If `filePath` does not resolve to a completed `.nitpicker`
 *   archive (e.g. it is a live-crawl directory).
 */
export async function openReportArchive(
	filePath: string,
	onExtractProgress?: (readBytes: number, totalBytes: number) => void,
): Promise<ReportArchiveHandle> {
	archiveLog('Open file: %s', filePath);
	const manager = new ArchiveManager({ onExtractProgress });
	const { accessor, mode } = await manager.open(filePath);
	if (mode !== 'archive') {
		await manager.closeAll();
		throw new Error(
			`report: "${filePath}" is not a completed .nitpicker archive (detected mode: "${mode}"). ` +
				'report only works against a finished archive file, not a live crawl directory.',
		);
	}
	archiveLog('File open succeeded');

	const signals: NodeJS.Signals[] = ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGABRT'];

	const close = async () => {
		await manager.closeAll();
		process.exit();
	};

	archiveLog('Bind close method to SIGINT, SIGBREAK, SIGHUP, SIGABRT events');
	for (const signal of signals) {
		process.on(signal, close);
	}

	const removeSignalHandlers = () => {
		for (const signal of signals) {
			process.removeListener(signal, close);
		}
	};

	return {
		accessor,
		removeSignalHandlers,
		async [Symbol.asyncDispose]() {
			archiveLog('Closes file');
			removeSignalHandlers();
			await manager.closeAll();
			archiveLog('Closed');
		},
	};
}
