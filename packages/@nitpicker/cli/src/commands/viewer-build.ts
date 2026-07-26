import type { CommandDef, InferFlags } from '@d-zero/roar';

import { existsSync, statSync } from 'node:fs';
import { copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import {
	backfillAliasOfId,
	backfillBodyHashFromHtmlBlobs,
	buildViewerReadModel,
	ensureViewerReadModel,
} from '@nitpicker/query';

import { ExitCode } from '../exit-code.js';
import { formatCliError } from '../format-cli-error.js';
import { formatViewerReadModelProgress } from '../format-viewer-read-model-progress.js';

/**
 * Command definition for the `viewer-build` sub-command.
 * @see {@link viewerBuild} for the main entry point
 */
export const commandDef = {
	desc: "Build (or rebuild) a .nitpicker archive's persistent viewer read model",
	flags: {
		force: {
			type: 'boolean',
			desc: 'Always rebuild, even if the read model is already current (default: only build when missing/stale)',
		},
	},
} as const satisfies CommandDef;

/** Parsed flag values for the `viewer-build` CLI command. */
type ViewerBuildFlags = InferFlags<typeof commandDef.flags>;

/**
 * Logs a `buildViewerReadModel`/`ensureViewerReadModel` progress update to
 * stderr — large archives (issue #112: 400k pages) take minutes, and a
 * silent CLI would look hung.
 * @param progress - The current insert progress.
 */
function logProgress(
	progress: Parameters<typeof formatViewerReadModelProgress>[0],
): void {
	// eslint-disable-next-line no-console
	console.error(formatViewerReadModelProgress(progress));
}

/**
 * Await a filesystem promise but silently swallow only `ENOENT` errors. Any
 * other failure (permissions, disk full, etc.) propagates so the caller can
 * react instead of guessing whether the operation worked. Mirrors
 * `CrawlerOrchestrator`'s private helper of the same name/shape (not
 * exported from `@nitpicker/crawler`, so duplicated here rather than reached
 * across package boundaries for a 5-line utility).
 * @param promise - Filesystem operation to await.
 */
async function ignoreEnoent(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw error;
		}
	}
}

/**
 * Main entry point for the `viewer-build` CLI command.
 *
 * Explicitly (re)builds the persistent viewer read model inside an existing
 * `.nitpicker` archive — issue #112's "explicit build command" trigger,
 * complementing the automatic crawl-completion build. Useful for upgrading
 * archives crawled before the read model existed (so viewer/MCP/query CLI
 * opens never pay an on-open build cost) or for forcing a clean rebuild.
 *
 * Mutates the archive in place using the same `.bak`-then-restore pattern as
 * `crawl --append`/`--retry-failed`: a backup is taken before any write and
 * restored automatically if the build or the write-back fails, so a
 * corrupted/interrupted run never leaves the archive in a half-built state.
 * If the restore itself also fails, both errors are surfaced together (via
 * `AggregateError`) rather than letting the restore failure silently mask
 * why the build failed in the first place.
 * @param args - Positional arguments; first is the `.nitpicker` file path.
 * @param flags - Parsed CLI flags from the `viewer-build` command.
 * @returns Resolves when the build (or no-op) completes.
 *   Exits with code 1 if the archive path is missing/invalid or an error occurs.
 */
export async function viewerBuild(
	args: string[],
	flags: ViewerBuildFlags,
): Promise<void> {
	const filePath = args[0];
	if (!filePath) {
		// eslint-disable-next-line no-console
		console.error('Error: No .nitpicker file specified.');
		// eslint-disable-next-line no-console
		console.error('Usage: nitpicker viewer-build <archive> [--force]');
		process.exit(ExitCode.Fatal);
	}

	const absFilePath = path.isAbsolute(filePath)
		? filePath
		: path.resolve(process.cwd(), filePath);

	if (!existsSync(absFilePath)) {
		// eslint-disable-next-line no-console
		console.error(`Error: Archive not found: ${absFilePath}`);
		process.exit(ExitCode.Fatal);
	}

	if (!statSync(absFilePath).isFile()) {
		// eslint-disable-next-line no-console
		console.error(
			`Error: Not a .nitpicker file (stub crawl directories are not supported): ${absFilePath}`,
		);
		process.exit(ExitCode.Fatal);
	}

	const backupPath = `${absFilePath}.bak`;
	if (existsSync(backupPath)) {
		// eslint-disable-next-line no-console
		console.error(`Error: Stale backup present: ${backupPath} — remove it first`);
		process.exit(ExitCode.Fatal);
	}

	await copyFile(absFilePath, backupPath);

	try {
		// No explicit `cwd`: matches every other Archive.open call site in
		// this CLI (crawl.ts, diff.ts), which all default to process.cwd()
		// for the transient extraction scratch dir regardless of where the
		// target archive itself lives.
		const archive = await Archive.open({ filePath: absFilePath });
		try {
			if (flags.force) {
				await buildViewerReadModel(archive, { onProgress: logProgress });
			} else {
				await ensureViewerReadModel(archive, { onProgress: logProgress });
			}
			// Not folded into the branches above: `ensureViewerReadModel`'s
			// schema-version gate answers "does the read model need a
			// rebuild", which is the wrong question for this backfill —
			// `body_hash` didn't change the read-model schema, so an archive
			// whose read model is already current would otherwise never run
			// it. Called unconditionally here so `viewer-build` (with or
			// without `--force`) always catches up a legacy archive's
			// `body_hash` values; its own row-count guard makes the
			// `--force` branch's second call (buildViewerReadModel already
			// ran it once above) a cheap no-op.
			await backfillBodyHashFromHtmlBlobs(archive, (processed, total) => {
				// eslint-disable-next-line no-console
				console.error(`[nitpicker] page_meta.body_hash backfill: ${processed}/${total}`);
			});
			// Must run after the body_hash backfill above: alias_of_id's
			// trailing-slash tier requires body_hash to already be computed
			// for both candidate pages. Called unconditionally for the same
			// schema-version-gate reason as backfillBodyHashFromHtmlBlobs —
			// alias_of_id does not change the read-model schema either, so
			// `ensureViewerReadModel` alone would never trigger this on an
			// already-current archive.
			await backfillAliasOfId(archive, (processed, total) => {
				// eslint-disable-next-line no-console
				console.error(
					`[nitpicker] content_items.alias_of_id backfill: ${processed}/${total}`,
				);
			});
			await archive.write();
		} finally {
			await archive.close();
		}
		await ignoreEnoent(unlink(backupPath));
	} catch (error) {
		try {
			await copyFile(backupPath, absFilePath);
			await ignoreEnoent(unlink(backupPath));
		} catch (restoreError) {
			formatCliError(
				new AggregateError(
					[error, restoreError],
					`viewer-build failed AND restore from backup failed. Original archive backup is left at: ${backupPath}`,
				),
				false,
			);
			process.exit(ExitCode.Fatal);
		}
		formatCliError(error, false);
		process.exit(ExitCode.Fatal);
	}
}
