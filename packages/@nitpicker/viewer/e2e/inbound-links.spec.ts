import { expect, test } from '@playwright/test';

/**
 * Covers issue #235's split of inbound links out of Page Detail into a
 * dedicated, paginated view, against the dedicated fixture (see
 * `generate-inbound-links-fixture.mjs` — its `viewer_anchor_facts` read
 * model is built explicitly, unlike the shared `generate-fixture.mjs`
 * fixture used by `viewer.spec.ts`).
 *
 * Fixture layout: `/target` has 101 referrers (`/referrer-0`..`/referrer-100`,
 * exceeding the default MPA page size so Next/virtual-scroll pagination has
 * a real second page), and `/lonely-target` has none.
 */
test.describe('Nitpicker Viewer inbound links', () => {
	test('Page Detail は被リンク件数とリンクを表示し、クリックで一覧ビューに遷移する', async ({
		page,
	}) => {
		await page.goto(
			`/pages/detail?url=${encodeURIComponent('https://example.com/target')}`,
		);
		await expect(
			page.getByRole('heading', { name: 'Page detail', level: 1 }),
		).toBeVisible();
		await expect(page.getByText('Inbound links (101)')).toBeVisible();

		await page.getByRole('link', { name: 'View all inbound links' }).click();

		await expect(
			page.getByRole('heading', { name: 'Inbound links', level: 1 }),
		).toBeVisible();
		await expect(page.getByText('https://example.com/referrer-0')).toBeVisible();
	});

	test('MPA ページネーションで Next を押すと2ページ目の行が読み込まれる', async ({
		page,
	}) => {
		await page.goto(
			`/pages/inbound-links?url=${encodeURIComponent('https://example.com/target')}`,
		);
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await expect(page.locator('.pt-row')).toHaveCount(100);
		const next = page.getByRole('button', { name: 'Next' });
		await next.click();
		await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await expect(page.locator('.pt-row')).toHaveCount(1);
	});

	test('Page Detail から被リンク0件のページでは一覧へのリンクが表示されない', async ({
		page,
	}) => {
		await page.goto(
			`/pages/detail?url=${encodeURIComponent('https://example.com/lonely-target')}`,
		);
		await expect(page.getByRole('heading', { name: 'Inbound links (0)' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'View all inbound links' })).toHaveCount(
			0,
		);
	});

	test('存在しない URL への直接アクセスではページが見つからないエラーが表示される', async ({
		page,
	}) => {
		await page.goto(
			`/pages/inbound-links?url=${encodeURIComponent('https://example.com/nonexistent')}`,
		);
		await expect(
			page.getByRole('heading', { name: 'Inbound links', level: 1 }),
		).toBeVisible();
		await expect(page.getByText(/Page not found/i)).toBeVisible();
	});

	test.describe('virtual scroll', () => {
		test.beforeEach(async ({ page }) => {
			// Pin the localStorage preference *before* the SPA loads so the
			// first render is already in virtual mode.
			await page.addInitScript(() => {
				globalThis.localStorage.setItem('nitpicker-pagination-mode', 'virtual');
			});
		});

		test('被リンク一覧が仮想スクロールで表示される', async ({ page }) => {
			await page.goto(
				`/pages/inbound-links?url=${encodeURIComponent('https://example.com/target')}`,
			);
			await expect(page.locator('.vt-row').first()).toBeVisible();
			await expect(page.locator('.vt-meta')).toContainText('101');
		});
	});
});
