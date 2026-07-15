import type { Knex } from 'knex';

import { MigrationVerificationError } from './types.js';

/**
 * Sample size for the URL round-trip smoke test — a 1,000-row sample per
 * issue #194.
 * Not statistical coverage — URL normalisation bugs tend to be systematic
 * (all rows with a particular scheme or host), so a modest evenly-spread
 * sample catches them reliably.
 */
const SAMPLE_SIZE = 1000;

/**
 * Verifies 0.13 invariant #8: `content_items.url_id → url_refs.url`
 * round-trips back to the original `pages.url` on a deterministic
 * ≤ {@link SAMPLE_SIZE} sample.
 *
 * A mismatch means one of two things:
 *
 * - `populate-url-refs.ts` collapsed two distinct URLs into the same
 *   `url_refs.id` (BINARY collation bug, whitespace normalisation, …).
 * - `populate-content-items.ts` associated a page id with the wrong
 *   `url_ref.id` (row-order dependency in the batch resolver).
 *
 * Additionally an FK gap (`content_items.url_id` pointing at a
 * non-existent `url_refs.id`) or a missing `pages` row surfaces as a
 * `roundTripUrl` / `sourceUrl` of `null`; the check treats either as a
 * round-trip failure. LEFT JOINs are used deliberately so orphan rows
 * are observable — an INNER JOIN would silently drop them and let the
 * bug the invariant is meant to catch slip through.
 *
 * Sampling is **deterministic**: stride = ⌈count(content_items) / N⌉
 * gives approximately {@link SAMPLE_SIZE} rows spread across the id
 * range for large archives, and the full table for archives with
 * ≤ {@link SAMPLE_SIZE} rows. Deterministic sampling means the same
 * archive always produces the same verdict; a random sample would let a
 * failing archive pass on retry if the offending rows happen to fall
 * outside the second draw.
 *
 * The check throws when the sampled row count is smaller than expected
 * (LEFT JOINs may return `null` sides but never fewer rows than the
 * driving `content_items` set — a shortfall means SQLite silently
 * dropped rows we intended to inspect).
 * @param trx - Knex instance or transaction connected to the populated archive.
 * @throws {MigrationVerificationError} when at least one sampled URL does not round-trip.
 */
export async function checkUrlRoundTrip(trx: Knex): Promise<void> {
	const totalRows = await trx('content_items').count<{ n: number }[]>({ n: '*' });
	const total = Number(totalRows[0]!.n);
	if (total === 0) {
		return;
	}
	// stride = ⌈total / SAMPLE_SIZE⌉ so `id % stride = 0` picks approximately
	// SAMPLE_SIZE rows evenly across the id range for large archives, and the
	// full table for archives ≤ SAMPLE_SIZE.
	const stride = Math.max(1, Math.ceil(total / SAMPLE_SIZE));
	const sample = await trx('content_items as ci')
		.leftJoin('pages as p', 'p.id', 'ci.id')
		.leftJoin('url_refs as ur', 'ur.id', 'ci.url_id')
		.select<
			{ id: number; sourceUrl: string | null; roundTripUrl: string | null }[]
		>('ci.id as id', 'p.url as sourceUrl', 'ur.url as roundTripUrl')
		.whereRaw('(ci.id % ?) = 0', [stride])
		.orderBy('ci.id')
		.limit(SAMPLE_SIZE);
	const expectedSize = Math.min(SAMPLE_SIZE, Math.max(1, Math.floor(total / stride)));
	if (sample.length < expectedSize) {
		// LEFT JOINs preserve driving-table row counts (`p.id` / `url_refs.id`
		// are PKs → 1:1 or 0:1 match). A shortfall means SQLite silently
		// dropped rows the WHERE clause matched — a real integrity signal.
		throw new MigrationVerificationError({
			check: '#8 URL round-trip',
			context: {
				content_items_total: total,
				stride,
				expected_sample_size: expectedSize,
				actual_sample_size: sample.length,
				reason: 'sample query returned fewer rows than expected',
			},
		});
	}
	for (const row of sample) {
		if (row.sourceUrl === null || row.roundTripUrl === null) {
			throw new MigrationVerificationError({
				check: '#8 URL round-trip',
				context: {
					page_id: row.id,
					source_url: row.sourceUrl,
					round_trip_url: row.roundTripUrl,
					sample_size: sample.length,
					reason: 'orphan row — pages or url_refs join returned null (FK gap)',
				},
			});
		}
		if (row.sourceUrl !== row.roundTripUrl) {
			throw new MigrationVerificationError({
				check: '#8 URL round-trip',
				context: {
					page_id: row.id,
					source_url: row.sourceUrl,
					round_trip_url: row.roundTripUrl,
					sample_size: sample.length,
				},
			});
		}
	}
}
