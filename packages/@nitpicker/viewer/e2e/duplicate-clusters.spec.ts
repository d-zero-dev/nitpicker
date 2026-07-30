import { expect, test } from '@playwright/test';

/**
 * Covers the Duplicate Clusters view (issue #208) against a dedicated
 * fixture (`generate-duplicate-clusters-fixture.mjs`) — see
 * `playwright.duplicate-clusters.config.ts` for why a dedicated fixture is
 * needed here.
 */
test.describe('Nitpicker Viewer duplicate clusters', () => {
	test('デフォルトのminCount(10)で12件のクラスタが表示される', async ({ page }) => {
		await page.goto('/duplicate-clusters');
		await expect(
			page.getByRole('heading', { name: 'Duplicate Clusters', level: 1 }),
		).toBeVisible();

		const cluster = page.locator('details').first();
		await expect(cluster.locator('summary')).toContainText('12 pages');
	});

	test('crawlが確認したdedupe-cap traps件数の通知を表示する', async ({ page }) => {
		await page.goto('/duplicate-clusters');
		await expect(page.getByText(/same-cluster trap/)).toBeVisible();
	});

	test('クラスタを展開するとog:url不一致率・シグネチャ・サンプルページを表示する', async ({
		page,
	}) => {
		await page.goto('/duplicate-clusters');

		const cluster = page.locator('details').first();
		await cluster.locator('summary').click();
		await expect(cluster).toContainText('Signature (body hash)');
		await expect(cluster).toContainText('og:url mismatch ratio');
		await expect(cluster).toContainText('Sample pages');
	});

	test('minCountを引き上げるとクラスタが消える', async ({ page }) => {
		await page.goto('/duplicate-clusters');
		await expect(page.locator('details')).toHaveCount(1);

		await page.getByLabel('Minimum cluster size').fill('100');
		await expect(
			page.getByText('No clusters found at or above this size.'),
		).toBeVisible();
	});

	test('共通ディレクトリのリンクをクリックするとdirectoryフィルタ付きでPagesビューに遷移する', async ({
		page,
	}) => {
		await page.goto('/duplicate-clusters');

		const cluster = page.locator('details').first();
		await cluster.locator('summary').click();
		await cluster.getByRole('link', { name: /example\.com\/news\// }).click();

		await expect(page).toHaveURL(/\/pages\?directory=/);
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
	});
});
