import { expect, test } from '@playwright/test';

/**
 * Covers the "classification present" surface against a dedicated fixture
 * (`generate-template-clusters-fixture.mjs`) — see
 * `playwright.template-clusters.config.ts` for why a dedicated fixture is
 * needed here. The "`--templates` never run" fallback is covered separately
 * in `template-clusters.spec.ts` against the shared fixture.
 */
test.describe('Nitpicker Viewer template clusters (classified fixture)', () => {
	test('CSS由来クラスタは共通CSSファイル名を見出しに表示する', async ({ page }) => {
		await page.goto('/template-clusters');
		await expect(
			page.getByRole('heading', { name: 'Template Clusters', level: 1 }),
		).toBeVisible();

		const cssCluster = page.locator('details', { hasText: 'blog.css' });
		await expect(cssCluster.locator('summary')).toContainText('blog.css');
		await expect(cssCluster.locator('summary')).toContainText('2 pages');
	});

	test('クラスタを展開してPagesへのリンクをクリックするとtemplateKeyフィルタ付きでPagesビューに遷移する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const cssCluster = page.locator('details', { hasText: 'blog.css' });
		await cssCluster.locator('summary').click();
		await cssCluster.getByRole('link', { name: 'View pages in this cluster' }).click();

		await expect(page).toHaveURL(/\/pages\?templateKey=/);
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
		await expect(page.locator('.pt-row')).toHaveCount(2);
	});

	test('生のtemplateKeyを補足情報として表示する', async ({ page }) => {
		await page.goto('/template-clusters');

		const cssCluster = page.locator('details', { hasText: 'blog.css' });
		await cssCluster.locator('summary').click();
		await expect(cssCluster).toContainText('["css:1a2b3c4d5e6f7890","cluster:0"]');
	});

	test('7ディレクトリに分散したクラスタは上位5件のみ表示し、残りを「他Nページ」にまとめる', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const sectionsCluster = page.locator('details', { hasText: 'section-a' });
		await sectionsCluster.locator('summary').click();
		for (const section of ['a', 'b', 'c', 'd', 'e']) {
			await expect(sectionsCluster).toContainText(`section-${section}`);
		}
		for (const section of ['f', 'g']) {
			await expect(sectionsCluster).not.toContainText(`section-${section}`);
		}
		await expect(sectionsCluster).toContainText('2 other pages');
	});

	test('css由来クラスタは分類の根拠・共通DOM構造・共通パーツを表示する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const cssCluster = page.locator('details', { hasText: 'blog.css' });
		await cssCluster.locator('summary').click();
		await expect(cssCluster).toContainText('Common stylesheets');
		await expect(cssCluster).toContainText('https://example.com/blog.css');
		await expect(cssCluster).toContainText('body>h1');
		await expect(cssCluster).toContainText('Header');
	});

	test('path由来クラスタは分類の根拠にURLパスを表示し、特徴的CSSは表示しない', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const pathCluster = page.locator('details', { hasText: '/news/' });
		await pathCluster.locator('summary').click();
		await expect(pathCluster).toContainText('URL path');
		await expect(pathCluster).toContainText('news');
		await expect(pathCluster).not.toContainText('Distinctive stylesheets');
	});

	test('同一ブロッキンググループから分岐した兄弟クラスタは見出しに共通ディレクトリを併記して区別する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const docsCluster = page.locator('details', { hasText: '/docs/' });
		const helpCluster = page.locator('details', { hasText: '/help/' });
		await expect(docsCluster.locator('summary')).toContainText('docs.css');
		await expect(docsCluster.locator('summary')).toContainText('/docs/');
		await expect(helpCluster.locator('summary')).toContainText('docs.css');
		await expect(helpCluster.locator('summary')).toContainText('/help/');
	});

	test('兄弟クラスタのSiblingsセクションに相手のtemplateKeyへのリンクが表示される', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const docsCluster = page.locator('details', { hasText: '/docs/' });
		await docsCluster.locator('summary').click();
		await expect(docsCluster).toContainText('Sibling clusters');
		const siblingLink = docsCluster.getByRole('link', {
			name: '["css:9f8e7d6c5b4a3210","cluster:1"]',
		});
		await expect(siblingLink).toHaveAttribute('href', /templateKey=/);
	});

	test('冒頭サマリに総クラスタ数・分類済みページ数・1ページのみのクラスタ数を表示する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const cards = page.locator('.card');
		await expect(cards).toHaveCount(4);
		await expect(cards.nth(0)).toContainText('Clusters');
		await expect(cards.nth(0).locator('.card-value')).toHaveText('5');
		await expect(cards.nth(1)).toContainText('Classified pages');
		await expect(cards.nth(1).locator('.card-value')).toHaveText('14');
		await expect(cards.nth(2)).toContainText('Single-page clusters');
		await expect(cards.nth(2).locator('.card-value')).toHaveText('1');
		await expect(cards.nth(3)).toContainText('Blocks');
		await expect(cards.nth(3).locator('.card-value')).toHaveText('4');
	});

	test('冒頭サマリの最大クラスタ一覧は最大のクラスタから順にPagesへのリンクを表示する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const topClusters = page.getByRole('heading', { name: 'Largest clusters' });
		await expect(topClusters).toBeVisible();
		const firstItem = page.locator('ol > li').first();
		await expect(firstItem).toContainText('section-a');
		await expect(firstItem).toContainText('7 pages');
		await expect(firstItem.getByRole('link')).toHaveAttribute('href', /templateKey=/);
	});

	test('冒頭サマリのサイズ分布とブロック種別ごとの内訳を表示する', async ({ page }) => {
		await page.goto('/template-clusters');

		const row = (label: string) =>
			page
				.getByRole('row')
				.filter({ has: page.getByRole('cell', { name: label, exact: true }) });
		await expect(row('1 page')).toContainText('1');
		await expect(row('2–5 pages')).toContainText('3');
		await expect(row('6–20 pages')).toContainText('1');
		await expect(row('21+ pages')).toContainText('0');

		// css: blog + docs/help blocks → 2 blocks, 3 clusters, 5 pages.
		await expect(row('Common stylesheets').locator('td')).toHaveText([
			'Common stylesheets',
			'2',
			'3',
			'5',
		]);
		// path: news + sections blocks → 2 blocks, 2 clusters, 9 pages.
		await expect(row('URL path').locator('td')).toHaveText(['URL path', '2', '2', '9']);
	});

	test('ブロック別セクションは同じブロックから分かれた兄弟クラスタをひとつの見出しの下に並べる', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		await expect(
			page.getByRole('heading', { name: 'Clusters by block', level: 2 }),
		).toBeVisible();

		const docsBlock = page.getByRole('region', {
			name: 'Common stylesheets: docs.css (Clusters: 2, Pages: 3)',
		});
		await expect(docsBlock.locator('tbody tr')).toHaveCount(2);
		await expect(docsBlock.locator('tbody tr').nth(0)).toContainText('/docs/');
		await expect(docsBlock.locator('tbody tr').nth(1)).toContainText('/help/');
		await expect(docsBlock.getByRole('link').first()).toHaveAttribute(
			'href',
			/templateKey=/,
		);

		const newsBlock = page.getByRole('region', {
			name: 'URL path: /news/ (Clusters: 1, Pages: 2)',
		});
		await expect(newsBlock.locator('tbody tr')).toHaveCount(1);
	});

	test('複数ブロックをまたいで統合されたクラスタは各ブロックの下に現れ、統合元に他方のブロックを示す', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		// The `/news/` cluster's reason names `path:news` and `path:sections`,
		// so it is listed under both; the `sections` block's own cluster has no
		// reason and is placed by its template key alone.
		const sectionsBlock = page.getByRole('region', {
			name: 'URL path: /sections/ (Clusters: 2, Pages: 9)',
		});
		await expect(sectionsBlock.locator('tbody tr')).toHaveCount(2);
		const mergedRow = sectionsBlock.locator('tbody tr', { hasText: '/news/' });
		await expect(mergedRow.locator('td').nth(3)).toHaveText('URL path: /news/');
		await expect(
			sectionsBlock.locator('tbody tr', { hasText: 'section-a' }).locator('td').nth(3),
		).toHaveText('—');

		const newsBlock = page.getByRole('region', {
			name: 'URL path: /news/ (Clusters: 1, Pages: 2)',
		});
		await expect(newsBlock.locator('tbody tr').first().locator('td').nth(3)).toHaveText(
			'URL path: /sections/',
		);

		// Summary totals attribute the merged cluster to its first block only.
		await expect(
			page.locator('.card', { hasText: 'Blocks' }).locator('.card-value'),
		).toHaveText('4');
	});

	test('ブロック別セクションはページ数の多いブロックから順に並ぶ', async ({ page }) => {
		await page.goto('/template-clusters');

		const headings = page.locator('section section h3');
		await expect(headings).toHaveCount(4);
		// sections: 7 own + 2 merged-in = 9; docs: 3; blog: 2; news: 2.
		await expect(headings.nth(0)).toContainText('/sections/');
		await expect(headings.nth(1)).toContainText('docs.css');
	});

	test('クラスタ選定理由が保存されていないクラスタは未保存の旨と実行コマンドを表示する', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const sectionsCluster = page.locator('details', { hasText: 'section-a' });
		await sectionsCluster.locator('summary').click();
		await expect(sectionsCluster).toContainText(
			'No cluster-selection evidence was captured for this cluster.',
		);
		await expect(sectionsCluster).toContainText(
			'npx @nitpicker/cli analyze <archive> --templates',
		);
	});
});
