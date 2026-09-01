import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readUrlListFile } from './read-url-list-file.js';

/** Files this spec creates, removed in `afterEach` regardless of test outcome. */
const filesToRemove: string[] = [];

/**
 * Writes `content` to a uniquely-named file under the OS temp dir and
 * registers it for cleanup. A fresh random name per call (rather than a
 * shared fixture path) avoids the flakiness a shared temp file causes under
 * parallel test execution.
 * @param content - The file's text content.
 * @returns The absolute path to the written file.
 */
async function writeTempListFile(content: string): Promise<string> {
	const filePath = path.join(
		os.tmpdir(),
		`read-url-list-file-spec-${crypto.randomUUID()}.txt`,
	);
	await fs.writeFile(filePath, content, 'utf8');
	filesToRemove.push(filePath);
	return filePath;
}

afterEach(async () => {
	await Promise.all(filesToRemove.splice(0).map((f) => fs.rm(f, { force: true })));
});

describe('readUrlListFile', () => {
	it('valid な URL のみを urls に、invalid な行を line/column 付きで返す', async () => {
		const filePath = await writeTempListFile(
			'https://example.com/\nnot-a-url\nhttps://example.com/a\n',
		);

		const result = await readUrlListFile(filePath);

		expect(result.urls).toEqual(['https://example.com/', 'https://example.com/a']);
		expect(result.invalid).toEqual([{ value: 'not-a-url', line: 2, column: 1 }]);
	});

	it('空行と # コメント行を無視する', async () => {
		const filePath = await writeTempListFile(
			'# comment\nhttps://example.com/\n\n# another comment\nhttps://example.com/a\n',
		);

		const result = await readUrlListFile(filePath);

		expect(result.urls).toEqual(['https://example.com/', 'https://example.com/a']);
		expect(result.invalid).toEqual([]);
	});

	it('有効行が0件のときは空配列を返す（呼び出し元がエラー化を判断する）', async () => {
		const filePath = await writeTempListFile('not-a-url\nalso-not-a-url\n');

		const result = await readUrlListFile(filePath);

		expect(result.urls).toEqual([]);
		expect(result.invalid).toHaveLength(2);
	});

	it('bytes に読み込んだファイルの生バイト列をそのまま返す', async () => {
		const content = 'https://example.com/\n';
		const filePath = await writeTempListFile(content);

		const result = await readUrlListFile(filePath);

		expect(result.bytes.toString('utf8')).toBe(content);
	});
});
