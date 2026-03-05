import type { LHReport } from './types.js';
import type { Config } from 'lighthouse';

import { definePlugin } from '@nitpicker/core';
import * as chromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { ReportUtils } from 'lighthouse/report/renderer/report-utils.js';

/**
 * Plugin options for the Lighthouse analysis.
 */
type Options = {
	/**
	 * Custom Lighthouse configuration object.
	 * Passed directly to `lighthouse()` as the third argument,
	 * allowing callers to override categories, throttling, etc.
	 * @see https://github.com/GoogleChrome/lighthouse/blob/master/docs/configuration.md
	 */
	config?: unknown;
};

/**
 * Analyze plugin that runs Google Lighthouse against each page.
 *
 * A fresh Chrome instance is launched via `chrome-launcher` for every page
 * because Lighthouse requires exclusive control of the browser's DevTools
 * protocol. Sharing a browser across pages would cause protocol conflicts.
 *
 * The plugin evaluates the four standard Lighthouse categories:
 * Performance, Accessibility, Best Practices, and SEO.
 * Each category score (0-100) is reported as a separate column,
 * with individual audit titles and descriptions included as notes.
 *
 * When Lighthouse throws (e.g. navigation timeout), the plugin returns
 * zero scores with an "Error" note rather than failing the entire analysis,
 * so that partial results from other pages are preserved.
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-lighthouse": {}
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin((options: Options) => {
	return {
		label: 'Lighthouse: パフォーマンス監査',
		headers: {
			performance: 'Performance',
			accessibility: 'Accessibility',
			'best-practices': 'Best Practices',
			seo: 'SEO',
		},

		async eachPage({ url }) {
			const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
			const config = options.config as Config;

			try {
				const result = await lighthouse(url.href, { port: chrome.port }, config).catch(
					(error: unknown) => {
						if (error instanceof Error) {
							return error;
						}
						throw error;
					},
				);

				if (!result || result instanceof Error) {
					return {
						page: {
							performance: { value: 0, note: 'Error' },
							accessibility: { value: 0, note: 'Error' },
							'best-practices': { value: 0, note: 'Error' },
							seo: { value: 0, note: 'Error' },
						},
					};
				}

				const report: LHReport = ReportUtils.prepareReportResult(result.lhr);

				return {
					page: {
						performance: {
							value: Math.round(report.categories.performance.score * 100),
							note: report.categories.performance.auditRefs
								.map((a) => `${a.result.title}: ${a.result.description}`)
								.join('\n'),
						},
						accessibility: {
							value: Math.round(report.categories.accessibility.score * 100),
							note: report.categories.accessibility.auditRefs
								.map((a) => `${a.result.title}: ${a.result.description}`)
								.join('\n'),
						},
						'best-practices': {
							value: Math.round(report.categories['best-practices'].score * 100),
							note: report.categories['best-practices'].auditRefs
								.map((a) => `${a.result.title}: ${a.result.description}`)
								.join('\n'),
						},
						seo: {
							value: Math.round(report.categories.seo.score * 100),
							note: report.categories.seo.auditRefs
								.map((a) => `${a.result.title}: ${a.result.description}`)
								.join('\n'),
						},
					},
				};
			} finally {
				await chrome.kill();
			}
		},
	};
});
