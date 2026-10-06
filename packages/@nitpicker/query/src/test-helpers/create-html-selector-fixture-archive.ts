import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

import { makeBeholderMeta } from './make-beholder-meta.js';

/**
 * Creates a small archive whose pages carry the given HTML, for specs of
 * the HTML snapshot queries. Pages with identical HTML share one
 * deduplicated `page_html_blobs` row, and `/skipped` is added as an
 * excluded page with no snapshot.
 * @param options - Where to create the archive and which pages to store.
 * @param options.workingDir - Directory to create the archive in (created if missing).
 * @param options.fileName - File name of the `.nitpicker` archive.
 * @param options.pages - The pages to store, in crawl order.
 * @returns The open writable archive; the caller must `close()` it and remove `workingDir`.
 */
export async function createHtmlSelectorFixtureArchive(options: {
	workingDir: string;
	fileName: string;
	pages: readonly {
		/** Page URL. */
		url: string;
		/** Stored HTML; an empty string stores no snapshot. */
		html: string;
		contentType?: string;
		/** Mark the page excluded (`is_skipped`). */
		isSkipped?: boolean;
	}[];
}): Promise<Archive> {
	const { workingDir, fileName, pages } = options;
	mkdirSync(workingDir, { recursive: true });
	const archive = await Archive.create({
		filePath: path.resolve(workingDir, fileName),
		cwd: workingDir,
	});
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
		recursive: true,
		interval: 0,
		image: true,
		fetchExternal: false,
		parallels: 1,
		roots: ['https://example.com'],
		excludes: [],
		excludeKeywords: [],
		excludeUrls: [],
		maxExcludedDepth: 0,
		retry: 3,
		fromList: false,
		disableQueries: false,
		userAgent: 'test',
		ignoreRobots: false,
	});
	for (const page of pages) {
		const pageData = {
			url: parseUrl(page.url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: page.contentType ?? 'text/html',
			contentLength: page.html.length,
			responseHeaders: {},
			html: page.html,
			meta: makeBeholderMeta({ title: page.url }),
			anchorList: [],
			imageList: [],
			isSkipped: page.isSkipped ?? false,
		} as unknown as Parameters<Archive['setPage']>[0];
		await archive.setPage(pageData);
	}
	await archive.setSkippedPage('https://example.com/skipped', 'excluded', false);
	return archive;
}
