import type { PageTechnologyPartial, TechnologySignalPartial } from './types.js';

import { TECHNOLOGY_CONFIDENCE_THRESHOLD } from './technology-signal-definitions.js';

/**
 * Priority order for picking which signal's `category`/`version` wins when
 * more than one signal for the same technology supplies one. `wappalyzer`
 * wins first — it is the only source with a real Wappalyzer-reported
 * `version`; `meta-generator` second — also carries a real version
 * (`<meta name="generator" content="Astro v4.2.0">`); the rest never
 * carry a version and are listed only so the `.find()` below terminates
 * deterministically regardless of definition order.
 */
const CATEGORY_VERSION_SOURCE_PRIORITY: ReadonlyArray<
	TechnologySignalPartial['signalType']
> = [
	'wappalyzer',
	'meta-generator',
	'html-marker',
	'url-pattern',
	'scoped-attr',
	'js-license-comment',
	'weak-marker',
];

/**
 * Options for {@link combineTechnologyConfidence}.
 */
export interface CombineTechnologyConfidenceOptions {
	/**
	 * Skip the `TECHNOLOGY_CONFIDENCE_THRESHOLD` drop. Set by the `page_tags`
	 * legacy-migration callers (`migrate-page-tags-to-page-technologies.ts`,
	 * `retarget-legacy-fk-tables.ts`): the threshold exists to filter noisy
	 * NEW detections at crawl time, but migration is converting Wappalyzer
	 * detections the old `page_tags`-based API already returned
	 * unconditionally (including low-confidence ones) — dropping them here
	 * would silently and permanently lose data with no recovery path (v0.x
	 * policy is read-time migration only, no retroactive re-crawl).
	 */
	skipThreshold?: boolean;
}

/**
 * Combines every signal detected for one technology on one page into a
 * single confidence score via noisy-OR:
 *
 * ```
 * confidence = round(100 * (1 - Π (1 - weight/100)))
 * ```
 *
 * over each DISTINCT `signalType` present (same signal type appearing
 * twice — e.g. two different `url-pattern` definitions both matching —
 * counts once, at its highest weight; compounding only happens ACROSS
 * signal types, which is what makes this "multiple independent signals
 * agree" rather than "one noisy signal repeated"). A single signal's
 * result equals its own weight exactly (`1 - (1 - w/100) = w/100`).
 *
 * Technologies whose combined confidence falls below
 * `TECHNOLOGY_CONFIDENCE_THRESHOLD` are dropped entirely — a lone weak
 * signal (e.g. `id="app"`, weight 15) is noise, not a detection, and
 * `page_technologies` has no `isDetected` column to hide it behind; the
 * row simply is not written. Pass `options.skipThreshold` to keep every
 * technology regardless of confidence (see its docs for why).
 * @param signals - Every signal detected for a single page, across all
 *   technologies (this function groups by `technology` internally).
 * @param options - See {@link CombineTechnologyConfidenceOptions}.
 * @returns One {@link PageTechnologyPartial} per technology (filtered by
 *   the confidence threshold unless `options.skipThreshold` is set), in no
 *   particular order.
 */
export function combineTechnologyConfidence(
	signals: readonly TechnologySignalPartial[],
	options: CombineTechnologyConfidenceOptions = {},
): PageTechnologyPartial[] {
	const byTechnology = new Map<string, TechnologySignalPartial[]>();
	for (const signal of signals) {
		const group = byTechnology.get(signal.technology);
		if (group) {
			group.push(signal);
		} else {
			byTechnology.set(signal.technology, [signal]);
		}
	}

	const results: PageTechnologyPartial[] = [];
	for (const [technology, group] of byTechnology) {
		const maxWeightByType = new Map<TechnologySignalPartial['signalType'], number>();
		for (const signal of group) {
			const current = maxWeightByType.get(signal.signalType);
			if (current === undefined || signal.weight > current) {
				maxWeightByType.set(signal.signalType, signal.weight);
			}
		}

		const product = [...maxWeightByType.values()].reduce(
			(acc, weight) => acc * (1 - weight / 100),
			1,
		);
		const confidence = Math.round(100 * (1 - product));
		if (!options.skipThreshold && confidence < TECHNOLOGY_CONFIDENCE_THRESHOLD) continue;

		let categorySource: TechnologySignalPartial | undefined;
		let versionSource: TechnologySignalPartial | undefined;
		for (const type of CATEGORY_VERSION_SOURCE_PRIORITY) {
			if (!categorySource) {
				categorySource = group.find((s) => s.signalType === type && s.category != null);
			}
			if (!versionSource) {
				versionSource = group.find((s) => s.signalType === type && s.version != null);
			}
			if (categorySource && versionSource) break;
		}

		results.push({
			technology,
			category: categorySource?.category ?? null,
			version: versionSource?.version ?? null,
			confidence,
			signalCount: maxWeightByType.size,
		});
	}
	return results;
}
