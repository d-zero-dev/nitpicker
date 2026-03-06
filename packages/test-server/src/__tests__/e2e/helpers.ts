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
	/** Path to the temporary directory containing the raw archive (SQLite DB). */
	tmpDir: string;
	/** Path to the working directory created for this crawl session. */
	cwd: string;
}

/**
 * Runs a crawl session against the given URLs and returns an accessor to the archive.
 * @param urls - One or more URLs to crawl.
 * @param options - Optional overrides merged into the default crawl configuration.
 * @returns A {@link CrawlResult} containing the archive accessor and temp paths.
 */
export async function crawl(
	urls: string[],
	options?: Record<string, unknown>,
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
		},
	);

	const tmpDir = orchestrator.archive.tmpDir;
	const accessor = await Archive.connect(tmpDir);

	return { accessor, tmpDir, cwd };
}

/**
 * Removes the temporary working directory created by {@link crawl}.
 * @param result - The crawl result whose working directory should be deleted.
 */
export async function cleanup(result: CrawlResult) {
	await fs.rm(result.cwd, { recursive: true, force: true });
}
