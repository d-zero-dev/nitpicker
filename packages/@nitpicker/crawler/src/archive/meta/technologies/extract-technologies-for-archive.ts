import type { PageTechnologyPartial, TechnologySignalPartial } from './types.js';
import type { PageData } from '../../../utils/types/types.js';

import { combineTechnologyConfidence } from './combine-technology-confidence.js';
import { matchStructuralTechnologySignals } from './match-structural-technology-signals.js';
import { normalizeWappalyzerEntries } from './normalize-wappalyzer-entries.js';

/**
 * The result of one page's technology-signal extraction: every raw signal
 * (for `technology_signals`, MCP/query signal-level lookups, and per-page
 * "why was this detected" drill-down) plus the confidence-combined roll-up
 * (for `page_technologies`).
 */
export interface ExtractedTechnologies {
	signals: TechnologySignalPartial[];
	technologies: PageTechnologyPartial[];
}

/**
 * Extracts every technology signal for one page — structural (HTML markers,
 * URL path fragments, scoped attributes, `<meta name="generator">`) plus
 * Wappalyzer (beholder's `meta.tags.entries`) — and combines them into
 * confidence-scored technology rows.
 *
 * Crawl-time, synchronous, zero extra network cost — the direct replacement
 * for `extract-tags-for-archive.ts` in the live crawl write path (that file
 * itself is untouched; `scripts/migrate-to-0.10.mjs` still depends on it).
 * JS-license-comment signals are NOT produced here — they require an extra
 * network fetch per JS resource and are added afterward, once per crawl, by
 * `scan-js-resources-for-technology-signals.ts` ("JSスキャン・エンリッチメント",
 * a distinct post-crawl category — see ARCHITECTURE.md).
 * @param html - The page's raw HTML string.
 * @param meta - `PageData.meta` (for `generator` and `tags.entries`).
 * @returns Raw signals and their confidence-combined roll-up.
 */
export function extractTechnologiesForArchive(
	html: string,
	meta: PageData['meta'],
): ExtractedTechnologies {
	const structuralSignals = matchStructuralTechnologySignals(html, meta.generator);
	const wappalyzerSignals = normalizeWappalyzerEntries(meta.tags?.entries);
	const signals = [...structuralSignals, ...wappalyzerSignals];
	const technologies = combineTechnologyConfidence(signals);
	return { signals, technologies };
}
