import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
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
			version: '0.10.0',
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
});
