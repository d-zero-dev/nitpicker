import type { ViolationStreamRow } from './types.js';
import type { ArchiveAccessor } from '@nitpicker/crawler';

/** `analysis_violations` rows read per keyset chunk, by default. */
const READ_CHUNK_SIZE = 5000;

/**
 * Streams every `analysis_violations` row for the Violations report sheet.
 *
 * Plain `analysis_violations.id` keyset pagination (`id > lastId`), unlike
 * `getViolations` (the general filter/sort/search list API viewer, CLI, and
 * MCP callers use, which re-runs a `COUNT(*)` and re-scans from `OFFSET` on
 * every page — appropriate for a small UI page, not a full-archive report
 * pass). The report has no filter UI and always wants every violation in one
 * linear sweep, so this bypasses that per-page recount/rescan cost the same
 * way `streamAllContentItems`/`streamAllResourcesRaw` do for their tables.
 * @param accessor - The archive accessor to query.
 * @param chunkSize - `analysis_violations` rows read per chunk. Must be positive.
 * @yields One chunk's rows, in `analysis_violations.id` order.
 * @throws {RangeError} If `chunkSize` is not positive.
 * @example
 * for await (const chunk of streamAllViolations(accessor)) {
 *   for (const violation of chunk) {
 *     sheet.appendRow(toViolationRow(violation));
 *   }
 * }
 */
export async function* streamAllViolations(
	accessor: ArchiveAccessor,
	chunkSize = READ_CHUNK_SIZE,
): AsyncGenerator<ViolationStreamRow[]> {
	if (chunkSize <= 0) {
		throw new RangeError(
			`streamAllViolations: chunkSize must be positive, got ${chunkSize}`,
		);
	}
	const knex = accessor.getKnex();

	let lastId = 0;
	for (;;) {
		const rows: {
			id: number;
			url: string;
			validator: string;
			severity: string;
			rule: string;
			message: string;
			code: string | null;
		}[] = await knex('analysis_violations as v')
			.join('content_items as p', 'p.id', 'v.page_id')
			.join('url_refs as ur', 'ur.id', 'p.url_id')
			.join('analysis_text_refs as msg', 'msg.id', 'v.message_text_id')
			.leftJoin('analysis_text_refs as code', 'code.id', 'v.code_text_id')
			.where('v.id', '>', lastId)
			.orderBy('v.id', 'asc')
			.limit(chunkSize)
			.select(
				'v.id as id',
				'ur.url as url',
				'v.validator as validator',
				'v.severity as severity',
				'v.rule as rule',
				'msg.text as message',
				'code.text as code',
			);

		if (rows.length === 0) {
			return;
		}
		lastId = rows.at(-1)!.id;

		yield rows.map((row) => ({
			url: row.url,
			validator: row.validator,
			severity: row.severity,
			rule: row.rule,
			message: row.message,
			code: row.code ?? '',
		}));
	}
}
