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
 *   from the initial payload and must be fetched dynamically. Also has a
 *   direct non-HTML resource (`banner.jpg`) alongside its direct page.
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

	test('rootノードには展開矢印が表示されず、常に展開されている', async ({ page }) => {
		await page.goto('/directory-tree');
		const rootRow = treeRow(page, '/');
		await expect(rootRow.locator('.tree-toggle')).toHaveCount(0);
		await expect(rootRow.locator('.tree-toggle-spacer')).toBeVisible();
		// root's own children (docs/blog) are visible without any click —
		// there is no way to collapse root to hide them.
		await expect(treeRow(page, 'docs')).toBeVisible();
		await expect(treeRow(page, 'blog')).toBeVisible();
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

	test('ディレクトリを選択すると Pages ビューへ directory フィルタ付きで遷移する', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		await treeRow(page, 'docs').locator('.tree-label').click();
		await expect(page).toHaveURL(/\/pages\?directory=/);
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
		await expect(page.locator('.pt-row').first()).toBeVisible();
	});

	test('directory フィルタは選択したディレクトリの子孫ページも含めてマッチする（境界越え）', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		// `/blog/` itself has no direct page — only descendants: `2023/07/report`
		// (depth 3, within the initial payload), `2023/07/22/post-a` (depth 4,
		// only ever reachable via dynamic fetch in the tree), and
		// `2023/07/banner.jpg` (a non-HTML resource, excluded by the
		// `contentTypeCategory=html` param the tree navigates with). The
		// Pages view's `directory` filter is a plain SQL LIKE match, so the
		// two HTML pages surface without any tree expansion, but the image
		// does not.
		await treeRow(page, 'blog').locator('.tree-label').click();
		await expect(page.locator('.pt-row')).toHaveCount(2);
		const rowTexts = await page.locator('.pt-row').allTextContents();
		expect(rowTexts.every((text) => text.includes('/blog/'))).toBe(true);
		expect(rowTexts.some((text) => text.includes('banner.jpg'))).toBe(false);
	});

	test('ツリーのバッジは配下の HTML ページ数のみをカウントし、画像等の非HTMLリソースは除外する', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		// `07` has a direct image (banner.jpg) alongside its direct page
		// (report) and a descendant page (22/post-a, depth 4, not yet
		// fetched). The badge must count only the 2 HTML pages, not the
		// image — this is `descendantHtmlPageCount`, not the unfiltered
		// `descendantPageCount` (which would read 3).
		// Locale is pinned to en-US in playwright.directory-tree.config.ts.
		const badge = treeRow(page, '07').locator('.tree-count');
		await expect(badge).toHaveText('2 pages');
	});

	test('展開済みノードをクリックすると畳まれる', async ({ page }) => {
		await page.goto('/directory-tree');
		// `guide` (depth 2, under `docs`) is expanded by default (depth < 3).
		await expect(treeRow(page, 'guide')).toBeVisible();
		await treeRow(page, 'docs').locator('.tree-toggle').click();
		await expect(treeRow(page, 'guide')).toHaveCount(0);
	});

	test('ナビゲーション経由でディレクトリツリービューへ遷移できる', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'Directory Tree' }).click();
		await expect(
			page.getByRole('heading', { name: 'Directory Tree', level: 1 }),
		).toBeVisible();
	});

	test('階層まで全て閉じるコントロールで指定した深さまで畳まれる', async ({ page }) => {
		await page.goto('/directory-tree');
		// `guide` (depth 2, under `docs`) is expanded by default (depth < 3).
		await expect(treeRow(page, 'guide')).toBeVisible();

		await page.locator('#tree-collapse-depth-input').fill('1');
		await page.locator('.tree-collapse-button').click();

		// depth 1 (docs) itself is still visible, but its depth-2 child collapses.
		await expect(treeRow(page, 'docs')).toBeVisible();
		await expect(treeRow(page, 'guide')).toHaveCount(0);
	});

	test('並び替えコントロールでページ数の多い順にルート直下の兄弟を並び替えられる', async ({
		page,
	}) => {
		await page.goto('/directory-tree');
		const treeNames = () => page.locator('.tree-name').allTextContents();

		// Wait for the initial tree payload to render before reading order —
		// otherwise `treeNames()` can race the fetch and see an empty list.
		await expect(treeRow(page, 'docs')).toBeVisible();

		// Default 'path' order sorts siblings alphabetically: 'blog' before 'docs'.
		const initial = await treeNames();
		expect(initial.indexOf('blog')).toBeLessThan(initial.indexOf('docs'));

		await page.locator('#tree-sort-order-select').selectOption('pagesDesc');
		await page.locator('.tree-sort-button').click();

		// 'docs' (120 pages) now sorts before 'blog' (2 pages). The sort applies
		// via a URL update (React Router navigation), which lands a render or
		// two after the click resolves — poll instead of reading `treeNames()`
		// exactly once right after the click.
		await expect
			.poll(async () => {
				const sorted = await treeNames();
				return sorted.indexOf('docs') < sorted.indexOf('blog');
			})
			.toBe(true);
	});

	test('ノード選択で Pages ビューへ遷移後、ブラウザバックすると展開状態が保持される', async ({
		page,
	}) => {
		await page.goto('/directory-tree');

		// Expand the `07` boundary node (depth 3, collapsed by default) — its
		// child `22` requires a dynamic fetch and must not be visible yet.
		await expect(page.locator('.tree-name', { hasText: /^22$/ })).toHaveCount(0);
		await treeRow(page, '07').locator('.tree-toggle').click();
		await expect(page.locator('.tree-name', { hasText: /^22$/ })).toBeVisible();

		await treeRow(page, 'docs').locator('.tree-label').click();
		await expect(page).toHaveURL(/\/pages\?directory=/);

		await page.goBack();
		await expect(
			page.getByRole('heading', { name: 'Directory Tree', level: 1 }),
		).toBeVisible();

		// The explicit expand override for `07` survived the round trip via the
		// URL (`?expanded=`), so `22` is still visible without re-clicking.
		await expect(page.locator('.tree-name', { hasText: /^22$/ })).toBeVisible();
	});
});
