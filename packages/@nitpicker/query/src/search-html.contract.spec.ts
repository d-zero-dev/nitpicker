import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { searchHtml } from './search-html.js';
import { createResourceFixtureArchive } from './test-helpers/create-resource-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_search_html_contract__',
);

describe('searchHtml: the pattern contract', () => {
	let archive: Awaited<ReturnType<typeof createResourceFixtureArchive>>;

	beforeAll(async () => {
		archive = await createResourceFixtureArchive(
			workingDir,
			'search-html-contract.nitpicker',
		);
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('takes /source/s as a regular expression, not as the literal text', async () => {
		const result = await searchHtml(archive, { pattern: String.raw`/hello\s+world/is` });
		expect(result.total).toBe(2);
	});

	it('searches /…/flags text as it is with the literal option', async () => {
		const asRegex = await searchHtml(archive, { pattern: '/hello/i' });
		expect(asRegex.total).toBe(2);
		const asText = await searchHtml(archive, { pattern: '/hello/i', literal: true });
		expect(asText.total).toBe(0);
		const flagOnlyText = await searchHtml(archive, { pattern: '/a/y', literal: true });
		expect(flagOnlyText.total).toBe(0);
	});

	it('keeps a string with an unknown trailing letter as a literal', async () => {
		const result = await searchHtml(archive, { pattern: '/fonts.example.org/x' });
		expect(result.total).toBe(0);
	});

	it.each(['/a/y', '/a/d', '/a/v'])(
		'rejects the flag in %s with a SyntaxError',
		async (pattern) => {
			await expect(searchHtml(archive, { pattern })).rejects.toThrow(SyntaxError);
		},
	);

	it.each([String.raw`/(\w)\1/`, '/(?=a)a/', '/(?<!a)a/'])(
		'rejects the unsupported construct %s with a SyntaxError',
		async (pattern) => {
			await expect(searchHtml(archive, { pattern })).rejects.toThrow(SyntaxError);
		},
	);

	it('rejects before scanning, so nothing is reported as progress', async () => {
		const messages: string[] = [];
		await expect(
			searchHtml(archive, { pattern: '/(?=a)a/', onProgress: (m) => messages.push(m) }),
		).rejects.toThrow(SyntaxError);
		expect(messages).toEqual([]);
	});

	it('counts the matches of a pattern that matches empty only inside a document', async () => {
		const result = await searchHtml(archive, { pattern: String.raw`/\b/`, limit: 1 });
		expect(result.total).toBe(3);
		expect(result.items[0]!.matchCount).toBeGreaterThan(1);
	});

	it('cuts the snippet in characters around the first match', async () => {
		const result = await searchHtml(archive, { pattern: 'world', snippetLength: 11 });
		// "Hello   world</body>" collapses to "Hello world</body>" before the window
		// is cut: it starts 3 characters before the match, at "lo world</b".
		expect(result.items[0]!.snippet).toBe('lo world</b');
	});

	it('returns an empty snippet for a snippetLength of 0 while still matching', async () => {
		const result = await searchHtml(archive, { pattern: 'world', snippetLength: 0 });
		expect(result.total).toBe(2);
		expect(result.items[0]).toMatchObject({ matchCount: 1, snippet: '' });
	});

	it.each([-1, 1.5, Number.NaN, 2 ** 32])(
		'rejects a snippetLength of %s with a RangeError',
		async (snippetLength) => {
			await expect(
				searchHtml(archive, { pattern: 'world', snippetLength }),
			).rejects.toThrow(RangeError);
		},
	);
});
