import type { Violation } from '@nitpicker/types';

import { definePlugin } from '@nitpicker/core';
import { MLEngine } from 'markuplint';

/**
 * Plugin options for the markuplint HTML validation.
 */
type Options = {
	/** markuplint configuration object (rules, plugins, etc.). */
	config: unknown;
};

/**
 * Analyze plugin that validates HTML markup using markuplint.
 *
 * markuplint resolves its rule configuration based on the source file name,
 * so the URL must be converted to a plausible `.html` filename.
 * The conversion logic:
 *
 * - URLs ending with `/` get `index.html` appended (directory index convention)
 * - URLs already ending with `.html` are used as-is
 * - All other URLs get `.html` appended (e.g. `/about` becomes `/about.html`)
 *
 * This ensures markuplint's filename-based config overrides (e.g.
 * `overrides[].files`) work correctly even though the HTML comes from
 * a URL rather than a local file path.
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-markuplint": {
 *         "config": {
 *           "rules": { "attr-duplication": true }
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin((options: Options) => {
	return {
		label: 'markuplint: HTMLマークアップ検証',
		headers: {
			markuplint: 'markuplint',
		},
		async eachPage({ url, html }) {
			const markuplint = await MLEngine.fromCode(html, {
				name: url.href.endsWith('/')
					? url.href + 'index.html'
					: url.href.endsWith('.html')
						? url.href
						: url.href + '.html',
				config: options.config || undefined,
			});

			const results = await markuplint.exec();

			if (!results || results instanceof Error) {
				// Error
				return null;
			}

			const violations = results.violations.flatMap<Violation>((report) => {
				return {
					validator: 'markuplint',
					severity: report.severity,
					rule: report.ruleId,
					code: '',
					message: report.message,
					url: `${url.href} (${report.line}:${report.col})`,
				};
			});
			return {
				page: {
					markuplint: {
						value: `${violations.length}`,
						note: violations.map((v) => `${v.message} (${v.rule})`).join('\n'),
					},
				},
				violations,
			};
		},
	};
});
