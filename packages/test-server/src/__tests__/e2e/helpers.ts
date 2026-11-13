import type { ArchiveAccessor } from '@nitpicker/archive/archive-accessor';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Archive from '@nitpicker/archive/archive';
import { CrawlerOrchestrator } from '@nitpicker/crawler';

/**
 * Result object returned by the E2E crawl helper.
 */
export interface CrawlResult {
	/** Read-only accessor for querying the crawled archive data. */
	accessor: ArchiveAccessor;
	/**
	 * The orchestrator's writable archive handle, still open on `tmpDir`.
	 * For assertions that need a write-capable accessor (e.g. building the
	 * viewer read model); most tests should use `accessor` instead.
	 */
	archive: Archive;
	/** Path to the temporary directory containing the raw archive (SQLite DB). */
	tmpDir: string;
	/** Path to the working directory created for this crawl session. */
	cwd: string;
	/** Absolute path to the resulting `.nitpicker` archive file. */
	filePath: string;
}

/**
 * Runs a crawl session against the given URLs and returns an accessor to the archive.
 * @param urls - One or more URLs to crawl.
 * @param options - Optional overrides merged into the default crawl configuration.
 * @param tap - Optional callback receiving the orchestrator before crawling
 *   begins, so a test can subscribe to events (e.g. `redirect`) emitted during
 *   the crawl. The default error logger is always attached regardless.
 * @returns A {@link CrawlResult} containing the archive accessor and temp paths.
 */
export async function crawl(
	urls: string[],
	options?: Record<string, unknown>,
	tap?: (orchestrator: CrawlerOrchestrator) => void,
): Promise<CrawlResult> {
	const cwd = path.join(os.tmpdir(), `nitpicker-e2e-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

	const orchestrator = await CrawlerOrchestrator.crawling(
		urls,
		{
			cwd,
			interval: 0,
			parallels: 1,
			image: false,
			...options,
		},
		(q) => {
			q.on('error', (e) => {
				console.error('[nitpicker:e2e] error:', e); // oxlint-disable-line no-console
			});
			tap?.(q);
		},
	);

	const tmpDir = orchestrator.archive.tmpDir;
	const filePath = orchestrator.archive.filePath;
	const accessor = await Archive.connect(tmpDir);

	return { accessor, archive: orchestrator.archive, tmpDir, cwd, filePath };
}

/**
 * Releases the archive handles opened by {@link crawl} and removes its
 * temporary working directory.
 *
 * The writable archive is released with `releaseHandle()` rather than
 * `close()`: `close()` writes the `.nitpicker` file when it does not exist yet
 * (a tar of the whole archive), which is wasted work for a directory about to
 * be deleted. `releaseHandle()` only drops the SQLite handle and the advisory
 * lock, and it is a no-op when a test already called `close()` itself.
 * @param result - The crawl result whose handles and working directory should be released.
 */
export async function cleanup(result: CrawlResult) {
	await result.accessor.close();
	await result.archive.releaseHandle();
	await fs.rm(result.cwd, { recursive: true, force: true });
}
