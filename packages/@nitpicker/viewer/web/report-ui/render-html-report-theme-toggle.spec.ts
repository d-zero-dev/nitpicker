import type { HtmlReportData } from './types.js';

// @ts-expect-error -- `jsdom` ships no type declarations and `@types/jsdom` is not a dependency
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { renderHtmlReport } from './render-html-report.js';

vi.mock('../styles.css?inline', () => ({
	default: ':root { --bg: #0f1419; }',
}));

const data: HtmlReportData = {
	locale: 'en',
	summary: {
		baseUrl: 'https://example.com/',
		roots: ['https://example.com/'],
		maxExcludedDepth: 0,
		excludeKeywords: [],
		excludes: [],
		excludeUrls: [],
		totalPages: 0,
		internalPages: 0,
		externalPages: 0,
		internalContents: 0,
		externalContents: 0,
		statusDistribution: [],
		metadataFulfillment: {
			title: 0,
			description: 0,
			keywords: 0,
			ogTitle: 0,
			ogDescription: 0,
			ogImage: 0,
		},
		contentTypeDistribution: [],
		technologyDistribution: [],
		networkOutageAffectedFailures: 0,
		consoleLogCounts: { pageerror: 0, error: 0, warn: 0 },
	},
	pages: [],
};

/**
 * jsdom does not implement Invoker Commands, so a click does not dispatch
 * the `command` event the browser fires at the `commandfor` target (here the
 * button itself).
 * @param target - The element the browser dispatches the event on.
 * @param command - The invoker's `command` attribute value.
 */
function dispatchCommand(target: Element, command: string) {
	// The jsdom window's own `Event`: Node's global one is rejected by its `dispatchEvent`.
	const event = new (
		target.ownerDocument.defaultView as Window & typeof globalThis
	).Event('command');
	Object.defineProperty(event, 'command', { value: command });
	target.dispatchEvent(event);
}

/**
 * Loads the rendered report into jsdom with its embedded script running,
 * and waits for the `load` event (the script binds the button on `DOMContentLoaded`).
 * @returns The jsdom document and the theme toggle button.
 */
async function loadReport() {
	const dom = new JSDOM(renderHtmlReport(data), { runScripts: 'dangerously' });
	const { document } = dom.window;
	if (document.readyState !== 'complete') {
		await new Promise((resolve) => {
			dom.window.addEventListener('load', resolve);
		});
	}
	const button = document.querySelector('[data-report-theme-toggle]');
	if (!button) {
		throw new Error('the report has no theme toggle');
	}
	return { document, button };
}

describe('renderHtmlReport theme toggle script', () => {
	it('flips the theme each time the button receives --toggle-theme', async () => {
		const { document, button } = await loadReport();
		const initial = document.documentElement.dataset.theme;

		dispatchCommand(button, '--toggle-theme');
		const flipped = document.documentElement.dataset.theme;
		dispatchCommand(button, '--toggle-theme');

		expect(['dark', 'light']).toContain(initial);
		expect(flipped).not.toBe(initial);
		expect(document.documentElement.dataset.theme).toBe(initial);
	});

	it('ignores any other command', async () => {
		const { document, button } = await loadReport();
		const initial = document.documentElement.dataset.theme;

		dispatchCommand(button, '--something-else');

		expect(document.documentElement.dataset.theme).toBe(initial);
	});
});
