import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

/**
 * Escapes regex metacharacters so a literal directory name can be embedded
 * in a `new RegExp(...)` template without being interpreted as a pattern.
 * @param text - The literal text to escape.
 * @returns `text` with every regex metacharacter backslash-escaped.
 */
function escapeRegExp(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locates a tree row's `.tree-row` element by its exact directory name
 * (never a substring match). Resolves to `.tree-row`, NOT the enclosing
 * `<li class="tree-node">` — a directory's `<li>` also contains its
 * expanded children's `<li>`s (as `.tree-children` siblings of its own
 * `.tree-row`), so scoping to `.tree-node` would make `.tree-label` /
 * `.tree-toggle` lookups ambiguously match both this row and its children's.
 * @param page - The Playwright page.
 * @param name - The directory's exact name (e.g. `'docs'`, not `'doc'`).
 * @returns A locator for that name's `.tree-row` element.
 */
function treeRow(page: Page, name: string) {
	return page
		.locator('.tree-name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) })
		.locator('xpath=ancestor::div[contains(@class, "tree-row")][1]');
}

/**
 * Covers #156's acceptance criteria against the dedicated directory-tree
 * fixture (see `generate-directory-tree-fixture.mjs` — its `viewer_directory_*`
 * read model is built explicitly, unlike the shared `generate-fixture.mjs`
 * fixture used by `viewer.spec.ts`).
 *
 * Fixture layout (see the generator for the full rationale):
 * - `/docs/` (depth 1): 120 direct pages (pagination) + child dir `guide/`.
 * - `/docs/guide/` (depth 2): a leaf directory (no child directories).
 * - `/blog/2023/07/` (depth 3): the initial payload's boundary node — has
 *   both a direct page and a child directory (`22/`, depth 4) that is absent
 *   from the initial payload and must be fetched dynamically.
 * - `/blog/2023/07/22/` (depth 4): reached only via the dynamic fetch above;
 *   itself a leaf directory.
 */
test.describe('Nitpicker Viewer directory tree', () => {
	test('初期ロードで depth ≤ 3 のツリーが展開済みで表示される', async ({ page }) => {
		await page.goto('/directory-tree');
		await expect(
			page.getByRole('heading', { name: 'Directory Tree', level: 1 }),
		).toBeVisible();
		// depth < 3 nodes default to expanded, so docs/blog (depth 1) and their
		// depth 2/3 descendants are visible without any click.
		await expect(treeRow(page, 'docs')).toBeVisible();
		await expect(treeRow(page, 'blog')).toBeVisible();
		await expect(treeRow(page, 'guide')).toBeVisible();
		await expect(treeRow(page, '2023')).toBeVisible();
		await expect(treeRow(page, '07')).toBeVisible();
	});

	test('葉ディレクトリ（子ディレクトリなし）には展開矢印が表示されない', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		const guideRow = treeRow(page, 'guide');
		await expect(guideRow.locator('.tree-toggle')).toHaveCount(0);
		await expect(guideRow.locator('.tree-toggle-spacer')).toBeVisible();
	});

	test('未展開の境界ノードをクリックすると子ディレクトリが動的に取得される', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		// `07` (depth 3) starts collapsed — its child `22` (depth 4) is absent
		// from the initial payload and must not be visible before the click.
		await expect(page.locator('.tree-name', { hasText: /^22$/ })).toHaveCount(0);

		await treeRow(page, '07').locator('.tree-toggle').click();

		await expect(page.locator('.tree-name', { hasText: /^22$/ })).toBeVisible();
		// The dynamically fetched `22` node is itself a leaf (no further child
		// directories) — no expand arrow.
		const post22Row = treeRow(page, '22');
		await expect(post22Row.locator('.tree-toggle')).toHaveCount(0);
	});

	test('ディレクトリを選択すると直下ページ一覧がページネーション込みで表示される', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		await treeRow(page, 'docs').locator('.tree-label').click();
		await expect(page.locator('.directory-pages-panel')).toBeVisible();
		await expect(page.locator('.directory-pages-panel .vt-row').first()).toBeVisible();
		// 120 direct pages exceed the 100/page infinite-scroll page size, so
		// scrolling the pages panel to the bottom must load a second page.
		const scroller = page.locator('.directory-pages-panel .vt-scroll');
		const initialRowCount = await page.locator('.directory-pages-panel .vt-row').count();
		await scroller.evaluate((el) => {
			el.scrollTop = el.scrollHeight;
		});
		await expect
			.poll(async () => page.locator('.directory-pages-panel .vt-row').count())
			.toBeGreaterThan(initialRowCount);
	});

	test('直下ページが0件のディレクトリを選択すると空状態メッセージが表示される', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		// `/blog/2023/` has no direct page of its own — only its child dir `07/`.
		await treeRow(page, '2023').locator('.tree-label').click();
		await expect(page.locator('.directory-pages-panel')).toHaveCount(0);
		await expect(page.getByText('No pages directly in this folder.')).toBeVisible();
	});

	test('展開済みノードをクリックすると畳まれる', async ({ page }) => {
		await page.goto('/directory-tree');
		// `guide` (depth 2, under `docs`) is expanded by default (depth < 3).
		await expect(treeRow(page, 'guide')).toBeVisible();
		await treeRow(page, 'docs').locator('.tree-toggle').click();
		await expect(treeRow(page, 'guide')).toHaveCount(0);
	});

	test('depth ≤ 3 のノード選択はリロード後も ?nodeId= から復元される', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		await treeRow(page, 'docs').locator('.tree-label').click();
		await expect(page).toHaveURL(/nodeId=/);
		await expect(page.locator('.directory-pages-panel')).toBeVisible();

		await page.reload();

		await expect(page.locator('.directory-pages-panel')).toBeVisible();
		await expect(page.locator('.directory-pages-panel .vt-row').first()).toBeVisible();
	});

	test('ナビゲーション経由でディレクトリツリービューへ遷移できる', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Directory Tree' }).click();
		await expect(
			page.getByRole('heading', { name: 'Directory Tree', level: 1 }),
		).toBeVisible();
	});
});
