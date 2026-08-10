import { expect, test } from '@playwright/test';

/**
 * Covers the Crawl Suppression view (issue #271) against a dedicated
 * fixture (`generate-crawl-suppression-fixture.mjs`) — see
 * `playwright.crawl-suppression.config.ts` for why a dedicated fixture is
 * needed here.
 */
test.describe('Nitpicker Viewer crawl suppression', () => {
	test('リード文に検知件数（2件）を表示する', async ({ page }) => {
		await page.goto('/crawl-suppression');
		await expect(
			page.getByRole('heading', { name: 'Crawl Suppression', level: 1 }),
		).toBeVisible();
		await expect(page.getByText('2 location(s)')).toBeVisible();
	});

	test('確定済みイベントは取り込みページ数・一覧リンク・遮断URL数を表示する', async ({
		page,
	}) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'news/date' }).first();
		await event.locator('summary').first().click();
		await expect(event).toContainText('2');
		await expect(event.getByRole('link', { name: 'View pages' })).toBeVisible();
		await expect(event).toContainText('42');
	});

	test('一覧リンクをクリックするとdedupeCapEventIdフィルタ付きでPagesビューに遷移する', async ({
		page,
	}) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'news/date' }).first();
		await event.locator('summary').first().click();
		await event.getByRole('link', { name: 'View pages' }).click();

		await expect(page).toHaveURL(/\/pages\?dedupeCapEventId=/);
		await expect(
			page.getByText(/Showing pages captured by crawl suppression/),
		).toBeVisible();
	});

	test('未確定イベントは遮断URL数を「未確定」表示し、一覧リンクを出さない', async ({
		page,
	}) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'search' }).first();
		await event.locator('summary').first().click();
		await expect(event).toContainText('Not finalized');
		await expect(event.getByRole('link', { name: 'View pages' })).toHaveCount(0);
	});

	test('未取り込みのサンプルURLはリンクにならずテキストのまま表示される', async ({
		page,
	}) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'search' }).first();
		await event.locator('summary').first().click();
		await expect(event.getByText('https://example.com/search/?page=999')).toBeVisible();
		await expect(
			event.getByRole('link', { name: 'https://example.com/search/?page=999' }),
		).toHaveCount(0);
	});

	test('折りたたみ内に実効閾値・観測数・body_hashの技術詳細を表示する', async ({
		page,
	}) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'news/date' }).first();
		await event.locator('summary').first().click();
		await event.getByText('Technical details').click();
		await expect(event).toContainText('Effective threshold');
		await expect(event).toContainText('Observed count');
		await expect(event).toContainText('Body hash');
	});

	test('取り込み済みのサンプルURLはページ詳細へのリンクになる', async ({ page }) => {
		await page.goto('/crawl-suppression');

		const event = page.locator('details').filter({ hasText: 'news/date' }).first();
		await event.locator('summary').first().click();
		await event
			.getByRole('link', { name: 'https://example.com/news/date/2020/' })
			.click();

		await expect(page).toHaveURL(/\/pages\/detail\?url=/);
	});

	test('ページ詳細からクロール抑制ビューの該当イベントへ逆リンクできる', async ({
		page,
	}) => {
		await page.goto(
			`/pages/detail?url=${encodeURIComponent('https://example.com/news/date/2020/')}`,
		);
		await page.getByRole('link', { name: 'example.com/news/date/{n}/' }).click();

		await expect(page).toHaveURL(/\/crawl-suppression#event-/);
		const event = page.locator('details[open]').filter({ hasText: 'news/date' });
		await expect(event).toBeVisible();
	});
});
