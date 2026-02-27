import type { LHReport } from './types.js';
import type { TableValue, Violation } from '@nitpicker/types';
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
 * Per-URL index that accumulates Lighthouse scores and individual audit results.
 * Keyed by URL string so that the final report can iterate over all analyzed pages.
 */
type IndexData = Record<
	string,
	{
		/** Reserved for future structured detail strings. */
		details: string[];
		/** Category-level scores (0-100) keyed by category id. */
		scores: Record<string, number>;
		/** Individual audit results that did not pass. */
		results: Result[];
	}
>;

/**
 * A single non-passing audit result extracted from the Lighthouse report.
 */
type Result = {
	/** Rating level: `"fail"`, `"average"`, or `"error"`. */
	severity: string;
	/** Category title with optional group suffix (e.g. `"Performance(metrics)"`). */
	rule: string;
	/** Formatted score string (e.g. `"(Score: 45)"`). */
	code: string;
	/** Audit title, display value, and description concatenated. */
	message: string;
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
 * Each category score (0-100) is reported as a separate column, and
 * individual non-passing audits are collected as violations.
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
			const reports: IndexData = {};

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

			const scores: Record<string, number> = {};
			for (const cat of Object.values(report.categories)) {
				scores[cat.id] = Math.round(cat.score * 100);
			}

			const results: Result[] = [];
			for (const cat of Object.values(report.categories)) {
				for (const audit of cat.auditRefs) {
					const result = audit.result;
					if (
						result.scoreDisplayMode === 'notApplicable' ||
						result.scoreDisplayMode === 'error'
					) {
						continue;
					}
					const rating = ReportUtils.calculateRating(
						result.score,
						result.scoreDisplayMode,
					) as 'pass' | 'average' | 'fail' | 'error';
					if (rating === 'pass') {
						continue;
					}
					const label = cat.title + (audit.group ? `(${audit.group})` : '');
					const score = `(Score: ${Math.round(result.score * 100)})`;
					const value = result.displayValue ? ` (${result.displayValue})` : '';
					results.push({
						severity: rating,
						rule: label,
						code: score,
						message: `${result.title}:${value} ${result.description}`,
					});
				}
			}

			reports[url.href] = {
				details: [],
				scores,
				results,
			};

			await chrome.kill();
			type Header = {
				performance: string;
				accessibility: string;
				'best-practices': string;
				seo: string;
			};

			const data: Record<string, Record<keyof Header, TableValue>> = {};
			const totalPoints: Record<keyof Header, number> = {
				performance: 0,
				accessibility: 0,
				'best-practices': 0,
				seo: 0,
			};
			const violations: Violation[] = [];
			const pageList = Object.keys(reports);
			for (const url of pageList) {
				const scores = reports[url]?.scores ?? {};
				data[url] = {
					performance: { value: scores.performance ?? 0 },
					accessibility: { value: scores.accessibility ?? 0 },
					['best-practices']: { value: scores['best-practices'] ?? 0 },
					seo: { value: scores.seo ?? 0 },
				};
				totalPoints.performance += scores.performance ?? 0;
				totalPoints.accessibility += scores.accessibility ?? 0;
				totalPoints['best-practices'] += scores['best-practices'] ?? 0;
				totalPoints.seo += scores.seo ?? 0;
				const results = reports[url]?.results ?? [];
				violations.push(
					...results.map((result) => ({
						validator: 'lighthouse',
						severity: result.severity,
						rule: result.rule,
						code: result.code,
						message: result.message,
						url,
					})),
				);
			}
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
		},
	};
});
