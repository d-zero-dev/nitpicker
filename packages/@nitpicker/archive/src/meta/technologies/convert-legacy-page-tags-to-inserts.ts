import type { LegacyTagRowLike } from './convert-tag-row-to-wappalyzer-signal.js';
import type { TechnologySignalPartial } from './types.js';

import { combineTechnologyConfidence } from './combine-technology-confidence.js';
import { convertTagRowToWappalyzerSignal } from './convert-tag-row-to-wappalyzer-signal.js';

/** One `technology_signals` row ready for insertion, `pageId` already resolved. */
export interface LegacyTechnologySignalInsert {
	pageId: number;
	technology: string;
	signalType: string;
	evidence: string | null;
	weight: number;
}

/** One `page_technologies` row ready for insertion, `pageId` already resolved. */
export interface LegacyPageTechnologyInsert {
	pageId: number;
	technology: string;
	category: string | null;
	version: string | null;
	confidence: number;
	signalCount: number;
}

/** Result of {@link convertLegacyPageTagsToInserts}. */
export interface LegacyPageTagsConversion {
	signalInserts: LegacyTechnologySignalInsert[];
	technologyInserts: LegacyPageTechnologyInsert[];
}

/**
 * Converts every persisted (legacy) `page_tags` row into the `pageId`-keyed
 * `technology_signals` + `page_technologies` insert rows for that page's
 * whole tag set — shared by both `page_tags` migration paths
 * (`migrate-page-tags-to-page-technologies.ts` for archives already on the
 * current schema, `retarget-legacy-fk-tables.ts` for the 0.10→0.13 upgrade)
 * so a `page_tags` row converts identically regardless of which path
 * produced it, and a future fix to the conversion only needs to change one
 * place.
 *
 * Uses `combineTechnologyConfidence(signals, { skipThreshold: true })` —
 * migration preserves every historical Wappalyzer detection the old
 * `page_tags`-based API returned unconditionally, rather than applying the
 * confidence-noise filter meant for fresh crawl-time detections (see that
 * option's docs).
 * @param rows - Every `page_tags` row, in any order (grouped internally by
 *   `pageId`).
 * @returns The two insert-ready row sets, empty arrays if `rows` is empty.
 */
export function convertLegacyPageTagsToInserts(
	rows: readonly (LegacyTagRowLike & { pageId: number })[],
): LegacyPageTagsConversion {
	const signalsByPage = new Map<number, TechnologySignalPartial[]>();
	for (const row of rows) {
		const signal = convertTagRowToWappalyzerSignal(row);
		const group = signalsByPage.get(row.pageId);
		if (group) {
			group.push(signal);
		} else {
			signalsByPage.set(row.pageId, [signal]);
		}
	}

	const signalInserts: LegacyTechnologySignalInsert[] = [];
	const technologyInserts: LegacyPageTechnologyInsert[] = [];
	for (const [pageId, signals] of signalsByPage) {
		for (const signal of signals) {
			signalInserts.push({
				pageId,
				technology: signal.technology,
				signalType: signal.signalType,
				evidence: signal.evidence,
				weight: signal.weight,
			});
		}
		for (const technology of combineTechnologyConfidence(signals, {
			skipThreshold: true,
		})) {
			technologyInserts.push({ pageId, ...technology });
		}
	}
	return { signalInserts, technologyInserts };
}
