import type { ArchiveAccessor } from '@nitpicker/crawler';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';

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
				console.error('[nitpicker:e2e] error:', e); // eslint-disable-line no-console
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
 * Removes the temporary working directory created by {@link crawl}.
 * @param result - The crawl result whose working directory should be deleted.
 */
export async function cleanup(result: CrawlResult) {
	await fs.rm(result.cwd, { recursive: true, force: true });
}
