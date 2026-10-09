import type Archive from '@nitpicker/archive/archive';
import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import fs from 'node:fs/promises';
import path from 'node:path';

/** Everything {@link cleanupFailedTransfer} needs to unwind a failed `concat`/`split` run. */
export interface FailedTransferState {
	/** Every source accessor opened so far (read-only; closing just drops the DB handle, never mutates). */
	readonly sourceAccessors: readonly ArchiveAccessor[];
	/** The destination archive, once `Archive.create` succeeded — `null` if the failure happened before that. */
	readonly destination: Archive | null;
	/** `true` once `destination.write()` was called — see this function's docs for why that changes cleanup. */
	readonly writeStarted: boolean;
	/** The `-o/--output` path the run was writing to. */
	readonly outputPath: string;
}

/**
 * Unwinds a `concat`/`split` run that failed partway through, so a failed
 * attempt never leaves a half-built archive at the requested output path.
 *
 * The destination is detached with `releaseHandle()`, NEVER `close()` —
 * `Archive#close()`'s recovery path calls `write()` when the target file
 * does not exist yet, which would package the half-transferred tmpDir as
 * if it were the finished archive. `releaseHandle()` drops the SQLite
 * handle and the advisory lock without touching the filesystem, so the
 * tmpDir removal below is the only thing that actually deletes anything.
 *
 * `writeStarted` only matters in the rare case `destination.write()`
 * itself throws partway through (e.g. disk full during the tar step,
 * after the tmpDir has already been renamed to its final pre-tar name) —
 * `validate-transfer-output-path.ts` already confirmed neither the output
 * file nor its sibling write-target directory existed before this run
 * started, so removing both here is always safe (there is nothing
 * pre-existing to destroy).
 *
 * Every step is best-effort (`.catch(() => {})`) — a cleanup failure must
 * never mask the original error the caller is already handling.
 * @param state - See {@link FailedTransferState}.
 * @example
 * ```ts
 * try {
 *   // ... run the transfer ...
 * } catch (error) {
 *   await cleanupFailedTransfer(state);
 *   formatCliError(error, false);
 *   process.exit(ExitCode.Fatal);
 * }
 * ```
 */
export async function cleanupFailedTransfer(state: FailedTransferState): Promise<void> {
	for (const accessor of state.sourceAccessors) {
		await accessor.close().catch(() => {});
	}

	if (state.destination) {
		const tmpDir = state.destination.tmpDir;
		await state.destination.releaseHandle().catch(() => {});
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	}

	if (state.writeStarted) {
		const dir = path.dirname(state.outputPath);
		const basename = path.basename(state.outputPath, path.extname(state.outputPath));
		await fs
			.rm(path.join(dir, basename), { recursive: true, force: true })
			.catch(() => {});
		await fs.rm(state.outputPath, { force: true }).catch(() => {});
	}
}
