import type { ErrorKindGroup, ErrorKindHost, ErrorKindsResult } from './types.js';
import type { ArchiveAccessor, ErrorKind } from '@nitpicker/crawler';

/**
 * Retrieves the crawl-failure breakdown from the precomputed
 * `viewer_error_kind_*` read-model tables — four small `SELECT`s ordered
 * entirely by their own indexes/primary keys, replacing `getErrorKinds`'s
 * `page_errors`/`crawl_errors`/`error.log` scan-and-classify pass on
 * archives where the read model is current.
 *
 * Callers are responsible for guarding with `isViewerReadModelCurrent`
 * first, the same convention `getViewerSummary` uses — this function does
 * not itself check staleness and throws if the meta row is missing.
 *
 * **Tie-break order is unspecified across backends**: both this function and
 * `getErrorKinds` sort `groups` by `count` descending and each group's
 * `hosts` by `count` descending, but neither documents (or needs to agree
 * on) a tie-break for equal counts. `getErrorKinds` ties break by `Map`
 * insertion order (an accident of `page_errors`/`crawl_errors` processing
 * order); this function ties break by `kind`/`host` ascending (an accident
 * of `ORDER BY` + `WITHOUT ROWID` clustering). A caller that flips between
 * this function and `getErrorKinds` across requests (as
 * `getErrorKindsFastPath` does whenever the read model's staleness changes)
 * can therefore see a tied group's/host's position change with no
 * underlying data change. Callers that need a stable order must sort by an
 * additional key themselves.
 * @param accessor - The archive accessor to query.
 * @returns The error-kind breakdown, reconstructed from the read model.
 * @throws {Error} If `viewer_error_kind_meta` has no row (the caller
 *   failed to guard with `isViewerReadModelCurrent`, or the read model is
 *   absent).
 * @example
 * if (await isViewerReadModelCurrent(accessor)) {
 *   return getViewerErrorKinds(accessor);
 * }
 * return getErrorKinds(accessor); // legacy fallback
 */
export async function getViewerErrorKinds(
	accessor: ArchiveAccessor,
): Promise<ErrorKindsResult> {
	const knex = accessor.getKnex();
	const meta = await knex('viewer_error_kind_meta').where('id', 1).first();
	if (!meta) {
		throw new Error(
			'getViewerErrorKinds: viewer_error_kind_meta row is missing — caller must guard ' +
				'with isViewerReadModelCurrent() before calling getViewerErrorKinds().',
		);
	}

	// `kind`/`host` ascending is an explicit tie-break for equal counts, kept
	// only so this function's own output is deterministic across repeated
	// reads — it does NOT make ties agree with `getErrorKinds`'s Map-insertion-
	// order tie-break (see this function's docs).
	const groupRows: { kind: ErrorKind; count: number }[] = await knex(
		'viewer_error_kind_groups',
	)
		.select('kind', 'count')
		.orderBy([{ column: 'count', order: 'desc' }, { column: 'kind' }]);

	const hostRows: { kind: ErrorKind; host: string; count: number }[] = await knex(
		'viewer_error_kind_hosts',
	)
		.select('kind', 'host', 'count')
		.orderBy([
			{ column: 'kind' },
			{ column: 'count', order: 'desc' },
			{ column: 'host' },
		]);
	const hostsByKind = new Map<ErrorKind, ErrorKindHost[]>();
	for (const row of hostRows) {
		const hosts = hostsByKind.get(row.kind) ?? [];
		hosts.push({ host: row.host, count: Number(row.count) });
		hostsByKind.set(row.kind, hosts);
	}

	const sampleRows: { kind: ErrorKind; url: string }[] = await knex(
		'viewer_error_kind_samples',
	)
		.select('kind', 'url')
		.orderBy(['kind', 'rank']);
	const samplesByKind = new Map<ErrorKind, string[]>();
	for (const row of sampleRows) {
		const samples = samplesByKind.get(row.kind) ?? [];
		samples.push(row.url);
		samplesByKind.set(row.kind, samples);
	}

	const groups: ErrorKindGroup[] = groupRows.map((row) => ({
		kind: row.kind,
		count: Number(row.count),
		hosts: hostsByKind.get(row.kind) ?? [],
		sampleUrls: samplesByKind.get(row.kind) ?? [],
	}));

	return {
		total: Number(meta.total),
		channelSource: meta.channel_source as ErrorKindsResult['channelSource'],
		groups,
	};
}
