import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Archive pipeline (.nitpicker write → reopen)', () => {
	let orchestrator: CrawlerOrchestrator;
	let tmpDir: string;
	let cwd: string;
	let reopenCwd: string;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-e2e-archive-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		orchestrator = await CrawlerOrchestrator.crawling(
			['http://localhost:8010/'],
			{
				cwd,
				recursive: false,
				image: true,
				interval: 0,
				parallels: 1,
				fetchExternal: false,
			},
			(q) => {
				q.on('error', (e) => {
					console.error('[nitpicker:e2e:archive] error:', e); // eslint-disable-line no-console
				});
			},
		);

		tmpDir = orchestrator.archive.tmpDir;
	}, 120_000);

	afterAll(async () => {
		orchestrator.garbageCollect();
		await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
		if (reopenCwd) {
			await fs.rm(reopenCwd, { recursive: true, force: true }).catch(() => {});
		}
	});

	it('ページデータの基本確認', async () => {
		const accessor = await Archive.connect(tmpDir);
		const pages = await accessor.getPages('page');
		const targetPages = pages.filter((p) => p.isTarget);

		expect(targetPages.length).toBeGreaterThanOrEqual(1);
		const page = targetPages[0]!;
		expect(page.status).toBe(200);
		expect(page.title).toBeTruthy();
	});

	it('.nitpicker ファイルの書き出し', async () => {
		await orchestrator.write();

		const filePath = orchestrator.archive.filePath;
		const stat = await fs.stat(filePath);
		expect(stat.size).toBeGreaterThan(0);
	});

	it('.nitpicker 再読み込みでデータが復元される', async () => {
		const filePath = orchestrator.archive.filePath;

		reopenCwd = path.join(os.tmpdir(), `nitpicker-e2e-reopen-${crypto.randomUUID()}`);
		await fs.mkdir(reopenCwd, { recursive: true });

		const archive = await Archive.open({ filePath, cwd: reopenCwd });

		// Archive extends ArchiveAccessor なので直接 getPages() が使える
		const pages = await archive.getPages('page');
		const targetPages = pages.filter((p) => p.isTarget);
		expect(targetPages.length).toBeGreaterThanOrEqual(1);

		await archive.close();
	});
});
