import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { matchSelector } from '../match-selector/match-selector.js';
import { searchHtml } from '../search-html.js';
import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_scan_undecodable__',
);

/**
 * The native judges report a snapshot they cannot decode by its position in
 * the batch; the scan turns that into the blob's hash. These run the real
 * addon, so the wording the addon uses and the pattern the scan reads are
 * checked against each other (a decompression past the limit is reported
 * with the same wording as corrupt data).
 */
describe('a stored snapshot the native judge cannot decode', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;
	let hash: string;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'scan-undecodable.nitpicker',
			pages: [{ url: 'https://example.com', html: '<p><img></p>' }],
		});
		const knex = archive.getKnex();
		const row = (await knex('page_html_blobs').select('hash').first()) as {
			hash: Uint8Array;
		};
		hash = Buffer.from(row.hash).toString('hex');
		await knex('page_html_blobs')
			.where('hash', Buffer.from(row.hash))
			.update({ body: Buffer.from('not zstd'), codec: 'zstd' });
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('fails match-selector naming the blob hash instead of reporting no match', async () => {
		await expect(matchSelector(archive, { selector: 'img' })).rejects.toThrow(
			new RegExp(
				`^snapshot 0 could not be decoded: .* \\(page_html_blobs hash ${hash}\\)$`,
			),
		);
	});

	it('fails search-html naming the blob hash instead of reporting no match', async () => {
		await expect(searchHtml(archive, { pattern: 'img' })).rejects.toThrow(
			new RegExp(
				`^snapshot 0 could not be decoded: .* \\(page_html_blobs hash ${hash}\\)$`,
			),
		);
	});
});
