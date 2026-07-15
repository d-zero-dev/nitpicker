import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	Archive,
	CrawlerOrchestrator,
	populateMigrationTables,
} from '@nitpicker/crawler';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Run a baseline crawl that creates a `.nitpicker` archive on disk, then close
 * it so the caller can re-open it via `Archive.open`. Returns the archive file
 * path and the cwd where the temp dir lives.
 * @param urls - One or more URLs to crawl.
 * @param options - Optional crawl configuration overrides.
 * @returns Paths to the produced archive and its cwd.
 */
async function crawlAndPersist(
	urls: string[],
	options: Record<string, unknown> = {},
): Promise<{ filePath: string; cwd: string }> {
	const cwd = path.join(os.tmpdir(), `nitpicker-append-${crypto.randomUUID()}`);
	await fs.mkdir(cwd, { recursive: true });

	const orchestrator = await CrawlerOrchestrator.crawling(urls, {
		cwd,
		interval: 0,
		parallels: 1,
		image: false,
		...options,
	});
	const filePath = orchestrator.archive.filePath;
	await populateMigrationTables(orchestrator.archive);
	await orchestrator.write();
	await orchestrator.archive.close();
	orchestrator.garbageCollect();

	return { filePath, cwd };
}

describe('Append crawl', () => {
	let filePath: string;
	let cwd: string;
	let accessor: Archive;

	beforeAll(async () => {
		// 1) Baseline archive scoped to /scope/blog/. /scope/docs/ is reached via
		//    a link and therefore recorded as external metadata-only.
		const baseline = await crawlAndPersist(['http://localhost:8010/scope/blog/'], {
			fetchExternal: true,
		});
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// 2) Append /scope/docs/ as a new root. The expanded scope demotes the
		//    previously-external /scope/docs/ and re-crawls it as internal.
		const orchestrator = await CrawlerOrchestrator.append(
			filePath,
			['http://localhost:8010/scope/docs/'],
			{ cwd, fetchExternal: true },
		);
		await populateMigrationTables(orchestrator.archive);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// Re-open for reading.
		accessor = await Archive.open({ filePath, cwd });
	}, 240_000);

	afterAll(async () => {
		await accessor?.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('appended root is recorded as a fully-internal page (not metadata-only)', async () => {
		const internalPages = await accessor.getPages('internal-page');
		const docsPage = internalPages.find((p) => p.url.pathname === '/scope/docs/');
		expect(docsPage).toBeDefined();
		expect(docsPage!.isExternal).toBe(false);
		expect(docsPage!.isTarget).toBe(true);
	});

	it('child pages under the appended root are crawled', async () => {
		const internalPages = await accessor.getPages('internal-page');
		const paths = internalPages.map((p) => p.url.pathname);
		expect(paths).toContain('/scope/docs/api');
	});

	it('info.roots records both the original and the appended root', async () => {
		const config = await accessor.getConfig();
		expect(config.roots).toEqual([
			'http://localhost:8010/scope/blog/',
			'http://localhost:8010/scope/docs/',
		]);
	});

	it('appended pages keep their HTML snapshots after write()', async () => {
		const internalPages = await accessor.getPages('internal-page');
		// 追記クロールで取得されたページのスナップショットが write() で失われていない
		const docsPage = internalPages.find((p) => p.url.pathname === '/scope/docs/');
		expect(docsPage).toBeDefined();
		await expect(docsPage!.getHtml()).resolves.toBeTruthy();
		// 既存（1回目クロール）のスナップショットも維持されている
		const blogPage = internalPages.find((p) => p.url.pathname === '/scope/blog/');
		expect(blogPage).toBeDefined();
		await expect(blogPage!.getHtml()).resolves.toBeTruthy();
	});

	it('removes the .bak backup file once the append succeeds', async () => {
		const exists = await fs
			.stat(filePath + '.bak')
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});
});

describe('Append crawl: restore from .bak on failure', () => {
	let filePath: string;
	let cwd: string;
	let originalArchiveBytes: Buffer;

	beforeAll(async () => {
		const baseline = await crawlAndPersist(['http://localhost:8010/scope/blog/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;
		originalArchiveBytes = await fs.readFile(filePath);
	}, 120_000);

	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('mid-flight error restores the archive from .bak and removes the backup', async () => {
		// Make repromote throw so append fails after the .bak has been created
		// and after updateConfig has mutated the in-tmpDir SQLite.
		const spy = vi
			.spyOn(Archive.prototype, 'repromoteExternalPages')
			.mockRejectedValueOnce(new Error('forced-repromote-failure'));

		await expect(
			CrawlerOrchestrator.append(filePath, ['http://localhost:8010/scope/docs/'], {
				cwd,
			}),
		).rejects.toThrow(/forced-repromote-failure/);
		expect(spy).toHaveBeenCalledOnce();

		// .bak is gone (restore succeeded → backup deleted in the same catch).
		const bakExists = await fs
			.stat(filePath + '.bak')
			.then(() => true)
			.catch(() => false);
		expect(bakExists).toBe(false);

		// The archive bytes equal the pre-append snapshot — nothing leaked.
		const after = await fs.readFile(filePath);
		expect(after.equals(originalArchiveBytes)).toBe(true);

		// The archive lock must have been released on the failure path —
		// otherwise the next consumer cannot open the file.
		const reopened = await Archive.open({ filePath, cwd });
		await reopened.close();

		// And the orphan tmpDir / .lock from the failed append should be gone.
		const cwdEntries = await fs.readdir(cwd);
		const orphans = cwdEntries.filter(
			(name) => name.startsWith('._nitpicker-') || name.endsWith('.lock'),
		);
		// The reopen above creates+cleans its own tmpDir, so anything left
		// belongs to the failed append.
		expect(orphans).toEqual([]);
	}, 120_000);

	it('surfaces AggregateError when restore from .bak also fails', async () => {
		// Two-stage failure: repromote rejects (triggers the restore path),
		// AND the `.bak` is gone by the time the restore runs (so the
		// in-catch `copyFile(backup → original)` raises ENOENT). The factory
		// must surface an AggregateError carrying both errors so the operator
		// knows the original archive may be corrupt.
		//
		// The mock deletes the .bak just before throwing — same effect as a
		// concurrent rm or a disappearing FS without having to mock the
		// statically-imported `copyFile`.
		vi.spyOn(Archive.prototype, 'repromoteExternalPages').mockImplementationOnce(
			async () => {
				await fs.rm(filePath + '.bak', { force: true });
				throw new Error('forced-repromote-failure');
			},
		);

		const thrown = await CrawlerOrchestrator.append(
			filePath,
			['http://localhost:8010/scope/docs/'],
			{ cwd },
		).then(
			() => {
				throw new Error('append unexpectedly resolved');
			},
			(error: unknown) => error,
		);

		expect(thrown).toBeInstanceOf(AggregateError);
		const aggregate = thrown as AggregateError;
		expect(aggregate.errors).toHaveLength(2);
		expect((aggregate.errors[0] as Error).message).toBe('forced-repromote-failure');
		expect((aggregate.errors[1] as NodeJS.ErrnoException).code).toBe('ENOENT');
		expect(aggregate.message).toContain('append failed AND restore from backup failed');
		expect(aggregate.message).toContain(filePath + '.bak');

		// The original archive bytes are still intact even though restore
		// could not run — copyFile failing before the catch's overwrite means
		// the file was never touched after the initial open.
		const after = await fs.readFile(filePath);
		expect(after.equals(originalArchiveBytes)).toBe(true);
	}, 120_000);
});

describe('Append crawl: list-mode rejection', () => {
	let filePath: string;
	let cwd: string;

	beforeAll(async () => {
		const baseline = await crawlAndPersist(['http://localhost:8010/scope/blog/']);
		filePath = baseline.filePath;
		cwd = baseline.cwd;

		// Mark the archive as list-mode via direct config update. `Archive.close`
		// won't re-write the .nitpicker tar when one already exists on disk, so
		// `write()` is required for the fromList=true change to be visible to
		// `Archive.open` in the next step.
		const archive = await Archive.open({ filePath, cwd });
		await archive.updateConfig({ fromList: true });
		await populateMigrationTables(archive);
		await archive.write();
		await archive.close();
	}, 120_000);

	afterAll(async () => {
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('throws a helpful error when appending to a list-mode archive', async () => {
		await expect(
			CrawlerOrchestrator.append(filePath, ['http://localhost:8010/scope/docs/'], {
				cwd,
			}),
		).rejects.toThrow(
			'Cannot append to a list-mode archive: this archive was created with --list/--list-file and contains metadata-only pages. Create a fresh archive instead.',
		);
	}, 120_000);
});
