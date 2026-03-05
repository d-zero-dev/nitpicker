import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, describe, expect, it, vi } from 'vitest';

import Archive from './archive.js';
import { Database } from './database.js';
import { remove } from './filesystem/index.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

vi.mock('./filesystem/index.js', async (importOriginal) => {
	const original = await importOriginal<typeof import('./filesystem/index.js')>();
	return {
		...original,
		outputText: vi.fn(original.outputText),
	};
});

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
		const fsIndex = await import('./filesystem/index.js');
		const mockedOutputText = vi.mocked(fsIndex.outputText);
		mockedOutputText.mockRejectedValueOnce(new Error('Disk write failure'));

		const archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});

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
			type: 'sqlite3',
			workingDir: tmpDirPattern,
			filename: dbPath,
		});
		const pages = await db.getPages();
		const page = pages.find((p) => p.url === 'http://localhost/snapshot-fail');
		expect(page).toBeDefined();
		expect(page!.html).toBeNull();

		await db.destroy();
		mockedOutputText.mockRestore();
		await archive.close();
	});
});
