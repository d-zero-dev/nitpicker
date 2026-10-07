import { rmSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyUrlDirectoryFilter } from './apply-url-directory-filter.js';
import { createHtmlSelectorFixtureArchive } from './test-helpers/create-html-selector-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_apply_url_directory_filter__',
);

const HTML = '<html><body></body></html>';

describe('applyUrlDirectoryFilter', () => {
	let archive: Awaited<ReturnType<typeof createHtmlSelectorFixtureArchive>>;

	beforeAll(async () => {
		archive = await createHtmlSelectorFixtureArchive({
			workingDir,
			fileName: 'apply-url-directory-filter.nitpicker',
			pages: [
				{ url: 'https://example.com', html: HTML },
				{ url: 'https://example.com/blog', html: HTML },
				{ url: 'https://example.com/blog/', html: HTML },
				{ url: 'https://example.com/blog/2024/post', html: HTML },
				{ url: 'https://example.com/blog?page=2', html: HTML },
				{ url: 'https://example.com/blogging', html: HTML },
				{ url: 'https://example.com/en/blog/post', html: HTML },
				{ url: 'https://example.com/search?from=/blog/x', html: HTML },
				{ url: 'https://example.com/my-docs/a', html: HTML },
				{ url: 'https://example.org/blog/other-host', html: HTML },
				{ url: 'https://example.com:8080/blog/port', html: HTML },
				{ url: 'https://example.com.test/blog/near-miss-host', html: HTML },
				{ url: 'https://example.com/Blog/upper', html: HTML },
				{ url: 'https://example.net/?lang=en', html: HTML },
			],
		});
		// The fixture writer normalises a root URL to `/?lang=en`; store the
		// slash-less form some archives hold so the authority boundary is exercised.
		await archive
			.getKnex()('url_refs')
			.where('url', 'https://example.net/?lang=en')
			.update({ url: 'https://example.net?lang=en' });
	});

	afterAll(async () => {
		await archive?.close();
		rmSync(workingDir, { recursive: true, force: true });
	});

	/**
	 * Lists the page URLs the filter keeps, in insertion order.
	 * @param directory - The directory filter.
	 * @returns The kept page URLs.
	 */
	async function filteredUrls(directory: string): Promise<string[]> {
		const query = archive
			.getKnex()('content_items as ci')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.where('ci.is_skipped', 0)
			.select('ur.url as url')
			.orderBy('ci.id');
		applyUrlDirectoryFilter(query, directory);
		return ((await query) as { url: string }[]).map((row) => row.url);
	}

	it('keeps the directory page and its subtree on every host, with / as the boundary', async () => {
		expect(await filteredUrls('/blog')).toEqual([
			'https://example.com/blog',
			'https://example.com/blog/',
			'https://example.com/blog/2024/post',
			'https://example.com/blog?page=2',
			'https://example.org/blog/other-host',
			'https://example.com:8080/blog/port',
			'https://example.com.test/blog/near-miss-host',
		]);
	});

	it('compares the path case-sensitively', async () => {
		expect(await filteredUrls('/Blog')).toEqual(['https://example.com/Blog/upper']);
	});

	it('reads /blog/, blog and //blog as /blog', async () => {
		const expected = await filteredUrls('/blog');
		expect(await filteredUrls('/blog/')).toEqual(expected);
		expect(await filteredUrls('blog')).toEqual(expected);
		expect(await filteredUrls('//blog')).toEqual(expected);
	});

	it('restricts to the host of a full-URL filter, ignoring scheme and port', async () => {
		expect(await filteredUrls('http://example.com/blog/')).toEqual([
			'https://example.com/blog',
			'https://example.com/blog/',
			'https://example.com/blog/2024/post',
			'https://example.com/blog?page=2',
			'https://example.com:8080/blog/port',
		]);
	});

	it('keeps every page of the host for a full-URL filter without a path', async () => {
		expect(await filteredUrls('https://example.org')).toEqual([
			'https://example.org/blog/other-host',
		]);
	});

	it('ends the host at a query that follows it directly', async () => {
		expect(await filteredUrls('https://example.net')).toEqual([
			'https://example.net?lang=en',
		]);
	});

	it('keeps every page for /', async () => {
		expect(await filteredUrls('/')).toHaveLength(14);
	});

	it('treats % and _ in the directory literally', async () => {
		expect(await filteredUrls('/my_docs')).toEqual([]);
		expect(await filteredUrls('/my%')).toEqual([]);
		expect(await filteredUrls('/my-docs')).toEqual(['https://example.com/my-docs/a']);
	});

	it('rejects a blank directory', async () => {
		await expect(filteredUrls(' ')).rejects.toThrow(TypeError);
	});
});
