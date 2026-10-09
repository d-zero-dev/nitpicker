import type { TechnologySignalPartial } from './types.js';

import {
	GENERATOR_TECHNOLOGY_MATCHERS,
	TECHNOLOGY_SIGNAL_DEFINITIONS,
} from './technology-signal-definitions.js';

const EVIDENCE_MAX_LENGTH = 200;

/**
 * Detects every {@link TECHNOLOGY_SIGNAL_DEFINITIONS} pattern against a
 * page's raw HTML string, plus `<meta name="generator">` prefix matches
 * against the already-extracted `generator` field. Pure and synchronous —
 * no network I/O, no Wappalyzer data (see `normalize-wappalyzer-entries.ts`
 * for that source).
 * @param html - The page's raw HTML string.
 * @param generator - `page_meta.generator` (already extracted by
 *   `derive-flat-from-meta.ts` from beholder's `Meta`), or `null`/`undefined`.
 * @returns Un-combined structural signals, one per matched definition.
 */
export function matchStructuralTechnologySignals(
	html: string,
	generator: string | null | undefined,
): TechnologySignalPartial[] {
	const signals: TechnologySignalPartial[] = [];

	for (const def of TECHNOLOGY_SIGNAL_DEFINITIONS) {
		const match = def.pattern.exec(html);
		if (match) {
			signals.push({
				technology: def.technology,
				signalType: def.signalType,
				evidence: match[0].slice(0, EVIDENCE_MAX_LENGTH),
				weight: def.weight,
				category: def.category ?? null,
			});
		}
	}

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
