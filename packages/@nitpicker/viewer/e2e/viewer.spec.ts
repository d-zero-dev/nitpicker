import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

/**
 * MPA pagination is the viewer's default mode. These tests assume that
 * default — the `infinite scroll (virtual mode)` describe block at the
 * bottom flips the preference via localStorage to cover the opt-in path.
 */

/**
 * Asserts that the active filter popover is visible and fully inside viewport.
 * @param page - Playwright page.
 */
async function expectPopoverInViewport(page: Page) {
	const popover = page.locator('.pt-filter-popover');
	await expect(popover).toBeVisible();
	const box = await popover.boundingBox();
	const viewport = page.viewportSize();
	expect(box).not.toBeNull();
	expect(box?.width).toBeGreaterThan(0);
	expect(box?.height).toBeGreaterThan(0);
	expect(box?.x).toBeGreaterThanOrEqual(0);
	expect(box?.y).toBeGreaterThanOrEqual(0);
	expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
	expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
}

test.describe('Nitpicker Viewer', () => {
	test('サマリーダッシュボードが表示される', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Summary', level: 1 })).toBeVisible();
		await expect(page.locator('.card-value').first()).toBeVisible();
	});

	test('ページ一覧が MPA ページネーションで表示される', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await expect(page.locator('.pager')).toBeVisible();
	});

	test('ページ詳細と HTML スナップショットプレビューが表示される', async ({ page }) => {
		await page.goto('/pages');
		await page.locator('.pt-row .link-button').first().click();
		await expect(
			page.getByRole('heading', { name: 'Page detail', level: 1 }),
		).toBeVisible();
		await expect(page.locator('.detail-grid').first()).toBeVisible();
		await expect(page.locator('.hp-frame')).toBeVisible();
	});

	test('ページ詳細にメインコンテンツのセレクタと見出し明細が表示される', async ({
		page,
	}) => {
		await page.goto('/pages');
		await page.locator('.pt-row .link-button').first().click();
		await expect(
			page.getByRole('heading', { name: 'Page detail', level: 1 }),
		).toBeVisible();
		await expect(page.getByText('main.l-main')).toBeVisible();
		await expect(page.getByRole('heading', { name: /Headings|見出し/ })).toBeVisible();
		await expect(page.getByText('H1: Page 0')).toBeVisible();
	});

	test('ページ一覧にメインコンテンツの列が表示される', async ({ page }) => {
		await page.goto('/pages');
		await expect(
			page.getByRole('columnheader', { name: 'main content selector' }),
		).toBeVisible();
		await expect(
			page.getByRole('columnheader', { name: '# main content words' }),
		).toBeVisible();
	});

	test('サイドバーから各ビューへ遷移できる', async ({ page }) => {
		await page.goto('/');
		// `exact: true` so "Resources" does not also match the "Unused
		// Resources" nav entry (substring match would resolve to 2 links).
		await page.getByRole('link', { name: 'Resources', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Resources', level: 1 }),
		).toBeVisible();
		await page.getByRole('link', { name: 'Broken Links' }).click();
		await expect(
			page.getByRole('heading', { name: 'Broken Links', level: 1 }),
		).toBeVisible();
	});

	test('各ビューに解説文が見出し直後に表示される', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.view-header .view-description')).toBeVisible();
	});

	test('外部リンクは宛先ごとに1行へ集約され、参照元数が正しく表示される', async ({
		page,
	}) => {
		await page.goto('/external-links');
		await expect(
			page.getByRole('heading', { name: 'External Links', level: 1 }),
		).toBeVisible();
		// The fixture has two internal pages linking to the same external
		// destination — this must render as ONE row, not two.
		await expect(page.locator('.pt-row')).toHaveCount(1);
		await expect(page.locator('.pt-row').first()).toContainText('external.example.com');
		await expect(page.locator('.pt-row').first()).toContainText('2');
	});

	test('外部リンクの宛先をクリックすると Page Detail から被リンクへの導線が確認できる', async ({
		page,
	}) => {
		await page.goto('/external-links');
		await page.locator('.pt-row .link-button').first().click();
		await expect(
			page.getByRole('heading', { name: 'Page detail', level: 1 }),
		).toBeVisible();
		// Two internal pages (0 and 1) link to this destination — see the
		// fixture's anchorList setup above. The full inbound-links list and
		// its own dedicated fixture have their own coverage in
		// `inbound-links.spec.ts`; this only checks the count surfaces on
		// Page Detail for an external destination.
		await expect(page.getByText('Inbound links (2)')).toBeVisible();
		// External pages are never scraped — the HTML snapshot / outbound
		// links sections are not meaningful and must not render.
		await expect(page.getByRole('heading', { name: /Outbound links/ })).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'HTML snapshot' })).toHaveCount(0);
	});

	test('テーマを切り替えられる', async ({ page }) => {
		await page.goto('/');
		const html = page.locator('html');
		const initial = await html.getAttribute('data-theme');
		await page.getByRole('button', { name: /mode/i }).click();
		await expect(html).not.toHaveAttribute('data-theme', initial ?? '');
	});

	test('言語を日本語に切り替えられる', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'en');
		await page.locator('.lang-select').selectOption('ja');
		await expect(page.getByRole('heading', { name: 'サマリー', level: 1 })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
	});

	test('ネットワークグラフが描画される', async ({ page }) => {
		await page.goto('/graph');
		await expect(
			page.getByRole('heading', { name: 'Network Graph', level: 1 }),
		).toBeVisible();
		await expect(page.locator('.graph-meta')).toContainText('nodes');
		await expect(page.locator('.graph-canvas canvas').first()).toBeVisible();
	});

	test('フッターにアーカイブの絶対パスが表示される', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('.footer-path')).toContainText('.nitpicker');
	});

	test('Connection Failures ビューに遷移して見出しと解説が表示される', async ({
		page,
	}) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Connection Failures' }).click();
		await expect(
			page.getByRole('heading', { name: 'Connection Failures', level: 1 }),
		).toBeVisible();
		// The fixture crawls a healthy local site, so the view renders a
		// zero-row table rather than any host×kind rows — asserting the
		// description confirms the route, nav link, API wiring, and render
		// path all resolve.
		await expect(page.locator('.view-header .view-description')).toBeVisible();
	});
});

test.describe('MPA ページネーション', () => {
	test('Pager の Next ボタンで ?page=2 へ遷移し 2 ページ目が読み込まれる', async ({
		page,
	}) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const next = page.getByRole('button', { name: 'Next' });
		await next.click();
		await expect(page).toHaveURL(/[?&]page=2(?:&|$)/);
		await expect(page.locator('.pt-row').first()).toBeVisible();
	});

	test('1 ページ目では Prev が disabled', async ({ page }) => {
		await page.goto('/pages');
		const prev = page.getByRole('button', { name: 'Previous' });
		await expect(prev).toBeDisabled();
	});

	test('フィルタを変えると ?page= が消える', async ({ page }) => {
		await page.goto('/pages?page=2');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();
		const urlInput = page.getByRole('textbox', { name: 'URL pattern (%foo%)' });
		await urlInput.fill('%does-not-match%');
		await page.getByRole('button', { name: 'Apply' }).click();
		await expect(page).not.toHaveURL(/[?&]page=/);
	});

	test('フィルタの再オープン時に URL state から draft を同期する', async ({ page }) => {
		await page.goto('/pages?urlPattern=%25page-1%25');
		await expect(page.locator('.pt-row').first()).toBeVisible();

		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();
		await expect(page.getByRole('textbox', { name: 'URL pattern (%foo%)' })).toHaveValue(
			'%page-1%',
		);
		await page.getByRole('button', { name: 'Reset' }).click();
		await expect(page).not.toHaveURL(/[?&]urlPattern=/);

		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();
		await expect(page.getByRole('textbox', { name: 'URL pattern (%foo%)' })).toHaveValue(
			'',
		);
	});

	test('不正な sortBy query でも API が 500 にならない', async ({ page }) => {
		const response = await page.request.get('/api/pages?sortBy=not-a-column');
		expect(response.status()).toBe(200);
		const payload = (await response.json()) as { items: unknown[]; total: number };
		expect(payload.total).toBeGreaterThan(0);
		expect(payload.items.length).toBeGreaterThan(0);
	});

	test('Pages API は URL 昇順をデフォルトにして動的 enum facets を返す', async ({
		page,
	}) => {
		const response = await page.request.get('/api/pages?limit=25');
		expect(response.status()).toBe(200);
		const payload = (await response.json()) as {
			items: Array<{ url: string }>;
			facets?: {
				statuses?: number[];
				langs?: string[];
				types?: boolean[];
			};
		};
		const explicitResponse = await page.request.get(
			'/api/pages?limit=25&sortBy=url&sortOrder=asc',
		);
		expect(explicitResponse.status()).toBe(200);
		const explicitPayload = (await explicitResponse.json()) as {
			items: Array<{ url: string }>;
		};
		expect(payload.items.map((item) => item.url)).toEqual(
			explicitPayload.items.map((item) => item.url),
		);
		expect(payload.facets?.statuses).toContain(200);
		expect(payload.facets?.langs).toContain('ja');
		expect(payload.facets?.types).toContain(false);
	});

	test('言語・種別フィルタは動的 enum チェックボックスとして表示される', async ({
		page,
	}) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();

		for (const target of [
			{ button: 'Language', option: 'ja' },
			{ button: 'Scope', option: 'Internal' },
		]) {
			await page.getByRole('button', { name: target.button }).click();
			const dialog = page.getByRole('dialog', { name: target.button });
			await expect(dialog.getByRole('checkbox', { name: target.option })).toBeVisible();
			await expect(dialog.getByRole('radio')).toHaveCount(0);
			await dialog.getByRole('button', { name: 'Apply' }).click();
		}
	});

	test('Scope フィルタは URL に isExternal が無いとき Internal のみ既定でチェックされ、論理 OR で外部ページも含められる。全解除は「全件表示」ではなく既定（Internal のみ）に戻る', async ({
		page,
	}) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();

		await page.getByRole('button', { name: 'Scope' }).click();
		const dialog = page.getByRole('dialog', { name: 'Scope' });
		await expect(dialog.getByRole('checkbox', { name: 'Internal' })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'External' })).not.toBeChecked();

		await dialog.getByRole('checkbox', { name: 'External' }).check();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/isExternal=false/);
		await expect(page).toHaveURL(/isExternal=true/);

		await page.getByRole('button', { name: 'Scope' }).click();
		await expect(dialog.getByRole('checkbox', { name: 'Internal' })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'External' })).toBeChecked();
		await dialog.getByRole('button', { name: 'None' }).click();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).not.toHaveURL(/isExternal=/);

		// `isExternal` has a non-neutral default (Internal-only), unlike every
		// other checklist filter here — deleting the URL key doesn't mean "show
		// everything", it means "back to the default". Re-opening the dialog
		// must show Internal checked again, not both boxes empty.
		await page.getByRole('button', { name: 'Scope' }).click();
		await expect(dialog.getByRole('checkbox', { name: 'Internal' })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'External' })).not.toBeChecked();
	});

	test('ステータスフィルタは複数選択チェックボックスとして表示され、論理 OR で絞り込める', async ({
		page,
	}) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();

		await page.getByRole('button', { name: 'Status' }).click();
		const dialog = page.getByRole('dialog', { name: 'Status' });
		await expect(dialog.getByRole('checkbox', { name: '200' })).toBeVisible();
		await expect(dialog.getByRole('radio')).toHaveCount(0);

		await dialog.getByRole('checkbox', { name: '200' }).check();
		await dialog.getByRole('checkbox', { name: '404' }).check();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/status=200/);
		await expect(page).toHaveURL(/status=404/);

		// The actual multi-value OR combination against the read model is
		// covered by apply-viewer-pages-filters.spec.ts and
		// register-pages-route.spec.ts — this test only verifies the
		// checkbox UI and its URL reflection.

		await page.getByRole('button', { name: 'Status' }).click();
		await expect(dialog.getByRole('checkbox', { name: '200' })).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: '404' })).toBeChecked();
		await dialog.getByRole('button', { name: 'None' }).click();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).not.toHaveURL(/status=/);
	});

	test('Console Logs の Type フィルタも複数選択チェックボックスとして表示され、選択が URL に反映される', async ({
		page,
	}) => {
		// The type options are a static list (not derived from fixture rows),
		// so this exercises the checklist UI independently of the status
		// filter above — confirming the checkbox behavior generalizes beyond
		// a single view rather than being status-specific.
		await page.goto('/console-logs');
		await expect(
			page.getByRole('heading', { name: 'Console Logs', level: 1 }),
		).toBeVisible();

		await page.getByRole('button', { name: 'Type' }).click();
		const dialog = page.getByRole('dialog', { name: 'Type' });
		await expect(
			dialog.getByRole('checkbox', { name: 'error', exact: true }),
		).toBeVisible();
		await expect(dialog.getByRole('radio')).toHaveCount(0);

		await dialog.getByRole('checkbox', { name: 'error', exact: true }).check();
		await dialog.getByRole('checkbox', { name: 'warn' }).check();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).toHaveURL(/type=error/);
		await expect(page).toHaveURL(/type=warn/);

		await page.getByRole('button', { name: 'Type' }).click();
		await expect(
			dialog.getByRole('checkbox', { name: 'error', exact: true }),
		).toBeChecked();
		await expect(dialog.getByRole('checkbox', { name: 'warn' })).toBeChecked();
		await dialog.getByRole('button', { name: 'None' }).click();
		await dialog.getByRole('button', { name: 'Apply' }).click();
		await expect(page).not.toHaveURL(/type=/);
	});

	test('Pages の URL ソートは初期表示で昇順 active になる', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const urlHeader = page.getByRole('columnheader', { name: 'URL' });
		const sortButton = urlHeader.getByRole('button', { name: 'Sort' });
		await expect(sortButton).toHaveClass(/is-active/);
		await expect(sortButton).toHaveText('^');
	});

	test('フィルタポップオーバーは body 直下に表示される', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();

		const popover = page.locator('.pt-filter-popover');
		await expect(popover).toBeVisible();
		await expect
			.poll(async () =>
				popover.evaluate((element) => element.parentElement?.tagName.toLowerCase()),
			)
			.toBe('body');
		await expect(popover.locator('xpath=ancestor::span')).toHaveCount(0);
		await expectPopoverInViewport(page);
	});

	test('狭い画面でもフィルタポップオーバーが viewport 内に収まる', async ({ page }) => {
		await page.setViewportSize({ width: 360, height: 480 });
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();
		await expectPopoverInViewport(page);
	});

	test('代表DataTableビューでフィルタポップオーバーが viewport 内に収まる', async ({
		page,
	}) => {
		for (const target of [
			{ path: '/pages', filter: 'URL pattern (%foo%)' },
			{ path: '/broken-links', filter: 'URL pattern (%foo%)' },
		]) {
			await page.goto(target.path);
			await expect(page.locator('.pt-row').first()).toBeVisible();
			// `.first()`: `/broken-links` has both a Source and a Destination
			// column sharing the same "URL pattern (%foo%)" filter label, so
			// the role query resolves to two buttons — either one is fine for
			// this generic "does the popover fit in viewport" smoke check.
			await page.getByRole('button', { name: target.filter }).first().click();
			await expectPopoverInViewport(page);
		}
	});

	test('ページサイズ select を変えると ?pageSize= が URL に乗り localStorage にも保存される', async ({
		page,
	}) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const sizeSelect = page.getByRole('combobox', { name: 'Rows / page:' });
		await sizeSelect.selectOption('50');
		// URL is the source of truth — without `?pageSize=` in the URL a
		// shared deep-link would resolve to a different state on the receiver
		// side depending on their own localStorage hint.
		await expect(page).toHaveURL(/[?&]pageSize=50(?:&|$)/);
		// localStorage is the hint for new tabs / direct-URL visits.
		await expect
			.poll(async () =>
				page.evaluate(() => globalThis.localStorage.getItem('nitpicker-page-size')),
			)
			.toBe('50');
	});

	test('?pageSize= の deep-link が初期表示に反映される', async ({ page }) => {
		await page.goto('/pages?pageSize=50');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const sizeSelect = page.getByRole('combobox', { name: 'Rows / page:' });
		await expect(sizeSelect).toHaveValue('50');
	});

	test('ページサイズ変更時に ?page= は自動クリアされる', async ({ page }) => {
		await page.goto('/pages?page=2');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const sizeSelect = page.getByRole('combobox', { name: 'Rows / page:' });
		await sizeSelect.selectOption('50');
		await expect(page).not.toHaveURL(/[?&]page=/);
	});

	test('モード切替で MPA ↔ virtual が入れ替わる', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		// Toggle to virtual.
		await page.getByRole('button', { name: 'Switch to infinite scroll' }).click();
		await expect(page.locator('.vt-row').first()).toBeVisible();
		await expect(page.locator('.pager')).toHaveCount(0);
		// Toggle back to MPA.
		await page.getByRole('button', { name: 'Switch to per-page navigation' }).click();
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await expect(page.locator('.pager')).toBeVisible();
	});
});

test.describe('infinite scroll (virtual mode)', () => {
	test.beforeEach(async ({ page }) => {
		// Pin the localStorage preference *before* the SPA loads so the first
		// render is already in virtual mode.
		await page.addInitScript(() => {
			globalThis.localStorage.setItem('nitpicker-pagination-mode', 'virtual');
		});
	});

	test('ページ一覧が仮想スクロールで表示される', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
		await expect(page.locator('.vt-row').first()).toBeVisible();
		await expect(page.locator('.vt-meta')).toContainText('rows');
	});

	test('Broken Links ビューが仮想スクロールで表示される', async ({ page }) => {
		await page.goto('/broken-links');
		await expect(
			page.getByRole('heading', { name: 'Broken Links', level: 1 }),
		).toBeVisible();
		await expect(page.locator('.vt-row').first()).toBeVisible();
	});

	test('テーブルが ARIA の grid セマンティクスを公開する (virtual)', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.vt-row').first()).toBeVisible();
		const table = page.getByRole('table');
		await expect(table).toHaveAttribute('aria-rowcount', /\d+/);
		await expect(table).toHaveAttribute('aria-colcount', /\d+/);
		expect(await page.getByRole('columnheader').count()).toBeGreaterThan(5);
		await expect(
			page.getByRole('columnheader', { name: 'Title', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('cell').first()).toBeVisible();
	});

	test('行数表示がライブリージョンになっている (virtual)', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.vt-meta')).toHaveAttribute('aria-live', 'polite');
	});
});

test.describe('アクセシビリティ', () => {
	test('スキップリンクが最初のフォーカス要素で本文を指す', async ({ page }) => {
		await page.goto('/pages');
		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
		await expect(skip).toHaveAttribute('href', '#main-content');
		await expect(page.locator('main#main-content')).toBeVisible();
	});

	test('テーブルが ARIA の grid セマンティクスを公開する (MPA)', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-row').first()).toBeVisible();
		const table = page.getByRole('table');
		await expect(table).toHaveAttribute('aria-rowcount', /\d+/);
		await expect(table).toHaveAttribute('aria-colcount', /\d+/);
		// 列ヘッダーとデータセルがロールとして公開されること（フラットな
		// StaticText ではなく、AT がグリッドとして辿れる）。
		expect(await page.getByRole('columnheader').count()).toBeGreaterThan(5);
		// ヘッダー名にリサイザーのラベルが混入せず、列名だけで読み上げられること。
		await expect(
			page.getByRole('columnheader', { name: 'Title', exact: true }),
		).toBeVisible();
		await expect(page.getByRole('cell').first()).toBeVisible();
	});

	test('ソートボタンにアクセシブルネームがある', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.getByRole('button', { name: 'Sort' }).first()).toBeVisible();
	});

	test('フィルタポップオーバーの入力にアクセシブルネームがある', async ({ page }) => {
		await page.goto('/pages');
		await page.getByRole('button', { name: 'URL pattern (%foo%)' }).click();
		await expect(
			page.getByRole('textbox', { name: 'URL pattern (%foo%)' }),
		).toBeVisible();
	});

	test('列リサイザーが矢印キーで列幅を変更しフォーカス可能', async ({ page }) => {
		await page.goto('/pages');
		const separator = page
			.getByRole('separator', { name: 'Resize column (arrow keys)' })
			.first();
		await separator.focus();
		await expect(separator).toBeFocused();
		// 実際にキー操作して幅(aria-valuenow)が step=10 で増減することを検証する。
		// （focus と属性存在だけでは onKeyDown のリサイズロジックを保証できない）
		const before = Number(await separator.getAttribute('aria-valuenow'));
		await page.keyboard.press('ArrowRight');
		await expect(separator).toHaveAttribute('aria-valuenow', String(before + 10));
		await page.keyboard.press('ArrowLeft');
		await expect(separator).toHaveAttribute('aria-valuenow', String(before));
	});

	test('グラフ canvas にテキスト代替がある', async ({ page }) => {
		await page.goto('/graph');
		await expect(page.getByRole('img', { name: /Network graph/ })).toBeVisible();
	});

	test('行数表示がライブリージョンになっている (MPA)', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.locator('.pt-meta')).toHaveAttribute('aria-live', 'polite');
	});
});

// 全ビューのフィルタ/ソートコントロールにアクセシブルネームがあることを巡回検証する。
// （pages 以外の aria-label/select 名は個別テストが無く、回帰してもこれまで気付けなかった）
const VIEW_PATHS = [
	'/pages',
	'/resources',
	'/images',
	'/broken-links',
	'/external-links',
	'/violations',
	'/duplicates',
	'/mismatches',
	'/console-logs',
] as const;

for (const viewPath of VIEW_PATHS) {
	test(`アクセシビリティ: ${viewPath} のフォームコントロールに名前がある`, async ({
		page,
	}) => {
		await page.goto(viewPath);
		for (const role of ['combobox', 'textbox'] as const) {
			for (const control of await page.getByRole(role).all()) {
				await expect(control).toHaveAccessibleName(/\S/);
			}
		}
	});
}
