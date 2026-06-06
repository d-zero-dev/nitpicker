import path from 'node:path';

import { zip } from '@d-zero/fs/zip';
import { afterAll, describe, expect, it } from 'vitest';

import { extractMissingZipEntries } from './extract-missing-zip-entries.js';
import { outputText } from './output-text.js';
import { readText } from './read-text.js';
import { remove } from './remove.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);
const workDir = path.resolve(__dirname, '__mock__', 'extract-missing-zip-entries');

describe('extractMissingZipEntries', () => {
	afterAll(async () => {
		await remove(workDir).catch(() => {});
	});

	it('既存ファイルを上書きせず、zipの不足エントリのみ展開する', async () => {
		const srcDir = path.resolve(workDir, 'src');
		await outputText(path.resolve(srcDir, 'a.html'), 'old-a');
		await outputText(path.resolve(srcDir, 'b.html'), 'old-b');
		const zipPath = path.resolve(workDir, 'snapshot.zip');
		await zip(zipPath, srcDir);
		await remove(srcDir);

		// append 後の状態を模倣: b は新しい内容で再生成、c は新規ファイル
		await outputText(path.resolve(srcDir, 'b.html'), 'new-b');
		await outputText(path.resolve(srcDir, 'c.html'), 'new-c');

		await extractMissingZipEntries(zipPath, srcDir);

		// zip にのみ存在した a は復元される
		await expect(readText(path.resolve(srcDir, 'a.html'))).resolves.toBe('old-a');
		// ディレクトリ側の新しい b は zip の古い内容で上書きされない
		await expect(readText(path.resolve(srcDir, 'b.html'))).resolves.toBe('new-b');
		// ディレクトリ側にのみ存在する c はそのまま残る
		await expect(readText(path.resolve(srcDir, 'c.html'))).resolves.toBe('new-c');
	});

	it('展開先ディレクトリが存在しない場合は作成して全エントリを展開する', async () => {
		const srcDir = path.resolve(workDir, 'src2');
		await outputText(path.resolve(srcDir, 'x.html'), 'x');
		const zipPath = path.resolve(workDir, 'snapshot2.zip');
		await zip(zipPath, srcDir);
		await remove(srcDir);

		const destDir = path.resolve(workDir, 'dest2');
		await extractMissingZipEntries(zipPath, destDir);

		await expect(readText(path.resolve(destDir, 'x.html'))).resolves.toBe('x');
	});
});
