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

import type { StructuralTechnologySignalType } from '@nitpicker/core/types';

/**
 * How a technology signal was detected. `wappalyzer` is beholder's
 * `simple-wappalyzer`-based detection (imprecise on its own for frameworks,
 * but authoritative for the long tail of non-framework technologies —
 * analytics, CMSes, etc. — this module does not otherwise attempt to
 * detect). The rest are structural signals this module detects itself.
 */
export type TechnologySignalType =
	'wappalyzer' | 'meta-generator' | StructuralTechnologySignalType;

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
 * A structural fingerprint definition as a JavaScript regular expression:
 * one technology matched by one signal type, at one isolated weight. The
 * shape of the parity oracle (`structural-signal-definitions.ts`, excluded
 * from the build) only — detection runs the Rust port in `@nitpicker/core`'s
 * `crates/nitpicker_tech_detect`, which owns the list.
 */
export interface TechnologySignalDefinition {
	technology: string;
	signalType: StructuralTechnologySignalType;
	/** The expression the stored `technology_signals` rows were computed with. */
	pattern: RegExp;
	/** This definition's confidence in isolation, 0-100, when `pattern` matches. */
	weight: number;
	/** Category to attach to the technology when only this signal fired. */
	category?: string;
}
