import type { TechnologySignalPartial } from './types.js';

import {
	WAPPALYZER_PROVIDER_TO_TECHNOLOGY,
	WAPPALYZER_SIGNAL_WEIGHT,
} from './technology-signal-definitions.js';

/**
 * Minimal shape this function needs from a persisted (legacy) `page_tags`
 * row. Deliberately narrower than the old `TagRow` — only the columns a
 * `wappalyzer` signal can use. `categories` accepts `unknown` because
 * callers read it via two different paths that disagree on whether the
 * driver already parsed the `json()` column: raw `SELECT` (still a JSON
 * string) vs. knex's typed row mapping (already an array on some drivers).
 */
export interface LegacyTagRowLike {
	provider: string;
	version: string | null;
	confidence: number | null;
	categories: unknown;
}

/**
 * Converts one persisted (legacy) `page_tags` row into a `wappalyzer`
 * technology signal — the shared core `migrate-page-tags-to-page-technologies.ts`
 * (read-time migration for archives already on the current schema) and
 * `retarget-legacy-fk-tables.ts` (0.10→0.13 upgrade path) both call, so a
 * `page_tags` row converts identically regardless of which migration path
 * produced it.
 *
 * Mirrors `normalize-wappalyzer-entries.ts`'s live-beholder conversion, but
 * reads from the OLD persisted row shape (`provider`/`version`/`confidence`/
 * `categories`) instead of beholder's live `TagEntry` (`provider`/`version`/
 * `confidence`/`categories`/`id`/`sources`) — structurally similar, but
 * `page_tags` has no `id` (externalId) to use as `evidence`, so the provider
 * name is used instead.
 * @param row - The persisted `page_tags` row (or an equivalent shape).
 * @returns The equivalent `wappalyzer` signal.
 */
export function convertTagRowToWappalyzerSignal(
	row: LegacyTagRowLike,
): TechnologySignalPartial {
	const categories = parseCategories(row.categories);
	return {
		technology: WAPPALYZER_PROVIDER_TO_TECHNOLOGY[row.provider] ?? row.provider,
		signalType: 'wappalyzer',
		evidence: row.provider,
		weight: row.confidence ?? WAPPALYZER_SIGNAL_WEIGHT,
		category: categories[0] ?? null,
		version: row.version ?? null,
	};
}

/**
 * @param raw
 */
function parseCategories(raw: unknown): string[] {
	if (Array.isArray(raw)) return raw as string[];
	if (typeof raw === 'string' && raw.length > 0) {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? (parsed as string[]) : [];
		} catch {
			return [];
		}
	}
	return [];
}
