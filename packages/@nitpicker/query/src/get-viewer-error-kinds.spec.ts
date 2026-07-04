import type { CrawlerError } from '@nitpicker/crawler';

import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getErrorKinds } from './get-error-kinds.js';
import { getViewerErrorKinds } from './get-viewer-error-kinds.js';
import { buildViewerReadModel } from './viewer-read-model/build-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

/**
 * Minimal config so {@link Archive.create} has a valid `info` row.
 * @returns A config object accepted by `Archive.setConfig`.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.10.0',
		recursive: true,
		interval: 0,
		image: false,
		fetchExternal: true,
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
	};
}

/**
 * Build a `CrawlerError` for the crawler-level `error` channel.
 * @param url - The URL the error is about, or `null` for a process-level error.
 * @param message - The raw error message.
 * @param isExternal - Whether the URL is external.
 * @returns A `CrawlerError` accepted by `Archive.addError`.
 */
function crawlerError(
	url: string | null,
	message: string,
	isExternal = false,
): CrawlerError {
	return { pid: 1, isMainProcess: true, url, isExternal, error: new Error(message) };
}

describe('getViewerErrorKinds', () => {
	describe('no read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_no_model__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'no-model-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('throws — callers must guard with isViewerReadModelCurrent() first', async () => {
			await expect(getViewerErrorKinds(archive)).rejects.toThrow(
				/viewer_error_kind_meta/,
			);
		});
	});

	describe('read model built, no failures recorded', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_clean__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'clean-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());
			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('returns total 0, channelSource "none", and an empty groups array — the meta row exists even with zero failures', async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result).toEqual({ total: 0, channelSource: 'none', groups: [] });
		});
	});

	describe('with read model built', () => {
		const workingDir = path.resolve(
			__dirname,
			'__test_fixtures_get_viewer_error_kinds_built__',
		);
		let archive: InstanceType<typeof Archive>;

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(workingDir, { recursive: true });
			archive = await Archive.create({
				filePath: path.resolve(workingDir, 'built-test.nitpicker'),
				cwd: workingDir,
			});
			await archive.setConfig(baseConfig());

			await archive.addPageError(
				'https://example.com/slow',
				'retryExhausted',
				'gave up after 3 retries — Race 180,000ms vs Scraper.#fetchData',
				false,
			);
			await archive.addError(
				crawlerError(
					'http://ext.example.net/x',
					'getaddrinfo ENOTFOUND ext.example.net',
					true,
				),
			);
			await archive.addError(
				crawlerError(
					'http://ext.example.net/y',
					'getaddrinfo ENOTFOUND ext.example.net',
					true,
				),
			);
			await archive.addError(
				crawlerError(
					'https://api.example.org/',
					'connect ECONNREFUSED 10.0.0.1:443',
					true,
				),
			);

			await buildViewerReadModel(archive);
		});

		afterAll(async () => {
			if (archive) {
				await archive.releaseHandle();
			}
			const { rmSync } = await import('node:fs');
			rmSync(workingDir, { recursive: true, force: true });
		});

		it('matches a getErrorKinds() (legacy) snapshot of the same archive', async () => {
			const [viewerResult, legacyResult] = await Promise.all([
				getViewerErrorKinds(archive),
				getErrorKinds(archive),
			]);
			// Both sort groups by count descending, but neither documents a
			// tie-break rule for equal counts (the legacy path's tie order is an
			// accident of `Map` insertion order; the read model's is `ORDER BY
			// count desc` alone) — sort by kind before comparing so the two
			// equally-valid tie-break orders don't fail an otherwise-matching
			// comparison. Two of this fixture's three kinds tie at count 1.
			const sortByKind = (r: typeof legacyResult) => ({
				...r,
				groups: r.groups.toSorted((a, b) => a.kind.localeCompare(b.kind)),
			});
			expect(sortByKind(viewerResult)).toEqual(sortByKind(legacyResult));
		});

		it("computes the fixture's counts/hosts/samples independently of getErrorKinds() (hardcoded expectations)", async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result.total).toBe(4);
			expect(result.channelSource).toBe('crawl_errors');

			const byKind = new Map(result.groups.map((g) => [g.kind, g]));
			expect(byKind.get('dns')).toMatchObject({
				count: 2,
				hosts: [{ host: 'ext.example.net', count: 2 }],
			});
			expect(byKind.get('dns')?.sampleUrls).toEqual([
				'http://ext.example.net/x',
				'http://ext.example.net/y',
			]);
			expect(byKind.get('connection-refused')).toMatchObject({
				count: 1,
				hosts: [{ host: 'api.example.org', count: 1 }],
			});
			expect(byKind.get('timeout')).toMatchObject({
				count: 1,
				hosts: [{ host: 'example.com', count: 1 }],
			});
		});

		it('orders groups by count descending', async () => {
			const result = await getViewerErrorKinds(archive);
			expect(result.groups[0]).toMatchObject({ kind: 'dns', count: 2 });
		});
	});
});
