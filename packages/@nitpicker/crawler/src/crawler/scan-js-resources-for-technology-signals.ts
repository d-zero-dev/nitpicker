import type { ArchiveAccessor } from '../archive/archive-accessor.js';
import type { TechnologySignalPartial } from '../archive/meta/technologies/types.js';
import type { Knex } from 'knex';

import { combineTechnologyConfidence } from '../archive/meta/technologies/combine-technology-confidence.js';

import { scanJsResourceForLicenseComment } from './scan-js-resource-for-license-comment.js';

/**
 * Content-Type strings this scan treats as JavaScript. Deliberately
 * duplicated (not imported) from `@nitpicker/query`'s `content-type-rules.ts`
 * `'javascript'` category rule: the crawler package must not depend back on
 * query (see `ensure-viewer-read-model-quietly.ts`'s docs for the same
 * boundary), and this list is small and stable enough that duplication is
 * cheaper than introducing a shared third package for it.
 */
const JS_CONTENT_TYPES = [
	'text/javascript',
	'application/javascript',
	'application/x-javascript',
	'application/ecmascript',
];

const DEFAULT_CONCURRENCY = 4;

/** Options for {@link scanJsResourcesForTechnologySignals}. */
export interface ScanJsResourcesForTechnologySignalsOptions {
	/** Maximum concurrent network fetches. Defaults to {@link DEFAULT_CONCURRENCY}. */
	concurrency?: number;
	/** Forwarded to `scanJsResourceForLicenseComment`. */
	byteLimit?: number;
	/** Forwarded to `scanJsResourceForLicenseComment`. */
	timeout?: number;
	/** Forwarded to `scanJsResourceForLicenseComment`. */
	userAgent?: string;
	/** Called after each resource finishes scanning (matched or not). */
	onProgress?: (done: number, total: number) => void;
}

/** Outcome counters returned by {@link scanJsResourcesForTechnologySignals}. */
export interface ScanJsResourcesForTechnologySignalsResult {
	/** JS resources eligible for scanning (internal, not yet cached). */
	candidateCount: number;
	/** Resources actually scanned this run (equals `candidateCount` barring a mid-run crash). */
	scannedCount: number;
	/** Resources whose leading bytes matched a known license comment. */
	matchedCount: number;
	/** Distinct pages whose `technology_signals` / `page_technologies` were updated as a result. */
	pagesUpdatedCount: number;
}

/**
 * Runs `worker` over `items` with at most `concurrency` calls in flight at
 * once. A minimal worker-pool, not a chunk-then-parallelize helper like
 * `eachSplitted` (which parallelizes across chunks, not within one) — this
 * module needs a true cap on simultaneous outbound HTTP connections.
 * @param items - The items to process.
 * @param concurrency - Maximum simultaneous `worker` calls.
 * @param worker - Called once per item; errors propagate to the caller.
 */
async function runWithConcurrency<T>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
): Promise<void> {
	let nextIndex = 0;
	/**
	 *
	 */
	async function runNext(): Promise<void> {
		const index = nextIndex++;
		if (index >= items.length) return;
		await worker(items[index]!);
		await runNext();
	}
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => runNext()),
	);
}

/**
 * Re-derives one page's `technology_signals` + `page_technologies` rows from
 * its existing persisted signals plus newly-discovered `js-license-comment`
 * signals, then scoped-replaces both tables — the same full-per-page-replace
 * invariant `insertTechnologies` follows (see its docs: the two tables are
 * never updated independently).
 *
 * `technology_signals` does not persist `category`/`version` (only
 * `page_technologies` does — see `create-adjunct-tables.ts`), so a technology
 * whose category/version came from a signal not re-derivable from the
 * persisted rows (a `wappalyzer` or `meta-generator` signal, both computed at
 * crawl time from data this function does not have) would otherwise regress
 * to `null` here. The existing `page_technologies` row is read first and its
 * `category`/`version` fall back in wherever the freshly combined result has
 * none.
 * @param knex - The archive's Knex instance.
 * @param pageId - The page to update.
 * @param newSignals - Newly-discovered signals for this page (from JS
 *   resources it references).
 */
async function applyNewSignalsToPage(
	knex: Knex,
	pageId: number,
	newSignals: readonly TechnologySignalPartial[],
): Promise<void> {
	await knex.transaction(async (trx) => {
		const existingSignalRows: {
			technology: string;
			signalType: TechnologySignalPartial['signalType'];
			evidence: string | null;
			weight: number;
		}[] = await trx('technology_signals')
			.where('pageId', pageId)
			.select('technology', 'signalType', 'evidence', 'weight');
		const existingTechnologyRows: {
			technology: string;
			category: string | null;
			version: string | null;
		}[] = await trx('page_technologies')
			.where('pageId', pageId)
			.select('technology', 'category', 'version');
		const existingMetaByTechnology = new Map(
			existingTechnologyRows.map((row) => [row.technology, row]),
		);

		const allSignals: TechnologySignalPartial[] = [...existingSignalRows, ...newSignals];
		const technologies = combineTechnologyConfidence(allSignals).map((t) => {
			const previous = existingMetaByTechnology.get(t.technology);
			return {
				...t,
				category: t.category ?? previous?.category ?? null,
				version: t.version ?? previous?.version ?? null,
			};
		});

		await trx('technology_signals').where('pageId', pageId).delete();
		await trx('page_technologies').where('pageId', pageId).delete();
		await trx('technology_signals').insert(
			allSignals.map((s) => ({
				pageId,
				technology: s.technology,
				signalType: s.signalType,
				evidence: s.evidence,
				weight: s.weight,
			})),
		);
		if (technologies.length > 0) {
			await trx('page_technologies').insert(technologies.map((t) => ({ pageId, ...t })));
		}
	});
}

/**
 * Post-crawl network enrichment (distinct from crawl-time extraction and
 * from read-model-time backfill — see ARCHITECTURE.md): re-fetches the
 * leading bytes of every not-yet-scanned internal JS resource, tests them
 * for a known technology's license comment, and folds any match into the
 * referencing pages' `technology_signals` / `page_technologies`.
 *
 * Each resource is scanned at most once ever, across the archive's whole
 * lifetime — outcomes (including non-matches) are recorded in
 * `technology_js_scan_cache` keyed by `resourceId`, so a later
 * `--append`/`--retry-failed` run only pays the network cost for resources
 * discovered since the last run.
 *
 * A single resource can be referenced by many pages (a shared bundle); a
 * match is applied to every one of them independently. Network scanning
 * runs at bounded concurrency; the per-page DB recombination that follows
 * runs after every scan has settled, never concurrently for the same page,
 * so two resources that both resolve to the same page cannot race each
 * other's read-modify-write.
 *
 * Best-effort like `scanJsResourceForLicenseComment`: an unreachable
 * resource is recorded as a non-match (cached as scanned, `technology:
 * null`) rather than retried or surfaced as an error — a flaky CDN must not
 * block the rest of the archive's enrichment, and the resource will not be
 * retried until `technology_js_scan_cache` itself is cleared.
 * @param accessor - The archive to enrich.
 * @param options - Concurrency, byte-cap, timeout, and progress overrides.
 * @returns Counters describing what was scanned, matched, and updated.
 * @example
 * const result = await scanJsResourcesForTechnologySignals(archive);
 * // { candidateCount: 42, scannedCount: 42, matchedCount: 3, pagesUpdatedCount: 57 }
 */
export async function scanJsResourcesForTechnologySignals(
	accessor: ArchiveAccessor,
	options: ScanJsResourcesForTechnologySignalsOptions = {},
): Promise<ScanJsResourcesForTechnologySignalsResult> {
	const knex = accessor.getKnex();
	const concurrency = Math.max(options.concurrency ?? DEFAULT_CONCURRENCY, 1);

	const candidates: { resourceId: number; url: string }[] = await knex(
		'resource_items as ri',
	)
		.join('url_refs as ur', 'ur.id', 'ri.url_id')
		.leftJoin('content_type_refs as ctr', 'ctr.id', 'ri.content_type_id')
		.leftJoin('technology_js_scan_cache as cache', 'cache.resourceId', 'ri.id')
		.where('ri.is_external', 0)
		.whereNull('cache.resourceId')
		.where((qb) => {
			qb.whereIn('ctr.raw', JS_CONTENT_TYPES)
				.orWhere('ur.url', 'like', '%.js')
				.orWhere('ur.url', 'like', '%.js?%')
				.orWhere('ur.url', 'like', '%.mjs')
				.orWhere('ur.url', 'like', '%.mjs?%');
		})
		.select('ri.id as resourceId', 'ur.url as url');

	let scannedCount = 0;
	const matchesByResourceId = new Map<number, TechnologySignalPartial>();

	await runWithConcurrency(candidates, concurrency, async (candidate) => {
		const signal = await scanJsResourceForLicenseComment(candidate.url, {
			byteLimit: options.byteLimit,
			timeout: options.timeout,
			userAgent: options.userAgent,
		});
		scannedCount++;
		options.onProgress?.(scannedCount, candidates.length);

		await knex('technology_js_scan_cache').insert({
			resourceId: candidate.resourceId,
			scannedAt: Date.now(),
			technology: signal?.technology ?? null,
			evidence: signal?.evidence ?? null,
		});

		if (signal) {
			matchesByResourceId.set(candidate.resourceId, signal);
		}
	});

	if (matchesByResourceId.size === 0) {
		return {
			candidateCount: candidates.length,
			scannedCount,
			matchedCount: 0,
			pagesUpdatedCount: 0,
		};
	}

	const edges: { resource_id: number; page_id: number }[] = await knex(
		'resource_ref_edges',
	)
		.whereIn('resource_id', [...matchesByResourceId.keys()])
		.select('resource_id', 'page_id');

	const newSignalsByPageId = new Map<number, TechnologySignalPartial[]>();
	for (const edge of edges) {
		const signal = matchesByResourceId.get(edge.resource_id);
		if (!signal) continue;
		const list = newSignalsByPageId.get(edge.page_id);
		if (list) {
			list.push(signal);
		} else {
			newSignalsByPageId.set(edge.page_id, [signal]);
		}
	}

	const affectedPageIds = [...newSignalsByPageId.keys()];
	await runWithConcurrency(affectedPageIds, concurrency, async (pageId) => {
		await applyNewSignalsToPage(knex, pageId, newSignalsByPageId.get(pageId)!);
	});

	return {
		candidateCount: candidates.length,
		scannedCount,
		matchedCount: matchesByResourceId.size,
		pagesUpdatedCount: affectedPageIds.length,
	};
}
