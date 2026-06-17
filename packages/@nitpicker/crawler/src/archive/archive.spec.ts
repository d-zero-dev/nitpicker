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
		// Issue #72: previously a PDF with isTarget=1 wrote a 0-byte snapshot.
		// With BLOB storage, the same intent is "no page_html_ref row for
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
