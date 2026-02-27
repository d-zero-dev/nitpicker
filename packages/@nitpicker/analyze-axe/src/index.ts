import type { Result } from './types.js';
import type { Violation } from '@nitpicker/types';

import { definePlugin } from '@nitpicker/core';

/**
 * Plugin options for the axe-core accessibility analysis.
 */
type Options = {
	/**
	 * BCP 47 language tag for axe-core locale messages (e.g. `"ja"`, `"de"`).
	 * When specified, the plugin attempts to load the corresponding locale
	 * JSON from `axe-core/locales/`. Falls back silently to English if
	 * the locale file is not bundled.
	 */
	lang?: string;
	/** Raw axe-core configuration object passed through to `axe.configure()`. */
	config: unknown;
};

/**
 * Analyze plugin that runs axe-core accessibility checks against each page's DOM.
 *
 * axe-core is imported dynamically inside `eachPage` so that it is evaluated
 * within the worker thread's jsdom context rather than the main thread.
 * This is critical because axe-core inspects `document` at the module scope
 * and would fail or produce no results if loaded before the DOM is available.
 *
 * The `color-contrast` rule is intentionally disabled because jsdom does not
 * perform visual rendering; color contrast checks require computed styles
 * that are unavailable in a headless DOM environment, leading to false
 * positives on every page.
 *
 * Both `violations` (definite failures) and `incomplete` (needs-review)
 * results are collected, with `null`-impact entries skipped since they
 * represent informational rules that do not affect accessibility scoring.
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-axe": { "lang": "ja" }
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin(async (options: Options) => {
	let locale: unknown;

	if (options.lang) {
		try {
			const mod = await import(`axe-core/locales/${options.lang}.json`, {
				assert: { type: 'json' },
			});
			locale = mod.default;
		} catch {
			// Locale file not found — fall back to default English messages
		}
	}

	return {
		label: 'axe: アクセシビリティチェック',
		async eachPage({ url }) {
			const mod = await import('axe-core');
			// @ts-expect-error
			const axe: typeof mod = mod.default;

			if (locale) {
				axe.configure({ locale });
			}

			const results = await axe
				.run({
					rules: {
						'color-contrast': { enabled: false },
					},
				})
				.catch((error) => new Error(error));

			const reports: Result[] = [];

			if (results instanceof Error) {
				reports.push({
					description: results.message,
				});
			} else {
				for (const report of results.incomplete) {
					if (report.impact === null) {
						continue;
					}
					reports.push(report);
				}

				for (const report of results.violations) {
					if (report.impact === null) {
						continue;
					}
					reports.push(report);
				}
			}

			const violations = reports.flatMap<Violation>((report) => {
				return {
					validator: 'axe',
					severity: typeof report.impact === 'string' ? report.impact : 'error',
					rule: report.id || 'UNKNOWN_RULE',
					code:
						report.nodes
							// @ts-expect-error
							?.map((node) => node?.html ?? node?.target?.join('') ?? '')
							.join('\n') ?? '',
					message: `${report.description || ''} ${report.help || ''}(${report.helpUrl || ''})`,
					url: url.href,
				};
			});

			return {
				violations,
			};
		},
	};
});
