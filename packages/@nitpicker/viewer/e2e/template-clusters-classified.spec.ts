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

	test('path由来クラスタは共通CSSが無い旨を表示し、共通ディレクトリにフォールバックする', async ({
		page,
	}) => {
		await page.goto('/template-clusters');

		const pathCluster = page.locator('details', { hasText: '/news/' });
		await pathCluster.locator('summary').click();
		await expect(pathCluster).toContainText('(none)');
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
});
