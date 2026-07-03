import type { ExternalLinkInsertRow } from './types.js';
import type { Knex } from 'knex';

/**
 * Computes every unique external destination reached from the site, for
 * bulk insert into `viewer_external_links`.
 *
 * The aggregation itself (`COALESCE(canonical.*, dest.*)` redirect
 * resolution, `GROUP BY` on the canonical destination id, `COUNT(DISTINCT
 * source.id)` for the referrer count) is lifted verbatim from
 * `list-external-links.ts`'s live query — see that file's docs for why the
 * counting grain must stay in lockstep with `getPageDetail.inboundLinks`
 * (#71). The only difference here is that this runs once, at read-model
 * build time, against the full `anchors` table with no `LIMIT`/`OFFSET` —
 * see ARCHITECTURE.md「設計注意（外部リンク read model）」for why running
 * this JOIN + `GROUP BY` + `COUNT(DISTINCT ...)` combination on every
 * `/api/links?type=external` request is a known SQLite performance
 * pitfall, and why materialising it once avoids it.
 * @param trx - An open Knex transaction (a plain `Knex` instance also
 *   works, e.g. in tests).
 * @returns One row per unique canonical external destination.
 */
export async function computeExternalLinkRows(
	trx: Knex,
): Promise<ExternalLinkInsertRow[]> {
	const destIdExpression = 'COALESCE("canonical"."id", "dest"."id")';
	const destUrlExpression = 'COALESCE("canonical"."url", "dest"."url")';
	const statusExpression = 'COALESCE("canonical"."status", "dest"."status")';

	const rows: {
		destPageId: number;
		destUrl: string;
		status: number | null;
		referrerCount: number;
	}[] = await trx('anchors')
		.join('pages as source', 'anchors.pageId', '=', 'source.id')
		.join('pages as dest', 'anchors.hrefId', '=', 'dest.id')
		.leftJoin('pages as canonical', 'dest.redirectDestId', '=', 'canonical.id')
		.whereRaw(`COALESCE("canonical"."isExternal", "dest"."isExternal") = 1`)
		.groupBy(trx.raw(destIdExpression))
		.select(
			trx.raw(`${destIdExpression} as "destPageId"`),
			trx.raw(`${destUrlExpression} as "destUrl"`),
			trx.raw(`${statusExpression} as "status"`),
			trx.raw('count(distinct "source"."id") as "referrerCount"'),
		);

	return rows.map((row) => ({
		dest_page_id: row.destPageId,
		dest_url: row.destUrl,
		status: row.status,
		referrer_count: Number(row.referrerCount),
	}));
}
