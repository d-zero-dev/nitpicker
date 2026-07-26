import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { computeIsolatedClusters } from './compute-isolated-clusters.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_compute_isolated_clusters__');

/**
 * Minimal Meta object for `setPage` — pages with no `<meta>` tags. Isolation
 * is judged purely by source labels + the resolved link graph, never by
 * metadata, so spelling these out keeps each test focused on the predicate
 * under inspection rather than meta fields.
 */
const EMPTY_META = {
	lang: null,
	title: null,
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
};

describe('computeIsolatedClusters', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'compute-clusters-test.nitpicker');

	beforeAll(async () => {
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

		// Crawled root — must NOT appear in any component (source = 'crawled').
		await archive.setPage({
			url: parseUrl('https://example.com/')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...EMPTY_META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Singleton inventory-seed page — no anchors in or out.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/lonely-seed')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Lonely Seed' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

		// 2-node cluster: seed-A anchors to disc-B; both inventory-*.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/cluster2/seed-a')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Cluster2 Seed A' },
				anchorList: [
					{
						href: parseUrl('https://example.com/cluster2/disc-b')!,
						isExternal: false,
						title: null,
						textContent: 'B',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/cluster2/disc-b')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Cluster2 Disc B' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);

		// 3-node cluster via redirect: seed-X anchors to /old-y, /old-y
		// redirects to seed-z. The anchor edge resolves to the canonical
		// destination (seed-z), so seed-x and seed-z form a 2-node
		// component (NOT 3 — the redirect-source row is an alias, not a
		// node). A second anchor from seed-z to seed-w makes the cluster 3 nodes.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/redirect-cluster/seed-x')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Redirect Cluster Seed X' },
				anchorList: [
					{
						href: parseUrl('https://example.com/redirect-cluster/old-y')!,
						isExternal: false,
						title: null,
						textContent: 'Y',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/redirect-cluster/seed-z')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Redirect Cluster Seed Z' },
				anchorList: [
					{
						href: parseUrl('https://example.com/redirect-cluster/seed-w')!,
						isExternal: false,
						title: null,
						textContent: 'W',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/redirect-cluster/seed-w')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Redirect Cluster Seed W' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		// Record /old-y → /seed-z redirect. Per the crawler's
		// `resolveRedirectChain`, `url` is the requested URL (= redirect
		// source) and the last entry of `redirectPaths` is the final
		// destination — so `url: /old-y, redirectPaths: [/seed-z]` records
		// "request /old-y, server redirects to /seed-z".
		await archive.setRedirect({
			url: parseUrl('https://example.com/redirect-cluster/old-y')!,
			redirectPaths: ['https://example.com/redirect-cluster/seed-z'],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: EMPTY_META,
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Outbound-only seed: anchors to the crawled root above but has no
		// inbound. The crawled root is `'crawled'` so the edge does NOT
		// pull this seed into a component with the root — it should
		// remain a singleton (size = 1) component.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/outbound-only-seed')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Outbound-only Seed' },
				anchorList: [
					{
						href: parseUrl('https://example.com/')!,
						isExternal: false,
						title: null,
						textContent: 'Home',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('returns one component per connected group, including singletons', async () => {
		const components = await computeIsolatedClusters(archive);
		const byRep = new Map(components.map((c) => [c.representativeUrl, c]));

		// /lonely-seed — singleton (no anchors).
		const lonely = byRep.get('https://example.com/lonely-seed');
		expect(lonely?.size).toBe(1);
		expect(lonely?.members.map((m) => m.url)).toEqual([
			'https://example.com/lonely-seed',
		]);

		// /cluster2 — size 2 (seed-a ↔ disc-b via anchor).
		const cluster2 = byRep.get('https://example.com/cluster2/disc-b');
		// Representative = lexicographically smallest URL: disc-b sorts
		// before seed-a (`d` < `s`).
		expect(cluster2?.size).toBe(2);
		expect(cluster2?.members.map((m) => m.url).toSorted()).toEqual([
			'https://example.com/cluster2/disc-b',
			'https://example.com/cluster2/seed-a',
		]);

		// /redirect-cluster — size 3 (seed-x ↔ seed-z via redirect, seed-z ↔ seed-w via direct anchor).
		const redirectCluster = byRep.get('https://example.com/redirect-cluster/seed-w');
		expect(redirectCluster?.size).toBe(3);
		expect(redirectCluster?.members.map((m) => m.url).toSorted()).toEqual([
			'https://example.com/redirect-cluster/seed-w',
			'https://example.com/redirect-cluster/seed-x',
			'https://example.com/redirect-cluster/seed-z',
		]);

		// /outbound-only-seed — singleton even though it anchors to the
		// crawled root: the root is `'crawled'` so the edge falls outside
		// the inventory-* candidate set and is dropped.
		const outboundOnly = byRep.get('https://example.com/outbound-only-seed');
		expect(outboundOnly?.size).toBe(1);
	});

	it('excludes crawled rows from candidates', async () => {
		const components = await computeIsolatedClusters(archive);
		const allMemberUrls = components.flatMap((c) => c.members.map((m) => m.url));
		expect(allMemberUrls).not.toContain('https://example.com/');
	});

	it('excludes redirect-source rows from candidates', async () => {
		const components = await computeIsolatedClusters(archive);
		const allMemberUrls = components.flatMap((c) => c.members.map((m) => m.url));
		expect(allMemberUrls).not.toContain('https://example.com/redirect-cluster/old-y');
	});

	it('sorts members by URL ASC and uses the first as representative', async () => {
		const components = await computeIsolatedClusters(archive);
		for (const c of components) {
			const urls = c.members.map((m) => m.url);
			expect(urls).toEqual(urls.toSorted());
			expect(c.representativeUrl).toBe(urls[0]);
		}
	});
});

describe('computeIsolatedClusters: content_items.alias_of_id handling', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(
		__dirname,
		'__test_fixtures_compute_isolated_clusters_alias__',
	);
	const archiveFilePath = path.resolve(dir, 'compute-clusters-alias-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(dir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
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

		// seed-x anchors to /old-y (an alias of seed-z); seed-z anchors to
		// seed-w. If alias resolution is wired correctly the three form one
		// 3-node component and /old-y (itself a would-be inventory-*
		// candidate) is excluded, mirroring the redirect-cluster case above.
		await archive.setPage(
			{
				url: parseUrl('https://example.com/alias-cluster/seed-x')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Alias Cluster Seed X' },
				anchorList: [
					{
						href: parseUrl('https://example.com/alias-cluster/old-y')!,
						isExternal: false,
						title: null,
						textContent: 'Y',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/alias-cluster/old-y')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Alias Cluster Old Y' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-discovered',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/alias-cluster/seed-z')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Alias Cluster Seed Z' },
				anchorList: [
					{
						href: parseUrl('https://example.com/alias-cluster/seed-w')!,
						isExternal: false,
						title: null,
						textContent: 'W',
						hash: null,
					},
				],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);
		await archive.setPage(
			{
				url: parseUrl('https://example.com/alias-cluster/seed-w')!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: '<html></html>',
				meta: { ...EMPTY_META, title: 'Alias Cluster Seed W' },
				anchorList: [],
				imageList: [],
				isSkipped: false,
			},
			'inventory-seed',
		);

		const knex = archive.getKnex();
		const target = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/alias-cluster/seed-z')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/alias-cluster/old-y')
			.first();
		await knex('content_items').where('id', member.id).update({ alias_of_id: target.id });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('resolves an anchor to an alias URL to its representative, forming one connected component', async () => {
		const components = await computeIsolatedClusters(archive);
		const cluster = components.find((c) =>
			c.members.some((m) => m.url === 'https://example.com/alias-cluster/seed-x'),
		);
		expect(cluster?.size).toBe(3);
		expect(cluster?.members.map((m) => m.url).toSorted()).toEqual([
			'https://example.com/alias-cluster/seed-w',
			'https://example.com/alias-cluster/seed-x',
			'https://example.com/alias-cluster/seed-z',
		]);
	});

	it('excludes the alias-source row from candidates', async () => {
		const components = await computeIsolatedClusters(archive);
		const allMemberUrls = components.flatMap((c) => c.members.map((m) => m.url));
		expect(allMemberUrls).not.toContain('https://example.com/alias-cluster/old-y');
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(computeIsolatedClusters(archive)).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});
