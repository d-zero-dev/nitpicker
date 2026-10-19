import type { TechnologySignalPartial } from './types.js';

import { matchStructuralTechnologySignals as matchStructuralTechnologySignalsNative } from '@nitpicker/core/match-structural-technology-signals';

import { GENERATOR_TECHNOLOGY_MATCHERS } from './technology-signal-definitions.js';

const EVIDENCE_MAX_LENGTH = 200;

/**
 * Detects the structural fingerprint list (`@nitpicker/core`'s
 * `crates/nitpicker_tech_detect`) against a page's raw HTML, plus
 * `<meta name="generator">` prefix matches against the already-extracted
 * `generator` field. Pure and synchronous — no network I/O, no Wappalyzer
 * data (see `normalize-wappalyzer-entries.ts` for that source).
 *
 * The HTML match runs in the native addon, which scans the page once for
 * every fingerprint. The JavaScript regular expressions it was ported from
 * stay in `structural-signal-definitions.ts`, excluded from the build, as
 * the oracle for `match-structural-technology-signals.parity.spec.ts`.
 * @param html - The page's raw HTML string (empty for external or
 *   metadata-only scrapes, which then match nothing).
 * @param generator - `page_meta.generator` (already extracted by
 *   `derive-flat-from-meta.ts` from beholder's `Meta`), or `null`/`undefined`.
 * @returns Un-combined structural signals, one per matched fingerprint in
 *   the list's order, then one per matched generator prefix.
 * @example
 * ```ts
 * matchStructuralTechnologySignals('<div data-v-1a2b3c4d></div>', 'Nuxt 3.8');
 * // [{ technology: 'Vue', signalType: 'scoped-attr', ... },
 * //  { technology: 'Nuxt', signalType: 'meta-generator', version: '3.8', ... }]
 * ```
 */
export function matchStructuralTechnologySignals(
	html: string,
	generator: string | null | undefined,
): TechnologySignalPartial[] {
	const signals: TechnologySignalPartial[] =
		html.length > 0
			? matchStructuralTechnologySignalsNative(Buffer.from(html, 'utf8'))
			: [];

	if (generator) {
		const lowerGenerator = generator.toLowerCase();
		for (const matcher of GENERATOR_TECHNOLOGY_MATCHERS) {
			if (lowerGenerator.startsWith(matcher.prefix)) {
				signals.push({
					technology: matcher.technology,
					signalType: 'meta-generator',
					evidence: generator.slice(0, EVIDENCE_MAX_LENGTH),
					weight: matcher.weight,
					category: matcher.category,
					version: generator.slice(matcher.prefix.length).trim() || null,
				});
			}
		}
	}

	return signals;
}
