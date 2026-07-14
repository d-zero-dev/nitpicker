import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { populateMigrationTables } from './__test-utils__/populate-migration-tables.js';
import { getViewerLinkGraph } from './get-viewer-link-graph.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const dirname = path.dirname(new URL(import.meta.url).pathname);
const workingDir = path.resolve(dirname, '__test_fixtures_viewer_link_graph__');

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

describe('getViewerLinkGraph', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'viewer-link-graph.nitpicker');

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
					href: parseUrl('https://external.example.com/')!,
					isExternal: true,
					title: null,
					textContent: 'External',
				},
			],
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
					href: parseUrl('https://example.com/')!,
					isExternal: false,
					title: null,
					textContent: 'Home',
				},
			],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://example.com/contact')!,
			redirectPaths: [],
			isExternal: false,
			isTarget: true,
			status: 404,
			statusText: 'Not Found',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '<html></html>',
			meta: { ...META, title: 'Contact' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await archive.setPage({
			url: parseUrl('https://external.example.com/')!,
			redirectPaths: [],
			isExternal: true,
			isTarget: false,
			status: 200,
			statusText: 'OK',
			contentType: 'text/html',
			contentLength: 100,
			responseHeaders: {},
			html: '',
			meta: { ...META, title: '' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		await buildViewerReadModel(archive);
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('内部 HTML ノードと内部エッジだけを返す', async () => {
		const graph = await getViewerLinkGraph(archive);
		expect(graph.truncated).toBe(false);
		expect(graph.nodes.map((node) => node.url).toSorted()).toEqual([
			'https://example.com',
			'https://example.com/about',
			'https://example.com/contact',
		]);
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
		expect(
			graph.edges.every((edge) => edge.target.startsWith('https://example.com')),
		).toBe(true);
	});

	it('limit でノード集合を切り詰めて truncated=true を返す', async () => {
		const graph = await getViewerLinkGraph(archive, { limit: 1 });
		expect(graph.nodes).toHaveLength(1);
		expect(graph.truncated).toBe(true);
		const kept = new Set(graph.nodes.map((node) => node.url));
		expect(
			graph.edges.every((edge) => kept.has(edge.source) && kept.has(edge.target)),
		).toBe(true);
	});
});
