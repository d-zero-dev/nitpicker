import type { Violation } from '@nitpicker/types';
import type { TextlintMessage, TextlintRuleSeverityLevel } from '@textlint/types';

import { definePlugin } from '@nitpicker/core';
import { createLinter } from 'textlint';

/**
 * A textlint rule configuration map.
 * Keys are rule identifiers; values are `true` (enable with defaults),
 * `false` (disable), or a rule-specific options object.
 */
type Rule = Record<string, unknown>;

/**
 * Plugin options for the textlint text-proofreading analysis.
 */
type Options = {
	/**
	 * Custom rule overrides merged on top of the default Japanese-oriented rule set.
	 * Set a rule to `false` to disable it; set to `true` or an options object to enable.
	 */
	rules?: Rule;
};

const defaultRules: Rule = {
	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-nfd
	 */
	'no-nfd': true,

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-max-ten
	 */
	'max-ten': {
		max: 3,
	},

	/**
	 * @see https://github.com/azu/textlint-rule-spellcheck-tech-word
	 */
	'spellcheck-tech-word': true,

	/**
	 * @see https://github.com/azu/textlint-rule-web-plus-db
	 */
	'web-plus-db': true,

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-mix-dearu-desumasu
	 */
	// cspell:disable-next-line
	'no-mix-dearu-desumasu': {
		preferInHeader: '',
		preferInBody: '',
		preferInList: '',
		strict: false,
	},

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-doubled-joshi
	 */
	'no-doubled-joshi': true,

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-double-negative-ja
	 */
	'no-double-negative-ja': true,

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-hankaku-kana
	 */
	'no-hankaku-kana': true, // cspell:disable-line

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-ja-no-abusage
	 */
	'ja-no-abusage': true,
	'no-mixed-zenkaku-and-hankaku-alphabet': true, // cspell:disable-line
	'no-dropping-the-ra': true,
	'no-doubled-conjunctive-particle-ga': true,
	'no-doubled-conjunction': true,
	'ja-no-mixed-period': true,

	/**
	 * @see https://github.com/KeitaMoromizato/textlint-rule-max-appearence-count-of-words#readme
	 */
	'max-appearence-count-of-words': true, // cspell:disable-line
	'ja-hiragana-keishikimeishi': true, // cspell:disable-line
	'ja-hiragana-fukushi': true, // cspell:disable-line
	'ja-hiragana-hojodoushi': true, // cspell:disable-line
	'ja-unnatural-alphabet': true,
	'@textlint-ja/textlint-rule-no-insert-dropping-sa': true,
	'prefer-tari-tari': true, // cspell:disable-line

	/**
	 * @see https://github.com/textlint-ja/textlint-rule-no-synonyms
	 */
	'@textlint-ja/no-synonyms': true,
};

/**
 * Mapping from short rule identifiers to their npm package names.
 *
 * Most textlint rules follow the convention `textlint-rule-{id}`, but some
 * (especially scoped packages like `@textlint-ja/*`) deviate.
 * This map provides explicit overrides so that `loadModule()` can
 * dynamically import the correct package for each rule.
 */
const ruleImportMap: Record<string, string> = {
	'no-nfd': 'textlint-rule-no-nfd',
	'max-ten': 'textlint-rule-max-ten',
	'spellcheck-tech-word': 'textlint-rule-spellcheck-tech-word',
	'web-plus-db': 'textlint-rule-web-plus-db',
	'no-mix-dearu-desumasu': 'textlint-rule-no-mix-dearu-desumasu',
	'no-doubled-joshi': 'textlint-rule-no-doubled-joshi',
	'no-double-negative-ja': 'textlint-rule-no-double-negative-ja',
	'no-hankaku-kana': 'textlint-rule-no-hankaku-kana',
	'ja-no-abusage': 'textlint-rule-ja-no-abusage',
	'no-mixed-zenkaku-and-hankaku-alphabet':
		'textlint-rule-no-mixed-zenkaku-and-hankaku-alphabet',
	'no-dropping-the-ra': 'textlint-rule-no-dropping-the-ra',
	'no-doubled-conjunctive-particle-ga':
		'textlint-rule-no-doubled-conjunctive-particle-ga',
	'no-doubled-conjunction': 'textlint-rule-no-doubled-conjunction',
	'ja-no-mixed-period': 'textlint-rule-ja-no-mixed-period',
	'max-appearence-count-of-words': 'textlint-rule-max-appearence-count-of-words',
	'ja-hiragana-keishikimeishi': 'textlint-rule-ja-hiragana-keishikimeishi',
	'ja-hiragana-fukushi': 'textlint-rule-ja-hiragana-fukushi',
	'ja-hiragana-hojodoushi': 'textlint-rule-ja-hiragana-hojodoushi',
	'ja-unnatural-alphabet': 'textlint-rule-ja-unnatural-alphabet',
	'@textlint-ja/textlint-rule-no-insert-dropping-sa':
		'@textlint-ja/textlint-rule-no-insert-dropping-sa',
	'prefer-tari-tari': 'textlint-rule-prefer-tari-tari',
	'@textlint-ja/no-synonyms': '@textlint-ja/textlint-rule-no-synonyms',
};

/**
 * Dynamically imports a module and resolves CJS/ESM default-export interop.
 *
 * Many textlint rules are published as CommonJS modules. When imported
 * via dynamic `import()` in an ESM context, Node wraps the CJS export
 * in `{ default: ... }`. Some bundlers double-wrap this, producing
 * `{ default: { default: actualExport } }`. The fallback chain
 * `mod.default?.default ?? mod.default ?? mod` handles all three cases:
 *
 * 1. Double-wrapped CJS: `mod.default.default`
 * 2. Single-wrapped CJS: `mod.default`
 * 3. Native ESM: `mod` (no `.default` property)
 * @param moduleName - The npm package name to import.
 * @returns The resolved module export (typically a rule constructor).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadModule(moduleName: string): Promise<any> {
	const mod = await import(moduleName);
	// moduleInterop equivalent: handle default export for CJS/ESM interop
	return mod.default?.default ?? mod.default ?? mod;
}

/**
 * Constructs a textlint `Linter` instance with the given rule set.
 *
 * Rules are loaded dynamically via `loadModule()` to support the mix of
 * CJS and ESM packages in the textlint ecosystem. The HTML plugin is
 * always registered so that raw HTML can be linted directly without
 * first converting to Markdown.
 * @param rules - Merged rule configuration (defaults + user overrides).
 * @returns A configured textlint `Linter` ready for `lintText()` calls.
 */
async function buildLinter(rules: Rule) {
	const { TextlintKernelDescriptor } = await import('@textlint/kernel');

	const ruleDescriptors = await Promise.all(
		Object.entries(rules)
			.filter(([, value]) => value !== false)
			.map(async ([ruleId, options]) => {
				const moduleName = ruleImportMap[ruleId] ?? `textlint-rule-${ruleId}`;
				const rule = await loadModule(moduleName);
				return {
					ruleId,
					rule,
					options: options === true ? {} : (options as Record<string, unknown>),
				};
			}),
	);

	const htmlPlugin = await loadModule('textlint-plugin-html');

	const descriptor = new TextlintKernelDescriptor({
		rules: ruleDescriptors,
		plugins: [
			{
				pluginId: 'html',
				plugin: htmlPlugin,
			},
		],
		filterRules: [],
	});

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return createLinter({ descriptor: descriptor as any });
}

/**
 * Per-page linting report before it is mapped to Violation objects.
 */
type Report = {
	/** The URL of the page that was linted. */
	url: string;
	/** Raw textlint messages (warnings/errors) for the page. */
	results: TextlintMessage[];
};

/**
 * Analyze plugin that runs textlint Japanese text-proofreading rules
 * against each page's HTML.
 *
 * The default rule set is heavily Japanese-oriented (mixed script detection,
 * doubled particles, honorific misuse, etc.) because the primary use case
 * is auditing Japanese corporate websites. Users can override or extend
 * rules via the `rules` option.
 *
 * ## Lazy linter initialization
 *
 * Building the linter is expensive because it dynamically imports 20+
 * rule packages (many of which are CJS and require interop resolution).
 * The linter is therefore created lazily on the first `eachPage` call
 * and the resulting promise is cached for all subsequent pages.
 *
 * This "lazy singleton" pattern (`linterPromise` variable) ensures:
 * 1. Zero startup cost if textlint is configured but no pages match.
 * 2. No duplicate initialization even under concurrent `eachPage` calls,
 *    because the same promise is shared (Promise deduplication).
 * @example
 * ```jsonc
 * // nitpicker.config.json
 * {
 *   "plugins": {
 *     "analyze": {
 *       "@nitpicker/analyze-textlint": {
 *         "rules": {
 *           "max-ten": { "max": 5 },
 *           "spellcheck-tech-word": false
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */
export default definePlugin((options: Options) => {
	const rules = { ...defaultRules, ...options.rules };
	let linterPromise: Promise<ReturnType<typeof createLinter>> | undefined;

	/**
	 * Returns a shared linter promise, creating it on first call.
	 * Subsequent calls return the same promise (lazy singleton pattern).
	 */
	function getLinter() {
		if (!linterPromise) {
			linterPromise = buildLinter(rules);
		}
		return linterPromise;
	}

	return {
		label: 'textlint: テキスト校正',
		async eachPage({ html, url }) {
			const linter = await getLinter();
			const reports: Report[] = [];

			const result = await linter.lintText(html, url.pathname + '.html');
			reports.push({
				url: url.href,
				results: result.messages,
			});

			const violations = reports.flatMap((report) => {
				return report.results.map<Violation>((r) => {
					return {
						validator: 'textlint',
						severity: convertSeverity(r.severity),
						rule: r.ruleId,
						code: '-',
						message: `${r.message}`,
						url: `${report.url} (${r.line}:${r.column})`,
					};
				});
			});

			return {
				violations,
			};
		},
	};
});

/**
 * Maps textlint's numeric severity levels to Nitpicker's string-based severity.
 *
 * textlint uses `1` for warning and `2` for error, following ESLint convention.
 * Any unexpected value defaults to `"error"` for safety.
 * @param severity - The textlint severity level (1 = warning, 2 = error).
 * @returns The corresponding Nitpicker severity string.
 */
function convertSeverity(severity: TextlintRuleSeverityLevel) {
	switch (severity) {
		case 1: {
			return 'warning';
		}
		case 2: {
			return 'error';
		}
		default: {
			return 'error';
		}
	}
}
