import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { buildViewerReadModel } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { report } from './report.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_report_html__');

vi.mock('@nitpicker/viewer/report-ui', () => ({
	renderHtmlReport: vi.fn(
		() => '<!doctype html><html lang="ja"><body>report</body></html>',
	),
}));

const BASE_CONFIG = {
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
};

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

describe('report', () => {
	const archiveFilePath = path.resolve(workingDir, 'site.nitpicker');
	const outputPath = path.resolve(workingDir, 'out.html');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig(BASE_CONFIG);
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
			html: '',
			meta: { ...META, title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await buildViewerReadModel(archive);
		await archive.write();
		await archive.close();
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('writes a standalone HTML file without Google credentials', async () => {
		await report({
			filePath: archiveFilePath,
			outputPath,
			interactive: false,
			silent: true,
		});

		expect(readFileSync(outputPath, 'utf8')).toBe(
			'<!doctype html><html lang="ja"><body>report</body></html>',
		);
	});
});
