import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type CrawlResult, cleanup, crawl } from './helpers.js';

describe('main-content extraction (real headless-browser DOM heuristic, issue: beholder 4.0.0 promotion)', () => {
	let result: CrawlResult;

	beforeAll(async () => {
		result = await crawl(['http://localhost:8010/main-content/'], { recursive: false });
	}, 60_000);

	afterAll(async () => {
		await cleanup(result);
	});

	it('detects the <main id="content" class="l-main"> element and its aggregate counts', async () => {
		const pages = await result.accessor.getPages('page');
		const page = pages.find((p) => p.url.pathname === '/main-content/')!;
		expect(page).toBeDefined();

		expect(page.mainContentNodeName).toBe('MAIN');
		expect(page.mainContentId).toBe('content');
		expect(page.mainContentClassList).toEqual(['l-main']);
		expect(page.mainContentSelector).toBe('main#content.l-main');
		expect(page.mainContentHeadingCount).toBe(2);
		expect(page.mainContentImageCount).toBe(1);
		expect(page.mainContentTableCount).toBe(1);
		expect(page.mainContentButtonCount).toBe(1);
		expect(page.mainContentIframeCount).toBe(1);
		expect(page.mainContentVideoCount).toBe(1);
		expect(page.mainContentAudioCount).toBe(1);
		expect(page.mainContentCanvasCount).toBe(1);
		expect(page.mainContentWordCount).toBeGreaterThan(0);
		expect(page.mainContentBodyWordCount).toBeGreaterThanOrEqual(
			page.mainContentWordCount!,
		);
		expect(page.scrollHeightDesktop).toBeGreaterThan(0);
		expect(page.scrollHeightMobile).toBeGreaterThan(0);
	});

	it('populates all 8 page_main_content_* child tables with real DOM values', async () => {
		const pages = await result.accessor.getPages('page');
		const page = pages.find((p) => p.url.pathname === '/main-content/')!;

		const headings = await page.getHeadings();
		expect(headings.map((h) => ({ text: h.text, level: h.level }))).toEqual([
			{ text: 'MainHeading', level: 1 },
			{ text: 'SubHeading', level: 2 },
		]);

		const images = await page.getMainContentImages();
		expect(images).toHaveLength(1);
		expect(images[0]!.alt).toBe('main image');

		const tables = await page.getMainContentTables();
		expect(tables).toEqual([
			expect.objectContaining({
				rows: 3,
				cols: 2,
				hasHeader: 1,
				hasFooter: 1,
				hasMergedCell: 1,
			}),
		]);

		const buttons = await page.getButtons();
		expect(buttons).toHaveLength(1);
		expect(buttons[0]!.nodeName).toBe('BUTTON');
		// removeSpaces() strips ALL whitespace (not just trim), collapsing "Click me".
		expect(buttons[0]!.text).toBe('Clickme'); // cspell:disable-line

		const iframes = await page.getIframes();
		expect(iframes).toHaveLength(1);
		expect(iframes[0]!.title).toBe('embedded about page');
		expect(iframes[0]!.width).toBe('300');
		expect(iframes[0]!.height).toBe('200');

		const videos = await page.getVideos();
		expect(videos).toHaveLength(1);
		expect(videos[0]!.width).toBe(640);
		expect(videos[0]!.height).toBe(360);

		const audios = await page.getAudios();
		expect(audios).toHaveLength(1);

		const canvases = await page.getCanvases();
		expect(canvases).toEqual([expect.objectContaining({ width: 300, height: 150 })]);
	});
});
