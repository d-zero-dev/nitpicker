import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { streamAllViolations } from './stream-all-violations.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_stream_all_violations__');

/**
 * Drains every {@link streamAllViolations} chunk into a single flat array.
 * @param accessor - The archive accessor to query.
 * @param options - Forwarded to {@link streamAllViolations}.
 * @returns All chunks' rows, concatenated in scan order.
 */
async function collect(
	accessor: Parameters<typeof streamAllViolations>[0],
	options?: Parameters<typeof streamAllViolations>[1],
) {
	const rows = [];
	for await (const chunk of streamAllViolations(accessor, options)) {
		rows.push(...chunk);
	}
	return rows;
}

describe('streamAllViolations', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'stream-all-violations-test.nitpicker',
	);

	beforeAll(async () => {
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
			html: '',
			meta: {
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
			},
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});

		const knex = archive.getKnex();
		await knex('analysis_text_refs').insert([
			{ id: 1, text: 'Insufficient color contrast', sha256: 'a1' },
			{ id: 2, text: 'Missing alt text', sha256: 'a2' },
			{ id: 3, text: '<div>', sha256: 'b1' },
			{ id: 4, text: '<img>', sha256: 'b2' },
		]);
		await knex('analysis_violations').insert([
			{
				page_id: 1,
				validator: 'axe',
				severity: 'error',
				rule: 'color-contrast',
				message_text_id: 1,
				code_text_id: 3,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Insufficient color contrast',
				code_sort_key: '<div>',
			},
			{
				page_id: 1,
				validator: 'axe',
				severity: 'warning',
				rule: 'image-alt',
				message_text_id: 2,
				code_text_id: null,
				page_url_sort_key: 'https://example.com/',
				message_sort_key: 'Missing alt text',
				code_sort_key: '',
			},
		]);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('lists every violation', async () => {
		const rows = await collect(archive);
		expect(rows).toHaveLength(2);
	});

	it('carries the display fields verbatim', async () => {
		const rows = await collect(archive);
		const row = rows.find((r) => r.rule === 'color-contrast')!;
		expect(row).toMatchObject({
			validator: 'axe',
			severity: 'error',
			rule: 'color-contrast',
			code: '<div>',
			message: 'Insufficient color contrast',
			url: 'https://example.com',
		});
	});

	it('maps a null code_text_id to an empty string', async () => {
		const rows = await collect(archive);
		const row = rows.find((r) => r.rule === 'image-alt')!;
		expect(row.code).toBe('');
	});

	it('is independent of chunk size', async () => {
		const baseline = await collect(archive);
		const chunked = await collect(archive, { chunkSize: 1 });
		const byRule = (rows: typeof baseline) =>
			rows.toSorted((a, b) => a.rule.localeCompare(b.rule));
		expect(byRule(chunked)).toEqual(byRule(baseline));
	});

	it('throws on a non-positive chunkSize instead of hanging forever', async () => {
		await expect(collect(archive, { chunkSize: 0 })).rejects.toThrow(RangeError);
		await expect(collect(archive, { chunkSize: -1 })).rejects.toThrow(RangeError);
	});

	it('restricts rows to the given url allowlist', async () => {
		const restricted = await collect(archive, { urls: ['https://example.com'] });
		expect(restricted).toHaveLength(2);
		const empty = await collect(archive, { urls: ['https://other.example/'] });
		expect(empty).toHaveLength(0);
	});
});

describe('streamAllViolations (analysis未実行)', () => {
	let archive: InstanceType<typeof Archive>;
	const workingDir2 = path.resolve(
		__dirname,
		'__test_fixtures_stream_all_violations_empty__',
	);

	beforeAll(async () => {
		mkdirSync(workingDir2, { recursive: true });

		archive = await Archive.create({
			filePath: path.resolve(workingDir2, 'empty-test.nitpicker'),
			cwd: workingDir2,
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
		// Do not seed analysis tables.
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		rmSync(workingDir2, { recursive: true, force: true });
	});

	it('returns no rows when no analysis has run', async () => {
		const rows = await collect(archive);
		expect(rows).toHaveLength(0);
	});
});
