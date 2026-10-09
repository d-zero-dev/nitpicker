/**
 * Domain types for technology-signal extraction (crawl time) and confidence
 * roll-up. Kept in this dedicated `technologies/types.ts` rather than the
 * parent `meta/types.ts` because these types are internal to the extraction
 * pipeline (`match-structural-technology-signals.ts` →
 * `combine-technology-confidence.ts` → `extract-technologies-for-archive.ts`)
 * and never cross the `archive/meta/types.ts` boundary that the persisted
 * `technology_signals` / `page_technologies` row shapes (`TechnologySignalRow`
 * / `PageTechnologyRow`) live in — see the repo-wide `型は types.ts に集約`
 * rule, applied per-module rather than globally so this module's internal
 * vocabulary does not leak into the db-ops layer's public row types.
 */

/**
 * How a technology signal was detected. `wappalyzer` is beholder's
 * `simple-wappalyzer`-based detection (imprecise on its own for frameworks,
 * but authoritative for the long tail of non-framework technologies —
 * analytics, CMSes, etc. — this module does not otherwise attempt to
 * detect). The rest are structural signals this module detects itself.
 */
export type TechnologySignalType =
	| 'wappalyzer'
	| 'meta-generator'
	| 'html-marker'
	| 'url-pattern'
	| 'scoped-attr'
	| 'weak-marker'
	| 'js-license-comment';

/**
 * One un-combined signal for one technology on one page. The unit that
 * `combineTechnologyConfidence` groups (by `technology`) and reduces via
 * noisy-OR into a single {@link PageTechnologyPartial} per technology.
 */
export interface TechnologySignalPartial {
	/** Normalized technology name (e.g. `'Next.js'`, `'Google Analytics'`). */
	technology: string;
	signalType: TechnologySignalType;
	/** Matched fragment or raw value, truncated to ~200 chars by the caller. `null` when the signal type carries no useful excerpt. */
	evidence: string | null;
	/** This signal's confidence in isolation, 0-100. */
	weight: number;
	/** Wappalyzer/generator-reported category, when this signal type can supply one. */
	category?: string | null;
	/** Wappalyzer/generator-reported version, when this signal type can supply one. */
	version?: string | null;
}

/**
 * One technology's combined roll-up for one page, before the `pageId` is
 * known (added by the caller at insert time — same "id injected at write
 * time" pattern as {@link import('../types.js').TagRowForInsert}).
 */
export interface PageTechnologyPartial {
	technology: string;
	category: string | null;
	version: string | null;
	/** `combineTechnologyConfidence`'s noisy-OR result, 0-100. */
	confidence: number;
	/** Count of distinct `signalType`s that contributed to `confidence`. */
	signalCount: number;
}

/**
 * A single fingerprint definition: one technology matched by one signal
 * type via one regular expression, at one isolated weight. Multiple
 * definitions may share a `technology` (different signal types/patterns)
 * — {@link combineTechnologyConfidence} is what lets those compound.
 */
export interface TechnologySignalDefinition {
	technology: string;
	signalType:
		| 'html-marker'
		| 'url-pattern'
		| 'scoped-attr'
		| 'weak-marker'
		| 'js-license-comment';
	/** Tested against the page's raw HTML string (or, for `js-license-comment`, a JS resource's leading bytes). */
	pattern: RegExp;
	/** This definition's confidence in isolation, 0-100, when `pattern` matches. */
	weight: number;
	/** Category to attach to the technology when only this signal fired. */
	category?: string;
}
