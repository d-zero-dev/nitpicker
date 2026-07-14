import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { populateMigrationTables, Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ArchiveManager } from './archive-manager.js';

// These tests were written against the historical writer path
// (`Archive.open` → tmpDir owned by manager → cleanup on close). The
// new default opens archives through the tar cache (read-only, cache
// directory persisted across opens), so the cleanup / refCount /
// failure-cleanup assertions only make sense with the cache disabled.
// Cache-path coverage lives in `archive-manager-cache.spec.ts`.
//
// Setting the env at module top + restoring in a top-level afterAll
// (rather than letting it leak across spec files) prevents adjacent
// specs that DO want the cache enabled from picking up a stale value
// when vitest reuses a worker for the next file.
const ORIGINAL_DISABLE_TAR_CACHE = process.env.NITPICKER_DISABLE_TAR_CACHE;
process.env.NITPICKER_DISABLE_TAR_CACHE = '1';
afterAll(() => {
	if (ORIGINAL_DISABLE_TAR_CACHE === undefined) {
		delete process.env.NITPICKER_DISABLE_TAR_CACHE;
	} else {
		process.env.NITPICKER_DISABLE_TAR_CACHE = ORIGINAL_DISABLE_TAR_CACHE;
	}
});

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__test_fixtures_archive_manager__');

describe('ArchiveManager', () => {
	const archiveFilePath = path.resolve(workingDir, 'manager-test.nitpicker');

	beforeAll(async () => {
		mkdirSync(workingDir, { recursive: true });

		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'test',
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
			html: '<html><head><title>Test</title></head></html>',
			meta: {
				lang: 'ja',
				title: 'Test',
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
		await populateMigrationTables(archive);
	});

	afterAll(() => {
		rmSync(workingDir, { recursive: true, force: true });
	});

	it('open でアーカイブを開ける', async () => {
		const manager = new ArchiveManager();
		const { archiveId, accessor } = await manager.open(archiveFilePath);
		expect(archiveId).toMatch(/^archive_\d+$/);
		expect(accessor).toBeDefined();
		const config = await accessor.getConfig();
		expect(config.baseUrl).toBe('https://example.com');
		await manager.closeAll();
	});

	it('get で開いたアーカイブを取得できる', async () => {
		const manager = new ArchiveManager();
		const { archiveId } = await manager.open(archiveFilePath);
		const accessor = manager.get(archiveId);
		expect(accessor).toBeDefined();
		await manager.closeAll();
	});

	it('has で存在確認できる', async () => {
		const manager = new ArchiveManager();
		const { archiveId } = await manager.open(archiveFilePath);
		expect(manager.has(archiveId)).toBe(true);
		expect(manager.has('nonexistent')).toBe(false);
		await manager.closeAll();
	});

	it('get で存在しない ID はエラーになる', () => {
		const manager = new ArchiveManager();
		expect(() => manager.get('nonexistent')).toThrow('Archive not found: nonexistent');
	});

	it('close でアーカイブを閉じる', async () => {
		const manager = new ArchiveManager();
		const { archiveId } = await manager.open(archiveFilePath);
		expect(manager.has(archiveId)).toBe(true);
		await manager.close(archiveId);
		expect(manager.has(archiveId)).toBe(false);
	});

	it('close で存在しない ID はエラーになる', async () => {
		const manager = new ArchiveManager();
		await expect(manager.close('nonexistent')).rejects.toThrow(
			'Archive not found: nonexistent',
		);
	});

	it('closeAll で全アーカイブを閉じる', async () => {
		const manager = new ArchiveManager();
		const { archiveId: id1 } = await manager.open(archiveFilePath);
		const { archiveId: id2 } = await manager.open(archiveFilePath);
		expect(manager.has(id1)).toBe(true);
		expect(manager.has(id2)).toBe(true);
		await manager.closeAll();
		expect(manager.has(id1)).toBe(false);
		expect(manager.has(id2)).toBe(false);
	});

	it('close 後に get するとエラーになる', async () => {
		const manager = new ArchiveManager();
		const { archiveId } = await manager.open(archiveFilePath);
		await manager.close(archiveId);
		expect(() => manager.get(archiveId)).toThrow('Archive not found');
	});

	it('close で tmpDir がクリーンアップされる', async () => {
		const manager = new ArchiveManager();
		const result = await manager.open(archiveFilePath);
		expect(result.archive).toBeDefined();
		const tmpDir = result.archive!.tmpDir;
		expect(existsSync(tmpDir)).toBe(true);
		await manager.closeAll();
		expect(existsSync(tmpDir)).toBe(false);
	});

	it('連続した ID が生成される', async () => {
		const manager = new ArchiveManager();
		const { archiveId: id1 } = await manager.open(archiveFilePath);
		const { archiveId: id2 } = await manager.open(archiveFilePath);
		expect(id1).toBe('archive_1');
		expect(id2).toBe('archive_2');
		await manager.closeAll();
	});

	it('同じファイルを2回開くと同じ accessor を再利用する', async () => {
		const manager = new ArchiveManager();
		const first = await manager.open(archiveFilePath);
		const second = await manager.open(archiveFilePath);
		expect(first.archiveId).not.toBe(second.archiveId);
		expect(first.accessor).toBe(second.accessor);
		expect(second.archive).toBeUndefined();
		await manager.closeAll();
	});

	it('参照カウント: 片方を close しても他方は使える', async () => {
		const manager = new ArchiveManager();
		const first = await manager.open(archiveFilePath);
		expect(first.archive).toBeDefined();
		const tmpDir = first.archive!.tmpDir;
		const { archiveId: id2 } = await manager.open(archiveFilePath);
		await manager.close(first.archiveId);
		expect(manager.has(first.archiveId)).toBe(false);
		expect(manager.has(id2)).toBe(true);
		expect(existsSync(tmpDir)).toBe(true);
		const accessor = manager.get(id2);
		const config = await accessor.getConfig();
		expect(config.baseUrl).toBe('https://example.com');
		await manager.close(id2);
	});

	it('参照カウント: 全参照を close すると tmpDir がクリーンアップされる', async () => {
		const manager = new ArchiveManager();
		const first = await manager.open(archiveFilePath);
		expect(first.archive).toBeDefined();
		const tmpDir = first.archive!.tmpDir;
		await manager.open(archiveFilePath);
		expect(existsSync(tmpDir)).toBe(true);
		await manager.closeAll();
		expect(existsSync(tmpDir)).toBe(false);
	});

	it('.nitpicker 以外の拡張子を持つファイルはエラーになる', async () => {
		const manager = new ArchiveManager();
		const tarFile = path.resolve(workingDir, 'wrong-extension.tar');
		writeFileSync(tarFile, 'not an archive');
		try {
			await expect(manager.open(tarFile)).rejects.toThrow(
				'Only .nitpicker archive files or stub directories',
			);
		} finally {
			rmSync(tarFile, { force: true });
		}
	});

	it('存在しないパスはエラーになる', async () => {
		const manager = new ArchiveManager();
		await expect(manager.open('/tmp/nonexistent.nitpicker')).rejects.toThrow(
			'Archive path not found or not readable.',
		);
	});

	it('db.sqlite を含まないディレクトリはエラーになる', async () => {
		const manager = new ArchiveManager();
		const emptyDir = path.resolve(workingDir, 'empty-dir');
		mkdirSync(emptyDir, { recursive: true });
		try {
			await expect(manager.open(emptyDir)).rejects.toThrow(
				'does not look like a Nitpicker stub',
			);
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});

	it('シンボリックリンク経由で非 .nitpicker ファイルを指す場合はエラーになる', async () => {
		const manager = new ArchiveManager();
		const targetFile = path.resolve(workingDir, 'fake-target.txt');
		const symlinkFile = path.resolve(workingDir, 'link.nitpicker');
		writeFileSync(targetFile, 'not an archive');
		rmSync(symlinkFile, { force: true });
		symlinkSync(targetFile, symlinkFile);
		try {
			await expect(manager.open(symlinkFile)).rejects.toThrow(
				'Only .nitpicker archive files or stub directories',
			);
		} finally {
			rmSync(symlinkFile, { force: true });
			rmSync(targetFile, { force: true });
		}
	});

	it('`.nitpicker` 拡張子の symlink が stub ディレクトリを指す場合はエラーになる', async () => {
		// Regression for the symlink misclassification finding:
		// `current.nitpicker -> ._nitpicker-foo/` resolved to mode='stub'
		// in the original implementation, silently bypassing
		// `openPluginData: true` extraction. The classifier now honours
		// the user's stated intent (file extension) and refuses the
		// classification mismatch with a clear error.
		const manager = new ArchiveManager();
		const stubLikeDir = path.resolve(workingDir, '._nitpicker-mismatch');
		const symlinkFile = path.resolve(workingDir, 'mismatch.nitpicker');
		mkdirSync(stubLikeDir, { recursive: true });
		writeFileSync(path.join(stubLikeDir, 'db.sqlite'), '');
		rmSync(symlinkFile, { force: true });
		symlinkSync(stubLikeDir, symlinkFile);
		try {
			await expect(manager.open(symlinkFile)).rejects.toThrow(
				/looks like a \.nitpicker archive file but resolves to a directory/,
			);
		} finally {
			rmSync(symlinkFile, { force: true });
			rmSync(stubLikeDir, { recursive: true, force: true });
		}
	});

	it('同じファイルの再オープンはユニークファイル数の上限にカウントされない', async () => {
		const manager = new ArchiveManager();
		// Same file opened multiple times shares a single entry
		for (let i = 0; i < 25; i++) {
			await manager.open(archiveFilePath);
		}
		// Only 1 unique file is open, so the limit (20 unique files) is not reached
		expect(manager.has('archive_1')).toBe(true);
		await manager.closeAll();
	});
});

describe('ArchiveManager stub mode', () => {
	const stubWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_archive_manager_stub__',
	);
	const stubArchiveName = 'stub-test';
	const stubArchiveFilePath = path.resolve(
		stubWorkingDir,
		`${stubArchiveName}.nitpicker`,
	);
	let stubTmpDir = '';

	beforeAll(async () => {
		mkdirSync(stubWorkingDir, { recursive: true });

		// Create an archive and **leave it as a tmpDir** — do NOT call write()
		// or close(). This mirrors the state of an interrupted crawl.
		const archive = await Archive.create({
			filePath: stubArchiveFilePath,
			cwd: stubWorkingDir,
		});
		stubTmpDir = archive.tmpDir;

		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: stubArchiveName,
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
			html: '<html><head><title>Stub</title></head></html>',
			meta: {
				lang: 'ja',
				title: 'Stub',
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
		// Release the SQLite handle + the .lock sibling WITHOUT writing the
		// archive or removing the tmpDir — `releaseHandle` is precisely
		// the exit hatch for fixture-style usage where we want the tmpDir
		// to live on as a "stub" but must not leak the knex pool across
		// tests (which would race afterAll's rmSync and accumulate
		// open fds on slow CI workers).
		await archive.releaseHandle();
	});

	afterAll(() => {
		rmSync(stubWorkingDir, { recursive: true, force: true });
	});

	it('stub ディレクトリを開くと mode=stub を返し、accessor から baseUrl を読める', async () => {
		const manager = new ArchiveManager();
		const { mode, accessor } = await manager.open(stubTmpDir);
		expect(mode).toBe('stub');
		const config = await accessor.getConfig();
		expect(config.baseUrl).toBe('https://example.com');
		await manager.closeAll();
	});

	it('stub mode の close で tmpDir が残存する（書き戻しも削除も走らない）', async () => {
		const manager = new ArchiveManager();
		expect(existsSync(stubTmpDir)).toBe(true);
		expect(existsSync(stubArchiveFilePath)).toBe(false);
		const { archiveId } = await manager.open(stubTmpDir);
		await manager.close(archiveId);
		// The two safety invariants of stub-mode lifecycle:
		expect(existsSync(stubTmpDir)).toBe(true);
		expect(existsSync(stubArchiveFilePath)).toBe(false);
	});

	it('stub mode で同じ tmpDir を二重に開くと entry を共有する', async () => {
		const manager = new ArchiveManager();
		const first = await manager.open(stubTmpDir);
		const second = await manager.open(stubTmpDir);
		expect(first.accessor).toBe(second.accessor);
		expect(first.mode).toBe('stub');
		expect(second.mode).toBe('stub');
		await manager.closeAll();
		expect(existsSync(stubTmpDir)).toBe(true);
	});

	it('ファイルから開いた archive は mode=archive を返す', async () => {
		// Sanity check that the mode is correctly distinguished from stub.
		// Re-use the top-level fixture by creating a finished archive here.
		const tmpFinishedDir = path.resolve(stubWorkingDir, 'finished-fixture');
		mkdirSync(tmpFinishedDir, { recursive: true });
		const finishedFilePath = path.resolve(tmpFinishedDir, 'finished.nitpicker');
		const archive = await Archive.create({
			filePath: finishedFilePath,
			cwd: tmpFinishedDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'finished',
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
		await archive.write();
		await archive.close();

		const manager = new ArchiveManager();
		const { mode } = await manager.open(finishedFilePath);
		expect(mode).toBe('archive');
		await manager.closeAll();
	});

	it('stub mode で開いた accessor は readOnly フラグが立つ（migration 防止経路）', async () => {
		// Regression hook for the migrateInfoRoots finding: the writer-side
		// schema migration is gated on `accessor.readOnly === false`, so
		// as long as Archive.connect reliably sets the flag, the DB-layer
		// migration is skipped against the user's tmpDir. (Since #75 HTML
		// reads are pure SELECTs and no longer touch the filesystem, so
		// they need no equivalent guard.)
		const manager = new ArchiveManager();
		const { accessor } = await manager.open(stubTmpDir);
		expect(accessor.readOnly).toBe(true);
		await manager.closeAll();
	});

	it('Archive.connect: 親ディレクトリが存在しないと "parent directory disappeared" で throw し phantom dir を作らない', async () => {
		// TOCTOU resurrection regression — branch 1: even the parent
		// directory is gone (a hard-removed tmpDir between source
		// classification and connect).
		const ghostDir = path.resolve(stubWorkingDir, '._nitpicker-ghost-no-parent');
		expect(existsSync(ghostDir)).toBe(false);
		await expect(Archive.connect(ghostDir)).rejects.toThrow(
			/parent directory disappeared/,
		);
		// The safety net must NOT have mkdir-resurrected the path.
		expect(existsSync(ghostDir)).toBe(false);
	});

	it('Archive.connect: 親ディレクトリは存在するが db.sqlite が無いと "database file missing" で throw し phantom file を作らない', async () => {
		// TOCTOU resurrection regression — branch 2: parent dir exists
		// (e.g. half-cleaned crawl state) but db.sqlite is gone. libsql
		// would otherwise create an empty file on open.
		const ghostDir = path.resolve(stubWorkingDir, '._nitpicker-ghost-no-db');
		mkdirSync(ghostDir, { recursive: true });
		const ghostDb = path.join(ghostDir, 'db.sqlite');
		expect(existsSync(ghostDir)).toBe(true);
		expect(existsSync(ghostDb)).toBe(false);
		try {
			await expect(Archive.connect(ghostDir)).rejects.toThrow(/database file missing/);
			// libsql must NOT have created an empty db.sqlite as a side effect.
			expect(existsSync(ghostDb)).toBe(false);
		} finally {
			rmSync(ghostDir, { recursive: true, force: true });
		}
	});

	// TODO(post-0.10): the clean-break policy rejects pre-0.10 archives at
	// `Database.connect`'s assertCompatibleVersion gate, so a stub of a
	// legacy archive (no version column at all) now surfaces
	// `IncompatibleArchiveError` rather than silently no-op'ing. The
	// underlying "read-only stub must not mutate the tmpDir" invariant is
	// still upheld — the error fires before any ALTER TABLE could run.
	it.skip('レガシースキーマの info テーブル（scope 列あり / roots 列なし）を stub オープンしても ALTER TABLE しない', async () => {
		// Direct behavioral regression for the migrateInfoRoots finding.
		// We hand-craft a tmpDir whose `info` table matches the
		// pre-`roots` shape, then assert that opening it through
		// ArchiveManager (which goes via `Archive.connect`, which uses
		// `Database.connect({ readOnly: true })`) leaves the schema
		// untouched. With the read-only guard removed, this test fails.
		const legacyDir = path.resolve(stubWorkingDir, '._nitpicker-legacy');
		mkdirSync(legacyDir, { recursive: true });
		const legacyDbPath = path.join(legacyDir, 'db.sqlite');

		// Use libsql directly (skipping the writer-side Database which
		// would run migrations on its own init) to seed the legacy shape.
		const libsqlModule = await import('libsql');
		const Libsql = libsqlModule.default as new (file: string) => {
			exec: (sql: string) => void;
			prepare: (sql: string) => { all: () => unknown[] };
			close: () => void;
		};
		const seeder = new Libsql(legacyDbPath);
		seeder.exec('CREATE TABLE info (baseUrl TEXT, scope TEXT);');
		seeder.exec(
			"INSERT INTO info (baseUrl, scope) VALUES ('https://legacy.example.com', '[]');",
		);
		const before = seeder.prepare('PRAGMA table_info(info)').all();
		seeder.close();

		try {
			const manager = new ArchiveManager();
			const { archiveId } = await manager.open(legacyDir);
			await manager.close(archiveId);

			// Re-open the raw DB to read the schema after the manager
			// has had its chance to migrate. If the migration ran, the
			// columns would change (add `roots`, drop `scope`).
			const inspector = new Libsql(legacyDbPath);
			const after = inspector.prepare('PRAGMA table_info(info)').all();
			inspector.close();
			expect(after).toEqual(before);
		} finally {
			rmSync(legacyDir, { recursive: true, force: true });
			rmSync(`${legacyDir}.lock`, { recursive: true, force: true });
		}
	});
});

/**
 * Remove the orphan `._nitpicker-<name>.lock` directories that mocked-`close`
 * tests leak into `process.cwd()`. `ArchiveManager.open` calls `Archive.open`
 * without forwarding `cwd`, so `Archive.open` defaults to `process.cwd()` and
 * acquires `<cwd>/._nitpicker-<basename>.lock`. The lock is normally released
 * inside `Archive.#runFullClose`'s `finally`, but these tests fully mock
 * `archive.close` to reject — that path never runs, and `cleanupOnFailure`
 * does not touch the `.lock` directory. We sweep them here so the repo root
 * does not accumulate stale `pid.txt` directories across test runs.
 *
 * Whitelist-by-basename (not a glob of `._nitpicker-*.lock` in `process.cwd()`)
 * is deliberate: vitest worker pools run multiple spec files in parallel against
 * the same `process.cwd()`, and a glob sweep would race-delete locks owned by
 * sibling specs that are still mid-test.
 *
 * **Drift caveat**: when you add a new test that does
 * `vi.spyOn(archive, 'close').mockRejectedValue(...)` (or otherwise prevents
 * `Archive.#runFullClose` from reaching its `finally` releaseLock), append
 * that archive's basename to the calling describe's `leakedLockBasenames`
 * array. Forgetting reintroduces the original leak silently — CI does not
 * fail on residual lock dirs.
 * @param basenames - The archive basenames whose lock directories to remove.
 */
function cleanupLeakedLocksInCwd(basenames: readonly string[]) {
	for (const basename of basenames) {
		const lockDir = path.resolve(process.cwd(), `._nitpicker-${basename}.lock`);
		rmSync(lockDir, { recursive: true, force: true });
	}
}

describe('ArchiveManager lifecycle races and partial-failure recovery', () => {
	const raceWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_archive_manager_race__',
	);
	const raceArchiveFilePath = path.resolve(raceWorkingDir, 'race-archive.nitpicker');
	const raceLeakedLockBasenames = ['race-archive'] as const;

	beforeAll(async () => {
		cleanupLeakedLocksInCwd(raceLeakedLockBasenames);
		mkdirSync(raceWorkingDir, { recursive: true });
		// Build a small finished archive once so the race tests can re-open
		// it cheaply without rebuilding a full DB each time.
		const archive = await Archive.create({
			filePath: raceArchiveFilePath,
			cwd: raceWorkingDir,
		});
		await archive.setConfig({
			baseUrl: 'https://example.com',
			name: 'race',
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
			userAgent: 'race',
			ignoreRobots: false,
		});
		await archive.write();
		await archive.close();
	});

	afterAll(() => {
		rmSync(raceWorkingDir, { recursive: true, force: true });
		cleanupLeakedLocksInCwd(raceLeakedLockBasenames);
	});

	it('close 中の同一パスへの concurrent open は close 完了を待ち、新しい accessor を返す', async () => {
		// Regression for the "delete-before-await" race: previously, the
		// second open() observed an empty cache and raced the still-
		// releasing lock, surfacing as ArchiveLockError.
		const manager = new ArchiveManager();
		const first = await manager.open(raceArchiveFilePath);

		// Make the underlying Archive.close take noticeable time so the
		// concurrent open has a real chance to interleave.
		const realClose = first.archive!.close.bind(first.archive!);
		const slowClose = vi
			.spyOn(first.archive!, 'close')
			.mockImplementation(async function (this: Archive) {
				await new Promise((r) => setTimeout(r, 100));
				await realClose();
			});

		try {
			const closePromise = manager.close(first.archiveId);
			// Without waiting for `closePromise`, immediately try to open
			// the same path. The new code must serialise on `entry.closing`.
			const secondPromise = manager.open(raceArchiveFilePath);
			const [, second] = await Promise.all([closePromise, secondPromise]);

			expect(second.accessor).not.toBe(first.accessor); // fresh entry
			expect(second.mode).toBe('archive');
			await manager.closeAll();
		} finally {
			slowClose.mockRestore();
		}
	});

	it('archive-mode で close が throw した場合、tmpDir と filePathWithoutExt の両方が rmSync される', async () => {
		// Regression for the orphaned-renamedDir finding: `Archive.write()`
		// renames tmpDir to filePathWithoutExt before tar. If tar fails,
		// the renamed dir is the survivor — cleanupOnFailure must remove it.
		const manager = new ArchiveManager();
		const { archiveId, archive } = await manager.open(raceArchiveFilePath);
		const tmpDir = archive!.tmpDir;
		const renamedDir = archive!.renamedDir;
		// Create both directories on disk so we can verify both are removed.
		mkdirSync(tmpDir, { recursive: true });
		mkdirSync(renamedDir, { recursive: true });
		// Force close() to throw.
		const failingClose = vi
			.spyOn(archive!, 'close')
			.mockRejectedValue(new Error('simulated close failure'));

		try {
			await manager.close(archiveId);
			expect(existsSync(tmpDir)).toBe(false);
			expect(existsSync(renamedDir)).toBe(false);
		} finally {
			failingClose.mockRestore();
		}
	});
});

describe('ArchiveManager warning sink (onWarn)', () => {
	const warnWorkingDir = path.resolve(
		__dirname,
		'__test_fixtures_archive_manager_warn__',
	);
	const warnLeakedLockBasenames = ['routed', 'default-sink', 'non-error'] as const;

	beforeAll(() => {
		cleanupLeakedLocksInCwd(warnLeakedLockBasenames);
		mkdirSync(warnWorkingDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(warnWorkingDir, { recursive: true, force: true });
		cleanupLeakedLocksInCwd(warnLeakedLockBasenames);
	});

	/**
	 * Build a fresh `.nitpicker` archive for the calling test. Each test
	 * needs its own file because the partial-failure scenarios we
	 * simulate (mocked failing `close`) leave the underlying lock and
	 * tmpDir in inconsistent states that a shared fixture would carry
	 * across cases.
	 * @param testName
	 */
	async function buildFreshArchive(testName: string): Promise<string> {
		const filePath = path.resolve(warnWorkingDir, `${testName}.nitpicker`);
		const archive = await Archive.create({ filePath, cwd: warnWorkingDir });
		await archive.setConfig({
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			name: testName,
			version: '0.13.0',
			recursive: true,
			interval: 0,
			image: true,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 3,
			fromList: false,
			disableQueries: false,
			userAgent: 'warn',
			ignoreRobots: false,
		});
		await archive.write();
		await archive.close();
		return filePath;
	}

	it('カスタム onWarn を渡すと close 失敗時の警告がそこに routed される（MCP 側の stderr 専用化の根拠）', async () => {
		const filePath = await buildFreshArchive('routed');
		const captured: string[] = [];
		const manager = new ArchiveManager({
			onWarn: (message) => captured.push(message),
		});
		const { archiveId, archive } = await manager.open(filePath);
		const failingClose = vi
			.spyOn(archive!, 'close')
			.mockRejectedValue(new Error('routed-warning sentinel'));

		try {
			await manager.close(archiveId);
		} finally {
			failingClose.mockRestore();
		}

		// 1) The warning landed in our sink, not console.warn.
		expect(captured.length).toBeGreaterThanOrEqual(1);
		// 2) stringifyError serialised the Error via stack — the message
		//    body is stable across platforms even if the stack isn't.
		expect(captured[0]).toContain('Failed to close archive cleanly');
		expect(captured[0]).toContain('routed-warning sentinel');
	});

	it('onWarn 未指定時は console.warn にフォールバックする（既定動作で viewer の stderr に届く）', async () => {
		const filePath = await buildFreshArchive('default-sink');
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			const manager = new ArchiveManager(); // no onWarn → default fallback
			const { archiveId, archive } = await manager.open(filePath);
			const failingClose = vi
				.spyOn(archive!, 'close')
				.mockRejectedValue(new Error('default-sink sentinel'));
			try {
				await manager.close(archiveId);
			} finally {
				failingClose.mockRestore();
			}
			expect(warnSpy).toHaveBeenCalled();
			const firstCallArg = warnSpy.mock.calls[0]?.[0];
			expect(String(firstCallArg)).toContain('default-sink sentinel');
		} finally {
			warnSpy.mockRestore();
		}
	});

	it('onWarn は Error 以外（plain object）も読める形にシリアライズする（stringifyError の JSON 経路）', async () => {
		const filePath = await buildFreshArchive('non-error');
		const captured: string[] = [];
		const manager = new ArchiveManager({
			onWarn: (message) => captured.push(message),
		});
		const { archiveId, archive } = await manager.open(filePath);
		// Reject with a non-Error so we exercise the JSON.stringify fallback.
		const failingClose = vi
			.spyOn(archive!, 'close')
			.mockRejectedValue({ kind: 'opaque-non-error', code: 42 });

		try {
			await manager.close(archiveId);
		} finally {
			failingClose.mockRestore();
		}

		// JSON.stringify path should round-trip the object content.
		expect(captured[0]).toContain('"kind":"opaque-non-error"');
		expect(captured[0]).toContain('"code":42');
	});
});
