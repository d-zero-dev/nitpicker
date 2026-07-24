import { expect, test } from '@playwright/test';

/**
 * Covers the "`--templates` never run" fallback against the shared fixture
 * (`generate-fixture.mjs`), which never writes a `page_templates`
 * classification. The "classification present" surface (sections, headings,
 * Pages link) is covered separately in `template-clusters-classified.spec.ts`
 * against its own dedicated fixture — see that config's own docs for why a
 * dedicated fixture is needed here (this shared fixture already has
 * CSS-free pages, and adding stylesheets here would perturb the shared
 * Resources / Unused Resources view assertions).
 */
test.describe('Nitpicker Viewer template clusters (unclassified fixture)', () => {
	test('--templates未実行のアーカイブでは案内メッセージを表示する', async ({ page }) => {
		await page.goto('/template-clusters');
		await expect(
			page.getByRole('heading', { name: 'Template Clusters', level: 1 }),
		).toBeVisible();
		await expect(page.locator('.state code')).toHaveText(
			'nitpicker analyze <archive> --templates',
		);
		await expect(page.locator('details')).toHaveCount(0);
	});

	test('ナビゲーション経由でTemplate Clustersビューへ遷移できる', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Template Clusters' }).click();
		await expect(
			page.getByRole('heading', { name: 'Template Clusters', level: 1 }),
		).toBeVisible();
	});
});
