import { existsSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArchiveManager } from './archive-manager.js';
import { hasViewerReadModel } from './viewer-read-model/has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_archive_manager_cache__');
const cacheRoot = path.resolve(os.tmpdir(), `nitpicker-cache-test-${process.pid}`);

// Force-enable the cache for this file (the sibling
// `archive-manager.spec.ts` disables it to keep the legacy writer-path
// assertions intact). Pointing the cache at a per-pid scratch root
// keeps repeated test runs from leaking entries into the user's real
// OS-temp cache and lets us assert on cache-dir survival explicitly.
delete process.env.NITPICKER_DISABLE_TAR_CACHE;
process.env.NITPICKER_TAR_CACHE_DIR = cacheRoot;

describe('ArchiveManager cache-mode (archive opens go through Archive.openCached)', () => {
	const archiveFilePath = path.resolve(workingDir, 'cache-mode.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		rmSync(cacheRoot, { recursive: true, force: true });

		// Smallest viable archive: a single page + a write. The cache
		// doesn't care what's inside, only that there's a real
		// `db.sqlite` to land in the cache dir.
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'cache-mode-test',
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
			html: '<html><head><title>cache</title></head></html>',
			meta: {
				lang: 'ja',
				title: 'cache',
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
		await archive.close();
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
		rmSync(cacheRoot, { recursive: true, force: true });
	});

	it('opens the archive successfully via the cache path and exposes a readable accessor', async () => {
		const manager = new ArchiveManager();
		const { accessor, archive, mode } = await manager.open(archiveFilePath);

		// The cache path returns an `ArchiveAccessor` only; the writer-
		// path `Archive` instance is intentionally absent. The viewer /
		// MCP / query CLI only ever need the accessor — a writer handle
		// here would invite accidental finalisation of a shared cache dir.
		expect(archive).toBeUndefined();
		expect(mode).toBe('archive');

		const config = await accessor.getConfig();
		expect(config.baseUrl).toBe('https://example.com');

		await manager.closeAll();
	});

	it('keeps the cache directory alive after close so the next reader can skip the untar', async () => {
		// The cache's core contract: closing a viewer must NOT discard
		// the extracted state, so the next viewer open is instant.
		const manager = new ArchiveManager();
		const { accessor } = await manager.open(archiveFilePath);
		const cacheDir = accessor.tmpDir;

		// Sanity: the cache dir lives under our scratch root, not under
		// the working dir where `Archive.open` would have placed it.
		expect(cacheDir.startsWith(cacheRoot)).toBe(true);
		expect(existsSync(cacheDir)).toBe(true);

		await manager.closeAll();

		expect(existsSync(cacheDir)).toBe(true);
	});

	it('three concurrent opens on the same archive share a single cache entry (no duplicate accessors leaked)', async () => {
		// `ArchiveManager.#openInflight` exists specifically so two
		// callers arriving on the same path during a cold extraction
		// don't both spawn their own `Archive.openCached` work. The race
		// without that guard leaks accessors: the second `pathToEntry.set`
		// overwrites the first, the first caller's DB handle is never
		// closed by `close(id)` lookups, and fd usage grows over time.
		const manager = new ArchiveManager();
		const [r1, r2, r3] = await Promise.all([
			manager.open(archiveFilePath),
			manager.open(archiveFilePath),
			manager.open(archiveFilePath),
		]);

		// All three callers see the SAME accessor instance — there is
		// only one underlying DB connection in flight.
		expect(r1.accessor).toBe(r2.accessor);
		expect(r2.accessor).toBe(r3.accessor);

		// But they each got their own archive id, so each must call
		// close() individually and the refCount reaches zero only after
		// all three.
		expect(new Set([r1.archiveId, r2.archiveId, r3.archiveId]).size).toBe(3);

		await manager.close(r1.archiveId);
		await manager.close(r2.archiveId);
		// After closing 2 of 3, the manager must still resolve the third
		// id — proves refCount tracked all three opens, not just the
		// most recent one that landed in #pathToEntry.
		expect(manager.has(r3.archiveId)).toBe(true);
		await manager.close(r3.archiveId);
	});

	it('reopens the same archive without re-extracting (cache hit reuses the same tmpDir)', async () => {
		const manager1 = new ArchiveManager();
		const { accessor: a1 } = await manager1.open(archiveFilePath);
		const cacheDir1 = a1.tmpDir;
		await manager1.closeAll();

		const manager2 = new ArchiveManager();
		const { accessor: a2 } = await manager2.open(archiveFilePath);
		const cacheDir2 = a2.tmpDir;
		await manager2.closeAll();

		// Identical key (size + mtime + ctime unchanged) → identical
		// cache directory → no second untar happened.
		expect(cacheDir2).toBe(cacheDir1);
	});
});

describe('ArchiveManager cache-mode: a read-only open never builds a viewer read model (issue #177)', () => {
	// A separate archive (not the shared `archiveFilePath` above) so these
	// assertions aren't racing an earlier test in this file that already
	// opened the shared fixture's cache directory.
	const archiveFilePath = path.resolve(workingDir, 'on-open-build.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		// Written the way `crawl` produced archives before the read model
		// existed at all: no `ensureViewerReadModel` call, so the persistent
		// read model is absent — the legacy-archive case a read-only open
		// must leave untouched.
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		// `buildViewerReadModel` also computes a `getSummary` snapshot, which
		// requires `accessor.getConfig()` to resolve.
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'on-open-build-test',
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
			html: '<html></html>',
			meta: { title: 'on-open-build' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		await archive.write();
		await archive.close();
	});

	afterAll(() => {
		rmSync(archiveFilePath, { force: true });
	});

	it('leaves the read model absent on first open of a legacy archive (no on-open build)', async () => {
		const manager = new ArchiveManager();
		const { accessor } = await manager.open(archiveFilePath);
		try {
			expect(await hasViewerReadModel(accessor)).toBe(false);
		} finally {
			await manager.closeAll();
		}
	});

	it('still has no read model on a subsequent open (no retry, no auto-build ever happens)', async () => {
		const manager = new ArchiveManager();
		const { accessor } = await manager.open(archiveFilePath);
		try {
			expect(await hasViewerReadModel(accessor)).toBe(false);
		} finally {
			await manager.closeAll();
		}
	});
});
