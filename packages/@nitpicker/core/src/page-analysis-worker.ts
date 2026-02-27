/**
 * Worker thread module for per-page single-plugin execution.
 *
 * This is the default export loaded by {@link ./worker/runner.ts!runner}
 * when analyzing a single page with a single plugin. It:
 *
 * 1. Dynamically imports the configured plugin via {@link importModules}
 * 2. If the plugin implements `eachPage`:
 *    - Creates a JSDOM instance from the raw HTML
 *    - Calls the plugin's `eachPage` hook with the DOM window
 *    - Closes the JSDOM window to free memory
 * 3. Returns the plugin result as {@link ReportPage} or `null`
 *
 * Each Worker invocation handles exactly one plugin, so the calling code
 * can track per-plugin progress independently.
 * @module
 */

import type { Plugin, ReportPage } from './types.js';
import type { UrlEventBus } from './url-event-bus.js';
import type { ExURL as URL } from '@d-zero/shared/parse-url';

import { JSDOM } from 'jsdom';

import { importModules } from './import-modules.js';

/**
 * Set of critical Node.js global properties that must never be overwritten
 * by JSDOM window properties.
 */
const PROTECTED_GLOBALS = new Set([
	'process',
	'global',
	'globalThis',
	'console',
	'Buffer',
	'setTimeout',
	'setInterval',
	'clearTimeout',
	'clearInterval',
	'setImmediate',
	'clearImmediate',
	'queueMicrotask',
]);

/**
 * Initial data payload for the page analysis worker.
 * Passed via `workerData` and consumed by the default export.
 *
 * Uses `type` instead of `interface` because this type must satisfy the
 * `Record<string, unknown>` constraint required by the Worker data serialization.
 */
export type PageAnalysisWorkerData = {
	/** Single analyze plugin to execute against the page. */
	plugin: Plugin;
	/** Page data containing raw HTML and parsed URL. */
	pages: { html: string; url: URL };
};

/**
 * Executes a single plugin's `eachPage` hook against a single page.
 * @template T - Column key union from the plugin's headers.
 * @param data - Contains the single plugin and page data (HTML + URL).
 * @param urlEventBus - Event bus for URL discovery events (forwarded to the main thread).
 * @param num - Zero-based index of the current page in the batch.
 * @param total - Total number of pages being processed.
 * @returns Report data from the plugin, or `null` if skipped.
 * @see {@link ./worker/runner.ts!runner} for how this function is called
 * @see {@link ./nitpicker.ts!Nitpicker.analyze} for the orchestration context
 */
export default async function <T extends string>(
	data: PageAnalysisWorkerData,
	urlEventBus: UrlEventBus,
	num: number,
	total: number,
): Promise<ReportPage<T> | null> {
	const {
		plugin,
		pages: { html, url },
	} = data;
	const [analyzeMod] = await importModules([plugin]);

	if (!analyzeMod?.eachPage) {
		return null;
	}

	await urlEventBus.emit('url', url.href);

	const dom = new JSDOM(html, {
		url: url.href,
		runScripts: 'outside-only',
	});

	// Expose JSDOM globals so that browser-oriented libraries
	// (axe-core, @medv/finder, etc.) that inspect the global scope
	// can find `window`, `document`, `Node`, and other DOM APIs.
	const g = globalThis as Record<string, unknown>;
	const domGlobalKeys: string[] = [];
	for (const key of Object.getOwnPropertyNames(dom.window)) {
		if (key in g || PROTECTED_GLOBALS.has(key)) {
			continue;
		}
		try {
			g[key] = dom.window[key as keyof typeof dom.window];
			domGlobalKeys.push(key);
		} catch {
			// Some window properties throw on access — skip them
		}
	}

	try {
		const report = await analyzeMod.eachPage({
			url,
			html,
			window: dom.window,
			num,
			total,
		});

		return report ?? null;
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error(`[${plugin.name}] ${error instanceof Error ? error.message : error}`);
		return null;
	} finally {
		for (const key of domGlobalKeys) {
			delete g[key];
		}
		dom.window.close();
	}
}
