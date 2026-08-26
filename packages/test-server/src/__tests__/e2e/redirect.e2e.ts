import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';
import { TEST_SERVER_EXTERNAL_ORIGIN, TEST_SERVER_ORIGIN } from './test-server-port.js';

describe('Redirect handling', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/redirect/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('リダイレクトチェーンを辿って最終ページをスクレイプする', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();
		expect(dest!.title).toBe('Redirect Destination');
		expect(dest!.status).toBe(200);
	});

	it('リダイレクト元ページもDBに記録される', async () => {
		// getPages() (フィルタなし) で全ページを取得し、リダイレクト元の存在を確認
		const allPages = await result.accessor.getPages();
		const startPage = allPages.find((p) => p.url.href.includes('/redirect/start'));
		expect(startPage).toBeDefined();
		// リダイレクト元はスクレイプ対象ではない（リダイレクトされるため）
		expect(startPage!.isTarget).toBe(false);
	});

	it('redirectFrom でリダイレクト元URLが取得できる', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();

		expect(dest!.redirectFrom.length).toBeGreaterThan(0);
		expect(dest!.redirectFrom.some((r) => r.url.includes('/redirect/start'))).toBe(true);
	});

	it('最終ページからのリンクも収集される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();

		const anchors = await dest!.getAnchors();
		const anchorUrls = anchors.map((a) => a.url);
		expect(anchorUrls.some((u) => u.includes('/redirect/start'))).toBe(true);
	});

	it('被リンクが redirect 元経由で宛先に合算される（end-to-end, #71）', async () => {
		// /redirect/ は /redirect/start にリンクし、start は dest へ 301→302。
		// 被リンクを redirect 越しに解決するため、/redirect/start を指す /redirect/ は
		// 最終宛先 /redirect/dest の被リンクとして現れる（http→https と同じ機構を
		// http→http で end-to-end 検証）。解決しないと dest の被リンクは 0 になる。
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/redirect/dest');
		expect(dest).toBeDefined();

		const referrers = await dest!.getReferrers();
		const fromTop = referrers.find((r) => new URL(r.url).pathname === '/redirect/');
		expect(fromTop).toBeDefined();
		// through はアンカーが実際に指した URL（リダイレクト元 /redirect/start）。
		expect(new URL(fromTop!.through).pathname).toBe('/redirect/start');
	});
});

describe('Redirect convergence (#73): 多対一リダイレクト先を1回だけ描画する', () => {
	let result: CrawlResult;
	let redirectEvents = 0;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/converge/`], undefined, (q) => {
			q.on('redirect', () => {
				redirectEvents++;
			});
		});
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('3 ソース中、宛先描画後の 2 ソースは描画されず redirect 辺だけ記録される', () => {
		// legacy-1 が canonical をレンダリングして claim、legacy-2 / legacy-3 は
		// 既知の宛先なので redirect-edge（描画スキップ）になる。#73 が無いと
		// legacy-2 / legacy-3 も canonical を再描画し、redirect イベントは 0 になる。
		expect(redirectEvents).toBe(2);
	});

	it('宛先 canonical は 1 ページとして正しく記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/converge/canonical');
		expect(dest).toBeDefined();
		expect(dest!.title).toBe('Converge Canonical');
		expect(dest!.status).toBe(200);
	});

	it('3 つの legacy URL すべてが canonical へのリダイレクト元として記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/converge/canonical');
		expect(dest).toBeDefined();

		const fromPaths = dest!.redirectFrom.map((r) => new URL(r.url).pathname).toSorted();
		expect(fromPaths).toEqual([
			'/converge/legacy-1',
			'/converge/legacy-2',
			'/converge/legacy-3',
		]);
	});

	it('宛先のアンカーは集約で多重化しない（1セットだけ）', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const dest = pages.find((p) => p.url.pathname === '/converge/canonical');
		expect(dest).toBeDefined();

		const anchors = await dest!.getAnchors();
		// canonical は /converge/ への1リンクのみ。3ソース集約でも多重化しない。
		const backLinks = anchors.filter((a) => new URL(a.url).pathname === '/converge/');
		expect(backLinks).toHaveLength(1);
	});
});

describe('Redirect convergence dedup はクエリ違いの別ページを潰さない（#73 回帰）', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/query-distinct/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('パスが同じでクエリだけ違う2ページが両方とも描画・記録される', async () => {
		const pages = await result.accessor.getPages('internal-page');
		const items = pages
			.filter((p) => p.url.pathname === '/query-distinct/item')
			.map((p) => p.title)
			.toSorted();
		// #73 の dedup キーがクエリを落とすと kind=beta が kind=alpha の宛先として
		// 弾かれ、Item beta が描画されず 1 ページに潰れる。両方の固有タイトルが残ること。
		expect(items).toEqual(['Item alpha', 'Item beta']);
	});
});

describe('HEAD と GET で到達先が違っても描画した宛先で claim する（#73 #5 回帰）', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/diverge/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('ブラウザが描画した browser-dest が記録される', async () => {
		const pages = await result.accessor.getPages();
		const browserDest = pages.find((p) => p.url.pathname === '/diverge/browser-dest');
		expect(browserDest).toBeDefined();
		expect(browserDest!.title).toBe('Diverge Browser dest');
	});

	it('HEAD だけが到達する head-dest の幽霊ページが作られない', async () => {
		const pages = await result.accessor.getPages();
		const headDest = pages.find((p) => p.url.pathname === '/diverge/head-dest');
		// claim を HEAD 由来キーで行うと、2本目のソースが head-dest への辺になり
		// recordRedirect が content-less な head-dest 行を生成してしまう。描画した
		// browser-dest で claim していれば head-dest は一度も生成されない。
		expect(headDest).toBeUndefined();
	});
});

describe('metadataOnly のリダイレクト元が描画済み宛先を上書きしない（#73 #2 回帰）', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/clobber/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('外部 metadataOnly リダイレクト元が internal 宛先を external/title-only に潰さない', async () => {
		// canonical は自分自身に貼られた external リンク経由で ext を発見するため、
		// 必ず先に描画・claim される。CHECK が metadataOnly ブランチより下にあると、
		// ext の薄い title-GET 結果が updatePage 経由で canonical を isExternal=true /
		// isTarget=false に上書きし、internal-page から消える。
		const pages = await result.accessor.getPages('internal-page');
		const canonical = pages.find((p) => p.url.pathname === '/clobber/canonical');
		expect(canonical).toBeDefined();
		expect(canonical!.title).toBe('Clobber Canonical');
		expect(canonical!.isTarget).toBe(true);
	});
});

describe('クロスホストリダイレクト先の観測データは記録されない（external 反転前に張られたリスナーの取りこぼし対策）', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl([`${TEST_SERVER_ORIGIN}/cross-host/`]);
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('リダイレクト先ホストの console.warn が記録されない', async () => {
		const knex = result.accessor.getKnex();
		const rows = await knex('page_console_logs as pcl')
			.join('content_items as ci', 'ci.id', 'pcl.pageId')
			.join('url_refs as ur', 'ur.id', 'ci.url_id')
			.where('ur.url', `${TEST_SERVER_EXTERNAL_ORIGIN}/cross-host/dest`)
			.select('pcl.pageId as pageId');
		expect(rows).toHaveLength(0);
	});

	it('リダイレクト先ホストが読み込んだ CSS がリソースとして記録されない', async () => {
		const knex = result.accessor.getKnex();
		const rows = await knex('resource_items as ri')
			.join('url_refs as ur', 'ur.id', 'ri.url_id')
			.where('ur.url', `${TEST_SERVER_EXTERNAL_ORIGIN}/cross-host/dest.css`)
			.select('ri.id as id');
		expect(rows).toHaveLength(0);
	});

	it('リダイレクト辺自体は通常どおり記録される（positive pin）', async () => {
		const pages = await result.accessor.getPages();
		const dest = pages.find(
			(p) => p.url.hostname === '127.0.0.1' && p.url.pathname === '/cross-host/dest',
		);
		expect(dest).toBeDefined();
		expect(
			dest!.redirectFrom.some((r) => new URL(r.url).pathname === '/cross-host/start'),
		).toBe(true);
	});
});
