import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';

import { makeBeholderMeta } from './make-beholder-meta.js';

const FONT_LINK_HTML =
	'<html><head><link href="https://fonts.example.org/css2?family=Sample+Sans" rel="stylesheet"></head><body>Hello   world</body></html>';

/**
 * Creates a small archive for the HTML-search / resource-lookup specs.
 *
 * Pages (all `example.com`, `text/html`):
 * - `/` and `/about` store the **identical** HTML (one deduplicated
 *   `page_html_blobs` row) containing a Google Fonts `<link>` and the text
 *   `Hello   world`
 * - `/blog/post` stores different HTML without either string
 * - `/skipped` is an excluded page (no HTML snapshot, no resource edges)
 *
 * Resources and their referrers:
 * - `https://example.com/style.css` (`text/css`, internal): `/`, `/about`, `/blog/post`
 * - `https://fonts.example.net/s/samplesans.woff2` (`font/woff2`, external): `/`, `/about`
 * - `https://example.com/fonts/local.woff` (`font/woff`, internal): `/`
 * - `https://cdn.example.com/app.js` (`application/javascript`, external): `/blog/post`
 * @param workingDir - Directory to create the archive in (created if missing).
 * @param fileName - File name of the `.nitpicker` archive.
 * @returns The open writable archive; the caller must `close()` it and remove `workingDir`.
 */
export async function createResourceFixtureArchive(
	workingDir: string,
	fileName: string,
): Promise<Archive> {
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

	const pages: { url: string; html: string }[] = [
		{ url: 'https://example.com/', html: FONT_LINK_HTML },
		{ url: 'https://example.com/about', html: FONT_LINK_HTML },
		{
			url: 'https://example.com/blog/post',
			html: '<html><body>Plain page</body></html>',
		},
	];
	for (const page of pages) {
		// Only the fields the writer reads for these specs are populated;
		// `PageData` carries many render-time fields (main contents, scroll
		// heights, image scan, …) that are irrelevant here.
		const pageData = {
			url: parseUrl(page.url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: page.html.length,
			responseHeaders: {},
			html: page.html,
			meta: makeBeholderMeta({ title: page.url }),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		} as unknown as Parameters<Archive['setPage']>[0];
		await archive.setPage(pageData);
	}
	await archive.setSkippedPage('https://example.com/skipped', 'excluded', false);

	const resources = [
		{ url: 'https://example.com/style.css', type: 'text/css', isExternal: false },
		{
			url: 'https://fonts.example.net/s/samplesans.woff2',
			type: 'font/woff2',
			isExternal: true,
		},
		{ url: 'https://example.com/fonts/local.woff', type: 'font/woff', isExternal: false },
		{
			url: 'https://cdn.example.com/app.js',
			type: 'application/javascript',
			isExternal: true,
		},
	];
	for (const resource of resources) {
		await archive.setResources({
			url: parseUrl(resource.url)!,
			isExternal: resource.isExternal,
			isError: false,
			status: 200,
			statusText: 'OK',
			contentType: resource.type,
			contentLength: 1000,
			compress: false,
			cdn: false,
			headers: null,
		});
	}

	const referrers: [string, string][] = [
		['https://example.com', 'https://example.com/style.css'],
		['https://example.com/about', 'https://example.com/style.css'],
		['https://example.com/blog/post', 'https://example.com/style.css'],
		['https://example.com', 'https://fonts.example.net/s/samplesans.woff2'],
		['https://example.com/about', 'https://fonts.example.net/s/samplesans.woff2'],
		['https://example.com', 'https://example.com/fonts/local.woff'],
		['https://example.com/blog/post', 'https://cdn.example.com/app.js'],
	];
	for (const [url, src] of referrers) {
		await archive.setResourcesReferrers({ url, src });
	}

	return archive;
}
