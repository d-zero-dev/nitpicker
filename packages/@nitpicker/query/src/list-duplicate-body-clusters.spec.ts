import type { Meta } from '@d-zero/beholder';

import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listDuplicateBodyClusters } from './list-duplicate-body-clusters.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_duplicate_body_clusters__');

/**
 * Builds a minimal, intentionally-partial `Meta` object for test fixtures —
 * only the fields `deriveFlatFromMeta` actually reads (`title`, `og.url`)
 * are populated. Matches the existing pragmatic convention in
 * `find-duplicate-bodies.spec.ts` (vitest's esbuild/oxc transform does not
 * type-check spec files, so this shape is validated at runtime behaviour,
 * not full `Meta` compliance).
 * @param title
 * @param ogUrl
 */
function buildMeta(title: string, ogUrl?: string): Meta {
	return {
		title,
		og: ogUrl ? { url: ogUrl } : undefined,
	} as unknown as Meta;
}

describe('listDuplicateBodyClusters', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'dup-clusters-test.nitpicker');

	beforeAll(async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });

		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		await archive.setConfig({
			baseUrl: 'https://a.example.com',
			name: 'test',
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			roots: ['https://a.example.com'],
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

		const pages: { url: string; html: string; title: string; ogUrl?: string }[] = [
			// "trap-mismatch": 5 pages, identical body/title, og:url all point
			// at a parent listing (never the page itself) — ogUrlMismatchRatio
			// should be 1.0.
			...Array.from({ length: 5 }, (_, i) => ({
				url: `https://a.example.com/news/date/${2020 + i}/`,
				html: '<html><body>trap-mismatch body</body></html>',
				title: 'お知らせ',
				ogUrl: 'https://a.example.com/news',
			})),
			// "trap-match": 4 pages, identical body/title, og:url always equal
			// to the page's own absolute URL — ogUrlMismatchRatio should be 0.
			...Array.from({ length: 4 }, (_, i) => {
				const url = `https://a.example.com/blog/post-${i}/`;
				return {
					url,
					html: '<html><body>trap-match body</body></html>',
					title: 'ブログ',
					ogUrl: url,
				};
			}),
			// "mixed-ratio": 4 pages, 2 mismatch + 2 match — ogUrlMismatchRatio 0.5.
			...Array.from({ length: 4 }, (_, i) => {
				const url = `https://a.example.com/mixed/page-${i}/`;
				return {
					url,
					html: '<html><body>mixed-ratio body</body></html>',
					title: '一覧',
					ogUrl: i < 2 ? 'https://a.example.com/mixed' : url,
				};
			}),
			// "below-threshold": 2 pages, no og:url at all (ratio 0) — used to
			// test minCount filtering.
			...Array.from({ length: 2 }, (_, i) => ({
				url: `https://a.example.com/small/page-${i}/`,
				html: '<html><body>below-threshold body</body></html>',
				title: '小規模',
			})),
			// "non-uniform-title": 3 pages, same body but 2 distinct titles —
			// must be excluded by the title-uniformity filter regardless of count.
			{
				url: 'https://a.example.com/nonuniform/a/',
				html: '<html><body>non-uniform-title body</body></html>',
				title: 'タイトルA',
			},
			{
				url: 'https://a.example.com/nonuniform/b/',
				html: '<html><body>non-uniform-title body</body></html>',
				title: 'タイトルA',
			},
			{
				url: 'https://a.example.com/nonuniform/c/',
				html: '<html><body>non-uniform-title body</body></html>',
				title: 'タイトルB',
			},
			// "null-title-uniform": 3 pages, same body, all titles empty
			// (→ null after nullableString trims them) — must still be
			// included (COALESCE fix), ratio 0 (no og:url).
			...Array.from({ length: 3 }, (_, i) => ({
				url: `https://a.example.com/no-title/page-${i}/`,
				html: '<html><body>null-title-uniform body</body></html>',
				title: '',
			})),
			// "alias-pair": 2 pages sharing body/title — one is flipped to an
			// alias of the other after insertion, must be excluded entirely.
			{
				url: 'https://a.example.com/alias/a/',
				html: '<html><body>alias-pair body</body></html>',
				title: 'エイリアス',
			},
			{
				url: 'https://a.example.com/alias/b/',
				html: '<html><body>alias-pair body</body></html>',
				title: 'エイリアス',
			},
		];

		for (const p of pages) {
			await archive.setPage({
				url: parseUrl(p.url)!,
				redirectPaths: [],
				isExternal: false,
				isTarget: true,
				status: 200,
				statusText: 'OK',
				contentType: 'text/html',
				contentLength: 100,
				responseHeaders: {},
				html: p.html,
				meta: buildMeta(p.title, p.ogUrl),
				anchorList: [],
				imageList: [],
				isSkipped: false,
			});
		}

		const knex = archive.getKnex();
		const idByUrl = async (url: string) => {
			const row = await knex('content_items')
				.join('url_refs', 'url_refs.id', 'content_items.url_id')
				.where('url_refs.url', url)
				.select('content_items.id as id')
				.first();
			return row.id as number;
		};
		const aliasTargetId = await idByUrl('https://a.example.com/alias/a/');
		const aliasSourceId = await idByUrl('https://a.example.com/alias/b/');
		await knex('content_items')
			.where('id', aliasSourceId)
			.update({ alias_of_id: aliasTargetId });
	});

	afterAll(async () => {
		if (archive) {
			await archive.close();
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('minCount未満のクラスタを除外する', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 3 });
		const hit = result.find((c) => c.count === 2 && c.ogUrlMismatchRatio === 0);
		// below-threshold (count=2) must not appear when minCount=3
		expect(hit).toBeUndefined();
	});

	it('タイトルが一致しないクラスタを件数に関わらず除外する', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 2 });
		const samplePagesFlat = result.flatMap((c) => c.samplePages);
		expect(samplePagesFlat).not.toContain('https://a.example.com/nonuniform/a/');
		expect(samplePagesFlat).not.toContain('https://a.example.com/nonuniform/b/');
		expect(samplePagesFlat).not.toContain('https://a.example.com/nonuniform/c/');
	});

	it('全ページtitleがNULLで一致しているクラスタは除外しない（COALESCE）', async () => {
		const result = await listDuplicateBodyClusters(archive, {
			minCount: 3,
			samplePagesLimit: 10,
		});
		const cluster = result.find((c) => c.count === 3 && c.ogUrlMismatchRatio === 0);
		expect(cluster).toBeDefined();
		expect(cluster?.samplePages.some((u) => u.includes('/no-title/'))).toBe(true);
	});

	it('alias_of_idが設定されたページを含むクラスタを除外する', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 2 });
		const samplePagesFlat = result.flatMap((c) => c.samplePages);
		expect(samplePagesFlat).not.toContain('https://a.example.com/alias/a/');
		expect(samplePagesFlat).not.toContain('https://a.example.com/alias/b/');
	});

	it('og:urlが常に親一覧を指すクラスタはogUrlMismatchRatio=1になる', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 3 });
		const cluster = result.find((c) => c.count === 5);
		expect(cluster).toBeDefined();
		expect(cluster?.ogUrlMismatchRatio).toBe(1);
		expect(cluster?.signature).toMatch(/^[0-9a-f]{64}$/);
	});

	it('og:urlが常に自URLと一致するクラスタはogUrlMismatchRatio=0になる', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 3 });
		const cluster = result.find(
			(c) => c.count === 4 && c.samplePages.some((u) => u.includes('/blog/')),
		);
		expect(cluster).toBeDefined();
		expect(cluster?.ogUrlMismatchRatio).toBe(0);
	});

	it('og:urlが半々で一致/不一致のクラスタはogUrlMismatchRatio=0.5になる', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 3 });
		const cluster = result.find(
			(c) => c.count === 4 && c.samplePages.some((u) => u.includes('/mixed/')),
		);
		expect(cluster).toBeDefined();
		expect(cluster?.ogUrlMismatchRatio).toBe(0.5);
	});

	it('ogUrlMismatchRatio降順・count降順でソートされる', async () => {
		const result = await listDuplicateBodyClusters(archive, { minCount: 2 });
		const ratios = result.map((c) => c.ogUrlMismatchRatio);
		for (let i = 1; i < ratios.length; i++) {
			expect(ratios[i]! <= ratios[i - 1]!).toBe(true);
		}
	});

	it('samplePagesLimitでsamplePagesを切り詰めるが count は全件を反映する', async () => {
		const result = await listDuplicateBodyClusters(archive, {
			minCount: 3,
			samplePagesLimit: 2,
		});
		const cluster = result.find((c) => c.count === 5);
		expect(cluster).toBeDefined();
		expect(cluster?.samplePages).toHaveLength(2);
		expect(cluster?.count).toBe(5);
	});

	it('commonDirectoriesを全メンバーURLから計算する（samplePagesの切り詰めに影響されない）', async () => {
		const result = await listDuplicateBodyClusters(archive, {
			minCount: 3,
			samplePagesLimit: 1,
		});
		const cluster = result.find((c) => c.count === 5);
		expect(cluster).toBeDefined();
		const totalFromDirectories = cluster!.commonDirectories.reduce(
			(sum, d) => sum + d.pageCount,
			0,
		);
		expect(totalFromDirectories).toBe(5);
	});

	it('limit/offsetでページングできる', async () => {
		const all = await listDuplicateBodyClusters(archive, { minCount: 2, limit: 50 });
		const paged = await listDuplicateBodyClusters(archive, {
			minCount: 2,
			limit: 50,
			offset: 1,
		});
		expect(paged).toEqual(all.slice(1));
	});
});
