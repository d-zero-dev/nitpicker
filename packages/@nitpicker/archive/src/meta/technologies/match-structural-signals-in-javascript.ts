import type { TechnologySignalDefinition, TechnologySignalPartial } from './types.js';

const EVIDENCE_MAX_LENGTH = 200;

/**
 * The matching loop that computed the `technology_signals` rows existing
 * archives hold: every definition's JavaScript regular expression in order,
 * first match each, evidence cut to 200 UTF-16 code units.
 *
 * Not on any runtime path and excluded from the build, like the
 * definitions it runs: the single oracle shared by
 * `match-structural-technology-signals.parity.spec.ts`,
 * `@nitpicker/core`'s `scripts/generate-technology-signals-golden.mjs` and
 * the `js` case of `scripts/bench-tech-signals.mjs`. Evidence is made
 * well-formed: a lone surrogate left by the cut became U+FFFD when the row
 * was written to SQLite as UTF-8, and the native matcher returns that
 * stored form.
 *
 * Takes the definitions as an argument instead of importing
 * `structural-signal-definitions.ts`: the scripts load these oracle files
 * straight from `src/` through Node's type stripping, which does not map
 * the `.js` specifier of a relative import onto the `.ts` file.
 * @param text - HTML, or a JS resource's leading text.
 * @param definitions - The definitions to test, in order
 *   (`STRUCTURAL_SIGNAL_DEFINITIONS`, or a subset of it).
 * @returns One signal per matching definition.
 * @example
 * ```ts
 * matchStructuralSignalsInJavaScript('<div id="app">', STRUCTURAL_SIGNAL_DEFINITIONS);
 * // [{ technology: 'Vue', signalType: 'weak-marker', evidence: ' id="app"', weight: 15, category: 'JavaScript frameworks' }]
 * ```
 */
export function matchStructuralSignalsInJavaScript(
	text: string,
	definitions: readonly TechnologySignalDefinition[],
): TechnologySignalPartial[] {
	const signals: TechnologySignalPartial[] = [];
	for (const def of definitions) {
		const match = def.pattern.exec(text);
		if (match) {
			signals.push({
				technology: def.technology,
				signalType: def.signalType,
				evidence: match[0].slice(0, EVIDENCE_MAX_LENGTH).toWellFormed(),
				weight: def.weight,
				category: def.category ?? null,
			});
		}
	}
	return signals;
}
