import type { ArchiveAccessor } from '@nitpicker/crawler';

import { resolveTextRefs } from '../viewer-cursor-kit/resolve-text-refs.js';

/** Per-source-page outbound link tallies for the Page List report sheet. */
export interface OutboundLinkFacts {
	/** Total occurrences of internal links from this page (sum of `viewer_anchor_facts.count`). */
	internalLinks: number;
	/** Occurrences of internal links to a "bad" destination (see the module docs for the threshold). */
	internalBadLinks: number;
	/** One line per distinct bad internal destination, `\n`-joined. */
	internalBadLinkNote: string;
	/** Total occurrences of external links from this page. */
	externalLinks: number;
	/** Occurrences of external links to a "bad" destination. */
	externalBadLinks: number;
	/** One line per distinct bad external destination, `\n`-joined. */
	externalBadLinkNote: string;
}

const EMPTY_FACTS: OutboundLinkFacts = {
	internalLinks: 0,
	internalBadLinks: 0,
	internalBadLinkNote: '',
	externalLinks: 0,
	externalBadLinks: 0,
	externalBadLinkNote: '',
};

/**
 * "Bad" destination status, matching the legacy `create-page-list.ts`
 * report's threshold verbatim: no status at all (fetch never completed), or
 * `>= 400` excluding `401` (auth-gated destinations are routinely
 * unreachable from a plain crawl and are not link-quality signal).
 * Deliberately not `viewer_anchor_facts.is_broken` (that column is
 * `status = 404` only, matching `list-links.ts`'s narrower scope note) — a
 * bare `status` predicate applied after the `source_page_id IN (...)` filter
 * already narrows the row set, so this costs nothing extra.
 * @param status - The resolved destination's HTTP status, or `null`.
 * @returns `true` iff the status counts as "bad" for this report.
 */
function isBadStatus(status: number | null): boolean {
	return status == null || (status >= 400 && status !== 401);
}

/**
 * Fetches internal/external link counts and bad-link notes for a batch of
 * source pages, from `viewer_anchor_facts`.
 *
 * Reads the fully redirect/alias-resolved (source, dest) pairs — same
 * semantics as every other `viewer_anchor_facts` consumer (`listLinks`,
 * `listViewerBrokenLinks`), a deliberate change from the legacy report's
 * unresolved `anchor_edges` count (see the report rewrite's non-compat
 * notes): two links on one page that both land on the same canonical
 * destination (one direct, one via a redirect) now count as one summed
 * occurrence instead of two, and the "bad" judgment uses the final
 * destination's status rather than a redirect source's transient one.
 *
 * The bad-link note lists one line per distinct bad *destination*
 * (first-wins anchor text per destination — the same grain
 * `viewer_anchor_facts.first_text_id` already carries), not one line per
 * raw anchor occurrence: the read model has no per-occurrence detail to
 * recover. The numeric `internalBadLinks`/`externalBadLinks` counts do stay
 * occurrence-level (`SUM(count)`), matching the legacy report's counting
 * unit.
 * @param accessor - The archive accessor to query. Callers are responsible
 *   for confirming the read model is built and current (see
 *   `isViewerReadModelCurrent`) before calling this — it assumes
 *   `viewer_anchor_facts` exists and trusts its content. Checking once per
 *   report run (not once per batch) is deliberate: `isViewerReadModelCurrent`
 *   is a DB round trip, and this function is called once per
 *   `listViewerPages` cursor batch.
 * @param pageIds - Source page ids to fetch facts for (a `listViewerPages`
 *   cursor batch, typically).
 * @returns Map from `page_id` to its {@link OutboundLinkFacts}. A page with
 *   no outbound links has no entry — callers should fall back to
 *   {@link EMPTY_FACTS}-shaped zero values.
 * @example
 * const facts = await getOutboundLinkFactsByPageIds(accessor, [1, 2, 3]);
 * const forPage1 = facts.get(1) ?? {
 *   internalLinks: 0, internalBadLinks: 0, internalBadLinkNote: '',
 *   externalLinks: 0, externalBadLinks: 0, externalBadLinkNote: '',
 * };
 */
export async function getOutboundLinkFactsByPageIds(
	accessor: ArchiveAccessor,
	pageIds: readonly number[],
): Promise<Map<number, OutboundLinkFacts>> {
	if (pageIds.length === 0) {
		return new Map();
	}
	const knex = accessor.getKnex();

	const rows: {
		sourcePageId: number;
		isExternalLink: 0 | 1;
		status: number | null;
		statusText: string | null;
		count: number;
		firstTextId: number | null;
		rawDestUrl: string;
		resolvedDestUrl: string;
	}[] = await knex('viewer_anchor_facts as vaf')
		.join('viewer_url_refs as raw_ref', 'raw_ref.id', 'vaf.raw_dest_url_ref_id')
		.join('viewer_url_refs as dest_ref', 'dest_ref.id', 'vaf.dest_url_ref_id')
		.leftJoin('content_items as dest_ci', 'dest_ci.id', 'vaf.dest_page_id')
		.whereIn('vaf.source_page_id', [...pageIds])
		.select(
			'vaf.source_page_id as sourcePageId',
			'vaf.is_external_link as isExternalLink',
			'vaf.status as status',
			'dest_ci.status_text as statusText',
			'vaf.count as count',
			'vaf.first_text_id as firstTextId',
			'raw_ref.url as rawDestUrl',
			'dest_ref.url as resolvedDestUrl',
		);

	const textByRefId = await resolveTextRefs(
		knex,
		rows.map((row) => row.firstTextId),
	);

	const result = new Map<number, OutboundLinkFacts>();
	for (const row of rows) {
		const facts = result.get(row.sourcePageId) ?? { ...EMPTY_FACTS };
		const bad = isBadStatus(row.status);
		if (row.isExternalLink) {
			facts.externalLinks += row.count;
		} else {
			facts.internalLinks += row.count;
		}
		if (bad) {
			const text =
				row.firstTextId == null ? '' : (textByRefId.get(row.firstTextId) ?? '');
			const urlDisplay =
				row.rawDestUrl === row.resolvedDestUrl
					? row.resolvedDestUrl
					: `${row.rawDestUrl} => ${row.resolvedDestUrl}`;
			const line = `${text} (${row.status ?? ''} ${row.statusText ?? ''} ${urlDisplay})`;
			if (row.isExternalLink) {
				facts.externalBadLinks += row.count;
				facts.externalBadLinkNote = facts.externalBadLinkNote
					? `${facts.externalBadLinkNote}\n${line}`
					: line;
			} else {
				facts.internalBadLinks += row.count;
				facts.internalBadLinkNote = facts.internalBadLinkNote
					? `${facts.internalBadLinkNote}\n${line}`
					: line;
			}
		}
		result.set(row.sourcePageId, facts);
	}
	return result;
}
