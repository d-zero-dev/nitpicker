import type { ArchiveContext } from './types.js';
import type { ArchiveManager } from '@nitpicker/query';

import { existsSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { listPages } from '@nitpicker/query';
import { afterEach, describe, expect, it } from 'vitest';

import { prepareCachedUrlSortTempTable } from './url-sort-cache.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_url_sort_cache__');

const META = {
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
};

/**
 * Minimal config so {@link Archive.create} has a valid `info` row.
 * @returns A config object accepted by `Archive.setConfig`.
 */
function baseConfig() {
	return {
		baseUrl: 'https://example.com',
		name: 'test',
		version: '0.13.0',
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
 * Adds a minimal internal HTML page to the archive.
 * @param archive - The archive to write to.
 * @param url - The page URL.
 */
async function addPage(archive: InstanceType<typeof Archive>, url: string) {
	await archive.setPage({
		url: parseUrl(url)!,
		redirectPaths: [],
		isExternal: false,
		isTarget: true,
		status: 200,
		statusText: 'OK',
		contentType: 'text/html',
		contentLength: 100,
		responseHeaders: {},
		html: '',
		meta: META,
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
}

/**
 * Builds a viewer `ArchiveContext` whose manager resolves straight to the
 * given archive — the cache only calls `context.manager.get(context.archiveId)`
 * once, so a stub `get` is enough.
 * @param archive - The archive the context should resolve to.
 * @param mode - The archive mode to report.
 * @returns A context shape compatible with the cache module's input.
 */
function makeContext(
	archive: InstanceType<typeof Archive>,
	mode: ArchiveContext['mode'] = 'archive',
): ArchiveContext {
	const manager = {
		get: () => archive,
	} as unknown as ArchiveManager;
	return {
		manager,
		archiveId: 'test',
		filePath: archive.tmpDir,
		mode,
		crawlerLockHolder: null,
	};
}

describe('prepareCachedUrlSortTempTable', () => {
	let archive: InstanceType<typeof Archive> | undefined;

	afterEach(async () => {
		if (archive) {
			await archive.close();
			archive = undefined;
		}
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('persists a cache file on first run and replays it on the next call instead of re-sorting', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'cache.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');

		const context = makeContext(archive);
		await prepareCachedUrlSortTempTable(context);

		const cacheFile = path.join(archive.tmpDir, 'precomputed', 'url-sort-ranks.jsonl');
		expect(existsSync(cacheFile)).toBe(true);

		// `listPages` always returns every `pages` row regardless of whether
		// it has a TEMP TABLE rank (rows without one just fall back to
		// alphabetical order), so a page added after caching would still show
		// up there even on a correct cache hit. Assert directly against the
		// TEMP TABLE instead: a page added after the cache file was written
		// must NOT have a ranked row — the only way that's possible is if the
		// second call read from the cache file instead of re-running the
		// external sort against the (now-changed) live `pages` table. Table
		// name matches `@nitpicker/query`'s (unexported) `URL_SORT_TEMP_TABLE`.
		await addPage(archive, 'https://example.com/b-added-after-cache');
		await prepareCachedUrlSortTempTable(context);

		const rankedUrls = await archive.getKnex()('viewer_url_sort_keys').select('url');
		expect(rankedUrls.map((r: { url: string }) => r.url)).toEqual([
			'https://example.com/a',
		]);
	});

	it('bypasses the cache in stub mode, always reflecting the live pages table', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'stub.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');

		const context = makeContext(archive, 'stub');
		await prepareCachedUrlSortTempTable(context);

		const cacheFile = path.join(archive.tmpDir, 'precomputed', 'url-sort-ranks.jsonl');
		expect(existsSync(cacheFile)).toBe(false);

		await addPage(archive, 'https://example.com/b');
		await prepareCachedUrlSortTempTable(context);

		const { items } = await listPages(archive, {});
		expect(items.map((p) => p.url).toSorted()).toEqual([
			'https://example.com/a',
			'https://example.com/b',
		]);
	});

	it('forwards onProgress messages while sorting on a cache miss', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'progress.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');

		const messages: string[] = [];
		await prepareCachedUrlSortTempTable(makeContext(archive), (message) => {
			messages.push(message);
		});

		expect(messages.length).toBeGreaterThan(0);
	});

	it('reports a distinct progress message when replaying from the cache', async () => {
		const { mkdirSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'progress-cached.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');

		const context = makeContext(archive);
		await prepareCachedUrlSortTempTable(context);

		const messages: string[] = [];
		await prepareCachedUrlSortTempTable(context, (message) => {
			messages.push(message);
		});

		expect(messages.some((m) => m.toLowerCase().includes('cache'))).toBe(true);
	});

	it('still builds the TEMP TABLE when the cache write stream fails, and leaves no cache file behind', async () => {
		// chmod-based permission errors are POSIX-specific and don't reproduce
		// reliably on Windows.
		if (process.platform === 'win32') return;
		const { mkdirSync, chmodSync } = await import('node:fs');
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({
			filePath: path.resolve(workingDir, 'write-failure.nitpicker'),
			cwd: workingDir,
		});
		await archive.setConfig(baseConfig());
		await addPage(archive, 'https://example.com/a');

		// Make the cache directory read-only so `createWriteStream` inside
		// `sortAndCache` fails with EACCES — the fail-safe this exercises
		// (see url-sort-cache.ts's `cacheWritable` handling) must still let
		// the TEMP TABLE build succeed from the live sort.
		const precomputedDir = path.join(archive.tmpDir, 'precomputed');
		mkdirSync(precomputedDir, { recursive: true });
		chmodSync(precomputedDir, 0o444);

		try {
			await expect(
				prepareCachedUrlSortTempTable(makeContext(archive)),
			).resolves.not.toThrow();
		} finally {
			chmodSync(precomputedDir, 0o755);
		}

		const rankedUrls = await archive.getKnex()('viewer_url_sort_keys').select('url');
		expect(rankedUrls.map((r: { url: string }) => r.url)).toEqual([
			'https://example.com/a',
		]);
		expect(existsSync(path.join(precomputedDir, 'url-sort-ranks.jsonl'))).toBe(false);
	});
});
