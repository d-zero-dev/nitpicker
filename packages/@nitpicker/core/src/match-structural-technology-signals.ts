import type { StructuralTechnologySignal } from './types.js';

import { nativeBinding } from './native-binding.js';

/**
 * Matches the fixed list of frontend-framework fingerprints (Next.js,
 * Astro, Vue, Nuxt, Svelte, SvelteKit, Remix, Gatsby, Angular — HTML
 * markers, URL path fragments, scoped attributes, license banners) against
 * a page's HTML, returning one signal per fingerprint found, in the list's
 * order, with the evidence cut from its first match.
 *
 * The list lives in `crates/nitpicker_tech_detect`. Its output equals what
 * the JavaScript regular expressions it was ported from stored into
 * existing archives' `technology_signals`, so old and new crawls stay
 * comparable. Takes UTF-8 bytes so the native side never builds a UTF-16
 * copy, and scans the page once for all fingerprints.
 * @param html - The page's HTML as UTF-8 bytes — `Buffer.from(html, 'utf8')`.
 * @returns The signals found; empty when the page shows no fingerprint.
 * @example
 * ```ts
 * matchStructuralTechnologySignals(Buffer.from('<div data-v-1a2b3c4d></div>'));
 * // [{ technology: 'Vue', signalType: 'scoped-attr', evidence: ' data-v-1a2b3c4d',
 * //    weight: 40, category: 'JavaScript frameworks' }]
 * ```
 */
export function matchStructuralTechnologySignals(
	html: Uint8Array,
): StructuralTechnologySignal[] {
	return nativeBinding.matchStructuralTechnologySignals(html);
}
