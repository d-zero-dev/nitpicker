import type { ArchiveAccessor } from '@nitpicker/crawler';

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureViewerReadModelOpportunistically } from './ensure-viewer-read-model-opportunistically.js';
import { hasViewerReadModel } from './has-viewer-read-model.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(
	__dirname,
	'__test_fixtures_ensure_viewer_read_model_opportunistically__',
);

describe('ensureViewerReadModelOpportunistically', () => {
	let archive: InstanceType<typeof Archive>;
	const archiveFilePath = path.resolve(workingDir, 'opportunistic-test.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
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
			meta: { title: 'Home' },
			anchorList: [],
			imageList: [],
			isSkipped: false,
		});
		// Emulates `Archive.openCached`'s eventual state: the extraction is
		// fully migrated, but nothing has built the viewer read model yet.
		await archive.releaseHandle();
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('builds the read model into a read-only accessor tmpDir, visible afterwards', async () => {
		const readOnlyAccessor = await Archive.connect(archive.tmpDir);
		try {
			expect(await hasViewerReadModel(readOnlyAccessor)).toBe(false);

			const warnings: string[] = [];
			await ensureViewerReadModelOpportunistically(readOnlyAccessor, {
				onWarn: (message) => warnings.push(message),
			});

			expect(warnings).toHaveLength(0);
			expect(await hasViewerReadModel(readOnlyAccessor)).toBe(true);
		} finally {
			await readOnlyAccessor.close();
		}
	});

	it('reports progress via onProgress when a build actually runs', async () => {
		// The previous test already built the read model once; force a
		// rebuild by staling the schema version directly on the tmpDir, the
		// same way ensure-viewer-read-model.spec.ts does.
		const setup = await Archive.connect(archive.tmpDir, null, { readOnly: false });
		await setup.getKnex()('viewer_read_model_meta').where('id', 1).update({
			schema_version: 0,
		});
		await setup.close();

		const readOnlyAccessor = await Archive.connect(archive.tmpDir);
		try {
			const progressCalls: unknown[] = [];
			await ensureViewerReadModelOpportunistically(readOnlyAccessor, {
				onProgress: (p) => progressCalls.push(p),
			});
			expect(progressCalls.length).toBeGreaterThan(0);
		} finally {
			await readOnlyAccessor.close();
		}
	});

	it('skips the build and warns when another process already holds the lock', async () => {
		const readOnlyAccessor = await Archive.connect(archive.tmpDir);
		const lockPath = path.resolve(archive.tmpDir, '.viewer-read-model.lock');
		await fs.mkdir(lockPath, { recursive: false });
		await fs.writeFile(path.join(lockPath, 'pid.txt'), String(process.pid), 'utf8');
		try {
			const warnings: string[] = [];
			await expect(
				ensureViewerReadModelOpportunistically(readOnlyAccessor, {
					onWarn: (message) => warnings.push(message),
				}),
			).resolves.toBeUndefined();
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toMatch(/already in progress/i);
		} finally {
			await fs.rm(lockPath, { recursive: true, force: true });
			await readOnlyAccessor.close();
		}
	});

	it('warns (generic message, not the lock-contention one) when acquireArchiveLock fails for a reason other than an active holder', async () => {
		// Distinct from the "another process already holds the lock" test
		// above: here `tmpDir` itself doesn't exist, so
		// `acquireArchiveLock`'s `fs.mkdir(lockPath)` fails with a plain
		// ENOENT (missing parent), not `EEXIST` — the codepath never
		// becomes an `ArchiveLockError`, so it must fall through to the
		// generic "could not acquire the lock" warning branch instead of
		// the "already in progress elsewhere" one.
		const missingDir = path.resolve(workingDir, '__does_not_exist__');
		const fakeAccessor = { tmpDir: missingDir } as unknown as ArchiveAccessor;

		const warnings: string[] = [];
		await expect(
			ensureViewerReadModelOpportunistically(fakeAccessor, {
				onWarn: (message) => warnings.push(message),
			}),
		).resolves.toBeUndefined();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/could not acquire/i);
		expect(warnings[0]).not.toMatch(/already in progress/i);
	});

	it('warns and does not create a phantom archive when the tar-cache dir vanishes before the writable reconnect', async () => {
		// Simulates OS temp cleanup (or a concurrent extractArchiveToCache
		// re-extraction quarantining the dir) removing just `db.sqlite`
		// (the directory itself survives, so the lock — a sibling
		// `.viewer-read-model.lock` dir nested under it — can still be
		// acquired) between Archive.openCached returning and this
		// function's writable reconnect. Archive.connect's writable mode
		// has no TOCTOU guard of its own, so without this function's own
		// existence check it would silently `mkdir` + re-init a fresh empty
		// schema here instead of surfacing the missing db (see this
		// function's JSDoc).
		const vanishedDbDir = path.resolve(workingDir, '__vanished_db_dir__');
		mkdirSync(vanishedDbDir, { recursive: true });
		const fakeAccessor = { tmpDir: vanishedDbDir } as unknown as ArchiveAccessor;

		const warnings: string[] = [];
		await expect(
			ensureViewerReadModelOpportunistically(fakeAccessor, {
				onWarn: (message) => warnings.push(message),
			}),
		).resolves.toBeUndefined();

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/build failed/i);
		expect(warnings[0]).toMatch(/vanished/i);
		expect(existsSync(path.join(vanishedDbDir, 'db.sqlite'))).toBe(false);
	});

	it('warns and resolves without throwing when the build itself fails', async () => {
		const badDir = path.resolve(workingDir, '__corrupt_db__');
		mkdirSync(badDir, { recursive: true });
		writeFileSync(path.join(badDir, 'db.sqlite'), 'not a real sqlite file');
		const fakeAccessor = { tmpDir: badDir } as unknown as ArchiveAccessor;

		const warnings: string[] = [];
		await expect(
			ensureViewerReadModelOpportunistically(fakeAccessor, {
				onWarn: (message) => warnings.push(message),
			}),
		).resolves.toBeUndefined();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/build failed/i);
	});
});
