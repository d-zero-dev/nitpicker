import { promises as fs } from 'node:fs';
import path from 'node:path';

import { extractZip, zip } from '@d-zero/fs/zip';
import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import Archive from './archive.js';
import { exists } from './filesystem/exists.js';
import { mkdir } from './filesystem/mkdir.js';
import { outputText } from './filesystem/output-text.js';
import { remove } from './filesystem/remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workingDir = path.resolve(__dirname, '__mock__');

vi.mock('@d-zero/fs/zip', async (importOriginal) => {
	// eslint-disable-next-line @typescript-eslint/consistent-type-imports
	const original = await importOriginal<typeof import('@d-zero/fs/zip')>();
	return {
		...original,
		extractZip: vi.fn(original.extractZip),
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

describe('getHtmlOfPage: クロール中（スナップショットが生ディレクトリの状態）', () => {
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'accessor-raw-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'accessor-raw-test.nitpicker');
	let archive: Archive;
	let pageId: number;
	const html = '<html><body>raw dir page</body></html>';

	beforeAll(async () => {
		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		pageId = await archive.setPage(makePageData('/raw-page', html));
	});

	afterAll(async () => {
		await archive.close().catch(() => {});
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('生ディレクトリから直接読み取る', async () => {
		const result = await archive.getHtmlOfPage(
			`${Archive.SNAPSHOT_HTML_DIR}/${pageId}.html`,
		);
		expect(result).toBe(html);
	});

	it('filePathがnullの場合はnullを返す', async () => {
		const result = await archive.getHtmlOfPage(null);
		expect(result).toBeNull();
	});
});

describe('getHtmlOfPage: zip化後（write() 相当の状態）', () => {
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'accessor-zip-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'accessor-zip-test.nitpicker');
	let archive: Archive;
	let snapshotDir: string;
	let pageId1: number;
	let pageId2: number;
	const html1 = '<html><body>zipped page 1</body></html>';
	const html2 = '<html><body>zipped page 2</body></html>';

	beforeAll(async () => {
		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		pageId1 = await archive.setPage(makePageData('/zip-page-1', html1));
		pageId2 = await archive.setPage(makePageData('/zip-page-2', html2));

		// write() と同じ状態を作る: snapshot-html/ を zip 化して削除
		snapshotDir = path.resolve(archive.tmpDir, Archive.SNAPSHOT_HTML_DIR);
		// 空のスナップショットファイル（0バイト）も zip に含める
		await outputText(path.resolve(snapshotDir, '999.html'), '');
		await zip(`${snapshotDir}.zip`, snapshotDir);
		await remove(snapshotDir);
		vi.mocked(extractZip).mockClear();
	});

	afterAll(async () => {
		await archive.close().catch(() => {});
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('zipからストリーミング取得し、ディスクへ物理展開しない', async () => {
		const result = await archive.getHtmlOfPage(
			`${Archive.SNAPSHOT_HTML_DIR}/${pageId1}.html`,
		);
		expect(result).toBe(html1);
		// 物理展開の副作用（snapshot-html/ ディレクトリの再生成）がないこと
		expect(exists(snapshotDir)).toBe(false);
	});

	it('複数回の取得でもcentral directoryの読み込みは1回だけ', async () => {
		const result = await archive.getHtmlOfPage(
			`${Archive.SNAPSHOT_HTML_DIR}/${pageId2}.html`,
		);
		expect(result).toBe(html2);
		expect(vi.mocked(extractZip)).toHaveBeenCalledTimes(1);
	});

	it('空のスナップショットは空文字列を返す（見つからない場合のnullと区別される）', async () => {
		const result = await archive.getHtmlOfPage(`${Archive.SNAPSHOT_HTML_DIR}/999.html`);
		expect(result).toBe('');
	});

	it('zipに存在しないエントリはnullを返す', async () => {
		const result = await archive.getHtmlOfPage(`${Archive.SNAPSHOT_HTML_DIR}/99999.html`);
		expect(result).toBeNull();
	});

	it('zipも生ディレクトリも存在しない場合はnullを返す', async () => {
		const result = await archive.getHtmlOfPage('no-such-dir/1.html');
		expect(result).toBeNull();
	});

	it('生ディレクトリに無いファイルはzipへフォールバックする', async () => {
		// append 中の状態を模倣: 生ディレクトリは存在するが対象ファイルは旧 zip 側にある
		// mkdir は与えたパスの親ディレクトリを作るため、ダミーの子パスを渡す
		mkdir(path.resolve(snapshotDir, 'placeholder'));
		try {
			const result = await archive.getHtmlOfPage(
				`${Archive.SNAPSHOT_HTML_DIR}/${pageId1}.html`,
			);
			expect(result).toBe(html1);
		} finally {
			await remove(snapshotDir);
		}
	});
});

describe('getHtmlOfPage: 破損zipのキャッシュ追い出し', () => {
	const tmpDirPattern = path.resolve(
		workingDir,
		Archive.TMP_DIR_PREFIX + 'accessor-evict-test',
	);
	const archiveFilePath = path.resolve(workingDir, 'accessor-evict-test.nitpicker');
	let archive: Archive;
	let snapshotDir: string;
	let pageId: number;
	const html = '<html><body>evict test page</body></html>';

	beforeAll(async () => {
		archive = await Archive.create({
			filePath: archiveFilePath,
			cwd: workingDir,
		});
		pageId = await archive.setPage(makePageData('/evict-page', html));
		snapshotDir = path.resolve(archive.tmpDir, Archive.SNAPSHOT_HTML_DIR);
		await zip(`${snapshotDir}.zip`, snapshotDir);
		await remove(snapshotDir);
	});

	afterAll(async () => {
		await archive.close().catch(() => {});
		await remove(tmpDirPattern).catch(() => {});
		await remove(archiveFilePath).catch(() => {});
	});

	it('破損zipで失敗したキャッシュは追い出され、zipが直れば再読込できる', async () => {
		const zipPath = `${snapshotDir}.zip`;
		const backupPath = `${snapshotDir}.zip.bak`;
		// 正常な zip を退避して破損 zip に差し替える（キャッシュは未充填の状態）
		await fs.rename(zipPath, backupPath);
		await outputText(zipPath, 'this is not a zip file');
		try {
			await expect(
				archive.getHtmlOfPage(`${Archive.SNAPSHOT_HTML_DIR}/${pageId}.html`),
			).rejects.toThrow();
		} finally {
			// 正常な zip に復元
			await fs.rename(backupPath, zipPath);
		}
		// 失敗した Promise がキャッシュに残っていなければ、復元後の読み取りは成功する
		const result = await archive.getHtmlOfPage(
			`${Archive.SNAPSHOT_HTML_DIR}/${pageId}.html`,
		);
		expect(result).toBe(html);
	});
});
