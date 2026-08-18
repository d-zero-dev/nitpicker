import type { Page } from '@nitpicker/crawler';

import fs from 'node:fs/promises';

import { Lanes } from '@d-zero/dealer';
import { sortUrl } from '@d-zero/shared/sort-url';
import { Archive } from '@nitpicker/crawler';

import { createByteProgressLogger } from '../create-byte-progress-logger.js';
import { formatLogLine } from '../format-log-line.js';

/** Options controlling {@link diff}'s progress display. */
export interface DiffOptions {
	/** Append timestamped lines instead of overwriting a single one. */
	verbose?: boolean;
	/** Suppress all progress output. */
	silent?: boolean;
}

/**
 * Compares two `.nitpicker` archives and writes their URL lists to `a.txt` and `b.txt`.
 *
 * Extracts active internal HTML pages (2xx/3xx status) from both archives,
 * sorts them in natural URL order, and writes to the current working directory.
 * The output files can then be compared using standard diff tools.
 *
 * Opens both archives read-only via {@link Archive.openCached} (issue #294)
 * — `diff` never writes back, so it doesn't need `Archive.open`'s writer
 * lock/tmpDir semantics, and re-diffing the same pair of archives (a common
 * before/after workflow) hits the cache on the second run instead of
 * re-extracting from scratch. The two opens run sequentially, each with its
 * own byte-progress line, so a slow cold extraction of archive A doesn't
 * look indistinguishable from one hung on archive B.
 * @param a - File path to the first `.nitpicker` archive
 * @param b - File path to the second `.nitpicker` archive
 * @param options - See {@link DiffOptions}.
 */
export async function diff(a: string, b: string, options?: DiffOptions): Promise<void> {
	const verbose = !!options?.verbose;
	using lanes = options?.silent
		? null
		: new Lanes({ verbose, indent: '  ', stream: process.stderr });
	const log = (message: string) => {
		lanes?.update(0, formatLogLine(verbose, message));
	};

	log('%braille% Extracting archive A%dots%');
	await using archiveA = await Archive.openCached(
		a,
		null,
		createByteProgressLogger(log, 'Extracting archive A'),
	);
	log('%braille% Extracting archive B%dots%');
	await using archiveB = await Archive.openCached(
		b,
		null,
		createByteProgressLogger(log, 'Extracting archive B'),
	);

	log('%braille% Comparing pages%dots%');
	const pagesA = await archiveA.getPages();
	const pagesB = await archiveB.getPages();
	const listA = pagesA.filter(isActive).map((page) => page.url.withoutHashAndAuth);
	const listB = pagesB.filter(isActive).map((page) => page.url.withoutHashAndAuth);

	const sortedA = sortUrl(listA).map((url) => url.withoutHashAndAuth);
	const sortedB = sortUrl(listB).map((url) => url.withoutHashAndAuth);

	await fs.writeFile('a.txt', sortedA.join('\n'), 'utf8');
	await fs.writeFile('b.txt', sortedB.join('\n'), 'utf8');
	log('Done: a.txt, b.txt');
}

/**
 * Filters for active internal HTML pages (status 200-399, non-external).
 * @param page - The page to check
 * @returns `true` if the page is an active internal HTML page
 */
function isActive(page: Page) {
	return (
		page.isPage() &&
		!page.isExternal &&
		page.status &&
		page.status >= 200 &&
		page.status < 400
	);
}
