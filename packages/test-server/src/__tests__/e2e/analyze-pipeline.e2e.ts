import type { Report } from '@nitpicker/types';

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Nitpicker } from '@nitpicker/core';
import { Archive, CrawlerOrchestrator } from '@nitpicker/crawler';
import { getViolations } from '@nitpicker/query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SERVER_PORT } from './test-server-port.js';

/**
 * crawl → write → analyze のクロスパッケージ統合テスト。
 *
 * crawler が書いた .nitpicker アーカイブ（SQLite BLOB として保存された
 * HTML スナップショット）を core の Nitpicker が開き、analyze プラグインの
 * WorkerPool が `page.getHtml()` 経由で全ページの HTML を
 * 取得できることをエンドツーエンドで検証する。
 */
describe('Analyze pipeline (crawl → write → analyze)', () => {
	let cwd: string;
	let filePath: string;
	let nitpicker: Nitpicker;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-analyze-e2e-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		// 1) クロールして .nitpicker を書き出す（スナップショットは SQLite BLOB として保存される）
		const orchestrator = await CrawlerOrchestrator.crawling(
			[`http://localhost:${TEST_SERVER_PORT}/meta/`],
			{
				cwd,
				interval: 0,
				parallels: 1,
				image: false,
			},
		);
		filePath = orchestrator.archive.filePath;
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		// 2) core 側で開き直して analyze を実行（軽量な search のみ）
		const archive = await Archive.open({ filePath, cwd, openPluginData: true });
		nitpicker = new Nitpicker(archive);
		await nitpicker.analyze(['@nitpicker/analyze-search']);
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

	it('クロールした internal ページが HTML スナップショット経由で分析される', async () => {
		const report = await nitpicker.archive.getData<Report>('analysis/report');
		const analyzedUrls = Object.keys(report.pageData!.data);
		// /meta/ 配下の internal ページの HTML が WorkerPool に渡り、
		// per-URL のデータが生成されている（HTML が読めなければ 0 件になる）
		expect(analyzedUrls.length).toBeGreaterThan(0);
		expect(analyzedUrls).toContain(`http://localhost:${TEST_SERVER_PORT}/meta/full`);
	});

	it('analyze 結果が --append による再クロール後も失われない（openPluginData 回帰テスト、issue #99）', async () => {
		// 回帰対象: `Archive.open` を `openPluginData: true` なしで呼ぶと
		// `db.sqlite` 以外の tar エントリ（analyze の `setData` 出力）が
		// tmpDir に展開されず、その状態で `write()` すると黙って消える。
		//
		// beforeAll の analyze はメモリ上の tmpDir に `analysis/report` を
		// 書くのみで、この時点ではまだ `filePath` の tar 本体に永続化されて
		// いない（他のテストは同じ tmpDir から直接 getData するため、
		// これまで `.nitpicker` への書き戻しは不要だった）。この回帰
		// テストが要求する前提条件そのものなので、このテストで初めて
		// write() し、tar 本体に反映させる。このテストが本ファイル最後の
		// it() であることに依存する（以降 nitpicker.archive の tmpDir を
		// 読む他テストはない）。
		await nitpicker.archive.write();

		// 別 cwd を使うのは、beforeAll で開いたままの `nitpicker.archive`
		// が保持するロックと衝突させないため（同じ .nitpicker ファイルに
		// 対する 2 本目の writer-mode open）。
		const appendCwd = `${cwd}-append`;
		await fs.mkdir(appendCwd, { recursive: true });
		try {
			const orchestrator = await CrawlerOrchestrator.append(
				filePath,
				[`http://localhost:${TEST_SERVER_PORT}/meta/`],
				{ cwd: appendCwd, recursive: false },
			);
			await orchestrator.write();
			await orchestrator.archive.close();
			orchestrator.garbageCollect();

			const reopened = await Archive.open({
				filePath,
				cwd: appendCwd,
				openPluginData: true,
			});
			try {
				const report = await reopened.getData<Report>('analysis/report');
				expect(report).toBeDefined();
				expect(report.pageData).toBeDefined();
			} finally {
				await reopened.close();
			}
		} finally {
			await fs.rm(appendCwd, { recursive: true, force: true });
		}
	});
});

/**
 * Regression coverage for `@nitpicker/analyze-search`'s `recursiveSearch()`
 * running against a page's DOM through the *real* `WorkerPool` (real Worker
 * thread, real dynamic `import()`), rather than a directly-invoked `eachPage`
 * in the test process.
 *
 * This matters because `recursiveSearch` used to depend on a bare global
 * `Node` constructor that `page-analysis-worker.ts` copied onto `globalThis`
 * before every `eachPage` call. That exposure was removed (axe-core no
 * longer needs it — see `@nitpicker/analyze-axe`'s `injectAxe`), and the
 * describe block above never configures `keywords`/`selectors`, so it never
 * exercises `recursiveSearch` at all and would not have caught a
 * `ReferenceError: Node is not defined` regression here.
 */
describe('Analyze pipeline (keyword search through the real WorkerPool)', () => {
	let cwd: string;
	let nitpicker: Nitpicker;

	beforeAll(async () => {
		cwd = path.join(os.tmpdir(), `nitpicker-search-e2e-${crypto.randomUUID()}`);
		await fs.mkdir(cwd, { recursive: true });

		const orchestrator = await CrawlerOrchestrator.crawling(
			[`http://localhost:${TEST_SERVER_PORT}/meta/full`],
			{
				cwd,
				interval: 0,
				parallels: 1,
				image: false,
			},
		);
		const filePath = orchestrator.archive.filePath;
		await orchestrator.write();
		await orchestrator.archive.close();
		orchestrator.garbageCollect();

		const archive = await Archive.open({ filePath, cwd, openPluginData: true });
		nitpicker = new Nitpicker(archive);
	}, 240_000);

	afterAll(async () => {
		await nitpicker?.archive.close();
		await fs.rm(cwd, { recursive: true, force: true });
	});

	it('finds a keyword in page text without throwing, via a real Worker thread', async () => {
		// Matches the `<title>Full Meta Page</title>` text node — exercises
		// the `TEXT_NODE` branch of `recursiveSearch`.
		nitpicker.setPluginOverrides({
			'@nitpicker/analyze-search': { keywords: ['Full Meta Page'] },
		});
		await nitpicker.analyze(['@nitpicker/analyze-search']);

		const report = await nitpicker.archive.getData<Report>('analysis/report');
		const pageData =
			report.pageData!.data[`http://localhost:${TEST_SERVER_PORT}/meta/full`];

		expect(pageData?.['keyword:Full Meta Page']).toEqual({ value: 1 });
	});

	it('finds a keyword in an element attribute without throwing, via a real Worker thread', async () => {
		// Matches `<meta name="author" content="Yusuke Hirao">` — exercises
		// the `ELEMENT_NODE` (attribute) branch of `recursiveSearch`.
		nitpicker.setPluginOverrides({
			'@nitpicker/analyze-search': { keywords: ['Hirao'] },
		});
		await nitpicker.analyze(['@nitpicker/analyze-search']);

		const report = await nitpicker.archive.getData<Report>('analysis/report');
		const pageData =
			report.pageData!.data[`http://localhost:${TEST_SERVER_PORT}/meta/full`];

		expect(pageData?.['keyword:Hirao']).toEqual({ value: 1 });
	});
});
