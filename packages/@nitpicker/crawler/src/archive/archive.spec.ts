import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it, vi, type MockInstance } from 'vitest';

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

	it('clearHtmlPath失敗時も元のスナップショットエラーが伝搬する', async () => {
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
