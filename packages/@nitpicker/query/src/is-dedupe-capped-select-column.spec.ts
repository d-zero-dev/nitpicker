import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDedupeCappedSelectColumn } from './is-dedupe-capped-select-column.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_is_dedupe_capped_select_column__',
);

describe('isDedupeCappedSelectColumn', () => {
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

	it('projects 1 when the column is present and the row is marked', async () => {
		const knex = archive.getKnex();
		const eventId = await archive.insertDedupeCapEvent({
			shapeKey: 'example.com/{v}',
			sampleUrl: 'https://example.com/sample',
			bodyHash: Buffer.from('test-body-hash'),
			effectiveThreshold: 5,
			observedCount: 5,
			detectedAt: 1_700_000_000_000,
		});
		await knex('content_items').update({ dedupe_cap_event_id: eventId });

		const row = await knex('content_items as ci')
			.select(isDedupeCappedSelectColumn(knex, true))
			.first();
		expect(row.isDedupeCapped).toBe(1);
	});

	it('projects 0 when the column is present but the row is unmarked', async () => {
		const knex = archive.getKnex();
		await knex('content_items').update({ dedupe_cap_event_id: null });

		const row = await knex('content_items as ci')
			.select(isDedupeCappedSelectColumn(knex, true))
			.first();
		expect(row.isDedupeCapped).toBe(0);
	});

	it('degrades to a 0 literal usable in a real select when the column is absent', async () => {
		const knex = archive.getKnex();

		const row = await knex('content_items')
			.select(isDedupeCappedSelectColumn(knex, false))
			.first();
		expect(row.isDedupeCapped).toBe(0);
	});
});
