import type { ArchiveAccessor } from '@nitpicker/crawler';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';

export interface CrawlResult {
	accessor: ArchiveAccessor;
	tmpDir: string;
	cwd: string;
}

/**
 *
 * @param urls
 * @param options
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
 *
 * @param result
 */
export async function cleanup(result: CrawlResult) {
	await fs.rm(result.cwd, { recursive: true, force: true });
}
