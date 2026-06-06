import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('Resource reuse', () => {
	let result: CrawlResult;
	let requests: { method: string; path: string }[];

	beforeAll(async () => {
		// 共有サーバーの観測ログを先行テストの蓄積からリセットする
		// （リセットに失敗すると完全一致アサーションが壊れるため必ず成功を確認）
		const reset = await fetch('http://localhost:8010/resource-reuse/__stats', {
			method: 'DELETE',
		});
		if (!reset.ok) {
			throw new Error(`__stats reset failed: ${reset.status}`);
		}
		result = await crawl(['http://localhost:8010/resource-reuse/']);
		const res = await fetch('http://localhost:8010/resource-reuse/__stats');
		requests = await res.json();
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('サブリソースとして取得済みの直リンク画像には HEAD が飛ばない（レンダリング時の1回のみ）', () => {
		const counted = requests.filter((r) => r.path === '/resource-reuse/counted.png');
		expect(counted).toHaveLength(1);
		expect(counted[0]!.method).toBe('GET');
	});

	it('再利用された画像も pages に記録される', async () => {
		const pages = await result.accessor.getPages();
		const page = pages.find((p) => p.url.pathname === '/resource-reuse/counted.png');
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.contentType).toBe('image/png');
	});

	it('再利用された画像は resources にも記録される', async () => {
		const resources = await result.accessor.getResources();
		const resource = resources.find((r) => r.url.includes('/resource-reuse/counted.png'));
		expect(resource).toBeDefined();
		expect(resource!.status).toBe(200);
		expect(resource!.contentType).toBe('image/png');
	});

	it('サブリソースに無い直リンク画像は従来どおり HEAD でフォールバックする', () => {
		const uncounted = requests.filter((r) => r.path === '/resource-reuse/uncounted.png');
		expect(uncounted).toHaveLength(1);
		expect(uncounted[0]!.method).toBe('HEAD');
	});

	it('フォールバックした画像も pages に記録される', async () => {
		const pages = await result.accessor.getPages();
		const page = pages.find((p) => p.url.pathname === '/resource-reuse/uncounted.png');
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.contentType).toBe('image/png');
	});

	it('リダイレクトするサブリソース（非2xx行）は再利用せず HEAD でフォールバックする', () => {
		const redirected = requests.filter(
			(r) => r.path === '/resource-reuse/redirected.png',
		);
		// 1回目: ブラウザレンダリング時の GET（301 を観測）
		// 2回目: 直リンク処理時の HEAD フォールバック
		expect(redirected.map((r) => r.method)).toEqual(['GET', 'HEAD']);
	});

	it('リダイレクト画像の pages 行はリダイレクト追跡済みの最終ステータスを持つ', async () => {
		const pages = await result.accessor.getPages();
		const page = pages.find((p) => p.url.pathname === '/resource-reuse/redirected.png');
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.contentType).toBe('image/png');
	});

	it('external サブリソース（127.0.0.1）への直リンクも再利用され HEAD が飛ばない', () => {
		const ext = requests.filter((r) => r.path === '/resource-reuse/ext.png');
		expect(ext.map((r) => r.method)).toEqual(['GET']);
	});

	it('再利用された external 画像は isTarget=false で pages に記録される', async () => {
		const pages = await result.accessor.getPages();
		const page = pages.find(
			(p) =>
				p.url.hostname === '127.0.0.1' && p.url.pathname === '/resource-reuse/ext.png',
		);
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.contentType).toBe('image/png');
		expect(page!.isTarget).toBe(false);
	});
});

describe('Resource reuse (list mode)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		// list mode (recursive: false): the root page is fully rendered, and every
		// discovered anchor — internal ones included — is queued as metadataOnly
		result = await crawl(['http://localhost:8010/resource-reuse/'], { list: true });
	}, 120_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('metadataOnly の internal 画像も再利用され isTarget=false で記録される', async () => {
		const pages = await result.accessor.getPages();
		const page = pages.find((p) => p.url.pathname === '/resource-reuse/counted.png');
		expect(page).toBeDefined();
		expect(page!.status).toBe(200);
		expect(page!.contentType).toBe('image/png');
		expect(page!.isTarget).toBe(false);
	});
});
