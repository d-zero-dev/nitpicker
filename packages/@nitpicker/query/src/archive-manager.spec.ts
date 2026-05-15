import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { tryParseUrl as parseUrl } from '@d-zero/shared/parse-url';
import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ArchiveManager } from './archive-manager.js';

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
			version: '0.4.4',
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

	it('.nitpicker 以外の拡張子はエラーになる', async () => {
		const manager = new ArchiveManager();
		await expect(manager.open('/tmp/test.tar')).rejects.toThrow(
			'Invalid file type. Only .nitpicker archive files are supported.',
		);
		await expect(manager.open('/tmp/test.txt')).rejects.toThrow('Invalid file type');
	});

	it('存在しないファイルはエラーになる', async () => {
		const manager = new ArchiveManager();
		await expect(manager.open('/tmp/nonexistent.nitpicker')).rejects.toThrow(
			'Archive file not found or not readable.',
		);
	});

	it('シンボリックリンク経由で非 .nitpicker ファイルを指す場合はエラーになる', async () => {
		const manager = new ArchiveManager();
		const targetFile = path.resolve(workingDir, 'fake-target.txt');
		const symlinkFile = path.resolve(workingDir, 'link.nitpicker');
		writeFileSync(targetFile, 'not an archive');
		rmSync(symlinkFile, { force: true });
		symlinkSync(targetFile, symlinkFile);
		try {
			await expect(manager.open(symlinkFile)).rejects.toThrow('Invalid file type');
		} finally {
			rmSync(symlinkFile, { force: true });
			rmSync(targetFile, { force: true });
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
