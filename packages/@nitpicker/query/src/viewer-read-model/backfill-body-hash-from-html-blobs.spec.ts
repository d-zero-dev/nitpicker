import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive, computeBodyHash } from '@nitpicker/crawler';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { backfillBodyHashFromHtmlBlobs } from './backfill-body-hash-from-html-blobs.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_backfill_body_hash__');

const baseMeta = {
	lang: 'ja',
	title: 't',
	description: null,
	keywords: null,
	noindex: false,
	nofollow: false,
	noarchive: false,
	canonical: null,
	alternate: null,
	'og:type': null,
	'og:title': null,
	'og:site_name': null,
	'og:description': null,
	'og:url': null,
	'og:image': null,
	'twitter:card': null,
} as const;

describe('backfillBodyHashFromHtmlBlobs', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'backfill-test.nitpicker');

	beforeEach(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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

		const pages = [
			{ url: 'https://example.com/a', html: '<html><body>Page A</body></html>' },
			{ url: 'https://example.com/b', html: '<html><body>Page B</body></html>' },
		];
		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: p.html,
				meta: baseMeta,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// Simulate an archive crawled before this feature existed: the write
		// path already sets body_hash, so null it back out here to reproduce
		// "column exists, value not backfilled yet".
		await archive.getKnex()('page_meta').update({ body_hash: null });
	});

	afterEach(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	const getBodyHashByUrl = async (url: string) =>
		await archive
			.getKnex()('page_meta')
			.join('content_items', 'page_meta.page_id', '=', 'content_items.id')
			.join('url_refs', 'content_items.url_id', '=', 'url_refs.id')
			.select('page_meta.body_hash as bodyHash')
			.where('url_refs.url', url)
			.first();

	it('computes and stores body_hash for pages whose value was NULL', async () => {
		await backfillBodyHashFromHtmlBlobs(archive);

		const a = await getBodyHashByUrl('https://example.com/a');
		const b = await getBodyHashByUrl('https://example.com/b');
		expect(Buffer.from(a.bodyHash)).toHaveLength(32);
		expect(Buffer.from(b.bodyHash)).toHaveLength(32);
		expect(Buffer.from(a.bodyHash).equals(Buffer.from(b.bodyHash))).toBe(false);
	});

	it('backfilled value matches computeBodyHash on the stored HTML', async () => {
		await backfillBodyHashFromHtmlBlobs(archive);

		const a = await getBodyHashByUrl('https://example.com/a');
		const expected = computeBodyHash('<html><body>Page A</body></html>');
		expect(Buffer.from(a.bodyHash).equals(expected)).toBe(true);
	});

	it('is idempotent — a second run leaves already-backfilled rows unchanged', async () => {
		await backfillBodyHashFromHtmlBlobs(archive);
		const before = await getBodyHashByUrl('https://example.com/a');

		await backfillBodyHashFromHtmlBlobs(archive);
		const after = await getBodyHashByUrl('https://example.com/a');

		expect(Buffer.from(after.bodyHash).equals(Buffer.from(before.bodyHash))).toBe(true);
	});

	it('is a no-op when no rows have a NULL body_hash', async () => {
		await archive
			.getKnex()('page_meta')
			.update({ body_hash: Buffer.alloc(32) });

		await expect(backfillBodyHashFromHtmlBlobs(archive)).resolves.toBeUndefined();
	});

	it('reports progress via onProgress', async () => {
		const calls: [number, number][] = [];
		await backfillBodyHashFromHtmlBlobs(archive, (processed, total) => {
			calls.push([processed, total]);
		});

		expect(calls.length).toBeGreaterThan(0);
		const [processed, total] = calls.at(-1)!;
		expect(processed).toBe(total);
		expect(total).toBe(2);
	});
});
