import type {
	ContentTypeCount,
	MetadataFulfillment,
	StatusCount,
	SummaryResult,
} from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Retrieves site-wide summary statistics from the precomputed
 * `viewer_summary` read-model row — a single-row `SELECT` plus three
 * `JSON.parse` calls, replacing `getSummary`'s multi-second full-table
 * aggregation on archives where the read model is current.
 *
 * `baseUrl`/`roots` are not stored in `viewer_summary` (they come from
 * `accessor.getConfig()`, independent of `pages` aggregation and already
 * cheap) — this function merges them back in at read time.
 *
 * Callers are responsible for guarding with `isViewerReadModelCurrent`
 * first, the same convention `listViewerPages` uses — this function does
 * not itself check staleness and throws if the row is missing.
 * @param accessor - The archive accessor to query.
 * @returns The summary statistics, reconstructed from the read model.
 * @throws {Error} If `viewer_summary` has no row (the caller failed to
 *   guard with `isViewerReadModelCurrent`, or the read model is absent).
 * @example
 * if (await isViewerReadModelCurrent(accessor)) {
 *   return getViewerSummary(accessor);
 * }
 * return getSummary(accessor); // legacy fallback
 */
export async function getViewerSummary(
	accessor: ArchiveAccessor,
): Promise<SummaryResult> {
	const knex = accessor.getKnex();
	const config = await accessor.getConfig();
	const row = await knex('viewer_summary').where('id', 1).first();
	if (!row) {
		throw new Error(
			'getViewerSummary: viewer_summary row is missing — caller must guard with ' +
				'isViewerReadModelCurrent() before calling getViewerSummary().',
		);
	}
	return {
		baseUrl: config.baseUrl,
		roots: config.roots,
		totalPages: Number(row.total_pages),
		internalPages: Number(row.internal_pages),
		externalPages: Number(row.external_pages),
		internalContents: Number(row.internal_contents),
		externalContents: Number(row.external_contents),
		statusDistribution: JSON.parse(row.status_json) as StatusCount[],
		metadataFulfillment: JSON.parse(row.metadata_json) as MetadataFulfillment,
		contentTypeDistribution: JSON.parse(row.content_type_json) as ContentTypeCount[],
		networkOutageAffectedFailures: Number(row.network_outage_affected_failures),
	};
}
