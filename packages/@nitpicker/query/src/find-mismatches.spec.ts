import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findMismatches } from './find-mismatches.js';
import { makeBeholderMeta } from './test-helpers/make-beholder-meta.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_find_mismatches__');

describe('findMismatches', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'find-mismatches-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

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

		// Page with canonical mismatch
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
			meta: makeBeholderMeta({
				title: 'Home',
				description: 'Home description',
				link: { canonical: 'https://example.com/home' },
				og: {
					title: 'Different OG Title',
					description: 'Different OG Description',
				},
			}),
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		// Page with no mismatches
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
			meta: makeBeholderMeta({
				title: 'About',
				link: { canonical: 'https://example.com/about' },
				og: { title: 'About' },
			}),
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

	it('canonical ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'canonical');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.type).toBe('canonical');
		expect(result[0]!.expected).toBe('https://example.com/home');
	});

	it('og:title ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'og:title');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.actual).toBe('Different OG Title');
		expect(result[0]!.expected).toBe('Home');
	});

	it('og:description ミスマッチを検出する', async () => {
		const result = await findMismatches(archive, 'og:description');
		expect(result).toHaveLength(1);
		expect(result[0]!.url).toContain('example.com');
		expect(result[0]!.actual).toBe('Different OG Description');
		expect(result[0]!.expected).toBe('Home description');
	});

	it('limit と offset が機能する', async () => {
		const result = await findMismatches(archive, 'canonical', 0);
		expect(result).toHaveLength(0);
	});
});
