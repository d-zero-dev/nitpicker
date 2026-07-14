import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildHeaderPresenceSelects } from './build-header-presence-selects.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_build_header_presence_selects__',
);

describe('buildHeaderPresenceSelects', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(
		workingDir,
		'build-header-presence-selects-test.nitpicker',
	);

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
			responseHeaders: {
				'Content-Security-Policy': "default-src 'self'",
				'Strict-Transport-Security': 'max-age=63072000',
			},
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
		await populateMigrationTables(archive);
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('selects all four header-presence columns aliased by name', async () => {
		const knex = archive.getKnex();
		const rows = await knex('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.leftJoin('header_flags as hf', 'hf.header_set_id', 'ci.header_set_id')
			.select('ur.url as url', ...buildHeaderPresenceSelects(knex))
			.limit(1);
		expect(rows).toHaveLength(1);
		const row = rows[0] as Record<string, unknown>;
		expect(Number(row.hasCSP)).toBe(1);
		expect(Number(row.hasXFrameOptions)).toBe(0);
		expect(Number(row.hasXContentTypeOptions)).toBe(0);
		expect(Number(row.hasHSTS)).toBe(1);
	});
});
