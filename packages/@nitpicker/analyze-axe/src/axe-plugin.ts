import type { Result, WindowWithAxe } from './types.js';
import type { Violation } from '@nitpicker/types';
import type { DOMWindow } from 'jsdom';

import { definePlugin } from '@nitpicker/core';
import { toError } from '@nitpicker/types/to-error';
import axe from 'axe-core';

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
	/**
	 * Reserved for config-file schema compatibility with other analyze
	 * plugins (e.g. `@nitpicker/analyze-lighthouse`, `@nitpicker/analyze-markuplint`,
	 * which forward this field to their underlying tool's own config).
	 * Currently unused: this plugin only derives axe-core configuration from
	 * `lang`.
	 */
	config?: unknown;
};

/**
 * Evaluates axe-core's own source inside `window` and returns the resulting,
 * page-scoped axe-core instance.
 *
 * axe-core's UMD bundle is a self-invoking function that closes over
 * `window`/`document` at evaluation time: `(function axeFunction(window) {
 * var document = window.document; ... })(window)`. A single top-level
 * `import('axe-core')` therefore binds permanently to whichever `window`
 * happens to be current *the first time the module is evaluated* — which,
 * inside a long-lived worker thread (see `page-analysis-worker.ts`), is only
 * the first page that worker processes. Every later page's window is a
 * different JSDOM instance that gets closed once `eachPage` returns, and
 * calling the first page's axe-core instance against that closed window
 * throws `Cannot read properties of null (reading '_location')`: jsdom's
 * `window.close()` deletes `window._document`, and axe-core's result
 * builder unconditionally reads `window.location.href`.
 *
 * `axe.source` — documented by axe-core itself as "Source string to use as
 * an injected script in Selenium" — is the same re-hydration mechanism
 * axe-webdriverjs/axe-puppeteer use to inject axe-core after every
 * navigation. Evaluating it via `window.eval` re-runs the UMD IIFE with this
 * page's window as its argument, producing a fresh axe-core instance bound
 * to a window that is still open, instead of reusing one bound to an
 * already-closed window from a previous page.
 * @param window - The current page's JSDOM window. Must come from a JSDOM
 *   instance created with `runScripts: 'outside-only'`, otherwise
 *   `window.eval` does not execute in the DOM-scoped realm and axe-core
 *   never attaches itself.
 * @returns The axe-core instance now attached to `window.axe`.
 * @throws {Error} If `window.axe` is not set after evaluation.
 */
function injectAxe(window: DOMWindow): typeof axe {
	const target = window as WindowWithAxe;
	target.eval(axe.source);

	if (!target.axe) {
		throw new Error(
			'axe-core failed to attach itself to the page window; the JSDOM instance must be created with `runScripts: "outside-only"`.',
		);
	}

	return target.axe;
}

/**
 * Analyze plugin that runs axe-core accessibility checks against each page's DOM.
 *
 * A fresh axe-core instance is injected into each page's window via
 * {@link injectAxe} instead of reusing a single module-scoped import; see
 * {@link injectAxe} for why the latter silently breaks in a long-lived
 * worker.
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
				with: { type: 'json' },
			});
			locale = mod.default;
		} catch {
			// Locale file not found — fall back to default English messages
		}
	}

	return {
		label: 'axe: アクセシビリティチェック',
		async eachPage({ url, window }) {
			const pageAxe = injectAxe(window);

			if (locale) {
				pageAxe.configure({ locale });
			}

			const results = await pageAxe
				.run({
					rules: {
						'color-contrast': { enabled: false },
					},
				})
				.catch((error: unknown) => toError(error));

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
