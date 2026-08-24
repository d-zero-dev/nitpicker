import path from 'node:path';

import { Archive } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openReportArchive } from './open-report-archive.js';

const __filename = new URL(import.meta.url).pathname;
const __dirname = path.dirname(__filename);

const BASE_CONFIG = {
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
};

describe('openReportArchive', () => {
	const workingDir = path.resolve(__dirname, '__test_fixtures_open_report_archive__');

	afterAll(async () => {
		const { rmSync } = await import('node:fs');
		rmSync(workingDir, { recursive: true, force: true });
	});

	describe('against a finished .nitpicker file', () => {
		const finishedDir = path.resolve(workingDir, 'finished-fixture');
		const finishedFilePath = path.resolve(finishedDir, 'finished.nitpicker');

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(finishedDir, { recursive: true });
			const archive = await Archive.create({
				filePath: finishedFilePath,
				cwd: finishedDir,
			});
			await archive.setConfig(BASE_CONFIG);
			await archive.write();
			await archive.close();
		});

		it('opens successfully and exposes an accessor', async () => {
			await using handle = await openReportArchive(finishedFilePath);
			const config = await handle.accessor.getConfig();
			expect(config.baseUrl).toBe('https://example.com');
		});

		it('does not expose a raw Archive writer instance on the returned handle', async () => {
			await using handle = await openReportArchive(finishedFilePath);
			expect(handle).not.toHaveProperty('archive');
		});
	});

	describe('against a live-crawl (stub) directory', () => {
		const stubDir = path.resolve(workingDir, 'stub-fixture');
		let stubTmpDir = '';

		beforeAll(async () => {
			const { mkdirSync } = await import('node:fs');
			mkdirSync(stubDir, { recursive: true });
			const archive = await Archive.create({
				filePath: path.resolve(stubDir, 'stub.nitpicker'),
				cwd: stubDir,
			});
			stubTmpDir = archive.tmpDir;
			await archive.setConfig(BASE_CONFIG);
			// Deliberately left un-written and un-closed: leaves the tmpDir
			// behind as a "live crawl in progress" fixture, mirroring
			// `archive-manager.spec.ts`'s stub-mode fixture — `releaseHandle`
			// drops the SQLite handle without writing the archive or removing
			// the tmpDir.
			await archive.releaseHandle();
		});

		it('rejects with an actionable error instead of silently reporting on a live crawl', async () => {
			await expect(openReportArchive(stubTmpDir)).rejects.toThrow(/not a completed/);
		});
	});
});
