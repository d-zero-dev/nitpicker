import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { searchHtml } from './search-html.js';
import { createResourceFixtureArchive } from './test-helpers/create-resource-fixture-archive.js';

const workingDir = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	'__test_fixtures_search_html__',
);

describe('searchHtml', () => {
	let archive: Awaited<ReturnType<typeof createResourceFixtureArchive>>;

	beforeAll(async () => {
		archive = await createResourceFixtureArchive(workingDir, 'search-html.nitpicker');
	});

	afterAll(async () => {
		await archive?.close();
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('リテラル文字列を含むページを page_id 順に返す', async () => {
		const result = await searchHtml(archive, { pattern: 'fonts.example.org' });
		expect(result.items.map((item) => item.url)).toEqual([
			'https://example.com',
			'https://example.com/about',
		]);
		expect(result.total).toBe(2);
	});

	it('通常文字列は正規表現メタ文字をエスケープしたリテラルとして扱う', async () => {
		// As a regex, `He.lo` would match the stored "Hello"; as a literal it
		// must not, because the HTML contains no "He.lo".
		const result = await searchHtml(archive, { pattern: 'He.lo' });
		expect(result.total).toBe(0);
	});

	it('/re/flags 形式は正規表現として扱い、matchCount を数える', async () => {
		const result = await searchHtml(archive, { pattern: '/hello\\s+world/i' });
		expect(result.total).toBe(2);
		expect(result.items[0]).toMatchObject({ matchCount: 1 });
	});

	it('snippet は空白を畳んだマッチ周辺の窓になる', async () => {
		const result = await searchHtml(archive, {
			pattern: 'Hello   world',
			snippetLength: 40,
		});
		expect(result.items[0]!.snippet).toContain('Hello world');
		expect(result.items[0]!.snippet.length).toBeLessThanOrEqual(40);
	});

	it('同一 HTML は 1 回だけ展開される（scannedSnapshots はユニーク HTML 数）', async () => {
		const result = await searchHtml(archive, { pattern: 'no-such-string' });
		expect(result.total).toBe(0);
		expect(result.scannedSnapshots).toBe(2);
		expect(result.candidatePages).toBe(3);
	});

	it('urlPattern / directory でスキャン対象を絞る', async () => {
		const byUrl = await searchHtml(archive, {
			pattern: 'Hello',
			urlPattern: '%/about',
		});
		expect(byUrl.items.map((item) => item.url)).toEqual(['https://example.com/about']);

		const byDirectory = await searchHtml(archive, {
			pattern: 'page',
			directory: '/blog',
		});
		expect(byDirectory.items.map((item) => item.url)).toEqual([
			'https://example.com/blog/post',
		]);
	});

	it('offset / limit でスライスし、limit 0 は件数のみ返す', async () => {
		const page2 = await searchHtml(archive, {
			pattern: 'Hello',
			limit: 1,
			offset: 1,
		});
		expect(page2.items.map((item) => item.url)).toEqual(['https://example.com/about']);
		expect(page2.total).toBe(2);

		const countOnly = await searchHtml(archive, { pattern: 'Hello', limit: 0 });
		expect(countOnly.items).toEqual([]);
		expect(countOnly.total).toBe(2);
	});

	it('onProgress がチャンクごとに進捗行を受け取る', async () => {
		const messages: string[] = [];
		await searchHtml(archive, {
			pattern: 'Hello',
			onProgress: (message) => messages.push(message),
		});
		expect(messages).toEqual(['Scanning HTML snapshots: 2 / 2']);
	});

	it('空文字にマッチするパターンは拒否する', async () => {
		await expect(searchHtml(archive, { pattern: '/x*/' })).rejects.toThrow(
			/must not match the empty string/,
		);
	});

	it('不正な正規表現は SyntaxError を投げる', async () => {
		await expect(searchHtml(archive, { pattern: '/(/' })).rejects.toThrow(SyntaxError);
	});
});
