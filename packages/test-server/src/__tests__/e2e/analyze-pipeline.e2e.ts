import type { Report } from '@nitpicker/types';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Nitpicker } from '@nitpicker/core';
import {
	Archive,
	CrawlerOrchestrator,
	populateMigrationTables,
} from '@nitpicker/crawler';
import { getViolations } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * crawl → write → analyze のクロスパッケージ統合テスト。
 *
 * crawler が書いた .nitpicker アーカイブ（zip 化された HTML スナップショット）を
 * core の Nitpicker が開き、analyze プラグインの WorkerPool が
 * `page.getHtml()`（zip ストリーミング読み取り）経由で全ページの HTML を
 * 取得できることをエンドツーエンドで検証する。
 */
describe('Analyze pipeline (crawl → write → analyze)', () => {
	let cwd: string;
	let filePath: string;
	let nitpicker: Nitpicker;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-analyze-e2e-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		// 1) クロールして .nitpicker を書き出す（スナップショットは zip 化される）
		const orchestrator = await CrawlerOrchestrator.crawling(
			['http://localhost:8010/meta/'],
			{
				cwd,
				interval: 0,
				parallels: 1,
				image: false,
			},
		);
		filePath = orchestrator.archive.filePath;
		await populateMigrationTables(orchestrator.archive);
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// 2) core 側で開き直して analyze を実行（軽量な main-contents のみ）
		const archive = await Archive.open({ filePath, cwd, openPluginData: true });
		nitpicker = new Nitpicker(archive);
		await nitpicker.analyze(['@nitpicker/analyze-main-contents']);
	}, 240_000);

	afterAll(async () => {
		await nitpicker?.archive.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('analyze 結果のレポートがアーカイブに保存される', async () => {
		const report = await nitpicker.archive.getData<Report>('analysis/report');
		expect(report).toBeDefined();
		expect(report.pageData).toBeDefined();
		expect(report.violations).toBeUndefined();

		const violations = await getViolations(nitpicker.archive);
		expect(violations).toEqual({ items: [], total: 0 });
	});

	it('クロールした internal ページが zip スナップショット経由で分析される', async () => {
		const report = await nitpicker.archive.getData<Report>('analysis/report');
		const analyzedUrls = Object.keys(report.pageData!.data);
		// /meta/ 配下の internal ページの HTML が WorkerPool に渡り、
		// per-URL のデータが生成されている（HTML が読めなければ 0 件になる）
		expect(analyzedUrls.length).toBeGreaterThan(0);
		expect(analyzedUrls).toContain('http://localhost:8010/meta/full');
	});
});
