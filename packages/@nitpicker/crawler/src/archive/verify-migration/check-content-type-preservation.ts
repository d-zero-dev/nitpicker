import type { Knex } from 'knex';

import { MigrationVerificationError } from './types.js';

/**
 * Verifies 0.13 invariant #7: no page loses its content-type across the
 * 0.13-1 populate.
 *
 * `populate-content-items.ts` sets `content_type_id = null` whenever the
 * legacy `pages.contentType` is null OR the empty string (the empty string
 * meaning "no content-type recorded"). Any *other* case where `contentType`
 * carries a real value but `content_items.content_type_id` ended up null
 * would indicate a resolver bug — the current populate throws before insert
 * in that path, so this check is a defence in depth against a future
 * regression.
 *
 * The check runs a single `SELECT id, contentType LIMIT 1` filtered to
 * offending rows; if any row comes back the invariant is violated and the
 * error context surfaces that one sample for the operator. A separate
 * `COUNT(*)` would only add cost without adding information — the presence
 * of a single row already means the invariant fails.
 * @param trx - Knex instance or transaction connected to the populated archive.
 * @throws {MigrationVerificationError} when any content-type is silently dropped.
 */
export async function checkContentTypePreservation(trx: Knex): Promise<void> {
	const sample = await trx('content_items as ci')
		.join('pages as p', 'ci.id', 'p.id')
		.whereNull('ci.content_type_id')
		.whereNotNull('p.contentType')
		.andWhere('p.contentType', '<>', '')
		.select<
			{ id: number; contentType: string }[]
		>('ci.id as id', 'p.contentType as contentType')
		.limit(1);
	if (sample.length > 0) {
		const offending = sample[0]!;
		throw new MigrationVerificationError({
			check: '#7 content_type preservation',
			context: {
				sample_page_id: offending.id,
				sample_content_type: offending.contentType,
			},
		});
	}
}
