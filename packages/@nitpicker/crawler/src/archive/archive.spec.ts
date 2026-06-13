import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';

import Archive from './archive.js';
import { Database } from './database.js';
import { remove } from './filesystem/remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

vi.mock('./filesystem/output-text.js', async (importOriginal) => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const original = await importOriginal<typeof import('./filesystem/output-text.js')>();
	return {
		...original,
		outputText: vi.fn(original.outputText),
	};
});

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
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'set-page-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'set-page-test.nitpicker');

	afterAll(async () => {
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('スナップショット書き込み失敗時にDB上のHTMLパスがクリアされエラーが伝搬する', async () => {
		const fsIndex = await import('./filesystem/output-text.js');
		const mockedOutputText = vi.mocked(fsIndex.outputText);
		mockedOutputText.mockRejectedValueOnce(new Error('Disk write failure'));

		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		try {
			const pageData = {
				url: parseUrl('http://localhost/snapshot-fail')!,
				redirectPaths: [] as string[],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 100,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Snapshot Fail Test' },
				anchorList: [] as never[],
				imageList: [] as never[],
				html: '<html><body>test</body></html>',
				isSkipped: false,
				isTarget: true,
			};

			await expect(archive.setPage(pageData)).rejects.toThrow('Disk write failure');

			expect(mockedOutputText).toHaveBeenCalledTimes(1);

			// HTMLパスがクリアされていることをDB経由で検証
			const dbPath = path.resolve(tmpDirPattern, Archive.SQLITE_DB_FILE_NAME);
			const db = await Database.connect({
				workingDir: tmpDirPattern,
				filename: dbPath,
			});
			try {
				const pages = await db.getPages();
				const page = pages.find((p) => p.url === 'http://localhost/snapshot-fail');
				expect(page).toBeDefined();
				expect(page!.html).toBeNull();
			} finally {
				await db.destroy();
			}
		} finally {
			mockedOutputText.mockRestore();
			await archive.close();
		}
	});

	it('clearHtmlPath 失敗時も元のスナップショットエラーが伝搬する', async () => {
		const fsIndex = await import('./filesystem/output-text.js');
		const mockedOutputText = vi.mocked(fsIndex.outputText);
		mockedOutputText.mockRejectedValueOnce(new Error('Disk full'));

		const clearSpy: MockInstance = vi
			.spyOn(Database.prototype, 'clearHtmlPath')
			.mockRejectedValueOnce(new Error('DB locked'));

		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		try {
			const pageData = {
				url: parseUrl('http://localhost/double-fail')!,
				redirectPaths: [] as string[],
				isExternal: false,
				status: 200,
				statusText: 'OK',
				contentLength: 50,
				contentType: 'text/html',
				responseHeaders: {},
				meta: { title: 'Double Fail' },
				anchorList: [] as never[],
				imageList: [] as never[],
				html: '<html></html>',
				isSkipped: false,
				isTarget: true,
			};

			// 元のエラー（Disk full）が伝搬する（DB lockedに差し替わらない）
			await expect(archive.setPage(pageData)).rejects.toThrow('Disk full');
		} finally {
			clearSpy.mockRestore();
			mockedOutputText.mockRestore();
			await archive.close();
		}
	});

	it('同一ページを 2 回 setPage しても発リンクが重複しない（実呼び出し元での re-scrape dedup）', async () => {
		// Integration boundary: the de-dup logic lives in Database.updatePage, but
		// the production caller is Archive.setPage (which also writes snapshots).
		// This proves the wrapper does not bypass the replace-on-re-scrape contract.
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
			// 同一ページを再スクレイプ。
			await archive.setPage(pageData);

			const anchors = await archive.getAnchorsOnPage(pageId);
			expect(anchors).toHaveLength(2);
		} finally {
			// close() は .nitpicker を書き出して tmpDir を消す。生成物も後始末する。
			await archive.close();
			await remove(filePath).catch(() => {});
		}
	});

	it('非HTML（PDF）の setPage は 0 バイトのスナップショットファイルを作らない（#72）', async () => {
		// 結合境界: html パスの付与は updatePage、ファイル書き込みは setPage。PDF は
		// internal で isTarget=true だが html が空なので、スナップショットファイルを
		// 一切作ってはならない（実体 0 バイトのファイル量産バグ #72）。
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
			const snapshotPath = path.resolve(
				archive.tmpDir,
				Archive.SNAPSHOT_HTML_DIR,
				`${pageId}.html`,
			);
			expect(existsSync(snapshotPath)).toBe(false);
		} finally {
			await archive.close();
			await remove(filePath).catch(() => {});
		}
	});
});

describe('write: スナップショットzipキャッシュの無効化', () => {
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'cache-invalidate-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'cache-invalidate-test.nitpicker');

	afterAll(async () => {
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('write() 後の getHtmlOfPage は dangling キャッシュ参照で throw せず null を返す', async () => {
		const html = '<html><body>cached page</body></html>';
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId = await archive.setPage(makePageData('/cached', html));

		// zip 経由の読み取りで central directory キャッシュを充填する
		const snapshotDir = path.resolve(archive.tmpDir, Archive.SNAPSHOT_HTML_DIR);
		const { zip } = await import('@d-zero/fs/zip');
		await zip(`${snapshotDir}.zip`, snapshotDir);
		await remove(snapshotDir);
		const filePath = `${Archive.SNAPSHOT_HTML_DIR}/${pageId}.html`;
		await expect(archive.getHtmlOfPage(filePath)).resolves.toBe(html);

		// write() で tmpDir がリネーム・削除され、キャッシュ先の zip パスは消滅する
		await archive.write();

		// キャッシュが無効化されていれば ENOENT を投げず null になる
		await expect(archive.getHtmlOfPage(filePath)).resolves.toBeNull();

		await archive.close();
	});
});

describe('write: append 時のスナップショットマージ', () => {
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'append-merge-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'append-merge-test.nitpicker');

	afterAll(async () => {
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('既存zipと追記スナップショットがマージされ、両方のHTMLが読める', async () => {
		const html1 = '<html><body>original page</body></html>';
		const html2 = '<html><body>appended page</body></html>';

		// 1回目: 通常の crawl → write 相当
		const first = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId1 = await first.setPage(makePageData('/original', html1));
		await first.write();
		await first.close();

		// 2回目: append 相当（既存アーカイブを開き、新規ページを追加して write）
		const second = await Archive.open({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		const pageId2 = await second.setPage(makePageData('/appended', html2));
		await second.write();
		await second.close();

		// 再オープンして両方のスナップショットが残っていることを検証
		const reopened = await Archive.open({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		try {
			await expect(
				reopened.getHtmlOfPage(`${Archive.SNAPSHOT_HTML_DIR}/${pageId1}.html`),
			).resolves.toBe(html1);
			await expect(
				reopened.getHtmlOfPage(`${Archive.SNAPSHOT_HTML_DIR}/${pageId2}.html`),
			).resolves.toBe(html2);
		} finally {
			await reopened.close();
		}
	});
});

describe('getScrapedHtmlPageCount', () => {
	const archiveFilePath = path.resolve(workingDir, 'html-page-count-test.nitpicker');
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'html-page-count-test',
	);

	afterAll(async () => {
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('Database.getScrapedHtmlPageCount に passthrough して同じ件数を返す', async () => {
		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

		try {
			// HTML ページ 1 件挿入
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
				workingDir: tmpDirPattern,
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
