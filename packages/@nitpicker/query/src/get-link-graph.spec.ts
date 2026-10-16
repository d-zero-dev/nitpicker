import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import Archive from '@nitpicker/archive/archive';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getLinkGraph } from './get-link-graph.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_link_graph__');

/** Default page metadata for fixture pages. */
const META = {
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

describe('getLinkGraph', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'link-graph-test.nitpicker');

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

		// Home links to About, Contact, and an external page.
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
			meta: { ...META, title: 'Home' },
			anchorList: [
				{
					href: parseUrl('https://example.com/about')!,
					isExternal: false,
					title: null,
					textContent: 'About',
				},
				{
					href: parseUrl('https://example.com/contact')!,
					isExternal: false,
					title: null,
					textContent: 'Contact',
				},
				{
					href: parseUrl('https://example.net/')!,
					isExternal: true,
					title: null,
					textContent: 'External',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// About links back to Home.
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'About' },
			anchorList: [
				{
					href: parseUrl('https://example.com/')!,
					isExternal: false,
					title: null,
					textContent: 'Home',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		// Contact has no outgoing links.
		await archive.setPage({
			url: parseUrl('https://example.com/contact')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Contact' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('内部 HTML ページをノードに含める', async () => {
		const graph = await getLinkGraph(archive);
		const urls = graph.nodes.map((n) => n.url).toSorted();
		expect(urls).toEqual([
			'https://example.com',
			'https://example.com/about',
			'https://example.com/contact',
		]);
	});

	it('内部リンクをエッジにする（外部・自己リンクを除外）', async () => {
		const graph = await getLinkGraph(archive);
		expect(graph.edges).toContainEqual({
			source: 'https://example.com',
			target: 'https://example.com/about',
		});
		expect(graph.edges).toContainEqual({
			source: 'https://example.com',
			target: 'https://example.com/contact',
		});
		expect(graph.edges).toContainEqual({
			source: 'https://example.com/about',
			target: 'https://example.com',
		});
		// No external destinations.
		expect(graph.edges.every((e) => e.target.startsWith('https://example.com'))).toBe(
			true,
		);
	});

	it('inDegree を計算する', async () => {
		const graph = await getLinkGraph(archive);
		const about = graph.nodes.find((n) => n.url === 'https://example.com/about');
		expect(about?.inDegree).toBe(1);
	});

	it('limit でノードを絞り truncated を立て、エッジも残ったノードに限定する', async () => {
		const graph = await getLinkGraph(archive, { limit: 1 });
		expect(graph.nodes).toHaveLength(1);
		expect(graph.truncated).toBe(true);
		const kept = new Set(graph.nodes.map((n) => n.url));
		for (const edge of graph.edges) {
			expect(kept.has(edge.source) && kept.has(edge.target)).toBe(true);
		}
	});

	it('limit 未指定なら truncated は false で全ノードを返す', async () => {
		const graph = await getLinkGraph(archive);
		expect(graph.truncated).toBe(false);
		expect(graph.nodes).toHaveLength(3);
	});

	it('各ノードに source プロビナンスを返し、setPage 経由のページはデフォルトで crawled', async () => {
		const graph = await getLinkGraph(archive);
		for (const node of graph.nodes) {
			expect(node.source).toBe('crawled');
		}
	});

	it('DB 上で source を書き換えた場合、その値がノードに反映される', async () => {
		// content_items テーブルの source を直接書き換えて、`getLinkGraph` の
		// SELECT がその列を読み出せているか (= source が SELECT 抜けしていない
		// か) を検証する。insertInventorySeeds + setPage を使うと
		// source-priority の CASE WHEN が経由してしまい、SELECT 抜けバグを
		// 検出できないので直書きで確認する。
		const knex = archive.getKnex();
		const updateSourceByUrl = (url: string, source: string) =>
			knex('content_items')
				.whereIn('url_id', knex('url_refs').select('id').where('url', url))
				.update({ source });
		await updateSourceByUrl('https://example.com/about', 'inventory-seed');
		await updateSourceByUrl('https://example.com/contact', 'inventory-discovered');

		const graph = await getLinkGraph(archive);
		const about = graph.nodes.find((n) => n.url === 'https://example.com/about');
		const contact = graph.nodes.find((n) => n.url === 'https://example.com/contact');
		const home = graph.nodes.find((n) => n.url === 'https://example.com');
		expect(about?.source).toBe('inventory-seed');
		expect(contact?.source).toBe('inventory-discovered');
		expect(home?.source).toBe('crawled');

		// テスト間の独立性を保つため元に戻す。
		await updateSourceByUrl('https://example.com/about', 'crawled');
		await updateSourceByUrl('https://example.com/contact', 'crawled');
	});
});

describe('getLinkGraph: content_items.alias_of_id handling', () => {
	const dir = path.resolve(dirname, '__test_fixtures_link_graph_alias__');
	const archiveFilePath = path.resolve(dir, 'link-graph-alias-test.nitpicker');
	let archive: InstanceType<typeof Archive>;

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

		// Home (`/`) and its alias (`/index.html`) both exist as rows; About
		// links to the alias URL specifically, to prove the alias-side node
		// and its inbound edge both drop rather than resolve to the target.
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
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/index.html')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.setPage({
			url: parseUrl('https://example.com/about')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'About' },
			anchorList: [
				{
					href: parseUrl('https://example.com/index.html')!,
					isExternal: false,
					title: null,
					textContent: 'Home',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		const target = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com')
			.first();
		const member = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id')
			.where('ur.url', 'https://example.com/index.html')
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

	it('drops the alias-side node from the graph entirely', async () => {
		const graph = await getLinkGraph(archive);
		const urls = graph.nodes.map((n) => n.url);
		expect(urls).toContain('https://example.com');
		expect(urls).not.toContain('https://example.com/index.html');
	});

	it('drops edges pointing at the alias-side URL rather than resolving them', async () => {
		const graph = await getLinkGraph(archive);
		expect(graph.edges.some((e) => e.target === 'https://example.com/index.html')).toBe(
			false,
		);
	});

	it('throws an actionable error when content_items.alias_of_id does not exist', async () => {
		const knex = archive.getKnex();
		await knex.schema.alterTable('content_items', (t) => {
			t.dropColumn('alias_of_id');
		});

		await expect(getLinkGraph(archive)).rejects.toThrow(/viewer-build/);

		// Restore the column so afterAll's close()/other tests are unaffected.
		await knex.schema.alterTable('content_items', (t) => {
			t.integer('alias_of_id');
		});
	});
});

describe('getLinkGraph: in-degree, edges and limit', () => {
	let archive: InstanceType<typeof Archive>;
	const dir = path.resolve(dirname, '__test_fixtures_link_graph_limit__');
	const archiveFilePath = path.resolve(dir, 'link-graph-limit-test.nitpicker');
	const HUB = 'https://example.com/hub';
	const MID = 'https://example.com/mid';
	const LOW1 = 'https://example.com/low1';
	const LOW2 = 'https://example.com/low2';
	const ORPHAN = 'https://example.com/orphan';

	/**
	 * Writes one internal page that links to `links`.
	 * @param url - The page URL.
	 * @param links - The URLs it links to.
	 */
	async function writePage(url: string, links: readonly string[]) {
		await archive.setPage({
			url: parseUrl(url)!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: url },
			anchorList: links.map((href) => ({
				href: parseUrl(href)!,
				isExternal: false,
				title: null,
				textContent: href,
			})),
			imageList: [],
			isSkipped: false,
		});
	}

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

		// In-degrees: hub 3 (low1, low2, orphan), mid 2 (hub, low1), low1 1 (hub),
		// low2 1 (mid), orphan 0. The orphan also links to itself.
		await writePage(HUB, [MID, LOW1]);
		await writePage(MID, [LOW2]);
		await writePage(LOW1, [HUB, MID]);
		await writePage(LOW2, [HUB]);
		await writePage(ORPHAN, [HUB, ORPHAN]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(dir, { recursive: true, force: true });
	});

	it('counts every node’s in-degree', async () => {
		const graph = await getLinkGraph(archive);
		const inDegreeByUrl = Object.fromEntries(graph.nodes.map((n) => [n.url, n.inDegree]));
		expect(inDegreeByUrl).toStrictEqual({
			[HUB]: 3,
			[MID]: 2,
			[LOW1]: 1,
			[LOW2]: 1,
			[ORPHAN]: 0,
		});
	});

	it('returns each edge once and leaves the self link out', async () => {
		const graph = await getLinkGraph(archive);
		const edges = graph.edges.map((e) => `${e.source} -> ${e.target}`).toSorted();
		expect(edges).toStrictEqual([
			`${HUB} -> ${LOW1}`,
			`${HUB} -> ${MID}`,
			`${LOW1} -> ${HUB}`,
			`${LOW1} -> ${MID}`,
			`${LOW2} -> ${HUB}`,
			`${MID} -> ${LOW2}`,
			`${ORPHAN} -> ${HUB}`,
		]);
	});

	it('keeps the most linked-to pages under a limit, and only the edges among them', async () => {
		const graph = await getLinkGraph(archive, { limit: 2 });
		expect(graph.nodes.map((n) => [n.url, n.inDegree])).toStrictEqual([
			[HUB, 3],
			[MID, 2],
		]);
		expect(graph.edges).toStrictEqual([{ source: HUB, target: MID }]);
		expect(graph.truncated).toBe(true);
	});

	it('returns everything and no truncation when the limit covers every node', async () => {
		const graph = await getLinkGraph(archive, { limit: 5 });
		expect(graph.nodes).toHaveLength(5);
		expect(graph.edges).toHaveLength(7);
		expect(graph.truncated).toBe(false);
	});

	it.each([
		[0, 0],
		[-1, 0],
		[1.9, 1],
	])(
		'a limit of %s keeps %i nodes and reports truncation',
		async (limit, expectedNodes) => {
			const graph = await getLinkGraph(archive, { limit });
			expect(graph.nodes).toHaveLength(expectedNodes);
			expect(graph.truncated).toBe(true);
			expect(graph.edges).toStrictEqual([]);
		},
	);
});
