import { existsSync, mkdirSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import Archive from './archive.js';
import { Database } from './database.js';
import { remove } from './filesystem/remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

/**
 * Builds minimal page data for `Archive.setPage` in tests.
 * @param pathname - The URL pathname of the page.
 * @param html - The HTML snapshot content of the page.
 * @returns Page data accepted by `Archive.setPage`.
 */
function makePageData(pathname: string, html: string) {
	return {
		url: parseUrl(`http://localhost${pathname}`)!,
		redirectPaths: [] as string[],
		isExternal: false,
		status: 200,
		statusText: 'OK',
		contentLength: html.length,
		contentType: 'text/html',
		responseHeaders: {},
		meta: { title: 'Test Page' },
		anchorList: [] as never[],
		imageList: [] as never[],
		html,
		isSkipped: false,
		isTarget: true,
	};
}

describe('setPage', () => {
	const archiveFilePath = path.resolve(workingDir, 'set-page-test.nitpicker');

	afterAll(async () => {
		await remove(archiveFilePath).catch(() => {});
	});

	it('Stores the HTML body as a BLOB readable through getHtmlOfPage', async () => {
		const filePath = path.resolve(workingDir, 'setpage-readback.nitpicker');
		const archive = await Archive.create({ filePath, cwd: workingDir });
		try {
			const html = '<html><body>readback</body></html>';
			const pageId = await archive.setPage(makePageData('/readback', html));
			await expect(archive.getHtmlOfPage(pageId)).resolves.toBe(html);
		} finally {
			await archive.close();
			await remove(filePath).catch(() => {});
		}
	});

	it('Re-scraping the same page does not duplicate outgoing anchors', async () => {
		// Integration boundary: the de-dup logic lives in Database.updatePage, but
		// the production caller is Archive.setPage. This proves the wrapper does
		// not bypass the replace-on-re-scrape contract.
		const filePath = path.resolve(workingDir, 'setpage-rescrape-test.nitpicker');
		const archive = await Archive.create({ filePath, cwd: workingDir });
		const pageData = {
			url: parseUrl('http://localhost/setpage-rescrape')!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 100,
			contentType: 'text/html',
			responseHeaders: {},
			meta: { title: 'Re-scrape via setPage' },
			anchorList: [
				{ href: parseUrl('http://localhost/a')!, textContent: 'A', isExternal: false },
				{ href: parseUrl('http://localhost/b')!, textContent: 'B', isExternal: false },
			],
			imageList: [] as never[],
			html: '<html></html>',
			isSkipped: false,
			isTarget: true,
		};

		try {
			const pageId = await archive.setPage(pageData);
			await archive.setPage(pageData);

			const anchors = await archive.getAnchorsOnPage(pageId);
			expect(anchors).toHaveLength(2);
		} finally {
			await archive.close();
			await remove(filePath).catch(() => {});
		}
	});

	it('Non-HTML (PDF) setPage does not insert a page_html_ref row (#72)', async () => {
		// Issue #72: a PDF with isTarget=1 must not leave an empty body
		// record. With BLOB storage that means "no page_html_ref row for
		// non-HTML responses": the writer must skip the body INSERT when
		// `html.length === 0`.
		const filePath = path.resolve(workingDir, 'setpage-pdf-test.nitpicker');
		const archive = await Archive.create({ filePath, cwd: workingDir });
		const pageData = {
			url: parseUrl('http://localhost/document.pdf')!,
			redirectPaths: [] as string[],
			isExternal: false,
			status: 200,
			statusText: 'OK',
			contentLength: 1024,
			contentType: 'application/pdf',
			responseHeaders: {},
			meta: { title: '' },
			anchorList: [] as never[],
			imageList: [] as never[],
			html: '',
			isSkipped: false,
			isTarget: true,
		};

		try {
			const pageId = await archive.setPage(pageData);
			const knex = archive.getKnex();
			const refRows = await knex('page_html_ref').where('page_id', pageId);
			expect(refRows).toHaveLength(0);
			await expect(archive.getHtmlOfPage(pageId)).resolves.toBeNull();
		} finally {
			await archive.close();
			await remove(filePath).catch(() => {});
		}
	});
});

describe('write: archive layout', () => {
	const archiveFilePath = path.resolve(workingDir, 'write-layout-test.nitpicker');

	afterAll(async () => {
		await remove(archiveFilePath).catch(() => {});
	});

	it('Reopened archive returns the stored HTML body (BLOB survives tar round-trip)', async () => {
		const html = '<html><body>roundtrip</body></html>';
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId = await archive.setPage(makePageData('/roundtrip', html));
		await archive.close();

		const reopened = await Archive.open({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		try {
			await expect(reopened.getHtmlOfPage(pageId)).resolves.toBe(html);
		} finally {
			await reopened.close();
		}
	});

	it('reports each write step in order via onStep (issue #294)', async () => {
		const stepFilePath = path.resolve(workingDir, 'write-on-step-test.nitpicker');
		const archive = await Archive.create({ filePath: stepFilePath, cwd: workingDir });
		await archive.setPage(makePageData('/on-step', '<html></html>'));

		const steps: string[] = [];
		try {
			await archive.write({ onStep: (step) => steps.push(step) });
		} finally {
			await remove(stepFilePath).catch(() => {});
		}

		expect(steps).toEqual(['checkpoint', 'rename', 'tar', 'remove']);
	});

	it('reports tar byte progress via onTarProgress (issue #294)', async () => {
		const progressFilePath = path.resolve(
			workingDir,
			'write-on-tar-progress-test.nitpicker',
		);
		const archive = await Archive.create({ filePath: progressFilePath, cwd: workingDir });
		await archive.setPage(
			makePageData('/on-tar-progress', `<html>${'x'.repeat(500_000)}</html>`),
		);

		const calls: [number, number][] = [];
		try {
			await archive.write({
				onTarProgress: (writtenBytes, totalBytes) => {
					calls.push([writtenBytes, totalBytes]);
				},
			});
		} finally {
			await remove(progressFilePath).catch(() => {});
		}

		expect(calls.length).toBeGreaterThan(0);
		const totalBytes = calls[0]![1];
		expect(totalBytes).toBeGreaterThan(0);
		expect(calls.at(-1)!).toEqual([totalBytes, totalBytes]);
	});

	it('write() scrubs info.createdCwd before packaging (issue #350)', async () => {
		const scrubFilePath = path.resolve(
			workingDir,
			'write-scrub-created-cwd-test.nitpicker',
		);
		const archive = await Archive.create({ filePath: scrubFilePath, cwd: workingDir });
		await archive.setConfig({
			version: '0.13.0',
			name: 'scrub-test',
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 0,
			fromList: false,
			disableQueries: false,
			userAgent: 'x',
			ignoreRobots: false,
			createdCwd: '/home/someone/private-project',
		});

		try {
			await archive.close();
			const reopened = await Archive.open({ filePath: scrubFilePath, cwd: workingDir });
			try {
				const reopenedConfig = await reopened.getConfig();
				expect(reopenedConfig.createdCwd).toBeNull();
			} finally {
				await reopened.close();
			}
		} finally {
			await remove(scrubFilePath).catch(() => {});
		}
	});
});

describe('Archive.resume: output path (issue #350)', () => {
	const dir = path.resolve(workingDir, 'resume-output-path-suite');

	beforeAll(() => {
		mkdirSync(dir, { recursive: true });
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('reconstructs the output path from info.createdCwd, not this invocation’s cwd', async () => {
		const elsewhere = path.resolve(dir, 'elsewhere');
		mkdirSync(elsewhere, { recursive: true });
		const archiveFilePath = path.resolve(elsewhere, 'created-cwd-test.nitpicker');
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: elsewhere });
		await archive.setConfig({
			version: '0.13.0',
			name: 'created-cwd-test',
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 0,
			fromList: false,
			disableQueries: false,
			userAgent: 'x',
			ignoreRobots: false,
			createdCwd: elsewhere,
		});
		const tmpDir = archive.tmpDir;
		await archive.releaseHandle();

		// Resume from a DIFFERENT cwd than `elsewhere` — the output path must
		// still land in `elsewhere`, not here.
		const resumed = await Archive.resume(tmpDir);
		try {
			expect(resumed.filePath).toBe(archiveFilePath);
		} finally {
			await resumed.releaseHandle();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('falls back to process.cwd() when the stub predates info.createdCwd', async () => {
		const archiveFilePath = path.resolve(dir, 'no-created-cwd-test.nitpicker');
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		// A stub whose `info` row predates this column (`createdCwd` omitted
		// entirely, not just `null`) — the DEFAULT-less column reads back as
		// `null`, same as an explicit `null`.
		await archive.setConfig({
			version: '0.13.0',
			name: path.basename(archiveFilePath, '.nitpicker'),
			baseUrl: 'https://example.com',
			roots: ['https://example.com'],
			recursive: true,
			interval: 0,
			image: false,
			fetchExternal: false,
			parallels: 1,
			excludes: [],
			excludeKeywords: [],
			excludeUrls: [],
			maxExcludedDepth: 0,
			retry: 0,
			fromList: false,
			disableQueries: false,
			userAgent: 'x',
			ignoreRobots: false,
		});
		const tmpDir = archive.tmpDir;
		await archive.releaseHandle();

		const resumed = await Archive.resume(tmpDir);
		try {
			expect(resumed.filePath).toBe(
				path.resolve(process.cwd(), path.basename(archiveFilePath)),
			);
		} finally {
			await resumed.releaseHandle();
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe('close: recovery-write progress (issue #294)', () => {
	it("calls onRecoveryStart before write()'s own onStep/onTarProgress when the file does not exist yet", async () => {
		const recoveryFilePath = path.resolve(workingDir, 'close-recovery-test.nitpicker');
		const archive = await Archive.create({ filePath: recoveryFilePath, cwd: workingDir });
		await archive.setPage(makePageData('/close-recovery', '<html></html>'));

		const calls: string[] = [];
		try {
			// No explicit write() beforehand: the file genuinely doesn't
			// exist yet, so close() must take the recovery-write branch.
			await archive.close({
				onRecoveryStart: () => calls.push('recoveryStart'),
				onStep: (step) => calls.push(step),
				onTarProgress: () => calls.push('tarProgress'),
			});
		} finally {
			await remove(recoveryFilePath).catch(() => {});
		}

		expect(calls[0]).toBe('recoveryStart');
		const steps = calls.filter((call) => call !== 'tarProgress');
		expect(steps).toEqual(['recoveryStart', 'checkpoint', 'rename', 'tar', 'remove']);
		expect(calls).toContain('tarProgress');
	});

	it('does not call onRecoveryStart when the archive was already written', async () => {
		const writtenFilePath = path.resolve(workingDir, 'close-no-recovery-test.nitpicker');
		const archive = await Archive.create({ filePath: writtenFilePath, cwd: workingDir });
		await archive.setPage(makePageData('/close-no-recovery', '<html></html>'));
		await archive.write();

		const calls: string[] = [];
		try {
			await archive.close({ onRecoveryStart: () => calls.push('recoveryStart') });
		} finally {
			await remove(writtenFilePath).catch(() => {});
		}

		expect(calls).toEqual([]);
	});
});

describe('open: rename-safe', () => {
	const original = path.resolve(workingDir, 'rename-original.nitpicker');
	const renamed = path.resolve(workingDir, 'rename-after.nitpicker');

	afterAll(async () => {
		await remove(original).catch(() => {});
		await remove(renamed).catch(() => {});
	});

	it('Opens an archive whose `.nitpicker` file has been renamed after creation', async () => {
		// Reproduces the user-reported breakage: a `.nitpicker` is created
		// with one basename, then renamed by the user (`mv original.nitpicker
		// renamed.nitpicker`). The inner tar layout still names its top-level
		// directory after the original basename, so any code path that
		// reconstructs the inner-dir name from the outer file basename would
		// fail to find `db.sqlite` and throw.
		const html = '<html><body>renamed-archive</body></html>';
		const archive = await Archive.create({ filePath: original, cwd: workingDir });
		const pageId = await archive.setPage(makePageData('/renamed', html));
		await archive.close();

		await fs.rename(original, renamed);

		const reopened = await Archive.open({ filePath: renamed, cwd: workingDir });
		try {
			await expect(reopened.getHtmlOfPage(pageId)).resolves.toBe(html);
		} finally {
			await reopened.close();
		}
	});
});

describe('connect: readOnly option', () => {
	// `releaseHandle()` deliberately leaves `tmpDir` on disk (that's the
	// point — simulating an already-extracted tar-cache dir a second
	// connection attaches to), so each test uses its own archive path and
	// rm's its own tmpDir directly; unlike the other describe blocks here,
	// `archive.close()`/`write()` never run to do that cleanup implicitly.
	const tmpDirs: string[] = [];

	afterAll(() => {
		for (const tmpDir of tmpDirs) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('defaults to a read-only accessor that rejects writes', async () => {
		const archiveFilePath = path.resolve(
			workingDir,
			'connect-readonly-default.nitpicker',
		);
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		const tmpDir = archive.tmpDir;
		tmpDirs.push(tmpDir);
		await archive.releaseHandle();

		const accessor = await Archive.connect(tmpDir);
		try {
			expect(accessor.readOnly).toBe(true);
		} finally {
			await accessor.close();
		}
	});

	it('opens a writable accessor against the same tmpDir when readOnly: false', async () => {
		// Simulates the explicit `nitpicker viewer-build` command: a second
		// connection to a tmpDir that another (read-only) accessor already
		// has open, used to build the viewer read model without touching the
		// caller's live/interrupted crawl tmpDir (which must never take this
		// path).
		const archiveFilePath = path.resolve(
			workingDir,
			'connect-readonly-writable.nitpicker',
		);
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: workingDir });
		const tmpDir = archive.tmpDir;
		tmpDirs.push(tmpDir);
		await archive.setPage(makePageData('/writable-connect', '<html></html>'));
		await archive.releaseHandle();

		const writable = await Archive.connect(tmpDir, null, { readOnly: false });
		try {
			expect(writable.readOnly).toBe(false);
			await expect(
				writable.getKnex()('url_refs').insert({ url: 'https://example.com/extra' }),
			).resolves.toBeDefined();
		} finally {
			await writable.close();
		}
	});
});

describe('write: append', () => {
	const archiveFilePath = path.resolve(workingDir, 'append-merge-test.nitpicker');

	afterAll(async () => {
		await remove(archiveFilePath).catch(() => {});
	});

	it('Append run preserves the existing snapshot and stores the new one', async () => {
		const html1 = '<html><body>original page</body></html>';
		const html2 = '<html><body>appended page</body></html>';

		// 1st pass: ordinary crawl → write.
		const first = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId1 = await first.setPage(makePageData('/original', html1));
		await first.close();

		// 2nd pass: append (open existing archive, add a new page, write).
		// `close()` auto-writes only when the .nitpicker does NOT yet exist;
		// for append the archive already exists, so the write() must be
		// invoked explicitly to persist the new BLOBs back to the tar.
		const second = await Archive.open({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId2 = await second.setPage(makePageData('/appended', html2));
		await second.write();
		await second.close();

		// Reopen and verify both bodies remain accessible.
		const reopened = await Archive.open({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		try {
			await expect(reopened.getHtmlOfPage(pageId1)).resolves.toBe(html1);
			await expect(reopened.getHtmlOfPage(pageId2)).resolves.toBe(html2);
		} finally {
			await reopened.close();
		}
	});
});

describe('getScrapedHtmlPageCount', () => {
	const archiveFilePath = path.resolve(workingDir, 'html-page-count-test.nitpicker');

	afterAll(async () => {
		await remove(archiveFilePath).catch(() => {});
	});

	it('Database.getScrapedHtmlPageCount に passthrough して同じ件数を返す', async () => {
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		try {
			await archive.setPage(makePageData('/html-page', '<html></html>'));

			const count = await archive.getScrapedHtmlPageCount();

			expect(count).toBe(1);
		} finally {
			await archive.close();
		}
	});
});

describe('addPageError', () => {
	const archiveFilePath = path.resolve(workingDir, 'add-page-error-test.nitpicker');
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'add-page-error-test',
	);

	afterAll(async () => {
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('persists a page_errors row even before setPage runs', async () => {
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		try {
			await archive.addPageError(
				'http://localhost/viewport-failure',
				'retryExhausted',
				'📷 mobile-small: skipped — Attempted to use detached Frame',
			);

			// Verify via a separate Database connection to the working tmp dir
			// (mirrors the setPage tests above — Archive does not expose its
			// internal Database publicly).
			const dbPath = path.resolve(tmpDirPattern, Archive.SQLITE_DB_FILE_NAME);
			const db = await Database.connect({
				filename: dbPath,
			});
			try {
				const rows = await db.getKnex().from('page_errors').select('phase', 'message');
				expect(rows).toEqual([
					{
						phase: 'retryExhausted',
						message: '📷 mobile-small: skipped — Attempted to use detached Frame',
					},
				]);
			} finally {
				await db.destroy();
			}
		} finally {
			await archive.close();
		}
	});
});

/**
 * `releaseHandle` is the safe exit hatch for callers who created an
 * `Archive` to populate fixture state and now need to drop the writer's
 * SQLite handle and advisory lock **without** finalising the archive
 * (no `write()`, no `tmpDir` removal). Fixture scripts (
 * `viewer/e2e/generate-stub-fixture.mjs`) and the stub-mode test
 * fixtures rely on this so they can leave an interrupted-crawl state on
 * disk for downstream consumers to read.
 */
describe('Archive.releaseHandle', () => {
	const dir = path.resolve(workingDir, 'release-handle-suite');
	const archiveFilePath = path.resolve(dir, 'release-handle-test.nitpicker');
	const tmpDirPath = path.resolve(dir, `${Archive.TMP_DIR_PREFIX}release-handle-test`);
	const lockPath = `${tmpDirPath}.lock`;

	beforeAll(() => {
		mkdirSync(dir, { recursive: true });
	});

	afterAll(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it('tmpDir を残し、.nitpicker を作らず、lock を解放する（3つの保証を同時に満たす）', async () => {
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		// Pre-conditions: lock acquired, tmpDir present, no .nitpicker yet.
		expect(existsSync(lockPath)).toBe(true);
		expect(existsSync(archive.tmpDir)).toBe(true);
		expect(existsSync(archiveFilePath)).toBe(false);

		await archive.releaseHandle();

		// Post-conditions — the three guarantees:
		expect(existsSync(archive.tmpDir)).toBe(true); // tmpDir preserved
		expect(existsSync(archiveFilePath)).toBe(false); // no .nitpicker produced
		expect(existsSync(lockPath)).toBe(false); // lock released

		rmSync(archive.tmpDir, { recursive: true, force: true });
	});

	it('複数回呼んでも idempotent（共有 close promise が同じ結果を返す）', async () => {
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		try {
			await archive.releaseHandle();
			await expect(archive.releaseHandle()).resolves.toBeUndefined();
			await expect(archive.releaseHandle()).resolves.toBeUndefined();
			// Still no .nitpicker after multiple releases.
			expect(existsSync(archiveFilePath)).toBe(false);
		} finally {
			rmSync(archive.tmpDir, { recursive: true, force: true });
		}
	});

	it('releaseHandle が先に呼ばれた場合、後続の close() は no-op で .nitpicker を作らない（相互排他）', async () => {
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		try {
			await archive.releaseHandle();
			// close() should now be a no-op via the shared `#closeOnce` —
			// the destructive prologue (write/remove) must NOT re-run.
			await expect(archive.close()).resolves.toBeUndefined();
			expect(existsSync(archiveFilePath)).toBe(false);
			expect(existsSync(archive.tmpDir)).toBe(true);
		} finally {
			rmSync(archive.tmpDir, { recursive: true, force: true });
		}
	});

	it('close が先に呼ばれた場合、後続の releaseHandle() は no-op（相互排他の逆方向）', async () => {
		const archive = await Archive.create({ filePath: archiveFilePath, cwd: dir });
		const tmpDir = archive.tmpDir;
		await archive.close();
		// close() finalised the archive normally → .nitpicker exists, tmpDir gone.
		expect(existsSync(archiveFilePath)).toBe(true);
		expect(existsSync(tmpDir)).toBe(false);
		// A trailing releaseHandle from a signal handler must not throw or
		// double-release.
		await expect(archive.releaseHandle()).resolves.toBeUndefined();
		rmSync(archiveFilePath, { force: true });
	});
});
