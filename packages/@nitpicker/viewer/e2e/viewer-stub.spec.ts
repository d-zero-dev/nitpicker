import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * The viewer must accept an in-progress crawl tmpDir as its source and
 * advertise the stub state through both the API and the UI footer, while
 * never producing a `.nitpicker` file (which would silently zip up the
 * user's interrupted crawl and break `crawl --resume`).
 *
 * Asserts here mirror the user-facing contract; the underlying
 * "tmpDir untouched" invariant is exercised by the ArchiveManager unit
 * tests.
 */
test.describe('Nitpicker Viewer (stub mode)', () => {
	test('/api/info が mode=stub と crawlerPid=null を返す（中断クロール）', async ({
		request,
	}) => {
		const res = await request.get('/api/info');
		expect(res.ok()).toBe(true);
		const body = (await res.json()) as {
			filePath: string;
			mode: string;
			crawlerPid: number | null;
		};
		expect(body.mode).toBe('stub');
		// The fixture script removes the .lock sibling, so the viewer
		// must report no live crawler — i.e. an interrupted-crawl stub.
		expect(body.crawlerPid).toBeNull();
	});

	test('footer に中断クロールバッジが描画される', async ({ page }) => {
		await page.goto('/');
		// Locale pinned to en-US in playwright.stub.config.ts so the
		// English copy is the source of truth here.
		await expect(page.locator('.footer-stub-badge--interrupted')).toBeVisible();
		await expect(page.locator('.footer-stub-badge--interrupted')).toContainText(
			/Interrupted crawl stub/i,
		);
		// The misleading "Live crawl" badge must NOT appear when no
		// crawler is running.
		await expect(page.locator('.footer-stub-badge--live')).toHaveCount(0);
	});

	test('stub からページ一覧と詳細が表示できる', async ({ page }) => {
		await page.goto('/pages');
		await expect(page.getByRole('heading', { name: 'Pages', level: 1 })).toBeVisible();
		// MPA pagination is the default mode (rendered as `.pt-row`), so the
		// stub-mode smoke test asserts against the paged table rather than
		// `.vt-row`. The opt-in virtual scroll has its own coverage in the
		// main viewer.spec.ts.
		await expect(page.locator('.pt-row').first()).toBeVisible();
		await page.locator('.pt-row .link-button').first().click();
		await expect(
			page.getByRole('heading', { name: 'Page detail', level: 1 }),
		).toBeVisible();
		// `viewer_anchor_facts` can never exist in stub mode (`buildViewerReadModel`
		// refuses read-only accessors, and `viewer-build` refuses stub
		// directories) — `/api/pages/inbound-links` must respond with the
		// `{ available: false }` marker rather than the route throwing, so
		// Page Detail itself never 500s here (issue #235).
		await expect(page.getByText('Available once the crawl finishes.')).toBeVisible();
	});

	test('viewer read model 未構築のアーカイブでは空状態メッセージが表示される', async ({
		page,
	}) => {
		// A stub (in-progress crawl) can never have a read model
		// (`buildViewerReadModel` refuses read-only accessors, and
		// `viewer-build` refuses stub directories), so directory-tree's 3
		// query functions (gated on `isViewerReadModelCurrent` with no live
		// fallback) always return an empty `{ roots: [] }` here — the natural
		// place to exercise the "no read model" empty state.
		await page.goto('/directory-tree');
		await expect(
			page.getByRole('heading', { name: 'Directory Tree', level: 1 }),
		).toBeVisible();
		await expect(
			page.getByText(
				'No directory data available. Run `npx @nitpicker/cli viewer-build` to generate it.',
			),
		).toBeVisible();
	});

	test('viewer 起動中も stub の tmpDir は残存し、.nitpicker は未生成', () => {
		// Cross-check the user-facing invariant at the filesystem level: while
		// the viewer is serving the stub, the directory must still be on disk
		// and no `.nitpicker` companion file must exist next to it.
		const stubParent = path.resolve(
			path.dirname(new URL(import.meta.url).pathname),
			'.fixture-stub-cwd',
		);
		const stubDir = path.resolve(stubParent, '._nitpicker-e2e-stub');
		const nitpickerFile = path.resolve(stubParent, 'e2e-stub.nitpicker');
		expect(existsSync(stubDir)).toBe(true);
		expect(existsSync(nitpickerFile)).toBe(false);
	});
});
