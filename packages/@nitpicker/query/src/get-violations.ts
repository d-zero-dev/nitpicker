import type { GetViolationsOptions } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/**
 * Violation entry returned to viewers and CLI/MCP callers.
 */
interface ViolationEntry {
	url: string;
	validator: string;
	severity: string;
	rule: string;
	message: string;
	code: string;
}

const SORT_BY_VALUES = [
	'url',
	'validator',
	'severity',
	'rule',
	'message',
	'code',
] as const;

/**
 * Normalizes the requested sort field and falls back to `url`.
 * @param sortBy - The requested sort field.
 * @returns A supported sort key.
 */
function resolveSortBy(
	sortBy: GetViolationsOptions['sortBy'],
): (typeof SORT_BY_VALUES)[number] {
	return SORT_BY_VALUES.includes(sortBy as (typeof SORT_BY_VALUES)[number])
		? (sortBy as (typeof SORT_BY_VALUES)[number])
		: 'url';
}

/**
 * Normalizes the requested sort direction and falls back to `asc`.
 * @param sortOrder - The requested sort direction.
 * @returns A supported sort direction.
 */
function resolveSortOrder(sortOrder: GetViolationsOptions['sortOrder']): 'asc' | 'desc' {
	return sortOrder === 'desc' ? 'desc' : 'asc';
}

/**
 * Retrieves analysis violations from the SQL read path.
 *
 * The first pass filters/sorts/paginates `analysis_violations` down to ids.
 * The second pass joins only those ids back to `pages` and
 * `analysis_text_refs` for display values, keeping URL/text joins out of the
 * broad scan.
 * @param accessor
 * @param options
 */
export async function getViolations(
	accessor: ArchiveAccessor,
	options: GetViolationsOptions = {},
): Promise<{ items: ViolationEntry[]; total: number }> {
	const knex = accessor.getKnex();
	const limit = options.limit ?? 100;
	const offset = options.offset ?? 0;
	const sortBy = resolveSortBy(options.sortBy);
	const sortOrder = resolveSortOrder(options.sortOrder);

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
		.join('pages as p', 'p.id', 'v.page_id')
		.join('analysis_text_refs as msg', 'msg.id', 'v.message_text_id')
		.leftJoin('analysis_text_refs as code', 'code.id', 'v.code_text_id')
		.whereIn('v.id', ids)
		.select([
			'v.id as id',
			'v.page_url_sort_key as urlSortKey',
			'p.url as url',
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
