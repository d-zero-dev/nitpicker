import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createHtmlSelectorFixtureArchive } from '../test-helpers/create-html-selector-fixture-archive.js';

import { resolvePageUrls } from './resolve-page-urls.js';

// Shrinking the batch size at the module boundary makes five ids span
// three `IN (...)` lookups without touching the production code.
vi.mock('../sqlite-in-chunk.js', () => ({ SQLITE_IN_CHUNK: 2 }));

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_resolve_page_urls__',
);

describe('resolvePageUrls', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;
	let idByUrl: Map<string, number>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'resolve-page-urls.nitpicker',
			pages: [1, 2, 3, 4, 5].map((n) => ({
				url: `https://example.com/${n}`,
				html: `<p>${n}</p>`,
			})),
		});
		const rows = (await archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.select('ci.id as id', 'ur.url as url')) as { id: number; url: string }[];
		idByUrl = new Map(rows.map((row) => [row.url, row.id]));
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('resolves ids spanning several lookup batches', async () => {
		const urls = [
			'https://example.com/5',
			'https://example.com/1',
			'https://example.com/3',
			'https://example.com/2',
			'https://example.com/4',
		];
		const ids = urls.map((url) => idByUrl.get(url)!);

		const urlByPageId = await resolvePageUrls(archive.getKnex(), ids);

		expect(ids.map((id) => urlByPageId.get(id))).toEqual(urls);
		expect(urlByPageId.size).toBe(5);
	});

	it('leaves ids without a page out of the map', async () => {
		const urlByPageId = await resolvePageUrls(archive.getKnex(), [999_999]);
		expect(urlByPageId.size).toBe(0);
	});

	it('returns an empty map for no ids', async () => {
		const urlByPageId = await resolvePageUrls(archive.getKnex(), []);
		expect(urlByPageId.size).toBe(0);
	});
});
