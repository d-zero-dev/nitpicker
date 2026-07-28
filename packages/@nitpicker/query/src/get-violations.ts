import type { GetViolationsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

import { resolveListLimit } from './resolve-list-limit.js';
import { resolveListOffset } from './resolve-list-offset.js';
import { resolveListSortBy } from './resolve-list-sort-by.js';
import { resolveListSortOrder } from './resolve-list-sort-order.js';

/**
 * Violation entry returned to viewers and CLI/MCP callers.
 */
interface ViolationEntry {
	/** The page URL the violation was reported against. */
	url: string;
	/** Reporting validator name (e.g. "axe", "markuplint"). */
	validator: string;
	/** Severity label as reported by the validator. */
	severity: string;
	/** Rule identifier within the validator. */
	rule: string;
	/** Human-readable violation message. */
	message: string;
	/** Offending code snippet, or `''` when the validator reported none. */
	code: string;
}

/** Default page size when `options.limit` is absent or invalid. */
const DEFAULT_LIMIT = 100;

/** Sort fields accepted by {@link getViolations}. */
const SORT_BY_VALUES = [
	'url',
	'validator',
	'severity',
	'rule',
	'message',
	'code',
] as const;

/**
 * Retrieves analysis violations from the SQL read path.
 *
 * The first pass filters/sorts/paginates `analysis_violations` down to ids.
 * The second pass joins only those ids back to `content_items` and
 * `analysis_text_refs` for display values, keeping URL/text joins out of the
 * broad scan.
 * @param accessor - The archive accessor to query.
 * @param options - Filter, sort, and pagination options.
 * @returns The matching violations for the requested page plus the total
 *   matching count (before pagination).
 * @example
 * const { items, total } = await getViolations(accessor, {
 *   validator: 'axe',
 *   severity: 'critical',
 *   limit: 50,
 * });
 * console.log(`${total} critical axe violations`, items[0]?.rule);
 */
export async function getViolations(
	accessor: ArchiveAccessor,
	options: GetViolationsOptions = {},
): Promise<{ items: ViolationEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = resolveListLimit(options.limit, DEFAULT_LIMIT);
	const offset = resolveListOffset(options.offset);
	const sortBy = resolveListSortBy(options.sortBy, SORT_BY_VALUES, 'url');
	const sortOrder = resolveListSortOrder(options.sortOrder, 'asc');

	const filtered = knex('analysis_violations as v');
	if (options.validator) filtered.where('v.validator', options.validator);
	if (options.severity) filtered.where('v.severity', options.severity);
	if (options.rule) filtered.where('v.rule', options.rule);
	if (options.urlPattern) {
		filtered.where('v.page_url_sort_key', 'like', options.urlPattern);
	}

	const totalRow = await filtered
		.clone()
		.count<{ count: string }[]>({ count: '*' })
		.first();
	const total = Number(totalRow?.count ?? 0);

	const orderColumn = (
		{
			url: 'v.page_url_sort_key',
			validator: 'v.validator',
			severity: 'v.severity',
			rule: 'v.rule',
			message: 'v.message_sort_key',
			code: 'v.code_sort_key',
		} as const
	)[sortBy];

	const idRows = await filtered
		.clone()
		.select('v.id')
		.orderByRaw(`${orderColumn} ${sortOrder}, v.id ${sortOrder}`)
		.limit(limit)
		.offset(offset);

	const ids = idRows.map((row) => row.id as number);
	if (ids.length === 0) {
		return { items: [], total };
	}

	const rows = await knex('analysis_violations as v')
		.join('content_items as p', 'p.id', 'v.page_id')
		.join('url_refs as ur', 'ur.id', 'p.url_id')
		.join('analysis_text_refs as msg', 'msg.id', 'v.message_text_id')
		.leftJoin('analysis_text_refs as code', 'code.id', 'v.code_text_id')
		.whereIn('v.id', ids)
		.select([
			'v.id as id',
			'v.page_url_sort_key as urlSortKey',
			'ur.url as url',
			'v.validator as validator',
			'v.severity as severity',
			'v.rule as rule',
			'msg.text as message',
			'code.text as code',
		]);

	const rowsById = new Map(
		rows.map((row) => [
			row.id as number,
			{
				url: row.url as string,
				validator: row.validator as string,
				severity: row.severity as string,
				rule: row.rule as string,
				message: row.message as string,
				code: (row.code as string | null) ?? '',
			},
		]),
	);
	const items = ids
		.map((id) => rowsById.get(id))
		.filter((row): row is ViolationEntry => row != null);

	return { items, total };
}
