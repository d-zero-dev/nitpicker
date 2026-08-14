import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Archive from '../archive.js';

import { computeArchiveCacheKey } from './compute-archive-cache-key.js';
import { extractArchiveToCache } from './extract-archive-to-cache.js';

// Process-scoped scratch root: vitest's `forks` pool runs spec files in
// parallel workers, and an unsuffixed name would let two workers collide
// on the same `beforeEach` rm/mkdir.
const baseDir = path.resolve(os.tmpdir(), `nitpicker-extract-cache-test-${process.pid}`);

beforeEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
	await fs.mkdir(baseDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(baseDir, { recursive: true, force: true });
});

/**
 * Build a minimal `.nitpicker` archive at `archivePath` via the real
 * crawler path. The cache machinery validates that `db.sqlite` is a
 * usable SQLite file and runs migrations on it, so this spec cannot use
 * fake byte blobs — only an archive produced by `Archive.create` ->
 * `setPage` -> `write` exercises the same shape that production reads.
 * @param archivePath - Absolute output path for the `.nitpicker` file.
 * @param title - Title baked into the single seeded page; lets tests
 *   tell two otherwise-identical archives apart.
 */
async function buildFakeArchive(archivePath: string, title = 'fixture'): Promise<void> {
	const cwd = path.join(baseDir, `staging-${path.basename(archivePath)}-${Date.now()}`);
	await fs.mkdir(cwd, { recursive: true });
	await using archive = await Archive.create({ filePath: archivePath, cwd });
	await archive.setConfig({
		baseUrl: 'https://example.com',
		name: title,
		version: '0.13.0',
		recursive: true,
		interval: 0,
		image: true,
		fetchExternal: false,
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
	});
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
		html: `<html><head><title>${title}</title></head></html>`,
		meta: {
			lang: 'ja',
			title,
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
		},
		anchorList: [],
		imageList: [],
		isSkipped: false,
	});
	await archive.write();
}

describe('extractArchiveToCache', () => {
	it('extracts a fresh archive into cacheDir on a cold miss so a subsequent open hits the cache', async () => {
		const archivePath = path.join(baseDir, 'a.nitpicker');
		await buildFakeArchive(archivePath, 'a');
		const cacheRoot = path.join(baseDir, 'cache');
		const cacheKey = await computeArchiveCacheKey(archivePath);
		const cacheDir = path.join(cacheRoot, `${cacheKey}-a`);

		await extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey);

		// db.sqlite must land at cacheDir — that's what `Archive.connect`
		// later reads. Asserting through observable filesystem state
		// rather than an exported ready-marker constant keeps the marker
		// an internal implementation detail.
		await expect(fs.access(path.join(cacheDir, 'db.sqlite'))).resolves.toBeUndefined();
	});

	it('short-circuits when the cache is already populated (cache hit skips untar entirely)', async () => {
		const archivePath = path.join(baseDir, 'b.nitpicker');
		await buildFakeArchive(archivePath, 'original');
		const cacheRoot = path.join(baseDir, 'cache');
		const cacheKey = await computeArchiveCacheKey(archivePath);
		const cacheDir = path.join(cacheRoot, `${cacheKey}-b`);

		await extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey);
		const sentinelPath = path.join(cacheDir, 'cache-was-not-re-extracted.txt');
		await fs.writeFile(sentinelPath, 'cache survives second open');

		// Rewriting the archive without rolling the cache key would not
		// happen in production (the key rolls with mtime), but we don't
		// need to rewrite the archive here — we just need to confirm the
		// second call to `extractArchiveToCache` did NOT re-extract.
		// The sentinel survives iff the second call short-circuited.
		await extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey);

		await expect(fs.readFile(sentinelPath, 'utf8')).resolves.toBe(
			'cache survives second open',
		);
	});

	it('two archives sharing the same inner directory name extract into separate cacheDirs without colliding', async () => {
		// Both archives go through `Archive.create` with the same `cwd`,
		// so the tar inner-dir names look similar. Staging is per-cacheDir
		// (`${cacheDir}.staging/`), so the two cold misses must not stomp
		// on each other even when run concurrently.
		const archiveX = path.join(baseDir, 'shared-name.nitpicker');
		const archiveY = path.join(baseDir, 'shared-name-copy.nitpicker');
		await buildFakeArchive(archiveX, 'X');
		await fs.copyFile(archiveX, archiveY);
		// Force the two files to have different cache keys: touch Y with
		// a future mtime so its stat differs.
		const future = new Date(Date.now() + 60_000);
		await fs.utimes(archiveY, future, future);

		const cacheRoot = path.join(baseDir, 'cache');
		const keyX = await computeArchiveCacheKey(archiveX);
		const keyY = await computeArchiveCacheKey(archiveY);
		expect(keyX).not.toBe(keyY);
		const cacheDirX = path.join(cacheRoot, `${keyX}-x`);
		const cacheDirY = path.join(cacheRoot, `${keyY}-y`);

		await Promise.all([
			extractArchiveToCache(archiveX, cacheRoot, cacheDirX, keyX),
			extractArchiveToCache(archiveY, cacheRoot, cacheDirY, keyY),
		]);

		// Both cacheDirs survived end-to-end. Without per-cacheDir
		// staging this would race on `cacheRoot/<innerDirName>/` and one
		// of the renames would fail.
		await expect(fs.access(path.join(cacheDirX, 'db.sqlite'))).resolves.toBeUndefined();
		await expect(fs.access(path.join(cacheDirY, 'db.sqlite'))).resolves.toBeUndefined();
	});

	it('three same-process concurrent extracts on the same cacheDir dedupe to a single landing', async () => {
		const archivePath = path.join(baseDir, 'd.nitpicker');
		await buildFakeArchive(archivePath, 'concurrent');
		const cacheRoot = path.join(baseDir, 'cache');
		const cacheKey = await computeArchiveCacheKey(archivePath);
		const cacheDir = path.join(cacheRoot, `${cacheKey}-d`);

		// In-process Map dedup + file lock + rename are what protect
		// against three callers stomping on each other.
		await Promise.all([
			extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey),
			extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey),
			extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey),
		]);

		await expect(fs.access(path.join(cacheDir, 'db.sqlite'))).resolves.toBeUndefined();
	});

	it('quarantines a half-populated cacheDir (no ready marker) instead of rm-in-place, so a live reader is not yanked', async () => {
		// Production scenario: a previous extractor crashed between
		// rename and marker-write, OR an outside process partially
		// deleted the marker. Either way the cacheDir holds files but
		// is not "ready". The next extractor must NOT just `fs.rm` it
		// in place — that would yank files out from under any reader
		// still holding fds on db.sqlite (cache layer is intentionally
		// not refcount-aware of readers).
		const archivePath = path.join(baseDir, 'q.nitpicker');
		await buildFakeArchive(archivePath, 'quarantine');
		const cacheRoot = path.join(baseDir, 'cache');
		const cacheKey = await computeArchiveCacheKey(archivePath);
		const cacheDir = path.join(cacheRoot, `${cacheKey}-q`);

		// First extraction lands cleanly.
		await extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey);
		// Simulate a partial crash: marker gone but other files intact.
		await fs.rm(path.join(cacheDir, '.nitpicker-cache-ready'), { force: true });
		await fs.writeFile(
			path.join(cacheDir, 'reader-was-here.txt'),
			'reader holds an fd in spirit',
		);

		await extractArchiveToCache(archivePath, cacheRoot, cacheDir, cacheKey);

		// Marker is back, cacheDir is re-extracted clean (the sentinel
		// file from the simulated old reader is gone from THIS dir).
		await expect(fs.access(path.join(cacheDir, 'db.sqlite'))).resolves.toBeUndefined();
		await expect(fs.access(path.join(cacheDir, 'reader-was-here.txt'))).rejects.toThrow();

		// The old contents should have been renamed aside with a
		// `.corrupt.<pid>.<n>` suffix, not deleted outright. Find one.
		const cacheRootEntries = await fs.readdir(cacheRoot);
		const quarantineDir = cacheRootEntries.find((name) => name.includes('.corrupt.'));
		expect(quarantineDir).toBeDefined();
	});

	it('refuses to land a stale extraction when the archive changes mid-extract (post-extract key recheck)', async () => {
		// Pre-extraction key K1 → untar → rewrite archive in place (key
		// rolls to K2) → post-extraction key recompute fires. The
		// cacheKey-passed-in matches K1 but the file is now K2, so the
		// function rejects rather than landing misattributed contents.
		const archivePath = path.join(baseDir, 'e.nitpicker');
		await buildFakeArchive(archivePath, 'before');
		const cacheRoot = path.join(baseDir, 'cache');
		const oldKey = await computeArchiveCacheKey(archivePath);
		const cacheDir = path.join(cacheRoot, `${oldKey}-e`);

		// Mutate the file so its actual key no longer matches the key we
		// claim to be extracting under. The new content can be anything —
		// the recheck only compares stat-derived keys, not contents.
		await new Promise((resolve) => setTimeout(resolve, 20));
		await buildFakeArchive(archivePath, 'after-mutation');

		await expect(
			extractArchiveToCache(archivePath, cacheRoot, cacheDir, oldKey),
		).rejects.toThrow(/changed during cache extraction/);
		// The cacheDir must not exist — partial extracts under the wrong
		// key cannot be left around to be picked up as "ready".
		await expect(fs.access(cacheDir)).rejects.toThrow();
	});
});
