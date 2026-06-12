import type { Database } from './database.js';

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { zip } from '@d-zero/fs/zip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArchiveAccessor } from './archive-accessor.js';
import Archive from './archive.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_archive_accessor__');

/**
 * Wait until the given zip path actually exists on disk.
 *
 * `@d-zero/fs/zip` resolves its returned promise before the underlying
 * write stream necessarily flushes; without this guard a follow-up read
 * sees `ENOENT` even though `zip()` has resolved. Fails the test loudly
 * if the file never materialises so a regression in the upstream
 * library doesn't silently turn into a misleading `getHtmlOfPage`
 * "returned null" failure later in the assertion.
 * @param zipPath
 */
async function waitForZipFlush(zipPath: string): Promise<void> {
	for (let i = 0; i < 50 && !existsSync(zipPath); i++) {
		await new Promise((r) => setTimeout(r, 10));
	}
	if (!existsSync(zipPath)) {
		throw new Error(`Zip did not flush within 500ms: ${zipPath}`);
	}
}

/**
 * `getHtmlOfPage` is the single read path used by both the finished-archive
 * flow (a `.nitpicker` tar that has been extracted into a tmpDir whose
 * `snapshot-html.zip` still needs unzipping) and the stub flow (a live crawl
 * tmpDir whose snapshots are loose files on disk and **no** zip exists).
 *
 * The implementation must therefore tolerate either shape: a loose
 * `snapshot-html/` directory, a `snapshot-html.zip`, or both. The previous
 * implementation called `unzip` unconditionally before falling through to a
 * direct read, which made it reject when only the loose directory existed —
 * the exact stub-mode scenario.
 */
describe('ArchiveAccessor.getHtmlOfPage snapshot resolution order', () => {
	const stubName = 'getHtmlOfPage-test';
	const stubFilePath = path.resolve(workingDir, `${stubName}.nitpicker`);
	let archive: Archive;
	let snapshotDir = '';
	let snapshotZip = '';
	const relHtmlPath = 'snapshot-html/page-1.html';

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });
		archive = await Archive.create({ filePath: stubFilePath, cwd: workingDir });
		snapshotDir = path.join(archive.tmpDir, Archive.SNAPSHOT_HTML_DIR);
		snapshotZip = `${snapshotDir}.zip`;
		mkdirSync(snapshotDir, { recursive: true });
	});

	afterAll(async () => {
		await archive.releaseHandle();
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('snapshot dir のみ存在する場合は直読みする（stub mode と同じ形 — fs mutation を発生させない）', async () => {
		// Stub scenario: loose snapshot-html/, no .zip on disk.
		writeFileSync(path.join(snapshotDir, 'page-1.html'), '<p>loose</p>');
		rmSync(snapshotZip, { force: true });

		const html = await archive.getHtmlOfPage(relHtmlPath);
		expect(html).toBe('<p>loose</p>');
	});

	it('snapshot dir が無く zip だけある場合は writer-mode で展開してから読む', async () => {
		// Archive-just-opened scenario: snapshot-html.zip on disk, dir not yet
		// extracted. The accessor expands the zip in place and reads from the
		// resulting directory.
		const stagingDir = path.resolve(workingDir, 'staging');
		rmSync(snapshotDir, { recursive: true, force: true });
		rmSync(snapshotZip, { force: true });
		mkdirSync(stagingDir, { recursive: true });
		writeFileSync(path.join(stagingDir, 'page-1.html'), '<p>zipped</p>');
		await zip(snapshotZip, stagingDir);
		await waitForZipFlush(snapshotZip);
		rmSync(stagingDir, { recursive: true, force: true });

		const html = await archive.getHtmlOfPage(relHtmlPath);
		expect(html).toBe('<p>zipped</p>');
	});

	it('loose dir に該当ファイルが無くても zip からシングルエントリで読める（中断 Archive.write 残骸の回復経路）', async () => {
		// Regression for the "stale-dir + complete-zip returns null" finding:
		// an interrupted `Archive.write()` can leave a partially-cleared
		// loose `snapshot-html/` directory alongside a complete
		// `snapshot-html.zip`. The new fallback must read missing files
		// from the zip instead of returning null.
		rmSync(snapshotDir, { recursive: true, force: true });
		rmSync(snapshotZip, { force: true });

		// Loose dir exists but does NOT contain page-1.html (only other.html).
		mkdirSync(snapshotDir, { recursive: true });
		writeFileSync(path.join(snapshotDir, 'other.html'), '<p>other</p>');

		// The complete zip contains page-1.html.
		const stagingDir = path.resolve(workingDir, 'staging-fallback');
		mkdirSync(stagingDir, { recursive: true });
		writeFileSync(path.join(stagingDir, 'page-1.html'), '<p>from-zip</p>');
		await zip(snapshotZip, stagingDir);
		await waitForZipFlush(snapshotZip);
		rmSync(stagingDir, { recursive: true, force: true });

		// The cached central directory from the previous test points at the
		// now-replaced zip; invalidate it just as Archive.write() does when it
		// rewrites the zip in production.
		archive.invalidateSnapshotZipCache();

		const html = await archive.getHtmlOfPage(relHtmlPath);
		expect(html).toBe('<p>from-zip</p>');
	});

	it('read-only mode では loose dir 不在でも zip を展開せず単一エントリで読む（user の tmpDir を書き換えない）', async () => {
		// Regression for the "unzip path writes into stub tmpDir" finding:
		// an accessor constructed with `readOnly: true` must NEVER
		// materialise the `snapshot-html/` directory inside the user's
		// tmpDir — that would race the live crawler.
		const isolatedDir = path.resolve(workingDir, 'readonly-isolation');
		mkdirSync(isolatedDir, { recursive: true });
		const isoSnapshotDir = path.join(isolatedDir, Archive.SNAPSHOT_HTML_DIR);
		const isoSnapshotZip = `${isoSnapshotDir}.zip`;

		const staging = path.resolve(workingDir, 'staging-ro');
		mkdirSync(staging, { recursive: true });
		writeFileSync(path.join(staging, 'page-1.html'), '<p>ro</p>');
		await zip(isoSnapshotZip, staging);
		await waitForZipFlush(isoSnapshotZip);
		rmSync(staging, { recursive: true, force: true });

		// Construct an accessor with readOnly=true so it cannot mutate the dir.
		// We build a fake Database that supports just the EventEmitter
		// surface the constructor needs; getHtmlOfPage never touches db.
		const fakeDb = { on: () => {} } as unknown as Database;
		const accessor = new ArchiveAccessor(isolatedDir, fakeDb, null, { readOnly: true });

		expect(existsSync(isoSnapshotDir)).toBe(false);
		const html = await accessor.getHtmlOfPage('snapshot-html/page-1.html');
		expect(html).toBe('<p>ro</p>');
		// The user-visible safety property: the loose directory must NOT
		// have been materialised by the read.
		expect(existsSync(isoSnapshotDir)).toBe(false);
	});

	it('dir も zip も存在しない場合は null を返す（reject ではなく）', async () => {
		// Negative-case regression: the previous implementation rejected on
		// missing zip. The new order returns null cleanly so callers can fall
		// back to "snapshot unavailable" UI.
		rmSync(snapshotDir, { recursive: true, force: true });
		rmSync(snapshotZip, { force: true });

		// Drop any cached central directory for the (now-removed) zip — mirrors
		// the production invariant that the zip is immutable per accessor and
		// is invalidated by Archive.write() whenever it changes.
		archive.invalidateSnapshotZipCache();

		const html = await archive.getHtmlOfPage(relHtmlPath);
		expect(html).toBeNull();
	});
});

/**
 * `close()` must bound its `db.destroy()` wait so a viewer Ctrl-C while a
 * live crawler holds the SQLite write lock can't hang for the underlying
 * pool's `acquireTimeoutMillis` (10 minutes in this repo).
 */
describe('ArchiveAccessor.close timeout safety', () => {
	it('db.destroy がハングしても close は timeoutMs 内に resolve する', async () => {
		// Fake Database whose destroy() never resolves — mimics a knex
		// pool deadlocked on a long-held write lock.
		const fakeDb = {
			on: () => {},
			destroy: () =>
				new Promise<void>(() => {
					/* never resolves */
				}),
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/never', fakeDb);
		const start = Date.now();
		await accessor.close({ timeoutMs: 100 });
		const elapsed = Date.now() - start;
		// Generous upper bound to avoid CI flakes; the wait itself is 100ms
		// so anything close to that (e.g. <500ms) proves the race escaped.
		expect(elapsed).toBeLessThan(500);
	});

	it('同じ accessor への concurrent close は同じ promise を共有する（idempotent + race-free）', async () => {
		let destroyCalls = 0;
		const fakeDb = {
			on: () => {},
			destroy: async () => {
				destroyCalls++;
				await new Promise((r) => setTimeout(r, 20));
			},
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/concurrent', fakeDb);

		// Fire two concurrent closes — they must await the same promise.
		await Promise.all([accessor.close(), accessor.close()]);

		expect(destroyCalls).toBe(1);
	});

	it('db.destroy が reject すると close も reject する（が再試行できないので二度目以降は同じ rejection を返す）', async () => {
		const fakeDb = {
			on: () => {},
			destroy: () => Promise.reject(new Error('boom')),
		} as unknown as Database;
		const accessor = new ArchiveAccessor('/tmp/reject', fakeDb);
		await expect(accessor.close()).rejects.toThrow('boom');
		// Latched: a follow-up close awaits the same rejected promise.
		await expect(accessor.close()).rejects.toThrow('boom');
	});
});
