import type {
	ContentTypeCategory,
	ContentTypeCount,
	ErrorKindCount,
	FailureAttribution,
	StatusCount,
	SummaryResult,
} from './types.js';
import type { ArchiveAccessor, ErrorKind, PageSource } from '@nitpicker/crawler';

import { classifyErrorKind, isWithinOutageWindow } from '@nitpicker/crawler';

import { classifyContentType } from './classify-content-type.js';
import { countConsoleLogsByType } from './count-console-logs-by-type.js';
import { excludeSkippedPages } from './exclude-skipped-pages.js';
import { listAllOutageWindows } from './list-all-outage-windows.js';
import { requireAliasOfIdColumn } from './require-alias-of-id-column.js';
import { resolveFailedPageMessages } from './resolve-failed-page-messages.js';

/**
 * Retrieves site-wide summary statistics from the archive.
 *
 * 0.13: reads 0.13 entity tables (`content_items` + `page_meta`
 * + `url_refs` + `content_type_refs`) instead of the legacy `pages` table.
 * Metadata-fulfillment counts inspect the deduped `page_meta.*_text_id`
 * columns directly — the 0.13 populate step skips empty text, so
 * `IS NOT NULL` on the id column is equivalent to
 * `IS NOT NULL AND != ''` on the raw text.
 *
 * Every count excludes `alias_of_id`-having rows the same way it already
 * excludes `redirect_dest_id`-having rows — a page merged into another via
 * URL-normalization is no more "its own page" for counting purposes than an
 * HTTP redirect source is.
 *
 * `status = 404` rows are excluded from every page/content total and from
 * `contentTypeDistribution` regardless of provenance — no page exists behind
 * a 404 URL. They remain visible only in `statusDistribution`, split into
 * two rows: the plain `404` row (fix-target broken pages) and a trailing
 * {@link StatusCount.inventorySeed} row (`source = 'inventory-seed'` — URLs
 * that came from a `crawl --inventory` list and never existed, i.e. input
 * mistakes). `metadataFulfillment` applies a narrower, deliberately
 * asymmetric rule: only the inventory-seed 404s leave the denominator —
 * fix-target 404s still owe their metadata (see {@link SummaryResult}).
 *
 * Each `errorKindBreakdown` entry (on the `status === -1` row) carries a
 * {@link FailureAttribution}: `'site'` unless the failure's message
 * timestamp falls inside a recorded `network_outages` window, in which
 * case it is `'network'` — the crawl operator's own connectivity, not the
 * target site, is the more likely cause even for a normally-permanent kind
 * like `dns`. {@link SummaryResult.networkOutageAffectedFailures} is the
 * sum of every `'network'`-attributed count, i.e. how many currently-failed
 * pages may clear on the next `crawl --retry-failed`. Both are always `0`
 * on an archive with no recorded outages — identical to today's behaviour.
 * @param accessor - The archive accessor to query.
 * @returns Summary statistics including page counts, status distribution,
 *   metadata rates, and content-type distribution.
 * @throws {Error} If `content_items.alias_of_id` does not exist on this
 *   connection (see `requireAliasOfIdColumn`).
 * @example
 * const summary = await getSummary(accessor);
 * console.log(`${summary.internalPages} internal HTML pages`);
 * const failed = summary.statusDistribution.find((s) => s.status === -1);
 * console.log(failed?.errorKindBreakdown); // per-cause, per-attribution counts
 * console.log(summary.networkOutageAffectedFailures); // retryable-after-outage count
 */
export async function getSummary(accessor: ArchiveAccessor): Promise<SummaryResult> {
	const knex = accessor.getKnex();
	await requireAliasOfIdColumn(knex);
	const config = await accessor.getConfig();
	const baseUrl = config.baseUrl;
	const roots = config.roots;

	const consoleLogCountsPromise = countConsoleLogsByType(knex);
	const failedPageIdRowsPromise = knex('content_items')
		.select('id')
		.where('scraped', 1)
		.where('status', -1)
		.whereNull('redirect_dest_id')
		.whereNull('alias_of_id') as Promise<{ id: number }[]>;
	const failedPageMessagesPromise = failedPageIdRowsPromise.then((rows) =>
		resolveFailedPageMessages(
			accessor,
			rows.map((r) => r.id),
		),
	);
	const outageWindowsPromise = listAllOutageWindows(accessor);
	const [
		pageRows,
		metaRows,
		contentTypeRows,
		failedPageIdRows,
		failedPageMessages,
		outageWindows,
		consoleLogCounts,
	] = await Promise.all([
		knex('content_items as ci')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select(
				'ci.is_external as isExternal',
				'ci.status as status',
				'ci.source as source',
			)
			.count('ci.id as count')
			.where('ci.scraped', 1)
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id')
			.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
			.where((qb) => {
				qb.whereNull('ctr.raw').orWhere('ctr.raw', 'text/html');
			})
			// `source` in the grouping key only serves the 404 seed/non-seed
			// split below — for every other status the JS accumulator merges
			// the per-source rows right back together.
			.groupBy('ci.is_external', 'ci.status', 'ci.source') as Promise<
			{
				isExternal: 0 | 1;
				status: number | null;
				// PageSource (not string) so a typo in the JS-side
				// 'inventory-seed' comparison below is a TS no-overlap error
				// instead of a silently-never-matching branch.
				source: PageSource;
				count: number | string;
			}[]
		>,
		knex('content_items as ci')
			.join('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.leftJoin('page_meta as pm', 'pm.page_id', 'ci.id')
			// Inventory-seed 404s (input mistakes — no such page should
			// exist) must not dilute the fulfillment rates, but every OTHER
			// 404 stays: a fix-target broken page still owes its metadata.
			// NULL-status legacy rows fall through the first branch and stay
			// counted. (`source` is NOT NULL DEFAULT 'crawled', so it needs
			// no NULL branch of its own.)
			.where((qb) => {
				qb.whereNull('ci.status')
					.orWhereNot('ci.status', 404)
					.orWhereNot('ci.source', 'inventory-seed');
			})
			.select(
				knex.raw('COUNT(*) as total'),
				knex.raw(
					'COUNT(CASE WHEN "pm"."title_text_id" IS NOT NULL THEN 1 END) as hasTitle',
				),
				knex.raw(
					'COUNT(CASE WHEN "pm"."description_text_id" IS NOT NULL THEN 1 END) as hasDescription',
				),
				knex.raw(
					'COUNT(CASE WHEN "pm"."keywords_text_id" IS NOT NULL THEN 1 END) as hasKeywords',
				),
				knex.raw(
					'COUNT(CASE WHEN "pm"."og_title_text_id" IS NOT NULL THEN 1 END) as hasOgTitle',
				),
				knex.raw(
					'COUNT(CASE WHEN "pm"."og_description_text_id" IS NOT NULL THEN 1 END) as hasOgDescription',
				),
				knex.raw(
					'COUNT(CASE WHEN "pm"."og_image_url_id" IS NOT NULL THEN 1 END) as hasOgImage',
				),
			)
			.where({ 'ci.scraped': 1, 'ci.is_external': 0, 'ctr.raw': 'text/html' })
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id') as Promise<Record<string, number>[]>,
		knex('content_items as ci')
			.leftJoin('content_type_refs as ctr', 'ctr.id', 'ci.content_type_id')
			.select('ctr.raw as contentType', 'ci.is_external as isExternal')
			.count('ci.id as count')
			.where('ci.scraped', 1)
			.whereNull('ci.redirect_dest_id')
			.whereNull('ci.alias_of_id')
			.where((qb) => excludeSkippedPages(qb, 'ci.is_skipped'))
			// No page exists behind a 404 URL, whatever its provenance, so
			// content totals skip them entirely. NULL-status legacy rows are
			// not 404s and stay counted.
			.where((qb) => {
				qb.whereNull('ci.status').orWhereNot('ci.status', 404);
			})
			.groupBy('ctr.raw', 'ci.is_external') as Promise<
			{
				contentType: string | null;
				isExternal: 0 | 1;
				count: number | string;
			}[]
		>,
		failedPageIdRowsPromise,
		failedPageMessagesPromise,
		outageWindowsPromise,
		consoleLogCountsPromise,
	]);

	let totalNum = 0;
	let internalNum = 0;
	let externalNum = 0;
	let inventorySeed404Num = 0;
	const statusAcc = new Map<number | null, number>();
	for (const row of pageRows) {
		const n = Number(row.count);
		// 404s never count as pages (no page exists behind a 404 URL) but
		// they DO stay in the status histogram — split by provenance so
		// inventory-list input mistakes don't masquerade as fix-target
		// broken pages.
		if (row.status === 404) {
			if (row.source === 'inventory-seed') {
				inventorySeed404Num += n;
			} else {
				statusAcc.set(404, (statusAcc.get(404) ?? 0) + n);
			}
			continue;
		}
		totalNum += n;
		if (row.isExternal === 1) {
			externalNum += n;
		} else if (row.isExternal === 0) {
			internalNum += n;
		}
		statusAcc.set(row.status, (statusAcc.get(row.status) ?? 0) + n);
	}
	/**
	 * Sort tier of one status row: `0` for regular numeric statuses,
	 * `1` for the inventory-seed 404 trailer, `2` for the `null`-status
	 * trailer — "real statuses first, input noise last, unknown last of
	 * all" (see {@link StatusCount.inventorySeed}). NOT plain
	 * `a.status - b.status`: that would slot the seed row between 403 and
	 * 405 instead of after every regular row.
	 * @param entry - The row to rank.
	 * @returns The tier.
	 */
	function statusSortTier(entry: StatusCount): number {
		if (entry.status === null) {
			return 2;
		}
		return entry.inventorySeed ? 1 : 0;
	}
	const statusDistribution: StatusCount[] = [
		...[...statusAcc.entries()].map(([status, count]) => ({ status, count })),
		...(inventorySeed404Num > 0
			? [{ status: 404, count: inventorySeed404Num, inventorySeed: true as const }]
			: []),
	].toSorted((a, b) => {
		const tierDelta = statusSortTier(a) - statusSortTier(b);
		if (tierDelta !== 0) {
			return tierDelta;
		}
		// Within tier 0, ascending by status; tiers 1 and 2 hold at most
		// one row each (single seed bucket, single null bucket), so the
		// 0-fallback never reorders anything real.
		return (a.status ?? 0) - (b.status ?? 0);
	});

	const minusOneEntry = statusDistribution.find((e) => e.status === -1);
	let networkOutageAffectedFailures = 0;
	if (minusOneEntry && failedPageIdRows.length > 0) {
		// Keyed on `${kind} ${attribution}` so a kind that has BOTH
		// site-caused and outage-caused occurrences gets two independent
		// counters instead of one colliding bucket.
		const kindCounts = new Map<
			string,
			{ kind: ErrorKind; attribution: FailureAttribution; count: number }
		>();
		for (const row of failedPageIdRows) {
			const resolved = failedPageMessages.get(row.id);
			const message = resolved?.message ?? '';
			const kind = message === '' ? 'unknown' : classifyErrorKind(message);
			// Attribution: a failure is network-caused only when its message
			// has a known timestamp AND that timestamp falls inside a
			// recorded outage window — see `is-within-outage-window.ts`. An
			// error.log-sourced message (createdAt === null) or an archive
			// with no recorded outages can never be attributed to the
			// network, matching today's behaviour exactly.
			const attribution: FailureAttribution =
				resolved?.createdAt != null &&
				isWithinOutageWindow(resolved.createdAt, outageWindows)
					? 'network'
					: 'site';
			if (attribution === 'network') {
				networkOutageAffectedFailures++;
			}
			const bucketKey = `${kind} ${attribution}`;
			const existing = kindCounts.get(bucketKey);
			if (existing) {
				existing.count++;
			} else {
				kindCounts.set(bucketKey, { kind, attribution, count: 1 });
			}
		}
		minusOneEntry.errorKindBreakdown = [...kindCounts.values()].toSorted(
			(a, b) => b.count - a.count,
		) satisfies ErrorKindCount[];
	}

	const meta = metaRows[0] ?? ({} as Record<string, number>);
	const metaTotal = Number(meta.total ?? 0);
	let metadataFulfillment = {
		title: 0,
		description: 0,
		keywords: 0,
		ogTitle: 0,
		ogDescription: 0,
		ogImage: 0,
	};
	if (metaTotal > 0) {
		metadataFulfillment = {
			title: Number(meta.hasTitle) / metaTotal,
			description: Number(meta.hasDescription) / metaTotal,
			keywords: Number(meta.hasKeywords) / metaTotal,
			ogTitle: Number(meta.hasOgTitle) / metaTotal,
			ogDescription: Number(meta.hasOgDescription) / metaTotal,
			ogImage: Number(meta.hasOgImage) / metaTotal,
		};
	}

	const contentTypeAcc = new Map<
		ContentTypeCategory,
		{ internal: number; external: number }
	>();
	let internalContents = 0;
	let externalContents = 0;
	for (const row of contentTypeRows) {
		const category = classifyContentType(row.contentType);
		const bucket = contentTypeAcc.get(category) ?? { internal: 0, external: 0 };
		const n = Number(row.count);
		if (row.isExternal === 1) {
			bucket.external += n;
			externalContents += n;
		} else if (row.isExternal === 0) {
			bucket.internal += n;
			internalContents += n;
		}
		contentTypeAcc.set(category, bucket);
	}
	const contentTypeDistribution: ContentTypeCount[] = [...contentTypeAcc.entries()]
		.map(([category, { internal, external }]) => ({ category, internal, external }))
		.toSorted((a, b) => {
			const totalDelta = b.internal + b.external - (a.internal + a.external);
			if (totalDelta !== 0) {
				return totalDelta;
			}
			return a.category.localeCompare(b.category);
		});

	return {
		baseUrl,
		roots,
		totalPages: totalNum,
		internalPages: internalNum,
		externalPages: externalNum,
		internalContents,
		externalContents,
		statusDistribution,
		metadataFulfillment,
		contentTypeDistribution,
		networkOutageAffectedFailures,
		consoleLogCounts,
	};
}
