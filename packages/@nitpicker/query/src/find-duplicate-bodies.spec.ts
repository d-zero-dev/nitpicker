import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findDuplicateBodies } from './find-duplicate-bodies.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_duplicate_bodies__');

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

describe('findDuplicateBodies', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'dup-bodies-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://a.example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://a.example.com', 'https://b.example.com'],
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

		const pages: {
			url: string;
			status: number;
			contentType: string;
			html: string;
		}[] = [
			// Same host, body differs only in a masked dynamic id — must group.
			{
				url: 'https://a.example.com/user/a1b2c3d4',
				status: 200,
				contentType: 'text/html',
				html: '<html><body><a href="/user/a1b2c3d4">profile</a></body></html>',
			},
			{
				url: 'https://a.example.com/user/z9y8x7w6',
				status: 200,
				contentType: 'text/html',
				html: '<html><body><a href="/user/z9y8x7w6">profile</a></body></html>',
			},
			// Different host, byte-identical body — multi-root grouping.
			{
				url: 'https://b.example.com/user/a1b2c3d4',
				status: 200,
				contentType: 'text/html',
				html: '<html><body><a href="/user/a1b2c3d4">profile</a></body></html>',
			},
			// Singleton — must NOT appear in the result.
			{
				url: 'https://a.example.com/unique',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>Nothing else looks like this</body></html>',
			},
			// Two 404 pages sharing an identical error template — status is
			// deliberately not filtered, so these must group too.
			{
				url: 'https://a.example.com/missing-1',
				status: 404,
				contentType: 'text/html',
				html: '<html><body>Not Found</body></html>',
			},
			{
				url: 'https://a.example.com/missing-2',
				status: 404,
				contentType: 'text/html',
				html: '<html><body>Not Found</body></html>',
			},
			// Non-HTML — body_hash stays null, must never appear in a group.
			{
				url: 'https://a.example.com/doc.pdf',
				status: 200,
				contentType: 'application/pdf',
				html: '',
			},
			// Trio sharing a body: two stay internal (form the group), the
			// third is flipped to is_external=1 below to simulate a page
			// that later leaves scope without a fresh HTML write — its
			// stale body_hash must not resurrect it into the group.
			{
				url: 'https://a.example.com/ext-1',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>External Flip Test</body></html>',
			},
			{
				url: 'https://a.example.com/ext-2',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>External Flip Test</body></html>',
			},
			{
				url: 'https://a.example.com/ext-3',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>External Flip Test</body></html>',
			},
			// Trio sharing a body: two stay direct pages (form the group),
			// the third is flipped to a redirect source below to simulate a
			// page that later turns into a redirect without a fresh HTML
			// write — its stale body_hash must not resurrect it either.
			{
				url: 'https://a.example.com/redirect-1',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>Redirect Flip Test</body></html>',
			},
			{
				url: 'https://a.example.com/redirect-2',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>Redirect Flip Test</body></html>',
			},
			{
				url: 'https://a.example.com/redirect-3',
				status: 200,
				contentType: 'text/html',
				html: '<html><body>Redirect Flip Test</body></html>',
			},
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: p.status,
				statusText: p.status === 404 ? 'Not Found' : 'OK',
				contentType: p.contentType,
				contentLength: 100,
				responseHeaders: {},
				html: p.html,
				meta: baseMeta,
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		// Simulate the two transitions that leave a stale body_hash without
		// a fresh HTML write (see the WHY comment in find-duplicate-bodies.ts):
		// a page whose content_items row later flips is_external=1
		// (setExternalPage) or gains a redirect_dest_id (linkRedirectSources).
		const knex = archive.getKnex();
		const idByUrl = async (url: string) => {
			const row = await knex('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.where('url_refs.url', url)
				.select('content_items.id as id')
				.first();
			return row.id as number;
		};

		const extId = await idByUrl('https://a.example.com/ext-3');
		await knex('content_items').where('id', extId).update({ is_external: 1 });

		const redirectDestId = await idByUrl('https://a.example.com/redirect-1');
		const redirectSourceId = await idByUrl('https://a.example.com/redirect-3');
		await knex('content_items')
			.where('id', redirectSourceId)
			.update({ redirect_dest_id: redirectDestId });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('groups pages whose body differs only in a masked dynamic id', async () => {
		const result = await findDuplicateBodies(archive);
		const group = result.find((g) =>
			g.urls.includes('https://a.example.com/user/a1b2c3d4'),
		);
		expect(group).toBeDefined();
		expect(group?.urls.toSorted()).toEqual([
			'https://a.example.com/user/a1b2c3d4',
			'https://a.example.com/user/z9y8x7w6',
			'https://b.example.com/user/a1b2c3d4',
		]);
		expect(group?.count).toBe(3);
		expect(group?.bodyHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('groups identical bodies across hosts (multi-root)', async () => {
		const result = await findDuplicateBodies(archive);
		const group = result.find((g) =>
			g.urls.includes('https://b.example.com/user/a1b2c3d4'),
		);
		expect(group?.urls.some((u) => u.startsWith('https://a.example.com/'))).toBe(true);
		expect(group?.urls.some((u) => u.startsWith('https://b.example.com/'))).toBe(true);
	});

	it('groups duplicate bodies regardless of HTTP status (404 soft-duplicate templates)', async () => {
		const result = await findDuplicateBodies(archive);
		const group = result.find((g) => g.urls.includes('https://a.example.com/missing-1'));
		expect(group).toBeDefined();
		expect(group?.urls.toSorted()).toEqual([
			'https://a.example.com/missing-1',
			'https://a.example.com/missing-2',
		]);
	});

	it('excludes singleton bodies', async () => {
		const result = await findDuplicateBodies(archive);
		const hit = result.find((g) => g.urls.includes('https://a.example.com/unique'));
		expect(hit).toBeUndefined();
	});

	it('excludes non-HTML pages (body_hash stays null)', async () => {
		const result = await findDuplicateBodies(archive);
		const hit = result.find((g) => g.urls.includes('https://a.example.com/doc.pdf'));
		expect(hit).toBeUndefined();
	});

	it('excludes a page whose body_hash is stale after flipping to is_external=1 without a fresh HTML write', async () => {
		const result = await findDuplicateBodies(archive);
		const group = result.find((g) => g.urls.includes('https://a.example.com/ext-1'));
		expect(group).toBeDefined();
		expect(group?.urls.toSorted()).toEqual([
			'https://a.example.com/ext-1',
			'https://a.example.com/ext-2',
		]);
	});

	it('excludes a page whose body_hash is stale after gaining a redirect_dest_id without a fresh HTML write', async () => {
		const result = await findDuplicateBodies(archive);
		const group = result.find((g) => g.urls.includes('https://a.example.com/redirect-1'));
		expect(group).toBeDefined();
		expect(group?.urls.toSorted()).toEqual([
			'https://a.example.com/redirect-1',
			'https://a.example.com/redirect-2',
		]);
	});

	it('limit caps the number of returned groups', async () => {
		const result = await findDuplicateBodies(archive, 1);
		expect(result).toHaveLength(1);
	});

	it('offset skips groups in ORDER BY cnt DESC order', async () => {
		const all = await findDuplicateBodies(archive, 50);
		const paged = await findDuplicateBodies(archive, 50, 1);
		expect(paged).toEqual(all.slice(1));
	});
});
