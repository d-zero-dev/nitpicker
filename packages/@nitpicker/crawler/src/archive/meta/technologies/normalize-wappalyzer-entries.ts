import type { TechnologySignalPartial } from './types.js';
import type { TagEntry } from '@d-zero/beholder';

import {
	WAPPALYZER_PROVIDER_TO_TECHNOLOGY,
	WAPPALYZER_SIGNAL_WEIGHT,
} from './technology-signal-definitions.js';

/**
 * Converts beholder's `TagsMeta.entries` (per-page Wappalyzer detections,
 * one row per provider × external-id tuple) into `wappalyzer` technology
 * signals.
 *
 * Every entry becomes a signal — Wappalyzer is not limited to the curated
 * frameworks {@link TECHNOLOGY_SIGNAL_DEFINITIONS} tracks; analytics tools,
 * CMSes, and everything else Wappalyzer's fingerprint DB knows about pass
 * through as their own technology (provider name verbatim). Only the
 * curated frameworks get their provider name FOLDED onto the same
 * technology name their structural signals use, via
 * {@link WAPPALYZER_PROVIDER_TO_TECHNOLOGY} — so e.g. Wappalyzer's `'Vue.js'`
 * and a `data-v-*` structural match both contribute to the `'Vue'` row,
 * not two separate rows.
 *
 * This is the direct replacement for the old `extract-tags-for-archive.ts`
 * (which still exists, unmodified, for `scripts/migrate-to-0.10.mjs`'s
 * independent use — see that file's JSDoc) in the LIVE crawl write path.
 * @param entries - `meta.tags.entries` from beholder, or `undefined`
 *   (legacy minimal-`Meta` test fixtures predate the required field).
 * @returns One signal per entry; empty array when no tags were detected.
 */
export function normalizeWappalyzerEntries(
	entries: readonly TagEntry[] | undefined,
): TechnologySignalPartial[] {
	if (!entries || entries.length === 0) return [];
	return entries.map((entry) => ({
		technology: WAPPALYZER_PROVIDER_TO_TECHNOLOGY[entry.provider] ?? entry.provider,
		signalType: 'wappalyzer' as const,
		evidence: entry.id ?? entry.provider,
		weight: entry.confidence ?? WAPPALYZER_SIGNAL_WEIGHT,
		category: entry.categories[0] ?? null,
		version: entry.version ?? null,
	}));
}
