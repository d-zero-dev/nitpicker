import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dedupeCapShapeKeySelectColumn } from './dedupe-cap-shape-key-select-column.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_dedupe_cap_shape_key_select_column__',
);

describe('dedupeCapShapeKeySelectColumn', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'select-column-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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
			meta: {
				lang: null,
				title: null,
				description: null,
				keywords: null,
				noindex: false,
				nofollow: false,
				noarchive: false,
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
	});

	afterAll(async () => {
		if (archive) {
			await archive.releaseHandle();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('selects the raw shape_key column expression when the column is present', () => {
		const knex = archive.getKnex();
		expect(dedupeCapShapeKeySelectColumn(knex, true)).toBe(
			'dce.shape_key as dedupeCapShapeKey',
		);
	});

	it('degrades to a NULL literal usable in a real select when the column is absent', async () => {
		const knex = archive.getKnex();

		// Functional check rather than introspecting the knex.Raw internals:
		// the degraded expression must be usable in a real select without
		// throwing `no such column`, and must read back as null.
		const row = await knex('content_items')
			.select(dedupeCapShapeKeySelectColumn(knex, false))
			.first();
		expect(row.dedupeCapShapeKey).toBeNull();
	});
});
